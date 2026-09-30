-- ═══════════════════════════════════════════════════════════════════════════
-- MINT v2 스키마 — DB 재정비 작업에서 실제로 실행한 쿼리를 순서대로 모은 파일
--
-- 용도: dev에서 검증한 뒤 prod에 그대로 이관한다. 위에서부터 순서대로 실행.
-- 규칙: 컬럼명 snake_case, 시각은 _at, JSON 컬럼 없음, 모든 테이블·컬럼에 한글 라벨 코멘트.
--       외부 API(카카오·네이버) 검색 결과는 저장하지 않는다. 카카오는 place ID·URL만 허용.
-- 이력:
--   2026-09-20  001 users, 002 events·client_errors 정책
--   2026-09-23  003 place_category
--   2026-09-30  004 회원 데이터(1-1), 004-15 보완, 005 안 쓰는 테이블 정리(단계별), 006 익명 로그인 제거,
--               007 004 보완(비회원 슬롯 행동 판정, 정리 경합)
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 001. 사용자 (mint_profiles 대체)
-- 전제: Authentication → Sign In / Providers → Anonymous sign-ins ON  ※ 006(09-30)에서 철회. 지금은 OFF
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


-- ───────────────────────────────────────────────────────────────────────────
-- 004. 회원 데이터 (1-1) — 초안, 미실행
-- 근거: handover-notes/19·20.
-- 저장 원칙: 카카오 데이터는 장소 ID만(카카오맵 링크는 ID로 만든다). 이름·주소·좌표·점수는 없다.
--   출발지는 사용자가 친 검색어 + 고른 장소 ID. 검색 중심 좌표는 저장하지 않고 입력에서 다시 계산.
-- 쓰기 주체: 추천 기록은 추천 API(서비스 키)가 쓴다. 클라이언트는 찜·슬롯 행동만 쓴다.
--   포인트·방문 인증은 서버 함수로만.
-- 비회원: user_id가 NULL인 행 = 식별자 없는 통계. 비회원 출발지는 저장하지 않는다(API에서 지킴).
-- 보관: 회원 추천은 90일·최근 20건. 넘으면 지우지 않고 익명화해 통계로 남긴다(prune_recommendations).
-- ───────────────────────────────────────────────────────────────────────────

-- 004-1. 선택지 목록 (분위기·취향·조건·추천 키워드)
create table public.choice_option (
  id          smallint primary key generated always as identity,
  kind        varchar(20) not null check (kind in ('mood', 'pref', 'condition', 'keyword')),
  code        varchar(40) not null unique,
  label       varchar(40) not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  retired_at  timestamptz
);

comment on table  public.choice_option            is '선택지 목록';
comment on column public.choice_option.kind       is '종류 (mood 분위기 / pref 취향 / condition 조건 / keyword 추천 키워드)';
comment on column public.choice_option.code       is '코드 (화면 키 atm_loud 등, 키워드는 kw:라벨)';
comment on column public.choice_option.label      is '표시 이름';
comment on column public.choice_option.is_active  is '사용 여부. 없앤 선택지는 지우지 않고 false';
comment on column public.choice_option.created_at is '생성일시. 추천 시각보다 늦으면 그 추천 때는 없던 선택지';
comment on column public.choice_option.retired_at is '사용 중지일시';

insert into public.choice_option (kind, code, label) values
  ('mood', 'atm_loud', '시끌벅적'), ('mood', 'atm_quiet', '조용하게'), ('mood', 'atm_cozy', '아늑한'),
  ('mood', 'atm_trendy', '트렌디한'), ('mood', 'atm_mood', '감성적인'), ('mood', 'atm_modern', '모던한'),
  ('mood', 'atm_lively', '활기찬'), ('mood', 'atm_clean', '깔끔한'),
  ('pref', 'pref_new', '새로운 곳'), ('pref', 'pref_known', '검증된 곳'), ('pref', 'pref_view', '뷰 좋은 곳'),
  ('pref', 'pref_insta', '인스타감성'), ('pref', 'pref_spacious', '넓은 공간'), ('pref', 'pref_quick', '웨이팅 없음'),
  ('condition', 'pref_parking', '주차 가능'), ('condition', 'pref_room', '룸 있는 곳'),
  ('condition', 'pref_reserve', '예약 가능'), ('condition', 'pref_late', '늦게까지'),
  ('condition', 'pref_pet', '반려동물'), ('condition', 'pref_station', '역세권'),
  ('keyword', 'kw:힙한', '힙한'), ('keyword', 'kw:로맨틱한', '로맨틱한'), ('keyword', 'kw:레트로', '레트로'),
  ('keyword', 'kw:이국적인', '이국적인'), ('keyword', 'kw:노포', '노포'), ('keyword', 'kw:오마카세', '오마카세'),
  ('keyword', 'kw:창가자리', '창가자리'), ('keyword', 'kw:루프탑', '루프탑');

-- 그리드에서 내린 옛 분위기 코드. 옛 세션 복원값이 가리킬 수 있어 행은 남긴다
insert into public.choice_option (kind, code, label, is_active, retired_at) values
  ('mood', 'atm_hip', '힙한', false, now()), ('mood', 'atm_romantic', '로맨틱한', false, now()),
  ('mood', 'atm_retro', '레트로', false, now()), ('mood', 'atm_exotic', '이국적인', false, now());

alter table public.choice_option enable row level security;
drop policy if exists choice_option_read on public.choice_option;
create policy choice_option_read on public.choice_option
  for select to anon, authenticated using (true);


-- 004-2. 검색 조건 (추천 한 번의 입력)
create table public.search_condition (
  id                     bigint primary key generated always as identity,
  user_id                uuid references public.users (id) on delete set null,
  mode                   varchar(10) not null check (mode in ('solo', 'group')),
  group_size             varchar(10) not null check (group_size in ('2명', '3~4명', '5명 이상')),
  first_purpose          varchar(10) not null check (first_purpose in ('밥', '술', '카페', '메뉴')),
  first_category_path    varchar(120),
  second_purpose         varchar(10) check (second_purpose in ('밥', '술', '카페', '메뉴')),
  second_category_path   varchar(120),
  relation               varchar(10) check (relation in ('친구들', '연인', '가족')),
  occasion               varchar(40),
  budget                 varchar(10) check (budget in ('~2만원', '2~4만원', '4만원+')),
  area_type              varchar(10) not null check (area_type in ('auto', 'region', 'preset')),
  area_label             varchar(60) not null,
  region_level           varchar(10) check (region_level in ('si', 'gu', 'dong')),
  created_at             timestamptz not null default now()
);

comment on table  public.search_condition                      is '검색 조건';
comment on column public.search_condition.user_id              is '사용자 ID. NULL이면 비회원 통계 또는 익명화된 기록';
comment on column public.search_condition.mode                 is '정하는 방식 (solo 혼자 / group 다같이)';
comment on column public.search_condition.group_size           is '인원 구간';
comment on column public.search_condition.first_purpose        is '1차 목적 (메뉴 = 메뉴 콕)';
comment on column public.search_condition.first_category_path  is '1차 종류 경로 (예: 한식 > 육류,고기)';
comment on column public.search_condition.second_purpose       is '2차 목적. NULL이면 2차 없음';
comment on column public.search_condition.second_category_path is '2차 종류 경로';
comment on column public.search_condition.relation             is '관계';
comment on column public.search_condition.occasion             is '특별한 날 또는 기타 콕 직접 입력';
comment on column public.search_condition.budget               is '1인 예산';
comment on column public.search_condition.area_type            is '지역 방식 (auto 자동 중간지점 / region 직접 입력 / preset 지역 바로가기)';
comment on column public.search_condition.area_label           is '지역 이름 (상권 이름, 행정구역 라벨, 프리셋 이름). 좌표 아님';
comment on column public.search_condition.region_level         is '직접 입력 지역의 단위 (시·구·동)';
comment on column public.search_condition.created_at           is '생성일시';

create index search_condition_user_idx on public.search_condition (user_id) where user_id is not null;


-- 004-3. 메뉴 콕 입력
create table public.search_menu (
  condition_id  bigint not null references public.search_condition (id) on delete cascade,
  course        varchar(6) not null check (course in ('first', 'second')),
  ord           smallint not null check (ord between 1 and 4),
  menu          varchar(20) not null,
  primary key (condition_id, course, ord)
);

comment on table  public.search_menu              is '메뉴 콕 입력';
comment on column public.search_menu.condition_id is '검색 조건 ID';
comment on column public.search_menu.course       is '코스 (first 1차 / second 2차)';
comment on column public.search_menu.ord          is '순서';
comment on column public.search_menu.menu         is '메뉴 (&로 묶으면 한 가게에서 같이)';


-- 004-4. 출발지 (회원만)
create table public.search_origin (
  condition_id    bigint not null references public.search_condition (id) on delete cascade,
  ord             smallint not null check (ord between 1 and 6),
  query           varchar(60) not null,
  kakao_place_id  varchar(20) not null,
  primary key (condition_id, ord)
);

comment on table  public.search_origin                is '출발지';
comment on column public.search_origin.condition_id   is '검색 조건 ID';
comment on column public.search_origin.ord            is '순서';
comment on column public.search_origin.query          is '사용자가 친 검색어. 이 검색어로 재검색해 장소 ID로 복원';
comment on column public.search_origin.kakao_place_id is '고른 카카오 장소 ID';


-- 004-5. 고른 선택지
create table public.search_choice (
  id            bigint primary key generated always as identity,
  condition_id  bigint not null references public.search_condition (id) on delete cascade,
  course        varchar(6) not null check (course in ('first', 'second', 'all')),
  option_id     smallint references public.choice_option (id),
  custom_text   varchar(30),
  check ((option_id is null) <> (custom_text is null))
);

comment on table  public.search_choice              is '고른 선택지';
comment on column public.search_choice.condition_id is '검색 조건 ID';
comment on column public.search_choice.course       is '코스 (all = 조건처럼 코스 구분 없음)';
comment on column public.search_choice.option_id    is '선택지 ID';
comment on column public.search_choice.custom_text  is '직접 입력한 키워드 (목록에 없는 값)';

create index search_choice_condition_idx on public.search_choice (condition_id);
create index search_choice_option_idx on public.search_choice (option_id) where option_id is not null;


-- 004-6. 추천
create table public.recommendation (
  id               bigint primary key generated always as identity,
  user_id          uuid references public.users (id) on delete set null,
  condition_id     bigint not null references public.search_condition (id),
  retried_from_id  bigint references public.recommendation (id) on delete set null,
  retry_reason     varchar(10) check (retry_reason in ('expensive', 'far', 'vibe')),
  search_version   smallint not null,
  created_at       timestamptz not null default now()
);

comment on table  public.recommendation                 is '추천';
comment on column public.recommendation.user_id         is '사용자 ID. NULL이면 비회원 통계 또는 익명화된 기록';
comment on column public.recommendation.condition_id    is '검색 조건 ID';
comment on column public.recommendation.retried_from_id is '다시 추천받기의 이전 추천 ID';
comment on column public.recommendation.retry_reason    is '다시 추천받기 사유 (expensive 비싸요 / far 멀어요 / vibe 분위기)';
comment on column public.recommendation.search_version  is '검색 방식 버전. 검색 코드를 바꿀 때 서버 상수를 올린다';
comment on column public.recommendation.created_at      is '생성일시';

create index recommendation_user_created_idx on public.recommendation (user_id, created_at desc) where user_id is not null;
create index recommendation_condition_idx on public.recommendation (condition_id);


-- 004-7. 추천 슬롯 (화면의 칸마다 한 행)
create table public.recommendation_slot (
  id                 bigint primary key generated always as identity,
  recommendation_id  bigint not null references public.recommendation (id) on delete cascade,
  course             varchar(6) not null check (course in ('first', 'second')),
  role               varchar(6) not null check (role in ('main', 'alt')),
  rank               smallint not null,
  kakao_place_id     varchar(20) not null,
  search_kind        varchar(10) not null check (search_kind in ('keyword', 'category')),
  search_query       varchar(80),
  search_page        smallint not null,
  unique (recommendation_id, course, role, rank)
);

comment on table  public.recommendation_slot                   is '추천 슬롯';
comment on column public.recommendation_slot.recommendation_id is '추천 ID';
comment on column public.recommendation_slot.course            is '코스 (first 1차 / second 2차)';
comment on column public.recommendation_slot.role              is '역할 (main 대표 / alt 대안)';
comment on column public.recommendation_slot.rank              is '같은 코스·역할 안 순서';
comment on column public.recommendation_slot.kakao_place_id    is '카카오 장소 ID (링크는 place.map.kakao.com/ID)';
comment on column public.recommendation_slot.search_kind       is '이 ID를 돌려준 카카오 검색 종류 (keyword / category)';
comment on column public.recommendation_slot.search_query      is '그 검색의 검색어 또는 카테고리 코드';
comment on column public.recommendation_slot.search_page       is '그 검색의 페이지. 복원 때 앞뒤 페이지까지 찾는다';

create index recommendation_slot_rec_idx on public.recommendation_slot (recommendation_id);
create index recommendation_slot_place_idx on public.recommendation_slot (kakao_place_id);


-- 004-8. 슬롯 행동
create table public.slot_action (
  id          bigint primary key generated always as identity,
  slot_id     bigint not null references public.recommendation_slot (id) on delete cascade,
  action      varchar(10) not null check (action in ('map_open', 'reserve', 'share', 'wish')),
  created_at  timestamptz not null default now()
);

comment on table  public.slot_action            is '슬롯 행동';
comment on column public.slot_action.slot_id    is '추천 슬롯 ID';
comment on column public.slot_action.action     is '행동 (map_open 카카오맵 열기 / reserve 예약하러 가기 / share 공유 / wish 찜)';
comment on column public.slot_action.created_at is '생성일시';

create index slot_action_slot_idx on public.slot_action (slot_id);


-- 004-9. 찜
create table public.wishlist (
  id              bigint primary key generated always as identity,
  user_id         uuid not null references public.users (id) on delete cascade,
  kakao_place_id  varchar(20) not null,
  condition_id    bigint not null references public.search_condition (id),
  course          varchar(6) not null check (course in ('first', 'second')),
  search_kind     varchar(10) not null check (search_kind in ('keyword', 'category')),
  search_query    varchar(80),
  search_page     smallint not null,
  created_at      timestamptz not null default now(),
  unique (user_id, kakao_place_id)
);

comment on table  public.wishlist                is '찜';
comment on column public.wishlist.user_id        is '사용자 ID';
comment on column public.wishlist.kakao_place_id is '카카오 장소 ID';
comment on column public.wishlist.condition_id   is '이 가게가 나온 검색 조건 ID. 지난 추천이 정리돼도 남는다';
comment on column public.wishlist.course         is '그 조건의 1차·2차 중 어느 쪽 결과였나';
comment on column public.wishlist.search_kind    is '이 ID를 돌려준 카카오 검색 종류';
comment on column public.wishlist.search_query   is '그 검색의 검색어 또는 카테고리 코드';
comment on column public.wishlist.search_page    is '그 검색의 페이지';
comment on column public.wishlist.created_at     is '생성일시';

create index wishlist_user_created_idx on public.wishlist (user_id, created_at desc);
create index wishlist_condition_idx on public.wishlist (condition_id);


-- 004-10. 방문 인증 (세부 규칙은 기획 20번 확정 후 조정)
create table public.visit_certification (
  id              bigint primary key generated always as identity,
  user_id         uuid not null references public.users (id) on delete cascade,
  kakao_place_id  varchar(20) not null,
  slot_id         bigint references public.recommendation_slot (id) on delete set null,
  certified_at    timestamptz not null default now(),
  unique (user_id, kakao_place_id)
);

comment on table  public.visit_certification                is '방문 인증';
comment on column public.visit_certification.user_id        is '사용자 ID';
comment on column public.visit_certification.kakao_place_id is '카카오 장소 ID';
comment on column public.visit_certification.slot_id        is '인증 대상 추천 슬롯 (예약하러 가기를 누른 슬롯)';
comment on column public.visit_certification.certified_at   is '인증일시';


-- 004-11. 포인트 내역 (잔액 = 합계)
create table public.point_ledger (
  id          bigint primary key generated always as identity,
  user_id     uuid not null references public.users (id) on delete cascade,
  kind        varchar(20) not null check (kind in ('visit_cert', 'adjust')),
  amount      int not null check (amount <> 0),
  visit_id    bigint references public.visit_certification (id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table  public.point_ledger            is '포인트 내역';
comment on column public.point_ledger.user_id    is '사용자 ID';
comment on column public.point_ledger.kind       is '종류 (visit_cert 방문 인증 / adjust 운영 조정). 쿠폰 사용은 생길 때 추가';
comment on column public.point_ledger.amount     is '금액 (+적립 / -사용)';
comment on column public.point_ledger.visit_id   is '방문 인증 ID (visit_cert일 때)';
comment on column public.point_ledger.created_at is '생성일시';

create index point_ledger_user_created_idx on public.point_ledger (user_id, created_at desc);


-- 004-12. 방문 인증 + 적립. 서버 API만 호출한다(300m 판정은 API가 카카오 재조회로 끝낸 뒤)
create or replace function public.certify_visit(p_user uuid, p_slot bigint, p_place varchar, p_points int default 500)
returns bigint
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id bigint;
begin
  insert into public.visit_certification (user_id, kakao_place_id, slot_id)
  values (p_user, p_place, p_slot)
  on conflict (user_id, kakao_place_id) do nothing
  returning id into v_id;

  if v_id is null then
    return null;  -- 이미 인증한 가게
  end if;

  insert into public.point_ledger (user_id, kind, amount, visit_id)
  values (p_user, 'visit_cert', p_points, v_id);
  return v_id;
end;
$fn$;

revoke all on function public.certify_visit(uuid, bigint, varchar, int) from public, anon, authenticated;


-- 004-13. 권한. 본인 것만 조회. 추천 기록 쓰기는 서비스 키만
alter table public.search_condition    enable row level security;
alter table public.search_menu         enable row level security;
alter table public.search_origin       enable row level security;
alter table public.search_choice       enable row level security;
alter table public.recommendation      enable row level security;
alter table public.recommendation_slot enable row level security;
alter table public.slot_action         enable row level security;
alter table public.wishlist            enable row level security;
alter table public.point_ledger        enable row level security;
alter table public.visit_certification enable row level security;

-- 조건은 본인 것이거나 본인 찜이 가리키는 것(익명화된 뒤에도 찜 복원에 필요)
create or replace function public.can_read_condition(p_condition bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (select 1 from public.search_condition c where c.id = p_condition and c.user_id = auth.uid())
      or exists (select 1 from public.wishlist w where w.condition_id = p_condition and w.user_id = auth.uid());
$fn$;

drop policy if exists search_condition_own on public.search_condition;
create policy search_condition_own on public.search_condition
  for select to authenticated using (public.can_read_condition(id));

drop policy if exists search_menu_own on public.search_menu;
create policy search_menu_own on public.search_menu
  for select to authenticated using (public.can_read_condition(condition_id));

drop policy if exists search_origin_own on public.search_origin;
create policy search_origin_own on public.search_origin
  for select to authenticated using (public.can_read_condition(condition_id));

drop policy if exists search_choice_own on public.search_choice;
create policy search_choice_own on public.search_choice
  for select to authenticated using (public.can_read_condition(condition_id));

drop policy if exists recommendation_own_select on public.recommendation;
create policy recommendation_own_select on public.recommendation
  for select to authenticated using (user_id = auth.uid());

drop policy if exists recommendation_own_delete on public.recommendation;
create policy recommendation_own_delete on public.recommendation
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists recommendation_slot_own on public.recommendation_slot;
create policy recommendation_slot_own on public.recommendation_slot
  for select to authenticated
  using (exists (select 1 from public.recommendation r where r.id = recommendation_id and r.user_id = auth.uid()));

-- 행동은 본인 추천이거나 비회원 통계 추천(user_id NULL)에만 남길 수 있다
drop policy if exists slot_action_insert on public.slot_action;
create policy slot_action_insert on public.slot_action
  for insert to anon, authenticated
  with check (exists (
    select 1 from public.recommendation_slot s
    join public.recommendation r on r.id = s.recommendation_id
    where s.id = slot_id and (r.user_id is null or r.user_id = auth.uid())
  ));

drop policy if exists wishlist_own_select on public.wishlist;
create policy wishlist_own_select on public.wishlist
  for select to authenticated using (user_id = auth.uid());

drop policy if exists wishlist_own_insert on public.wishlist;
create policy wishlist_own_insert on public.wishlist
  for insert to authenticated
  with check (user_id = auth.uid() and exists (
    select 1 from public.search_condition c where c.id = condition_id and c.user_id = auth.uid()
  ));

drop policy if exists wishlist_own_delete on public.wishlist;
create policy wishlist_own_delete on public.wishlist
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists point_ledger_own on public.point_ledger;
create policy point_ledger_own on public.point_ledger
  for select to authenticated using (user_id = auth.uid());

drop policy if exists visit_certification_own on public.visit_certification;
create policy visit_certification_own on public.visit_certification
  for select to authenticated using (user_id = auth.uid());


-- 004-14. 지난 추천 정리. 90일 지났거나 최근 20건 밖이면 익명화해 통계로 남긴다
create or replace function public.prune_recommendations(p_days int default 90, p_keep int default 20)
returns int
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_count int;
begin
  with targets as (
    select x.id from (
      select r.id, r.created_at,
             row_number() over (partition by r.user_id order by r.created_at desc) as rn
      from public.recommendation r
      where r.user_id is not null
    ) x
    where x.rn > p_keep or x.created_at < now() - make_interval(days => p_days)
  ),
  done as (
    update public.recommendation r set user_id = null
    from targets t where r.id = t.id
    returning r.id
  )
  select count(*) into v_count from done;

  -- 회원 추천도 찜도 가리키지 않게 된 조건: 출발지(준식별 정보) 삭제 후 익명화
  delete from public.search_origin o
  using public.search_condition c
  where c.id = o.condition_id
    and c.user_id is not null
    and not exists (select 1 from public.recommendation r where r.condition_id = c.id and r.user_id is not null)
    and not exists (select 1 from public.wishlist w where w.condition_id = c.id);

  update public.search_condition c set user_id = null
  where c.user_id is not null
    and not exists (select 1 from public.recommendation r where r.condition_id = c.id and r.user_id is not null)
    and not exists (select 1 from public.wishlist w where w.condition_id = c.id);

  return v_count;
end;
$fn$;

revoke all on function public.prune_recommendations(int, int) from public, anon, authenticated;

-- 매일 실행. Database → Extensions에서 pg_cron을 켠 뒤:
-- select cron.schedule('prune-recommendations', '10 4 * * *', 'select public.prune_recommendations()');


-- 004-15. 보완 (09-30, 004-1~14 실행 뒤 이어서 실행)
-- (1) 선택지 사용 여부와 중지 시각이 어긋나지 않게
alter table public.choice_option
  add constraint choice_option_active_retired_check
  check ((is_active and retired_at is null) or (not is_active and retired_at is not null));

-- (2) 탈퇴로 user_id가 비워진 조건의 출발지도 지운다. 비회원 조건에는 원래 출발지가 없으므로
--     "user_id NULL이면 출발지 없음"이 항상 성립해야 한다.
create or replace function public.prune_recommendations(p_days int default 90, p_keep int default 20)
returns int
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_count int;
begin
  with targets as (
    select x.id from (
      select r.id, r.created_at,
             row_number() over (partition by r.user_id order by r.created_at desc) as rn
      from public.recommendation r
      where r.user_id is not null
    ) x
    where x.rn > p_keep or x.created_at < now() - make_interval(days => p_days)
  ),
  done as (
    update public.recommendation r set user_id = null
    from targets t where r.id = t.id
    returning r.id
  )
  select count(*) into v_count from done;

  update public.search_condition c set user_id = null
  where c.user_id is not null
    and not exists (select 1 from public.recommendation r where r.condition_id = c.id and r.user_id is not null)
    and not exists (select 1 from public.wishlist w where w.condition_id = c.id);

  delete from public.search_origin o
  using public.search_condition c
  where c.id = o.condition_id and c.user_id is null;

  return v_count;
end;
$fn$;

revoke all on function public.prune_recommendations(int, int) from public, anon, authenticated;


-- ───────────────────────────────────────────────────────────────────────────
-- 005. 안 쓰는 테이블 정리 — 준비만, 단계별로 실행
-- 확인 기준(09-30): src·api·scripts에서 테이블 이름 참조를 검색. 탈퇴 함수(delete_own_account)는
--   auth.users만 지우고 나머지는 cascade라 아래 삭제와 무관.
-- 실행 전: 대상 테이블 행 수를 확인하고, 운영 DB라면 백업부터.
-- ───────────────────────────────────────────────────────────────────────────

-- 실행 전 확인. 이미 지운 테이블은 '없음'으로 나온다
select t, case when to_regclass('public.' || t) is null then '없음'
               else (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t), false, true, '')))[1]::text
          end as row_count
from unnest(array['mint_profiles', 'place_buzz_cache', 'license_cache', 'recommendation_log', 'mint_activity_log']) as t;

-- 005-1. 지금 삭제 가능
--   mint_profiles: 001에서 users로 옮김. 코드 참조 0.
--   place_buzz_cache: 블로그 버즈 파이프라인 삭제(e88f93f). 참조는 일회성 이관 스크립트뿐.
drop table if exists public.mint_profiles;
drop table if exists public.place_buzz_cache;

-- 005-2. 인허가 캐시 (09-30 유저 결정: 삭제. dev 189MB)
--   license_cache: 읽는 코드가 없었다. 적재 배치(api/_routes/admin-batch.ts)를 먼저 지우고 배포한 뒤 실행.
--   다시 필요하면 git 기록에서 배치를 꺼내 재적재.
drop table if exists public.license_cache;

-- 005-3. 코드 교체 뒤 삭제 (지금 지우면 동작이 깨짐)
--   recommendation_log: 추천 API가 아직 쓰고 결과 화면이 id를 참조. 추천 API가 004 테이블에 쓰도록 바뀐 뒤.
--   mint_activity_log: 회원 활동 기록(프로필·홈이 읽고 씀). 지난 추천이 004 recommendation으로 바뀐 뒤.
-- drop table if exists public.recommendation_log;
-- drop table if exists public.mint_activity_log;

-- 005-4. 나중 (어드민 교체 후)
--   events: 어드민 대시보드·/api/count가 읽는다. 19번 노트: 어드민 교체 후 제거, 비회원 퍼널은 GTM으로.
-- drop table if exists public.events;


-- ───────────────────────────────────────────────────────────────────────────
-- 006. 익명 로그인 제거 (09-30)
-- 비회원은 서버에 아무것도 남기지 않는다(19번 노트). 앱은 더 이상 signInAnonymously를 부르지 않는다.
-- 대시보드: Authentication → Sign In / Providers → Anonymous sign-ins OFF (001의 전제를 뒤집는다).
-- 순서: 앱 배포 → 설정 OFF → 아래 삭제. 배포 전에 지우면 열려 있던 탭이 세션 오류를 볼 수 있다.
-- public.users는 auth.users FK cascade로 같이 지워진다.
-- ───────────────────────────────────────────────────────────────────────────

-- 확인
select count(*) as anonymous_users from auth.users where is_anonymous;

-- 삭제
delete from auth.users where is_anonymous;


-- ───────────────────────────────────────────────────────────────────────────
-- 007. 004 보완 (09-30 코드리뷰)
-- ───────────────────────────────────────────────────────────────────────────

-- 007-1. 슬롯 행동 쓰기 판정
-- 정책 안의 조회에도 recommendation·recommendation_slot의 RLS가 걸려서, 비로그인은 두 테이블을 못 읽고
-- "비회원 통계 추천이면 허용" 조건이 절대 참이 될 수 없었다. 판정만 권한 우회 함수로 뺀다.
create or replace function public.can_act_on_slot(p_slot bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.recommendation_slot s
    join public.recommendation r on r.id = s.recommendation_id
    where s.id = p_slot and (r.user_id is null or r.user_id = auth.uid())
  );
$fn$;

drop policy if exists slot_action_insert on public.slot_action;
create policy slot_action_insert on public.slot_action
  for insert to anon, authenticated
  with check (public.can_act_on_slot(slot_id));


-- 007-2. 정리 작업과 추천 저장의 경합
-- 추천 API는 조건과 추천을 따로 저장한다. 그 사이에 정리가 돌면 막 저장한 조건이 익명화된다.
-- 만든 지 1시간이 안 된 조건은 건드리지 않는다.
create or replace function public.prune_recommendations(p_days int default 90, p_keep int default 20)
returns int
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_count int;
begin
  with targets as (
    select x.id from (
      select r.id, r.created_at,
             row_number() over (partition by r.user_id order by r.created_at desc) as rn
      from public.recommendation r
      where r.user_id is not null
    ) x
    where x.rn > p_keep or x.created_at < now() - make_interval(days => p_days)
  ),
  done as (
    update public.recommendation r set user_id = null
    from targets t where r.id = t.id
    returning r.id
  )
  select count(*) into v_count from done;

  update public.search_condition c set user_id = null
  where c.user_id is not null
    and c.created_at < now() - interval '1 hour'
    and not exists (select 1 from public.recommendation r where r.condition_id = c.id and r.user_id is not null)
    and not exists (select 1 from public.wishlist w where w.condition_id = c.id);

  delete from public.search_origin o
  using public.search_condition c
  where c.id = o.condition_id and c.user_id is null;

  return v_count;
end;
$fn$;

revoke all on function public.prune_recommendations(int, int) from public, anon, authenticated;
