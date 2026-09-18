-- MINT 어드민 비밀번호 — Vercel env(ADMIN_PASSWORD)에서 Supabase로 이전
-- 기존 MINT Supabase SQL Editor에서 실행하세요.
--
-- 왜: 어드민 비밀번호가 Vercel 환경변수에만 있으면 Vercel 대시보드 권한이 없는 운영자는
-- 비밀번호를 바꿀 수 없다. 이 테이블에 해시를 두고 어드민 페이지에서 직접 바꾸게 한다.
-- 이 파일은 행을 insert하지 않는다 — 행이 없는 동안은 서버가 ADMIN_PASSWORD env로 폴백하고,
-- 어드민에서 처음 "비밀번호 변경"을 누르는 순간 행이 생기며 그 뒤로는 이 테이블만 본다.
-- 평문은 절대 저장하지 않는다. password_hash 포맷: scrypt$N$r$p$<salt base64>$<key base64>

create table if not exists public.admin_credentials (
  id            text primary key default 'admin' check (id = 'admin'),  -- 단일 행 강제
  password_hash text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.admin_credentials enable row level security;

-- 브라우저는 테이블에 직접 접근하지 않고 서버리스 API(service role)만 사용합니다.
-- 정책을 하나도 두지 않는다 = anon/authenticated 전부 차단(service role은 RLS 우회).
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'admin_credentials'
  loop
    execute format('drop policy %I on public.admin_credentials', pol.policyname);
  end loop;
end $$;

-- 이중 방어: RLS 정책이 실수로 생겨도 anon/authenticated는 권한 자체가 없게.
revoke all on table public.admin_credentials from anon, authenticated;

-- ── 검증 ──
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename = 'admin_credentials';
select tablename, policyname, cmd, roles from pg_policies
where schemaname = 'public' and tablename = 'admin_credentials';   -- 0행이어야 정상

-- ── 롤백 (필요할 때 수동으로 실행) ──
-- 1) 비밀번호를 Vercel env(ADMIN_PASSWORD) 값으로 되돌리기 — 행만 지우면 즉시 env 폴백이 재개된다.
--    delete from public.admin_credentials;
-- 2) 이 변경을 완전히 철회하기.
--    drop table if exists public.admin_credentials;
