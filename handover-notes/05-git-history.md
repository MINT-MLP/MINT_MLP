# 05. Git 히스토리

362커밋 / 2026-04-27 ~ 2026-09-14 (141일) / 작성자 1명(`yoonbea12345@gmail.com`, 이름 `yoonbea12345` 304 + `yunbae` 58).

## 월별 밀도
```
2026-04:  24   2026-05:  71   2026-06:  25
2026-07: 198   2026-08:  34   2026-09:  10
```

## 국면

**Phase 0. 카카오 지도 프로토타입 (04-27~28, 24커밋)**
`5ea04f7 first commit`. 하루 만에 카카오 API 프록시 → JS SDK 직접 호출로 전환. 같은 주에 랜딩·애널리틱스·예약·GTM·Supabase(a484368). 커밋 메시지 영문 소문자.

**Phase 1. 결과 카드 UX 반복 (05, 71커밋)**
UI 미세 조정. 하루 10~15커밋. 한글 커밋 섞이기 시작. 05-20 mint.ait + repomix 유입.

**Phase 2. 그룹 모드 · 스키마 (06, 25커밋)**
0296cb0(06-08) setup.sql 최초. d8bc6a7 Vercel outputDirectory dist/web. 1657e4f(06-27) 공유 링크 그룹 모드. 06-29~30 PWA, 키워드 자유입력, "meetup-place engine" 피벗.

**Phase 3. 폭발적 스프린트 (07, 198커밋 = 55%)**
커밋 언어가 한글로 뒤집힘(ko 177 / en 21).
- 07-03~04 추천 엔진 L0~L4 재설계(7090c5b, 0189217, ab7278b).
- 07-04 d068f32 "MVP 전면 하드닝 16개 항목": security.sql 생성, ADMIN_PASSWORD 도입. 같은 날 c41e556 v2로 수정("RLS 미차단 실측 수정"). 실측으로 자기 보안 패치 실패를 잡은 사례.
- 07-04~05 재배포 트리거 빈 커밋 4연속(Vercel env 반영 방법을 몰라 커밋으로 밀어붙임).
- 07-08 하루 약 30커밋: 랜딩 재설계, 호스트/게스트 분리, 메뉴 콕, 개인정보 완화(30a5eec → 05f1f2e 범위 축소).
- 07-21 파일럿 캠페인: f71d249 꽝없는 룰렛, 9c1b55d 일련번호.

**Phase 4. 앱 셸 · 로그인 · 촬영 (08, 34커밋)**
- 07ca842(08-02) 5탭 셸 + 목업. 6dcecee 탭 재설계.
- 08-04 촬영용 MOCK 사이클: bfd63b0, 641195e 가짜 기능 배포 → 8d343a0 Revert "사진은 다 찍었다". 투자/홍보 촬영을 위해 가짜를 프로덕션에 올렸다가 같은 날 되돌림.
- 95bd8c6/afa56fe(08-03) 카카오 로그인 SQL. sync.sql:5 "로그인 카드가 약속하는데 실제로는 쓰기만 하고 아무도 읽지 않았습니다."
- 5fe5d74(08-29) "광고가 도는데 배포가 멈춰 있었다" 13→12 → 8e9a552 12→10. 광고 집행 중 Hobby 한도로 배포 막힌 사건.
- bdbaeba(08-29) 정밀 검수 버그 18건.

**Phase 5. 잔불 정리 (09, 10커밋)**
말풍선 톤, 중간지점 스냅, 죽은 버튼 2건, a4ee5f8(09-09) .claude/projects gitignore, bc4d26d(09-14) 타입체크·lint. 속도 확연히 감소.

## 커밋 스타일
- 94%가 conventional prefix. 자체 prefix `copy:`, `content:`, `polish:`, `tweak:`, `redesign:`.
- 7월 이후 형식: `type(scope): 사용자 증상 — 한 일`. 증상을 유저 관점 평서문으로 먼저.
- 예: `fix(group): 여럿이 동시에 들어오면 아무도 못 들어갔다 — 그룹 모드 정밀 점검 수정`

## Claude Code 흔적
- 296커밋 본문에 Claude 언급. Co-Authored-By 분포:
```
107  Claude Opus 4.8
 92  Claude Sonnet 4.6
 32  Claude Opus 5
 27  Claude Fable 5
  8  Claude Sonnet 5
  2  Claude Opus 5 (1M context)
  1  Claude Opus 5 (소문자)
```
총 269건 = 74%. 04-29 ~ 09-14 끊김 없음.
- `.claude/settings.local.json` 8커밋. 과거 버전(repomix에 보존)에 `C:\Users\HKEDU\mint`, `Desktop\카카오톡 받은 파일` 등 절대경로. 현재는 전권 와일드카드.
- 커밋 제목에 "(Fable 설계·Opus 구현)"(aeef99d), C3/C4 작업 ID.

## Revert 8건
```
8d343a0 08-04  Revert "촬영용 MOCK 3종"              계획된 revert
7dd581c 08-03  Revert "전체화면 진입 제거"           기술적 패배 인정
1d3f34e 07-08  Revert 랜딩 지그재그 디자인
9b72b36 07-08  Revert 그룹 수렴 비주얼               디자인 롤백 2연발
3d4b963 07-04  Revert "LLM을 claude-fable-5로 전환"  모델 롤백
7ffeda2 04-29  revert: restore kakaoMap.ts
387b73e 04-29  revert: restore Kakao SDK sync script
```
LLM 모델 이력: opus-4-7 → opus-4-8(06-30) → sonnet-5(a2f50a6 07-06, "로딩 대폭 단축") → fable-5 시도 후 즉시 revert → 현재 haiku-4-5(recommend.ts:1246, A/B 근거 주석).

## Churn
| 파일 | 커밋 | 변경 줄 | 현재 줄 |
|---|---|---|---|
| package-lock.json | - | 68,063 | - |
| src/pages/Home.tsx | 118 | 10,893 | 2,130 |
| src/pages/Landing.tsx | 82 | 7,916 | 1,081 |
| api/recommend.ts | 79 | 5,422 | 1,637 |
| src/components/ResultCard.tsx | 45 | 5,350 | 848 |
| src/components/VibeSelect.tsx | 42 | 3,706 | 617 |
| mint.ait | 41 | 290.5MB 바이너리 | 8.7MB |
| src/pages/MemberInput.tsx | 36 | 3,911 | 1,042 |
| supabase/setup.sql | 13 | - | 243 |
| vercel.json | 14 | - | 39 |

Landing.tsx 82커밋의 상당수는 `scripts/capture-*.mjs`로 목업 이미지를 통째로 갈아끼운 것.
