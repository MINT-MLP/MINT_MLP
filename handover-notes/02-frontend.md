# 02. 프론트엔드 (src/, 약 16,800줄)

## 1. 라우팅과 화면 지도

### 라우터 (App.tsx:41-72)
`window.location.pathname + search`를 상태로 들고 `popstate`만 구독하는 수제 라우터. `pushState`는 구독하지 않으므로 `utils/fullscreen.ts:24-27`의 `navigateInApp()`이 pushState 후 `dispatchEvent(new PopStateEvent('popstate'))`를 직접 쏴서 강제 리렌더한다.

| path | 컴포넌트 | 비고 |
|---|---|---|
| `/admin` | Admin.tsx | 운영 대시보드 |
| `/pilot-admin` | PilotAdmin.tsx | 파일럿 기프티콘 운영 |
| `/pilot` | Pilot.tsx | 방문 인증 + 룰렛 |
| `/join` | MemberInput.tsx | 그룹 게스트 입력 |
| `/shared` 또는 URL에 `data=` 포함 | SharedResult.tsx | 공유 결과. path가 아니라 문자열 포함 검사(App.tsx:69) |
| `/app` | AppShell.tsx | 5탭 셸 |
| 그 외 | Landing.tsx | |

`/app`·`/join` 진입 시 첫 pointerdown에 전체화면 진입(App.tsx:53-63). ErrorBoundary는 인라인 style(App.tsx:19-25).

### AppShell (AppShell.tsx)
- 탭: `home | meetings | discover | shop | profile`.
- 홈 탭의 콘텐츠는 항상 Home(추천 플로우). 별도 홈 화면 없음.
- 탭바 표시 여부는 각 탭이 `onChromeChange(boolean)`로 셸에 역보고. Home은 `view==='steps' && step===0`일 때만 true(Home.tsx:485-487).
- 탭 상태는 URL에 없음. 탭 전환 시 뒤로가기·링크 공유 불가.
- 카카오 로그인 복귀 판정은 `?tab=profile` 존재 여부. `replaceState('/app' + hash)`로 정리하되 해시는 반드시 보존(implicit flow의 `#access_token` 파싱 전 삭제 시 로그인 붕괴).
- 복귀 시 살아있는 스냅샷이 있으면 `ResumeRecommendSheet`로 이어볼지 질문.

### Home.tsx (2,130줄, 단일 컴포넌트)
`view: 'steps'|'result'|'reserve'` × `step: 0|1|2|3` × `appMode: 'mode-select'|'solo'|'group'` 3축 상태머신.

**Solo 플로우**
- step 0: 모드 선택(혼자/다같이) + 인원수 + 1차/2차 목적(PurposeSelect) (Home.tsx:1686-1784)
- step 1: 관계(친목/데이트/가족/기타) + 2층 '특별한 날' 칩 (1801-1917). 전부 선택사항
- step 2: 지역(MeetingLocationSelect: 자동 중간지점 vs 직접 검색/프리셋) + auto면 LocationInput 출발지 (1920-1931)
- step 3: 분위기(VibeSelect: 프리셋/분위기/취향/조건/예산/키워드/편식) (1978-1991)
- → `handleConfirmMeetingLocation` → `handleMidpointSelect` → `handleRecommend`(187줄, 1023-1209) → `view='result'`

**Group(호스트) 플로우** (같은 step 번호에 다른 화면. 라벨만 `['코스','지역','공유','확정']`로 교체, 1503)
- step 0: 참여 인원(2~6) + 코스 선점
- step 1: 지역 확정
- step 2: `POST /api/session {action:'create'}` → sessionId 발급(704-728) → GroupWaiting(링크 복사/카톡 공유/3초 폴링). 호스트도 자기 링크로 게스트 자가참여 가능(GroupWaiting.tsx:55-60)
- step 3: 집계 요약(읽기 전용)
- 2명 이상 모이면 `requestGroupRecommend()` → `aggregateGroupMembers()` → `setPendingGroupRecommend(true)` → 다음 렌더의 effect에서 추천 발화(stale closure 회피, 684-690)

**Guest 플로우** (MemberInput.tsx)
- phase `step0`(이름+출발지) → `step1`(VibeSelect mood) → `step2`(extras) → `done`
- 링크 쿼리에서 호스트 컨텍스트 복원(groupLink.ts `decodeHostContext`). `regionType==='manual'`이면 출발지 입력 자체를 숨김(:90)
- 제출 = 참석 확정. 별도 RSVP 없음(:110-112, 279)
- done 화면에서 3초 폴링 → `result_json` 도착 시 `GroupResultView`(:697-958). 결과 도착 후 폴링 중단, 탭 복귀 시 1회만(:183)
- 호스트 기기 판별: `mint_group_session_v1`의 sessionId 일치(:330-335) → `/app?grp=<id>` 복귀 CTA
- 호스트가 취소하면 `status==='cancelled'` 수신 → 대기 중단(:164, 350-359)

**스텝 이동**: 전부 Home 로컬 state. `canJumpTo`(뒤로 자유, solo만 앞으로, group forward 금지, 803-811). 그룹에서 링크 생성 후 step<2로 내려가면 `window.confirm` + `cancelGroupSessionOnServer`(791-799, 127-133).

### 나머지 화면
- **SharedResult**: `/shared?id=`(신규, 서버 스냅샷) / `?data=`(레거시, URL JSON). 1·2·3차 카드 + 투표(`/api/share-vote`, 기기당 1표 `mint_vote_${shareId}`, 낙관적 업데이트).
- **Reserve**: Home의 `view='reserve'`. MintShop에서도 재사용. 캐치테이블/네이버/카카오맵 딥링크 + "관심표시" 원탭 수요조사(`guestName:'관심표시'` 더미 POST).
- **Pilot**: handoff 자동 감지 → 인증 폼 → 룰렛(꽝 확률 0%, Pilot.tsx:428-476) → 리워드/품절/재수령.
- **Admin / PilotAdmin**: 비밀번호를 매 요청 body에 실어 서버가 검증.

## 2. 상태 관리와 영속화

### useState 난립
전역 스토어·Context 0개.

| 파일 | useState |
|---|---|
| Home.tsx | 44 (+ useRef 8, useEffect 12) |
| Pilot.tsx | 29 |
| MemberInput.tsx | 26 |
| PilotAdmin.tsx | 14 |
| Profile.tsx | 13 |

### localStorage 키 27종

| 키 | 정의 | 내용 / TTL |
|---|---|---|
| `mint_last_result_v1` | history.ts:5 | 결과 스냅샷, TTL 24h |
| `mint_history_v1` | history.ts:6 | 지난 추천 최대 5건 |
| `mint_input_draft_v1` | history.ts:11 | 입력 초안, TTL 6h |
| `mint_group_session_v1` | history.ts:12 | 호스트 세션 `{sessionId, expectedCount, purpose, meetingLocation}`, TTL 6h |
| `mint_device_id` | points.ts:5 | crypto.randomUUID |
| `mint_points_balance` | points.ts:6 | 포인트 잔액 |
| `mint_points_ledger` | points.ts:7 | 적립 원장 최대 100건 |
| `mint_certified_places` | points.ts:8 | 방문 인증 place_key 배열 |
| `mint_wishlist` | wishlist.ts:7 | 찜 최대 100건 |
| `mint_coupon_notify_v1` | couponNotify.ts:4 | 쿠폰 알림 신청 id |
| `mint_plan_frame` | plan.ts:5 | 가격 A/B 프레임(device_id 끝자리 짝/홀) |
| `mint_plan_preregistered` | plan.ts:6 | 총무 플랜 사전등록 |
| `mint_attr_v1` | attribution.ts:17 | 유입 어트리뷰션, TTL 30일 |
| `mint_tracking_paused` | analytics.ts:59 | 어드민 추적 일시정지 |
| `mint_feedback_draft` | feedback.ts:10 | 피드백 초안, TTL 24h |
| `mint_feedback_outbox` | feedback.ts:11 | 미전송 피드백 큐 최대 50 |
| `mint_feedback_opened` | FeedbackFab.tsx:12 | 넛지 영구 중단 |
| `mint_feedback_nudge_count` | FeedbackFab.tsx:15 | 누적 넛지 노출 최대 5 |
| `mint_pilot_handoff_v1` | pilotHandoff.ts:26 | 파일럿 핸드오프 최대 3건, TTL 14일 |
| `mint_backfill_hint_v1` | auth.ts:178 | 계정 백필 완료 힌트 |
| `mint_ios_install_guide_seen_v1` | Landing.tsx:13 | iOS 설치 안내 1회 |
| `mint_visit_count` | Landing.tsx:147 | `/api/count` 캐시 |
| `mint_voter_id` | SharedResult.tsx:48 | 익명 투표자 ID |
| `mint_joined_${sessionId}` | MemberInput.tsx:139,277 | 그룹 제출 완료 |
| `mint_guest_ctx_${sessionId}` | MemberInput.tsx:141,301 | 게스트 개인 컨텍스트 |
| `mint_rsvp_${sessionId}` | MemberInput.tsx:287 | 'going' |
| `mint_vote_${shareId}` | SharedResult.tsx:66,95 | 내 투표 인덱스 |

`_v1` 접미사가 있는 것과 없는 것이 섞여 있고 GC 로직이 키마다 제각각.

### sessionStorage
`mintSessionStart`(Home.tsx:369, 유일한 camelCase), `mint_entry_seen`(attribution.ts:18), `mint_feedback_nudge_session`(FeedbackFab.tsx:16), `mint_kakao_escaped`(index.html:37). 구버전 마이그레이션용 읽기 폴백 다수.

### URL 파라미터
- `/join?id=&c1&g1&c2&g2&rel&occ&rt&rn&ri&rsvp_by=` (groupLink.ts:18-31): 호스트 컨텍스트를 서버 스키마 변경 없이 쿼리로 전달. rsvp 마감도 링크에만.
- `/app?grp=<sessionId>`: 호스트 복귀 자동 추천 트리거(Home.tsx:693-702). 발화 후 replaceState로 소거.
- `/app?tab=profile`: 카카오 로그인 복귀.
- `/app?ref=grp`: 게스트 결과의 신규 유입 CTA(MemberInput.tsx:940). 읽는 코드 없음(dead).
- `/shared?id=` / `?data=`.
- `?utm_*`, `?fbclid`, `?gclid`, `?from=kakao` (attribution.ts:103-125).

## 3. 클라이언트 데이터 계층

### /api 호출처

| 엔드포인트 | 호출 위치 |
|---|---|
| `POST /api/recommend` | services/ai.ts:72 (추천), :113 (`stage:'enrich'`) |
| `POST/GET /api/session` | Home.tsx:128(cancel), :588(result), :661(폴링), :709(create) / MemberInput.tsx:159(폴링), :242(join) |
| `POST/GET /api/share-vote` | Home.tsx:150(snapshot, 1.5s AbortController) / SharedResult.tsx:75, :96, :168 |
| `GET /api/congestion` | services/seoulData.ts:16. 호출처 없음(dead). 혼잡도는 서버 파이프라인으로 이관됨 |
| `GET /api/count` | Landing.tsx:150 |
| `POST /api/reserve` | Reserve.tsx:26 |
| `POST /api/feedback` | feedback.ts:179, sendBeacon :239 |
| `POST /api/pilot-feedback` | Pilot.tsx:80/487/535/571, PilotAdmin.tsx:41 |
| `POST /api/admin/data` (2026-09-22 함수 통합으로 경로 변경, 구 /api/admin-data) | services/admin.ts |

### 브라우저 직결 Supabase (anon key)
`utils/supabase.ts:3-6`. 폴백이 `'placeholder'` 문자열이라 env 없으면 조용히 깨진다.

| 대상 | 동작 | 위치 |
|---|---|---|
| `events` | INSERT (익명) | analytics.ts:119, :132 |
| `client_errors` | INSERT | errorLog.ts:18-23 |
| `mint_profiles` | UPSERT / SELECT / UPDATE | auth.ts:75, :191-195, :225-228 |
| `mint_activity_log` | INSERT / SELECT | auth.ts:106, :158-166, :206 |
| RPC `delete_own_account` | 계정 삭제 | auth.ts:251 |
| Storage `pilot-feedback` | 결제 인증 이미지 익명 업로드 | Pilot.tsx:39-42 |
| Storage `pilot-prizes` | 서명 URL 업로드 | PilotAdmin.tsx:288 |

`events`/`client_errors` anon INSERT는 무제한이라 서버 레이트리밋(`api_hits`)을 우회하는 경로다. Admin.tsx:5-6 주석은 "anon 직접 select는 제거됨"이라 하지만 write path는 그대로다.

### 카카오 SDK
- 지도/검색: `utils/kakaoLoader.ts:12-38` 동적 주입. 랜딩 방문자는 안 받도록 지연.
- 공유: index.html:74에서 `kakao.min.js` 2.7.4 defer.
- 키 하드코딩: `import.meta.env.VITE_KAKAO_JS_API_KEY ?? '633de41e...5a7e'`가 kakaoLoader.ts:8과 Home.tsx:201 두 곳에 복붙.
- `searchRegions`(kakaoMap.ts:243-323)는 주소 파싱·후보 생성·랭킹을 전부 클라이언트에서. 캐시 `Map` 2개가 메모리 무한 증가.

### 브라우저 → 외부 직접 호출
- **ODsay**: travelTime.ts:58 `apiKey=${VITE_ODSAY_API_KEY}`. 유료 키가 번들에 노출. 실패 시 직선거리 폴백이라 키가 죽어도 아무도 모른다.
- GTM, 카카오 CDN, Supabase, map.kakao.com / map.naver.com / app.catchtable.co.kr 딥링크.

### ai.ts가 Anthropic을 브라우저에서 부르는가
아니오. `fetch('/api/recommend')`만 한다. src 전체에 `@anthropic-ai/sdk` import 0건. 다만 dependencies에 있어 실수 한 번이면 번들에 들어간다. ai.ts:87에 프로덕션 `console.log('[recommend] debug', ...)` 잔존.

## 4. 인증 (utils/auth.ts)
- Supabase 카카오 OAuth(auth.ts:25-38). `redirectTo: ${origin}/app?tab=profile`, scope `profile_nickname profile_image account_email`.
- supabase-js v2 기본값이라 세션 JWT는 localStorage(`sb-<ref>-auth-token`), flowType implicit이라 토큰이 `#access_token=`으로 돌아온다.
- 클라이언트가 `user_metadata`에서 닉네임/아바타를 `pick()`으로 훑고, kakao_id를 `provider_id ?? sub ?? kakao_id ?? id ?? identities[0].id`로 추정해 `mint_profiles`에 upsert. **프로필 내용을 클라이언트가 그대로 써 넣는다.** RLS `auth.uid() = id`가 유일한 방어선.
- 활동 로그도 클라이언트가 `user_id`를 본문에 실어 직접 INSERT(auth.ts:106-114).
- 탈퇴는 Vercel 함수 한도 때문에 DB RPC `delete_own_account`.
- 로그인은 순수 선택. 비로그인에서도 전부 동작. 로그인해도 찜·포인트는 로컬에 남는다(Profile.tsx:169가 고지).

## 5. 목업 / 가짜 문 인벤토리

### 완전 목업 (서버 없음)
| 항목 | 파일 | 내용 |
|---|---|---|
| 내 모임 카드 6건 | data/mock/meetings.ts | 날짜만 `nextFriday()` 기준 동적. 응답 현황 진행바도 목업 |
| 민트샵 쿠폰 50종 | data/mock/coupons.ts | 상호 전부 가상. 주소/영업시간/평점은 id에서 결정적 파생. 교환 기능 없음 |
| 오늘의 원석 8곳 | data/mock/gems.ts | 실존 가게 이름·주소지만 좌표 전부 null |

### 반쪽 실물 (UI+계측은 진짜, 백엔드 없음)
| 항목 | 실제 | 가짜 |
|---|---|---|
| 포인트/방문 인증 | localStorage 적립, GPS 300m 검증, events 로그 | 서버 원장 없음. 사진은 업로드 안 하고 선택 사실만 기록 |
| 민트샵 알림 신청 | localStorage + 이벤트 | 포인트 차감 없음. "구매하기"는 준비중 모달 고정 |
| 찜(발굴) | localStorage + events | 서버 동기화 없음 |
| 총무 플랜 | A/B 가격 프레임, 사전등록, dwell 계측 | 결제·기능 전무. 4항목 중 2개 `live:false` |
| 오늘의 총무 | 출발지 기반 랜덤 추첨 | 출발지 없으면 5종 랜덤 문구 |
| 예약 | 딥링크는 진짜 | "MINT에서 바로 예약"은 수요조사 더미 POST |
| 프로필 설정 | 없음 | 토글 전부 로컬 state. 약관은 `alert('준비 중')`. 랜딩에는 실제 방침 모달이 있는데 앱 내부는 alert |

### 인증(Certification) 데이터: 진짜
`data/certifications/`: 미쉐린 15건, 우슐랭(부산 공식 가이드), 백년가게(정부 명단), 착한가격(entries 빈 배열, 뱃지 미노출). 매칭은 이름 완전일치 AND 시도 AND 구군 3중 게이트(match.ts:52-70).

## 6. 코드 품질

### 거대 컴포넌트
- Home.tsx 2,130줄. 라우팅·폴링·공유·추천 오케스트레이션·4스텝 JSX 전부.
- Admin.tsx 1,184줄, Landing.tsx 1,081줄(하드코딩 마케팅 JSX), MemberInput.tsx 1,042줄(페이지 + GroupResultView + GuestPlaceCard + ics 생성기).

### 중복
| 중복 | 위치 |
|---|---|
| haversine 4벌 | midpoint.ts:7, travelTime.ts:20, points.ts:41, Home.tsx:216 |
| SuggestionDropdown 포털 3벌 | LocationInput.tsx:27-56, MemberInput.tsx:25-54, MeetingLocationSelect.tsx:53-86 |
| 카카오 JS 키 리터럴 2벌 | kakaoLoader.ts:8, Home.tsx:201 |
| formatDate | Admin.tsx:241, PilotAdmin.tsx:47 |
| groupByCourse/groupCourses | Pilot.tsx:411, PilotAdmin.tsx:392 |
| 장소 카드 | ResultCard `PlaceCard` vs MemberInput `GuestPlaceCard` |
| TravelResult 타입 재선언 | travelTime.ts, Home.tsx, ResultCard.tsx |
| 지도 딥링크 빌더 5벌 | placeCardBits, wishlist, Home, SharedResult, MemberInput |
| makeId 32자 문자셋 4벌 | Home.tsx:136, feedback.ts:72, Pilot.tsx:21, SharedResult.tsx:51 |

### Prop drilling
`onChromeChange`가 AppShell → 탭 → PointsBadge까지 3~4단계. ResultCard prop 17개.

### 이펙트 오용
- eslint-disable 10건 중 8건이 Home.tsx.
- 마운트 시 localStorage 복원을 useLayoutEffect 3개로 나누고 세 번째가 앞 둘을 덮어쓰는 순서 의존(Home.tsx:469 주석).
- MiniMap.tsx:109 의존성에 `JSON.stringify(pins)`.
- LocationInput.tsx:123-128 effect에서 `onChange(selected)` → 부모 setState 루프 위험.
- Home.tsx:515-542 스냅샷 저장 effect 의존성 15개.
- 폴링 3종이 각자 `active` 플래그 + visibilitychange 복붙.
- Home.tsx:1424 렌더 본문에서 `Date.now()` 읽음.

### 스타일
- Tailwind 기본에 인라인 style 상시 혼재.
- **MiniMap.tsx:20-28 `pinContent`가 `pin.name`을 이스케이프 없이 HTML 템플릿에 주입.** 장소명은 외부(AI/네이버) 데이터.
- 색상 헥스(`#3CDBC0`, `#2AB5A0`, `#1A7A6E`, `#0F4E46` 등) 수십 파일에 리터럴. tailwind.config.js 테마 토큰 없음. 어드민만 `#36CFA0`으로 다른 민트색.

### 접근성
- 잘한 것: aria-pressed, aria-current, role=switch, role=progressbar, aria-live, role=dialog+aria-modal, FeedbackSheet 포커스 복원.
- 문제: `role="link"+window.open` 가짜 링크, 바텀시트 대부분 ESC·포커스 트랩 없음, `window.confirm/alert` 남발, `user-scalable=no`, 의미 이모지에 aria-hidden 없음, h1 중복.

### 하드코딩 / 로그 / TODO
- vercel 도메인: index.html:17,20,27(OG), granite.config.ts:8(아이콘). src 안은 `window.location.origin`.
- console: ai.ts:87 1건.
- TODO 3건(certifications 확장). FIXME/HACK 0.
- any 3건(전부 카카오 SDK 타입).
- 오픈채팅 URL Profile.tsx:14, GTM ID index.html:66.

### Dead code
- seoulData.ts `getMultiAreaCongestion`·`congestionColor`
- kakaoMap.ts:78-90 `searchNeighborhoods`
- groupAggregate.ts:64-84 `aggregatePurpose`(테스트만)
- `PurposeValue.firstGenre/secondGenre` 항상 null인데 분기 잔존
- `/app?ref=grp` 파라미터
- `getAIRecommendation`의 `congestionData` 인자 항상 `[]`

## 7. 테스트
- `midpoint.test.ts` 9건: findBalancedAreas 폴백, 중점, 일직선 NaN 방지, 150km 타협 메시지, 빈 구간 스냅, 수도권 스냅 금지 회귀.
- `groupAggregate.test.ts` 7건: splitMemberKeywords, 단일 멤버 크래시 방지, aggregateVibe 1차/2차 분리.
- 공백: aggregateVibe 동점 처리, roundRobin 공정성, kakaoMap parseAddr/scoreCand(300줄 순수함수), certifications match 3중 게이트, parseOpenStatus 자정 넘김, history TTL/마이그레이션, attribution first/last-touch, feedback 코드포인트 slice. 컴포넌트/훅 테스트 0.

## 8. Apps-in-Toss
src 전체에 `@apps-in-toss/web-framework` import 0건. granite.config.ts는 `commands: {dev:'vite dev', build:'vite build'}`, `permissions: []`. 토스 로그인/결제/공유/푸시/광고 사용 0.

반대로 토스 웹뷰와 충돌 가능한 웹 전용 코드가 많다: 서비스워커(index.html:77-81), `beforeinstallprompt` PWA 설치(Landing.tsx:20-86), `requestFullscreen`(fullscreen.ts:6), `kakaotalk://web/openExternal` 탈출(index.html:41), GTM.

결론: 순수 웹앱을 granite로 감싼 것. 미니앱 고유 기능은 하나도 연결되어 있지 않다.
