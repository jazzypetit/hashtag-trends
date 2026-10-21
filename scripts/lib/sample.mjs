// --sample 모드용 가짜 데이터 (API 호출 없이 화면 확인용)
const CAPTIONS = [
  "성수 신상 카페 다녀왔어요 ☕️ 말차 크림라떼 진짜 맛있음 https://naver.me/sample1",
  "주말 브런치 추천! 소금빵이랑 아인슈페너 조합 최고 #브런치 #소금빵",
  "가을 데일리룩 🍂 트렌치코트 + 로퍼 코디 https://smartstore.naver.com/sample/products/1",
  "오늘의 OOTD 니트 베스트 레이어드 꿀팁 공유합니다",
  "연남동 루프탑 카페 노을 맛집 🌇 예약 링크는 프로필에",
  "말차 디저트 투어 3탄 🍵 말차 티라미수 원탑",
  "빈티지 무드 코디 챌린지 참여해봤어요 #챌린지",
  "트렌치코트 하나로 일주일 코디하기 https://smartstore.naver.com/sample/products/1",
];
const TAGS = [
  ["성수카페", "말차", "카페투어"],
  ["브런치", "소금빵", "아인슈페너"],
  ["가을코디", "트렌치코트", "데일리룩"],
  ["니트", "레이어드", "데일리룩"],
  ["연남동카페", "루프탑", "노을"],
  ["말차", "디저트", "카페투어"],
  ["빈티지", "챌린지", "코디"],
  ["트렌치코트", "가을코디", "코디"],
];

export function samplePosts(hashtag, platform, now) {
  let seed = [...(hashtag + platform)].reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  return Array.from({ length: 18 }, (_, i) => {
    const k = Math.floor(rand() * CAPTIONS.length);
    const id = `${platform.slice(0, 2)}${hashtag.length}${i}${Math.floor(rand() * 1e6)}`;
    return {
      platform,
      sourceHashtag: hashtag,
      url:
        platform === "instagram"
          ? `https://www.instagram.com/p/SAMPLE${id}/`
          : `https://www.tiktok.com/@sample_user${i}/video/7${id}`,
      author: `sample_user${i}`,
      caption: `${CAPTIONS[k]} #${hashtag}`,
      hashtags: [hashtag, ...TAGS[k]],
      likes: Math.floor(rand() * 20000),
      comments: Math.floor(rand() * 500),
      views: platform === "tiktok" ? Math.floor(rand() * 400000) : null,
      postedAt: new Date(now.getTime() - rand() * 10 * 86400000).toISOString(),
      thumbnail: "",
    };
  });
}

export function sampleSummary(hashtag, posts) {
  const pick = (word) => posts.filter((p) => p.caption.includes(word)).slice(0, 3).map((p) => p.url);
  return {
    model: "sample",
    summary: `(샘플) #${hashtag} 게시글은 성수·연남 지역 카페 방문기와 가을 코디가 중심입니다. 말차 메뉴와 트렌치코트 코디가 반복적으로 높은 반응을 얻고 있습니다.`,
    themes: ["카페 투어", "말차 디저트", "가을 코디", "챌린지 포맷"],
    keywords: [
      { keyword: "말차", reason: "음료·디저트 모두에서 반복 등장하고 좋아요가 높음", examplePostUrls: pick("말차") },
      { keyword: "트렌치코트", reason: "가을 코디 게시글의 핵심 아이템", examplePostUrls: pick("트렌치코트") },
      { keyword: "성수", reason: "카페 방문기 중 가장 많이 언급된 지역", examplePostUrls: pick("성수") },
      { keyword: "루프탑", reason: "노을 시간대 방문 인증 게시글이 늘어남", examplePostUrls: pick("루프탑") },
    ],
  };
}
