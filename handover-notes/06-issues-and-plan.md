# 06. 문제점 우선순위와 조치 계획

> **2026-09-30 갱신:** 관리자 배치(`/api/admin/batch`, refresh-license)와 크론은 삭제됐다. 인허가 캐시(license_cache)·버즈 캐시(place_buzz_cache)도 삭제 대상(v2-schema 005). 아래의 배치·크론 설명은 과거 기록이다. 현재 계획은 20번 노트.

## A. 보안: 지금 열려 있는 것

| # | 문제 | 위치 | 영향 |
|---|---|---|---|
| A1 | setup.sql에 anon 전면 허용 정책 잔존. 재실행 한 번이면 RLS 원복 | supabase/setup.sql:34-125 | 예약자 명단, 멤버 이름·좌표가 anon 키로 공개 |
| A2 | 결제 영수증 버킷 public + anon 업로드 | sql/pilot-feedback.sql:31-33, 49-55 | URL 추측으로 영수증 열람, 스팸 업로드 |
| A3 | enrich 분기 검증·레이트리밋 없음 | api/recommend.ts:817, 778-807 | 네이버 쿼터 고갈 → 추천 서비스 붕괴 |
| A4 | 어드민 평문 비밀번호, 레이트리밋 없음, timing-safe 아님 | api/admin-data.ts:143, api/pilot-feedback.ts:104 | 브루트포스 → 개인정보 열람, 전체 삭제 |
| A5 | 당첨코드 reclaim/set-contact 무인증·무제한 | api/pilot-feedback.ts:273-310 | 타인 기프티콘 탈취 |
| A6 | 세션 소유권 검증 없음, id Math.random 40bit | api/session.ts:341, 385, 16-24 | 남의 결과 덮어쓰기, 초대 취소 |
| A7 | ODsay 유료 키 번들 노출 | src/services/travelTime.ts:52-58 | 키 도용 과금 |
| A8 | 카카오 JS 키 리터럴 2곳 | kakaoLoader.ts:8, Home.tsx:201 | env 로테이션 무력화, 공유 카드 사칭 |
| A9 | 지도 핀 HTML 미이스케이프 | src/components/MiniMap.tsx:20-28 | 장소명 통한 마크업 깨짐/XSS 표면 |
| A10 | events/client_errors anon INSERT 무제한 | sql/security.sql:65-70 | DB 쿼터 소모, 레이트리밋 우회 |
| A11 | 프로필·활동로그를 클라이언트가 user_id까지 실어 직접 쓰기 | src/utils/auth.ts:75, 106 | RLS가 유일한 방어선 |
| A12 | .claude/settings.local.json 커밋(전권 허용) | 저장소 루트 | 전임자 로컬 경로 노출, 자동 승인 설정 공유 |
| A13 | `@anthropic-ai/sdk`가 dependencies, `VITE_` 접두사 서버 키 | package.json, env 이름 | 사고 대기 |

## B. 비용: 조용히 새는 곳

| # | 문제 | 위치 |
|---|---|---|
| B1 | 레이트리밋 fail-open. Supabase 장애 = LLM 과금 무제한 | api/_lib/guard.ts:31, 46-49 |
| B2 | 일일 상한이 엔드포인트 전체 합계. IP 하나로 2시간이면 전원 429 | guard.ts:29, recommend.ts:829 |
| B3 | 529 폴백이 sonnet-4-6으로 조용히 승격, 로그 없음 | recommend.ts:1270-1276 |
| B4 | LLM 요청당 1회 무조건, 캐싱 없음 | recommend.ts:1262 |
| B5 | 크론 KST 03:00, 일 약 486 네이버 콜, 50초 예산에 뒤쪽 지역 영구 미스 | api/admin-batch.ts:65-103, vercel.json:33-38 |
| B6 | Anthropic SDK 타임아웃·재시도 미설정 | recommend.ts:1262-1267 |

## C. 안정성: 곧 깨질 것

| # | 문제 | 위치 |
|---|---|---|
| C1 | admin-data 60회 순차 왕복, 기본 10초 타임아웃 | api/admin-data.ts:211-227 |
| C2 | reserve `Date.now()` PK 충돌 | api/reserve.ts:30 |
| C3 | session 10초 안 handleJoin 최대 6회 왕복 | api/session.ts:97-337 |
| C4 | purposeGate 사전 미검증. 게이트 0건이면 조용히 무필터 | api/_lib/purposeGate.ts:8-13 |
| C5 | 시 전체 모드 spreadByGu가 점수순 파괴 | recommend.ts:226-245, 1412-1416 |
| C6 | Home.tsx useLayoutEffect 3개 순서 의존 | src/pages/Home.tsx:450-481 |
| C7 | SQL 실행 순서 미문서화. 42703 폴백 도배 | sql/*, session.ts 6곳 |
| C8 | `PURPOSE_KEYWORDS['기타']`가 커스텀 메뉴 경로 못 탐 | recommend.ts:296, 487 |

## D. 품질: 인수 후 발목

- Home.tsx 2,130줄 / useState 44 / eslint-disable 8. 118커밋 집중.
- recommend.ts 핸들러 825줄 단일 함수. 순수 함수 export 안 됨.
- haversine 6벌, 랜덤 ID 7벌, 드롭다운 3벌, 지도 딥링크 5벌, requireAdmin 5회 복붙.
- 에러 응답 엔드포인트마다 제각각.
- 테스트: 서버 _lib 5파일, 프론트 2파일. 핸들러·JSON 복구·세션 경합·레이트리밋·인증 경로 0.
- 색상 헥스 리터럴 전역, 테마 토큰 없음.
- eslint 21 에러.

## E. 가짜 문 (제품 판단 필요)

- 내 모임 6건, 쿠폰 50종, 원석 8곳: 하드코딩 목업.
- 포인트·찜·방문인증: localStorage만. 기기 초기화 = 소멸. UI는 "500P 적립" 확정 표현.
- 사진 인증: 업로드 안 함.
- 총무 플랜: A/B 가격 실험, 결제 없음.
- 프로필 약관: `alert('준비 중')`.
- 이것들을 살릴지 걷어낼지는 제품 결정. 걷어내면 src 약 1,500줄과 mock 데이터가 사라진다.

## F. 저장소 위생

- mint.ait 8.7MB × 41버전 = .git 82MB. `*.ait` gitignore + 히스토리 정리.
- repomix-output.xml 4개월 스테일.
- README Vite 템플릿 원문.
- api/ 전용 tsconfig 없음(수동 옵션으로 체크 중).

- **기획자의 main 직접 push가 아직 열려 있다.** GitHub 무료 플랜 비공개 저장소에는 브랜치 보호 규칙이 없다. 협업자 권한을 Write 아래로 낮추는 것이 유일한 무료 수단인데, 그러면 dev에도 push를 못 해 fork+PR로 받아야 한다. dev 서버는 갖춰졌으니(08 참조) "dev에서 확인 후 merge"를 사람으로 강제할지 권한으로 강제할지 결정만 남았다.

## 조치 계획 (제안 순서)

### 1주차: 배포 없이 되는 것
1. Supabase 대시보드에서 현재 정책 실측(`select * from pg_policies where schemaname='public'`).
2. setup.sql:34-125 anon 블록 삭제 또는 파일을 `sql/00-initial.sql`로 동결하고 헤더에 "재실행 금지" 명시.
3. security.sql targets 배열에 7월 이후 테이블 7개 추가 후 재실행. `FORCE ROW LEVEL SECURITY` 추가 검토.
4. pilot-feedback 버킷 `public=false` + 서명 URL(pilot-prizes.sql:46-58 패턴 복사).
5. `*.ait`, `repomix-output.xml`, `.claude/settings.local.json`, `handover-notes/` gitignore. 히스토리 정리는 협업자 없는 지금이 적기.
6. README에 env 13개, SQL 실행 순서, 빌드 명령 문서화.

### 2주차: API 구멍
7. enrich에 `validateRecommendBody` 수준 검증 + 레이트리밋.
8. admin-data, pilot-feedback reclaim/set-contact에 레이트리밋. 비밀번호 비교 `crypto.timingSafeEqual`.
9. 세션 result/cancel에 호스트 토큰(create 시 발급) 요구. id를 `crypto.randomBytes`로.
10. guard.ts fail-open을 recommend에서만 fail-closed로.
11. reserve id를 uuid로. 레이트리밋 추가.
12. ~~ODsay를 서버 프록시로 이동 검토~~ → **현행(브라우저 호출) 유지로 결론.** Server 키는 IP 기반이고 Vercel 나가는 IP가 동적이라 불안정하다. 2026-09-17 도메인 등록으로 운영·dev·로컬 전부 동작(08 참조).
13. 카카오 JS 키 리터럴 제거.
14. MiniMap pinContent 이스케이프.

### 3주차 이후: 구조
15. recommend.ts 순수 함수를 `_lib/`로 export + `extractPlaces`, sourceIndex 해소, spreadByGu 테스트.
16. Home.tsx `view/step/appMode`를 reducer로, 그룹 플로우를 별도 컴포넌트로 분리.
17. 에러 응답 규약 통일.
18. 가짜 문 처분 결정.
19. `@anthropic-ai/sdk` devDependencies 이동 또는 lint 규칙으로 src import 차단. `VITE_` 접두사 서버 키 이름 변경.
