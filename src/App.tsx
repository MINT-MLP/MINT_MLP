import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { requestAppFullscreen } from '@/utils/fullscreen';

// 페이지별 코드 스플리팅 — 랜딩만 보는 방문자가 Home/Admin 번들까지 받지 않도록
const AppShell = lazy(() => import('@/pages/AppShell'));
const Landing = lazy(() => import('@/pages/Landing'));
const SharedResult = lazy(() => import('@/pages/SharedResult'));
const Admin = lazy(() => import('@/pages/Admin'));
const MemberInput = lazy(() => import('@/pages/MemberInput'));
const Pilot = lazy(() => import('@/pages/Pilot'));
const PilotAdmin = lazy(() => import('@/pages/PilotAdmin'));

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: 'sans-serif' }}>
          <p style={{ fontSize: '32px', marginBottom: '12px' }}>😓</p>
          <p style={{ fontWeight: 'bold', color: '#333', marginBottom: '8px' }}>페이지를 불러오지 못했어요</p>
          <p style={{ color: '#888', fontSize: '13px', marginBottom: '20px' }}>{(this.state.error as Error).message}</p>
          <button onClick={() => window.location.reload()} style={{ background: '#3CDBC0', color: '#fff', border: 'none', borderRadius: '12px', padding: '10px 24px', fontWeight: 'bold', cursor: 'pointer' }}>
            새로고침
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function PageLoading() {
  return (
    <div className="min-h-screen bg-[#F5FBF8] flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-[#3CDBC0] border-t-transparent rounded-full animate-spin-slow" />
    </div>
  );
}

function Router() {
  const [locationKey, setLocationKey] = useState(() => `${window.location.pathname}${window.location.search}`);

  useEffect(() => {
    const syncLocation = () => setLocationKey(`${window.location.pathname}${window.location.search}`);
    window.addEventListener('popstate', syncLocation);
    return () => window.removeEventListener('popstate', syncLocation);
  }, []);

  const path = locationKey.split('?')[0];

  // URL로 MVP/초대 화면에 바로 들어온 경우 자동 전체화면은 브라우저가 차단하므로 첫 터치에서 전환한다.
  useEffect(() => {
    if (path !== '/app' && path !== '/join') return;
    if (
      document.fullscreenElement ||
      window.matchMedia('(display-mode: fullscreen)').matches
    ) return;

    const enterFullscreen = () => { void requestAppFullscreen(); };
    window.addEventListener('pointerdown', enterFullscreen, { capture: true, once: true });
    return () => window.removeEventListener('pointerdown', enterFullscreen, { capture: true });
  }, [path]);

  if (path === '/admin') return <Admin />;
  if (path === '/pilot-admin') return <PilotAdmin />;
  if (path === '/pilot') return <Pilot />;
  if (path === '/join') return <MemberInput />;
  if (path === '/shared' || locationKey.includes('data=')) return <SharedResult />;
  if (path === '/app') return <AppShell />;
  return <Landing />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoading />}>
        <Router />
      </Suspense>
    </ErrorBoundary>
  );
}
