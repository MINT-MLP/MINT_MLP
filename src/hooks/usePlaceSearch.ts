import { useCallback, useEffect, useRef, useState } from 'react';
import { searchAddress } from '@/services/kakaoMap';
import { trackEvent } from '@/services/analytics';
import type { KakaoPlace } from '@/types';

// 출발지(역·장소) 자동완성 검색 상태. 데스크톱 드롭다운과 모바일 검색 시트가 같은 로직을 쓴다.
export function usePlaceSearch(limit = 5) {
  const [query, setQueryState] = useState('');
  const [results, setResults] = useState<KakaoPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqSeq = useRef(0);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const setQuery = useCallback((v: string) => {
    setQueryState(v);
    if (timer.current) clearTimeout(timer.current);
    const t = v.trim();
    if (!t) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const seq = ++reqSeq.current;
    timer.current = setTimeout(async () => {
      try {
        const found = await searchAddress(t);
        if (seq !== reqSeq.current) return;
        // 결과 0건 = 사용자가 친 지명 표현과 카카오 커버리지의 갭(별칭 사전 개선 신호)
        if (found.length === 0) trackEvent('location_search_zero', { query: t.slice(0, 100) });
        setResults(found.slice(0, limit));
      } catch {
        if (seq === reqSeq.current) trackEvent('location_search_error');
      } finally {
        if (seq === reqSeq.current) setSearching(false);
      }
    }, 200);
  }, [limit]);

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    reqSeq.current++;
    setQueryState('');
    setResults([]);
    setSearching(false);
  }, []);

  return { query, setQuery, results, searching, reset };
}
