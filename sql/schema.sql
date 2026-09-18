-- ═══════════════════════════════════════════════════════════════════════════
-- MINT 통합 스키마 — 현재 운영 DB의 최종 상태를 한 파일로 표현한다
--
-- 작성: 2026-09-17
-- 출처: supabase/setup.sql + sql/*.sql 8개 파일(2026-06 ~ 2026-08)을 실행 순서대로 합쳐
--       ALTER TABLE ADD COLUMN 24개와 NOT NULL 완화, 정책 교체를 CREATE 문에 반영했다.
--
-- 용도
--   새 Supabase 프로젝트: 이 파일 하나만 실행하면 운영과 같은 스키마가 된다.
--   기존 프로젝트:         실행해도 안전하다. 테이블·인덱스는 if not exists, 정책은
--                          이름과 무관하게 전부 지우고 같은 세트로 다시 만든다. 데이터는 건드리지 않는다.
--
-- 이 파일이 만드는 것
--   테이블 16개, 인덱스 20개, 함수 2개, 스토리지 버킷 2개, RLS 정책 9개(테이블 7 + 스토리지 2)
--
-- 접근 모델
--   브라우저(anon)가 직접 만지는 테이블은 events·client_errors의 insert뿐이다.
--   로그인 사용자(authenticated)는 mint_profiles·mint_activity_log의 자기 행만.
--   나머지는 전부 서버리스 함수(service role, RLS 우회)만 접근한다.
--
-- 실행 후 맨 아래 검증 쿼리 결과를 확인할 것.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. 추천 파이프라인
-- ───────────────────────────────────────────────────────────────────────────

-- 추천 1회의 입력 조건과 후보 전체. 서버 전용.
-- candidates: 후보 배열 JSONB. places_display: 사람이 읽는 추천 장소 스냅샷(파일럿 연동).
-- serial: 파일럿 일련번호. pilot_feedback.serial과 조인.
create table if not exists public.recommendation_log (
  id                  bigserial primary key,
  session_key         text,
  created_at          timestamptz default now(),
  group_size          integer,
  purpose_first       text,
  purpose_second      text,
  budget              text,
  vibe_first          text,
  vibe_second         text,
  midpoint_lat        double precision,
  midpoint_lng        double precision,
  candidates          jsonb not null,
  selected_place_key  text,
  retried             boolean default false,
  shared              boolean default false,
  serial              text,
  places_display      jsonb
);
create index if not exists idx_recommendation_log_created_at on public.recommendation_log (created_at);
create index if not exists idx_recommendation_log_session_key on public.recommendation_log (session_key);
create unique index if not exists recommendation_log_serial_key
  on public.recommendation_log (serial) where serial is not null;

-- 네이버 블로그 분석 결과 캐시("거품 점수"). TTL 14일은 코드에서 analyzed_at으로 판정.
-- place_key = sha1(정규화(이름)|정규화(주소)). api/_lib/placeKey.ts.
-- 야간 크론(api/admin-batch GET)이 채우고, 추천은 읽기만 한다. 서버 전용.
create table if not exists public.place_buzz_cache (
  place_key       text primary key,
  bubble_score    double precision not null,
  sponsored_ratio double precision,
  burstiness      double precision,
  recent_spike    double precision,
  revisit_ratio   double precision,
  buzz_count      integer,
  analyzed_at     timestamptz default now()
);

-- 행안부 일반음식점 인허가 데이터. 영업연차 계산용. 월 1회 수동 적재(admin-batch POST refresh-license).
-- region_code는 LOCALDATA 7자리(예: 3220000=강남구). 좌표는 WGS84 변환 완료 값만. 서버 전용.
create table if not exists public.license_cache (
  id            bigserial primary key,
  region_code   text not null,
  biz_name      text not null,
  address       text,
  lat           double precision,
  lng           double precision,
  license_date  date,
  status_code   text,
  updated_at    timestamptz default now()
);
create index if not exists idx_license_cache_region on public.license_cache (region_code);
create index if not exists idx_license_cache_latlng on public.license_cache (lat, lng);


-- ───────────────────────────────────────────────────────────────────────────
-- 2. 그룹 약속
-- ───────────────────────────────────────────────────────────────────────────

-- 그룹 세션. result_json/result_at은 호스트 결과를 게스트가 폴링으로 받기 위한 것. 서버 전용.
create table if not exists public.mint_sessions (
  id              text primary key,
  expected_count  integer not null default 2,
  has_second      boolean not null default false,
  status          text not null default 'waiting',
  created_at      timestamptz default now(),
  result_json     jsonb,
  result_at       timestamptz
);

-- 참여자별 출발지와 취향. 임의 지역 모드 게스트는 출발지를 입력하지 않으므로 좌표는 nullable.
-- device_id: 같은 기기의 재제출을 새 자리가 아니라 갱신으로 처리. 서버 전용.
create table if not exists public.mint_session_members (
  id               bigserial primary key,
  session_id       text not null references public.mint_sessions (id) on delete cascade,
  member_name      text not null,
  location_name    text,
  location_lat     double precision,
  location_lng     double precision,
  purpose_first    text,
  purpose_second   text,
  vibe_atmosphere  text,
  vibe_budget      text,
  vibe_keywords    text,
  submitted_at     timestamptz default now(),
  device_id        text
);
-- 부분 유니크인 이유: 구 번들 게스트는 device_id를 보내지 않아 NULL 행이 여럿 생기는데,
-- 전체 유니크로 걸면 그들끼리 충돌해 제출이 막힌다.
create unique index if not exists idx_session_member_device
  on public.mint_session_members (session_id, device_id) where device_id is not null;
-- 정원 경합·초대 링크 취소 판정
create index if not exists idx_session_members_order
  on public.mint_session_members (session_id, submitted_at, id);


-- ───────────────────────────────────────────────────────────────────────────
-- 3. 공유·투표
-- ───────────────────────────────────────────────────────────────────────────

-- 공유 링크(/shared?id=)로 여는 결과 페이지의 렌더 데이터 동결. 서버 전용.
create table if not exists public.mint_share_snapshots (
  share_id    text primary key,
  payload     jsonb not null,
  created_at  timestamptz default now()
);
create index if not exists idx_share_snapshots_created on public.mint_share_snapshots (created_at);

-- 공유 페이지 멤버 투표. (share_id, voter_id) 유니크로 중복 투표 차단. 서버 전용.
create table if not exists public.mint_share_votes (
  id          bigserial primary key,
  share_id    text not null,
  voter_id    text not null,
  choice      integer not null,
  place_name  text,
  created_at  timestamptz default now(),
  unique (share_id, voter_id)
);
create index if not exists idx_share_votes_share on public.mint_share_votes (share_id);


-- ───────────────────────────────────────────────────────────────────────────
-- 4. 사용자 (카카오 로그인)
-- ───────────────────────────────────────────────────────────────────────────

-- auth.users와 1:1. 사업자 미등록 상태라 이메일·전화번호는 다루지 않는다.
-- device_id: 로그인 전 익명 활동과 느슨하게 잇기 위한 기기 ID.
-- backfilled_at: 최초 로그인 시 로컬 기록을 계정으로 올렸는지의 유일한 신뢰 원천(null이면 아직).
create table if not exists public.mint_profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  kakao_id      text,
  nickname      text,
  avatar_url    text,
  device_id     text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  backfilled_at timestamptz
);
create index if not exists idx_mint_profiles_device_id on public.mint_profiles (device_id);

-- 로그인 사용자의 가벼운 추천 이력. 좌표·이미지·스냅샷 같은 무거운 필드를 넣지 말 것.
-- source: 'live'(추천 완료 시점 기록) | 'backfill'(최초 로그인 시 로컬 기록 일괄 업로드)
create table if not exists public.mint_activity_log (
  id                 bigserial primary key,
  user_id            uuid not null references auth.users (id) on delete cascade,
  device_id          text,
  place_name         text,
  second_place_name  text,
  area_name          text,
  purpose_first      text,
  group_size         text,
  created_at         timestamptz not null default now(),
  source             text not null default 'live'
);
create index if not exists idx_mint_activity_log_user_id
  on public.mint_activity_log (user_id, created_at desc);
-- 두 기기에서 동시에 첫 로그인하면 백필이 두 번 올라갈 수 있다. 백필 행에 한해 중복을 막는 2차 방어선.
create unique index if not exists idx_mint_activity_log_backfill_dedupe
  on public.mint_activity_log (user_id, place_name, coalesce(second_place_name, ''), created_at)
  where source = 'backfill';


-- ───────────────────────────────────────────────────────────────────────────
-- 5. 파일럿 (선발대 캠페인)
-- ───────────────────────────────────────────────────────────────────────────

-- 파일럿 참가자 피드백. v1(이미지+별점) → v2(룰렛·당첨코드) → v3(일련번호·Q&A)로 누적된 스키마.
-- 상시 피드백(user_feedback)과 분리한 이유: 이미지 NOT NULL·별점 필수·상품 배정이 얽힌 캠페인 전용이라서.
create table if not exists public.pilot_feedback (
  id                          text primary key,
  recommendation_image_paths  jsonb not null,
  payment_image_paths         jsonb not null,
  fit_rating                  integer not null check (fit_rating between 1 and 5),
  fit_text                    text not null,
  extra_text                  text,
  contact                     text,
  created_at                  timestamptz not null default now(),
  -- v2
  session_key                 text,
  selections                  jsonb,
  place_name                  text,
  claim_code                  text,
  -- v3
  serial                      text,
  entry_type                  text,        -- 'auto' | 'manual'
  rec_snapshot                jsonb,       -- {conditions, coursePicks}
  visited                     jsonb,       -- [{course, choice, otherName?}]
  qa_answers                  jsonb        -- {reason, issues, budget, vibeFit, reuse}
);
create unique index if not exists pilot_feedback_claim_code_key
  on public.pilot_feedback (claim_code) where claim_code is not null;
create index if not exists pilot_feedback_serial_idx
  on public.pilot_feedback (serial) where serial is not null;

-- 기프티콘 재고. assigned_feedback_id UNIQUE가 이중 배정을 물리적으로 막는다.
create table if not exists public.pilot_prizes (
  id                    text primary key,
  title                 text not null,
  tier                  text not null default 'basic',
  image_path            text not null,
  status                text not null default 'available'
                          check (status in ('available', 'assigned', 'redeemed', 'void')),
  assigned_feedback_id  text unique,
  assigned_at           timestamptz,
  claim_code            text,
  memo                  text,
  created_at            timestamptz not null default now()
);
create index if not exists pilot_prizes_status_idx on public.pilot_prizes (status, created_at);
create unique index if not exists pilot_prizes_claim_code_key
  on public.pilot_prizes (claim_code) where claim_code is not null;

-- 원자적 배정. 같은 제출 ID로 재호출하면 기존 배정을 반환(멱등).
-- 없으면 available 1건을 FOR UPDATE SKIP LOCKED로 잡아 배정. 재고 0이면 빈 결과.
create or replace function public.claim_pilot_prize(p_feedback_id text, p_claim_code text)
returns setof public.pilot_prizes
language plpgsql
as $$
declare v_row public.pilot_prizes;
begin
  select * into v_row from public.pilot_prizes
    where assigned_feedback_id = p_feedback_id limit 1;
  if found then
    return next v_row; return;
  end if;

  select * into v_row from public.pilot_prizes
    where status = 'available'
    order by created_at asc
    for update skip locked
    limit 1;
  if not found then return; end if;

  update public.pilot_prizes
    set status = 'assigned',
        assigned_feedback_id = p_feedback_id,
        assigned_at = now(),
        claim_code = p_claim_code
    where id = v_row.id
    returning * into v_row;
  return next v_row;
end;
$$;


-- ───────────────────────────────────────────────────────────────────────────
-- 6. 피드백·계측
-- ───────────────────────────────────────────────────────────────────────────

-- 상시 사용자 피드백. id는 클라이언트가 발급('fb'+14자) — 아웃박스 재전송의 멱등성 키.
-- char_length 하한이 1인 이유: 코드포인트 기준이라 이모지 한 글자가 1이다. 2로 두면 클라·서버를
-- 통과한 뒤 DB에서만 23514로 터지고, 서버가 500을 주니 아웃박스가 영원히 재시도한다(실제 겪음).
create table if not exists public.user_feedback (
  id           text primary key,
  text         text not null constraint user_feedback_text_check check (char_length(text) between 1 and 500),
  category     text check (category in ('bug', 'pain', 'idea', 'praise')),
  contact      text,
  route        text,
  tab          text,
  session_key  text,
  device_id    text,
  user_agent   text,     -- 클라가 보내지 않고 서버가 요청 헤더에서 기록
  viewport     text,
  created_at   timestamptz not null default now()
);
create index if not exists user_feedback_created_at_idx on public.user_feedback (created_at desc);

-- 행동 이벤트. 브라우저가 anon 키로 insert만 한다.
-- session_key: recommendation_log·user_feedback과 잇는 탐색 에피소드 조인 키.
-- payload: place_click/reject → {placeName, address, priceRange, fitScore}, location_search_zero → {query}
create table if not exists public.events (
  id                bigserial primary key,
  type              text not null,
  duration_seconds  integer,
  session_key       text,
  payload           jsonb,
  created_at        timestamptz default now()
);
create index if not exists idx_events_session_key on public.events (session_key);

-- IP·엔드포인트별 호출 기록. 레이트리밋 판정용(api/_lib/guard.ts). 서버 전용.
-- 정리 로직 없음 — 무한히 자란다. 레이트리밋 윈도우가 최대 1일이므로 이틀 지난 행은 지워도 된다.
create table if not exists public.api_hits (
  id        bigint generated always as identity primary key,
  ip        text not null,
  endpoint  text not null,
  ts        timestamptz not null default now()
);
create index if not exists api_hits_endpoint_ip_ts on public.api_hits (endpoint, ip, ts desc);
create index if not exists api_hits_endpoint_ts on public.api_hits (endpoint, ts desc);

-- 브라우저 런타임 에러. anon insert만.
create table if not exists public.client_errors (
  id          bigint generated always as identity primary key,
  message     text,
  stack       text,
  url         text,
  ua          text,
  created_at  timestamptz not null default now()
);


-- ───────────────────────────────────────────────────────────────────────────
-- 7. 기타
-- ───────────────────────────────────────────────────────────────────────────

-- 예약 요청. people·arrival_time이 TEXT인 건 초기 설계 그대로다. 서버 전용.
create table if not exists public.reservations (
  id            text primary key,
  place_name    text not null,
  address       text,
  guest_name    text,
  people        text,
  arrival_time  text,
  created_at    timestamptz default now()
);


-- ───────────────────────────────────────────────────────────────────────────
-- 8. 계정 삭제 함수
-- ───────────────────────────────────────────────────────────────────────────

-- 서버리스 함수 12개 한도 때문에 DB 함수로 둔다. security definer지만 auth.uid()로 대상을
-- 못박아 자기 계정만 지운다. mint_profiles·mint_activity_log는 FK cascade로 함께 사라진다.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_own_account() from public;
revoke all on function public.delete_own_account() from anon;
grant execute on function public.delete_own_account() to authenticated;


-- ───────────────────────────────────────────────────────────────────────────
-- 9. 스토리지 버킷
-- ───────────────────────────────────────────────────────────────────────────

-- 파일럿 피드백 이미지. 현재 public=true — 어드민 미리보기 편의로 열어둔 상태.
-- 사설로 바꾸고 서명 URL로 전환하는 게 맞다(handover-notes/06 A절). 이 파일은 현재 상태를 기록한다.
insert into storage.buckets (id, name, public)
values ('pilot-feedback', 'pilot-feedback', true)
on conflict (id) do update set public = true;

-- 기프티콘 이미지. 바코드 노출 방지로 private. 서버가 발급한 서명 URL로만 조회.
insert into storage.buckets (id, name, public)
values ('pilot-prizes', 'pilot-prizes', false)
on conflict (id) do update set public = false;


-- ───────────────────────────────────────────────────────────────────────────
-- 10. 기존 DB 보정
-- 새 DB에서는 전부 no-op이다. 옛 setup.sql만 실행된 DB(컬럼 누락)를 이 파일의 CREATE와
-- 같은 모양으로 맞춘다. 위 CREATE 문이 진실이고, 이 절은 안전망이다.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.events                 add column if not exists duration_seconds integer;
alter table public.events                 add column if not exists session_key text;
alter table public.events                 add column if not exists payload jsonb;

alter table public.mint_sessions          add column if not exists has_second boolean not null default false;
alter table public.mint_sessions          add column if not exists result_json jsonb;
alter table public.mint_sessions          add column if not exists result_at timestamptz;

alter table public.mint_session_members   add column if not exists purpose_first text;
alter table public.mint_session_members   add column if not exists purpose_second text;
alter table public.mint_session_members   add column if not exists vibe_keywords text;
alter table public.mint_session_members   add column if not exists device_id text;
alter table public.mint_session_members   alter column location_name drop not null;
alter table public.mint_session_members   alter column location_lat drop not null;
alter table public.mint_session_members   alter column location_lng drop not null;

alter table public.recommendation_log     add column if not exists serial text;
alter table public.recommendation_log     add column if not exists places_display jsonb;

alter table public.pilot_feedback         add column if not exists session_key text;
alter table public.pilot_feedback         add column if not exists selections jsonb;
alter table public.pilot_feedback         add column if not exists place_name text;
alter table public.pilot_feedback         add column if not exists claim_code text;
alter table public.pilot_feedback         add column if not exists serial text;
alter table public.pilot_feedback         add column if not exists entry_type text;
alter table public.pilot_feedback         add column if not exists rec_snapshot jsonb;
alter table public.pilot_feedback         add column if not exists visited jsonb;
alter table public.pilot_feedback         add column if not exists qa_answers jsonb;
alter table public.pilot_feedback         alter column extra_text drop not null;

alter table public.mint_profiles          add column if not exists backfilled_at timestamptz;
alter table public.mint_activity_log      add column if not exists source text not null default 'live';

-- user_feedback: 하한 2로 만들어진 옛 check 제약이 남아 있으면 이름과 무관하게 찾아 갈아끼운다.
do $$
declare
  con record;
  dropped boolean := false;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'public.user_feedback'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%char_length(text)%'
      and pg_get_constraintdef(oid) not ilike '%between 1 and 500%'
  loop
    execute format('alter table public.user_feedback drop constraint %I', con.conname);
    dropped := true;
  end loop;
  if dropped then
    alter table public.user_feedback
      add constraint user_feedback_text_check check (char_length(text) between 1 and 500);
  end if;
end $$;


-- ───────────────────────────────────────────────────────────────────────────
-- 11. RLS — 전부 켜고, 정책은 이름과 무관하게 전부 지운 뒤 필요한 세트만 다시 만든다
-- ───────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
  pol record;
  targets text[] := array[
    'recommendation_log', 'place_buzz_cache', 'license_cache',
    'mint_sessions', 'mint_session_members',
    'mint_share_snapshots', 'mint_share_votes',
    'mint_profiles', 'mint_activity_log',
    'pilot_feedback', 'pilot_prizes',
    'user_feedback', 'events', 'api_hits', 'client_errors',
    'reservations'
  ];
begin
  foreach t in array targets loop
    for pol in
      select policyname from pg_policies where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- anon: 브라우저가 직접 넣는 두 테이블만 insert
create policy events_anon_insert on public.events
  for insert to anon with check (true);
create policy client_errors_anon_insert on public.client_errors
  for insert to anon with check (true);

-- authenticated: 자기 프로필·자기 활동 로그만. 활동 로그는 추가만(update/delete 정책 없음).
create policy mint_profiles_own_select on public.mint_profiles
  for select to authenticated using (auth.uid() = id);
create policy mint_profiles_own_insert on public.mint_profiles
  for insert to authenticated with check (auth.uid() = id);
create policy mint_profiles_own_update on public.mint_profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy mint_activity_log_own_select on public.mint_activity_log
  for select to authenticated using (auth.uid() = user_id);
create policy mint_activity_log_own_insert on public.mint_activity_log
  for insert to authenticated with check (auth.uid() = user_id);

-- 스토리지: pilot-feedback 버킷은 anon 업로드 + 공개 읽기. pilot-prizes는 정책 없음(서명 URL만).
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (policyname like 'pilot_feedback_%' or policyname like 'pilot_prizes_%')
  loop
    execute format('drop policy %I on storage.objects', pol.policyname);
  end loop;
end $$;
create policy pilot_feedback_anon_upload on storage.objects
  for insert to anon with check (bucket_id = 'pilot-feedback');
create policy pilot_feedback_public_read on storage.objects
  for select to anon using (bucket_id = 'pilot-feedback');


-- ───────────────────────────────────────────────────────────────────────────
-- 12. 검증 — 실행 후 이 결과를 확인한다
-- ───────────────────────────────────────────────────────────────────────────

-- (a) 테이블 16개, 전부 rowsecurity = true
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

-- (b) 정책 7개: events 1, client_errors 1, mint_profiles 3, mint_activity_log 2
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- (c) 함수 2개: claim_pilot_prize(INVOKER), delete_own_account(DEFINER)
select routine_name, security_type
from information_schema.routines
where routine_schema = 'public' and routine_name in ('claim_pilot_prize', 'delete_own_account');

-- (d) 버킷 2개: pilot-feedback(public), pilot-prizes(private)
select id, public from storage.buckets where id in ('pilot-feedback', 'pilot-prizes');
