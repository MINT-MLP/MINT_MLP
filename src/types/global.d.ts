// window 확장 — 외부 스크립트가 붙이는 전역. 세 모듈에 흩어져 있던 declare global을 한 곳에 모았다.
export {};

declare global {
  interface Window {
    kakao: any;                              // 카카오 지도 SDK (kakaoLoader)
    Kakao: any;                              // 카카오 JS SDK — 로그인·공유 (kakaoMap)
    dataLayer: Record<string, unknown>[];    // GTM (analytics)
  }
}
