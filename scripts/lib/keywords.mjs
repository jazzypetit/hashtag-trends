// 빈도 기반 키워드·URL 추출

const STOPWORDS = new Set([
  // en
  "the", "and", "for", "you", "with", "this", "that", "are", "was", "but", "not", "your",
  "have", "from", "just", "all", "our", "out", "get", "can", "what", "when", "how", "it's",
  "its", "my", "me", "is", "in", "on", "of", "to", "a", "an", "at", "be", "so", "do", "by",
  "link", "bio", "follow", "like", "comment", "dm",
  // ko
  "그리고", "하지만", "그래서", "정말", "진짜", "너무", "이거", "저거", "그거", "오늘", "우리",
  "있는", "없는", "하는", "합니다", "입니다", "있어요", "해요", "에서", "으로", "하고", "같은",
  "많이", "그냥", "이번", "다들", "여러분",
]);

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}_'-]{1,}/gu;

const bump = (map, key, likes) => {
  const cur = map.get(key) || { count: 0, likes: 0 };
  cur.count += 1;
  cur.likes += likes || 0;
  map.set(key, cur);
};

const top = (map, n) =>
  [...map.entries()]
    .map(([term, v]) => ({ term, count: v.count, likes: v.likes }))
    .sort((a, b) => b.count - a.count || b.likes - a.likes)
    .slice(0, n);

export function extractKeywords(posts, sourceHashtag) {
  const self = sourceHashtag.toLowerCase();
  const tags = new Map();
  const words = new Map();
  const links = new Map();

  for (const p of posts) {
    for (const h of new Set(p.hashtags)) {
      if (h && h !== self) bump(tags, h, p.likes);
    }
    const text = p.caption.replace(URL_RE, " ").replace(/[#@][\p{L}\p{N}_.]+/gu, " ");
    const seen = new Set();
    for (const m of text.matchAll(WORD_RE)) {
      const w = m[0].toLowerCase();
      if (w.length < 2 || STOPWORDS.has(w) || /^\d+$/.test(w) || seen.has(w)) continue;
      seen.add(w);
      bump(words, w, p.likes);
    }
    for (const m of p.caption.matchAll(URL_RE)) {
      const u = m[0].replace(/[.,!?]+$/, "");
      const entry = links.get(u) || { url: u, count: 0, posts: [] };
      entry.count += 1;
      entry.posts.push(p.url);
      links.set(u, entry);
    }
  }

  return {
    hashtags: top(tags, 40),
    words: top(words, 40),
    externalUrls: [...links.values()].sort((a, b) => b.count - a.count),
  };
}
