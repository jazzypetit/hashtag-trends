// 플랫폼별 Apify actor 호출 + 공통 게시글 형식으로 정규화
import { runActor } from "./apify.mjs";

const INSTAGRAM_ACTOR = "apify~instagram-hashtag-scraper";
const TIKTOK_ACTOR = "clockworks~tiktok-hashtag-scraper";

const num = (v) => (typeof v === "number" && v >= 0 ? v : null);

export async function fetchInstagram(hashtag, limit, token) {
  const items = await runActor(
    INSTAGRAM_ACTOR,
    { hashtags: [hashtag], resultsType: "posts", resultsLimit: limit },
    token,
  );
  return items
    .filter((it) => it.url)
    .map((it) => ({
      platform: "instagram",
      sourceHashtag: hashtag,
      url: it.url,
      author: it.ownerUsername || "",
      caption: it.caption || "",
      hashtags: (it.hashtags || []).map((h) => String(h).replace(/^#/, "").toLowerCase()),
      likes: num(it.likesCount),
      comments: num(it.commentsCount),
      views: num(it.videoViewCount ?? it.videoPlayCount),
      postedAt: it.timestamp ? new Date(it.timestamp).toISOString() : null,
      thumbnail: it.displayUrl || "",
    }));
}

export async function fetchTiktok(hashtag, limit, token) {
  const items = await runActor(
    TIKTOK_ACTOR,
    { hashtags: [hashtag], resultsPerPage: limit },
    token,
  );
  return items
    .filter((it) => it.webVideoUrl)
    .map((it) => ({
      platform: "tiktok",
      sourceHashtag: hashtag,
      url: it.webVideoUrl,
      author: it.authorMeta?.name || "",
      caption: it.text || "",
      hashtags: (it.hashtags || [])
        .map((h) => (typeof h === "string" ? h : h?.name))
        .filter(Boolean)
        .map((h) => h.toLowerCase()),
      likes: num(it.diggCount),
      comments: num(it.commentCount),
      views: num(it.playCount),
      postedAt: it.createTimeISO || (it.createTime ? new Date(it.createTime * 1000).toISOString() : null),
      thumbnail: it.videoMeta?.coverUrl || "",
    }));
}

export const FETCHERS = { instagram: fetchInstagram, tiktok: fetchTiktok };
