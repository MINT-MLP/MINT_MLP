import { useEffect, useState } from 'react';
import { trackEvent } from '../utils/analytics';
import { exitAppFullscreen, navigateInApp, requestAppFullscreen } from '../utils/fullscreen';
import CertShowcase from '../components/CertShowcase';

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

function useInstallPrompt() {
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

async function goToApp() {
  trackEvent('cta_click');
  await requestAppFullscreen();
  navigateInApp('/app');
}

// ── 모바일 히어로: 조건 → 결과 예시 바 ──
const COMBOS = [
  { chips: ['🍻 술', '시끌벅적', '성수'], result: '아키야마 성수본점' },
  { chips: ['🍜 밥', '검증된 곳', '선릉'], result: '농민백암순대 본점' },
  { chips: ['☕ 카페', '인스타감성', '연남'], result: '카페 레이어드 연남점' },
  { chips: ['💕 100일 데이트', '야경맛집', '성수'], result: '성수옥상' },
  { chips: ['🏢 회식', '단체 가능', '용산'], result: '몽탄' },
];

function PhoneMockup({ src, alt, width = 'w-56' }: { src: string; alt: string; width?: string }) {
  return (
    <div className={`${width} mx-auto rounded-[2rem] bg-white p-1.5 ring-1 ring-black/5 shadow-2xl shadow-teal-900/10`}>
      <div className="overflow-hidden rounded-[1.6rem] bg-white">
        <img src={src} alt={alt} className="w-full block" loading="lazy" />
      </div>
    </div>
  );
}

// 히어로 전용 디바이스 프레임 — 얇은 흰 베젤 + 깊은 그림자로 실제 폰처럼
function HeroPhone({ src, alt, className = '', featured = false }: { src: string; alt: string; className?: string; featured?: boolean }) {
  return (
    <div
      className={`rounded-[2.1rem] bg-white p-1.5 ring-1 ring-black/5 ${
        featured ? '' : 'shadow-2xl shadow-teal-900/10'
      } ${className}`}
    >
      <div className="overflow-hidden rounded-[1.7rem] bg-white">
        <img src={src} alt={alt} className="block w-full" loading="lazy" />
      </div>
    </div>
  );
}

function KakaoTalkBubble({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3C6.48 3 2 6.58 2 11c0 2.83 1.83 5.31 4.6 6.73L5.5 21.5l4.2-2.3c.74.13 1.51.2 2.3.2 5.52 0 10-3.58 10-8s-4.48-8-10-8z" />
    </svg>
  );
}

export default function Landing() {
  useEffect(() => { trackEvent('landing_view'); }, []);
  const { canInstall, triggerInstall, isIOS, guide, setGuide } = useInstallPrompt();
  const [comboIdx, setComboIdx] = useState(0);
  const [visitCount, setVisitCount] = useState(0);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [groupRole, setGroupRole] = useState<'host' | 'guest'>('host');

  // 소셜 프루프 카운터 (localStorage 캐시로 깜빡임 방지)
  useEffect(() => {
    try {
      const cached = localStorage.getItem('mint_visit_count');
      if (cached) setVisitCount(Number(cached));
    } catch { /* ignore */ }
    fetch('/api/count')
      .then((r) => r.json())
      .then((d) => {
        if (d.count > 0) {
          setVisitCount(d.count);
          try { localStorage.setItem('mint_visit_count', String(d.count)); } catch { /* ignore */ }
        }
      })
      .catch(() => {});
  }, []);

  // 스크롤 페이드업
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('fade-visible'); obs.unobserve(e.target); }
      }),
      { threshold: 0.1 }
    );
    document.querySelectorAll('.fade-section').forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setComboIdx((i) => (i + 1) % COMBOS.length), 3200);
    return () => clearInterval(t);
  }, []);

  const combo = COMBOS[comboIdx];

  const installButton = canInstall && (
    <button
      onClick={triggerInstall}
      className="w-full flex items-center justify-center gap-2 bg-white border-2 border-[#3CDBC0] text-[#2AB5A0] font-bold text-base py-4 rounded-xl active:scale-95 transition-all hover:bg-teal-50"
    >
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      {isIOS ? '홈 화면에 추가하기' : '앱으로 다운받기'}
    </button>
  );

  return (
    <div className="landing-root min-h-screen bg-[#F0FDF9]">

      {/* ── NAV ── */}
      <nav className="sticky top-0 z-50 bg-[#F0FDF9]/90 backdrop-blur border-b border-teal-100">
        <div className="max-w-lg lg:max-w-7xl mx-auto px-5 lg:px-8 py-3 flex items-center justify-between">
          <span className="flex items-baseline gap-1.5">
            <span className="text-xl lg:text-2xl font-black text-[#3CDBC0] tracking-tight">MINT</span>
            <span className="hidden sm:inline text-[10px] lg:text-[11px] font-semibold text-[#8BD3C7] tracking-tight">Meet in one tap</span>
          </span>
          <button
            onClick={goToApp}
            className="bg-[#3CDBC0] text-white text-sm font-bold px-5 lg:px-6 lg:py-2.5 py-2 rounded-xl transition-all active:scale-95 hover:bg-[#2AB5A0]"
          >
            시작하기 →
          </button>
        </div>
      </nav>

      {/* ══════════════════════════════════════
          HERO — 첫 결과 화면 미리보기
          모바일: 세로 중앙 / PC: 좌 카피·CTA + 우 결과 목업
      ══════════════════════════════════════ */}
      <section className="px-6 pt-12 pb-12 lg:min-h-[calc(100vh-64px)] lg:flex lg:items-center lg:pt-0 lg:pb-0">
        <div className="max-w-lg lg:max-w-7xl mx-auto lg:w-full lg:px-8 lg:grid lg:grid-cols-[minmax(0,1fr)_560px] lg:gap-16 lg:items-center lg:-translate-y-8">
          {/* 좌: 카피 + CTA + 통계 */}
          <div className="text-center lg:text-left lg:w-full lg:justify-self-start">
            <div className="inline-flex items-center gap-1.5 bg-teal-50 border border-teal-200 text-[#2AB5A0] text-xs font-bold px-4 py-1.5 rounded-full mb-6 lg:mb-7 lg:self-start">
              ✦ 그룹 만남 장소 큐레이션
            </div>
            <h1 className="text-4xl lg:text-6xl font-black text-gray-800 leading-tight mb-3 lg:mb-5">
              약속은 잡았는데<br />
              <span className="text-[#3CDBC0]">어디서 만나지?</span>
            </h1>
            <p className="text-gray-600 text-lg lg:text-xl leading-relaxed mb-7 lg:mb-10 break-keep">
              조건 몇 개만 고르세요.<br />
              이 모임에 <strong className="text-gray-800">딱 맞는 장소 3곳</strong>, 30초 안에 나옵니다.
            </p>

            <div className="lg:hidden w-full max-w-xs mx-auto bg-white border border-teal-100 rounded-3xl p-4 shadow-sm mb-7 min-h-[104px] flex flex-col justify-center">
              <div key={comboIdx} className="animate-fade-in">
                <div className="flex items-center justify-center gap-1.5 flex-wrap mb-2.5">
                  {combo.chips.map((c) => (
                    <span key={c} className="bg-[#E8F8F5] text-[#2AB5A0] text-xs font-bold px-3 py-1.5 rounded-full">{c}</span>
                  ))}
                </div>
                <div className="flex items-center justify-center gap-2 text-sm">
                  <a
                    href={`https://map.kakao.com/link/search/${encodeURIComponent(combo.result)}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => trackEvent('landing_demo_place_click')}
                    className="flex items-center gap-1 font-bold text-gray-800 underline decoration-[#3CDBC0] decoration-2 underline-offset-4 active:scale-95 transition-transform"
                  >
                    <svg className="w-3.5 h-3.5 text-[#3CDBC0] flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                    </svg>
                    {combo.result}
                  </a>
                  <span className="bg-[#3CDBC0] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">적합도 90+</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 w-full max-w-xs mb-3 mx-auto lg:mx-0 lg:mb-5">
              <button
                onClick={goToApp}
                className="w-full bg-gradient-to-r from-[#3CDBC0] to-[#2AB5A0] text-white font-black text-lg py-4 rounded-xl cta-glow-mint active:scale-95 transition-all"
              >
                지금 바로 추천받기
              </button>
              {installButton}
            </div>

            {visitCount >= 50 && (
              <p className="text-sm text-gray-500 mb-8 lg:mb-10">
                지금까지 <strong className="text-[#2AB5A0]">{visitCount.toLocaleString()}번</strong>의 "어디서 만나지?" 고민이 MINT를 찾아왔어요
              </p>
            )}
            {visitCount < 50 && <div className="mb-5 lg:mb-10" />}

            {/* 통계 3종 — CTA 버튼과 같은 폭에 가둬 균등 분배(양 끝이 버튼 좌우선에 정렬).
                셀 사이 얇은 구분선으로 정돈된 인상을 준다. */}
            <div className="max-w-xs mx-auto lg:mx-0 flex items-stretch text-center">
              {[
                { v: '30초', d: '추천까지 걸리는 시간' },
                { v: '딱 3곳', d: '선택 피로 제로' },
                { v: '79만 곳', d: '전국 실존 장소 검증' },
              ].map((s, i) => (
                <div key={s.v} className={`flex-1 flex flex-col items-center ${i > 0 ? 'border-l border-teal-100' : ''}`}>
                  <div className="text-2xl lg:text-3xl font-black text-[#3CDBC0] whitespace-nowrap">{s.v}</div>
                  <div className="text-xs lg:text-sm text-gray-500 mt-1 leading-tight">{s.d}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 우 (PC 전용): 입력 → 결과 2단 레이어드 목업 + 플로팅 UI */}
          <div className="hidden lg:block lg:relative lg:h-[660px] lg:w-full lg:justify-self-end">
            {/* 배경 글로우 */}
            <div aria-hidden className="absolute inset-0 pointer-events-none">
              <div className="absolute top-6 right-8 h-72 w-72 rounded-full bg-[#3CDBC0]/25 blur-3xl" />
              <div className="absolute bottom-2 left-0 h-64 w-64 rounded-full bg-[#8FEAD9]/30 blur-3xl" />
            </div>

            {/* 뒤: 입력(조건 선택) 화면 */}
            <HeroPhone
              src="/image/landing/hero-purpose.webp"
              alt="MINT 조건 선택 화면 예시"
              className="absolute left-0 top-1 w-[256px] rotate-[-7deg] z-10"
            />

            {/* 앞: 추천 결과 화면 — 주인공 */}
            <HeroPhone
              src="/image/landing/hero-result.webp"
              alt="MINT 첫 추천 결과 예시"
              featured
              className="absolute right-0 bottom-0 w-[298px] rotate-[3deg] z-20 shadow-[0_35px_70px_-20px_rgba(42,181,160,0.5)]"
            />

            {/* 플로팅: 상단 배지 — 입력→결과를 잇는 위치 */}
            <div className="absolute left-[33%] top-6 z-30 flex items-center gap-1.5 rounded-full bg-[#3CDBC0] px-3.5 py-2 text-xs font-black text-white shadow-lg shadow-[#3CDBC0]/40 rotate-[-4deg]">
              🎯 조건 100% 반영
            </div>

            {/* 플로팅: 하단 스탯 카드 */}
            <div className="absolute left-1 bottom-9 z-30 flex items-center gap-2.5 rounded-2xl bg-white/95 px-4 py-3 shadow-xl shadow-teal-900/10 ring-1 ring-black/5 backdrop-blur rotate-[-3deg]">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#E8F8F5] text-lg">⚡</span>
              <span className="text-left">
                <span className="block text-sm font-black leading-none text-gray-800">30초 만에 완성</span>
                <span className="mt-1 block text-xs leading-none text-gray-500">조건 4개 → 딱 3곳</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          PROBLEM — 카카오톡 실랑이
          PC: 좌 텍스트·통계 + 우 카톡목업 2단
      ══════════════════════════════════════ */}
      <section className="bg-white border-y border-gray-100 fade-section">
        <div className="max-w-lg lg:max-w-7xl mx-auto px-6 py-14 lg:py-24 lg:grid lg:grid-cols-2 lg:gap-16 lg:items-center">
          <div>
            <p className="text-xs font-bold tracking-widest text-[#3CDBC0] mb-3">PROBLEM</p>
            <h2 className="text-2xl lg:text-4xl font-bold text-gray-800 leading-tight mb-3">
              매번 반복되는 이 대화,<br />익숙하지 않나요?
            </h2>
            <p className="text-base lg:text-lg text-gray-500 mb-6 leading-relaxed">
              장소 하나 정하는 데 30분. 결국 아무도 안 정해서 맨날 같은 곳.
            </p>
            <div className="hidden lg:block bg-teal-50 border border-teal-100 rounded-2xl p-7 max-w-sm">
              <div className="text-base font-bold text-gray-500 mb-5">모임 장소 정하는 데 걸리는 시간</div>
              <div className="flex items-center gap-5">
                <div>
                  <div className="text-5xl font-black text-gray-300 line-through decoration-gray-300 decoration-2">32분</div>
                  <div className="text-sm text-gray-500 mt-1.5">단톡방 실랑이</div>
                </div>
                <div className="text-3xl font-black text-[#3CDBC0]">→</div>
                <div>
                  <div className="text-5xl font-black text-[#3CDBC0]">30초</div>
                  <div className="text-sm font-bold text-[#2AB5A0] mt-1.5">MINT로</div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 lg:mt-0 lg:max-w-sm lg:mx-auto lg:w-full">
            <div className="rounded-2xl overflow-hidden shadow-md">
              <div className="bg-[#3B576E] px-4 py-3 flex items-center gap-2">
                <span className="text-white text-lg">‹</span>
                <span className="text-white text-sm font-bold flex-1 text-center">화생공 24(4)</span>
                <span className="bg-white/20 text-white text-xs px-2 py-0.5 rounded-full">4</span>
              </div>
              <div className="bg-[#B2C7D9] p-4 flex flex-col gap-3">
                {[
                  { emoji: '😎', name: '민준', msg: '이번주 토요일 다들 되지? 어디서 볼까', time: '오후 2:31' },
                  { emoji: '🙂', name: '서연', msg: 'ㅇㅇ 난 아무데나~', time: '오후 2:33' },
                  { emoji: '😊', name: '지훈', msg: '나도 다 좋은데.. 어디가 좋으려나', time: '오후 2:35' },
                  { emoji: '🤔', name: '수빈', msg: '맛집 아는 사람? 나는 모르겠는데', time: '오후 2:38' },
                ].map((m) => (
                  <div key={m.name} className="flex items-end gap-2">
                    <div className="w-8 h-8 rounded-xl bg-gray-300 flex items-center justify-center text-base flex-shrink-0">{m.emoji}</div>
                    <div>
                      <div className="text-xs text-gray-600 mb-1">{m.name}</div>
                      <div className="bg-white rounded-2xl px-3 py-2 text-sm text-gray-800 shadow-sm">{m.msg}</div>
                    </div>
                    <div className="text-xs text-gray-500 mb-1">{m.time}</div>
                  </div>
                ))}
                <div className="flex items-end gap-2 flex-row-reverse">
                  <div className="bg-[#FEE500] rounded-2xl px-3 py-2 text-sm text-gray-800 shadow-sm">ㅋㅋ 누가 정해줘...</div>
                  <div className="text-xs text-gray-500 mb-1">오후 2:45</div>
                </div>
              </div>
            </div>

            <div className="mt-6 lg:hidden bg-teal-50 border border-teal-100 rounded-2xl p-5">
              <div className="text-sm font-bold text-gray-500 mb-3 text-center">모임 장소 정하는 데 걸리는 시간</div>
              <div className="flex items-center justify-center gap-4">
                <div className="text-center">
                  <div className="text-3xl font-black text-gray-300 line-through decoration-2">32분</div>
                  <div className="text-xs text-gray-500 mt-1">단톡방 실랑이</div>
                </div>
                <div className="text-2xl font-black text-[#3CDBC0]">→</div>
                <div className="text-center">
                  <div className="text-3xl font-black text-[#3CDBC0]">30초</div>
                  <div className="text-sm font-bold text-[#2AB5A0] mt-1">MINT로</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          RESULT PREVIEW — 결과부터 보여주기
          PC: 좌 폰목업 + 우 텍스트·3피처 2단
      ══════════════════════════════════════ */}
      <section className="fade-section">
        <div className="max-w-lg lg:max-w-7xl mx-auto px-6 py-14 lg:py-24 text-center lg:text-left lg:grid lg:grid-cols-2 lg:gap-16 lg:items-center">
          <div className="lg:order-2">
            <p className="text-xs font-bold tracking-widest text-[#3CDBC0] mb-3">RESULT</p>
            <h2 className="text-2xl lg:text-4xl font-bold text-gray-800 leading-tight mb-3">
              조건만 골랐을 뿐인데,<br />이런 결과가 나와요
            </h2>
            <p className="text-base lg:text-lg text-gray-500 mb-8 leading-relaxed">
              네이버 검증 실존 장소 · 적합도 점수 · 실시간 혼잡도<br />1차→2차 도보 동선까지 한 화면에
            </p>
            <div className="grid grid-cols-3 gap-2 lg:gap-3">
              {[
                { e: '🎯', t: '적합도 점수', d: '조건과 얼마나 맞는지 한눈에' },
                { e: '🚦', t: '실시간 혼잡도', d: '지금 웨이팅인지 미리 확인' },
                { e: '🚶', t: '2차 코스 연결', d: '도보 시간까지 계산된 동선' },
              ].map(({ e, t, d }) => (
                <div key={t} className="bg-white border border-gray-100 rounded-2xl p-3 lg:p-4 text-left">
                  <div className="text-xl lg:text-2xl mb-1">{e}</div>
                  <p className="text-sm lg:text-lg font-bold text-gray-800 mb-0.5">{t}</p>
                  <p className="text-[11px] lg:text-xs text-gray-500 leading-relaxed">{d}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-8 lg:mt-0 lg:order-1">
            <PhoneMockup src="/image/landing/result.webp" alt="MINT 추천 결과 — 1차 일식 다이닝, 2차 와인바 코스" width="w-64" />
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          HOW IT WORKS — 스텝 (모바일 세로 / PC 4열 그리드)
      ══════════════════════════════════════ */}
      <section className="bg-white border-y border-gray-100 fade-section">
        <div className="max-w-lg lg:max-w-7xl mx-auto px-6 py-14 lg:py-24">
          <div className="lg:text-center">
            <p className="text-xs font-bold tracking-widest text-[#3CDBC0] mb-3">HOW IT WORKS</p>
            <h2 className="text-2xl lg:text-4xl font-bold text-gray-800 leading-tight mb-3">
              고르기만 하면 <span className="lg:text-[#3CDBC0]">끝나는 4스텝</span>
            </h2>
            <p className="text-base lg:text-lg text-gray-500 mb-10 lg:mb-16 leading-relaxed">
              검색어를 몰라도 돼요. 전부 선택지로 준비되어 있으니까요.
            </p>
          </div>

          {/* 모바일: 세로 스택 + 연결선 / PC: 4열 그리드 (결과는 RESULT PREVIEW 섹션에서 별도로 보여줌) */}
          <div className="flex flex-col items-center gap-0 lg:grid lg:grid-cols-4 lg:gap-4 lg:items-start">
            {[
              { badge: 'STEP 1', title: '어떤 모임인지 골라요', desc: <>인원수와 1차·2차 목적(밥/술/카페),<br />먹을 메뉴가 정해졌다면 메뉴 콕으로 좁혀봐요</>, img: '/image/landing/purpose.webp', highlight: false },
              { badge: 'STEP 2', title: '누구와 함께하나요', desc: <>친구·연인·가족, 기념일·소개팅<br />같은 특별한 날까지 반영해요</>, img: '/image/landing/relation.webp', highlight: false },
              { badge: 'STEP 3', title: '어디서 만날까요', desc: <>원하는 동네를 직접 고르거나,<br />전원 출발지 중간지점을 맡겨요</>, img: '/image/landing/region.webp', highlight: false },
              { badge: 'STEP 4', title: '분위기와 못 먹는 음식까지', desc: <>1차·2차 분위기를 따로 고르고,<br />못 먹는 음식은 빼고 추천해요</>, img: '/image/landing/vibe.webp', highlight: false },
            ].map(({ badge, title, desc, img, highlight }, i) => (
              <div key={badge} className="contents lg:block">
                {i > 0 && (
                  <div className="w-0.5 h-8 bg-gradient-to-b from-[#3CDBC0] to-transparent my-2 lg:hidden" />
                )}
                <div className="text-center w-full">
                  <span className={`inline-block text-xs font-bold px-3 py-1 rounded-full mb-3 ${
                    highlight ? 'bg-white border-2 border-[#3CDBC0] text-[#2AB5A0]' : 'bg-[#3CDBC0] text-white font-bold'
                  }`}>{badge}</span>
                  <h3 className="text-lg font-bold text-gray-800 mb-1">{title}</h3>
                  <p className="text-base text-gray-500 mb-5 lg:min-h-[72px]">{desc}</p>
                  <PhoneMockup src={img} alt={`${badge} ${title}`} width="w-56 lg:w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          MENU CHOICE — 아무거나 vs 메뉴 콕 (1스텝 목적 선택 강조)
      ══════════════════════════════════════ */}
      <section className="bg-white border-y border-gray-100 fade-section">
        <div className="max-w-lg lg:max-w-5xl mx-auto px-6 py-14 lg:py-24">
          <div className="lg:text-center mb-8 lg:mb-14">
            <p className="text-xs font-bold tracking-widest text-[#3CDBC0] mb-3">MENU CHOICE</p>
            <h2 className="text-2xl lg:text-4xl font-bold text-gray-800 leading-tight mb-3">
              뭘 먹을지 몰라도, <span className="text-[#3CDBC0]">정해졌어도 OK</span>
            </h2>
            <p className="text-base lg:text-lg text-gray-500 leading-relaxed">
              <span className="block lg:inline">1차 목적만 고르면 끝 </span>
              <span className="block lg:inline">고민하는 사람도, 확실한 사람도 딱 맞게</span>
            </p>
          </div>

          <div className="lg:grid lg:grid-cols-2 lg:gap-14 lg:items-center">
            {/* 스마트폰 목업 — 메뉴 콕 직접 입력 화면 */}
            <div className="mb-8 lg:mb-0 lg:order-1">
              <PhoneMockup src="/image/landing/menu-demo.webp" alt="'메뉴 콕!'에 #회&초밥 #파스타를 입력하는 화면" width="w-56 lg:w-64" />
            </div>

            {/* 설명 카드 2개 */}
            <div className="flex flex-col gap-4 lg:order-2">
              {/* 아무거나 */}
              <div className="rounded-2xl border-2 border-gray-100 bg-gray-50/50 p-5 lg:p-6">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">🤷</span>
                  <p className="text-lg font-bold text-gray-800">뭘 먹을지 모르겠어요</p>
                </div>
                <p className="text-base text-gray-500 leading-relaxed mb-3">
                  <strong className="text-gray-700">밥 · 술 · 카페</strong>만 누르세요.<br />그 동네 찐맛집을 알아서 골라줘요.
                </p>
                <div className="flex flex-wrap gap-2">
                  {['🍽️ 밥', '🍻 술', '☕ 카페'].map((t) => (
                    <span key={t} className="bg-white border border-gray-200 text-gray-600 text-xs font-bold px-3 py-1.5 rounded-full">{t}</span>
                  ))}
                </div>
              </div>

              {/* 메뉴 콕 */}
              <div className="rounded-2xl border-2 border-[#3CDBC0] bg-teal-50 p-5 lg:p-6">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">🎯</span>
                  <p className="text-lg font-bold text-gray-800">이건 꼭 먹고 싶어요</p>
                </div>
                <p className="text-base text-gray-600 leading-relaxed mb-3 break-keep">
                  <strong className="text-[#2AB5A0]">메뉴 콕!</strong>에 먹고 싶은 걸 입력하면,<br />그대로 딱 맞는 맛집을 찾아드려요.
                </p>
                <p className="text-xs text-gray-500 mb-3 break-keep">
                  따로 쓰면 골고루, <strong className="text-[#2AB5A0]">&로 묶으면</strong> 한 집에서 다.
                </p>
                <div className="flex flex-col gap-2.5">
                  {/* & 로 묶으면 = 한 집에서 다 (짧은 줄을 위로) */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="bg-white border border-[#3CDBC0]/50 text-[#2AB5A0] text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap">#회&초밥</span>
                    <span className="text-[#3CDBC0] font-bold text-sm">→</span>
                    <span className="bg-[#3CDBC0] text-white text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap">회·초밥 다 되는 맛집</span>
                  </div>
                  {/* 따로 = 골고루 다른 집 (긴 줄을 아래로 — 안정감) */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="bg-white border border-[#3CDBC0]/50 text-[#2AB5A0] text-xs font-bold px-3 py-1.5 rounded-full">#보쌈</span>
                    <span className="bg-white border border-[#3CDBC0]/50 text-[#2AB5A0] text-xs font-bold px-3 py-1.5 rounded-full">#피자</span>
                    <span className="text-[#3CDBC0] font-bold text-sm">→</span>
                    <span className="bg-[#3CDBC0] text-white text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap">보쌈집·피자집 골고루</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          GROUP MODE — 역할 분리: 호스트(세팅) / 게스트(분위기만)
      ══════════════════════════════════════ */}
      <section className="py-14 lg:py-24 fade-section overflow-hidden">
        <div className="max-w-lg lg:max-w-5xl mx-auto px-6 lg:text-center mb-6 lg:mb-10">
          <p className="text-xs font-bold tracking-widest text-[#3CDBC0] mb-3">GROUP MODE</p>
          <h2 className="text-2xl lg:text-4xl font-bold text-gray-800 leading-tight mb-3">
            역할은 딱 둘, <span className="text-[#3CDBC0]">한 명이 세팅하면 끝</span>
          </h2>
          <p className="text-base lg:text-lg text-gray-500 leading-relaxed">
            <span className="block lg:inline">호스트가 코스·지역을 미리 정하니까, </span>
            <span className="block lg:inline"><strong className="text-gray-600">친구들은 분위기만 30초</strong> 고르면 끝나요</span>
          </p>
        </div>

        {(() => {
          const roleSteps = {
            host: {
              label: '호스트',
              badge: '🧑‍💼 링크 만드는 사람',
              desc: '코스·지역만 정하고 링크 공유. 딱 한 번만.',
              cols: 'lg:grid-cols-4',
              max: 'lg:max-w-none',
              steps: [
                { n: '1', title: '코스·인원 정하기', desc: '밥·술·카페 코스와 참여 인원을 호스트가 선점', img: '/image/landing/host-course.webp' },
                { n: '2', title: '만날 지역 정하기', desc: '중간지점 자동, 또는 만날 동네 직접 선택', img: '/image/landing/host-region.webp' },
                { n: '3', title: '링크 공유하기', desc: '단톡방에 링크만 던지면 초대 끝', img: '/image/landing/host-share.webp' },
                { n: '4', title: '나도 분위기 선택', desc: '호스트도 참여해서 원하는 분위기만 쓱', img: '/image/landing/host-vibe.webp' },
              ],
            },
            guest: {
              label: '친구들',
              badge: '🙋 링크 받는 사람',
              desc: '가입도, 출발지 고민도 없이 — 링크 열고 분위기만.',
              cols: 'lg:grid-cols-3',
              max: 'lg:max-w-[56.75rem] lg:mx-auto',
              steps: [
                { n: '1', title: '분위기만 몰래 선택', desc: '눈치 안 보고 각자 원하는 분위기·취향', img: '/image/landing/guest-vibe.webp' },
                { n: '2', title: '못 먹는 음식·편의시설', desc: '못 먹는 음식은 빼고, 필요한 시설만 콕', img: '/image/landing/guest-extra.webp' },
                { n: '3', title: '제출 완료', desc: '호스트가 정한 코스·지역과 내 취향 확인', img: '/image/landing/guest-done.webp' },
              ],
            },
          };
          const active = roleSteps[groupRole];
          const allImgs = [...roleSteps.host.steps, ...roleSteps.guest.steps].map((s) => s.img);
          return (
            <div className="max-w-7xl mx-auto px-6">
              <div className="relative flex gap-1.5 rounded-xl bg-white border border-gray-200 p-1 shadow-sm mb-5 lg:max-w-[360px] lg:mx-auto overflow-hidden">
                <span
                  className={`absolute left-1 top-1 bottom-1 w-[calc(50%-4px)] rounded-lg bg-[#3CDBC0] shadow-md shadow-[#3CDBC0]/25 transition-transform duration-300 ease-out ${
                    groupRole === 'guest' ? 'translate-x-[calc(100%+6px)]' : 'translate-x-0'
                  }`}
                  aria-hidden="true"
                />
                {(['host', 'guest'] as const).map((role) => {
                  const selected = groupRole === role;
                  return (
                    <button
                      key={role}
                      onClick={() => setGroupRole(role)}
                      className={`relative z-10 flex-1 rounded-lg px-3 py-2.5 text-xs font-black transition-colors duration-200 active:scale-[0.98] ${
                        selected
                          ? 'text-white'
                          : 'text-gray-500'
                      }`}
                    >
                      {roleSteps[role].badge}
                    </button>
                  );
                })}
              </div>

              <p className="text-sm lg:text-base text-gray-500 mb-2 lg:mb-10 lg:text-center leading-relaxed">{active.desc}</p>
              <p className="text-sm text-[#2AB5A0] font-bold mb-8 lg:hidden">옆으로 넘겨보세요 →</p>

              <div className={`flex gap-4 overflow-x-auto snap-x snap-mandatory scrollbar-hide pb-2 lg:grid ${active.cols} lg:gap-5 lg:overflow-visible ${active.max}`}>
                {active.steps.map(({ n, title, desc, img }) => (
                  <div key={`${groupRole}-${n}`} className="snap-center flex-shrink-0 w-60 lg:w-full text-center">
                    <div className="flex items-center justify-center gap-2 mb-1.5">
                      <span className="w-6 h-6 rounded-full bg-[#3CDBC0] text-white text-xs font-black flex items-center justify-center flex-shrink-0">{n}</span>
                      <span className="text-base font-semibold text-gray-800">{title}</span>
                    </div>
                    <p className="text-sm text-gray-500 mb-4 leading-relaxed min-h-[48px] lg:min-h-[56px]">{desc}</p>
                    <PhoneMockup src={img} alt={`${active.label} ${title}`} width="w-full" />
                  </div>
                ))}
              </div>
              <div className="hidden" aria-hidden="true">
                {allImgs.map((img) => <img key={img} src={img} alt="" loading="eager" />)}
              </div>
            </div>
          );
        })()}

        <div className="max-w-lg lg:max-w-2xl mx-auto px-6 mt-10 lg:mt-16">
          <div className="bg-teal-50 border border-teal-100 rounded-2xl p-4 lg:p-6 text-center">
            <p className="text-base lg:text-lg text-gray-600 leading-relaxed">
              "난 아무데나 괜찮아"가 진짜였는지,<br />
              <strong className="text-[#2AB5A0]">몰래 고른 취향이 전부 반영</strong>됩니다. 눈치 게임 없이, 공평하게.
            </p>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          WHY MINT — 비교 (모바일 세로 / PC 나란히)
      ══════════════════════════════════════ */}
      <section className="bg-white border-y border-gray-100 fade-section">
        <div className="max-w-lg lg:max-w-5xl mx-auto px-6 py-14 lg:py-24">
          <div className="lg:text-center">
            <p className="text-xs font-bold tracking-widest text-[#3CDBC0] mb-3">WHY MINT?</p>
            <h2 className="text-2xl lg:text-4xl font-bold text-gray-800 leading-tight mb-3">
              네이버 지도와 뭐가 다를까?
            </h2>
            <p className="text-base lg:text-lg text-gray-500 mb-6 lg:mb-12 leading-relaxed">
              지도 앱은 <strong className="text-gray-600">검색어가 있는 사람</strong>을 위한 도구.<br />
              MINT는 <strong className="text-gray-600">뭘 검색할지 모르는 사람</strong>을 위한 서비스입니다.
            </p>
          </div>
          <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
            <div className="lg:flex-1 rounded-2xl border border-gray-200 p-5 lg:p-7">
              <div className="flex items-center gap-2 mb-4">
                <svg className="w-6 h-6 text-gray-500" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                </svg>
                <span className="font-bold text-gray-500">기존 지도 앱</span>
              </div>
              <ul className="flex flex-col gap-2 lg:gap-3">
                {['검색어를 알아야 검색 가능', '결과 수십 개 → 또 고민', '중간 지점? 내가 계산해야 함', '광고성 상위 노출 — 진짜 맛집인지 모름', '결국 지쳐서 늘 가던 곳으로'].map((t) => (
                  <li key={t} className="flex items-start gap-2 text-base lg:text-lg text-gray-500">
                    <span className="text-gray-300 mt-0.5">✕</span>{t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="lg:flex-1 rounded-2xl border-2 border-[#3CDBC0] bg-teal-50 p-5 lg:p-7">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 rounded-md bg-[#3CDBC0] flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-[10px] font-black leading-none">M</span>
                </div>
                <span className="font-bold text-[#2AB5A0]">MINT</span>
              </div>
              <ul className="flex flex-col gap-2 lg:gap-3">
                {[
                  '검색어 없이 조건만 선택하면 끝',
                  'AI가 엄선한 3곳 추천 — 선택 피로 제로',
                  '원하는 동네 직접 선택도, 중간지점 자동 계산도',
                  '전국 79만 실존 장소 · 혼잡도 · 날씨 · 버즈 반영',
                  '카카오톡 한 번이면 공유 완료',
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2 text-base lg:text-lg text-gray-800">
                    <span className="text-[#2AB5A0] font-bold mt-0.5">✓</span>{t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          REAL PICK — 바이럴 거르고 찐맛집만 (PC 2×2)
      ══════════════════════════════════════ */}
      <section className="fade-section">
        <div className="max-w-lg lg:max-w-5xl mx-auto px-6 py-14 lg:py-24">
          <div className="rounded-3xl overflow-hidden p-6 lg:p-12 result-gradient shadow-xl shadow-teal-200">
            <div className="lg:text-center">
              <p className="text-xs font-bold tracking-widest text-white/70 mb-3">REAL PICK</p>
              <h2 className="text-2xl lg:text-4xl font-bold text-white leading-tight mb-3">
                바이럴은 거르고, <span className="text-yellow-200">찐맛집</span>만 담았어요
              </h2>
              <p className="text-base lg:text-lg text-white/80 mb-6 lg:mb-10 leading-relaxed">
                협찬으로 뜬 가게와 진짜 사랑받는 가게.<br />
                MINT는 데이터로 구분합니다.
              </p>
            </div>

            <div className="flex flex-col gap-2.5 lg:grid lg:grid-cols-2 lg:gap-4">
              {[
                {
                  e: '🫧',
                  t: '후기 거품 감지',
                  d: <>어느 날 갑자기 후기가 우르르 몰린 가게, 협찬 냄새 나죠? 그런 <strong className="text-yellow-200">거품은 점수를 깎고</strong>, 꾸준히 후기가 쌓인 가게만 올려요.</>,
                },
                {
                  e: '🏅',
                  t: '오래 버틴 가게 우대',
                  d: <>정부 인허가 데이터로 개업 연차를 확인해요. 유행 따라 생겼다 사라지는 곳 말고, <strong className="text-yellow-200">몇 년째 한자리를 지킨 가게에 가산점</strong>.</>,
                },
                {
                  e: '📍',
                  t: 'AI가 지어낸 가게 0곳',
                  d: <>그럴듯한 이름만 지어내는 AI 추천과 달라요. 네이버에 실제 등록된 전국 79만 곳과 대조해 <strong className="text-yellow-200">실존 장소만</strong> 보여줘요.</>,
                },
                {
                  e: '🚦',
                  t: '지금 가도 되는지까지',
                  d: <>아무리 맛집이어도 웨이팅 2시간이면 꽝. <strong className="text-yellow-200">실시간 혼잡도와 오늘 날씨</strong>까지 보고 "지금" 좋은 곳을 골라요.</>,
                },
              ].map(({ e, t, d }) => (
                <div key={t} className="bg-white/15 rounded-2xl p-4 lg:p-5 flex items-start gap-3">
                  <span className="text-2xl flex-shrink-0">{e}</span>
                  <div>
                    <p className="text-base lg:text-lg font-semibold text-white mb-1">{t}</p>
                    <p className="text-sm lg:text-base text-white/80 leading-relaxed">{d}</p>
                  </div>
                </div>
              ))}
            </div>

            <p className="text-center text-base lg:text-lg font-bold text-white mt-6 lg:mt-10">
              MINT는 광고를 팔지 않아요.<br className="lg:hidden" />
              <span className="text-sm lg:text-base font-medium text-white/80"> 그래서 추천에 <strong className="text-yellow-200 font-bold">광고비가 안 통합니다</strong>.</span>
            </p>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          CERTIFIED — 신뢰 큐레이션(인증 리스트 소개)
      ══════════════════════════════════════ */}
      <CertShowcase />

      {/* ══════════════════════════════════════
          USE CASES — 이모지 타일 (모바일 2×2 / PC 4열)
      ══════════════════════════════════════ */}
      <section className="fade-section">
        <div className="max-w-lg lg:max-w-7xl mx-auto px-6 py-14 lg:py-24">
          <p className="text-xs font-bold tracking-widest text-[#3CDBC0] mb-3 text-center">FOR EVERY 모임</p>
          <h2 className="text-2xl lg:text-4xl font-bold text-gray-800 leading-tight mb-8 lg:mb-14 text-center">
            지금 잡혀 있는 <span className="lg:text-[#3CDBC0]">바로 그 약속부터</span>
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-5">
            {[
              { e: '🍻', t: '친구 모임', d: '"아무데나"의 늪 탈출, 2차까지 한 번에' },
              { e: '💕', t: '연인 데이트', d: '기념일 · 100일 · 분위기 좋은 코스' },
              { e: '🏢', t: '직장 회식', d: '단체룸 · 전원 퇴근길 중간지점' },
              { e: '👨‍👩‍👧', t: '가족 모임', d: '넓은 공간 · 주차 · 부모님 취향까지' },
            ].map(({ e, t, d }) => (
              <button key={t} onClick={goToApp}
                className="vibe-card bg-white border border-gray-100 rounded-2xl p-5 lg:p-8 text-center shadow-sm hover:border-[#3CDBC0] hover:shadow-md">
                <div className="text-3xl lg:text-5xl mb-2 lg:mb-4">{e}</div>
                <p className="text-base lg:text-lg font-bold text-gray-800 mb-1">{t}</p>
                <p className="text-xs lg:text-sm text-gray-500 leading-relaxed">{d}</p>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          SHARE — 카톡 공유 플로우
      ══════════════════════════════════════ */}
      <section className="bg-white border-y border-gray-100 fade-section">
        <div className="max-w-lg lg:max-w-3xl mx-auto px-6 py-14 lg:py-24 lg:text-center">
          <p className="text-xs font-bold tracking-widest text-[#3CDBC0] mb-3">SHARE</p>
          <h2 className="text-2xl lg:text-4xl font-bold text-gray-800 leading-tight mb-3">
            추천 받자마자 <span className="text-[#3CDBC0]">카카오톡으로 공유</span>
          </h2>
          <p className="text-base lg:text-lg text-gray-500 mb-6 lg:mb-10 leading-relaxed">
            결과 나오면 버튼 하나로 단톡방에 공유.<br />'여기 어때?' 한 줄이면 약속 끝.
          </p>
          <div className="flex items-center justify-center gap-2 flex-nowrap">
            <span className="bg-teal-50 border border-teal-200 text-[#2AB5A0] text-sm lg:text-base font-bold px-4 lg:px-5 py-2 lg:py-2.5 rounded-full whitespace-nowrap">🍃 조건 선택</span>
            <span className="text-[#3CDBC0] font-bold flex-shrink-0">→</span>
            <span className="bg-teal-50 border border-teal-200 text-[#2AB5A0] text-sm lg:text-base font-bold px-4 lg:px-5 py-2 lg:py-2.5 rounded-full whitespace-nowrap">✨ 장소 추천</span>
            <span className="text-[#3CDBC0] font-bold flex-shrink-0">→</span>
            <div className="flex items-center gap-1.5 bg-teal-50 border border-teal-200 text-[#2AB5A0] text-sm lg:text-base font-bold px-3 lg:px-4 py-2 lg:py-2.5 rounded-full whitespace-nowrap flex-shrink-0">
              <KakaoTalkBubble className="w-4 h-4" />
              카톡 공유
            </div>
          </div>

          {/* 단톡방에 공유된 모습 미리보기 */}
          <div className="mt-9 lg:mt-12 max-w-sm mx-auto">
            <div className="rounded-2xl bg-[#B2C7D9] p-4 shadow-md">
              <div className="flex items-start gap-2 flex-row-reverse text-left">
                <div className="w-full">
                  <div className="ml-auto max-w-[85%] overflow-hidden rounded-2xl rounded-tr-md bg-[#FEE500] shadow-sm">
                    <div className="px-3.5 py-3">
                      <p className="text-[13px] font-bold text-gray-800">📍 오늘 여기 어때?</p>
                    </div>
                    <div className="border-t border-black/5 bg-white px-3.5 py-3">
                      <p className="text-[13px] font-bold text-gray-800">안목 성수 · 시끌벅적 국밥</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">1차 밥 → 2차 술 · 적합도 88점</p>
                      <div className="mt-2 flex items-center gap-1 text-[11px] font-bold text-[#2AB5A0]">
                        <KakaoTalkBubble className="w-3.5 h-3.5" /> MINT 추천 열어보기
                      </div>
                    </div>
                  </div>
                  <div className="mt-1 text-right text-[10px] text-gray-500">오후 6:12 · 읽음 3</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          FAQ — 모바일 1열 / PC 2열
      ══════════════════════════════════════ */}
      <section className="fade-section">
        <div className="max-w-lg lg:max-w-5xl mx-auto px-6 py-14 lg:py-24">
          <p className="text-xs font-bold tracking-widest text-[#3CDBC0] mb-3 text-center">FAQ</p>
          <h2 className="text-2xl lg:text-4xl font-bold text-gray-800 leading-tight mb-8 lg:mb-14 text-center">
            자주 묻는 질문
          </h2>
          <div className="space-y-3 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-4">
            {[
              {
                q: '정말 무료인가요?',
                a: '네. 회원가입도 로그인도 없이 완전 무료입니다. 접속해서 조건만 고르면 바로 추천받을 수 있어요.',
              },
              {
                q: '추천 장소는 믿을 수 있나요?',
                a: '네이버에 등록된 실존 장소만 추천합니다. 여기에 실시간 혼잡도, 날씨, 블로그 버즈, 오래된 가게 가산점까지 반영해 AI가 최종 3곳을 골라줍니다. 우체국·정부·미쉐린 가이드 등 공식 인증 리스트에 오른 곳은 인증 마크로 함께 알려드려요.',
              },
              {
                q: '친구들과 어떻게 같이 정하나요?',
                a: '"다같이 정할게요"를 선택해 링크를 만들고 단톡방에 공유하세요. 각자 출발지와 취향을 30초씩 입력하면 전원의 취향이 종합돼요. 만날 곳은 전원 출발지 기준 중간지점을 자동 계산하거나, 원하는 동네를 직접 골라도 됩니다.',
              },
              {
                q: '추천이 마음에 안 들면요?',
                a: '"다시 추천받기"에서 이유(비싸요/멀어요/분위기가 아니에요)를 고르면, 그 피드백을 반영해 다른 장소를 추천해드립니다.',
              },
              {
                q: '서울만 되나요?',
                a: '전국을 지원합니다. 전국 79만 곳의 인허가 데이터 기반으로, 어느 지역이든 실존 장소를 추천해드려요.',
              },
              {
                q: '앱을 꼭 설치해야 하나요?',
                a: '아니요. 설치 없이 웹에서 바로 쓸 수 있어요. 자주 쓸 것 같으면 홈 화면에 추가해 앱처럼 사용할 수도 있습니다.',
              },
            ].map(({ q, a }) => (
              <div key={q} className="bg-white border border-gray-100 rounded-2xl p-5 lg:p-6">
                <p className="text-base lg:text-lg font-semibold text-gray-800 mb-2">{q}</p>
                <p className="text-base text-gray-600 leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          FINAL CTA
      ══════════════════════════════════════ */}
      <section className="bg-gradient-to-b from-[#F0FDF9] to-[#E8FBF3] fade-section">
        <div className="max-w-lg lg:max-w-3xl mx-auto px-6 py-14 lg:pt-20 lg:pb-28 text-center">
          <h2 className="text-3xl lg:text-6xl font-black text-gray-800 leading-tight mb-1">어디서 만나지?</h2>
          <h2 className="text-3xl lg:text-6xl font-black text-[#3CDBC0] leading-tight mb-3 lg:mb-4">MINT 하지, 뭐.</h2>
          <div className="flex items-center justify-center gap-2.5 mb-4 lg:mb-6">
            <span className="h-px w-6 bg-teal-200" />
            <span className="text-xs lg:text-sm font-bold text-[#2AB5A0] tracking-wide">MINT · Meet in one tap</span>
            <span className="h-px w-6 bg-teal-200" />
          </div>
          <p className="text-base lg:text-lg text-gray-500 mb-8">무료로 시작하세요. 회원가입도 없어요.</p>
          <div className="flex flex-col gap-3 w-full max-w-xs mb-6 mx-auto">
            <button
              onClick={goToApp}
              className="w-full bg-gradient-to-r from-[#3CDBC0] to-[#2AB5A0] text-white font-black text-lg py-4 rounded-xl cta-glow-mint active:scale-95 transition-all"
            >
              지금 바로 추천받기
            </button>
            {installButton}
          </div>
          {visitCount >= 50 && (
            <p className="text-sm text-gray-500 mb-6">
              지금까지 <strong className="text-[#2AB5A0]">{visitCount.toLocaleString()}번</strong>의 "어디서 만나지?" 고민이 MINT를 찾아왔어요
            </p>
          )}
          <div className="flex justify-center gap-4 flex-wrap">
            <div className="flex items-center gap-1 text-sm text-gray-500">
              <svg className="w-3.5 h-3.5 text-[#3CDBC0]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 2.05V2c0-1.1-.9-2-2-2s-2 .9-2 2v.05C4.6 2.55 1 6.5 1 11.5 1 17.3 5.7 22 11.5 22S22 17.3 22 11.5c0-5-3.6-8.95-9-9.45zM11.5 20C6.81 20 3 16.19 3 11.5S6.81 3 11.5 3 20 6.81 20 11.5 16.19 20 11.5 20zm.5-10.31V7c0-.55-.45-1-1-1s-1 .45-1 1v3c0 .28.11.53.29.71l2 2c.39.39 1.02.39 1.41 0 .39-.39.39-1.02 0-1.41L12 9.69z"/>
              </svg>
              30초면 끝
            </div>
            <div className="flex items-center gap-1 text-sm text-gray-500">
              <svg className="w-3.5 h-3.5 text-[#CC785C]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z"/>
              </svg>
              장소 추천
            </div>
            <div className="flex items-center gap-1 text-sm text-gray-500">
              <KakaoTalkBubble className="w-3.5 h-3.5" />
              카톡 공유
            </div>
            <div className="flex items-center gap-1 text-sm text-gray-500">
              <svg className="w-3.5 h-3.5 text-[#3CDBC0]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/>
              </svg>
              완전 무료
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-white border-t border-gray-100 py-6 text-center">
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setShowPrivacy(true)}
            className="text-xs text-gray-500 underline hover:text-gray-600 transition-colors"
          >
            개인정보처리방침
          </button>
          <span className="text-gray-200 text-xs">·</span>
          <p className="text-xs text-gray-500">© 2026 MINT. All rights reserved.</p>
        </div>
      </footer>

      {/* 개인정보처리방침 모달 */}
      {showPrivacy && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center px-0 sm:px-4"
          onClick={() => setShowPrivacy(false)}
        >
          <div
            className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-lg max-h-[80vh] overflow-y-auto px-6 pt-6 pb-[max(2rem,calc(env(safe-area-inset-bottom)+0.75rem))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-gray-800">개인정보처리방침</h3>
              <button onClick={() => setShowPrivacy(false)} className="text-gray-500 hover:text-gray-700 text-xl px-2">✕</button>
            </div>
            <div className="space-y-5 text-sm text-gray-600 leading-relaxed">
              <div>
                <p className="text-xs font-bold text-gray-800 mb-1.5 uppercase tracking-wider">수집하는 정보</p>
                <p>
                  장소 추천을 위해 출발지(지역명·좌표), 모임 조건(인원·목적·분위기·예산)을 입력받습니다.
                  그룹 모드에서는 참여자가 입력한 이름과 출발지가, 예약 요청 시에는 이름과 인원수가 저장됩니다.
                  회원가입이 없으므로 계정 정보는 수집하지 않습니다.
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-800 mb-1.5 uppercase tracking-wider">이용 목적</p>
                <p>
                  입력된 정보는 장소 추천 생성과 서비스 개선을 위한 통계(방문·클릭 수 집계)에만 사용됩니다.
                  마케팅이나 제3자 제공 목적으로 사용하지 않습니다.
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-800 mb-1.5 uppercase tracking-wider">AI 처리</p>
                <p>
                  추천 생성 시 모임 조건이 Anthropic API(Claude)로 전송되며, Anthropic의
                  개인정보처리방침을 따릅니다. 이름 등 식별 정보는 AI에 전송되지 않습니다.
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-800 mb-1.5 uppercase tracking-wider">보관 및 파기</p>
                <p>
                  데이터는 Supabase(클라우드 DB)에 저장되며, 삭제를 원하시면 문의 채널로 요청해주세요.
                  그룹 세션 데이터는 모임 종료 후 별도 활용 없이 보관 기간 경과 시 삭제됩니다.
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowPrivacy(false)}
              className="w-full mt-6 py-3.5 rounded-xl bg-[#3CDBC0] text-white font-bold text-sm active:scale-95 transition-all"
            >
              확인
            </button>
          </div>
        </div>
      )}

      {/* iOS는 자동 설치 API가 없어 Safari 홈 화면 추가 안내가 필요하다. */}
      {guide && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
          onClick={() => setGuide(null)}
          role="presentation"
        >
          <div
            className="w-full max-w-lg rounded-t-3xl bg-white px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
          >
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />
            <div className="mb-3 inline-flex rounded-full bg-[#E8F8F5] px-3 py-1 text-xs font-bold text-[#2AB5A0]">
              전체화면을 해제했어요
            </div>
            <h3 id="ios-install-title" className="mb-2 break-keep text-xl font-black tracking-tight text-gray-800">
              아이폰에서도 MINT를 앱처럼
            </h3>
            <p className="mb-5 break-keep text-sm leading-relaxed text-gray-500">
              한 번만 추가해두면 다음부터 홈 화면에서 바로 시작할 수 있어요.
            </p>
            <div className="flex flex-col gap-3 mb-6">
              {(guide === 'ios-kakao'
                ? [
                    { n: 1, t: 'Safari로 열기', d: '카카오톡 메뉴에서 Safari로 열어주세요.' },
                    { n: 2, t: '공유 버튼 누르기', d: 'Safari 아래쪽의 □↑ 아이콘이에요.' },
                    { n: 3, t: '홈 화면에 추가', d: '목록에서 선택한 뒤 오른쪽 위 추가를 눌러주세요.' },
                  ]
                : [
                    { n: 1, t: '공유 버튼 누르기', d: 'Safari 아래쪽의 □↑ 아이콘이에요.' },
                    { n: 2, t: '홈 화면에 추가', d: '공유 목록을 조금 내려서 선택해주세요.' },
                    { n: 3, t: '추가 누르기', d: '오른쪽 위 추가를 누르면 끝이에요.' },
                  ]
              ).map(({ n, t, d }) => (
                <div key={n} className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-[#3CDBC0] text-white text-xs font-black flex items-center justify-center flex-shrink-0">{n}</div>
                  <div className="min-w-0 break-keep">
                    <p className="text-sm font-bold leading-snug text-gray-800">{t}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{d}</p>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => setGuide(null)}
              className="w-full py-3.5 rounded-xl bg-[#3CDBC0] text-white font-bold text-sm active:scale-95 transition-all"
            >
              알겠어요
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
