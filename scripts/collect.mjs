// 매일 실행: 해시태그별 게시글 수집 → 기간·좋아요 필터 → 키워드/URL 추출 → Claude 요약 → public/data 에 저장
//   node scripts/collect.mjs            실제 수집 (APIFY_TOKEN, ANTHROPIC_API_KEY 필요)
//   node scripts/collect.mjs --sample   샘플 데이터로 화면 확인용 결과 생성
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FETCHERS } from "./lib/sources.mjs";
import { extractKeywords } from "./lib/keywords.mjs";
import { summarizeHashtag } from "./lib/summarize.mjs";
import { samplePosts, sampleSummary } from "./lib/sample.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "public", "data");
const SAMPLE = process.argv.includes("--sample");

const config = JSON.parse(await fs.readFile(path.join(ROOT, "config.json"), "utf8"));
const now = new Date();
const since = new Date(now.getTime() - config.days * 24 * 60 * 60 * 1000);

if (!SAMPLE && !process.env.APIFY_TOKEN) {
  console.error("APIFY_TOKEN 환경변수가 필요합니다. (샘플로 보려면 --sample)");
  process.exit(1);
}
const useClaude = config.claude?.enabled && (SAMPLE || process.env.ANTHROPIC_API_KEY);

const result = {
  generatedAt: now.toISOString(),
  sample: SAMPLE,
  criteria: { days: config.days, minLikes: config.minLikes, since: since.toISOString() },
  hashtags: [],
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
    .filter((p) => (p.likes ?? 0) >= config.minLikes)
    .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
  console.log(`  필터 후 ${posts.length}건 (최근 ${config.days}일, 좋아요 ${config.minLikes}+)`);

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
      lowLikes: recent.filter((p) => p.likes != null && p.likes < config.minLikes).length,
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
