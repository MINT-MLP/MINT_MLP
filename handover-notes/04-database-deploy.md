# 04. DB · 보안 · 배포

> **2026-09-30 갱신:** 관리자 배치(`/api/admin/batch`, refresh-license)와 크론은 삭제됐다. 인허가 캐시(license_cache)·버즈 캐시(place_buzz_cache)도 삭제 대상(v2-schema 005). 아래의 배치·크론 설명은 과거 기록이다. 현재 계획은 20번 노트.

## 1. DB 스키마

### 테이블 15개 + 버킷 2개

**supabase/setup.sql** (13커밋, 최종 2026-08-29)

| 테이블 | 라인 | 주요 컬럼 | 인덱스 |
|---|---|---|---|
| `reservations` | :7-15 | id TEXT PK, place_name, address, guest_name, people, arrival_time | PK만 |
| `events` | :18-25 | id BIGSERIAL, type, duration_seconds, session_key, payload JSONB | `idx_events_session_key` |
| `mint_sessions` | :81-87 | id TEXT PK, expected_count, has_second, status, result_json(:227), result_at | PK만 |
| `mint_session_members` | :89-102 | id, session_id FK CASCADE, member_name, location_*, purpose_*, vibe_*, device_id(:236) | `idx_session_member_device` UNIQUE partial, `idx_session_members_order` |
| `place_buzz_cache` | :131-140 | place_key PK, bubble_score, sponsored_ratio, burstiness, recent_spike, revisit_ratio, buzz_count, analyzed_at | 없음 |
| `license_cache` | :148-158 | id, region_code, biz_name, address, lat, lng, license_date, status_code | region, latlng |
| `recommendation_log` | :169-185 | id, session_key, group_size, purpose_*, budget, vibe_*, midpoint_*, candidates JSONB NOT NULL, selected_place_key, retried, shared | created_at, session_key |
| `mint_share_votes` | :197-205 | id, share_id, voter_id, choice, place_name, UNIQUE(share_id, voter_id) | share |
| `mint_share_snapshots` | :215-219 | share_id PK, payload JSONB NOT NULL | created |

**sql/security.sql** (2026-07-04): `api_hits`(:15-20, 인덱스 2개), `client_errors`(:24-31, 인덱스 없음).

**sql/pilot-feedback.sql + pilot-prizes.sql + pilot-serial.sql** (2026-07-09 ~ 07-21)
- `pilot_feedback`: id TEXT PK, recommendation_image_paths/payment_image_paths JSONB, fit_rating CHECK 1..5, fit_text, extra_text, contact. prizes.sql에서 session_key, selections, place_name, claim_code 추가 + partial unique. serial.sql에서 serial, entry_type, rec_snapshot, visited, qa_answers 추가.
- `pilot_prizes`: id, title, tier, image_path, status CHECK(available|assigned|redeemed|void), `assigned_feedback_id text unique`(이중 배정 물리 차단), claim_code, memo.
- `recommendation_log`에 serial, places_display 추가 + partial unique.

**sql/kakao-login.sql + kakao-login-history-sync.sql** (2026-08-03)
- `mint_profiles`: id uuid PK REFERENCES auth.users CASCADE, kakao_id, nickname, avatar_url, device_id, created_at, last_seen_at, backfilled_at.
- `mint_activity_log`: id, user_id FK auth.users CASCADE, device_id, place_name, second_place_name, area_name, purpose_first, group_size, source DEFAULT 'live'. 인덱스 (user_id, created_at desc), backfill dedupe partial unique.

**sql/user-feedback.sql** (2026-08-29)
- `user_feedback`: id TEXT PK(클라 발급, 멱등키), text CHECK 1~500, category CHECK(bug|pain|idea|praise), contact, route, tab, session_key, device_id, user_agent, viewport.

코드에서 참조하는 테이블 16종이 전부 SQL에 정의되어 있어 누락 드리프트는 없다.

### 함수 / 트리거
트리거 0. 함수 2개:
- `claim_pilot_prize(p_feedback_id, p_claim_code)` (pilot-prizes.sql:63-91): `FOR UPDATE SKIP LOCKED`, 멱등. grant/revoke 없음.
- `delete_own_account()` (kakao-login-history-sync.sql:34-46): security definer + `set search_path = ''`, `auth.uid()` 고정, revoke public/anon + grant authenticated. 가장 잘 짜인 부분. Vercel 함수 12개 한도 때문에 DB 함수로 옮김(주석 :28-29).

### RLS 최종 상태 (security.sql을 마지막에 실행했다고 가정)

| 테이블 | RLS | anon | authenticated |
|---|---|---|---|
| `events` | ON | INSERT만 | - |
| `client_errors` | ON | INSERT만 | - |
| `reservations`, `mint_sessions`, `mint_session_members`, `recommendation_log`, `place_buzz_cache`, `license_cache`, `api_hits` | ON | 없음 | - |
| `mint_share_votes`, `mint_share_snapshots` | ON | 없음 | - |
| `pilot_feedback`, `pilot_prizes`, `user_feedback` | ON | 없음(각 파일에서 동적 전삭제) | - |
| `mint_profiles` | ON | 없음 | SELECT/INSERT/UPDATE `auth.uid() = id` |
| `mint_activity_log` | ON | 없음 | SELECT/INSERT `auth.uid() = user_id`. DELETE/UPDATE 의도적 부재 |
| storage `pilot-feedback` | **public=true** | INSERT + SELECT 허용 | - |
| storage `pilot-prizes` | public=false | 정책 전삭제, 서명 URL만 | - |

예외 두 가지:
1. **`pilot-feedback` 버킷 공개 + anon 업로드**(pilot-feedback.sql:31-33, 49-55). 결제 영수증·추천 캡처가 URL만 알면 공개 조회. 주석(:30) "어드민 미리보기 편의".
2. `events`/`client_errors` anon INSERT 무제한. 서버 레이트리밋 우회 경로.

### 마이그레이션 시스템: 없음
- `supabase/migrations/` 없음, CLI 설정 없음, 버전 테이블 없음, 순번 없음.
- 모든 파일 헤더가 "대시보드 SQL Editor에서 실행하세요".
- 실행 순서를 강제하는 것도 문서화한 것도 없음. README는 Vite 템플릿 원문.
- 유일한 힌트: sync.sql:2 "kakao-login.sql 이후 실행", prizes/serial이 pilot_feedback에 `alter table add column`.

### 치명적 드리프트: setup.sql ↔ security.sql

`supabase/setup.sql:34-125`가 `reservations`, `events`, `mint_sessions`, `mint_session_members`에 **anon SELECT/INSERT/DELETE 전면 허용** 정책을 만든다:

```
setup.sql:42-45   "anon read reservations"   FOR SELECT TO anon USING (true)
setup.sql:54-57   "anon delete reservations" FOR DELETE TO anon USING (true)
setup.sql:63-66   "anon read events"         FOR SELECT TO anon USING (true)
setup.sql:75-78   "anon delete events"       FOR DELETE TO anon USING (true)
setup.sql:117     "anon read mint_sessions"         FOR SELECT TO anon
setup.sql:119     "anon insert mint_sessions"       FOR INSERT TO anon
setup.sql:123     "anon read mint_session_members"  FOR SELECT TO anon
setup.sql:125     "anon insert mint_session_members" FOR INSERT TO anon
```

security.sql:36-70이 이걸 동적으로 전부 삭제하고 INSERT 2개만 남긴다. 그런데:
- security.sql 최종 수정 **2026-07-04**.
- setup.sql은 그 뒤로 **4번 더 수정되어 08-29까지** 이어짐(a02e2b0, 9a0ef4c, 5fe5d74, d50ccfb).

"초기 설정" 파일이 살아 있는 패치 파일로 계속 쓰였는데 그 안에 anon 전면 공개 정책이 그대로다. `device_id` 컬럼(:236)이나 `idx_session_members_order`(:241)를 반영하려고 setup.sql을 재실행하는 순간(헤더 :3 "전체 실행"이 그러라고 지시) 7월에 잠근 RLS가 통째로 되돌아가고 멤버 이름·좌표가 anon 키로 열린다.

security.sql 헤더(:4-7)에 v1이 정확히 이 문제로 실패한 기록이 있는데 원인인 setup.sql은 정리되지 않았다.

**부차 드리프트**
- security.sql:40-44 `targets`에 7월 4일 이후 테이블 7개(`mint_share_votes`, `mint_share_snapshots`, `pilot_feedback`, `pilot_prizes`, `user_feedback`, `mint_profiles`, `mint_activity_log`)가 없음. 각자 RLS를 켜서 결과적으로 안전하지만 "한 방 보증"은 깨짐.
- security.sql:56 주석 "+ 강제"라 했지만 `FORCE ROW LEVEL SECURITY`는 안 걸림.
- `license_cache` 유니크 없음 → refresh 반복 시 중복.
- `client_errors` created_at 인덱스 없음.


## 통합 스키마 (2026-09-17)

`sql/schema.sql` 하나가 현재 운영 DB의 최종 상태다. 원본 8개 파일(setup.sql + sql/*.sql)을 실행 순서대로 합쳐 ALTER 24개를 CREATE에 녹였고, 테이블 16·컬럼 142·인덱스 20·정책 9·함수 2를 원본과 기계적으로 대조했다.

- 새 Supabase 프로젝트: 이 파일만 실행
- 기존 프로젝트: 실행해도 안전(if not exists + 정책 전체 교체, 데이터 불변)
- 실행 후 파일 끝 검증 쿼리 4개로 확인

**아직 미커밋·미실행.** dev에서 먼저 돌려 검증 쿼리를 확인한 뒤 커밋할 것. 옛 8개 파일은 그 뒤 `sql/legacy/`로 옮기거나 삭제한다. `setup.sql`의 anon 전면 허용 정책 문제(A절)는 이 파일이 대체하면서 자연히 사라진다.

## 2. 보안 태세 종합

**좋은 점**
- service role 키는 서버에만.
- 어드민 비밀번호 서버 검증(Admin.tsx:5-6 주석에 클라이언트 하드코딩 제거 이력).
- 크론 Bearer, 수동 배치 `x-admin-secret`을 action 파싱 전에 인증.
- 레이트리밋 존재(feedback, pilot-submit, session-result, share-*, recommend 일일 상한).
- 디버그·모델 오버라이드 게이팅.

**약한 점**
1. pilot-feedback 버킷 public.
2. 레이트리밋 fail-open.
3. events/client_errors anon INSERT 무제한.
4. 어드민 로그인 레이트리밋 없음, `!==` 비교.
5. CORS/Origin 검증 없음.
6. `ADMIN_PASSWORD` 단일 값이 3역할 겸직.
7. `claim_pilot_prize` grant/revoke 없음.

## 3. 시크릿 스캔 결과

**실제 유출 1건 (확정)**: 카카오 JavaScript 앱 키가 `src/utils/kakaoLoader.ts:8`, `src/pages/Home.tsx:201`에 하드코딩 폴백. 값 `633de41e...5a7e`(32자 hex). `mint.ait` 안 `web/assets/kakaoLoader-*.js`에도 평문. 카카오 JS 키는 도메인 화이트리스트 공개 키라 치명적이지 않지만 env 로테이션이 무력화되고, 같은 키가 카카오 공유(Kakao.init)에도 쓰여 도메인 제한이 느슨하면 제3자가 MINT 명의로 공유 카드 발송 가능.

**클린**
- `.env` 계열 커밋 이력 0건.
- JWT(`eyJ`) 0건: 워킹트리, repomix, mint.ait 63엔트리 전수.
- `sk-ant-` 0건(히스토리 포함).
- Supabase URL: `placeholder.supabase.co`만. mint.ait는 env 없이 빌드된 것으로 보임.
- 하드코딩 어드민 비밀번호 없음.
- repomix-output.xml: 변수 이름만.

**설계상 노출(의도)**
- `VITE_ODSAY_API_KEY`: travelTime.ts:52-58 브라우저 직접 호출. 유료 키 평문. 커밋 57524e5(07-05)가 이 결정 지점. 가장 실질적 비용 리스크.
- `VITE_KAKAO_REST_API_KEY`, `VITE_SEOUL_DATA_API_KEY`: 현재 서버에서만 읽지만 이름 관례상 지뢰.

## 4. 배포 구조

```
package.json:8         "build": "ait build"        <- Vercel 빌드 커맨드
granite.config.ts:19   outdir: 'dist'
granite.config.ts:13   commands: { dev:'vite dev', build:'vite build' }
vercel.json:2          "outputDirectory": "dist/web"
```

Vercel이 `npm run build` → `ait build` → 내부 `vite build` → `dist/web/`에 웹 산출물 + `.ait` 번들 생성. Vercel은 `dist/web` 서빙. 커밋 d8bc6a7(06-08)이 이 연결 확립.

mint.ait 내부(63엔트리): RN 번들 4종(ios/android × 0.84.0/0.72.6, 각 1.65MB) + 소스맵 4종(3.7~3.8MB) + `web/*` 정적자산 통째. **같은 빌드가 웹과 토스 미니앱 양쪽에 서빙된다.** 단 `src/`에 토스 API 사용 0건, `permissions: []`. granite.config.ts:8 아이콘조차 Vercel 도메인.

**로컬 주의**: 생짜 `vite build`는 `dist/` 루트에 떨어진다. 그대로 Vercel에 나가면 `dist/web` 못 찾아 배포 실패.

**함수 설정**: recommend 60s, admin-batch 60s, session 10s(기본값과 동일). 나머지 7개 기본 10s.
**크론**: `/api/admin/batch`(2026-09-22 경로 변경, 구 /api/admin-batch) `0 18 * * *` UTC = KST 03:00.
**rewrites**: session 3종 → `/api/session`(Hobby 12개 한도 회피, 커밋 8e9a552 "12개를 10개로"), `/(.*)` → index.html.
**region**: icn1.
**함수 수**: 정확히 10개(admin-batch, admin-data, congestion, count, feedback, pilot-feedback, recommend, reserve, session, share-vote). 여유 2.

Hobby 한도가 아키텍처를 지배한 흔적 3곳: 계정 삭제를 DB 함수로(sync.sql:28-29), 5fe5d74(13→12), 8e9a552(12→10).

## 5. 저장소 위생 판정
- **mint.ait**: 97a8fb4(05-20) "add remaining files"로 의도적 커밋. 이후 41커밋에 딸려 갱신(`git add .` 패턴). 누적 blob 290.5MB, .git 82MB의 주원인. 07-16 이후 스테일. 배포 불필요. `.gitignore`에 `*.ait` + 히스토리 정리 대상.
- **repomix-output.xml**: 같은 커밋, 이후 갱신 0. 4개월 묵음. 파일 자체 헤더가 민감 정보 경고. `.gitignore` 대상.
- **.claude/settings.local.json**: 8커밋. 현재 `Bash(*)` 등 전권. 과거 버전에 `C:\Users\HKEDU\mint` 등 절대경로. 추적 해제 대상.

## 6. scripts/*.mjs
전부 수동 실행 개발 보조. package.json에 연결 없음.
- `capture-solo.mjs`(47줄): Playwright + sharp로 `vite preview`를 360×800 DPR2로 띄워 랜딩용 폰 목업 4장 생성. `/api/**` 스텁, 카카오맵 SDK를 가짜로 주입(서교동 고정 좌표).
- `capture-group.mjs`(133줄): 호스트+게스트 7장. 세션 API 통합 후 method+action으로 목킹 분기. 표시된 링크의 `127.0.0.1`을 프로덕션 도메인으로 DOM 치환("마케팅 목업 품질").
- `dump-inds-vocab.mjs`(67줄): purposeGate 업종 사전이 가설임을 명시하고 실제 `indsMclsNm/indsSclsNm` 빈도표를 덤프. 키 절대 미출력. 가장 방법론적으로 정직한 스크립트.
