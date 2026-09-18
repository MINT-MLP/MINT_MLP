-- MINT 어드민 비밀번호 — Vercel env(ADMIN_PASSWORD)에서 Supabase로 이전
-- 기존 MINT Supabase SQL Editor에서 실행하세요.
--
-- 왜: 어드민 비밀번호가 Vercel 환경변수에만 있으면 Vercel 대시보드 권한이 없는 운영자는
-- 비밀번호를 바꿀 수 없다. 이 테이블에 해시를 두고 어드민 페이지에서 직접 바꾸게 한다.
-- 이 파일은 행을 insert하지 않는다 — 행이 없는 동안은 서버가 ADMIN_PASSWORD env로 폴백하고,
-- 어드민에서 처음 "비밀번호 변경"을 누르는 순간 행이 생기며 그 뒤로는 이 테이블만 본다.
-- 평문은 절대 저장하지 않는다. password_hash 포맷: scrypt$N$r$p$<salt base64>$<key base64>
--
-- 붙여넣기 주의: SQL Editor에 긴 블록을 한 번에 넣으면 줄이 잘려 들어가는 일이 있었다.
-- 그래서 do $$ ... $$ 같은 취약한 구문을 쓰지 않고 단순 구문만 남겼다.
-- 아래 세 구문을 한 번에 실행하고, 끝의 검증 select는 따로 실행하면 된다.

create table if not exists public.admin_credentials (
  id text primary key default 'admin' check (id = 'admin'),
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 브라우저는 이 테이블에 직접 접근하지 않고 서버리스 API(service role)만 사용한다.
-- 정책을 하나도 만들지 않는다 = anon/authenticated 전부 차단(service role은 RLS를 우회한다).
alter table public.admin_credentials enable row level security;

-- 이중 방어: 나중에 정책이 실수로 생겨도 anon/authenticated는 권한 자체가 없게.
revoke all on table public.admin_credentials from anon, authenticated;

-- ── 검증 (따로 실행) ──
-- rowsecurity가 true여야 정상.
--   select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' and tablename = 'admin_credentials';
--
-- 0행이어야 정상(정책이 하나도 없어야 한다).
--   select policyname from pg_policies
--   where schemaname = 'public' and tablename = 'admin_credentials';

-- ── 롤백 (필요할 때 수동으로 실행) ──
-- 1) 비밀번호를 Vercel env(ADMIN_PASSWORD) 값으로 되돌리기 — 행만 지우면 즉시 env 폴백이 재개된다.
--    delete from public.admin_credentials;
-- 2) 이 변경을 완전히 철회하기.
--    drop table if exists public.admin_credentials;
