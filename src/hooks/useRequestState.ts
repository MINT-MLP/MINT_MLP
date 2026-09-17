import { useRef, useState } from 'react';

// 추천 요청 진행 상태 — 로딩·진행률·에러 + 레이스 방지용 ref들. 상태만 갖는다(요청 자체는 useRecommendActions).
export function useRequestState() {
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState(0);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const travelReqRef = useRef(0);
  const enrichReqRef = useRef(0);
  const loadingStartRef = useRef(0);   // 로딩 시작 시각 — 지연 인정 카피 전환 판단용
  const lastRecommendRef = useRef<(() => void) | null>(null); // 실패 시 같은 조건 원탭 재시도용
  const sessionKeyRef = useRef<string | null>(null);          // 탐색 에피소드 세션키 — recommendation_log·events 조인용

  return {
    loading, setLoading, loadingMsg, setLoadingMsg, loadingProgress, setLoadingProgress, error, setError,
    travelReqRef, enrichReqRef, loadingStartRef, lastRecommendRef, sessionKeyRef,
  };
}
export type RequestState = ReturnType<typeof useRequestState>;
