import { useEffect, useState } from 'react';

// CSS 미디어쿼리를 React 상태로. 회전·창 크기 변경에 따라 갱신된다.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

// Tailwind `sm`(640px) 미만을 모바일로 본다 — 프로젝트의 반응형 기준과 같은 경계.
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 639px)');
}
