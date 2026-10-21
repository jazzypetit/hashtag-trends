# 해시태그 트렌드

인스타그램·틱톡에서 지정한 해시태그의 **최근 N일 신규 게시글 중 좋아요 기준 이상**을 매일 수집하고,
함께 쓰인 해시태그 / 캡션 키워드 / 외부 링크 / 게시글 URL 을 추출해 웹페이지로 보여줍니다.
Claude가 해시태그별 트렌드 키워드를 요약합니다.

```
GitHub Actions (매일 09:00 KST)
  └ scripts/collect.mjs
      ├ Apify: instagram-hashtag-scraper / tiktok-hashtag-scraper
      ├ 최근 30일 + 좋아요 기준(인스타 500 / 틱톡 1,000) 필터, URL 중복 제거
      ├ 빈도 키워드·외부 링크 추출
      ├ Claude 요약 (claude-opus-5-5)
      └ public/data/latest.json, history/YYYY-MM-DD.json 저장 → 커밋
  └ GitHub Pages 로 public/ 배포
```

## 설정 (config.json)

| 키 | 설명 |
|---|---|
| `hashtags` | 조회할 해시태그 목록 (`#` 없이) |
| `platforms` | `instagram`, `tiktok` |
| `days` | 최근 며칠 이내 게시글만 (기본 30) |
| `minLikes` | 좋아요 최소값. 숫자 하나(공통) 또는 `{ "instagram": 500, "tiktok": 1000 }` 처럼 플랫폼별 |
| `maxPostsPerHashtag` | 플랫폼·해시태그당 Apify에서 가져올 최대 게시글 수 (비용과 직결) |
| `accounts.instagram` / `accounts.tiktok` | 모니터링할 계정 아이디 목록 (`@` 없이) |
| `accounts.keywords` | 계정 게시글에서 찾을 키워드. `hashtags` 는 자동으로 포함됨. 해시태그는 정확히 일치, 캡션은 부분 일치 |
| `accounts.tiktokMaxPerProfile` | 틱톡 계정당 한 번에 가져올 최대 게시글 수 |
| `accounts.tiktokRefreshDays` | 두 번째 실행부터 틱톡은 최근 며칠치만 다시 받음 (그 기간 게시글의 좋아요도 갱신) |
| `accounts.graphVersion` | Instagram Graph API 버전 |
| `claude.enabled` / `model` / `maxPostsInPrompt` | Claude 요약 설정 |

## 계정 모니터링

지정한 계정들의 최근 `days` 일 게시글을 모아, `hashtags` + `accounts.keywords` 가 들어간 게시글을 따로 보여줍니다.
웹페이지의 **계정 모니터링** 탭에서 "키워드 매칭만"을 끄면 전체 게시글을 볼 수 있습니다. 계정 게시글에는 좋아요 기준을 적용하지 않습니다.

- **인스타그램**: Instagram Graph API의 Business Discovery 를 사용합니다(무료). 대상 계정이 비즈니스·크리에이터 계정이어야 하고, 매 실행마다 계정당 최근 50개 게시글을 다시 받습니다.
  준비물: 내 인스타그램 비즈니스/크리에이터 계정 + 연결된 Facebook 페이지 + Meta 개발자 앱.
  Secrets 에 `IG_USER_ID`(내 인스타 비즈니스 계정 ID)와 `IG_ACCESS_TOKEN` 을 넣으세요.
  일반 사용자 토큰은 60일 뒤 만료되므로, Meta 비즈니스 설정의 시스템 사용자 토큰처럼 만료되지 않는 토큰을 권장합니다.
- **틱톡**: Apify `tiktok-profile-scraper` 를 사용합니다. 첫 실행만 `days` 일치를 받고, 이후에는 최근 `tiktokRefreshDays` 일치만 받아
  `public/data/accounts-store.json` 에 누적합니다. 날짜 필터를 쓰기 때문에 결과 1건당 날짜 필터 요금이 추가됩니다.

## 로컬에서 실행

```bash
npm install
npm run collect:sample   # API 없이 샘플 데이터로 화면 확인
APIFY_TOKEN=... ANTHROPIC_API_KEY=... npm run collect   # 실제 수집
npm run serve            # http://localhost:4173
```

## 클라우드 배포 (GitHub)

1. GitHub에 새 저장소(비공개 권장)를 만들고 이 폴더를 push
2. **Settings → Secrets and variables → Actions** 에 추가
   - `APIFY_TOKEN` — https://console.apify.com/settings/integrations
   - `ANTHROPIC_API_KEY` — https://platform.claude.com/settings/keys (Claude 요약을 켤 때만)
   - `IG_USER_ID`, `IG_ACCESS_TOKEN` — 인스타 계정 모니터링을 쓸 때만
3. **Settings → Pages → Source** 를 `GitHub Actions` 로 설정
4. **Actions → Daily hashtag collect → Run workflow** 로 첫 실행
5. 이후 매일 09:00 KST 자동 실행, 결과는 Pages URL에서 확인

> 비공개 저장소의 GitHub Pages는 유료 플랜에서만 지원되고, 무료 플랜에서는 Pages 사이트가 공개됩니다.
> 수집 결과를 외부에 공개하고 싶지 않다면 이 점을 고려하세요.

## 참고

- 인스타그램은 일부 게시글의 좋아요 수를 숨깁니다. 이런 게시글은 좋아요 0으로 처리되어 필터에서 제외됩니다.
- 해시태그 스크래퍼는 해시태그 페이지에 노출되는 게시글만 가져옵니다. 인기 해시태그는 `maxPostsPerHashtag` 를 늘려야 1주일치를 충분히 덮을 수 있습니다.
- Apify 요금은 수집 건수에 비례합니다. 해시태그 수 × 플랫폼 수 × `maxPostsPerHashtag` 기준으로 Apify 요금표를 확인하세요.
