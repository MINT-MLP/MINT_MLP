# 13. 모듈화 계획

작성일: 2026-09-17
상태: 0~6단계 완료. 2026-09-17 유저가 dev 브랜치에 커밋·push → mint-mlp-dev.vercel.app에 배포됨. main 미반영
전제: 동작 불변. 리팩터링 커밋에 기능 변경·버그 수정을 섞지 않는다
릴리즈 전략(2026-09-21): **한동안 main 머지 없음.** dev에서 DB 개편 → 알고리즘 개선까지 끝낸 뒤 릴리즈 버전으로 prod에 한 번에. prod 긴급 수정만 main→hotfix 브랜치


## 집에서 바로 할 것

1. **dev 서버 스모크 테스트** — https://mint-mlp-dev.vercel.app 에서 (로컬은 `npm run dev`=granite가 8081을 못 열어 포기함)
   - 추천 결과 화면: 1차·2차·3차 카드, 대안 목록, 인증 뱃지 시트, 총무 팝업, 취향 조절 모달, 거절 3종
   - 카톡 공유 → `/shared?id=` 열기
   - 그룹: 링크 생성 → 다른 탭 `/join` 제출 → 대기 폴링 → 추천 → 게스트 결과(GroupResultView)
   - 결과 화면 새로고침 복원, 처음부터(전체 초기화), 프로필 탭 로그인/로그아웃
   - 로컬 프리뷰로 확인 끝난 것: 스텝 0~4 진행, 추천 요청→에러 복구, 초안 복원, /admin·/join·랜딩·민트샵 렌더 (아래 6단계 참조)
2. 통과하면 `dev → main` 머지 후 push (운영 반영). 문제 있으면 이 노트의 단계별 기록으로 원인 좁히기
3. 그 다음: `sql/schema.sql`을 dev Supabase에서 실행·검증 (04번 노트), 안정화 항목(06번 F절 + 아래 "5단계에서 드러난 lint 위반")
4. **(2026-09-21 추가) 집 PC에 있는 users 전환 SQL을 저장소에 넣기** — 유저 결정: 번호 파일로 나누지 않고 **한 파일에 실행 순서대로 절을 쌓는다**(릴리즈 때 한 번에 실행). 재실행 안전하게(if not exists·drop policy if exists). 내용: public.users 테이블, auth.identities→users 트리거, users RLS(자기 행 update), events·client_errors insert 정책에 authenticated 추가, 익명 유저 정리 크론(있으면). prod 반영 순서: SQL 실행 → Supabase 익명 로그인 활성화 → 배포 (역순이면 analytics가 조용히 멈춤). 넣은 뒤 schema.sql·04번 노트를 mint_profiles→users로 갱신. 3번의 "schema.sql dev 실행" 계획은 팀 결정(도메인별 재구축)으로 대체됨 — schema.sql은 기존 테이블 기준 문서로만
## 현재 상태 (실측)

| 항목 | 값 |
|---|---|
| src | 16,482줄 / 73파일 |
| 타입 정의 | 140개, 25개 파일에 분산. 같은 이름 중복 9종 (`TravelResult` 3곳, `TravelTimeData` 2곳 등) |
| `Home.tsx` | 2,147줄, useState 44, useEffect 14, useCallback 0 |
| 1,000줄 넘는 파일 | Home 2,147 / Admin 1,184 / Landing 1,081 / MemberInput 1,042 |
| 500줄 넘는 컴포넌트 | ResultCard 848 / VibeSelect 617 |
| 경로 alias | 없음 (`../../` 상대 경로) |
| 테스트 | src 2개(midpoint, groupAggregate), api 5개 |
| 기준선 | tsc 통과, eslint 21 에러 1 경고, vitest 통과, vite build 통과 |

## "객체지향"에 대해

React에서 재사용 단위는 클래스가 아니라 **훅 + 순수 함수 모듈 + 컴포넌트**다. 상태와 로직은 커스텀 훅으로, 계산은 순수 함수로, 화면은 컴포넌트로 나눈다. 이 계획의 "모듈화"는 그 뜻이다. 클래스는 상태를 가진 실제 객체가 필요할 때만 쓰는데 이 앱엔 그런 게 없다.

## 목표 구조 (2026-09-17 확정)

논의 끝에 **표준 평면 레이아웃**으로 정했다. `features/`·`shared/`·영역별 하위 폴더·페이지 내 co-location은 전부 기각 — 이 규모에선 폴더 규칙만 늘고, 새 페이지가 기존 컴포넌트를 쓸 때마다 "어디 있지"가 된다.

```
src/
  main.tsx  App.tsx
  pages/          라우트 파일만 — Home, Landing, MemberInput, SharedResult, Admin, Pilot, PilotAdmin, Reserve, AppShell
    mock/         MintShop, Discover, MyMeetings + 목업 전용 시트·데이터(coupons, gems, meetings) — 실개발 후 올린다
  components/     전부 평평하게 + index.ts
  hooks/          평평하게 + index.ts — Home에서 뽑은 5개 포함
  services/       밖과 통신하는 것 전부 — ai, midpoint, travelTime, seoulData, kakaoMap, session, share, admin + supabase, analytics, errorLog, auth, attribution, kakaoLoader, hubSelect(구 utils/hub)
  utils/          순수 함수만 — cn, format, csv, ics, geo, changeNote, treasurer, loadingCopy, vibeOrder, vibeMigrate, groupLink, groupAggregate, fullscreen
  storage/        localStorage를 소유하는 모듈 (2026-09-18 신설) — device, points, history, wishlist, pilotHandoff, treasurerPlan, feedback
  constants/      vibeOptions, hotplaces, certifications/
  types/          평평하게 + index.ts
```

규칙:
- `pages/`는 라우트당 파일 하나. 조립만
- `components/`는 평면. 묶임은 **접두사**로 — `ResultCard`/`ResultPlaceCard`/`ResultAltsSection`/`ResultCertSheet`, `GroupWaiting`/`GroupResultView`/`GuestPlaceCard`, `AdminPasswordGate`/`AdminStatCard`/`AdminBarRow`
- 각 폴더 `index.ts`로 export. import는 `import { ResultCard, VibeSelect } from '@/components'`
- `Props` 인터페이스(20개)는 컴포넌트 파일 안에 그대로
- tsconfig에 `@/` alias

## types/ 구성

| 파일 | 내용 | 현재 위치 |
|---|---|---|
| `place.ts` | Place, PlaceSource, Cert 관련 | ResultCard, ai.ts, certifications/types |
| `recommend.ts` | RecommendInput, RecommendResult, Purpose, Vibe, VibeWeights, Step, Conditions | Home, ai.ts, VibeSelect, PurposeSelect |
| `travel.ts` | TravelResult, TravelTimeData | **3곳 중복** → 1곳 |
| `group.ts` | GroupSession, Member, Phase, MeetingLocation | MemberInput, Home, groupAggregate |
| `feedback.ts` | FeedbackCategory, FeedbackPayload | **2곳 중복** → 1곳 |
| `pilot.ts` | Prize, PilotHandoff, CoursePick, PilotFeedback | **각 2곳 중복** → 1곳 |
| `user.ts` | Profile, ActivityRow | **2곳 중복** → 1곳 |
| `kakao.ts` | Window 확장(카카오 SDK) | 3곳 `declare global` → 1곳 |

`api/`는 tsconfig가 달라 이번엔 건드리지 않는다. 요청/응답 계약 타입을 양쪽이 공유하는 건 다음 단계.

## Home.tsx 분해 설계

state 44개를 실측해 다섯 덩어리로 묶었다.

| 훅 | state | 핸들러·effect |
|---|---|---|
| `useRecommendInput` | locations, purpose, vibe, budget, keywords, conditions, excludeFoods, vibeCustom, meetingLocation, customOccasion, occasionChip, etcRelOpen, groupSize | 입력 영속화 effect(512행) |
| `useRecommendFlow` | view, step, appMode, showRetryModal, showWishlist, showVibeScrollHint, showResultScrollHint, copied | canNext, canNextAt, canJumpTo, handleNext/Back/StepJump, handleFullReset, confirmInvalidateGroupLink, chrome effect(488) |
| `useGroupSession` | sessionId, expectedCount, groupMembers, pendingGroupRecommend, creatingSession, groupError, groupTravelLabels | handleCreateSession, handleCopyLink, handleShareGroupLink, aggregateGroupMembers, requestGroupRecommend, groupShareLink, effect 498/683/692 |
| `useRecommendRequest` | loading, loadingMsg, loadingProgress, error | handleRecommend(190줄), handleRetry, handleAdjust, handleRetryWithWeights, handleReject, handleMidpointSelect, currentExclude, loadingStartRef |
| `useResultState` | result, resultThird, resultThirdLabel, midpointData, resultTravelTimes, resultWeather, treasurer, pointsBalance, changeNote, compromiseMessage, showCompromiseToast | handleShare, applyCompromiseMessage, handleConfirmMeetingLocation, pickTreasurer, 결과 영속화 effect(544/595/653) |

모듈 레벨 함수(86~285행)는 훅 밖으로:
- `getLoadingMessages` → utils/loadingCopy
- `cancelGroupSessionOnServer` → services/session
- `newShareId`, `saveShareSnapshot`, `fallbackShare`, `shareViaKakaoOrFallback` → services/share
- `distMeters`, `refineHubByTransit` → utils/hub
- `buildChangeNote` → utils/changeNote

렌더는 view별 컴포넌트로: `HomeStepsView`(step 0~3 분기), `HomeResultView` → `components/`. 훅 5개는 `hooks/`. 목표: `pages/Home.tsx` 300줄 이하, 훅 조립 + view 분기만.

주의: 훅끼리 의존이 있다(예: request가 input과 result를 읽고 씀). 훅이 서로를 import하지 않고 **Home이 조립하면서 필요한 값과 setter를 넘긴다**. 순환을 만들지 않는다.

## 다른 큰 파일

| 파일 | 분해 |
|---|---|
| `ResultCard` 848 | ResultPlaceCard, ResultAltsSection, ResultCertSheet → components/. TREASURER_RULES/rollTreasurerRule → utils/treasurer |
| `MemberInput` 1,042 | pages/MemberInput(호스트 컨텍스트+폼) / GroupResultView·GuestPlaceCard → components/ / downloadMeetingIcs → utils/ics |
| `Landing` 1,081 | useInstallPrompt → hooks/, LandingPhoneMockup·LandingHeroPhone·LandingKakaoBubble → components/, COMBOS → constants/ |
| `Admin` 1,184 | AdminPasswordGate·AdminStatCard·AdminBarRow·AdminMiniStat·AdminFunnelStep → components/, 포맷 함수 5개 → utils/format, callAdmin → services/admin. 탭별 분리는 **이번엔 안 함**(운영 도구, 우선순위 낮음) |
| `VibeSelect` 617 | GROUPS·CONDITION_OPTIONS·RECOMMENDED_KEYWORDS·BUDGET_OPTIONS → constants/vibeOptions, VibeKeywordTagInput → components/, migrateVibeState → utils/vibeMigrate |
| `Pilot`/`PilotAdmin` | **이동만, 분해 안 함.** 캠페인이 끝났으면 삭제될 코드에 공을 들이지 않는다 |

## 실행 순서

각 단계 끝에 `tsc` + `eslint`(에러 수 21 유지 또는 감소) + `vitest` + `vite build`. 단계당 커밋 하나. dev 브랜치에서 하고 dev 서버로 기획자가 화면을 눌러본다.

| 단계 | 내용 | 위험 |
|---|---|---|
| 0 | 기준선 기록, `@/` alias 추가 | 없음 |
| 1 | `types/` 생성, 중복 9종 통합, import 교체 | 낮음 — 타입만 |
| 2 | 디렉토리 이동(`git mv`) + import 경로 수정. 코드 내용은 한 줄도 안 바뀜 | 낮음 — tsc가 전부 잡음 |
| 3 | 목업 격리 → `pages/mock/` | 낮음 |
| 4 | ResultCard → MemberInput → Landing → VibeSelect → Admin 분해 (각각 커밋) | 중간 — 컴포넌트 경계에서 props 누락 |
| 5 | Home: 모듈 함수 추출 → 훅 5개 순서대로 추출 → view 컴포넌트화 (훅 하나당 커밋) | **높음** — effect 의존성 배열, state 갱신 순서 |
| 6 | 최종: 미사용 export 정리, eslint 에러 중 이동으로 생긴 것 처리 | 낮음 |

5단계는 훅 하나 뽑을 때마다 dev 배포 후 추천 한 번 돌려본다. E2E 테스트가 없어서 사람이 보는 게 유일한 검증이다.

## 건드리지 않는 것

- `api/` — 별도 tsconfig, 이번 범위 밖
- localStorage 키 27종 — 문자열 그대로. 바꾸면 사용자 데이터가 날아간다
- 동작·문구·스타일 — 리팩터링 커밋에 섞지 않는다. 발견한 버그는 노트에 적고 별도 커밋
- eslint 기존 21 에러 — 이동으로 생긴 것만 처리. 나머지는 별건

## 다음 단계와의 연결

- 걷어내기(파일럿, 목업): `pages/mock/` 폴더째 + `Pilot*`·`VisitCert*`·`Cert*` 파일 삭제로 끝난다
- 알고리즘 교체: `services/ai.ts`와 `hooks/useRecommendRequest`만 바꾸면 된다. UI와 분리돼 있어야 이게 가능하다

## 진행 기록

| 단계 | 일자 | 결과 |
|---|---|---|
| 0 | 09-17 | `@/` alias (tsconfig `paths` + vite `resolve.alias`). TS 6에서 `baseUrl`은 deprecated라 안 씀 |
| 1 | 09-17 | `src/types/` 13파일. 도메인 타입 60여 개 이동, 중복 5종 통합(`TravelResult`·`TravelTimeData`·`CoursePick`·`Prize`→`PilotPrize`/`PilotPrizeReward`·`Window`). 43파일 수정, −457/+63. tsc·vitest 52·build 통과 |

1단계 교훈: 타입 블록 삭제는 손으로 old_string 맞추지 말고 스크립트(`stripTypes.js`, 이름으로 찾아 중괄호 짝까지)로. 한 줄 `interface X { … }`를 여러 줄 alias로 오판해 두 파일이 다친 적 있음 — 중괄호가 있으면 무조건 depth 계산으로.
| 2·3 | 09-17 | 이동 20파일(`git mv`), `data/`→`constants/`, `pages/tabs/`→`pages/`·`pages/mock/`, `components/home/`→평면. 목업 전용(MintShop·Discover·MyMeetings + CouponDetailSheet·CouponPurchasePreparingModal·couponNotify + mock 데이터)을 `pages/mock/`로 격리. **src 전체 import를 `@/` 절대경로로**(45파일 198줄), `components/index.ts` 배럴 생성(22모듈). 규칙: components 밖은 배럴, 안은 `@/components/X` 직접(순환 방지). tsc·vitest 52·build 통과, eslint 20/1 |

2단계 교훈: `path.posix.resolve`는 Windows 절대경로를 상대로 취급한다 — `join+normalize`로. 여러 줄 import(`} from '…';`가 별도 줄)는 한 줄 정규식이 못 잡으니 별도 처리.
| 4 | 09-17 | ResultCard 848→524(ResultPlaceCard·ResultAltsSection·ResultCertSheet + utils/treasurer, openPlace·certPrefix→placeCardBits) / MemberInput 1042→636(GroupResultView·GuestPlaceCard + utils/ics) / Landing 1081→959(hooks/useInstallPrompt, Landing* 소품 3개, constants/landing) / VibeSelect 617→389(constants/vibeOptions, utils/vibeOrder·vibeMigrate, VibeKeywordTagInput; PurposeCtx·VibePreset→types) / Admin 1184→1030(Admin* 소품 5개, utils/format·csv, services/admin). 전부 sed 줄 범위 추출 — Read로 확인한 줄 번호 기준. 각각 tsc 0 |
| 5 | 09-17 | **Home 2,113 → 81줄.** 5a: 모듈 함수·상수 → services/share·session, utils/loadingCopy·hub·changeNote·geo, constants/occasion·geo. 5b: 훅 10개 — 1층 상태 훅 5개(`useRecommendFlow`·`useRecommendInput`·`useGroupSession`·`useResultState`·`useRequestState`, 파라미터 없음, `reset()` 제공) + 2층 동작 훅 5개(`useHomePersistence`·`useGroupActions`·`useRecommendActions`·`useStepNavigation`·`useShareResult`, 1층 객체를 받아 같은 이름으로 destructure → 핸들러·effect 본문 무변경). 5f: 렌더 → `HomeResultView`(181)·`HomeStepsView`(556). tsc 0, vitest 52, build 통과 |

### 5단계 설계 메모 (계획과 달라진 점)

- 계획의 "훅 5개"는 실제 코드의 상호 의존 때문에 **상태 훅 5 + 동작 훅 5**로 갈랐다. 핸들러 하나가 세 도메인의 상태를 읽고 쓰는 게 보통이라(예: `handleRecommend`는 입력 11개·그룹 3개·결과 8개·요청 5개를 만진다), 상태와 동작을 한 훅에 두면 훅끼리 순환 참조가 생긴다.
- **복원 `useLayoutEffect` 3개(결과→입력초안→그룹세션)는 선언 순서가 동작에 영향을 준다**(그룹세션 복원이 결과 복원의 view/step을 덮어써야 함). 그래서 흩지 않고 `useHomePersistence` 한 곳에 원래 순서대로 뒀다.
- `pendingGroupRecommend` effect는 그룹 상태를 읽지만 `handleConfirmMeetingLocation`(추천 동작)을 호출하므로 `useRecommendActions`에 뒀다 — 그룹 동작 훅이 추천 동작 훅을 참조하면 순환.
- `handleFullReset`은 각 훅의 `reset()`을 조합해 Home에 남겼다. 원래 setState 32개를 한 핸들러에서 부르던 것과 결과가 같다(배치 렌더).
- 2층 훅은 `result: resultState`로 받아 안에서 `result`(장소 배열)를 다시 꺼낸다. 이름 충돌을 sed 치환으로 풀면 `view === 'result'` 문자열·스냅샷 키·API 필드까지 바뀌어 동작이 깨진다.

### 5단계에서 드러난 기존 lint 위반 (동작 수정이라 안 고침 → 안정화 항목)

기준선 20E/1W → 지금 25E/1W. **에러 +5는 전부 원래 있던 코드**다. 컴파일러 기반 `react-hooks` lint가 2,100줄짜리 Home을 분석 포기(bailout)해서 숨어 있었고, 작아지자 드러났다.
- `react-hooks/refs` ×4, `react-hooks/purity` ×1: 로딩 화면에서 `loadingStartRef.current`·`Date.now()`를 렌더 중에 읽음(Home.tsx), 에러 재시도 버튼에서 `lastRecommendRef.current`를 렌더 중에 읽음(HomeStepsView). 고치려면 ref 대신 state로.
- 훅으로 옮기며 생긴 `exhaustive-deps` 경고 8개는 destructure된 setter·ref를 deps에 명시해 해소(setter는 안정적이라 동작 불변). 무효가 된 `eslint-disable` 5개는 설명 주석으로 전환.
| 6 | 09-17 | 정리: components 안 두 뷰의 배럴 import를 직접 경로로(순환 방지 규칙 준수). **런타임 스모크 테스트** — `vite preview` + Playwright로 `/app` 스텝 0→1→2→3 진행, 추천 요청(로딩→API 404→에러+재시도, 입력 보존), 재진입 시 초안 복원, `/admin`·`/join`·`/` 렌더, 민트샵 목업 탭. React 런타임 에러 0. 콘솔 에러는 카카오 SDK CORS/401(localhost 미등록)과 `/api` 404(백엔드 없음)뿐 |

## 최종 상태 (2026-09-17)

- src 16,908줄 / 133파일 / 폴더 7개(`components hooks pages services utils constants types` + `pages/mock`)
- 500줄 넘는 파일: Admin 1,030 · Landing 959 · MemberInput 636 · Pilot 611 · HomeStepsView 556 · ResultCard 524 (Admin·Landing·Pilot은 계획상 여기까지)
- 검증: tsc 0 · vitest 52/52 · vite build OK · eslint 25E/1W(기준선 20E/1W, +5는 Home의 기존 위반이 드러난 것)
- **미커밋.** dev 브랜치 작업 트리. `git status`로 확인 가능. 커밋 단위 제안: 단계별 6~7개(0+1 / 2·3 / 4 / 5a / 5b / 5f+6) 또는 하나로

## 다음에 할 것

0. **색상 토큰(dev 커밋 589c126) + cn()·tone 리팩토링(미커밋) 완료(09-18)** → [10번 노트](10-color-token-migration.md) 7·8절. dev 테스트 후 둘을 한 번에 prod로. 그 다음 합의된 순서: 서버리스 catch-all 라우터(`api/[...path].ts` + `api/_routes/`)로 함수 슬롯 비우기 → `sql/schema.sql` dev 실행 → 안정화

1. dev에 push → 기획자가 실제 추천까지 눌러보는 스모크 테스트(백엔드 붙은 상태에서 결과 화면·공유·그룹 플로우)
2. 5단계에서 드러난 Home의 ref-in-render 5건 정리(안정화 항목)
3. `placeCardBits.tsx`의 `react-refresh/only-export-components` 7건 — 컴포넌트와 함수를 파일 분리하면 사라짐
4. `utils/geo`·`services/midpoint`·`services/travelTime`에 각자 있는 haversine 통합

## utils 정리 (2026-09-18, 미커밋)

utils 26개가 성격 세 가지의 혼합이었다. 기준을 세워 나눴다. **utils = 순수 함수, services = 밖과 통신, storage = localStorage 소유.**

| 이동 | 파일 |
|---|---|
| utils → services | supabase, analytics, errorLog, auth, attribution, kakaoLoader, hub→**hubSelect**(이름 변경) |
| utils → storage (신설) | history, points, wishlist, pilotHandoff, plan→**treasurerPlan**(이름 변경), feedback |
| 신규 `storage/device.ts` | `getDeviceId`를 points.ts에서 분리. 21개 파일 중 13개가 이것 하나 때문에 포인트 모듈을 import하고 있었다(19곳 import 분리) |

`git mv`로 옮겨 히스토리 유지. import 수정 45파일. tsc 0 · vitest 55 · build OK · eslint 25E/1W 변동 없음. 옛 경로 잔여 0.

남긴 것: `storage/points.ts`의 `haversineMeters`(haversine 4번째 사본 — 안정화 항목에 추가), `services/analytics.ts` 머리의 ALTER 문 주석(schema.sql 반영 여부 대조 필요).
