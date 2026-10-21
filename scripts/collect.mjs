// 매일 실행: 해시태그별 게시글 수집 → 기간·좋아요 필터 → 키워드/URL 추출 → Claude 요약 → public/data 에 저장
//           + 지정 계정들의 최근 게시글 수집 → 키워드 매칭
//   node scripts/collect.mjs            실제 수집 (APIFY_TOKEN 필요, 선택: IG_USER_ID·IG_ACCESS_TOKEN, ANTHROPIC_API_KEY)
//   node scripts/collect.mjs --sample   샘플 데이터로 화면 확인용 결과 생성
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FETCHERS } from "./lib/sources.mjs";
import { extractKeywords } from "./lib/keywords.mjs";
import { summarizeHashtag } from "./lib/summarize.mjs";
import { samplePosts, sampleSummary } from "./lib/sample.mjs";
import { fetchInstagramAccount, fetchTiktokProfiles, matchKeywords } from "./lib/accounts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "public", "data");
const SAMPLE = process.argv.includes("--sample");

const config = JSON.parse(await fs.readFile(path.join(ROOT, "config.json"), "utf8"));
const now = new Date();
const since = new Date(now.getTime() - config.days * 24 * 60 * 60 * 1000);
// minLikes 는 숫자(전 플랫폼 공통) 또는 { instagram: 500, tiktok: 1000 } 형태
const minLikesFor = (platform) =>
  typeof config.minLikes === "number" ? config.minLikes : config.minLikes[platform] ?? 0;
const minLikesLabel = config.platforms.map((pf) => `${pf} ${minLikesFor(pf)}+`).join(", ");

if (!SAMPLE && !process.env.APIFY_TOKEN) {
  console.error("APIFY_TOKEN 환경변수가 필요합니다. (샘플로 보려면 --sample)");
  process.exit(1);
}
const useClaude = config.claude?.enabled && (SAMPLE || process.env.ANTHROPIC_API_KEY);

const result = {
  generatedAt: now.toISOString(),
  sample: SAMPLE,
  criteria: {
    days: config.days,
    minLikes: Object.fromEntries(config.platforms.map((pf) => [pf, minLikesFor(pf)])),
    since: since.toISOString() },
  hashtags: [],
  accounts: null,
  errors: [],
};

for (const rawTag of config.hashtags) {
  const hashtag = rawTag.replace(/^#/, "");
  console.log(`\n# ${hashtag}`);
  let collected = [];

  for (const platform of config.platforms) {
    try {
      const posts = SAMPLE
        ? samplePosts(hashtag, platform, now)
        : await FETCHERS[platform](hashtag, config.maxPostsPerHashtag, process.env.APIFY_TOKEN);
      console.log(`  ${platform}: ${posts.length}건 수집`);
      collected.push(...posts);
    } catch (err) {
      console.error(`  ${platform} 실패: ${err.message}`);
      result.errors.push({ hashtag, platform, message: err.message });
    }
  }

  // 중복 제거 + 기간·좋아요 필터
  const byUrl = new Map(collected.map((p) => [p.url, p]));
  const posts = [...byUrl.values()]
    .filter((p) => p.postedAt && new Date(p.postedAt) >= since)
    .filter((p) => (p.likes ?? 0) >= minLikesFor(p.platform))
    .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
  console.log(`  필터 후 ${posts.length}건 (최근 ${config.days}일, 좋아요 ${minLikesLabel})`);

  // 플랫폼별 탈락 사유 (조건을 조정할 때 참고)
  const dropped = {};
  for (const platform of config.platforms) {
    const all = [...byUrl.values()].filter((p) => p.platform === platform);
    const recent = all.filter((p) => p.postedAt && new Date(p.postedAt) >= since);
    dropped[platform] = {
      collected: all.length,
      noDate: all.filter((p) => !p.postedAt).length,
      older: all.filter((p) => p.postedAt && new Date(p.postedAt) < since).length,
      hiddenLikes: recent.filter((p) => p.likes == null).length,
      lowLikes: recent.filter((p) => p.likes != null && p.likes < minLikesFor(platform)).length,
    };
    console.log(`    ${platform} 탈락:`, JSON.stringify(dropped[platform]));
  }

  const keywords = extractKeywords(posts, hashtag);

  let ai = null;
  if (useClaude && posts.length > 0) {
    try {
      ai = SAMPLE
        ? sampleSummary(hashtag, posts)
        : await summarizeHashtag({
            hashtag,
            posts,
            keywords,
            model: config.claude.model,
            maxPosts: config.claude.maxPostsInPrompt,
          });
      console.log(`  Claude 요약 완료`);
    } catch (err) {
      console.error(`  Claude 요약 실패: ${err.message}`);
      result.errors.push({ hashtag, platform: "claude", message: err.message });
    }
  }

  result.hashtags.push({
    hashtag,
    collectedCount: byUrl.size,
    dropped,
    postCount: posts.length,
    byPlatform: Object.fromEntries(
      config.platforms.map((pf) => [pf, posts.filter((p) => p.platform === pf).length]),
    ),
    keywords,
    ai,
    posts,
  });
}

result.accounts = await collectAccounts();

// 저장: latest.json + 날짜별 스냅샷 + 스냅샷 목록
const day = now.toISOString().slice(0, 10);
await fs.mkdir(path.join(DATA_DIR, "history"), { recursive: true });
const json = JSON.stringify(result, null, 2);
await fs.writeFile(path.join(DATA_DIR, "latest.json"), json);
await fs.writeFile(path.join(DATA_DIR, "history", `${day}.json`), json);

const days = (await fs.readdir(path.join(DATA_DIR, "history")))
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .map((f) => f.replace(".json", ""))
  .sort()
  .reverse();
await fs.writeFile(path.join(DATA_DIR, "index.json"), JSON.stringify({ days }, null, 2));

console.log(`\n저장 완료: public/data/latest.json, history/${day}.json`);
if (result.errors.length) process.exitCode = result.hashtags.every((h) => h.postCount === 0) ? 1 : 0;

// 샘플: 절반은 해시태그를 빼서 키워드 매칭/비매칭이 섞이게
function sampleAccountPost(p, author, j) {
  return {
    ...p,
    author,
    sourceHashtag: null,
    caption: j % 2 ? p.caption.replace(/ #\S+$/, "") : p.caption.replace(/ #\S+$/, ` #${config.hashtags[0]}`),
    hashtags: j % 2 ? p.hashtags.slice(1) : [config.hashtags[0], ...p.hashtags.slice(1)],
  };
}

// ── 계정 모니터링 ──────────────────────────────────────────────
// 게시글은 accounts-store.json 에 누적한다. 틱톡은 Apify 비용 때문에 첫 실행만 config.days 만큼,
// 이후에는 최근 tiktokRefreshDays 일치만 다시 받아 합친다(그 기간 게시글의 좋아요도 갱신됨).
async function collectAccounts() {
  const acc = config.accounts;
  const lists = {
    instagram: (acc?.instagram || []).map((u) => u.replace(/^@/, "").toLowerCase()),
    tiktok: (acc?.tiktok || []).map((u) => u.replace(/^@/, "").toLowerCase()),
  };
  if (SAMPLE && !lists.instagram.length && !lists.tiktok.length) {
    lists.instagram = ["sample_ig_a", "sample_ig_b", "sample_ig_c"];
    lists.tiktok = ["sample_tt_a", "sample_tt_b"];
  }
  if (!lists.instagram.length && !lists.tiktok.length) return null;

  const keywords = [...new Set([...config.hashtags, ...(acc?.keywords || [])].map((k) => k.replace(/^#/, "")))];
  console.log(`\n# 계정 모니터링 (인스타 ${lists.instagram.length}, 틱톡 ${lists.tiktok.length}) · 키워드: ${keywords.join(", ")}`);

  const storePath = path.join(DATA_DIR, "accounts-store.json");
  let store = { lastTiktokFetch: null, posts: [] };
  try { store = JSON.parse(await fs.readFile(storePath, "utf8")); } catch {}

  const fresh = [];
  const followers = { instagram: {}, tiktok: {} };
  const accountErrors = {};
  const fail = (platform, username, message) => {
    console.error(`  ${platform} ${username ?? ""} 실패: ${message}`);
    if (username) accountErrors[`${platform}:${username}`] = message;
    result.errors.push({ hashtag: "계정", platform, message: username ? `@${username}: ${message}` : message });
  };

  // instagram
  if (lists.instagram.length) {
    const { IG_USER_ID, IG_ACCESS_TOKEN } = process.env;
    if (SAMPLE) {
      lists.instagram.forEach((u, i) => {
        fresh.push(...samplePosts(config.hashtags[i % config.hashtags.length] + u, "instagram", now)
          .slice(0, 8).map((p, j) => sampleAccountPost(p, u, j)));
        followers.instagram[u] = 10000 * (i + 3);
      });
    } else if (!IG_USER_ID || !IG_ACCESS_TOKEN) {
      fail("instagram", null, "IG_USER_ID / IG_ACCESS_TOKEN 이 설정되지 않아 인스타 계정 수집을 건너뜀");
    } else {
      for (const u of lists.instagram) {
        try {
          const r = await fetchInstagramAccount(u, {
            igUserId: IG_USER_ID,
            accessToken: IG_ACCESS_TOKEN,
            graphVersion: acc.graphVersion || "v23.0",
          });
          followers.instagram[u] = r.followers;
          fresh.push(...r.posts);
        } catch (err) {
          fail("instagram", u, err.message);
        }
      }
    }
    console.log(`  instagram: ${fresh.filter((p) => p.platform === "instagram").length}건 수집`);
  }

  // tiktok
  if (lists.tiktok.length) {
    const lookbackDays = store.lastTiktokFetch ? acc?.tiktokRefreshDays ?? 3 : config.days;
    const oldest = new Date(now.getTime() - lookbackDays * 86400000).toISOString().slice(0, 10);
    try {
      let r;
      if (SAMPLE) {
        r = { followers: {}, posts: [] };
        lists.tiktok.forEach((u, i) => {
          r.posts.push(...samplePosts(config.hashtags[i % config.hashtags.length] + u, "tiktok", now)
            .slice(0, 8).map((p, j) => sampleAccountPost(p, u, j)));
          r.followers[u] = 50000 * (i + 1);
        });
      } else {
        r = await fetchTiktokProfiles(lists.tiktok, oldest, acc?.tiktokMaxPerProfile ?? 30, process.env.APIFY_TOKEN);
      }
      Object.assign(followers.tiktok, r.followers);
      fresh.push(...r.posts);
      store.lastTiktokFetch = now.toISOString();
      console.log(`  tiktok: ${r.posts.length}건 수집 (${oldest} 이후)`);
    } catch (err) {
      fail("tiktok", null, err.message);
    }
  }

  // 누적 저장소와 합치기: 같은 URL 은 새로 받은 값으로 교체, 기간 밖·목록에서 빠진 계정은 정리
  const merged = new Map(store.posts.map((p) => [p.url, p]));
  for (const p of fresh) merged.set(p.url, p);
  const posts = [...merged.values()]
    .filter((p) => lists[p.platform]?.includes(p.author.toLowerCase()))
    .filter((p) => p.postedAt && new Date(p.postedAt) >= since)
    .map((p) => ({ ...p, matched: matchKeywords(p, keywords) }))
    .sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));
  store.posts = posts.map(({ matched, ...p }) => p);
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(store));

  const matchedPosts = posts.filter((p) => p.matched.length);
  console.log(`  최근 ${config.days}일 ${posts.length}건 중 키워드 매칭 ${matchedPosts.length}건`);

  const summary = [];
  for (const platform of ["instagram", "tiktok"]) {
    for (const u of lists[platform]) {
      const mine = posts.filter((p) => p.platform === platform && p.author.toLowerCase() === u);
      summary.push({
        platform,
        username: u,
        followers: followers[platform][u] ?? null,
        postCount: mine.length,
        matchedCount: mine.filter((p) => p.matched.length).length,
        error: accountErrors[`${platform}:${u}`] || null,
      });
    }
  }

  return {
    hashtag: "계정 모니터링",
    kind: "accounts",
    keywordsUsed: keywords,
    collectedCount: posts.length,
    postCount: matchedPosts.length,
    byPlatform: Object.fromEntries(
      ["instagram", "tiktok"].map((pf) => [pf, matchedPosts.filter((p) => p.platform === pf).length]),
    ),
    keywords: extractKeywords(matchedPosts, ""),
    ai: null,
    accounts: summary,
    posts,
  };
}
