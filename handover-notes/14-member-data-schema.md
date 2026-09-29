# 14. 회원 데이터 서버 저장 설계 (FS-96 / FS-98)

작성일: 2026-09-22
상태: 설계안. **이 티켓의 우선 범위**(유저 결정 2026-09-22: 이력은 15번으로 보류). 결정 필요 3개 확정 후 단일 SQL 파일에 절로 추가
범위: 기획 티켓 [1-1 BE] "로그인한 사람의 데이터를 서버에 저장할 공간 만들기"와 [1-1 FE] "찜·포인트·지난 추천을 서버에서 불러와 보여주기"

## 1. 전제 (티켓과 다른 점부터)

| 항목 | 티켓 | 이 설계 | 이유 |
|---|---|---|---|
| 비회원 데이터 | 폰에만 저장, 로그인 시 백필(=폰 데이터를 계정으로 옮김) | **비회원은 찜·포인트·인증·이력 자체를 못 한다.** 누르면 카카오 로그인 안내 | 웹은 비회원을 다시 알아볼 열쇠가 없다(iOS 7일 삭제, 인앱/크롬 분리). 지키겠다고 하고 못 지키는 것보다 안 주는 게 낫고, 폰 데이터 이관·충돌 규칙·동기화 표시·정리 크론이 전부 사라진다. 포인트는 저장소 초기화로 무한 적립이 가능해 비회원에게 줄 수 없다 |
| API | GET /api/me/wishlist 등 서버리스 4개 | **서버리스 함수 0개.** 찜·이력은 RLS 걸린 테이블에 클라이언트가 직접 읽고 쓴다. 포인트는 DB 함수(RPC) 하나 | Vercel Hobby 함수 12개 제한(10개 사용 중). RLS로 충분한 곳에 함수를 만들 이유가 없다 |
| 포인트 원장 RLS | select/insert | **insert 금지.** 적립은 DB 함수만 | 클라이언트 insert를 허용하면 유저가 원하는 만큼 자기 포인트를 넣을 수 있다 |
| 지난 추천 "통째로 저장" | JSON으로 저장 | **추천·선택 도메인 테이블(팀 개편 2단계)의 행**. 별도 테이블 없음 | 팀 원칙 "JSON 컬럼 금지". 추천 결과는 어차피 개편 2단계에서 정규화되므로 거기에 user_id만 있으면 이력이다 |
| 폰 데이터 이관(로그인 시 localStorage → 서버) | 로그인 순간 폰 데이터를 계정으로 | 찜만 1회 이관. 포인트는 결정 필요 | 포인트 이관은 클라이언트가 "나 100P 있었어"라고 주장하는 것이라 검증 불가 |

회원 판정: Supabase 세션이 있고 `is_anonymous = false`. 익명 세션은 회원이 아니다(dev의 `isMember`).

## 2. 테이블

전부 `user_id`가 not null이고 `public.users(id)`를 참조한다(auth.users 삭제 → users 삭제 → 여기까지 cascade). 장소 식별은 지금 클라이언트와 같은 `place_key = 이름|주소`. 나중에 `places` 테이블이 생기면 `place_id` 컬럼을 추가하고 place_key는 조인용으로 남긴다.

### 2-1. user_wishlist — 찜

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | bigint identity PK | |
| user_id | uuid not null FK users | 찜한 회원 |
| place_key | text not null | 장소 키(이름\|주소). (user_id, place_key) unique |
| place_name | text not null | 표시용 사본 |
| address | text | 표시·지도 링크용 |
| category | text | |
| lat, lng | double precision | 지도 링크용. 없을 수 있음 |
| rank | text | 어느 슬롯에서 찜했나: first / second / third / candidate |
| source | text | 어느 화면에서: result / shared / discover |
| created_at | timestamptz default now() | |

- 지금 로컬 WishItem과 1:1이라 클라이언트 변경이 작다. rank·source는 로컬엔 없지만 WishlistButton이 이미 갖고 있는 값(analytics로 보내던 것)이라 공짜.
- 로컬은 최대 50개로 잘랐는데 서버는 제한 없음. 화면은 최근순 페이징.
- 삭제는 hard delete. 소프트 삭제가 필요해지면 그때 `deleted_at`.

### 2-2. visit_certification — 방문 인증 (20번 티켓 전제)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | bigint identity PK | |
| user_id | uuid not null FK users | |
| place_key | text not null | (user_id, place_key) unique — 한 장소 1회 |
| place_name | text not null | |
| recommendation_serial | text null | 어느 추천에서 나온 장소인지. 추천 API가 주는 6자 일련번호(클라이언트 localStorage에 있음). 7일 창 검사 근거. 추천 도메인(15번, 보류) 도입 후 candidate_id로 교체 |
| method | text not null check in ('gps','photo') | |
| distance_m | integer | gps일 때 실측 거리 |
| user_lat, user_lng | double precision | 인증 시점 위치 |
| photo_path | text | photo일 때 스토리지 경로(pilot-feedback 버킷 방식과 동일, private) |
| status | text not null default 'approved' check in ('approved','pending','rejected') | photo는 검수 전 pending 가능 |
| created_at | timestamptz default now() | |

### 2-3. point_ledger — 포인트 원장 (append-only)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | bigint identity PK | |
| user_id | uuid not null FK users | |
| delta | integer not null | +적립 / −차감. 0 금지 |
| reason | text not null check in ('visit_cert','coupon_redeem','migrate_local','adjust') | |
| ref_type, ref_id | text, bigint | 근거 행. visit_cert면 visit_certification.id, coupon이면 나중 쿠폰 주문 id |
| memo | text | adjust일 때 운영자 사유 |
| created_at | timestamptz default now() | |

- 잔액 컬럼을 두지 않는다. 잔액은 `select coalesce(sum(delta),0) from point_ledger where user_id = auth.uid()` — 뷰 `point_balance(user_id, balance)`로 제공.
- 원장은 수정·삭제 없음. 잘못 적립은 반대 부호 행(adjust)으로.
- 로컬은 원장 100줄로 자르고 있었는데 서버는 자르지 않는다.

### 2-4. 지난 추천 — 별도 테이블 없음

팀 개편 2단계 "추천·선택 테이블"(조건 전부 + 후보 전부 + 점수)에 `user_id uuid null`을 둔다(비회원 추천도 기록하므로 null 허용, 익명 user id를 넣어도 됨). 회원의 이력 = `where user_id = auth.uid() order by created_at desc`. 결과 화면 재현은 그 행들에서 렌더한다(공유 페이지가 스냅샷에서 렌더하는 것과 같은 방식). 2단계 설계 때 이 요구를 넣는다: **한 추천을 나중에 다시 열 수 있을 만큼의 컬럼**(1·2·3차 장소, 대안, 조건, 지역, 도보 시간).

2단계 전까지의 임시: 없음. 이력 기능은 2단계와 함께 나간다(티켓의 "찜·지난 추천은 먼저 배포해도 된다"는 이력 부분만 2단계로 미룸).

## 3. 접근 제어

원칙: 회원 본인 행만. 익명 세션은 role이 `authenticated`라 `to authenticated`만으로는 못 막는다 — JWT의 `is_anonymous` 클레임까지 본다.

```sql
-- 회원 판정 헬퍼 (JWT 클레임 기반, 테이블 조회 없음)
create or replace function public.is_member() returns boolean
language sql stable as $$
  select auth.uid() is not null
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
$$;
```

| 테이블 | select | insert | update | delete |
|---|---|---|---|---|
| user_wishlist | 본인 | 본인 (user_id = auth.uid() with check) | 없음 | 본인 |
| visit_certification | 본인 | **없음(클라이언트)** — DB 함수만 | 없음 | 없음 |
| point_ledger | 본인 | **없음** — DB 함수만 | 없음 | 없음 |
| point_balance(뷰) | 본인 | | | |

전부 `to authenticated using (public.is_member() and user_id = auth.uid())`.

## 4. 포인트 적립 함수 (RPC)

클라이언트는 `supabase.rpc('credit_visit', {...})`만 부른다. security definer라 RLS를 우회해 두 테이블에 쓰지만, 쓰는 대상은 `auth.uid()`로 못박힌다.

```sql
create or replace function public.credit_visit(
  p_place_key text, p_place_name text, p_method text,
  p_distance_m integer default null, p_user_lat double precision default null, p_user_lng double precision default null,
  p_recommendation_serial text default null
) returns table (certification_id bigint, balance integer)
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_cert_id bigint;
begin
  if not public.is_member() then raise exception 'member_only'; end if;
  if p_method not in ('gps','photo') then raise exception 'bad_method'; end if;
  if p_method = 'gps' and (p_distance_m is null or p_distance_m > 300) then raise exception 'too_far'; end if;
  -- 한 장소 1회 (unique 제약이 최종 방어, 여기선 친절한 에러)
  if exists (select 1 from visit_certification where user_id = v_uid and place_key = p_place_key) then
    raise exception 'already_certified';
  end if;
  insert into visit_certification (user_id, place_key, place_name, recommendation_serial, method, distance_m, user_lat, user_lng)
  values (v_uid, p_place_key, p_place_name, p_recommendation_serial, p_method, p_distance_m, p_user_lat, p_user_lng)
  returning id into v_cert_id;
  insert into point_ledger (user_id, delta, reason, ref_type, ref_id)
  values (v_uid, 500, 'visit_cert', 'visit_certification', v_cert_id);
  return query select v_cert_id, (select coalesce(sum(delta),0)::integer from point_ledger where user_id = v_uid);
end $$;
revoke all on function public.credit_visit from public, anon;
grant execute on function public.credit_visit to authenticated;
```

- 7일 창(추천 후 7일 안에만 인증)은 `p_recommendation_serial`로 recommendation_log.created_at을 찾아 함수 안에서 검사할 수 있다(지금 테이블로 가능). 1차 구현은 클라이언트 검사(지금과 동일), 함수 검사는 후속.
- GPS 위조는 못 막는다. 지금도 못 막고, 막으려면 사진 인증을 pending으로 받아 검수하는 길뿐이다. 함수는 "규칙을 서버가 집행한다"까지가 목표.
- 500은 지금 `VISIT_POINTS` 상수. 나중에 정책이 바뀌면 함수만 고친다(클라이언트는 숫자를 모른다).

## 5. 클라이언트 변경 (FS-98에 해당)

| 지금 | 후 |
|---|---|
| storage/wishlist.ts: localStorage 50개 | 회원이면 user_wishlist select/insert/delete. 비회원이면 버튼 → 로그인 안내 시트 |
| storage/points.ts: balance/ledger/certified 3키 | 회원이면 point_balance 뷰 + point_ledger select. creditVisit → rpc('credit_visit'). 비회원이면 인증 버튼 → 로그인 안내 |
| storage/history.ts: 최근 5개 스냅샷 | 2단계 후 추천 테이블 select. 그 전엔 기존 로컬 유지(회원도) |
| Profile 탭 | 회원: 서버 값. 비회원: "로그인하면 찜·포인트를 어디서나" 안내만 |

낙관적 업데이트(찜 누르면 화면 먼저)는 하되, 실패 시 되돌리고 토스트. 오프라인 복사본은 두지 않는다 — "동기화 안 됨" 상태를 없애는 게 이 설계의 목적이다.

## 6. 기존 폰 데이터 이관 (1회성)

운영 유저 폰에 이미 찜·포인트가 있다. 회원 전용으로 바꾸는 순간 그게 화면에서 사라지면 항의가 온다.

- **찜**: 로그인 직후 1회, 로컬 WishItem을 user_wishlist에 upsert(unique 충돌은 무시). 완료 표시는 users 테이블에 `wishlist_migrated_at`(옛 mint_profiles.backfilled_at과 같은 방식 — 기획자 코드가 이 작업을 backfill이라 불렀다). 클라이언트가 만든 데이터지만 찜은 위조해도 이득이 없어 신뢰해도 된다.
- **포인트**: 결정 필요(아래).
- 이관 코드는 릴리즈 후 한 달쯤 두고 지운다.

## 7. 결정 필요 (기획 합의)

1. **비회원 찜·포인트·인증·이력 제거.** 이 설계 전체의 전제. 결정 로그 초안은 유저가 작성.
2. **기존 폰 포인트의 이관.** 선택지: (a) 이관 안 함 — 운영 유저 수가 적은 지금이 가장 싼 시점. (b) 1회 신뢰 이관, 상한 예: 2,000P — 어뷰징 여지가 있지만 규모가 작음. (c) 인증 기록만 옮기고 포인트는 0에서. 제 추천은 (a) 또는 (c).
3. **사진 인증의 검수 여부.** pending 상태를 둘지, gps만 남길지. 20번 티켓의 범위.

## 8. 단일 SQL 파일에 들어갈 절 (초안)

유저가 준비 중인 한 파일에 "회원 데이터" 절로 붙인다. 재실행 안전.

```sql
-- ═══ 회원 데이터: 찜 · 방문 인증 · 포인트 원장 (2026-09-22 설계, FS-96) ═══
-- 전제: public.users 존재(사용자 절). 비회원은 저장하지 않는다.

create or replace function public.is_member() returns boolean
language sql stable as $$
  select auth.uid() is not null
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
$$;

create table if not exists public.user_wishlist (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.users(id) on delete cascade,
  place_key   text not null,
  place_name  text not null,
  address     text,
  category    text,
  lat         double precision,
  lng         double precision,
  rank        text,
  source      text,
  created_at  timestamptz not null default now(),
  unique (user_id, place_key)
);
comment on table  public.user_wishlist is '회원의 찜한 장소. 비회원은 저장하지 않는다';
comment on column public.user_wishlist.place_key is '장소 키 = 이름|주소. places 테이블 도입 후 place_id로 대체';
comment on column public.user_wishlist.rank is '찜한 슬롯: first/second/third/candidate';
comment on column public.user_wishlist.source is '찜한 화면: result/shared/discover';
create index if not exists idx_user_wishlist_user_created on public.user_wishlist (user_id, created_at desc);

create table if not exists public.visit_certification (
  id                 bigint generated always as identity primary key,
  user_id            uuid not null references public.users(id) on delete cascade,
  place_key          text not null,
  place_name         text not null,
  recommendation_serial text,
  method             text not null check (method in ('gps','photo')),
  distance_m         integer,
  user_lat           double precision,
  user_lng           double precision,
  photo_path         text,
  status             text not null default 'approved' check (status in ('approved','pending','rejected')),
  created_at         timestamptz not null default now(),
  unique (user_id, place_key)
);
comment on table  public.visit_certification is '회원의 방문 인증. 한 장소 1회. 적립은 credit_visit 함수만';
comment on column public.visit_certification.recommendation_serial is '어느 추천에서 나온 장소인지(추천 API 일련번호). 추천 도메인 도입 후 candidate_id로 교체';

create table if not exists public.point_ledger (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.users(id) on delete cascade,
  delta       integer not null check (delta <> 0),
  reason      text not null check (reason in ('visit_cert','coupon_redeem','migrate_local','adjust')),
  ref_type    text,
  ref_id      bigint,
  memo        text,
  created_at  timestamptz not null default now()
);
comment on table  public.point_ledger is '포인트 원장(append-only). 잔액은 point_balance 뷰. 수정·삭제 없이 반대 부호 행으로 정정';
create index if not exists idx_point_ledger_user_created on public.point_ledger (user_id, created_at desc);

create or replace view public.point_balance with (security_invoker = true) as
  select user_id, coalesce(sum(delta), 0)::integer as balance
  from public.point_ledger group by user_id;

-- RLS: 회원 본인 행만. 원장·인증은 클라이언트 insert 금지(함수만)
alter table public.user_wishlist       enable row level security;
alter table public.visit_certification enable row level security;
alter table public.point_ledger        enable row level security;

drop policy if exists user_wishlist_own_select on public.user_wishlist;
create policy user_wishlist_own_select on public.user_wishlist
  for select to authenticated using (public.is_member() and user_id = auth.uid());
drop policy if exists user_wishlist_own_insert on public.user_wishlist;
create policy user_wishlist_own_insert on public.user_wishlist
  for insert to authenticated with check (public.is_member() and user_id = auth.uid());
drop policy if exists user_wishlist_own_delete on public.user_wishlist;
create policy user_wishlist_own_delete on public.user_wishlist
  for delete to authenticated using (public.is_member() and user_id = auth.uid());

drop policy if exists visit_certification_own_select on public.visit_certification;
create policy visit_certification_own_select on public.visit_certification
  for select to authenticated using (public.is_member() and user_id = auth.uid());

drop policy if exists point_ledger_own_select on public.point_ledger;
create policy point_ledger_own_select on public.point_ledger
  for select to authenticated using (public.is_member() and user_id = auth.uid());

-- credit_visit 함수는 4절 본문 그대로
```

검증 쿼리: `select tablename, rowsecurity from pg_tables where tablename in ('user_wishlist','visit_certification','point_ledger')` 전부 true. `select policyname from pg_policies where tablename in (...)` 5개. 익명 세션 토큰으로 `select * from user_wishlist` → 0행, `insert into point_ledger` → 거부.
