# 21. 허용 값(check) 바꾸는 법

대상: v2 스키마에서 칸마다 걸어둔 허용 값 목록. 예) 슬롯 행동은 map_open·reserve·share·wish만 받는다.

## 언제 check, 언제 테이블 행인가

기준은 하나다. **값이 늘 때 코드도 같이 고쳐야 하는가.**

| 방식 | 대상 | 새 값 추가 |
|---|---|---|
| check | 목적, 코스, 역할, 지역 방식, 다시 추천받기 사유, 검색 종류, 슬롯 행동, 포인트 종류, 인원 구간, 예산, 관계, 선택지 종류(kind) | 이 문서 절차 |
| 테이블 행 | 분위기·취향·조건·추천 키워드 칩(choice_option) | 행 추가. 스키마 변경 없음 |

check 대상은 값이 늘면 앱이나 서버가 그 값을 처리하는 코드가 어차피 필요하다. 그 배포에 check 수정을 같이 넣는다.

## 절차

### 1. 제약 이름 찾기

칸 정의에 붙여 쓴 check는 PostgreSQL이 `테이블_칸_check`로 이름을 붙인다. 예) `slot_action_action_check`. 확실히 하려면 조회:

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.slot_action'::regclass and contype = 'c';
```

### 2. 지우고 새로 걸기 (한 트랜잭션)

```sql
begin;
alter table public.slot_action drop constraint slot_action_action_check;
alter table public.slot_action add constraint slot_action_action_check
  check (action in ('map_open', 'reserve', 'share', 'wish', 'call'));
commit;
```

- 값을 **추가**할 때는 기존 행이 모두 통과하므로 바로 된다.
- 값을 **빼면** 그 값을 가진 기존 행 때문에 실패한다. 먼저 정리하거나, 옛 행은 두고 새 행만 막으려면 `not valid`를 붙인다.

```sql
alter table public.slot_action add constraint slot_action_action_check
  check (action in ('map_open', 'reserve', 'share')) not valid;
-- 옛 행을 정리한 뒤: alter table public.slot_action validate constraint slot_action_action_check;
```

- 행이 많은 테이블은 `not valid`로 걸고 `validate`를 따로 돌리면 쓰기 잠금이 짧다.

### 3. 코드도 같이 고치기

같은 값 목록이 코드에도 있다. 한쪽만 고치면 DB가 거부하거나 화면에 값이 안 나온다.

| 칸 | 코드 위치 |
|---|---|
| 목적 | src/components/PurposeSelect.tsx, api/_routes/recommend-search.ts |
| 인원 구간 | src/components/HomeStepsView.tsx |
| 관계·행사 | api/_lib/occasion.ts |
| 예산 | src/constants/vibeOptions.ts (BUDGET_OPTIONS) |
| 다시 추천받기 사유 | src/hooks/useRecommendActions.ts (handleReject) |
| 선택지 칩 | src/constants/vibeOptions.ts. DB의 choice_option 행과 맞출 것 |

1-1 구현(추천 API 자동 저장, 찜·슬롯 행동) 때 새로 생기는 칸의 코드 위치는 그때 이 표에 추가한다.

### 4. 기록

- `sql/v2-schema.sql`에 실행한 문장을 새 절로 추가하고 첫머리 이력에 한 줄.
- dev에서 먼저 실행하고, prod에는 릴리즈 때 같은 문장을 그대로.

## 선택지 칩 추가·중지 (행 방식)

```sql
-- 추가
insert into public.choice_option (kind, code, label) values ('mood', 'atm_calm', '차분한');

-- 중지 (지우지 않는다. 옛 추천이 가리키고 있을 수 있다)
update public.choice_option set is_active = false, retired_at = now() where code = 'atm_calm';
```

- `is_active`와 `retired_at`은 같이 바꾼다. 어긋나면 제약(choice_option_active_retired_check)이 거부한다.
- 화면 칩 목록(vibeOptions.ts)도 같이 맞춘다. 지금은 화면이 DB를 읽지 않고 상수를 쓴다.
