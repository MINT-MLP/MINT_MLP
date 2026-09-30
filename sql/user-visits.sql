-- MINT 재방문(리텐션) 기록 — 2026-10-01부터 수집 시작
-- 기존 MINT Supabase SQL Editor에서 실행하세요. 전부 additive(기존 데이터·테이블 무변경).
--
-- 방문 정의: 기기(device_id) 1개당 KST 달력일 1회. (device_id, visit_date) 유니크가 중복을 물리적으로 막는다.
--   세션(30분 무활동) 기준을 쓰지 않는 이유: 카카오 로그인 왕복·인앱→외부 브라우저 전환이 몇 분 만에
--   페이지를 떠났다 돌아오게 만들어, 세션 기준이면 가짜 "2번째 방문"이 대량으로 생긴다.
-- 브라우저는 테이블에 직접 insert하지 않고 record_visit() 함수만 부른다(security definer).
-- 서버리스 함수를 추가하지 않는 이유: Vercel Hobby 12개 한도(delete_own_account와 같은 사정).

create table if not exists public.user_visits (
  id          bigserial primary key,
  device_id   text not null,
  user_id     uuid,                            -- 호출 시점에 로그인돼 있었으면 auth.uid()
  visit_date  date not null,                   -- KST 달력일. 서버 now()로 계산 — 클라 시계를 믿지 않는다
  path        text,                            -- 그날 첫 진입 경로(/, /app, /join, /shared …)
  created_at  timestamptz not null default now()
);
create unique index if not exists user_visits_device_day_key on public.user_visits (device_id, visit_date);
create index if not exists user_visits_created_at_idx on public.user_visits (created_at);

alter table public.user_visits enable row level security;

-- 정책 0개 = 서비스롤(어드민 API)만 읽는다. 이름과 무관하게 전부 지운다.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'user_visits'
  loop
    execute format('drop policy %I on public.user_visits', pol.policyname);
  end loop;
end $$;

-- visit_date를 함수 안에서 계산하는 이유: timezone()은 STABLE이라 generated column·인덱스 식에 못 쓴다.
-- search_path = ''여도 now()/left()는 pg_catalog로 암묵 해석되고, auth.uid()는 이미 스키마 한정이다.
create or replace function public.record_visit(p_device_id text, p_path text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device text := left(coalesce(p_device_id, ''), 64);
begin
  -- 'd_anon'은 localStorage가 막힌 기기들의 공용 폴백값 — 여러 명이 한 명으로 뭉치므로 세지 않는다
  if v_device = '' or v_device = 'd_anon' then
    return;
  end if;
  insert into public.user_visits (device_id, user_id, visit_date, path)
  values (v_device, auth.uid(), (now() at time zone 'Asia/Seoul')::date, left(p_path, 100))
  on conflict (device_id, visit_date) do nothing;
end;
$$;
revoke all on function public.record_visit(text, text) from public;
grant execute on function public.record_visit(text, text) to anon, authenticated;

-- 검증
-- (a) rowsecurity = true
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'user_visits';
-- (b) 0행이어야 정상
select policyname from pg_policies where schemaname = 'public' and tablename = 'user_visits';
-- (c) record_visit | DEFINER
select routine_name, security_type from information_schema.routines
where routine_schema = 'public' and routine_name = 'record_visit';
