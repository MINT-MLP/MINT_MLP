import type { TabKey } from '@/types';

// /app 안의 화면 주소. 홈 탭은 홈(허브)·추천 단계·결과 세 화면이고, 나머지 탭은 탭마다 하나.
//   /app                 홈
//   /app/recommend       추천 입력 단계(?new=1 새로 시작 — 1단계에서 혼자/다같이 고름, ?new=solo|group 그 모드로 새로 시작, ?grp= 그룹 호스트 복귀)
//   /app/result?id=추천ID 추천 결과(&from=history 지난 추천을 연 것)
//   /app/meetings · /app/discover · /app/shop · /app/profile
//   /app/profile/history · /app/profile/wishlist   프로필에서 들어가는 지난 추천·찜한 곳
// 옛 주소 /app?tab=profile(카카오 로그인 복귀)·/app?grp=(그룹 호스트 복귀)도 받아준다.
export type HomeScreen = 'hub' | 'recommend' | 'result';

export type Fresh = 'start' | 'solo' | 'group' | null;

export interface AppRoute {
  tab: TabKey;
  home: HomeScreen;
  fresh: Fresh;   // 새로 시작으로 들어왔는가
  resultId: number | null;
  fromHistory: boolean;                       // 결과 화면을 지난 추천에서 열었는가
  profileSub: 'history' | 'wishlist' | null;
}

const TAB_PATHS: Record<Exclude<TabKey, 'home'>, string> = {
  meetings: '/app/meetings',
  discover: '/app/discover',
  shop: '/app/shop',
  profile: '/app/profile',
};

export function isAppPath(path: string): boolean {
  return path === '/app' || path.startsWith('/app/');
}

export function parseAppRoute(path: string, search: string): AppRoute {
  const q = new URLSearchParams(search);
  const base: AppRoute = { tab: 'home', home: 'hub', fresh: null, resultId: null, fromHistory: false, profileSub: null };
  const tab = (Object.keys(TAB_PATHS) as Exclude<TabKey, 'home'>[]).find((k) => TAB_PATHS[k] === path);
  if (tab) return { ...base, tab };
  if (path === '/app/profile/history') return { ...base, tab: 'profile', profileSub: 'history' };
  if (path === '/app/profile/wishlist') return { ...base, tab: 'profile', profileSub: 'wishlist' };
  if (path === '/app/recommend') {
    const fresh = q.get('new');
    return { ...base, home: 'recommend', fresh: fresh === 'solo' || fresh === 'group' ? fresh : fresh === '1' ? 'start' : null };
  }
  if (path === '/app/result') {
    const id = Number(q.get('id'));
    const resultId = Number.isInteger(id) && id > 0 ? id : null;
    return { ...base, home: 'result', resultId, fromHistory: resultId != null && q.get('from') === 'history' };
  }
  if (q.get('tab') === 'profile') return { ...base, tab: 'profile' };
  if (q.has('grp')) return { ...base, home: 'recommend' };
  return base;
}

export function tabPath(tab: TabKey): string {
  return tab === 'home' ? '/app' : TAB_PATHS[tab];
}

// 화면 전환 — 라우터(App)가 popstate만 구독하므로 주소를 바꾼 뒤 알려준다
export function navigateApp(path: string, { replace = false }: { replace?: boolean } = {}): void {
  const hash = replace ? window.location.hash : '';
  if (replace) window.history.replaceState(window.history.state, '', `${path}${hash}`);
  else window.history.pushState({ mintNav: true }, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

// 화면 안의 "← 뒤로" — 앱 안에서 넘어왔으면 브라우저 뒤로가기(들어온 곳으로), 주소로 바로 들어왔으면 정해진 화면으로
export function goBackOr(fallback: string): void {
  if ((window.history.state as { mintNav?: boolean } | null)?.mintNav) window.history.back();
  else navigateApp(fallback, { replace: true });
}
