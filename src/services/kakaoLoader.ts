// 카카오맵 SDK 지연 로더 — index.html 동기 로드를 제거하고 필요한 화면에서만 주입.
// (랜딩 방문자는 지도 SDK를 다운로드할 필요가 없다)

const JS_KEY: string = import.meta.env.VITE_KAKAO_JS_API_KEY ?? '633de41eba4b85734a961345c0f55a7e';

let mapsPromise: Promise<void> | null = null;

export function ensureKakaoMaps(): Promise<void> {
  if (window.kakao?.maps?.services) return Promise.resolve();
  if (mapsPromise) return mapsPromise;

  mapsPromise = new Promise<void>((resolve, reject) => {
    const onLoad = () => window.kakao.maps.load(() => resolve());

    const existing = document.querySelector<HTMLScriptElement>('script[src*="dapi.kakao.com/v2/maps"]');
    if (existing) {
      if (window.kakao?.maps) onLoad();
      else existing.addEventListener('load', onLoad);
      return;
    }

    const script = document.createElement('script');
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${JS_KEY}&libraries=services&autoload=false`;
    script.async = true;
    script.onload = onLoad;
    script.onerror = () => {
      mapsPromise = null; // 다음 시도에서 재주입 가능하게
      reject(new Error('카카오맵을 불러오지 못했어요.'));
    };
    document.head.appendChild(script);
  });

  return mapsPromise;
}
