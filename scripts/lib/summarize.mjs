// Claude로 해시태그별 트렌드 키워드 요약
import Anthropic from "@anthropic-ai/sdk";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "keywords", "themes"],
  properties: {
    summary: { type: "string", description: "이번 기간 게시글 흐름을 2~4문장으로 요약 (한국어)" },
    keywords: {
      type: "array",
      description: "트렌드 키워드 5~15개, 중요도 순",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["keyword", "reason", "examplePostUrls"],
        properties: {
          keyword: { type: "string" },
          reason: { type: "string", description: "왜 주목할 만한지 한 문장" },
          examplePostUrls: { type: "array", items: { type: "string" } },
        },
      },
    },
    themes: { type: "array", items: { type: "string" }, description: "게시글을 묶는 큰 주제 3~6개" },
  },
};

export async function summarizeHashtag({ hashtag, posts, keywords, model, maxPosts }) {
  const client = new Anthropic();
  const sample = [...posts]
    .sort((a, b) => (b.likes || 0) - (a.likes || 0))
    .slice(0, maxPosts)
    .map((p) => ({
      platform: p.platform,
      url: p.url,
      likes: p.likes,
      postedAt: p.postedAt,
      caption: p.caption.slice(0, 500),
      hashtags: p.hashtags.slice(0, 20),
    }));

  const prompt = [
    `해시태그 #${hashtag} 로 수집한 인스타그램·틱톡 인기 게시글(좋아요 기준 필터링)입니다.`,
    "게시글 캡션과 함께 쓰인 해시태그를 보고, 마케터가 바로 참고할 수 있도록 트렌드 키워드를 정리해 주세요.",
    "단순히 빈도가 높은 단어보다는 제품명, 장소, 포맷(챌린지·밈 등), 감성 키워드처럼 의미 있는 것을 우선하세요.",
    "examplePostUrls 에는 아래 게시글 url 중 해당 키워드를 잘 보여주는 것만 최대 3개 넣으세요.",
    "",
    "<frequency_stats>",
    JSON.stringify({ coHashtags: keywords.hashtags.slice(0, 25), words: keywords.words.slice(0, 25) }),
    "</frequency_stats>",
    "",
    "<posts>",
    JSON.stringify(sample),
    "</posts>",
  ].join("\n");

  const response = await client.beta.messages.create({
    model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: prompt }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined: ${response.stop_details?.category ?? "unknown"}`);
  }
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error(`Claude returned no text (stop_reason=${response.stop_reason})`);
  return { ...JSON.parse(text), model: response.model };
}
