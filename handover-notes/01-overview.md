# 01. 프로젝트 개요

> **2026-09-30 갱신:** 관리자 배치(`/api/admin/batch`, refresh-license)와 크론은 삭제됐다. 인허가 캐시(license_cache)·버즈 캐시(place_buzz_cache)도 삭제 대상(v2-schema 005). 아래의 배치·크론 설명은 과거 기록이다. 현재 계획은 20번 노트.

## 정체

MINT는 모임 장소 추천 서비스다. 목적(1차·2차), 관계, 지역(직접 지정 또는 출발지 기반 중간지점), 분위기·예산·편식을 고르면 후보를 수집해 LLM이 최종 장소를 고른다.

두 가지 모드:
- **혼자(solo)**: 한 기기에서 4단계를 입력하고 결과를 본다.
- **다같이(group)**: 호스트가 인원·코스·지역을 정하고 링크를 뿌린다. 게스트가 `/join`에서 취향을 제출하면 서버 세션에 쌓이고, 2명 이상 모이면 집계해서 추천한다.

부가 기능:
- 파일럿 캠페인(`/pilot`): 방문 인증 사진 업로드 후 룰렛으로 기프티콘 배정. 꽝 칸은 있지만 확률 0.
- 카카오 로그인(Supabase OAuth, 선택형).
- 5탭 앱 셸: 홈(=추천 플로우), 내 모임, 발굴, 민트샵, 프로필. 뒤의 세 탭은 대부분 목업.
- 공유 결과 페이지(`/shared`)와 투표.
- 어드민(`/admin`, `/pilot-admin`).
- 우하단 피드백 FAB와 아웃박스.

## 스택

| 층 | 내용 |
|---|---|
| 프론트 | Vite 8, React 19, TypeScript 6, Tailwind 3. 수제 path 라우터. 전역 상태 라이브러리·Context 없음 |
| 백엔드 | Vercel 서버리스 함수 10개(`api/`). `api/_lib/`는 공용 순수 함수 |
| DB | Supabase Postgres 15 테이블 + 스토리지 버킷 2개. 마이그레이션 시스템 없음, SQL 수동 실행 |
| LLM | `claude-haiku-4-5-20251001`, 529 시 `claude-sonnet-4-6` 1회 재시도 |
| 외부 API | 네이버 지역·이미지·블로그 검색, 카카오 로컬 REST·지도 JS SDK·공유 SDK, 공공데이터포털 상가정보·인허가, 서울 실시간 도시데이터(혼잡도), Open-Meteo(날씨), ODsay(대중교통 소요시간, 브라우저 직접 호출) |
| 분석 | GTM(GTM-TST2XCDT), Supabase `events` 테이블 직접 INSERT |
| 배포 | Vercel(region icn1), `outputDirectory: dist`(2026-09-21 앱인토스 제거로 dist/web→dist). ~~Apps-in-Toss `ait build`가 `dist/web`와 `.ait` 번들을 동시에 생성 |
| 도메인 | https://mint-mlp-4vm9.vercel.app |

## 규모

| 항목 | 값 |
|---|---|
| 총 코드 | 약 22,100줄 (ts/tsx/sql/mjs) |
| src/ | 약 16,800줄 |
| api/ | 약 5,000줄 |
| 커밋 | 362 (2026-04-27 ~ 2026-09-14) |
| 작성자 | 1명 |
| .git 크기 | 82MB (mint.ait 41버전 누적 290MB가 원인) |

가장 큰 파일:

| 파일 | 줄 |
|---|---|
| src/pages/Home.tsx | 2,130 |
| api/recommend.ts | 1,637 |
| src/pages/Admin.tsx | 1,184 |
| src/pages/Landing.tsx | 1,081 |
| src/pages/MemberInput.tsx | 1,042 |
| src/components/ResultCard.tsx | 848 |

## 건강 검사 (2026-09-15 실측)

| 검사 | 결과 |
|---|---|
| `tsc -p tsconfig.app.json` | 통과 |
| `tsc` on api/ (별도 tsconfig 없음, 수동 옵션) | 통과 |
| `vitest run` | 7파일 52건 전부 통과 |
| `vite build` | 통과. index 192KB, supabase 203KB, AppShell 215KB |
| `eslint .` | 21 에러, 1 경고 |

eslint 에러 분포:

| 파일 | 건수 | 규칙 |
|---|---|---|
| src/components/placeCardBits.tsx | 6 | react-refresh/only-export-components, no-useless-escape |
| src/services/kakaoMap.ts | 4 | no-explicit-any, no-useless-assignment |
| src/pages/MemberInput.tsx | 3 | set-state-in-effect, react-hooks/refs |
| src/components/LocationInput.tsx | 2 | exhaustive-deps, react-hooks/refs |
| src/components/VibeSelect.tsx | 2 | only-export-components |
| src/pages/Landing.tsx | 2 | set-state-in-effect |
| src/components/MeetingLocationSelect.tsx | 1 | react-hooks/refs |
| src/pages/SharedResult.tsx | 1 | set-state-in-effect |
| src/utils/kakaoLoader.ts | 1 | no-explicit-any |

전임자 마지막 커밋(bc4d26d)이 Home.tsx만 0으로 만들고 나머지는 남겼다.

## 환경변수 전량

| 변수 | 사용처 | 없을 때 |
|---|---|---|
| `ANTHROPIC_API_KEY` | api/recommend.ts:854 | SDK throw, 추천 500 |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | recommend.ts:468-469, :790-791, _lib/blogBuzz.ts:84-85, admin-batch.ts:66-67 | 후보 0건, 모델 자유생성 모드 |
| `VITE_KAKAO_REST_API_KEY` | recommend.ts:789, 920, 1490 (서버 process.env로만 읽음) | 카카오 보강·3차·place_url 스킵 |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | _lib/supabaseAdmin.ts:8-9, session.ts:29-30, pilot-feedback.ts:20 | 캐시·로깅·레이트리밋 전부 스킵 (fail-open) |
| `PUBLIC_DATA_SERVICE_KEY` | _lib/publicData.ts:28, admin-batch.ts:159 | L0 발굴 스킵 |
| `SEOUL_DATA_API_KEY` (폴백 `VITE_SEOUL_DATA_API_KEY`) | _lib/congestion.ts:29, congestion.ts:21 | 혼잡도 '알 수 없음' |
| `ADMIN_PASSWORD` | admin-data.ts:137, pilot-feedback.ts:102, recommend.ts:1242 | 어드민 500 |
| `ADMIN_REFRESH_SECRET` | admin-batch.ts:267 | 수동 배치 401 |
| `CRON_SECRET` | admin-batch.ts:257 | 크론 401 |
| `RECOMMEND_DAILY_CAP` | recommend.ts:829 | 기본 500 |
| `EXPOSE_DEBUG` | recommend.ts:1621 | 디버그 미노출 |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | src/utils/supabase.ts:3-6 | 'placeholder'로 조용히 깨짐 |
| `VITE_KAKAO_JS_API_KEY` | kakaoLoader.ts:8, Home.tsx:201 | 하드코딩 리터럴로 폴백 (문제) |
| `VITE_ODSAY_API_KEY` | src/services/travelTime.ts:52 | 직선거리 추정 폴백. 번들에 인라인됨 |

`VITE_` 접두사는 번들 인라인을 뜻한다. 서버 전용 키에 `VITE_`가 붙은 것(`VITE_KAKAO_REST_API_KEY`, `VITE_SEOUL_DATA_API_KEY`)은 누군가 클라이언트에서 참조하는 순간 유출된다.

## 저장소 위생

- `mint.ait` (8.7MB, 2026-09-21 git rm·gitignore): Apps-in-Toss 빌드 번들. 2026-05-20 "chore: add remaining files"로 의도적 커밋 후 41회 갱신. 7월 16일 이후 멈춘 스테일 번들. 배포에 불필요.
- `repomix-output.xml` (210KB): 5월에 AI에 먹이려고 한 번 생성한 뒤 방치. 4개월 묵은 스냅샷.
- `.claude/settings.local.json`: 커밋되어 있고 내용은 `Bash(*)` 전권 허용. 과거 버전에는 전임자 윈도우 계정명(HKEDU)과 로컬 절대경로가 남아 있음.
- `@anthropic-ai/sdk`가 dependencies에 있음. src에서 import 0건이지만 사고 대기 상태.
- README.md는 Vite 템플릿 원문. 프로젝트 설명·env·SQL 안내 없음.
