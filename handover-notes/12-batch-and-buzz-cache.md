# 12. 배치(admin-batch)와 버즈 캐시

> **2026-09-30 갱신:** 관리자 배치(`/api/admin/batch`, refresh-license)와 크론은 삭제됐다. 인허가 캐시(license_cache)·버즈 캐시(place_buzz_cache)도 삭제 대상(v2-schema 005). 아래의 배치·크론 설명은 과거 기록이다. 현재 계획은 20번 노트.

정리일: 2026-09-16
대상 파일: [api/admin-batch.ts](../api/admin/batch.ts), [api/_lib/blogBuzz.ts](../api/_lib/blogBuzz.ts), [api/_lib/scoring.ts](../api/_lib/scoring.ts)

## 한 줄 요약

**"돈 주고 만든 맛집"을 걸러내기 위한 캐시 워머다.** 네이버 블로그 글을 긁어 협찬 냄새를 점수화해두고, 추천할 때 그 점수만큼 감점한다.

## 엔드포인트 구조

`api/*.ts` 파일이 13개가 되면서 Hobby의 **배포당 함수 12개** 상한에 걸려 빌드가 통째로 막힌 적이 있다. 그래서 원래 `admin-warm-buzz-cache` / `admin-refresh-license-cache` 두 파일이던 것을 하나로 합치고 메서드·action으로 분기한다. 동작 계약은 합치기 전과 동일하다.

| 메서드 | 인증 | 용도 | 트리거 |
|---|---|---|---|
| `GET` | `Authorization: Bearer $CRON_SECRET` | 버즈 캐시 워밍 (인기 지역 고정 목록) | **Vercel Cron, 자동** |
| `POST` `action=warm-buzz` | `x-admin-secret: $ADMIN_REFRESH_SECRET` | 버즈 캐시 워밍 (지역 지정) | 수동 |
| `POST` `action=refresh-license` | 동일 | 인허가 데이터 적재 | 수동, 월 1회 |

GET 분기가 action 검사보다 **앞에** 있어야 한다. Vercel Cron은 GET으로만 때리고 body를 싣지 못한다. [admin-batch.ts:254-262](../api/admin/batch.ts#L254-L262)에 그 주의가 적혀 있다. 순서를 바꾸면 크론이 죽는다.

---

## 크론이 실제로 하는 일

스케줄: `vercel.json`의 `"0 18 * * *"` = **UTC 18시 = 한국시간 새벽 3시.**
Hobby는 정시 보장이 없어 03:00~03:59 사이 아무 때나 발화한다.

흐름:

```
인기 지역 18곳 × 키워드 3개(맛집/술집/카페)
  → 네이버 지역검색(display=8, sort=comment)  ... 지역·키워드당 상위 8곳
    → 각 가게마다 네이버 블로그검색(display=30, sort=date)
      → 본문 텍스트에서 bubbleScore 계산
        → place_buzz_cache에 upsert (TTL 14일)
```

지역 목록은 [admin-batch.ts:40-44](../api/admin/batch.ts#L40-L44)에 하드코딩돼 있다. 크론은 body를 못 실으니 코드에 둘 수밖에 없다. **앞쪽일수록 우선순위가 높다** — 시간이 부족하면 뒤쪽이 잘린다.

```
강남역, 성수동, 홍대, 연남동, 이태원, 건대입구,
신촌, 잠실, 여의도, 종로, 명동, 한남동,
합정, 성수, 망원동, 을지로, 삼성역, 가로수길
```

## bubbleScore 공식

[blogBuzz.ts:73-77](../api/_lib/blogBuzz.ts#L73-L77):

```
bubbleScore = 협찬률 × 45
            + 버스티니스 × 30
            + 최근급증 × 25
            − 재방문률 × 30          (0~100으로 clamp)
```

| 항목 | 계산 방식 |
|---|---|
| 협찬률 | 글 본문에 `협찬 / 체험단 / 원고료 / 제공받아 / 지원받아 / 초청 / 무상으로 / 서포터즈` 중 하나라도 있는 글의 비율 |
| 버스티니스 | 글을 월 단위로 버킷팅해 **3개월 슬라이딩 윈도우 최대 밀집도** ÷ 전체 글 수. 한 번에 뿌린 마케팅이면 1에 가까워진다 |
| 최근급증 | 최근 90일 내 글의 비율 |
| 재방문률 | `재방문 / 또 왔 / 단골 / N번째 / 자주 가 / 자주 오` 가 있는 글의 비율. **유일하게 점수를 깎는 항목** — 진짜 단골이 있다는 신호 |

**높을수록 돈으로 만든 맛집이다.**

가드: 블로그 글이 3건 미만이면 계산을 포기하고 전부 0을 반환한다([blogBuzz.ts:55-57](../api/_lib/blogBuzz.ts#L55-L57)). 표본이 적으면 비율이 무의미하기 때문.

## 추천에서 어떻게 쓰이는가

핵심은 **`recommend.ts`가 캐시만 읽는다**는 것이다. 응답 경로에서 라이브 블로그 fetch를 절대 하지 않는다. 함수 이름부터 `getBubbleScoresCacheOnly`다. 쓰이는 곳은 두 군데.

**1) L2 — Claude 프롬프트에 힌트 주입** ([recommend.ts:1051-1058](../api/recommend.ts#L1051-L1058))

후보 목록을 프롬프트에 넣을 때 가게 이름 뒤에 이런 꼬리표를 붙인다:

```
(참고: 버즈 320건, 협찬률 67%)
```

Claude가 거품 가게를 **애초에 덜 고르게** 유도한다.

**2) L1/L3 — 최종 점수에서 감점** ([recommend.ts:1344-1351](../api/recommend.ts#L1344-L1351) → [scoring.ts:40](../api/_lib/scoring.ts#L40))

```
bubblePenalty = bubbleScore × 0.15      → 최대 15점 감점
finalScore = fitScore − bubblePenalty − discrepancyPenalty + gemBonus + keywordHitBonus
```

## 그래서 크론이 안 돌면?

**에러가 안 난다.** 로그도 안 남는다. 캐시 미스는 그냥 0점 처리되고, 0점은 곧 감점 없음이다.

코드 주석이 이걸 명시한다 — [recommend.ts:1342](../api/recommend.ts#L1342): *"캐시 미스는 0점(=감점 없음, 기존 실패 폴백과 동일) — 야간 크론이 캐시를 채운다."*

즉 **크론이 죽으면 거품 필터가 조용히 꺼진 채로 서비스가 계속 돈다.** 아무도 모른다. 추천 품질만 서서히 나빠진다. 모니터링 대상으로 올려둘 가치가 있다.

## 발견: 크론은 한 번에 전부 못 돈다

시간 예산이 50초다([admin-batch.ts:34](../api/admin/batch.ts#L34), `maxDuration` 60초 안에서 여유). 예산을 넘기면 `break outer`로 중간에 끊는다.

전량은 18지역 × 3키워드 × 8곳 = **최대 432곳**인데, 캐시 미스 한 건당 네이버 블로그 검색 1회가 들어가므로 50초에 다 못 돈다. 첫날엔 목록 뒤쪽(합정·성수·망원동·을지로·삼성역·가로수길)까지 못 닿는다.

**다만 버그는 아니다.** 캐시 히트는 Supabase 읽기 한 번이라 빠르게 스킵되므로, 앞쪽이 따뜻해질수록 밤마다 뒤쪽으로 전진한다. 자가 치유된다.

알아둘 것: **인기 지역 목록에 새 지역을 추가하면 며칠 걸린다.** 급하면 POST로 수동 워밍하는 게 빠르다.

---

## 수동 실행 (POST)

### 버즈 캐시 워밍

```bash
# 지역 하나
curl -X POST https://www.meetatmint.com/api/admin/batch \
  -H "x-admin-secret: $ADMIN_REFRESH_SECRET" \
  -H "content-type: application/json" \
  -d '{"action":"warm-buzz","region":"성수동"}'

# 여러 지역 (50초 예산 내에서 끊기면 remainingRegions로 알려준다)
  -d '{"action":"warm-buzz","regions":["성수동","강남역","연남동"]}'
```

응답의 `done: false`면 `remainingRegions`를 다시 넣어 이어서 호출한다.

### 인허가 데이터 적재

행안부 일반음식점 인허가 데이터를 `license_cache`에 적재한다. 용도는 **영업연차 계산**이다 — [publicData.ts:106](../api/_lib/publicData.ts#L106)의 `lookupYearsAlive()`가 좌표 50m 이내 + 이름 매칭으로 인허가일자를 찾아, L0 단계의 "공공데이터 발굴 후보(노포)" 선별에 쓴다. 매칭 실패 시 `undefined`라 localGem 0점이 되어 자연히 탈락한다.

```bash
# 처음부터
curl -X POST https://www.meetatmint.com/api/admin/batch \
  -H "x-admin-secret: $ADMIN_REFRESH_SECRET" \
  -H "content-type: application/json" \
  -d '{"action":"refresh-license","regionCode":"3220000"}'

# done:false로 끊겼으면 nextPageNo를 넣어 이어받기 (resetRegion:false 필수)
  -d '{"action":"refresh-license","regionCode":"3220000","pageNo":11,"resetRegion":false}'
```

**주의 두 가지:**

- `regionCode`는 행안부 표준 5자리가 아니라 **LOCALDATA 체계 7자리**다. 서울 강남구 = `3220000`. 실제 API 응답으로 검증된 값이다([admin-batch.ts:112-113](../api/admin/batch.ts#L112-L113)).
- **`pageNo` 없이(=1페이지부터) 호출하면 해당 region_code의 기존 행을 먼저 전부 지운다**([admin-batch.ts:176-178](../api/admin/batch.ts#L176-L178)). 이어받기 호출에 `resetRegion:false`를 빠뜨리면 앞서 넣은 걸 날리고 다시 시작한다.

지역 하나가 크다(강남구 51,000건 이상). 한 번의 호출로 전량을 못 가져오므로 `done:true`가 될 때까지 반복 호출하는 구조다.

---

## 개발 서버(dev)에 주는 함의

dev에서 크론을 끄는 건 **위험해서가 아니다.**

`place_buzz_cache`는 공개 데이터에서 파생한 캐시 테이블이고 upsert에 TTL 14일이다. dev가 운영 DB를 보며 하루 두 번 돌아도 같은 공개 API에서 같은 값을 다시 써넣을 뿐이라 데이터가 깨지지 않는다. 끄는 이유는 위생이다 — 이유 없이 네이버 쿼터를 두 배 쓸 일이 없다.

실제 구현은 대시보드 버튼이 아니라 **러너에서 `jq 'del(.crons)'`로 `vercel.json`을 고치는 방식**이다([deploy.yml](../.github/workflows/deploy.yml)의 `Strip cron jobs and block indexing (dev only)` 스텝). 버전 관리에 남고, 프로젝트를 다시 만들어도 잊어버릴 일이 없다.

**진짜 주의할 건 크론이 아니라 `refresh-license`다.** 수동 실행이지만 첫 페이지 호출 시 해당 지역 행을 **삭제하고** 시작한다. 지금은 dev와 운영이 Supabase를 분리했으므로 사고가 나지 않지만, 어떤 이유로든 dev가 운영 DB를 보게 되는 순간 이 명령 하나로 운영 `license_cache`가 지워진다. **dev의 `ADMIN_REFRESH_SECRET`은 운영과 다른 값으로 둘 것.**
