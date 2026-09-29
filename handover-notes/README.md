# MINT_MLP 인수 분석 노트

작성일: 2026-09-15
대상: 이 저장소를 이어받아 개발하는 본인
원 저장소: https://github.com/yoonbea12345-create/MINT_MLP (private)
전임자: yoonbea12345 (기획자, Claude Code 바이브코딩 단독 개발)

이 폴더는 git 추적에서 제외되어 있다(.gitignore). PC나 세션이 바뀌어도 폴더째 들고 다니면 재분석 없이 바로 이어서 작업할 수 있다.

## 파일 목록

| 파일 | 내용 |
|---|---|
| [01-overview.md](01-overview.md) | 프로젝트 정체, 스택, 규모, 건강 검사 결과, 환경변수 전량 |
| [02-frontend.md](02-frontend.md) | 화면 지도, 상태 관리, localStorage 키 27종, 클라이언트 데이터 계층, 인증, 목업 인벤토리, 코드 품질 |
| [03-backend-api.md](03-backend-api.md) | 엔드포인트 10개 상세, 추천 파이프라인 16단계, 백엔드 보안·품질·테스트 |
| [04-database-deploy.md](04-database-deploy.md) | DB 스키마 16테이블, 통합 스키마 sql/schema.sql, RLS 최종 상태, 배포 구조, 시크릿 스캔 결과 |
| [05-git-history.md](05-git-history.md) | 5개 국면 서사, 커밋 스타일, Claude Code 흔적, revert, churn 파일 |
| [06-issues-and-plan.md](06-issues-and-plan.md) | 문제점 우선순위 전체 목록과 인수 후 조치 계획 |
| [07-algorithm-design.md](07-algorithm-design.md) | (구) 알고리즘 회의록. 크롤 DB 전제 폐기. **현재 기준은 16번** |
| [08-environment-setup.md](08-environment-setup.md) | 환경변수 수령 상태, Anthropic 키 교체 필요 사유, 로컬 실행 방법 |
| [09-figma-wireframe-map.md](09-figma-wireframe-map.md) | Figma 와이어프레임 화면별 node ID와 코드 대응표, MCP 접근 조건 실측 |
| [10-color-token-migration.md](10-color-token-migration.md) | 색상 토큰 작업서. 7절 실행 기록·잔여 색 표, 8절 cn()+tone 리팩토링(2026-09-18) |
| [12-batch-and-buzz-cache.md](12-batch-and-buzz-cache.md) | admin-batch가 하는 일, bubbleScore 공식, 추천에서의 쓰임, 수동 실행법 |
| [13-modularization-plan.md](13-modularization-plan.md) | 모듈화 계획. 목표 디렉토리, types/ 구성, Home.tsx 훅 5개 분해 설계, 실행 순서 6단계 |
| [14-member-data-schema.md](14-member-data-schema.md) | 회원 데이터 서버 저장 설계(FS-96/98): 찜·방문 인증·포인트 원장 테이블, RLS, credit_visit 함수, 결정 필요 3건 |
| [15-recommendation-schema.md](15-recommendation-schema.md) | 추천 도메인 설계(개편 2단계): recommendation·tag·origin·candidate·selection, recommendation_log 대체, RLS, 결정 필요 3건 |
| [16-algorithm-discussion.md](16-algorithm-discussion.md) | 알고리즘 논의 정리(09-21~23): 현재 파이프라인 10단계, 조건 반영 등급표, 결정 사항, 네이버 플레이스 에이전트 경쟁, 다음 방향 4개(검색어 조건·블로그 근거·기억 후보·에이전트 루프), HCX A/B 계획. 방향 2~4는 17번의 약관 확인으로 폐기 |
| [17-prompt-only-experiment.md](17-prompt-only-experiment.md) | 프롬프트 전용 추천 실험(09-23, dev): 네이버·카카오 약관 확인 결과, hcx.ts·llm.ts·recommend-prompt.ts, 카카오 실존 게이트, 키 설정, haiku 첫 실측(실존 0/10), 측정 방법 |

## 집에서 이어갈 때 먼저 볼 것

1. [13-modularization-plan.md](13-modularization-plan.md) — **모듈화 끝, dev 배포됨. "집에서 바로 할 것"부터**
2. [08-environment-setup.md](08-environment-setup.md) — Anthropic 키 교체와 `vercel dev` 세팅
3. [10-color-token-migration.md](10-color-token-migration.md) — 색 토큰 dev 커밋됨, cn()·tone 리팩토링 **미커밋**. 7절·8절만 보면 됨
4. [17-prompt-only-experiment.md](17-prompt-only-experiment.md) — **알고리즘 현재 기준(약관 때문에 방향 전환)**. CLOVA Studio 키 넣고 30건 측정부터
5. [06-issues-and-plan.md](06-issues-and-plan.md) — 보안 조치 우선순위

## 30초 요약

- "약속은 잡았는데 어디 가지?"를 푸는 모임 장소 추천 앱. 조건을 고르면 네이버·카카오·공공데이터로 후보를 모아 Claude(haiku-4-5)가 1·2차를 고르고 3차는 규칙으로 붙인다.
- Vite+React19 웹앱을 Vercel에 배포한다. Apps-in-Toss 포장은 2026-09-21에 저장소에서 제거(토스 앱은 별도 포크 mint-alt, 08번 노트).
- 타입체크·테스트(52건)·빌드는 통과. eslint 25 에러(기준선 20 + 모듈화로 드러난 Home 기존 위반 5).
- 가장 급한 문제는 DB다. `supabase/setup.sql`에 anon 전면 허용 정책이 남아 있어 재실행 한 번이면 7월에 잠근 RLS가 원복된다. 결제 영수증 버킷은 public이다.
- API는 enrich 분기 무방비, 어드민 평문 비밀번호 + 무제한 브루트포스, 세션 소유권 검증 없음.
- Home.tsx는 2026-09-17 모듈화로 2,113→81줄(훅 10개 + 뷰 2개). 118커밋이 몰려 있던 파일이라 히스토리 추적은 13번 노트 참조.
- `mint.ait` 8.7MB 빌드 산출물이 41번 커밋되어 .git이 82MB.

## 로컬 환경 메모

- 클론 위치: c:/playground/MINT_MLP
- git 자격증명: Windows 자격 증명 관리자의 `git:https://github.com` 항목(kr621248_amway)이 자동 사용됨. 이 계정이 저장소에 초대되어 있다.
- 이 저장소에서만 user.name / user.email을 개인 계정으로 로컬 지정해 둠(전역은 회사 계정).
- node_modules는 `npm ci`로 설치됨. 검사 명령:

```
./node_modules/.bin/tsc -p tsconfig.app.json --noEmit
./node_modules/.bin/tsc --noEmit --ignoreConfig --skipLibCheck --target es2022 --module esnext --moduleResolution bundler --strict --types node api/*.ts api/_lib/*.ts
./node_modules/.bin/eslint .
./node_modules/.bin/vitest run
./node_modules/.bin/vite build
```

주의: 생짜 `vite build`는 `dist/`에 바로 떨어진다. Vercel은 `dist/web`을 보므로 실제 배포 빌드는 `npm run build`(= `ait build`)다.
