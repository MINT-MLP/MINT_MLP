import { useCallback, useEffect, useState } from 'react';
import Home from '@/pages/Home';
import HomeHub from '@/pages/HomeHub';
import { BottomTabBar, ResumeRecommendSheet, FeedbackFab, FEEDBACK_OPENED_KEY, FeedbackSheet } from '@/components';
import MyMeetings from '@/pages/mock/MyMeetings';
import Discover from '@/pages/mock/Discover';
import MintShop from '@/pages/mock/MintShop';
import Profile from '@/pages/Profile';
import { clearRecommendSession, loadResultSnapshot, loadResultSummary } from '@/storage/history';
import { navigateApp, parseAppRoute, tabPath } from '@/utils/appRoute';
import { trackEvent } from '@/services/analytics';
import { bindOutboxExitFlush, flushOutbox } from '@/storage/feedback';
import type { TabKey, ResultSummary } from '@/types';

// /app 셸 — 주소가 화면을 정한다(utils/appRoute). 홈 탭은 홈(허브)·추천 단계·결과, 나머지 탭은 탭마다 한 화면.
// 탭바는 기본으로 보이고, 각 화면이 onChromeChange(false)로 내린다 — 바텀시트가 열렸을 때, 추천 입력 단계·추천을 기다리는 동안.

// 카카오 로그인 복귀 표식 — redirectTo가 /app?tab=profile인 곳은 auth.ts뿐이다.
const isKakaoReturn = () =>
  new URLSearchParams(window.location.search).get('tab') === 'profile';

export default function AppShell({ path, search }: { path: string; search: string }) {
  const route = parseAppRoute(path, search);
  const activeTab: TabKey = route.tab;
  const [showTabBar, setShowTabBar] = useState(true);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // 지난번에 못 보낸 피드백을 앱 켤 때 한 번 조용히 재전송한다(서버가 멱등이라 중복 저장은 없다).
  // 나갈 때(pagehide·백그라운드 전환)도 한 번 더 시도한다 — 광고로 들어온 사람은 대개 앱을
  // 다시 켜지 않아서, 재전송 기회가 "앱 켜기"뿐이면 밀린 피드백이 영영 못 나간다.
  useEffect(() => {
    flushOutbox();
    bindOutboxExitFlush();
  }, []);

  // 카카오 로그인은 페이지를 통째로 떠났다가 이 셸로 돌아온다. 보던 추천이 아직 살아 있으면
  // 홈 탭을 직접 찾아 누르게 두지 말고 돌아갈지 물어본다.
  // 판정에 쓴 ?tab=profile은 즉시 지운다 — 새로고침마다 다시 묻지 않도록.
  // (App의 라우터는 popstate만 구독하므로 replaceState는 라우팅을 건드리지 않는다. pathname도 그대로다.)
  // 해시는 반드시 보존한다 — 이 클라이언트는 flowType 기본값이 implicit이라 카카오 토큰이
  // #access_token=…으로 돌아오고, supabase-js가 그걸 비동기로 파싱한다. 여기서 해시를 지우면
  // 파싱 전에 토큰이 사라져 로그인이 통째로 실패할 수 있다. 해시 정리는 supabase가 알아서 한다.
  const [resumeSummary, setResumeSummary] = useState<ResultSummary | null>(() =>
    isKakaoReturn() ? loadResultSummary() : null
  );
  useEffect(() => {
    if (!isKakaoReturn()) return;
    navigateApp('/app/profile', { replace: true });   // 해시(#access_token)는 navigateApp이 보존한다
    if (resumeSummary) trackEvent('resume_prompt_shown');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 결과 주소인데 되살릴 결과가 없으면(스냅샷 없음·다른 추천) 홈을 그리고 주소도 홈으로 바꾼다.
  // 그리기 전에 판정한다 — 추천 화면을 띄운 뒤 바꾸면 그 화면의 주소 맞추기와 엇갈린다.
  const resultMissing = route.home === 'result' && (() => {
    const snap = loadResultSnapshot();
    return !snap || (route.resultId != null && snap.recommendationId !== route.resultId);
  })();
  useEffect(() => {
    if (resultMissing) navigateApp('/app', { replace: true });
  }, [resultMissing]);

  // 화면을 옮길 때는 항상 탭바를 되살린다 — 이전 화면에서 시트가 열려 있던 상태가 새면 탭바가 영영 사라진다.
  const screenKey = route.tab === 'home' ? (route.home === 'hub' || resultMissing ? 'hub' : 'flow') : route.tab;
  const [prevKey, setPrevKey] = useState(screenKey);
  if (prevKey !== screenKey) {
    setPrevKey(screenKey);
    setShowTabBar(true);
  }

  const changeTab = useCallback((tab: TabKey) => {
    navigateApp(tabPath(tab));
  }, []);

  return (
    <div className="bg-mint-50" style={{ minHeight: 'var(--mint-app-height, 100dvh)' }}>
      {/* 탭 전환 crossfade — key로 재마운트해 150ms opacity 페이드인만 준다.
          가로 슬라이드는 넣지 않는다(과함). 기존 index.css의 fadeIn을 재사용하되
          .animate-fade-in이 animation 단축 속성(0.45s)이라 유틸리티 클래스로는
          지속시간을 못 덮는다 — 인라인으로 150ms만 지정한다.
          opacity 애니메이션은 fixed 자식의 containing block을 바꾸지 않으므로
          Home의 하단 고정 바·토스트는 그대로 동작한다. */}
      <div key={screenKey} className="animate-fade-in" style={{ animationDuration: '150ms' }}>
        {screenKey === 'flow' ? (
          <Home screen={route.home === 'result' ? 'result' : 'recommend'} fresh={route.fresh} onChromeChange={setShowTabBar} />
        ) : (
          <div className="pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
            {screenKey === 'hub' && <HomeHub />}
            {activeTab === 'meetings' && (
              <MyMeetings onGoHome={() => changeTab('home')} onChromeChange={setShowTabBar} />
            )}
            {activeTab === 'discover' && <Discover />}
            {activeTab === 'shop' && <MintShop onChromeChange={setShowTabBar} />}
            {activeTab === 'profile' && <Profile onChromeChange={setShowTabBar} />}
          </div>
        )}
      </div>
      {showTabBar && <BottomTabBar active={activeTab} onChange={changeTab} />}
      {/* 피드백 FAB는 탭바와 운명을 같이한다 — 탭이 시트를 열면(onChromeChange(false)) 함께 사라진다.
          결과 화면에서는 공유 바와 겹치므로 띄우지 않는다. */}
      {showTabBar && screenKey !== 'flow' && (
        <FeedbackFab
          hidden={feedbackOpen}
          onOpen={() => {
            // 한 번이라도 열었으면 유도 말풍선은 영구 중단(참여한 유저를 더 조르지 않는다)
            try { localStorage.setItem(FEEDBACK_OPENED_KEY, '1'); } catch { /* ignore */ }
            setFeedbackOpen(true);
          }}
        />
      )}
      {feedbackOpen && (
        <FeedbackSheet tab={activeTab} onClose={() => setFeedbackOpen(false)} />
      )}
      {resumeSummary && (
        <ResumeRecommendSheet
          summary={resumeSummary}
          onResume={() => {
            trackEvent('resume_prompt_accept');
            setResumeSummary(null);
            navigateApp('/app/result');   // 결과 주소로 열면 Home이 스냅샷을 복원한다
          }}
          onDiscard={() => {
            trackEvent('resume_prompt_discard');
            // 복원 재료를 지워야 홈이 '앱을 처음 켠 첫 화면'으로 열린다. 탭 전환은 하지 않는다 —
            // 새로 시작하겠다는 뜻이지 지금 홈으로 가겠다는 뜻은 아니므로 프로필에 머문다.
            clearRecommendSession();
            setResumeSummary(null);
          }}
        />
      )}
    </div>
  );
}
