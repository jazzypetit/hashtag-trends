// 지정한 인플루언서 계정들의 최근 게시글 수집
//   instagram: Instagram Graph API Business Discovery (무료, IG_USER_ID / IG_ACCESS_TOKEN 필요)
//   tiktok:    Apify tiktok-profile-scraper (최신순 + 날짜 필터로 새 게시글만)
import { runActor } from "./apify.mjs";
import { mapTiktokItem } from "./sources.mjs";

const TIKTOK_PROFILE_ACTOR = "clockworks~tiktok-profile-scraper";
const num = (v) => (typeof v === "number" && v >= 0 ? v : null);
const HASHTAG_RE = /#([\p{L}\p{N}_]+)/gu;

export async function fetchInstagramAccount(username, { igUserId, accessToken, graphVersion }) {
  const fields =
    `business_discovery.username(${username}){username,followers_count,` +
    `media.limit(50){caption,like_count,comments_count,media_type,permalink,timestamp,thumbnail_url,media_url}}`;
  const url =
    `https://graph.facebook.com/${graphVersion}/${igUserId}` +
    `?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok || body.error) {
    throw new Error(body.error?.message || `Graph API ${res.status}`);
  }
  const bd = body.business_discovery;
  const posts = (bd.media?.data || []).map((m) => ({
    platform: "instagram",
    sourceHashtag: null,
    url: m.permalink,
    author: bd.username,
    caption: m.caption || "",
    hashtags: [...(m.caption || "").matchAll(HASHTAG_RE)].map((x) => x[1].toLowerCase()),
    likes: num(m.like_count), // 좋아요를 숨긴 게시글은 like_count 가 없음
    comments: num(m.comments_count),
    views: null,
    postedAt: m.timestamp ? new Date(m.timestamp).toISOString() : null,
    thumbnail: m.thumbnail_url || m.media_url || "",
  }));
  return { followers: num(bd.followers_count), posts };
}

export async function fetchTiktokProfiles(usernames, oldestDate, maxPerProfile, token) {
  const items = await runActor(
    TIKTOK_PROFILE_ACTOR,
    {
      profiles: usernames,
      profileScrapeSections: ["videos"],
      profileSorting: "latest",
      oldestPostDateUnified: oldestDate, // YYYY-MM-DD
      resultsPerPage: maxPerProfile,
      excludePinnedPosts: false,
    },
    token,
  );
  const followers = {};
  for (const it of items) {
    if (it.authorMeta?.name) followers[it.authorMeta.name.toLowerCase()] = num(it.authorMeta.fans);
  }
  return { followers, posts: items.filter((it) => it.webVideoUrl).map((it) => mapTiktokItem(it)) };
}

// 캡션·해시태그에 키워드가 들어 있는지 (해시태그는 정확히 일치, 캡션은 부분 일치)
export function matchKeywords(post, keywords) {
  const caption = post.caption.toLowerCase();
  return keywords.filter((k) => {
    const kw = k.replace(/^#/, "").toLowerCase();
    return post.hashtags.includes(kw) || caption.includes(kw);
  });
}
