import type { TabKey } from '@/types';

// /app 안의 화면 주소. 홈 탭은 홈(허브)·추천 단계·결과 세 화면이고, 나머지 탭은 탭마다 하나.
//   /app                 홈
//   /app/recommend       추천 입력 단계(?new=solo|group 새로 시작, ?grp= 그룹 호스트 복귀)
//   /app/result?id=추천ID 추천 결과
//   /app/meetings · /app/discover · /app/shop · /app/profile
// 옛 주소 /app?tab=profile(카카오 로그인 복귀)·/app?grp=(그룹 호스트 복귀)도 받아준다.
export type HomeScreen = 'hub' | 'recommend' | 'result';

export interface AppRoute {
  tab: TabKey;
  home: HomeScreen;
  fresh: 'solo' | 'group' | null;   // 홈에서 "새로 시작"으로 들어왔는가
  resultId: number | null;
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
  const base: AppRoute = { tab: 'home', home: 'hub', fresh: null, resultId: null };
  const tab = (Object.keys(TAB_PATHS) as Exclude<TabKey, 'home'>[]).find((k) => TAB_PATHS[k] === path);
  if (tab) return { ...base, tab };
  if (path === '/app/recommend') {
    const fresh = q.get('new');
    return { ...base, home: 'recommend', fresh: fresh === 'solo' || fresh === 'group' ? fresh : null };
  }
  if (path === '/app/result') {
    const id = Number(q.get('id'));
    return { ...base, home: 'result', resultId: Number.isInteger(id) && id > 0 ? id : null };
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
  else window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
