# Claude Code 스킬 세트 (다른 PC에 똑같이 깔기)

퍼블리싱·프론트·백엔드(React+Vite+TypeScript+Tailwind, Vercel 함수, Supabase) 작업용으로 2026-10-02에 고른 스킬 6개.
전역(사용자 단위, `~/.claude/skills/`)에 설치한다. 프로젝트 폴더와 무관하게 모든 작업에서 쓰인다.

## 설치 (한 줄)

PowerShell, Git Bash 어디서든 그대로 붙여넣으면 된다. Node 18 이상 필요(이 PC는 v20.20.0으로 설치함).

```
npx -y skills add supabase/agent-skills -s supabase-postgres-best-practices -s supabase -g -a claude-code -y; npx -y skills add vercel-labs/agent-skills -s vercel-react-best-practices -s web-design-guidelines -g -a claude-code -y; npx -y skills add antfu/skills -s vitest -g -a claude-code -y; npx -y skills add addyosmani/web-quality-skills -s accessibility -g -a claude-code -y
```

다른 PC에서는 pull 받은 뒤 Claude Code에게 "handover-notes/23-claude-code-skills.md에 적힌 스킬 설치해줘"라고 하면 된다.
설치 뒤 Claude Code를 다시 열면 스킬 목록에 보인다. 확인: `npx skills ls -g`

## 목록

| 스킬 | 출처 | 쓰는 때 |
|---|---|---|
| supabase-postgres-best-practices | Supabase 공식 | 테이블·RLS 정책·security definer 함수·인덱스·pg_cron 등 SQL을 쓰거나 고칠 때 |
| supabase | Supabase 공식 | supabase-js·Auth·RLS 문제·마이그레이션 등 Supabase 전반 |
| vercel-react-best-practices | Vercel 공식 | React 성능·상태 설계. Next.js 전용 내용(서버 컴포넌트 등)은 Vite 프로젝트에 해당 없음 |
| vitest | antfu | vitest 테스트 작성·모킹·커버리지 |
| web-design-guidelines | Vercel 공식 | 만든 화면을 UI·UX 가이드라인(접근성, 터치 영역, 폼, 로딩 상태)으로 점검 |
| accessibility | Addy Osmani | WCAG 2.2 기준 접근성 점검·수정 |

## 알아둘 것

- 6개 모두 실행 스크립트 없이 문서로만 되어 있다(2026-10-02 설치 때 확인).
- web-design-guidelines는 점검할 때마다 규칙을 GitHub(vercel-labs/web-interface-guidelines)에서 받아온다. 그래서 내용이 바뀔 수 있다.
- supabase는 작업 전에 supabase.com 변경 이력(changelog)을 확인하라고 지시한다.
- 업데이트: `npx skills update -g`
- 삭제: `npx skills remove -g -s <스킬 이름> -y`
- Claude Code 기본 명령과 겹쳐서 일부러 넣지 않은 것: 코드 리뷰(`/code-review`), 보안 리뷰(`/security-review`), 정리(`/simplify`). Playwright는 MCP로 따로 연결해서 쓴다.
