-- ═══════════════════════════════════════════════════════════════════════════
-- MINT v2 스키마 — DB 재정비 작업에서 실제로 실행한 쿼리를 순서대로 모은 파일
--
-- 용도: dev에서 검증한 뒤 prod에 그대로 이관한다. 위에서부터 순서대로 실행.
-- 규칙: 컬럼명 snake_case, 시각은 _at, JSON 컬럼 없음, 모든 테이블·컬럼에 한글 라벨 코멘트.
--       외부 API(카카오·네이버) 검색 결과는 저장하지 않는다. 카카오는 place ID·URL만 허용.
-- 이력:
--   2026-09-20  001 users, 002 events·client_errors 정책
--   2026-09-23  003 place_category
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 001. 사용자 (mint_profiles 대체)
-- 전제: Authentication → Sign In / Providers → Anonymous sign-ins ON
-- 인증 모델: /app 진입 시 익명 사용자 생성. 카카오 로그인은 signInWithOAuth(세션 교체).
--           행 생성과 kakao_id 채움은 트리거가 한다. 클라이언트는 last_sign_in_at만 갱신.
-- ───────────────────────────────────────────────────────────────────────────

create table public.users (
  id               uuid primary key references auth.users (id) on delete cascade,
  kakao_id         bigint unique,
  kakao_linked_at  timestamptz,
  nickname         text,
  avatar_url       text,
  created_at       timestamptz not null default now(),
  last_sign_in_at  timestamptz not null default now()
);

comment on table  public.users                  is '사용자';
comment on column public.users.id               is '사용자 ID (auth.users.id)';
comment on column public.users.kakao_id         is '카카오 UID';
comment on column public.users.kakao_linked_at  is '카카오 연결일시';
comment on column public.users.nickname         is '닉네임';
comment on column public.users.avatar_url       is '프로필 이미지 URL';
comment on column public.users.created_at       is '생성일시';
comment on column public.users.last_sign_in_at  is '최근 로그인일시';

-- auth.users 생성 → users 행 자동 생성 (익명 포함)
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- 카카오 identity 생성 → kakao_id·닉네임·아바타 채움
create or replace function public.handle_kakao_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.provider = 'kakao' then
    update public.users
    set
      kakao_id        = nullif(regexp_replace(new.provider_id, '\D', '', 'g'), '')::bigint,
      kakao_linked_at = coalesce(kakao_linked_at, now()),
      nickname        = coalesce(
                          new.identity_data->>'name',
                          new.identity_data->>'preferred_username',
                          new.identity_data->>'nickname',
                          nickname),
      avatar_url      = coalesce(
                          new.identity_data->>'avatar_url',
                          new.identity_data->>'picture',
                          new.identity_data->>'profile_image_url',
                          avatar_url)
    where id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_kakao_identity_linked on auth.identities;
create trigger on_kakao_identity_linked
  after insert or update on auth.identities
  for each row execute function public.handle_kakao_identity();

-- RLS: 자기 행만 조회·갱신. insert는 트리거만
alter table public.users enable row level security;

drop policy if exists users_own_select on public.users;
create policy users_own_select on public.users
  for select to authenticated
  using (auth.uid() = id);

drop policy if exists users_own_update on public.users;
create policy users_own_update on public.users
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 이관: 기존 auth.users 전원 → users (트리거는 과거 행에 안 돌았으므로)
insert into public.users (id, created_at, last_sign_in_at)
select id, created_at, coalesce(last_sign_in_at, created_at)
from auth.users
on conflict (id) do nothing;

update public.users u
set
  kakao_id        = nullif(regexp_replace(i.provider_id, '\D', '', 'g'), '')::bigint,
  kakao_linked_at = i.created_at,
  nickname        = coalesce(i.identity_data->>'name', i.identity_data->>'preferred_username', i.identity_data->>'nickname'),
  avatar_url      = coalesce(i.identity_data->>'avatar_url', i.identity_data->>'picture', i.identity_data->>'profile_image_url')
from auth.identities i
where i.user_id = u.id and i.provider = 'kakao';

-- 옛 mint_profiles의 닉네임·아바타·최근접속 우선 적용 (테이블이 남아 있는 경우만)
update public.users u
set
  nickname        = coalesce(p.nickname, u.nickname),
  avatar_url      = coalesce(p.avatar_url, u.avatar_url),
  last_sign_in_at = greatest(u.last_sign_in_at, p.last_seen_at),
  created_at      = least(u.created_at, p.created_at)
from public.mint_profiles p
where p.id = u.id;

-- 검증: auth_users = app_users, kakao_identities = kakao_linked
select
  (select count(*) from auth.users)                              as auth_users,
  (select count(*) from public.users)                            as app_users,
  (select count(*) from auth.identities where provider='kakao')  as kakao_identities,
  (select count(*) from public.users where kakao_id is not null) as kakao_linked;

-- mint_profiles 삭제는 prod 검증 후 별도 실행:
-- drop table if exists public.mint_profiles;


-- ───────────────────────────────────────────────────────────────────────────
-- 002. events·client_errors INSERT 정책
-- 익명 로그인 도입으로 브라우저 역할이 anon → authenticated. 두 역할 모두 허용.
-- ───────────────────────────────────────────────────────────────────────────

drop policy if exists events_anon_insert on public.events;
drop policy if exists events_insert on public.events;
create policy events_insert on public.events
  for insert to anon, authenticated with check (true);

drop policy if exists client_errors_anon_insert on public.client_errors;
drop policy if exists client_errors_insert on public.client_errors;
create policy client_errors_insert on public.client_errors
  for insert to anon, authenticated with check (true);


-- ───────────────────────────────────────────────────────────────────────────
-- 003. 장소 카테고리 분류표
-- 카카오 로컬 API 응답의 category_name("음식점 > 한식 > 해물,생선 > 게,대게")을 분류표로만 모은다.
-- 가게 이름·ID·좌표는 저장하지 않는다(약관). 사용자 선택 목록과 필터 판정의 기준.
-- 빈 단계는 NULL이 아니라 ''로 둔다 — unique 제약이 NULL을 서로 다른 값으로 보기 때문.
-- 판정: 선택한 행의 채워진 depth까지 가게 경로가 같으면 통과(접두어 일치).
-- ───────────────────────────────────────────────────────────────────────────

create table public.place_category (
  id        bigint primary key generated always as identity,
  depth1    varchar(30) not null,
  depth2    varchar(30) not null default '',
  depth3    varchar(50) not null default '',
  depth4    varchar(50) not null default '',
  is_brand  boolean not null default false,
  sort      int not null default 0,
  unique (depth1, depth2, depth3, depth4)
);

comment on table  public.place_category          is '장소 카테고리';
comment on column public.place_category.depth1   is '1단계 (음식점)';
comment on column public.place_category.depth2   is '2단계 (한식·일식·카페·술집 …)';
comment on column public.place_category.depth3   is '3단계 (해물,생선·와인바 …)';
comment on column public.place_category.depth4   is '4단계 (게,대게 또는 브랜드명)';
comment on column public.place_category.is_brand is '브랜드명 여부. true면 선택 목록에서 제외';
comment on column public.place_category.sort     is '같은 부모 안 표시 순서';

-- dev에 NULL 허용으로 먼저 만들었다면 ''로 통일:
-- update public.place_category set depth2 = coalesce(depth2,''), depth3 = coalesce(depth3,''), depth4 = coalesce(depth4,'');
-- alter table public.place_category
--   alter column depth2 set default '', alter column depth2 set not null,
--   alter column depth3 set default '', alter column depth3 set not null,
--   alter column depth4 set default '', alter column depth4 set not null;

-- 수집: scripts/collect-place-categories.mjs (dev DB에 upsert)
