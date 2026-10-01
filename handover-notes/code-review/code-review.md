# 코드 리뷰 (최신 1건만 유지, 다시 쓸 때 통째로 교체)

- 리뷰일: 2026-10-01
- 대상: dev 브랜치 미커밋 변경 전체(수정 33, 새 파일 9, sql/v2-schema.sql 010절 포함)
- 기준: 20-work-plan.md 4번 절(저장 정리 1·2·3단계)
- 코드는 수정하지 않았다. 발견 사항만 정리.

## 검증 결과

| 항목 | 결과 |
|---|---|
| `npx vitest run` | 14개 파일, 98개 테스트 통과 |
| `npx tsc -b` | 통과 |
| `npx eslint .` | 21건. HEAD 사본과 파일·규칙 단위로 동일, 새 위반 없음 |
| api 타입 검사(임시 tsconfig, src/types 포함) | hcx.ts의 기존 erasableSyntaxOnly 2건만. 나머지 통과 |
| SQL(pglast 8.4) | 파일 전체 229문, 010절 17문, wish_from_slot·cleanup_expired 본문(plpgsql) 파싱 통과 |
| midpointCore.ts 이동 | HEAD의 src/services/midpoint.ts와 로직 동일(헤더·타입 정의만 추가) |

## 높음

### 1. 탭을 옮길 때마다 결과가 서버 복원으로 다시 그려지고 정보 일부가 사라진다
- 위치: src/pages/AppShell.tsx:69, src/hooks/useHomePersistence.ts:41-71
- 원인: AppShell이 `key={activeTab}`로 탭 전환 때 Home을 언마운트한다. 결과 상태는 Home 안에 있다. 예전엔 폰 스냅샷을 동기로 읽어 문제가 없었지만, 이제 마운트마다 로딩 화면 → /api/restore → 카카오 재검색.
- 재현: 추천 받기 → 프로필 탭 → 홈 탭. 로딩 화면이 뜨고 설명·가격대·태그·사진·영업시간·3차·총무·이동시간이 사라진다(enrichPlaces는 추천할 때만 돈다). 계획엔 "새로고침 뒤 없음"만 적혀 있다.
- 추가: 66줄이 네트워크 오류·429에도 clearResultSnapshot()을 불러, 잠깐 끊긴 사이 탭을 옮기면 결과가 영구히 사라진다.
- 고치는 방법: 받은 결과를 메모리에 유지(AppShell로 상태를 올리거나 모듈 수준에서 추천 ID별 보관, 저장소에는 넣지 않음)하고 서버 복원은 실제 새로고침 때만. 스냅샷은 403·404일 때만 지운다.

### 2. 공유·그룹 복원 응답의 검색 중심으로 공유한 사람의 출발지를 역산할 수 있다
- 위치: api/_lib/recAccess.ts:89-97, api/_lib/midpointCore.ts:178-187
- 원인: 상권에 스냅되지 않은 자동 중간지점은 출발지들의 정확한 무게중심이다.
- 재현: A·B가 출발지 2곳으로 추천 → A가 B에게 공유 → /api/restore 응답의 center로 `center × 2 − B의 출발지` = A의 출발지 좌표. 링크를 전달받은 사람도 7일간 같다. "출발지는 주지 않는다(준식별 정보)" 원칙 위반.
- 고치는 방법: share 종류는 center를 돌려주지 않는다. 슬롯 재검색을 서버가 하고 화면용 이름·주소·좌표만 응답(저장 안 함). session에도 같이 쓰면 "참여자 좌표 노출" 남은 일도 줄어든다.

## 중간

### 3. wish_from_slot이 공유한 사람의 자유 입력 문구까지 복사해, 찜한 사람이 읽을 수 있다
- 위치: sql/v2-schema.sql:1119-1124
- 원인: relation·occasion(특별한 날·기타 콕 직접 입력)·budget·종류 경로까지 복사한다. 복사본은 user_id = 찜한 사람이라 RLS(can_read_condition)가 읽기를 허용한다. /api/restore는 이 칸들을 일부러 빼고 있다.
- 재현: 공유 링크를 받은 회원이 하트 → anon 키 + 자기 JWT로 search_condition `select *` → 상대의 occasion 문구가 보인다.
- 추가: 이미 찜한 가게여도(on conflict do nothing) 조건 복사본이 매번 생긴다. 하트를 켰다 껐다 하거나 반복 호출하면 고아 행이 쌓인다.
- 고치는 방법: 복원에 필요한 칸만 복사(mode, group_size, 목적, area_*, region_level), 나머지는 NULL. 복사 전에 wishlist에 이미 있으면 바로 끝낸다.

### 4. 새 결과에 record가 없으면 예전 추천이 되살아나고, 그룹 게스트는 계속 대기한다
- 위치: src/hooks/useHomePersistence.ts:188-189, 211-212
- 원인: save_recommendation이 실패해도 추천 응답은 나가고 record만 빠진다(api/_routes/recommend-search.ts:586). 그러면 스냅샷 저장을 건너뛰어 이전 추천 스냅샷이 남는다.
- 재현: 추천 A → 다시 추천받기 B(저장 실패) → 탭 이동·새로고침 → A가 복원된다.
- 그룹 호스트: 결과 전달을 아예 건너뛴다. 예전엔 저장 실패와 무관하게 result_json이 갔다.
- 고치는 방법: record가 없으면 clearResultSnapshot(). 그룹은 호스트에게 "친구들에게 결과를 전달하지 못했어요" 안내.

### 5. 투표 폴링이 계획과 달리 Vercel 함수를 4초마다 부르고, 한 번 실패하면 투표 칸이 사라진다
- 위치: src/pages/SharedResult.tsx:91-110
- 계획 결정은 "Vercel이 아니라 브라우저→Supabase 직접". 지금은 보는 사람 1명당 10분에 함수 호출 최대 150번(Hobby 월 호출 한도에 직접 영향).
- 102줄: 폴링 1회 실패로 setDisabled(true), 다시 켜지지 않아 투표 UI가 계속 숨는다.
- 109줄: 10분이 지나도 visibilitychange 리스너가 남아 탭 복귀마다 조회한다.
- 고치는 방법: 투표 테이블 anon 읽기 정책 + Supabase 직접 조회(또는 Realtime). 실패는 최초 로드에서만 disabled. 10분 뒤 리스너도 해제.

## 낮음

- **공유 링크 저장이 1.5초 안에 끝나기 어려워짐** (api/_routes/share-vote.ts:52-58, src/services/share.ts:20): 레이트리밋(insert + 조회 2번), auth.getUser, 소유 확인, upsert가 차례로 돌고 콜드 스타트까지 겹친다. 넘기면 옛 ?data= 링크로 폴백(1차만, 가게명·주소·좌표가 URL에). 실측 필요. 레이트리밋과 회원 확인을 병렬로 하거나 시간 제한을 늘린다.
- **010-3(place_name 삭제) 실행 후 배포 전까지 투표 실패**: 배포된 코드가 place_name을 써서 upsert가 오류 → {ok:false}. 010-3만 배포 뒤로 미룬다. 운영 릴리즈도 같음.
- **배포 순간 열려 있던 옛 화면의 호스트가 결과 전달 실패** (api/_routes/session.ts:55): 판별 키가 recommendationId로 바뀌어 옛 번들의 {result}는 400.
- **그룹 복원 중심이 "현재" 참여자 좌표로 계산됨** (api/_lib/recAccess.ts:82-88): 호스트 추천 뒤 참여·출발지 재제출이 있으면 중심이 달라져 가게를 못 찾는다. `submitted_at <= result_at` 참여자만 쓴다.
- **그룹 세션이 살아 있으면 대기 화면 위로 결과 복원 로딩이 덮인다**: 그룹 세션 복원이 setView('steps')를 해도 결과 복원이 끝날 때까지 로딩 화면이 가린다. 복원이 실패하면 입력 초안도 복원되지 않는다(스냅샷이 있다는 이유로 이미 건너뜀).
- **그룹 게스트 하트 로그인 복귀 주소가 /join?...**: 계획의 Redirect URLs 항목엔 /shared만 있다. 와일드카드 범위에 /join이 포함되는지 확인.
- **목업 발굴 페이지 찜이 한 번 지워짐**: legacyCleanup이 mint_wishlist를 지우는데 발굴 페이지(LocalWish)가 아직 이 키를 쓴다. 목업이라 영향은 적지만 의도 확인.

## 문제없음을 확인한 부분

- /api/restore 권한 판정: own은 회원이면 user_id, 비회원이면 일회용 토큰(익명화·이미 옮긴 추천은 403). share는 만료 확인. session은 세션 ID 소지자. 공유 링크 저장·그룹 결과 전달도 같은 소유 확인을 거친다.
- 010 권한·정리: share_link는 RLS 켜고 정책 없음(서버 전용). wish_from_slot은 anon 실행 회수, 공유 링크(만료 전)·세션이 그 추천을 실제로 가리킬 때만 허용. cleanup_expired는 모든 역할 실행 회수, 대상 컬럼(api_hits.ts 등)이 실제 스키마와 일치.
- 복원된 가게 순서: API 응답 순서(1차 대표, 2차 대표, 1차 대안, 2차 대안)와 같아 ResultCard의 slice(2,4)와 맞는다.

## 확인 못 함 (카카오 재검색, 로컬 키 제한으로 실행 불가)

- **서버 출발지 재검색이 첫 페이지 15건만 본다** (api/_lib/recAccess.ts:39): 출발지 장소가 16번째 이후로 밀리면 상권 좌표로 근사 → 추천 때와 중심이 달라질 수 있다. 앱의 resolveCenter도 같은 한계.
- **서버 계산 중심으로 findById(기록 페이지 + 앞뒤)를 돌렸을 때 같은 ID가 나오는지**: 계산 규칙(무게중심, 스냅 시 area_label 좌표)이 앱과 같다는 것까지는 코드로 확인. 실제 결과는 카카오 결과 순서 안정성에 달렸다.
- **카톡 인앱 브라우저에서 처음 연 /shared의 재검색**: JS 키 도메인 제한·SDK 로드는 dev 배포에서만 확인 가능.
- **입력 초안의 출발지·지역 재검색**: resolveOrigins·resolveMeetingLocation이 첫 결과에서 같은 ID·라벨을 못 찾으면 그 항목은 조용히 빠진다(설계대로). 실제 빈도는 미확인.
