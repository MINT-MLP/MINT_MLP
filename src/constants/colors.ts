// CSS 변수를 해석할 수 없는 곳 전용 — 카카오 지도 SDK(캔버스·오버레이 옵션) 등.
// 화면 색의 원천은 src/index.css :root의 --mint-* 변수다. 이 값은 그 사본이므로 바꿀 때 반드시 같이 고칠 것.
// 사용처: components/MiniMap.tsx
export const MINT_HEX = {
  500: '#3CDBC0',
  800: '#1A7A6E',
  900: '#0F4E46',
} as const;
