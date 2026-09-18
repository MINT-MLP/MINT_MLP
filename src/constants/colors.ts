// CSS 변수를 해석할 수 없는 곳 전용 — 카카오 지도 SDK(캔버스·오버레이 옵션) 등.
// 화면 색의 원천은 src/index.css :root의 --mint-* 변수다. 이 값은 그 사본이므로 바꿀 때 반드시 같이 고칠 것.
// 사용처: components/MiniMap.tsx
export const MINT_HEX = {
  500: '#3CDBC0',
  800: '#1A7A6E',
  900: '#0F4E46',
} as const;

// 코스(1차·2차·3차)별 색 클래스. 컴포넌트는 색 값이 아니라 tone만 받고 여기서 클래스를 고른다.
// Tailwind가 빌드 때 클래스를 찾아야 하므로 완성된 문자열만 둔다 — `bg-mint-${n}` 같은 조립 금지.
export const COURSE_TONE = {
  first:  { solid: 'bg-mint-500', text: 'text-mint-500', borderL: 'border-l-mint-500', tint: 'bg-mint-500/10', card: 'bg-course-first shadow-mint-500/25' },
  second: { solid: 'bg-mint-800', text: 'text-mint-800', borderL: 'border-l-mint-800', tint: 'bg-mint-800/10', card: 'bg-course-second shadow-mint-800/25' },
  third:  { solid: 'bg-mint-900', text: 'text-mint-900', borderL: 'border-l-mint-900', tint: 'bg-mint-900/10', card: 'bg-mint-900 shadow-mint-900/25' },
} as const;
export type CourseTone = keyof typeof COURSE_TONE;
