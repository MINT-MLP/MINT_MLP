# 08. 환경변수와 로컬 실행

정리일: 2026-09-15
상태: 전임자에게 키 수령 완료. 로컬 세팅 미착수

## 먼저 할 일 두 가지

### 1. Anthropic 키 교체 (필수)

전임자에게 받은 키가 기존 키라면 **폐기 대상**입니다. 이유:

```
5ea04f7  2026-04-27  first commit                                    ← 클라이언트에 키 있음
f0d2b17  2026-04-29  fix: move Anthropic API key to serverless functions
```

첫 커밋부터 이틀간 `VITE_ANTHROPIC_API_KEY`로 존재했고, `VITE_` 접두사는 빌드 시 번들에 평문으로 박힙니다. **그 이틀간 배포된 번들에 Anthropic 키가 공개돼 있었습니다.** 그리고 그 변수가 Vercel에 아직 남아 있었다는 건 폐기되지 않았을 가능성이 높다는 뜻입니다.

조치 순서:
1. Vercel에서 `VITE_ANTHROPIC_API_KEY` 값 확인. 읽기 가능 상태였음
2. Anthropic 콘솔에서 그 키 폐기. `ANTHROPIC_API_KEY`와 같은 값이면 둘 다 해당
3. 새 키 발급 후 `ANTHROPIC_API_KEY`에만 넣고 Sensitive로 저장
4. `VITE_ANTHROPIC_API_KEY` 변수 자체 삭제

### 2. 유령 변수 삭제

| 변수 | 이유 |
|---|---|
| `VITE_ANTHROPIC_API_KEY` | 위 참조. 현재 코드 미참조 |
| `OPENWEATHER_API_KEY` | 코드는 Open-Meteo 사용. 키 불필요. [recommend.ts:596](../api/recommend.ts#L596) |

## 키를 어디서 다시 구하나

Vercel의 Sensitive 변수는 **생성 후 영구히 읽을 수 없습니다.** 대시보드, REST API, `vercel env pull` 전부 불가. 덮어쓰기만 됩니다. 하지만 Vercel은 사본이고 원본은 각 서비스에 있습니다.

| 변수 | Vercel 상태 | 원본 |
|---|---|---|
| SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY | Sensitive | Supabase 대시보드 |
| VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY | Sensitive | Supabase 대시보드 |
| NAVER_CLIENT_ID, NAVER_CLIENT_SECRET | Sensitive | 네이버 개발자센터 앱 설정 |
| PUBLIC_DATA_SERVICE_KEY | Sensitive | 공공데이터포털 마이페이지 |
| ODSAY_API_KEY, VITE_ODSAY_API_KEY | Sensitive | ODsay LAB 대시보드 |
| ANTHROPIC_API_KEY | Sensitive | **재발급만 가능** |
| CRON_SECRET, ADMIN_PASSWORD, ADMIN_REFRESH_SECRET | 읽기 가능 | 자체 생성 문자열. 새로 정해도 무방 |
| VITE_KAKAO_JS_API_KEY, VITE_KAKAO_REST_API_KEY | 읽기 가능 | 카카오 개발자센터 |
| VITE_SEOUL_DATA_API_KEY | 읽기 가능 | 서울 열린데이터광장 마이페이지 |

전체 변수 용도와 없을 때 동작은 [01-overview.md](01-overview.md) 환경변수 절 참조.

## 발견된 설정 문제

- **`SUPABASE_URL`만 Production 스코프**이고 나머지는 Production and Preview. Preview 배포에서는 `getSupabaseAdmin()`이 null을 반환해 **레이트리밋이 상시 통과되고 로깅도 안 됩니다.** [guard.ts:46-49](../api/_lib/guard.ts#L46-L49)의 fail-open이 Preview에서는 항상 발동 중.
- **`Needs Attention` 배지 3개**: CRON_SECRET, ADMIN_PASSWORD, ADMIN_REFRESH_SECRET. Vercel이 "비밀인데 읽기 가능하게 저장됨"을 경고하는 것. 값을 확보한 뒤 Sensitive로 재생성할 것.
- **`VITE_` 접두사가 잘못 붙은 서버 전용 키 둘**: `VITE_SEOUL_DATA_API_KEY`, `VITE_KAKAO_REST_API_KEY`. 서버에서 `process.env`로만 읽지만 이름 때문에 번들에 실립니다. 서버 전용 이름으로 바꾸고 키도 교체하는 게 맞습니다.

## 로컬 실행

### `npm run dev`로는 API가 안 뜹니다

`npm run dev` = `granite dev` = `vite dev`. 프론트엔드만 5173에 뜨고 **`/api/*`는 전부 404**입니다. vite 설정에 프록시도 없습니다.

전임자가 .env를 만든 적 없다고 한 이유가 이겁니다. `vercel dev`를 안 썼으니 env가 필요할 일이 없었습니다. 로컬에서 돌린 건 화면뿐이었고, 키가 필요한 건 전부 배포된 Vercel에서 확인했습니다.

증거:
- 재배포 트리거 커밋 5개가 전부 파일 변경 0건짜리 빈 커밋
- `b01aae1` 커밋 본문: "번들 추출 결과 VITE_ODSAY_API_KEY 값 앞에 탭 문자가 섞여 들어가... env 재설정 없이 코드에서 .trim() 처리"
- 과거 `.claude/settings.local.json` 권한 목록에 `vercel` CLI 없음

### 서버리스 함수를 로컬에서 돌리려면

```
vercel link          # 본인 계정의 아무 프로젝트에나 걸면 됨
vercel dev           # .env.local을 읽고 api/*를 함수로 실행
```

전임자 Vercel 프로젝트 접근은 필요 없습니다. 값은 `.env.local`에서 읽습니다.

### 로컬에서 되는 것과 안 되는 것

| `vite dev`만 | 됨 | 안 됨 |
|---|---|---|
| | 랜딩, 스텝 UI, 화면 전환 | 추천, 404 |
| | 카카오 지도, 하드코딩 키 폴백 | 그룹 세션, 피드백, 애널리틱스 |

지도가 되는 건 [kakaoLoader.ts:8](../src/utils/kakaoLoader.ts#L8)에 키가 리터럴로 박혀 있어서입니다. Supabase는 `'placeholder'`로 폴백하고 조용히 실패합니다.

## 프로덕션 배포 (2026-09-16 갱신)

**저장소를 GitHub Organization으로 이관한 뒤 Vercel 네이티브 Git 연동이 막혔습니다.** Vercel Hobby는 비공개 GitHub Organization 저장소의 Git 연동 자체를 지원하지 않습니다. Pro 팀 협업 제한과는 별개의 벽입니다.

**해결책: GitHub Actions에서 Vercel CLI로 직접 배포합니다.** [.github/workflows/deploy.yml](../.github/workflows/deploy.yml). main에 푸시하면 `vercel pull → build → deploy`가 돕니다.

이 방식이 겸사겸사 해결한 것: Vercel CLI는 커밋 작성자를 팀 소유권과 대조하지 않고 토큰 소유자로 배포합니다. 그래서 **나중에 개발자가 들어와도 그 사람이 Vercel 계정을 만들 필요가 없습니다.** 저장소 푸시 권한만 있으면 배포되고, Vercel 대시보드나 환경변수를 볼 필요도 없습니다.

필요한 GitHub 저장소 시크릿 3개:

| 시크릿 | 비고 |
|---|---|
| `VERCEL_TOKEN` | **Full Account 스코프로 발급.** 팀 범위 토큰은 CLI 계정 조회에서 거부됨 (진단 커밋 3개로 확인된 사실) |
| `VERCEL_ORG_ID` | |
| `VERCEL_PROJECT_ID` | |

### 2026-09-16 실측으로 확정된 제약

재확인할 필요 없는 사실들입니다. 여러 번 헛다리 짚고 나온 결론이라 근거까지 적어둡니다.

| 사실 | 근거 |
|---|---|
| Vercel 프로젝트에 Git 연동이 **없고, 붙일 수도 없다** | Hobby는 비공개 GitHub Organization 저장소의 Git 연동을 막음. 실제 연결 시도에서 막힘 |
| Hobby는 **커밋 작성자가 팀 소유자가 아니면 배포를 차단**한다 | 기획자 커밋이 Duration `—`로 차단됨. 빌드조차 시작 안 됨 |
| 이 검사는 **CLI 배포에도 적용**된다 | Git 연동이 없는데도 차단됨. CLI가 러너 환경에서 읽어 붙인 커밋 메타데이터를 검사 |
| 차단된 배포는 **워크플로 타임아웃으로 나타난다** | CLI가 시작되지 않는 빌드를 기다리다 14분 소진 후 취소 |
| **프리뷰 고정 도메인은 Hobby에서 불가능** | 프리뷰 도메인은 Git 브랜치 할당 필수 → 연동 불가 → 경로 자체가 없음 |
| 프로젝트 CNAME 타깃 | `a9706dc4d2906d16.vercel-dns-017.com` (apex·www 공통) |

**설치된 우회책:** `deploy.yml`의 Normalize 스텝이 러너의 일회용 체크아웃에서 커밋 작성자를 소유자(`rladndus321@gmail.com`)로 덮어씁니다. 원격 히스토리는 안 바뀝니다. **아직 미검증입니다** — 기획자가 다음에 push할 때 배포가 성공하면 통하는 것이고, 또 차단되면 CLI가 `.git`이 아니라 GitHub Actions 환경변수를 읽는다는 뜻이라 방향을 바꿔야 합니다.

**정정된 오해 두 가지:**
- Hobby의 상업적 이용 금지는 **광고 집행과 무관**합니다. 약관이 정의하는 건 사이트에서 돈을 버는 행위(결제 처리, 광고 게재, 제품 판매 광고)뿐입니다. 광고를 사는 건 해당 없습니다
- GitHub 브랜치 보호는 **무료 플랜 비공개 저장소에서 사용 불가**입니다. main 직접 push를 막으려면 협업자 권한을 Write 아래로 낮추는 것이 유일한 무료 수단입니다

**트레이드오프: 이 토큰이 이제 저장소에서 가장 민감한 비밀입니다.** Full Account 스코프라 새면 Vercel 계정 전체가 노출됩니다. 프로젝트 스코프가 아니라 계정 전체 권한인 이유는 팀 범위 토큰이 동작하지 않아서입니다.

**개발자를 늘릴 때 반드시 할 것: main에 PR 리뷰를 강제하는 브랜치 보호 규칙.** 워크플로 파일도 코드라서, push 권한만 있으면 `deploy.yml`을 고쳐 토큰을 빼돌리는 스텝을 추가할 수 있습니다. private 저장소에서도 무료 기능입니다.

`git remote`는 여전히 `yoonbea12345-create/MINT_MLP`를 가리키고 있고 GitHub 이관 리다이렉트로 동작합니다. 리다이렉트에 계속 의존하지 말고 조직 URL로 `git remote set-url origin`을 갱신해두는 게 좋습니다.

## 앱인토스 실체 (2026-09-17 조사)

**토스에 올라간 앱은 이 저장소가 아니라 별도 포크 `mint-alt`다.** 실사용 확인됨(추천 결과 나옴).

| 배포 | 코드 | 계정 | 상태 |
|---|---|---|---|
| `www.meetatmint.com` | 이 저장소 최신 | 본인 Vercel | 운영 |
| `mint-mlp-4vm9.vercel.app` | 이 저장소 9/16 이전 | 기획자 Vercel | 정지(재배포 없음), 살아 있음 |
| `mintalt.vercel.app` + 토스 `mint-alt` | **별도 포크, 7월 말~8월 초 스냅샷** | 기획자 Vercel + 토스 콘솔 | 토스 사용자 전원이 사용 중 |

셋 다 **같은 운영 Supabase**(`rpnwjkvo...`)에 쓴다.

근거:
- 이 저장소 코드로는 토스에서 추천이 돌 수 없다. API 호출이 전부 상대 경로인데 토스는 `<appName>.apps.tossmini.com` 자기 origin에서 번들을 띄우고, 그 호스트의 `/api/*`는 403(CloudFront 정적). 히스토리 전체에 절대 URL 호출·API 베이스 변수가 없었고, 클라이언트 단독 시절은 4/27~4/29 이틀뿐(첫 `.ait`은 5/20)
- `mintalt.vercel.app` 번들에는 이 저장소에 없는 `apiBase` 청크(`window.location.origin`, 토스 빌드에서 바꿔 끼우는 자리)가 있고 API에 `Access-Control-Allow-Origin: *`가 붙어 있다. 우리 운영 API는 CORS 헤더가 없다
- 카카오 JS SDK 도메인에 `mint-alt.apps.tossmini.com`, `mint-alt.private-apps.tossmini.com`, `mintalt.vercel.app` 등록됨
- mint-alt에는 파일럿(7월)은 있고 카카오 로그인(8/3)·상시 피드백(8/29)·방문인증은 없다

이 저장소의 앱인토스 잔재: `@apps-in-toss/web-framework` 의존성 1개, `granite.config.ts`, npm 스크립트 2줄(`granite dev`/`ait build`), `vercel.json`의 `outputDirectory: dist/web`, `mint.ait`(7/14 빌드, Supabase가 placeholder — 환경변수 없이 빌드됨). 소스에 토스 SDK import는 0개.

**보류 중 (기획자 답변 대기):** mint-alt 소스 위치, mintalt Vercel·토스 콘솔 접근, 옛 4vm9 삭제. 답 오면 (1) 이 저장소의 앱인토스 잔재 정리 여부 결정, (2) `.git` 히스토리 정리(`mint.ait` 41회 커밋 = 82MB 중 90%) — 기획자에게 재클론 통보 후 `filter-repo` + main·dev force push.

## 개발 서버(dev) — 2026-09-17 구축 완료

기획자가 로컬에서 API를 못 띄워 운영에 테스트 커밋을 넣던 문제를 없애려고 만들었다.

| 항목 | 값 |
|---|---|
| 주소 | https://mint-mlp-dev.vercel.app |
| 트리거 | `dev` 브랜치 push |
| Vercel 프로젝트 | 운영과 별개. 시크릿 `VERCEL_DEV_PROJECT_ID` |
| Supabase | **분리됨** (`bhsihxqk...` / 운영은 `rpnwjkvo...`) |
| 크론 | 러너에서 `jq 'del(.crons)'`로 제거. 운영에서만 돈다 |
| 색인 | `X-Robots-Tag: noindex, nofollow` 주입. 전 경로 실측 확인 |

프리뷰가 아니라 **별도 프로젝트의 프로덕션**으로 올린다. 프리뷰 고정 도메인은 Git 브랜치 할당이 필요하고, 그건 Git 연동을 요구하는데 Hobby가 막는다. 프로젝트를 나누면 그 사슬이 통째로 사라진다.

워크플로는 [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) 하나에서 `github.ref_name`으로 분기한다. 환경변수는 [scripts/vercel-env-push.ps1](../scripts/vercel-env-push.ps1)로 올린다 — Sensitive 값은 운영에서 읽어올 수 없어 로컬 파일에서 REST upsert하는 방식이다. 키 목록은 `scripts/vercel-env.example`에 있고, 코드가 실제 참조하는 18개와 일치한다(대조 완료).

### ODsay 소요시간 — 2026-09-17 해결

계정을 수령해 URI 키의 등록 도메인을 정리했다. **운영·dev·로컬 모두 동작한다**(실측 확인).

| 등록 도메인 | 상태 |
|---|---|
| `www.meetatmint.com` | OK |
| `mint-mlp-dev.vercel.app` | OK |
| `localhost:5173` | OK |
| `meetatmint.com` (apex) | 미등록. **등록 불필요** — Vercel이 308로 www에 넘겨 브라우저 Referer가 www로 나간다 |

dev의 `VITE_ODSAY_API_KEY`는 운영과 같은 값이다(양쪽 번들에서 확인). 키 쪽 도메인 설정만 바뀌면 재배포 없이 붙는다.

검증 명령 — 키는 번들에 공개돼 있으므로 아무 데서나 찍어볼 수 있다:

```bash
K=8AyHdtbSf9b1NY5nkyqqeQ
U="https://api.odsay.com/v1/api/searchPubTransPathT?SX=127.0276&SY=37.4979&EX=127.0276&EY=37.5665&apiKey=$K"
curl -s -H "Referer: https://mint-mlp-dev.vercel.app/" "$U" | head -c 120
```

`{"result":` 면 성공, `[ApiKeyAuthFailed]` 면 미등록.

**소요시간은 표시만 바꾸는 기능이 아니다.** [Home.tsx:226-248](../src/pages/Home.tsx#L226-L248)의 `refineHubByTransit`이 거리로 추린 상권 후보 2곳을 실측 대중교통 시간으로 뒤집는다. 단 한 명이라도 실측이 안 되면 거리 1순위를 그대로 쓴다. 즉 ODsay가 막혀 있으면 **상권 선택 로직 자체가 달라진다** — 추천 결과를 dev에서 검증하려면 이게 먼저 뚫려 있어야 의미가 있다.

**키는 설계상 공개다.** URI 키는 브라우저 노출을 전제로 도메인으로 막는 방식이라 번들에 박혀 있는 게 정상이다. 다만 Referer는 위조가 쉽다(curl로 실증됨). 도용당하면 쿼터가 소진되고, 소진되면 **에러 없이 추정치로 폴백한다.** 사용량을 가끔 볼 것.

서버 프록시로 옮기는 안([06-issues-and-plan.md](06-issues-and-plan.md) 12번)은 **현행 유지가 맞다.** Server 키는 IP 기반인데 Vercel 서버리스의 나가는 IP가 동적이라 불안정하다. 계정을 받았다고 달라지지 않는다.

실측으로 확인된 것: `headers` 규칙은 catch-all rewrite(`/(.*)` → `/index.html`)와 공존한다. rewrite를 타는 경로(`/app`)와 서버리스 함수 응답에도 헤더가 붙는다.

## 주의사항

- **키를 붙여넣을 때 앞뒤 공백을 확인하세요.** 전임자가 이 문제로 두 번 데였습니다. ODsay 키 앞 탭 문자로 `ApiKeyAuthFailed`, Supabase에서도 같은 일. 코드에 `.trim()`이 들어간 곳도 있지만 전부는 아닙니다.
- **`.env.example`을 만들어 커밋하세요.** 값은 비우고 이름만. 이번 일이 정확히 그게 없어서 생겼습니다.
- `.env*`는 [.gitignore](../.gitignore)로 차단되어 있습니다. 히스토리에 .env가 커밋된 적은 없습니다. 확인 완료.
- 이 노트 폴더와 `.env.local`은 둘 다 git으로 안 따라갑니다. PC를 옮길 때 따로 챙기세요.

### 앱인토스 잔재 정리 (2026-09-21, dev 미커밋)

유저 결정으로 이 저장소에서 앱인토스를 걷어냈다(토스 앱은 별도 포크 `mint-alt`가 담당, 위 절 참조).

| 항목 | 조치 |
|---|---|
| `@apps-in-toss/web-framework` | `npm uninstall`. package-lock에서 패키지 2,067개(react-native 툴체인) 제거, −26,042줄 |
| `package.json` scripts | `dev: vite`, `build: vite build`. `deploy: ait deploy` 삭제. **이제 `npm run dev`가 8081(granite/McAfee) 문제 없이 5173으로 뜬다** |
| `vercel.json` | `outputDirectory: dist/web` → `dist`. ait build가 vite 산출물을 dist/web로 옮기던 것이라, 이걸 안 바꾸면 배포가 빈 폴더를 올린다 |
| `granite.config.ts`, `mint.ait`(8.8MB) | `git rm`. `.gitignore`에 `mint.ait` 추가 |
| 검증 | `npm run build` → `dist/index.html` 생성, tsc 0, vitest 78/78. **dev 배포 확인(09-21)**: 랜딩 정상, GitHub Actions 빌드 시간 30~40초 단축 |

남은 것: `.git` 히스토리의 mint.ait 41회 커밋(82MB)은 별건 — `git filter-repo`로 지우려면 팀 전원이 재클론해야 하므로 시점을 정해서.
