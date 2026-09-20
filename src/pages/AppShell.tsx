import { useCallback, useEffect, useState } from 'react';
import Home from '@/pages/Home';
import { BottomTabBar, ResumeRecommendSheet, FeedbackFab, FEEDBACK_OPENED_KEY, FeedbackSheet } from '@/components';
import MyMeetings from '@/pages/mock/MyMeetings';
import Discover from '@/pages/mock/Discover';
import MintShop from '@/pages/mock/MintShop';
import Profile from '@/pages/Profile';
import { clearRecommendSession, loadResultSummary } from '@/storage/history';
import { trackEvent } from '@/services/analytics';
import { ensureSession } from '@/services/auth';
import { bindOutboxExitFlush, flushOutbox } from '@/storage/feedback';
import type { TabKey, ResultSummary } from '@/types';

// /app 셸 — 홈 탭의 콘텐츠는 항상 추천 플로우(Home)다.
// 탭바를 보여도 되는지는 각 탭이 onChromeChange로 보고한다(셸은 localStorage를 보지 않는다).
// 홈은 입력 1단계에서만, 나머지 탭은 바텀시트가 열리면 탭바를 내린다(시트 하단 CTA 가림 방지).
// 탭 상태는 URL에 싣지 않는다(기존 path 라우터를 건드리지 않기 위해).

// 카카오 로그인 복귀 표식 — redirectTo가 /app?tab=profile인 곳은 auth.ts뿐이다.
const isKakaoReturn = () =>
  new URLSearchParams(window.location.search).get('tab') === 'profile';

export default function AppShell() {
  // 카카오 로그인 복귀(/app?tab=profile)에서만 프로필 탭으로 연다.
  const [activeTab, setActiveTab] = useState<TabKey>(() => (isKakaoReturn() ? 'profile' : 'home'));
  const [showTabBar, setShowTabBar] = useState(true);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // 지난번에 못 보낸 피드백을 앱 켤 때 한 번 조용히 재전송한다(서버가 멱등이라 중복 저장은 없다).
  // 나갈 때(pagehide·백그라운드 전환)도 한 번 더 시도한다 — 광고로 들어온 사람은 대개 앱을
  // 다시 켜지 않아서, 재전송 기회가 "앱 켜기"뿐이면 밀린 피드백이 영영 못 나간다.
  useEffect(() => {
    // /app에 들어온 방문자는 익명 사용자로 세션을 갖는다(랜딩만 보고 나가는 사람은 제외).
    // 이후 서버 저장은 전부 이 user.id 기준. 카카오 로그인은 세션을 회원 유저로 교체한다.
    void ensureSession();
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
    window.history.replaceState(null, '', `/app${window.location.hash}`);
    if (resumeSummary) trackEvent('resume_prompt_shown');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 탭을 옮길 때는 항상 탭바를 되살린다 — 이전 탭에서 시트가 열려 있던 상태가 다음 탭으로 새면
  // 탭바가 영영 사라진다. 새 탭이 다시 보고하기 전의 기본값은 "보임"이어야 한다.
  // (홈으로 갈 때도 Home이 useLayoutEffect로 페인트 전에 정정하므로 깜빡임은 없다.)
  const changeTab = useCallback((tab: TabKey) => {
    setShowTabBar(true);
    setActiveTab(tab);
  }, []);

  return (
    <div className="bg-mint-50" style={{ minHeight: 'var(--mint-app-height, 100dvh)' }}>
      {/* 탭 전환 crossfade — key로 재마운트해 150ms opacity 페이드인만 준다.
          가로 슬라이드는 넣지 않는다(과함). 기존 index.css의 fadeIn을 재사용하되
          .animate-fade-in이 animation 단축 속성(0.45s)이라 유틸리티 클래스로는
          지속시간을 못 덮는다 — 인라인으로 150ms만 지정한다.
          opacity 애니메이션은 fixed 자식의 containing block을 바꾸지 않으므로
          Home의 하단 고정 바·토스트는 그대로 동작한다. */}
      <div key={activeTab} className="animate-fade-in" style={{ animationDuration: '150ms' }}>
        {activeTab === 'home' ? (
          <Home onChromeChange={setShowTabBar} />
        ) : (
          <div className="pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
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
      {/* 피드백 FAB는 탭바와 운명을 같이한다 — 탭이 시트를 열거나(onChromeChange(false)) 홈이
          입력 스텝·결과 화면에 들어가면 자동으로 함께 사라져 하단 CTA와 겹칠 일이 없다. */}
      {showTabBar && (
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
            changeTab('home');   // Home이 마운트되며 스냅샷을 복원해 결과 화면으로 열린다
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
