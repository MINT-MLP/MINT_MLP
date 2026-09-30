# 03. 백엔드 API (api/, 약 5,000줄)

> **2026-09-30 갱신:** 관리자 배치(`/api/admin/batch`, refresh-license)와 크론은 삭제됐다. 인허가 캐시(license_cache)·버즈 캐시(place_buzz_cache)도 삭제 대상(v2-schema 005). 아래의 배치·크론 설명은 과거 기록이다. 현재 계획은 20번 노트.

## 0. 구성 개요
- Vercel Serverless(`@vercel/node`) 함수 10개. Hobby 플랜 12개 상한이 설계를 지배한다. `session.ts`(5기능), `admin-batch.ts`(2배치), `recommend.ts`(추천 + `stage:'enrich'`)가 전부 단일 파일 action 분기.
- `vercel.json`: (2026-09-22 함수 2개로 통합 후) `api/**/*.ts` 전부 maxDuration 60s. 함수는 `api/[...path].ts`(유저 8개 엔드포인트, URL 불변)와 `api/admin/[...path].ts`(/api/admin/batch, /api/admin/data) 둘뿐. 핸들러 본문은 `api/_routes/`. 이전: recommend 60s, session 10s, admin-batch 60s, 나머지 7개 기본 10s. 크론 `0 18 * * *`(UTC, KST 03:00) → `GET /api/admin-batch`. rewrite `/api/session-create|join|get` → `/api/session`.
- DB 접근은 전부 service role 키(`_lib/supabaseAdmin.ts:6-12`). RLS 완전 우회. 키 없으면 null 반환 후 각 호출부가 fail-open.
- CORS 헤더 설정 없음(브라우저 cross-origin 기본 차단, 의도가 아니라 누락).

## 1. 엔드포인트

### `api/recommend.ts` (1,637줄) POST
| 항목 | 내용 |
|---|---|
| 분기 | `body.stage === 'enrich'` → `handleEnrich`(:778-807) / 그 외 메인 |
| 인증 | 없음. 레이트리밋만(:824-830, IP 분당 5 / 엔드포인트 전체 일일 `RECOMMEND_DAILY_CAP ?? 500`) |
| 검증 | `validateRecommendBody`(_lib/guard.ts:61-127) |
| 외부 | 네이버 지역(:405)·이미지(:640), 카카오 카테고리(:153)·키워드(:709), Open-Meteo(:596), 서울 도시데이터(_lib/congestion.ts:12), data.go.kr 상가(_lib/publicData.ts:35), Anthropic(:1262) |
| 테이블 | `api_hits`, `place_buzz_cache`(읽기), `license_cache`, `recommendation_log` |
| 응답 | `{ places[], serial, thirdStop, thirdLabel, weather, _debug?, _bench?, _diag? }` |

`handleEnrich`: `{places:[{placeName,lat,lng,area?,category?}]}` 최대 7개 → `{enriched:[{placeName,kakaoPlaceUrl?,imageUrl?}]}`. **검증·레이트리밋 전무**(주석 :776이 의도적이라고 명시).

### `api/session.ts` (496줄) GET/POST
- 라우팅: `action`(create/join/result/cancel) 우선, 없으면 바디 필드 추론(:52-54).
- `handleCreate`(:63-94): `{expected_count(2~6), has_second}` → `{id}` 8자 랜덤(`Math.random`), 3회 충돌 재시도.
- `handleJoin`(:97-337): 존재/취소/정원 검증 + `device_id` 재제출 갱신 + 전순서 기반 오버플로 롤백(:299-332). 가장 정교한 부분.
- `handleResult`(:341-379): `{id, result}` 24KB 제한, rate limit 10/분 2000/일. 소유권 검증 없음(주석 :362-363이 인정).
- `handleCancel`(:385-405): `{id}`만으로 `status='cancelled'`.
- `handleGet`(:408-496): `?id=` → `{expected_count, has_second, result_json, status, members[]}`.
- 테이블: `mint_sessions`, `mint_session_members`, `api_hits`.
- 좌표 NOT NULL 폴백으로 서울시청 좌표를 실제 DB에 기록(:234, 269).

### `api/admin-data.ts` (512줄) POST
- 인증: `body.password === process.env.ADMIN_PASSWORD` 평문 비교(:143). 레이트리밋 없음.
- action: `delete_reservation` / `clear_reservations` / `clear_events` / 기본 `load`.
- `load`: `events` 1000행 × 최대 60페이지 순차 수집(:77-79, 211-227) → 60여 지표 집계 + `reservations` 전건 + `user_feedback` 최근 200건. maxDuration 미지정(10s)이라 데이터 쌓이면 504.
- 프로토타입 오염 방어 있음(:84-116).

### `api/admin-batch.ts` (293줄) GET/POST
- GET = 크론, `Authorization: Bearer $CRON_SECRET`(:256-262) → `runWarmBuzz(POPULAR_REGIONS)`.
- POST = `x-admin-secret: $ADMIN_REFRESH_SECRET`(:267-270) → `warm-buzz | refresh-license`.
- `runWarmBuzz`(:65-103): 18지역 × 3키워드 → 각 8곳 블로그 검색 + `place_buzz_cache` upsert. 50초 예산. 일 약 486 네이버 콜. 뒤쪽 지역은 매일 스킵 가능성.
- `runRefreshLicense`(:153-249): data.go.kr 인허가 → EPSG:5174→WGS84(_lib/coords.ts) → `license_cache` insert. 45초 예산, `done/nextPageNo` 이어받기. 유니크 없어 반복 실행 시 중복 누적.

### `api/pilot-feedback.ts` (434줄) POST
- 어드민 5종(`admin-list`, `admin-prize-upload-url`, `admin-prize-register`, `admin-prize-list`, `admin-prize-void`)은 `requireAdmin`(:101-106, ADMIN_PASSWORD 평문). 401/500 블록이 5회 복붙.
- 유저 2종(`reclaim`, `set-contact`)은 **무인증, 당첨코드만으로 조회/수정. 레이트리밋 없음.** 코드 `MINT-[A-Z0-9]{5}` = 32^5 약 3,350만.
- 기본 = 파일럿 제출 + 즉시 경품: rate limit 5/분 2000/일 + IP당 일 8회 → `pilot_feedback` insert → `claimPrize`(RPC `claim_pilot_prize` 우선, 실패 시 5회 낙관적 UPDATE).
- 스토리지: `pilot-feedback`(public), `pilot-prizes`(private, 서명 URL 600초).
- path traversal은 `validPaths`(:10-17)로 차단.

### `api/feedback.ts` (133줄) POST
- rate limit 12/분 5000/일. id `^fb[a-z0-9]{14}$`, text 1~500 코드포인트, 30초 중복 억제.
- 에러코드별 분기가 가장 성숙: 23505→200, 42P01/42703→`events` 폴백, 23514/22P05/22021→400, 그 외 500.

### `api/share-vote.ts` (99줄) GET/POST
- GET `?id=&type=snapshot` → `mint_share_snapshots.payload`; GET `?id=` → 투표 집계(최대 500행).
- POST snapshot 20KB 제한 + 10/분; POST 투표 `choice` 0~5 + 20/분, `onConflict: 'share_id,voter_id'`.

### `api/reserve.ts` (44줄) POST
- 길이 검증만. **레이트리밋 없음.** `id: Date.now().toString()`(:30) → 동시 제출 PK 충돌 500.

### `api/congestion.ts` (30줄) GET
- `?areas=a,b,c` 최대 5 → 서울 citydata_ppltn. CDN 120초. 현재 클라이언트 호출처 없음.

### `api/count.ts` (23줄)
- 메서드 무검사. `events` where `type='landing_view'` count. CDN 300초. 실패해도 200 `{count:0}`.

## 2. 추천 파이프라인 (recommend.ts:812-1637, 단일 함수 825줄)

1. **진입/검증**(:812-830): enrich 조기 분기 → `validateRecommendBody` → rate limit Promise만 시작(await는 Claude 직전 :1250).
2. **입력 정규화**(:833-918): sessionKey, regionScope 재검증, purpose/genre 라벨, `isQuiet` 3통로 OR, `excludeFoods` → 22개 확장 사전.
3. **후보 소싱 6개 병렬**(:923-941): Open-Meteo / 네이버 1차(`searchNaverMulti` :455-575, 키워드 풀 조합, QPS 회피로 5개/350ms 직렬 배치, balanced는 2개/500ms, 최대 50개) / 네이버 2차(조건부) / data.go.kr 2페이지(페이지당 2.5초 타임아웃) / 혼잡도 / 카카오 반경 보강(dong 2.5km, district 6km).
4. **스코프·편식 필터**(:947-953): `scopePlaces`(주소 토큰 전부 포함, 3개 미만이면 반경 보완) 또는 `filterByRadius`(1.5→3km→전체). `filterExcludedFoods`(전멸하면 포기).
5. **L0 공공데이터 발굴**(:966-1024): 미매칭 상가 → `isStoreAllowedForPurpose` → 실패 시 완화 재시도 → 상위 30곳 `lookupYearsAlive` **30건 동시 Supabase** → `computeLocalGem` 상위 3곳 `_isPublicGem` 주입.
6. **재추천 제외**(:1028-1041): `excludeNames` 부분일치, 3개 이상 남을 때만.
7. **L2 버즈 힌트**(:1047-1060): 캐시 IN 쿼리 1회, TTL 14일. 라이브 호출 없음.
8. **프롬프트 조립**(:1062-1236): 후보 번호 목록 + 모임정보 + 100점 배분표 + 스키마. 노포 가산은 명시 시만(:1155-1167). `hasNaverData`면 주소·좌표·카테고리 제거해 토큰 35% 절감. 파이널리스트 단일 6 / 이중 4×2, 시 전체 12 / 9×2.
9. **LLM 호출**(:1238-1287): `claude-haiku-4-5-20251001`, max_tokens 8192, non-streaming. `_benchModel` + `x-admin-key` 오버라이드. 529만 `claude-sonnet-4-6` 1회 재시도(try/catch 밖). **타임아웃 설정 없음.**
10. **JSON 파싱** `extractPlaces`(:726-765): 그리디 매치 → 실패 시 균형 중괄호 상태머신으로 절단 복구. 견고함. 테스트 0.
11. **할루시네이션 덮어쓰기**(:1294-1338): `sourceIndex` 범위/중복 → 이름 부분매칭 → 미사용 슬롯 → `idx=0` 재사용. 실데이터로 강제 교체.
12. **L1 버즈 점수**(:1341-1353): 캐시만.
13. **L3 재정렬**(:1356-1404): `computeFinalScores`(_lib/scoring.ts:24-58) = fitScore − bubble×0.15 − 괴리8 + gem3 + 키워드3/개(최대9).
14. **최종 선택**(:1406-1445): 이중이면 rank1=1차톱, rank2=2차톱. 시 전체는 `spreadByGu` 라운드로빈(점수순 파괴) + `pickClosePrimaryPair` 2km 내 최적 쌍.
15. **후처리**(:1460-1531): 혼잡도 실측 시만 노출, 도보 haversine, 3차 자동 첨부(`thirdCourseSpec` + 카카오 1.5km/2페이지, 2km 이내 최근접).
16. **L4 로깅**(:1543-1607): 같은 session_key 이전 행 `retried=true` → insert(serial 23505 시 재발급, 42703 시 레거시 폴백).

폴백: 네이버 0건 → 모델 자유생성. 2차 0건 → 단일 모드. L0~L4/thirdStop 개별 try-catch. 파싱 실패만 500.

## 3. 보안 이슈

**심각**
1. `handleEnrich` 완전 무방비(:817). 요청당 카카오 7 + 네이버 이미지 7 = 14콜. 네이버 일일 쿼터(25,000)를 몇 분에 소진 가능 → 정상 추천이 후보 0건으로 붕괴.
2. 레이트리밋 fail-open + 단일 실패점(_lib/guard.ts:31, 46-49). Supabase 장애 = LLM 과금 무제한.
3. recommend 일일 상한이 엔드포인트 전체 합계. IP 하나가 분당 5회로 약 2시간이면 그날 전원 429.
4. 어드민 평문 비밀번호 1개(admin-data.ts:143, pilot-feedback.ts:104). 세션/토큰/만료 없음, 레이트리밋 없음, timing-safe 아님. 이 값으로 예약자 실명·연락처, 피드백 원문, `clear_events`/`clear_reservations` 전체 삭제 가능. 같은 값이 recommend.ts:1242 모델 오버라이드 키로 재사용.
5. 세션 소유권 인증 부재. id(약 40bit, Math.random)만 알면 남의 결과 덮어쓰기·초대 취소.
6. 당첨코드 무인증 열람/수정(pilot-feedback.ts:273-310). reclaim 레이트리밋 없음 → 브루트포스로 남의 기프티콘 서명 URL.

**중간**
7. reserve.ts 레이트리밋 없음 + `Date.now()` PK.
8. security.sql targets에 7월 이후 테이블 없음. 관리 분산(04 문서 참조).
9. 크론 인증 평문 비교.
10. CORS/Origin 검증 없음.
11. 카카오 JS 키 리터럴 2곳.
12. `VITE_KAKAO_REST_API_KEY` 네이밍 사고 대기.

**양호**: `validateRecommendBody`가 배열 길이·문자열 길이·한반도 좌표 박스 검사. SQL 전부 PostgREST 빌더. path traversal 화이트리스트. 프로토타입 오염 방어.

## 4. 코드 품질
- **거대 함수**: recommend 핸들러 825줄, 지역변수 50개 이상. 순수 함수(`spreadByGu`, `pickClosePrimaryPair`, `scopePlaces`, `filterByRadius`, `thirdCourseSpec`, `extractPlaces` 등)가 export 안 되어 테스트 불가.
- **중복**: haversine 2벌(`distMeters` publicData.ts:66-74, `distKm` recommend.ts:67-75). `requireAdmin` 블록 5회 복붙. 랜덤 ID 3벌. `stripSpace`/`namesOverlap` 2벌. 42703 폴백 사슬 session.ts만 6곳.
- **죽은 코드**: `FinalistPlace`의 서버가 안 채우는 필드들. `claude-sonnet-5` 분기 영구 false. `PURPOSE_KEYWORDS['기타']`가 커스텀 경로 못 탐(잠재 버그). `getBubbleScoreCached`는 크론만 사용.
- **타입**: `req.body` any 구조분해. `Record<string, unknown>` 캐스팅 남발. `FinalistPlace extends Record<string, unknown>`으로 오타 통과. :1382 변수 섀도잉.
- **에러 응답 불일치**: count 무조건 200 / congestion 키 없으면 200 / share-vote `{disabled:true}` 200 / reserve 500 / feedback 200-400-500 3분기. 같은 "테이블 없음"에 엔드포인트마다 다름.
- TODO/FIXME 0. 대신 주석이 매우 길고 서술적(사고 과정 기록형). 정보 가치 높으나 드리프트 위험.
- **하드코딩**: purposeGate.ts:8-13 사전이 "실측 검증 안 된 가설"이라 자기 경고. `POPULAR_REGIONS` 18개, `AREA_SEARCH_NAME` 12개, `EXCLUDE_FOOD_EXPANSIONS` 22개, `GENRE_KEYWORDS` 9종.

## 5. 테스트 (5파일 279줄, 전부 _lib 순수 함수)
| 파일 | 대상 | 케이스 |
|---|---|---|
| purposeGate.test.ts | isStoreAllowedForPurpose, classifyStoreGroup | 12 |
| scoring.test.ts | computeFinalScores | 6 |
| blogBuzz.test.ts | computeBubbleScore | 4 |
| publicData.test.ts | computeLocalGem | 5 |
| guard.test.ts | validateRecommendBody | 6 |

미테스트(위험 순): recommend 핸들러 전체 / `extractPlaces` / sourceIndex 해소 3단 폴백(`idx=0` 재사용은 다른 가게로 조용히 바꿔치기) / `checkRateLimit`(경계 `>`라 실제 허용 perMinute+1, fail-open) / handleJoin 동시성 / 파일 내 순수 함수들 / admin-data 집계 / 엔드포인트 통합·인증 경로 0.

## 6. 프로덕션 파손 / 비용 리스크
1. 요청당 LLM 1회 무조건. 캐싱·중복 제거 없음.
2. 529 폴백이 sonnet-4-6으로 조용히 승격. 로그·알림 없음.
3. 상한이 `RECOMMEND_DAILY_CAP ?? 500` 하나인데 Supabase 장애 시 해제. 가장 큰 재무 리스크.
4. 크론 일 약 486 네이버 콜, 50초 예산에 뒤쪽 지역 영구 미스.
5. recommend 60초 안 직렬 체인 길다: 네이버 배치(balanced 약 3.5초) + 429 백오프 최대 3회 + data.go.kr 2.5초 + L0 30건 동시 + LLM + 카카오 3차. 초과 시 504, 사용자에게 메시지 없음.
6. Anthropic SDK 타임아웃·재시도 미설정. 기본 재시도 2회가 60초 안에 일어나면 504.
7. admin-data 60회 순차 왕복, 기본 10초 타임아웃.
8. session 10초 안 handleJoin 최대 6회 왕복.
9. reserve `Date.now()` PK 충돌.
10. enrich 네이버 이미지검색이 지역검색과 같은 쿼터.
11. purposeGate 사전 미검증 → `gatedStores=0` → 완화 모드 → 무필터 또는 0건, 조용히 진행.
12. 시 전체 모드 `spreadByGu`가 점수순 파괴 → rank 3~6이 점수와 무관.

## 함수 2개 통합 + Claude 호출 분리 (2026-09-22, dev 미커밋)

Vercel Hobby 함수 12개 상한 때문에 기획자가 admin-batch·pilot-feedback에서만 action 분기로 땜질하던 것을 원칙으로 바꿨다.

| 함수 파일 | 받는 URL | 넘기는 핸들러 (api/_routes/) |
|---|---|---|
| `api/[...path].ts` (유저) | `/api/recommend` `/api/congestion` `/api/count` `/api/feedback` `/api/pilot-feedback` `/api/reserve` `/api/session` `/api/share-vote` (+ 옛 `/api/session-create/join/get`) — **URL 불변, 클라이언트 무변경** | 같은 이름의 파일 |
| `api/admin/[...path].ts` (어드민) | `/api/admin/batch` (구 admin-batch: 크론 GET + 수동 POST), `/api/admin/data` (구 admin-data) | admin-batch, admin-data |

- 핸들러 본문은 `git mv`로 옮기고 `./_lib` → `../_lib` import만 바꿨다. 분기는 `req.url` 경로로, 모르는 경로는 404. 라이브러리(Hono) 안 씀 — 핸들러가 전부 (req, res) 시그니처라 Web Request/Response로 바꾸지 않는 한 라우터 라이브러리가 끼어들 자리가 없다. Lambda로 갈 때 그 변환과 같이 검토.
- `vercel.json`: `functions`를 `api/**/*.ts` maxDuration 60 하나로(옛 파일별 설정은 파일이 사라져 무효). 크론 경로 `/api/admin/batch`. session-* rewrite는 그대로 두되 라우터에서도 직접 받는다(rewrite 뒤 req.url 형태에 무관하게 동작).
- 클라이언트: `services/admin.ts`의 `/api/admin-data` → `/api/admin/data`만.
- `api/_lib/claude.ts` 신설: 클라이언트 생성(1회 캐시)·기본 모델(haiku-4.5)·529 폴백(sonnet-4-6)·sonnet-5 thinking 비활성·텍스트 추출·잘림 감지를 `askClaude(prompt, opts, client?)` 하나로. recommend는 프롬프트 생성과 `extractPlaces`만 남음. 가짜 클라이언트로 6개 테스트(`claude.test.ts`). 번들 크기는 그대로다 — 목적은 재사용(재설계의 "설명자" 호출)과 테스트.
- 검증: api 타입체크(scratch tsconfig, NodeNext) 0, eslint 0, vitest 84/84, 가짜 req/res로 분기 확인(/api/nope 404, /api/count 200, session-create → session, recommend GET 405, 유저 함수에서 /api/admin/* 404, 어드민 무인증 401).
- **dev 배포 후 확인할 것**: (1) Vercel이 `/api/admin/batch`를 `api/admin/[...path].ts`로 보내는지(중첩 catch-all 우선순위) — 크론 로그와 어드민 화면으로. (2) `functions`의 `api/**/*.ts` 글롭이 빌드에서 거부되지 않는지. (3) 함수 수가 대시보드에서 2개인지.
