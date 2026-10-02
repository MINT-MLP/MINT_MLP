# 20. 작업 계획 (2026-09-30 기준, Claude 리마인드용)

근거 노트: 19번(회원·비회원 결정, 4절 확정 항목), 17번 13절(1-1 논의), 18번(코드리뷰).
규칙: 코드는 유저의 진행 신호 뒤에만. 커밋·push 안 함(커밋 제목만 제공). 이모지 금지. SQL은 sql/v2-schema.sql 한 파일에 절 추가.

## 확정된 전제 (다시 논의하지 말 것)

- 검색 우선 구조 유지(카카오 후보 → 코드 필터 → HCX 순위). 09-24 결정, 09-30 재확인.
- 쌓이는 기능(찜·포인트·방문 인증·지난 추천·자동 채우기)은 회원 전용. 비회원 데이터는 저장 안 함.
- 비회원 통계는 수집: 식별자 없이 단순 집계·알고리즘 개선용.
- 카카오 데이터는 장소 ID·place_url만 저장. 출발지는 검색어 + 장소 ID. 중심 좌표는 저장하지 않고 입력에서 다시 계산.
- JSON 컬럼 없음. 선택지는 행으로(사용 여부 boolean + 생성·중지 시각). 새 질문은 NULL 허용 컬럼. 추천에 검색 버전 칸.
- 본인 복원 = localStorage(휘발 감수). 공유 = 공유하기 누를 때만 서버, 7일 뒤 배치 삭제. 그룹 모임 = 서버 7일(제안).
- 폰 데이터는 옮기지 않음. 운영 이관 때 DB 초기화(백업 먼저) + 새 버전 첫 실행 때 옛 localStorage 키 삭제.
- 지난 추천: 90일 + 상한 20건(설정값).
- 사용자 상태는 Zustand store 하나. 서버 데이터는 기능별 hook. 구독 권한 판정은 서버에서만.
- 목업(src/pages/mock)은 퍼블리싱 페이지. 정리 대상 아님.

## 작업 순서

### 1. 1-1 스키마 초안 (v2-schema.sql 새 절)
- 09-30 초안 작성: v2-schema.sql 004절(004-1~14). pglast 파싱 통과.
- **09-30 dev DB 실행 완료(유저)**: 004-1~15 전부. 005-1(mint_profiles·place_buzz_cache 삭제)도 dev에서 실행됨. 005-2~4는 대기.
- 로컬 .env.local은 운영 Supabase(rpnw…)를 가리킨다(dev는 bhsi…). 유저가 알고 있음, 나중에 dev로 바꿀 예정. 로컬에서 DB 쓰는 테스트 금지. 운영 DB에는 004·005가 아직 없음(릴리즈 때).
- 초안에서 정한 것: 90일·20건 초과 추천은 삭제 대신 익명화(user_id NULL)해 통계로 남김, 출발지는 그때 삭제. 카카오맵 링크는 ID로 만들어 저장 안 함. 방문 인증+적립은 서버 전용 함수 certify_visit. 비회원 통계 행에도 슬롯 행동 기록 허용(events와 같은 수준의 스팸 위험 감수).
- 테이블: 검색 조건 / 추천(검색 조건 FK, 검색 버전, user_id) / 추천 슬롯(칸 종류·순서·장소 ID·URL) / 슬롯 행동(종류·시각, 예약하러 가기 포함) / 찜(장소 ID·URL + 검색 조건 FK + 그 ID를 돌려준 검색 호출 1건) / 포인트 내역 / 방문 인증.
- 선택지 목록 테이블 + 추천별 선택 테이블(분위기·편의시설·키워드 칩).
- 출발지 하위 테이블(순서·검색어·장소 ID).
- 인덱스: 추천(user_id, created_at), 슬롯(추천 ID), 슬롯(장소 ID).
- 점수 칸 없음. 못 먹는 음식 없음.
- 삭제: 90일·20건 정리 + 참조 없는 검색 조건 정리 단계(FK만으로 안 됨).
- 찜 복원 검색은 페이지가 밀릴 수 있어 앞뒤 페이지까지 한 번 더 찾는 여유.

### 2. 익명 로그인 제거 + Zustand 사용자 store
- **09-30 코드 완료(미커밋)**: src/stores/userStore.ts(zustand 5, initUserStore를 AppShell에서 1회, 옛 익명 세션은 로컬 signOut), auth.ts에서 ensureSession·getCurrentUser·onAuthChange 제거, Profile은 store 사용. 브라우저 직접 쓰기는 events·client_errors뿐이고 둘 다 anon 허용이라 안전(그룹·공유는 서버 API).
- 09-30 코드리뷰 반영: v2-schema 007(비회원 슬롯 행동 판정 함수 can_act_on_slot, 정리 1시간 유예) — **dev에 실행 필요**. Profile은 ready 전 로그인 영역 숨김, 익명 세션 signOut은 setTimeout으로 미룸, coords.ts·proj4 삭제, 배치 설명 노트 6개에 갱신 표시.
- **09-30 dev DB 실행 완료(유저)**: 007, 006(익명 계정 삭제), 005-2(license_cache 삭제). dev에 남은 005는 005-3(recommendation_log·mint_activity_log, 3번 작업 후)·005-4(events, 어드민 교체 후).
- **09-30 완료(유저)**: dev 배포, Anonymous sign-ins OFF, dev Vercel에서 PUBLIC_DATA_SERVICE_KEY·ADMIN_REFRESH_SECRET·CRON_SECRET 삭제. 운영 Vercel 키는 main 교체 때 삭제(릴리즈 체크).
- (이전 기록) 남은 일: dev 배포 → 대시보드 Anonymous sign-ins OFF → v2-schema 006 실행(익명 계정 삭제). 인허가 배치 삭제 배포 후 005-2 실행. Vercel에서 PUBLIC_DATA_SERVICE_KEY·ADMIN_REFRESH_SECRET·CRON_SECRET 제거 가능.
- auth.ts의 signInAnonymously 경로 제거. 회원 판정 = 세션 있음.
- store: 로그인 구독 1회, 세션·회원 여부·로딩·닉네임·사진, 구독 등급 자리.
- 프로필 페이지의 자체 구독을 store로 교체.
- dev에 쌓인 익명 계정 삭제.
- events·client_errors 정책은 anon 허용 상태라 그대로 동작하는지 확인.

### 3. 추천 API 자동 저장(회원만)
- 클라이언트가 /api/recommend에 로그인 토큰을 실어 보내야 함(지금은 안 보냄).
- 서버가 토큰 검증 후 검색 조건·추천·슬롯 저장. 비회원은 식별자 없는 통계 행만.
- **09-30 코드 완료(미커밋, dev DB에 v2-schema 008 실행 필요)**:
  - 서버: api/_lib/recordRecommendation.ts(저장 인자 조립·토큰 검증·RPC), recommend-search가 후보마다 출처 호출(kind·query·page·radius) 기록 → 응답 전에 save_recommendation 한 번 → places[].record(slotId·conditionId·recommendationId·course·search·member), recommendationId.
  - 앱: ai.ts가 회원 토큰·save 메타 전송. 출발지는 검색어+장소 ID(LocationEntry.query·kakaoPlaceId), 직접 입력 지역은 검색어(RegionScopeInfo.query). 재추천은 retriedFromId·사유.
  - 복원: src/services/restore.ts(중심 재계산: 프리셋=우리 좌표, 직접 입력=지역 재검색 라벨 일치, 자동=출발지 재검색→findBalancedAreas, 스냅이면 상권 좌표, 실패·그룹이면 상권 근사) + 기록 페이지와 앞뒤 페이지 재검색으로 ID 찾기. 못 찾으면 카카오맵 링크만.
  - 회원 기능: services/memberData.ts, components/MemberPlaces.tsx(지난 추천 목록·상세 시트, 찜 목록). 찜 버튼은 record 있으면 회원 찜(비회원은 로그인 안내), 없으면(공유·목업) 옛 기기 저장 그대로. 프로필은 회원이면 서버 목록, 비회원이면 기기 지난 추천.
  - mint_activity_log 쓰기·읽기 제거(auth.ts 함수, types/user.ts). recommendation_log 쓰기는 아직 유지(파일럿 serial). 005-3의 mint_activity_log는 배포 후 삭제 가능.
  - 포인트·방문 인증은 보류(유저 09-30).
  - 테스트: recordRecommendation 8, restore 7. 카카오 재검색 실동작은 dev에서만 확인 가능(로컬 키 제한).
- **09-30 코드리뷰 반영(미커밋)**:
  - 비회원 → 로그인 → 찜: 저장 때 일회용 토큰(해시만 DB, 원문은 record.claimToken) → 하트가 claim_recommendation(009)으로 내 계정에 옮긴 뒤 찜. 24시간 제한. 이미 옮긴 추천이면 내 것으로 읽어 그대로 진행. 옮긴 추천은 출발지가 없어 상권 근사 복원.
  - record 없는 화면(공유·그룹 게스트·옛 결과)에서는 회원에게 하트 숨김(유저 결정: 공유 링크는 카톡에서 어느 브라우저로 열릴지 모름). 비회원은 기기 저장 유지(4번 때 제거).
  - 새로고침 뒤 재추천: 지역 메타를 스냅샷의 meetingLocation·midpointData에서 다시 계산, 이전 추천 ID는 result[0].record.
  - 직접 입력 지역: 사용자가 친 글자를 저장(RegionSearchSheet·드롭다운), 복원 때 라벨 불일치면 null(첫 결과 폴백 제거). 지역 제안 좌표가 "검색 결과 첫 장소"라 친 글자로도 중심이 달라질 수 있는 한계는 남음.
  - 출발지는 전부 검색어·ID가 있을 때만 저장(일부면 비워 상권 근사).
  - 프로필 부하: 목록 조회 사용자별 60초 기억, 찜 여부 조회 공유·실패 미기억, 복원 동시 3개·탭 메모리 캐시(일시 오류는 기억 안 함, kakaoMap.searchKakaoPage는 오류 시 reject).
  - 토큰은 요청 직전 supabase.auth.getSession(). 찜 실패 안내, 회원 찜 시트 wishlist_open.
  - api 폴더는 기본 tsc -b에 안 들어간다(tsconfig include가 src뿐). 임시 설정으로 따로 검사해야 함 — 09-30 변경분 통과(hcx.ts의 erasableSyntaxOnly 2건은 원래 있던 것).
- **배포 순서: dev DB에 008 → 009 실행 후 배포.** 008 전에 배포하면 회원 프로필 목록이 오류(area_query·search_radius 조회).

### 4. 저장 정리(17번 10-3 갱신판)
- **10-01 코드 완료(미커밋, dev DB에 v2-schema 010 실행 필요)**:
  - 1단계 공유·그룹: share_link(공유 ID→추천 ID, 7일), mint_sessions.recommendation_id, 투표 place_name 삭제, wish_from_slot(공유·그룹 화면 회원 찜 — 남의 추천이면 조건 복사, 출발지 미복사), cleanup_expired(매일, pg_cron 예약은 수동). /api/restore(share·session·own) — 조건 일부+슬롯+서버 계산 검색 중심(자동 중간지점은 출발지·참여자 좌표로, 좌표는 응답만). 중간지점 계산은 api/_lib/midpointCore.ts로 옮겨 앱·서버 공용(src/services/midpoint.ts는 재수출). 공유 화면: 재검색 복원, 지도 1·2차 핀, 투표 4초 폴링(10분·탭 숨김 중단), 만료 안내, 옛 스냅샷 링크 폴백. 그룹 게스트: recommendation_id 폴링 → 복원. 로그인 돌아올 경로(signInWithKakao(returnPath)).
  - 2단계 폰 저장: 결과 스냅샷 v2(mint_last_result_v2) = 추천 ID+토큰+화면 상태만, 새로고침 시 로딩 화면 → /api/restore(own) → 재검색. 모델 설명·가격대·태그·총무·이동시간은 새로고침 뒤 없음. 입력 초안·그룹 세션은 만날 장소 좌표 없이, 출발지는 검색어+ID(복원 시 재검색, LocationInput key=locationsVersion). 기기 지난 추천·기기 찜 제거(목업 발굴 페이지만 예외). 분석 이벤트 장소명 → place_id/slot_id. slot_action 기록(map_open·reserve·wish·share). 1회 정리 storage/legacyCleanup(mint_cleanup_v1).
  - 3단계 목업: src/pages/mock/data/sources.ts(loadMeetings·loadGems·loadCoupons, VITE_SAMPLE_DATA=off면 빈 화면).
  - 남은 것(기록만): reservations 테이블에 가게명·주소 저장(어드민이 표시) / ~~그룹 참여자 출발지명·좌표 저장과 게스트에게 노출~~(10-02 해결) / recommendation_log 쓰기(파일럿 serial) / 옛 mint_share_snapshots·result_json 컬럼 삭제(7일 뒤) / 포인트 로컬 키.
  - 배포 전: 010 실행 → Supabase Auth Redirect URLs에 dev 도메인 와일드카드(/shared 로그인 복귀) → pg_cron 켜고 cleanup-expired 예약.
- **10-01 코드리뷰(handover-notes/code-review/code-review.md) 반영(미커밋)**:
  - 탭 이동 때 서버 복원·정보 유실: stores/resultMemory.ts(메모리 전용)로 같은 추천이면 그대로 되살림. 스냅샷은 403·404일 때만 삭제. clearResultSnapshot이 메모리도 비움.
  - 출발지 역산: 공유·그룹은 서버가 재검색까지 해 places로 응답, center는 내보내지 않음(restoreOnServer). 직접 입력 지역만 앱이 지역 검색어로 복원. 그룹 중심은 result_at까지 제출한 참여자만.
  - 011-1 wish_from_slot: 복원에 필요한 칸만 복사, 이미 찜한 가게면 복사 없이 끝. 011-2 투표 테이블 share_id·choice만 anon 읽기 → 공유 화면이 Supabase 직접 폴링(첫 실패만 숨김, 10분 뒤 리스너 해제).
  - record 없는 결과: 스냅샷·메모리 삭제, 그룹 호스트에 전달 실패 안내. 다른 그룹 세션이 살아 있으면 결과 복원 생략. 공유 링크 저장 4초·서버 레이트리밋과 회원 확인 병렬. mint_wishlist는 목업 때문에 정리 대상에서 뺌.
  - **10-01 dev 반영 완료(유저)**: 010, 011-1·2, Redirect URLs(이미 있었음), pg_cron 켜고 예약, 배포, 011-3.
  - **배포 순서: 010(010-3은 011-3으로 옮김) → 011-1·011-2 → 배포 → 011-3(투표 place_name 삭제).** 배포 순간 옛 화면이 열린 그룹 호스트의 결과 전달 1회 실패는 감수.
- **10-02 동작 점검(dev 브라우저 실사용 + 코드 리뷰) 반영(미커밋)**:
  - 새로고침 뒤 "대중교통 예상"이 '계산 중'에 멈춤: 출발지 2곳 이상일 때만 칸 표시, 계산 실패는 '가져올 수 없어요'(NO_TRAVEL_TIMES). 복원 때 출발지를 다시 찾으면 이동시간도 다시 계산. 1차→2차 도보는 좌표로 다시 계산(서버와 같은 시속 4km).
  - 투표 테이블 직접 읽기가 모든 공유 ID를 나열하던 문제: 012-1 share_vote_counts(공유 ID 하나의 선택지별 표 수만). 첫 조회 실패 시 폴링도 멈춤.
  - 그룹 참여자 출발지: 서버·게스트 폰에 검색어·장소 ID만(location_query·location_place_id, mint_guest_ctx는 locQuery·locPlaceId). 호스트 화면과 서버(그룹 복원 중심)가 카카오로 다시 찾는다. 게스트 조회 응답은 참여자 이름만 — 출발지·취향은 호스트만.
  - 호스트 비밀값(host_token_hash): 세션 만들 때 발급, 호스트 폰 그룹 세션 저장본에 보관. 참여자 상세 조회(x-host-token 헤더)·결과 전달·취소에 필요. 012 이전 세션은 예전처럼 허용. 같은 추천을 다시 전달하면 result_at 유지.
  - 결과 복원 뒤 출발지가 비어 서울 중심으로 재추천되던 문제(원래 있던 것): 스냅샷 v2에 출발지(검색어·ID)·인원·예산·직접 입력 취향을 넣고 복원 때 다시 찾음. 탭 이동은 메모리에서 그대로. 자동 중간지점인데 출발지가 0곳이면 추천하지 않고 출발지 단계로.
  - 공유 링크·투표 하루 상한을 IP별로(링크 300, 투표 1000). users는 last_sign_in_at만 수정 가능(012-1).
  - 스냅샷 24시간은 처음 저장 시각 기준(같은 추천을 다시 저장해도 연장 안 됨). 옛 게스트 저장본 좌표는 1회 정리(mint_cleanup_v2).
  - **배포 순서: 012-1 → 배포 → 012-2(투표 직접 읽기 권한 회수, 참여자 location_name·lat·lng 칸 삭제).** 배포 순간 열려 있던 옛 그룹 화면은 출발지가 안 잡힐 수 있음(감수).
- 결과 스냅샷: localStorage에 검색 조건 + 슬롯별 장소 ID만. 새로고침 시 재검색 복원.
- 공유: 버튼 누를 때 서버 저장(조건 + ID), 링크 열면 재검색 복원, 7일 삭제 배치.
- 공유 투표(mint_share_votes): place_name 칸 제거(카카오 이름 저장 불가, 선택 번호가 슬롯을 가리키므로 이름은 재검색 결과를 쓴다). 통계가 필요하면 이름 대신 카카오 장소 ID. 투표 테이블은 공유와 같이 7일 삭제.
- 투표 실시간 갱신(09-30 논의): 공유 화면에서 3~5초 주기 조회 또는 Supabase Realtime. 어느 쪽이든 Vercel이 아니라 브라우저→Supabase 직접(투표 테이블 anon 읽기 정책 필요). 탭 백그라운드·10분 경과 시 중단. Realtime 무료 한도(동시 200, 월 200만 메시지)는 당분간 여유.
- 공유한 사람 결과 화면에도 같은 집계 표시(공유 ID를 결과 상태에 보관). 실시간 갱신과 같이.
- 투표 알림: 보류(알림톡은 비용, 웹 푸시는 iOS 도달률 낮음).
- 공유 화면 지도에 1차만 마커(SharedResult가 MiniMap에 pins를 안 넘김). 4번 재검색 복원 때 1·2·3차 pins로.

### 보류: 카톡 공유의 카카오맵 버튼 (09-30 숨김)
- 원인: 카톡 공유 버튼 링크는 제품 링크 관리에 등록된 도메인만 열리고, map.kakao.com은 대표 도메인(운영 랜딩)으로 바뀐다. 운영에서도 같은 문제였다.
- 조치: useShareResult에서 버튼만 뺌(대체 공유 텍스트의 카카오맵 주소는 유지). 기획자가 물으면 "기능 문제로 잠시 뺐다".
- 되살릴 때: 우리 도메인 경로(예: /go/map)가 카카오맵으로 넘기는 방식. 열린 리다이렉트가 되지 않게 map.kakao.com·place.map.kakao.com만 허용.
- 그룹 결과(mint_sessions.result_json): 조건 + ID만, 7일 삭제.
- 삭제 배치 신규: 공유·그룹 7일, api_hits 1일, client_errors 30일(제안). 현재 삭제 작업은 하나도 없음(09-30 확인). Supabase DB 스케줄러.
- 옛 localStorage 키 삭제 코드(찜·포인트·인증·이력·파일럿 핸드오프 등).
- 분석 이벤트의 placeName·address → 장소 ID.

### 5. 기획자 전달
- 비회원 통계 수집(식별자 없음)과 "비회원 데이터 저장 안 함"의 관계.
- 로그인 전환율이 핵심 지표가 됨. 개인정보처리방침 반영 항목.

### 6. 작은 정리
- 회의 자료 아티팩트의 "카카오 로그인은 09-20에 붙었어요" 오류(실제 08-03) — 유저가 말하면 수정.
- 상권 목록(midpoint.ts) 좌표 출처 불명 → 공공 데이터로 재생성.
- 자동 중간지점이 상권에 안 붙는 경우가 있는지 확인.
- LLM 어댑터 #39: HCX 401·429도 스키마 없이 재시도함 → 제외. #11(Claude 폴백 옵션)은 운영에서 안 쓰여 무시.

## 기획자 결정 대기
- 포인트 유효기간(없으면 이월 방식).
- 가격대·적합도 점수 표시(LLM 유지라 여전히 열림).
- 그룹 모임 보관 7일 확정 여부.
- **선택 항목 정리(다음 회의 안건, 09-30).** AI는 후보마다 상호·업종·동네만 받아서 대부분 항목을 확인할 수 없다(known 75곳 중 0~7, 65점 상한, 가중 무작위 추첨으로 희석).
  - 확실히 바꿈: 1·2차 목적, 종류, 메뉴 콕, 지역, 재추천 시 본 가게 제외.
  - 업종으로 약간 짐작: 분위기 일부, 관계·행사, 예산.
  - 판단 불가: 주차, 룸, 예약, 늦게까지, 반려동물, 웨이팅 없음, 뷰, 인스타감성, 창가자리, 루프탑, 새로운 곳, 검증된 곳, 인원(단체석), "멀어요"(프롬프트에 거리 없음).
  - 선택지: (1) 디자이너에 "거르는 항목 / 참고 항목"으로 나눠 전달, (2) 판단 불가 항목을 화면에서 빼거나 축소, (3) 업종으로 가능한 것만 코드 규칙화("조용하게"면 호프·포차 제외, "멀어요"면 검색 반경 축소). 추천은 (1) + (2)는 기획자와 결정.
  - 디자이너 전달은 이 결정 뒤에. 09-30에 만든 선택 항목 아티팩트(RiwGKeUp4Bft2oyCKHf4Ga)는 "모두 반영"처럼 읽혀서 그대로 쓰면 안 됨.

## 릴리즈 체크
- 운영 DB: v2-schema.sql 실행 전 백업, place_category 적재(17번 12절), 1-1 절.
- 운영 이관 = main을 dev로 통째로 교체.
- 운영 Supabase: pg_cron 켜고 cleanup-expired 매일 예약(v2-schema 010-5 끝 주석). 필수 — 안 하면 공유·그룹·투표·api_hits가 쌓이고 지난 추천 90일·20건 익명화가 안 돈다. dev는 미설정 허용(필요하면 select public.cleanup_expired() 수동).
- 운영 Supabase Auth Redirect URLs에 운영 도메인 와일드카드(공유·그룹 화면 로그인 복귀).
- 운영 Vercel에서 PUBLIC_DATA_SERVICE_KEY·ADMIN_REFRESH_SECRET·CRON_SECRET 삭제.
