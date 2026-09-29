# 10. 색상 토큰 마이그레이션 작업서

작성일: 2026-09-15
상태: 색 토큰은 2026-09-18 dev 커밋(589c126). 후속 cn()·tone 리팩토링 + 코드 리뷰 반영은 같은 날 완료, 미커밋. 7절 색 토큰, 8절 cn(), 9절 리뷰 반영·색 매핑표
예상 소요: 기계적 치환 30분 + 수작업 반나절 + 시각 검증 1시간

디자이너의 Figma Variables를 기다리지 않고 먼저 진행합니다. 디자이너 변수가 정해주는 건 **이름**뿐이고, **한 곳에 모으는 건** 지금 해도 됩니다. 이름은 나중에 바꿉니다.

---

## 1. 현황

### 수치

| 항목 | 값 |
|---|---|
| 헥스 등장 총계 | 826 |
| Tailwind 대괄호 `-[#hex]` 형태 | 760 |
| 그 밖 | 66 |
| 대괄호 형태 중 투명도 수식어 결합 `/10` 등 | **136** |
| 고유 헥스 | 50 |
| tailwind.config.js 수정 이력 | 1회, 2026-05-20 생성 후 방치 |

### 정정: CSS 변수가 이미 있었습니다

`src/index.css`에 이미 이렇게 있습니다.

```css
:root {
  --color-mint: #3CDBC0;
  --color-mint-dark: #2AB5A0;
  --color-mint-light: #E8F8F5;
  --color-bg: #F5FBF8;
  --color-text: #333333;
}
```

| 변수 | 사용처 |
|---|---|
| `--color-bg` | `index.css:26` body 배경. **사용 중** |
| `--color-text` | `index.css:27` body 글자색. **사용 중** |
| `--color-mint`, `-dark`, `-light` | **없음. 정의만 되고 방치** |

전임자가 변수를 만들어놓고 Tailwind에 연결하지 않아서 아무도 안 쓴 겁니다. 이번 작업에서 **기존 두 개는 호환 유지**, 방치된 세 개는 새 체계로 흡수합니다.

---

## 2. 설계 결정

### CSS 변수 + Tailwind 설정 연결

원천은 CSS 변수 하나, Tailwind는 그걸 가리키기만 합니다.

이유 두 가지:
1. **66곳이 Tailwind 클래스를 못 씁니다.** 인라인 style, SVG 속성, JS 문자열. CSS 변수로 두면 이들도 같은 원천을 봅니다.
2. **투명도 수식어 136곳.** Tailwind 설정이 `var(--x)`를 가리키면서 `/10`을 쓰려면 값이 **공백 구분 RGB**여야 합니다. 헥스로 넣으면 136곳이 전부 깨집니다.

### 쓰지 않는 방식

| 방식 | 왜 안 쓰나 |
|---|---|
| `bg-[#3CDBC0]` 유지 | 지금 탈출하려는 형태 |
| `bg-[var(--mint)]` | 길고 자동완성이 안 먹어 오타 남 |
| Tailwind 설정에 헥스 직접 | 인라인 66곳이 원천을 공유 못 함 |

### 이름 체계

Tailwind 관례인 숫자 스케일을 씁니다. 민트 계열이 6단계라 dark·light 형용사로는 모자랍니다.

---

## 3. 작업 절차

### Step 0. 준비

```bash
git status                       # 깨끗한지 확인
git checkout -b chore/color-tokens
```

치환 전 기준값 기록:

```bash
grep -roE '\-\[#[0-9A-Fa-f]{6}\]' src --include=*.tsx | wc -l    # 760 예상
```

### Step 1. CSS 변수

`src/index.css`의 기존 `:root` 블록을 통째로 교체합니다.

```css
:root {
  /* 원천. 공백 구분 RGB라 Tailwind 투명도 수식어와 호환 */
  --mint-50:  245 251 248;  /* #F5FBF8 */
  --mint-100: 232 248 245;  /* #E8F8F5 */
  --mint-500: 60 219 192;   /* #3CDBC0 */
  --mint-600: 42 181 160;   /* #2AB5A0 */
  --mint-800: 26 122 110;   /* #1A7A6E */
  --mint-900: 15 78 70;     /* #0F4E46 */

  /* 기존 이름 호환. body가 --color-bg, --color-text 사용 중 */
  --color-mint:       rgb(var(--mint-500));
  --color-mint-dark:  rgb(var(--mint-600));
  --color-mint-light: rgb(var(--mint-100));
  --color-bg:         rgb(var(--mint-50));
  --color-text:       #333333;
}
```

### Step 2. Tailwind 설정

`tailwind.config.js`의 `theme.extend`:

```js
theme: {
  extend: {
    colors: {
      mint: {
        50:  'rgb(var(--mint-50) / <alpha-value>)',
        100: 'rgb(var(--mint-100) / <alpha-value>)',
        500: 'rgb(var(--mint-500) / <alpha-value>)',
        600: 'rgb(var(--mint-600) / <alpha-value>)',
        800: 'rgb(var(--mint-800) / <alpha-value>)',
        900: 'rgb(var(--mint-900) / <alpha-value>)',
      },
      kakao: '#FEE500',
    },
  },
},
```

`kakao`는 외부 브랜드색이라 테마가 바뀌어도 안 바뀌니 CSS 변수 없이 헥스로 둡니다. 헥스를 설정에 직접 넣으면 투명도 수식어는 Tailwind가 알아서 처리합니다. `<alpha-value>`는 Tailwind 3.3 이상 문법이고 이 프로젝트는 3.4.19입니다.

### Step 3. 스모크 테스트

**일괄 치환 전에 설정이 동작하는지 한 곳만 먼저 확인합니다.** 설정이 틀린 채로 760곳을 바꾸면 전부 무색이 됩니다.

아무 컴포넌트 하나에 `bg-mint-500/50`을 임시로 넣고:

```bash
./node_modules/.bin/vite build
grep -o 'rgb(var(--mint-500) / 0.5)' dist/assets/*.css | head -1
```

한 줄이 나오면 투명도까지 정상입니다. 안 나오면 Step 2를 다시 봅니다. 확인 후 임시 클래스 제거.

### Step 4. 민트 계열 일괄 치환

대괄호 안에 헥스만 있는 경우만 잡습니다. 그림자 같은 복합값은 건드리지 않습니다. `I` 플래그로 대소문자 무시.

```bash
find src -name '*.tsx' -exec sed -i -E \
  -e 's/-\[#3CDBC0\]/-mint-500/gI' \
  -e 's/-\[#36CFA0\]/-mint-500/gI' \
  -e 's/-\[#2AB5A0\]/-mint-600/gI' \
  -e 's/-\[#E8F8F5\]/-mint-100/gI' \
  -e 's/-\[#F5FBF8\]/-mint-50/gI' \
  -e 's/-\[#1A7A6E\]/-mint-800/gI' \
  -e 's/-\[#0F4E46\]/-mint-900/gI' \
  -e 's/-\[#FEE500\]/-kakao/gI' {} +
```

> **결정 필요: `#36CFA0`을 `mint-500`에 합쳤습니다.** 22곳, 어드민 화면에서만 쓰였고 `#3CDBC0`과 육안 구분이 거의 안 돼 실수로 갈라진 색으로 판단했습니다. 의도한 구분이면 그 줄을 빼고 별도 토큰을 만드세요.

검증:

```bash
grep -roE '\-\[#[0-9A-Fa-f]{6}\]' src --include=*.tsx | wc -l    # 760에서 대폭 감소
git diff --stat
./node_modules/.bin/tsc -p tsconfig.app.json --noEmit
./node_modules/.bin/vite build
```

diff는 한 번 훑어봅니다. 투명도 수식어는 `bg-mint-500/10`으로 자연스럽게 이어져야 합니다.

### Step 5. Tailwind 기본 팔레트와 같은 헥스 (선택)

아래는 Tailwind 내장 색과 값이 **정확히 같습니다.** 토큰을 만들 필요 없이 내장 이름으로 바꾸면 됩니다. 건수가 적어 급하지 않습니다.

```bash
find src -name '*.tsx' -exec sed -i -E \
  -e 's/-\[#9CA3AF\]/-gray-400/gI' \
  -e 's/-\[#E5E7EB\]/-gray-200/gI' \
  -e 's/-\[#111827\]/-gray-900/gI' \
  -e 's/-\[#94A3B8\]/-slate-400/gI' \
  -e 's/-\[#EF4444\]/-red-500/gI' \
  -e 's/-\[#F43F5E\]/-rose-500/gI' \
  -e 's/-\[#F59E0B\]/-amber-500/gI' \
  -e 's/-\[#F97316\]/-orange-500/gI' \
  -e 's/-\[#EAB308\]/-yellow-500/gI' \
  -e 's/-\[#FEF9C3\]/-yellow-100/gI' \
  -e 's/-\[#22C55E\]/-green-500/gI' \
  -e 's/-\[#0EA5E9\]/-sky-500/gI' \
  -e 's/-\[#3B82F6\]/-blue-500/gI' \
  -e 's/-\[#8B5CF6\]/-violet-500/gI' \
  -e 's/-\[#FFFFFF\]/-white/gI' {} +
```

### Step 6. 수작업 66곳

대괄호 밖 헥스의 파일별 분포입니다.

| 건수 | 파일 | 처리 |
|---|---|---|
| 23 | `src/pages/Admin.tsx` | **마지막에.** 내부 화면이라 우선순위 낮음 |
| 8 | `src/components/ResultCard.tsx` | 수작업 |
| 5 | `src/components/MiniMap.tsx` | **특수. 아래 참조** |
| 5 | `src/services/seoulData.ts` | **그대로 둠.** 혼잡도 데이터색 |
| 4 | `src/components/WishlistButton.tsx` | 수작업 |
| 4 | `src/pages/MemberInput.tsx` | 수작업 |
| 4 | `src/pages/Pilot.tsx` | 수작업 |
| 2 | `src/components/home/LoadingScreen.tsx` | SVG 속성 |
| 2 | `src/pages/SharedResult.tsx` | 수작업 |
| 1 | `src/App.tsx` | 인라인 style |
| 1 | `src/components/CertShowcase.tsx` | 수작업 |
| 1 | `src/components/MeetingLocationSelect.tsx` | SVG 속성 |
| 1 | `src/pages/tabs/Discover.tsx` | 수작업 |
| 1 | `src/pages/tabs/Profile.tsx` | 수작업 |
| 4 | `src/data/certifications/*.ts` | **그대로 둠.** 미쉐린·백년가게 등 외부 인증 브랜드색 |

**실제 사용자 화면 수작업은 약 30곳입니다.** 어드민 23곳과 데이터 파일 9곳을 빼면 됩니다.

형태별 바꾸는 법:

| 형태 | 전 | 후 |
|---|---|---|
| 인라인 style | `style={{ background: '#3CDBC0' }}` | `className="bg-mint-500"` 또는 `style={{ background: 'rgb(var(--mint-500))' }}` |
| SVG 속성 | `stroke="#3CDBC0"` | 속성 제거 후 `className="stroke-mint-500"` |
| JS 문자열이 CSS로 쓰일 때 | `accentColor = '#3CDBC0'` | `accentColor = 'rgb(var(--mint-500))'` |
| **JS 문자열이 SDK로 넘어갈 때** | `strokeColor: '#3CDBC0'` | **JS 상수 사용. 아래 참조** |

> SVG 프레젠테이션 속성 `stroke="..."`는 `var()`를 못 읽습니다. 클래스로 바꾸면 Tailwind의 `stroke-*`, `fill-*` 유틸리티가 처리합니다.

### Step 7. MiniMap: CSS 변수를 못 읽는 곳

`src/components/MiniMap.tsx:71`의 `strokeColor: '#3CDBC0'`은 **카카오 지도 SDK 옵션**입니다. SDK가 캔버스에 직접 그리므로 CSS 변수를 해석하지 못합니다. 같은 파일 22~24행의 핀 색도 SDK 오버레이로 들어갑니다.

이런 곳 전용으로 JS 상수 파일을 만듭니다.

```ts
// src/theme/colors.ts
// CSS 변수를 해석할 수 없는 곳 전용. 카카오 지도 SDK, canvas 등.
// 값은 src/index.css :root와 반드시 일치시킬 것.
export const MINT_HEX = {
  500: '#3CDBC0',
  600: '#2AB5A0',
  800: '#1A7A6E',
  900: '#0F4E46',
} as const;
```

**이 파일은 원천이 두 개가 되는 지점입니다.** 사용처가 MiniMap 하나라 감수하지만, 색이 바뀌면 여기도 같이 고쳐야 합니다. 주석을 꼭 남기세요.

> MiniMap은 별도로 **XSS 이슈**가 있습니다. `pinContent`가 장소명을 이스케이프 없이 HTML 템플릿에 넣습니다. 색 작업하면서 같이 고치면 좋습니다. [02-frontend.md](02-frontend.md) 6절 참조.

### Step 8. 시각 검증

`vercel dev`로 띄워서 주요 화면을 봅니다. 로컬 실행법은 [08-environment-setup.md](08-environment-setup.md).

체크할 화면:
- [ ] 랜딩
- [ ] 홈 스텝 0~3, 선택된 칩 상태
- [ ] 결과 카드, 1·2·3차
- [ ] 하단 탭바 활성 상태
- [ ] 로딩 스피너 SVG
- [ ] 미니맵 폴리라인과 핀
- [ ] 투명도 쓰는 곳, 배경 틴트나 호버
- [ ] 어드민

색이 **아예 사라진 곳**이 있으면 설정 누락이고, **미묘하게 다른 곳**이 있으면 `#36CFA0` 같은 드리프트 병합의 결과입니다.

### Step 9. 커밋

```bash
git add -A
git commit -m "refactor(style): 헥스 하드코딩을 색상 토큰으로 — CSS 변수 원천 + Tailwind 연결"
```

---

## 4. 판단이 필요한 색

### 민트 근사값: 드리프트 의심

일괄 치환에서 뺐습니다. 각각 가장 가까운 토큰에 합칠지 새 단계로 만들지 정해야 합니다.

| 헥스 | 건수 | 가장 가까운 토큰 | 의견 |
|---|---|---|---|
| `#2AB58C` | 2 | `mint-600` #2AB5A0 | 파란 채널만 다름. **거의 확실히 오타** |
| `#F0FDF9` | 5 | `mint-50` | 합쳐도 무방해 보임 |
| `#E8FBF3` | 1 | `mint-100` #E8F8F5 | 합쳐도 무방해 보임 |
| `#D4F3EE` | 3 | 100과 500 사이 | `mint-200` 신설 후보 |
| `#8FEAD9` | 1 | 100과 500 사이 | `mint-300` 신설 후보 |
| `#8BD3C7` | 1 | 100과 500 사이 | `mint-400` 신설 후보 |
| `#1E9E8C` | 1 | 600과 800 사이 | `mint-700` 신설 후보 |
| `#155E54` | 2 | 800과 900 사이 | 900에 합칠지 판단 |

**디자이너 변수가 오면 이 표로 대조하세요.** 디자이너가 200·300·700 단계를 정의하면 그대로 매핑되고, 안 하면 가장 가까운 쪽에 합칩니다.

### 외부 브랜드색

테마와 무관하게 고정입니다. 토큰으로 만들되 민트 체계에 넣지 않습니다.

| 헥스 | 건수 | 추정 | 비고 |
|---|---|---|---|
| `#FEE500` | 7 | 카카오 노랑 | Step 4에서 `kakao`로 처리 |
| `#FFE812` | 1 | 카카오 노랑 | **`#FEE500`과 드리프트.** 합칠 것 |
| `#3A1D1D`, `#191919` | 2, 2 | 카카오 버튼 글자 | |
| `#03C75A`, `#02A64B` | 3, 1 | 네이버 초록 | 두 값이 갈라짐 |
| `#DA291C` | 2 | 인증 뱃지 빨강 | |

### 나머지

`#F1F3F5`, `#F4EDE6`, `#EDF2EC`, `#B2C7D9`, `#3B576E`, `#8A5A2B`, `#9C6B4A`, `#CC785C`, `#5F7A5A`, `#FF3D00`, `#E63600`, `#FF6B6B`, `#FFD700` 등 1~3건짜리. 인증 뱃지, 일러스트, 혼잡도 표시색으로 보입니다. 필요할 때 개별 판단.

---

## 5. 디자이너 변수가 도착하면

1. 프레임 하나에 `get_variable_defs` 호출. node ID는 [09-figma-wireframe-map.md](09-figma-wireframe-map.md). H-00 `5:22` 권장
2. 디자이너 이름과 값을 4절 표와 대조
3. **값만 다르면** `src/index.css` `:root`의 숫자만 바꿉니다. 코드도 설정도 안 건드립니다
4. **이름이 다르면** 두 가지 중 선택
   - Tailwind 설정에 디자이너 이름으로 별칭 추가. 기존 클래스는 그대로 동작
   - sed로 `mint-500`을 디자이너 이름으로 일괄 변경
5. `src/theme/colors.ts`도 같이 갱신
6. 디자이너가 새 단계를 정의하면 4절 드리프트 후보를 거기로 매핑

**헥스를 RGB로 바꾸는 법**: `#3CDBC0`은 `3C`, `DB`, `C0`를 각각 16진수에서 10진수로. `60 219 192`.

---

## 6. 주의사항

- **CSS 변수 값을 헥스로 되돌리지 마세요.** 투명도 수식어 136곳이 조용히 깨집니다. 빌드는 통과하는데 색만 사라져서 발견이 늦습니다
- **`--color-bg`, `--color-text`는 지우지 마세요.** body가 쓰고 있습니다
- **치환은 커밋된 상태에서.** 되돌릴 수 있게
- 대괄호 안에 헥스만 있는 경우만 치환되므로 `shadow-[0_4px_12px_#3CDBC0]` 같은 복합값은 남습니다. Step 4 후 남은 대괄호 헥스를 한 번 훑어보세요
- 앞으로 AI로 UI를 생성할 때 설정에 토큰이 있으면 모델이 `bg-mint-500`을 씁니다. **토큰이 비어 있으면 임의값을 쓰고, 그게 320번 쌓인 원인이었습니다**

---

## 7. 실행 기록 (2026-09-18)

dev 브랜치 작업 트리에서 실행. 커밋은 유저가 한다. 원칙은 **값 보존** — 헥스를 토큰으로 옮기되 색 자체는 바꾸지 않는다. 예외는 아래 병합 3건뿐.

### 결과 수치

| 항목 | 값 |
|---|---|
| 대괄호 헥스 `-[#hex]` | 760 → 29 (전부 의도적 잔여, 아래 표) |
| 변경 파일 | 49 (+571 / −536). `git status`엔 130개로 보이는데 80개는 EOL만 바뀐 것(autocrlf), 내용 diff 없음 |
| 등가성 검사 | `10-colorCheck.js`: 135파일 · 색 원자 1,587개 · 불일치 0 |
| 빌드 CSS | 투명도 변형 33개가 `rgb(var(--mint-500) / .3)` 형태로 정상 · 민트 임의값 클래스 0 |
| 검증 | tsc 0 · vitest 52/52 · vite build OK · eslint 25E/1W (작업 전과 동일) |
| 시각 | `vite preview` + Playwright로 랜딩·`/app`·`/admin` 전후 스크린샷 대조. 랜딩·앱 동일, 어드민만 입력창 테두리·버튼이 #36CFA0→#3CDBC0 (의도된 병합) |

### 계획(3절)과 달라진 점

- **`mint-200` (#D4F3EE) 신설.** 3건이 전부 hover 틴트라 용도가 분명했다. 300·400·700 후보는 1건씩이라 신설 안 하고 잔여로 둠
- 상수 파일은 `src/theme/colors.ts`가 아니라 **`src/constants/colors.ts`** (모듈화로 constants 폴더가 생김). `MINT_HEX = { 500, 800, 900 }`, 사용처는 MiniMap 핀 3색 + `strokeColor`뿐
- `naver: '#03C75A'` 토큰 추가 (Reserve 버튼 3곳)
- Step 4와 Step 5(Tailwind 내장 팔레트 15종)를 같이 돌렸다. 스크립트는 대소문자 무시(`#ffffff`도 잡힘)
- **병합은 3건만**: `#36CFA0`→mint-500 (어드민 22곳), `#2AB58C`→mint-600 (2곳), `#FFE812`→kakao (1곳). 4절의 다른 근사값(#F0FDF9 등)은 합치지 않고 그대로 뒀다 — 디자이너 변수 오면 결정
- `SharedResult` CourseCard: `accent` prop을 헥스 문자열에서 `800 | 900` 숫자로 바꿨다. 원래 `${accent}1a`로 문자열 붙여 알파를 만들었는데 `rgb(var())` 형태엔 못 붙이므로 `rgb(var(--mint-N) / 0.102)`로 (0x1a/255 = 0.102, 동일 색)
- SVG: `LoadingScreen` 원 2개, `MeetingLocationSelect` 아이콘 → `stroke` 속성 제거 후 `className="stroke-mint-*"`
- 인라인 style·JS 문자열(App bg, AdminBarRow 기본색, ResultCard·GroupResultView 그라데이션, ResultAltsSection 기본값, Pilot conic-gradient, goodprice badgeTextColor, Admin 2곳) → `rgb(var(--mint-N))`
- `index.css`의 shimmer·`.result-gradient`·스크롤바도 변수로. `.card-hover`·`.cta-glow-mint`의 `rgba(42,181,160,…)` 그림자는 손대지 않음 (rgba 안엔 `rgb(var())`를 못 넣음. 바꾸려면 `rgb(var(--mint-600) / 0.14)`)
- MiniMap XSS(Step 7 각주)는 동작 변경이라 **안 고침**. 안정화 항목으로

### 남긴 헥스 (대괄호 29건 + 비대괄호)

| 헥스 | 건수 | 위치 | 이유 |
|---|---|---|---|
| `#F0FDF9` | 5 | Landing 3, Pilot, PilotAdmin | mint-50 근사. 디자이너 변수 대조 후 결정 |
| `#FF3D00` ×3, `#E63600` | 4 | Reserve | 배민 예약 버튼(외부 브랜드) |
| `#02A64B` | 1 | Reserve | 네이버 글자색, `naver`와 드리프트 |
| `#3A1D1D` ×2, `#191919` ×2 | 4 | MiniMap, GroupWaiting, Profile | 카카오 버튼 글자색 |
| `#FFD700` | 1 | MiniMap | 카카오 버튼 hover |
| `#B2C7D9` ×2, `#3B576E`, `#CC785C`, `#8FEAD9`, `#8BD3C7`, `#E8FBF3` | 7 | Landing | 일러스트·근사 민트(300·400 후보) |
| `#1E9E8C` | 1 | VibeSelect 코스 탭 | mint-700 후보 |
| `#155E54` | 2 | ResultCard·GroupResultView 그라데이션 끝색 | 800·900 사이. 값 보존 |
| `#C8F0E8` | 1 | index.css shimmer 중간색 | 값 보존 |
| `#FF6B6B` | 1 | Pilot 말풍선 꼬리 | 일러스트 |
| `#F4EDE6`, `#EDF2EC`, `#9C6B4A`, `#5F7A5A` | 4 | pages/mock/Discover | 목업 카테고리색 |
| `#F1F3F5` | 1 | TreasurerPlanSheet | 회색 배경 |
| `#DA291C`, `#8A5A2B` | 2 | CertShowcase | 인증 뱃지 |
| 데이터 파일 | — | `constants/certifications/*`, `services/seoulData` | 계획대로 그대로 |

### 등가성 검사 도구 `10-colorCheck.js`

`git HEAD`의 파일과 작업 트리 파일 각각에서 색 원자(헥스, `text-mint-500` 같은 토큰 클래스, `rgb(var(--mint-N))`, `MINT_HEX[N]`, `accent={N}`)를 등장 순서대로 뽑아 전부 헥스로 정규화한 뒤 순서열이 같은지 비교한다. 같으면 "같은 자리에 같은 색". 병합 3건은 양쪽에 같이 적용해 흡수. `ROOT` 경로가 하드코딩돼 있으니 집 PC에선 바꿀 것. 실행: `node handover-notes/10-colorCheck.js`

### 커밋 메시지 제안

```
refactor(style): 헥스 하드코딩 760곳을 색상 토큰으로 — CSS 변수 원천 + Tailwind 연결

- index.css :root에 --mint-50/100/200/500/600/800/900 (공백 구분 RGB)
- tailwind.config: mint.*, kakao, naver 토큰. 투명도 수식어 호환
- constants/colors.ts MINT_HEX: 카카오 지도 SDK 전용
- 병합 3건: #36CFA0→mint-500, #2AB58C→mint-600, #FFE812→kakao
- 등가성 검사 0 불일치, 시각 검증 완료
```

---

## 8. cn() 도입과 스타일 prop 리팩토링 (2026-09-18)

색 토큰 커밋(589c126) 위에 얹은 후속 작업. 미커밋. dev 테스트 후 색 작업과 함께 prod로 간다.

### 왜

프로젝트에 `clsx`·`tailwind-merge`가 없어서 컴포넌트가 색을 **문자열 prop → inline style**로 받고 있었다(ResultAltsSection의 `accentColor`, ResultPlaceCard·GuestPlaceCard의 `gradient`+`shadowColor`, SharedResult CourseCard의 `accent`, AdminBarRow의 `color`). hover·투명도 변형을 못 쓰고, 호출부가 색 값을 알아야 했다. `className`을 받는 컴포넌트 4개는 문자열 이어붙이기라 충돌 시 CSS 순서로 승자가 정해졌다.

### 무엇을

| 항목 | 내용 |
|---|---|
| `src/utils/cn.ts` | `cn = twMerge(clsx(...))`. 의존성 `clsx@2.1`, `tailwind-merge@2.6` (**v3은 Tailwind 4용이라 v2 고정**) |
| `constants/colors.ts` `COURSE_TONE` | first/second/third별 `solid·text·borderL·tint·card` 완성 클래스 조회표. `CourseTone` 타입은 `keyof typeof` |
| `tailwind.config` `backgroundImage` | `course-first`(mint-500→600), `course-second`(mint-800→#155E54). **135deg 고정** — `bg-gradient-to-br`는 요소 비율 따라 각도가 바뀌어 동일하지 않아 안 씀 |
| `index.css` `.result-gradient` | 삭제. 사용처 3곳(Landing, CertShowcase, SharedResult 히어로) → `bg-course-first` |
| ResultAltsSection | `accentColor: string` → `tone?: CourseTone = 'first'` + `className?`. inline style 4곳 → 클래스 |
| ResultPlaceCard · GuestPlaceCard | `gradient`+`shadowColor` → `tone: CourseTone`. `COURSE_TONE[tone].card` |
| SharedResult CourseCard | `accent: 800\|900` → `tone: 'second'\|'third'`. 배지 배경 `rgb(var() / 0.102)` → `bg-mint-800/10` (알파 0.102→0.1, 8비트에서 26→25.5로 육안 불가) |
| ResultCard 2차 카드 | inline gradient → `bg-course-second` 클래스 |
| AdminBarRow | `color: '#hex'` → `bar: 'bg-amber-500'` 클래스. Admin 호출 17곳 + FEEDBACK_CATEGORIES 전부 Tailwind 내장 이름으로 |
| className 받는 컴포넌트 | GpsPin·FitScoreBar·LandingHeroPhone·LandingKakaoBubble → `cn(base, className)`. KakaoBubble은 기본 `w-6 h-6`이 호출부 크기와 병합됨(전엔 통째로 교체) |

변경 18파일 +120/−136, 신규 `cn.ts`. tsc 0 · vitest 52 · build OK · eslint 25E/1W(변동 없음). CSS 55.06KB.

### 검증

- 잔여 grep: `accentColor|shadowColor|gradient="linear|accent={|result-gradient|borderLeftColor|color="#` → 0
- 빌드 CSS에 `bg-course-first/second`, `border-l-mint-500/800/900`, `bg-mint-800/10`, `shadow-mint-800/25` 생성 확인
- twMerge 동작: `border border-gray-100 border-l-4 border-l-mint-500` 4개 전부 유지(그룹이 달라 충돌 아님), `p-4 p-2`→`p-2`
- 랜딩 프리뷰에서 computed style: `.bg-course-first` 2곳 `linear-gradient(135deg, rgb(60,219,192) 0%, rgb(42,181,160) 100%)`, 말풍선 14/16/24px
- **결과 카드·공유 페이지·어드민 막대는 로컬에서 못 봄**(백엔드 없음). dev에서 볼 것: 1차 카드 그라데이션, 2차 카드 그라데이션(진한 민트→#155E54), 대안 카드 좌측 보더·점수색(1차 민트, 2차 진한 민트), `/shared` 2·3차 카드 배지, 어드민 막대 색 7종

### 규칙 (앞으로)

- 컴포넌트가 색을 받을 땐 **값이 아니라 의미**(`tone`)로. 클래스는 `COURSE_TONE` 같은 조회표에서 완성 문자열로
- `className` prop은 `cn(base, className)`으로 합친다
- 조건부 클래스는 `cn('base', cond && 'x')`. 기존 템플릿 리터럴 138곳은 그 파일을 만질 때 같이 바꾼다(일괄 변환 안 함 — 순수 churn)
- inline style이 정당한 곳: 데이터에서 오는 색(인증 뱃지 `badgeTextColor`), 카카오 SDK(`MINT_HEX`), 계산값(`width: %`, Pilot conic-gradient)

### 커밋 메시지 제안

```
refactor(style): clsx+tailwind-merge 도입, 색 prop을 tone 클래스로

- utils/cn.ts, constants/colors.ts COURSE_TONE, tailwind backgroundImage course-first/second
- ResultAltsSection·ResultPlaceCard·GuestPlaceCard·SharedResult CourseCard: 색 문자열 prop → tone
- AdminBarRow: color 헥스 → bar 클래스
- className 받는 컴포넌트 4개 cn() 병합, .result-gradient 제거
```

---

## 9. 코드 리뷰 반영 (2026-09-18, 다른 세션 리뷰)

리뷰 4건 + 소소한 것 전부 반영. 미커밋. 8절 작업과 같은 커밋으로 가면 된다.

### 반영 내용

| 리뷰 항목 | 조치 |
|---|---|
| 1. twMerge가 `bg-course-*`를 배경색으로 오인 | `cn.ts`를 `extendTailwindMerge`로 바꿔 `bg-course` 그룹을 `bg-image`에 등록. `cn('bg-course-first','bg-white/30')` → 둘 다 보존 확인. **tailwind.config backgroundImage에 키를 추가하면 cn.ts에도 같이 추가할 것** (양쪽 주석 남김) |
| 2a. `teal-*` 31곳 | 전부 민트 토큰으로. 매핑은 아래 표 |
| 2b. index.css `rgba(42,181,160,…)` 2곳 | `rgb(var(--mint-600) / 0.14)`, `/ 0.35`. Landing 히어로 폰의 임의 그림자 `shadow-[…rgba(42,181,160,0.5)]`도 같은 종류라 `.hero-glow-mint` 클래스로 옮김 |
| 2c. `#155E54`, `#C8F0E8` | `mint-900`, `mint-200`으로 대체. `--mint-850` 신설은 안 함 — 색 한 곳 때문에 단계를 만들면 디자이너 변수와 대응할 이름이 없어진다 |
| 2d. 민트 근사 임의색 9곳 | 전부 토큰으로. 매핑은 아래 표 |
| 3. COURSE_TONE 절반 적용 | ResultCard·GroupResultView의 1·2·3차 배지, 2차 카드, 3차 카드 좌측 보더·카테고리 배지 전부 `COURSE_TONE`으로. 이제 코스 색을 바꾸려면 `colors.ts` 한 곳 |
| 4. MINT_HEX 사본 | `constants/colors.test.ts` 추가 — index.css `:root`를 파싱해 `MINT_HEX` 3개와 대조. 값을 61로 바꿔 실제로 실패하는 것 확인 |
| `bar?: string` | `` `bg-${string}` ``으로 좁힘 (AdminBarRow, Admin FEEDBACK_CATEGORIES) |
| cn.ts 규칙 문구 | "점진 적용, 기존 133곳 일괄 변환 안 함"으로 현실에 맞춤 |
| nit | placeCardBits import 위치, colors.ts 빈 줄, ResultAltsSection 미사용 `className` 제거 |

### 색 매핑 (값이 바뀐 것 — dev에서 볼 것)

| 전 | 후 | 근거 |
|---|---|---|
| `bg-teal-50` #F0FDFA (14) | `bg-mint-100` #E8F8F5 | :root 정의상 100이 "연한 틴트·선택 배경". 50은 페이지 배경이라 틴트 카드가 묻힘 |
| `border-teal-100` #CCFBF1 (6), `border-teal-200` #99F6E4 (4), `bg-teal-200` (2) | `mint-200` #D4F3EE | 가장 가까운 단계. 200 테두리는 약간 연해짐 |
| `shadow-teal-900/10` (3) | `shadow-mint-900/10` | |
| `shadow-teal-200` (2) | `shadow-mint-500/30` | SharedResult 히어로와 통일 |
| `bg-[#F0FDF9]` (4: Landing 루트·nav, Pilot·PilotAdmin 업로드 박스) | `bg-mint-50` | 랜딩 배경이 앱 배경(body)과 같아짐 |
| `from-[#F0FDF9] to-[#E8FBF3]` | `from-mint-50 to-mint-100` | |
| `text-[#8BD3C7]` 로고 태그라인 | `text-mint-500/70` | |
| `bg-[#8FEAD9]/30` 히어로 블러 원 | `bg-mint-500/20` | 장식 |
| `bg-[#1E9E8C]` VibeSelect 활성 코스 탭 | `bg-mint-600` | |
| course-second 끝 `#155E54` | `mint-900` #0F4E46 | 2차 카드 그라데이션 끝이 약간 더 어두움 |
| shimmer 중간 `#C8F0E8` | `mint-200` | 구분 불가 |

이제 `:root` 밖에 남은 민트 값은 카카오 SDK용 `MINT_HEX`뿐이고, 그건 테스트가 잠근다.

### 수치

25파일 +170/−177, 신규 `cn.ts`·`colors.test.ts`. tsc 0 · vitest 55/55 · build OK(CSS 54.24KB) · eslint 25E/1W(변동 없음). 잔여 grep: `teal-[0-9]` 0, 근사 임의색 0, rgba/#155E54/#C8F0E8 0.
