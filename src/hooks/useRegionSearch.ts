import { useCallback, useEffect, useRef, useState } from 'react';
import { searchRegions, matchHotplaces } from '@/services/kakaoMap';
import { ensureKakaoMaps } from '@/services/kakaoLoader';
import type { RegionSuggestion } from '@/types';

// 지역(시/구/동·핫플) 자동완성 검색 상태. 데스크톱 드롭다운과 모바일 검색 시트가 같은 로직을 쓴다.
// 1단계(즉시): 핫플레이스는 네트워크 없이 같은 프레임에 바로 노출
// 2단계(150ms 디바운스): 카카오 결과까지 합쳐 갱신 (팝업을 비우지 않고 교체)
export function useRegionSearch() {
  const [query, setQueryState] = useState('');
  const [suggestions, setSuggestions] = useState<RegionSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqSeq = useRef(0);

  // 카카오 SDK 프리로드 — 첫 타이핑에서 스크립트 로딩 지연이 없게 미리 붙인다
  useEffect(() => { ensureKakaoMaps().catch(() => {}); }, []);
  // 언마운트 시 대기 중인 디바운스 취소
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const setQuery = useCallback((v: string) => {
    setQueryState(v);
    if (timer.current) clearTimeout(timer.current);
    const t = v.trim();
    if (t.length < 1) { setSuggestions([]); setSearching(false); return; }
    setSuggestions(matchHotplaces(t));
    setSearching(true);
    const seq = ++reqSeq.current;
    timer.current = setTimeout(async () => {
      try {
        const results = await searchRegions(t);
        if (seq === reqSeq.current && results.length) setSuggestions(results);
      } catch { /* 카카오 실패 시 핫플 결과만 남긴다 */ }
      finally { if (seq === reqSeq.current) setSearching(false); }
    }, 150);
  }, []);

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    reqSeq.current++; // 진행 중인 검색 응답이 도착해도 무시
    setQueryState('');
    setSuggestions([]);
    setSearching(false);
  }, []);

  return { query, setQuery, suggestions, searching, reset };
}
