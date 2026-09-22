// index.css :root --mint-*의 사본. CSS 변수를 못 읽는 카카오 지도 SDK 전용(MiniMap). colors.test.ts가 어긋남을 잡는다.
export const MINT_HEX = {
  500: '#3CDBC0',
  800: '#1A7A6E',
  900: '#0F4E46',
} as const;

// 코스별 색 클래스. 컴포넌트는 tone만 받는다. Tailwind가 스캔해야 하므로 완성된 문자열만(조립 금지).
export const COURSE_TONE = {
  first:  { solid: 'bg-mint-500', text: 'text-mint-500', borderL: 'border-l-mint-500', tint: 'bg-mint-500/10', card: 'bg-course-first shadow-mint-500/25' },
  second: { solid: 'bg-mint-800', text: 'text-mint-800', borderL: 'border-l-mint-800', tint: 'bg-mint-800/10', card: 'bg-course-second shadow-mint-800/25' },
  third:  { solid: 'bg-mint-900', text: 'text-mint-900', borderL: 'border-l-mint-900', tint: 'bg-mint-900/10', card: 'bg-mint-900 shadow-mint-900/25' },
} as const;
export type CourseTone = keyof typeof COURSE_TONE;
