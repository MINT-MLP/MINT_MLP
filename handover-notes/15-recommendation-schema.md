# 15. 추천 도메인 테이블 설계 (개편 2단계 · FS-96 4번 "지난 추천")

작성일: 2026-09-22
상태: **보류(2026-09-22)** — 찜·포인트·인증(14번)을 먼저 하고 이력은 나중에. 다시 열 때 점수는 candidate_signal(name,value)로 분리하고 recommendation에 algorithm_version 추가하기로 함(알고리즘이 바뀌어도 조건·제시·선택은 불변, 점수만 바뀜)
전제: 14번 노트(회원 데이터)와 같은 원칙 — JSON 컬럼 없음, 한글 comment, 재실행 안전. 기존 `recommendation_log`(jsonb 덩어리)를 대체한다.

## 1. 이 테이블들이 답해야 하는 질문

| 질문 | 누가 | 어디서 답하나 |
|---|---|---|
| 회원의 지난 추천을 다시 열 수 있나 | 유저 (FS-96 4번) | recommendation + candidate(displayed) → 결과 화면 재구성 |
| 어떤 조건에서 어떤 후보가 제시됐고 무엇이 선택됐나 | 알고리즘 보정 (결정 로그 "조건→선택→방문") | recommendation(조건) + candidate(제시) + selection(선택) + visit_certification(방문) |
| 비슷한 조건의 모임 N팀이 여기로 정했다 | 결과 화면 R-01b | recommendation 조건 컬럼으로 필터 + selection 집계 |
| 한 탐색에서 재시도·조정이 몇 번 있었나 | 어드민 퍼널 | recommendation.retried_from_id 체인 + change_reason |

지금 `recommendation_log`는 조건은 열로, 후보는 `candidates jsonb`로 넣어서 두 번째·세 번째 질문에 SQL로 답할 수 없다. 그걸 푸는 게 목적이다.

## 2. 테이블

### 2-1. recommendation — 추천 한 번 (요청 + 응답 메타)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | bigint identity PK | |
| serial | text unique | 파일럿 일련번호(6자, 유저 비노출 조인키). 기존 그대로 |
| user_id | uuid null FK users | 요청자. 익명 세션도 user_id가 있으니 넣는다. 세션 없으면 null |
| session_key | text | 탐색 에피소드 키(클라이언트 생성). 기존 그대로 |
| group_session_id | text null | 그룹 모드면 mint_sessions.id (모임 도메인 개편 시 FK) |
| retried_from_id | bigint null FK recommendation | 같은 에피소드의 직전 추천. 기존 `retried boolean` 대체 — 체인이 남는다 |
| change_reason | text null | 직전 대비 이유: retry / adjust / expensive / far / vibe (클라이언트 ChangeReason) |
| group_size | text | '2명' / '3~4명' / '5명 이상' |
| purpose_first, purpose_second | text | 라벨('밥', '술', '카페', 직접 입력 메뉴) |
| purpose_first_raw, purpose_second_raw | text | 프리셋 코드('밥'…'기타', '없음'). 통계는 raw로 |
| relation, occasion, budget | text null | |
| region_type | text | 'auto'(중간지점) / 'manual'(직접) |
| region_label | text null | manual일 때 라벨 |
| region_level | text null | city / district / dong |
| midpoint_lat, midpoint_lng | double precision | 최종 검색 기준점 |
| weather_desc | text null | 프롬프트에 넣은 날씨 |
| weather_temp | numeric null | |
| is_rainy | boolean null | |
| model | text | 실제 응답한 Claude 모델 |
| ai_ms | integer | LLM 호출 시간 |
| candidate_pool_size | integer | 네이버+공공 후보 수 (모델에 넘긴 수) |
| created_at | timestamptz | |

### 2-2. recommendation_tag — 배열 조건 (분위기·키워드)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| recommendation_id | bigint FK recommendation cascade | |
| slot | smallint | 1 = 1차, 2 = 2차 |
| kind | text | 'vibe' / 'keyword' |
| value | text | 칩 라벨 |

PK (recommendation_id, slot, kind, value). vibe와 keywords가 배열이라 별도 행. `excludeFoods`는 제거 결정에 따라 넣지 않는다.

### 2-3. recommendation_origin — 출발지

| 컬럼 | 타입 | 설명 |
|---|---|---|
| recommendation_id | bigint FK cascade | |
| idx | smallint | 입력 순서 |
| name | text | 유저가 적은 이름 |
| lat, lng | double precision null | |

PK (recommendation_id, idx). 그룹 모드는 멤버 출발지가 여기로 복사된다(추천 시점 스냅샷).

### 2-4. recommendation_candidate — 모델에게 제시된 파이널리스트와 그 점수

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | bigint identity PK | |
| recommendation_id | bigint FK cascade | |
| place_key | text | 이름\|주소. places 테이블 도입 후 place_id 추가 |
| place_name, address, category | text | 네이버/공공 실데이터 사본 |
| area | text null | |
| lat, lng | double precision | |
| source | text | 'naver' / 'public'(발굴) / 'kakao'(3차·보충) |
| purpose_slot | smallint | 1 / 2 / 3(3차) |
| slot_rank | smallint null | 모델이 매긴 슬롯 내 순위 |
| naver_rank | smallint null | 네이버 검색 노출 순위(괴리 감지용) |
| is_public_gem | boolean | 공공데이터 발굴 후보 |
| fit_score | smallint null | 모델 적합도 0~100 (추정값) |
| bubble_score | real null | 버즈 거품 점수 |
| buzz_count | integer null | |
| final_score | real null | L3 보정 후 |
| display_role | text null | 화면 노출 자리: first / second / third / alt. null = 미노출 |
| display_rank | smallint null | 화면 rank(1~6, 3차 99) |
| description | text null | 모델이 쓴 한 줄 (추정) |
| price_range | text null | 모델 추정 (화면 표기 방침은 기획 결정) |
| vibe_tags | text[] | 모델 추정 태그. Postgres 배열 — JSON 덩어리가 아니라 검색·집계 가능 |
| walking_to_next | smallint null | 다음 코스까지 도보 분 |
| image_url, kakao_place_url | text null | enrich 단계에서 채움(응답 후 update) |
| created_at | timestamptz | |

인덱스: (recommendation_id), (place_key), (recommendation_id, display_role).

- "지난 추천 다시 열기"는 `display_role is not null`인 행만 읽어 결과 화면을 그린다. 공유 페이지가 스냅샷으로 그리는 것과 같은 필드 집합이라 SlimPlace로 바로 매핑된다.
- 모델에게 갔지만 탈락한 후보도 남는다. "무엇을 제시했는데 무엇을 골랐나"의 절반이 이 행들이다.
- 50개 후보 풀 전체는 저장하지 않는다(파이널리스트 최대 12개만). 풀 크기만 `candidate_pool_size`로.

### 2-5. recommendation_selection — "여기로 정했어요"

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | bigint identity PK | |
| recommendation_id | bigint FK cascade | |
| candidate_id | bigint FK recommendation_candidate | 고른 장소 |
| user_id | uuid null FK users | 고른 사람(익명 포함) |
| source | text | 'one_tap'(R-01b 버튼) / 'share_vote'(공유 투표 확정) / 'visit_cert'(인증으로 소급) |
| created_at | timestamptz | |

unique (recommendation_id, user_id) — 한 추천에 한 사람이 한 번. 바꾸면 update. 방문 인증(14번 `visit_certification.candidate_id`)이 생기면 selection이 없어도 소급 insert(source='visit_cert').

## 3. 흐름

1. `/api/recommend` 응답 직전(지금 L4 자리): recommendation 1행 + tag/origin + candidate N행 insert. 실패해도 응답은 그대로(지금과 같은 원칙). serial 충돌은 재발급.
2. enrich 단계(사진·카카오 URL): candidate를 (recommendation_id, place_key)로 update.
3. 재추천: 클라이언트가 `retried_from_serial`과 `change_reason`을 요청에 실어 보내면 서버가 `retried_from_id`를 채운다. 지금 `session_key`로 이전 행을 update하던 방식보다 정확하고, update 권한이 필요 없다.
4. "여기로 정했어요": 클라이언트가 selection insert (RLS: 본인 user_id). 서버리스 함수 불필요.
5. 회원 이력: `recommendation where user_id = auth.uid()` 최근순 + 각 행의 displayed candidate. 비회원은 UI에서 안 보여준다(행은 있음).

## 4. 접근 제어

| 테이블 | select | insert | update |
|---|---|---|---|
| recommendation, _tag, _origin, _candidate | 본인 행 (user_id = auth.uid()), 회원만 UI 노출 | service role만 (추천 API) | enrich는 service role |
| recommendation_selection | 본인 | 본인 (with check user_id = auth.uid() and 그 recommendation이 본인 것) | 본인 |
| 어드민 집계 | service role (admin-data) | | |

익명도 자기 행은 읽을 수 있게 둔다(공유·재진입 복원에 쓸 여지). 회원 전용은 화면에서 거른다.

## 5. 기존 것과의 관계

- `recommendation_log`는 릴리즈 시점까지 그대로 쓰다가, 새 테이블이 운영에 들어간 뒤 어드민 집계(admin-data)를 새 테이블로 옮기고 나서 drop. 옛 행은 이관하지 않는다(jsonb를 풀어 옮길 가치가 낮고, 알고리즘 보정에 쓸 데이터는 릴리즈 후부터 쌓인다).
- `mint_share_snapshots`(공유 페이지 payload)는 그대로 둔다. 공유는 "그 시점 화면의 사본"이라 스냅샷이 맞다. 다만 `share_id`를 recommendation에 연결하면 좋으니 `recommendation.share_id text null` 추가 후보.
- `events`(행동 로그)는 그대로. selection은 events가 아니라 여기 정식 행이다 — 집계와 조인의 대상이기 때문.
- 14번 노트의 `visit_certification.recommendation_id`는 **`candidate_id`(recommendation_candidate.id)** 로 바꾼다. 어느 추천의 어느 장소인지 한 번에 잡힌다.

## 6. 결정 필요

1. **가격대·분위기 태그 저장 여부.** 모델 추정값이다. 저장은 하되 화면에 "추정" 표기하거나 비노출하는 건 기획 결정. 저장 자체는 나중에 실측과 비교할 재료라 남기는 쪽을 권함.
2. **후보 풀 전체 저장.** 파이널리스트 12개만 vs 모델에 넘긴 50개 전부. 전부 저장하면 "왜 이 집은 후보에도 없었나"를 답할 수 있지만 행이 4배. 지금은 12개만, 필요해지면 확장.
3. **익명 유저의 selection 허용.** 데이터 수집 목적상 허용을 권함(위 설계). 회원만으로 제한하면 11월 마케팅 데이터가 크게 준다.

## 7. 단일 SQL 파일에 들어갈 절 (초안)

```sql
-- ═══ 추천 도메인 (2026-09-22 설계) — recommendation_log 대체 ═══

create table if not exists public.recommendation (
  id                   bigint generated always as identity primary key,
  serial               text unique,
  user_id              uuid references public.users(id) on delete set null,
  session_key          text,
  group_session_id     text,
  retried_from_id      bigint references public.recommendation(id) on delete set null,
  change_reason        text check (change_reason in ('retry','adjust','expensive','far','vibe')),
  group_size           text,
  purpose_first        text,
  purpose_second       text,
  purpose_first_raw    text,
  purpose_second_raw   text,
  relation             text,
  occasion             text,
  budget               text,
  region_type          text check (region_type in ('auto','manual')),
  region_label         text,
  region_level         text check (region_level in ('city','district','dong')),
  midpoint_lat         double precision,
  midpoint_lng         double precision,
  weather_desc         text,
  weather_temp         numeric,
  is_rainy             boolean,
  model                text,
  ai_ms                integer,
  candidate_pool_size  integer,
  created_at           timestamptz not null default now()
);
comment on table public.recommendation is '추천 한 번(요청 조건 + 응답 메타). 후보는 recommendation_candidate, 선택은 recommendation_selection';
comment on column public.recommendation.retried_from_id is '같은 탐색의 직전 추천. 재시도·조정 체인';
create index if not exists idx_recommendation_user_created on public.recommendation (user_id, created_at desc);
create index if not exists idx_recommendation_session on public.recommendation (session_key);
create index if not exists idx_recommendation_created on public.recommendation (created_at desc);

create table if not exists public.recommendation_tag (
  recommendation_id  bigint not null references public.recommendation(id) on delete cascade,
  slot               smallint not null check (slot in (1,2)),
  kind               text not null check (kind in ('vibe','keyword')),
  value              text not null,
  primary key (recommendation_id, slot, kind, value)
);
comment on table public.recommendation_tag is '추천 요청의 배열 조건(분위기·키워드). slot 1=1차 2=2차';

create table if not exists public.recommendation_origin (
  recommendation_id  bigint not null references public.recommendation(id) on delete cascade,
  idx                smallint not null,
  name               text not null,
  lat                double precision,
  lng                double precision,
  primary key (recommendation_id, idx)
);
comment on table public.recommendation_origin is '추천 요청의 출발지들(그룹이면 멤버 출발지 스냅샷)';

create table if not exists public.recommendation_candidate (
  id                 bigint generated always as identity primary key,
  recommendation_id  bigint not null references public.recommendation(id) on delete cascade,
  place_key          text not null,
  place_name         text not null,
  address            text,
  category           text,
  area               text,
  lat                double precision,
  lng                double precision,
  source             text not null check (source in ('naver','public','kakao')),
  purpose_slot       smallint not null check (purpose_slot in (1,2,3)),
  slot_rank          smallint,
  naver_rank         smallint,
  is_public_gem      boolean not null default false,
  fit_score          smallint,
  bubble_score       real,
  buzz_count         integer,
  final_score        real,
  display_role       text check (display_role in ('first','second','third','alt')),
  display_rank       smallint,
  description        text,
  price_range        text,
  vibe_tags          text[],
  walking_to_next    smallint,
  image_url          text,
  kakao_place_url    text,
  created_at         timestamptz not null default now()
);
comment on table  public.recommendation_candidate is '모델에 제시된 파이널리스트와 점수. display_role이 있으면 화면에 나간 것';
comment on column public.recommendation_candidate.fit_score is '모델 자가 채점(추정값). 실측 아님';
comment on column public.recommendation_candidate.price_range is '모델 추정. 화면 표기 방침은 기획 결정';
create index if not exists idx_rec_candidate_rec on public.recommendation_candidate (recommendation_id);
create index if not exists idx_rec_candidate_place on public.recommendation_candidate (place_key);
create index if not exists idx_rec_candidate_display on public.recommendation_candidate (recommendation_id, display_role);

create table if not exists public.recommendation_selection (
  id                 bigint generated always as identity primary key,
  recommendation_id  bigint not null references public.recommendation(id) on delete cascade,
  candidate_id       bigint not null references public.recommendation_candidate(id) on delete cascade,
  user_id            uuid references public.users(id) on delete set null,
  source             text not null check (source in ('one_tap','share_vote','visit_cert')),
  created_at         timestamptz not null default now(),
  unique (recommendation_id, user_id)
);
comment on table public.recommendation_selection is '"여기로 정했어요". 한 추천에 한 사람이 한 번, 바꾸면 update';

-- RLS: 조회는 본인 행, 쓰기는 service role(추천 API). selection만 본인이 직접 insert/update
alter table public.recommendation           enable row level security;
alter table public.recommendation_tag       enable row level security;
alter table public.recommendation_origin    enable row level security;
alter table public.recommendation_candidate enable row level security;
alter table public.recommendation_selection enable row level security;

drop policy if exists recommendation_own_select on public.recommendation;
create policy recommendation_own_select on public.recommendation
  for select to authenticated using (user_id = auth.uid());
drop policy if exists recommendation_tag_own_select on public.recommendation_tag;
create policy recommendation_tag_own_select on public.recommendation_tag
  for select to authenticated using (exists (select 1 from public.recommendation r where r.id = recommendation_id and r.user_id = auth.uid()));
drop policy if exists recommendation_origin_own_select on public.recommendation_origin;
create policy recommendation_origin_own_select on public.recommendation_origin
  for select to authenticated using (exists (select 1 from public.recommendation r where r.id = recommendation_id and r.user_id = auth.uid()));
drop policy if exists recommendation_candidate_own_select on public.recommendation_candidate;
create policy recommendation_candidate_own_select on public.recommendation_candidate
  for select to authenticated using (exists (select 1 from public.recommendation r where r.id = recommendation_id and r.user_id = auth.uid()));

drop policy if exists recommendation_selection_own_select on public.recommendation_selection;
create policy recommendation_selection_own_select on public.recommendation_selection
  for select to authenticated using (user_id = auth.uid());
drop policy if exists recommendation_selection_own_insert on public.recommendation_selection;
create policy recommendation_selection_own_insert on public.recommendation_selection
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.recommendation r where r.id = recommendation_id and r.user_id = auth.uid())
  );
drop policy if exists recommendation_selection_own_update on public.recommendation_selection;
create policy recommendation_selection_own_update on public.recommendation_selection
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
```

검증: 다섯 테이블 rowsecurity true, 정책 8개. 익명 토큰으로 자기 recommendation은 보이고 남의 것은 0행. `insert into recommendation` 은 authenticated로 거부(service role만).
