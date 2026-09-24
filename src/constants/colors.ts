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

// 입력 화면(목적·종류·메뉴) 선택 상태. 1차는 연한 민트, 2차는 진한 청록 채움 — 결과 카드의 코스 색과 같다.
// 글자는 민트-800 이상: 민트-600을 연한 민트 위에 올리면 대비가 2.4:1이라 작은 글씨가 안 읽힌다.
export const PICK_TONE = {
  first: {
    card: 'border-mint-500 bg-mint-100 text-mint-800 shadow-md shadow-mint-500/20',
    chip: 'border-mint-500 bg-mint-100 text-mint-800',
    solid: 'bg-mint-500 text-white',
    text: 'text-mint-800',
    badge: 'bg-white text-mint-800',
  },
  second: {
    card: 'border-mint-800 bg-mint-800 text-white shadow-md shadow-mint-800/25',
    chip: 'border-mint-800 bg-mint-800 text-white',
    solid: 'bg-mint-800 text-white',
    text: 'text-mint-800',
    badge: 'bg-white/20 text-white',
  },
  off: {
    card: 'border-gray-200 bg-white text-gray-700 hover:border-mint-500/50',
    chip: 'border-gray-200 bg-white text-gray-600 hover:border-gray-300',
  },
} as const;
export type PickCourse = 'first' | 'second';
