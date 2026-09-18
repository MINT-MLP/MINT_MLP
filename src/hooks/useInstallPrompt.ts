// PWA 설치 프롬프트 — Android는 beforeinstallprompt, iOS는 수동 안내. index.html이 먼저 잡아둔 이벤트를 이어받는다.
import { useEffect, useState } from 'react';
import { trackEvent } from '@/services/analytics';
import { exitAppFullscreen } from '@/utils/fullscreen';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type InstallGuide = 'ios-safari' | 'ios-kakao' | null;

const IOS_INSTALL_GUIDE_SEEN_KEY = 'mint_ios_install_guide_seen_v1';

type MintWindow = Window & {
  __mintInstallPrompt?: BeforeInstallPromptEvent | null;
  MSStream?: unknown;
};

export function useInstallPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isKakao, setIsKakao] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [guide, setGuide] = useState<InstallGuide>(null);

  useEffect(() => {
    const w = window as MintWindow;
    if (
      w.matchMedia('(display-mode: fullscreen)').matches ||
      w.matchMedia('(display-mode: standalone)').matches
    ) {
      setIsInstalled(true);
      return;
    }
    const ua = navigator.userAgent;
    setIsIOS(/iPad|iPhone|iPod/.test(ua) && !w.MSStream);
    setIsKakao(/KAKAOTALK/i.test(ua));

    // index.html이 리액트 마운트 전에 이미 잡아둔 프롬프트가 있으면 즉시 사용
    if (w.__mintInstallPrompt) setPrompt(w.__mintInstallPrompt);

    // 이후 발화분(또는 index.html이 잡은 뒤 쏜 커스텀 이벤트) 수신
    const onReady = () => { if (w.__mintInstallPrompt) setPrompt(w.__mintInstallPrompt); };
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as BeforeInstallPromptEvent); };
    const onInstalled = () => { setPrompt(null); setIsInstalled(true); };
    window.addEventListener('mint:installready', onReady);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('mint:installed', onInstalled);
    return () => {
      window.removeEventListener('mint:installready', onReady);
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('mint:installed', onInstalled);
    };
  }, []);

  async function triggerInstall() {
    trackEvent('pwa_install_click');
    const w = window as MintWindow;
    const nativePrompt = prompt ?? w.__mintInstallPrompt;
    // Android/Chrome은 브라우저 네이티브 설치창만 사용한다.
    if (nativePrompt) {
      await nativePrompt.prompt();
      const choice = await nativePrompt.userChoice;
      // 클릭≠설치 — 실제 설치 전환율을 보려면 outcome을 나눠 기록한다
      trackEvent(choice?.outcome === 'accepted' ? 'pwa_install_accepted' : 'pwa_install_dismissed');
      w.__mintInstallPrompt = null;
      setPrompt(null);
      return;
    }
    // iOS는 자동 설치 API가 없다. 브라우저 메뉴가 보이도록 전체화면을 먼저 해제하고,
    // 기기당 한 번만 Safari의 홈 화면 추가 순서를 안내한다.
    if (isIOS) {
      await exitAppFullscreen();
      try {
        if (localStorage.getItem(IOS_INSTALL_GUIDE_SEEN_KEY)) return;
        localStorage.setItem(IOS_INSTALL_GUIDE_SEEN_KEY, '1');
      } catch { /* 저장이 막힌 환경에서는 현재 방문 중 한 번 더 보일 수 있다. */ }
      setGuide(isKakao ? 'ios-kakao' : 'ios-safari');
    }
  }

  // Android는 실제 네이티브 설치 이벤트가 준비된 경우에만 버튼을 노출한다.
  const canInstall = !isInstalled && (isIOS || !!prompt);
  return { canInstall, triggerInstall, isIOS, guide, setGuide };
}
