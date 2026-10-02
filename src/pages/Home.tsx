import { useEffect, useLayoutEffect, useState } from 'react';
import { LoadingScreen, HomeResultView, HomeStepsView } from '@/components';
import Reserve from '@/pages/Reserve';
import { cancelGroupSessionOnServer } from '@/services/session';
import { clearResultSnapshot, INPUT_DRAFT_KEY, GROUP_SESSION_KEY } from '@/storage/history';
import { getLoadingMessages, LOADING_SLOW_MS, LOADING_SLOW_MESSAGE } from '@/utils/loadingCopy';
import { navigateApp, type Fresh } from '@/utils/appRoute';
import {
  useRecommendFlow, useRecommendInput, useGroupSession, useResultState, useRequestState,
  useHomePersistence, useGroupActions, useRecommendActions, useStepNavigation, useShareResult,
} from '@/hooks';

// 추천 플로우 — 상태 훅(1층) → 동작 훅(2층) → 화면 선택. 화면 자체는 HomeStepsView·HomeResultView.
// 주소(/app/recommend·/app/result)와 화면(view)을 맞춘다. 처음 연 주소(entry)로 무엇을 복원할지 정한다.
export default function Home({ screen, fresh, onChromeChange }: {
  screen: 'recommend' | 'result';
  fresh: Fresh;
  onChromeChange?: (showTabBar: boolean) => void;
}) {
  const [entry] = useState(screen);
  const [entryFresh] = useState(fresh);
  // 1층 — 상태
  const flow = useRecommendFlow();
  const input = useRecommendInput();
  const group = useGroupSession();
  const resultState = useResultState();
  const request = useRequestState();
  // 2층 — 동작 (복원 effect 순서가 있어 persistence를 먼저)
  useHomePersistence({ flow, input, group, result: resultState, request, entry, fresh: entryFresh });
  const groupActions = useGroupActions({ flow, input, group });
  const actions = useRecommendActions({ flow, input, group, result: resultState, request });
  const nav = useStepNavigation({ flow, input, group, result: resultState, groupActions });
  const { handleShare } = useShareResult({ input, result: resultState });

  const { view, setView } = flow;
  const { sessionId } = group;
  const { result, midpointData } = resultState;
  const { loading, loadingMsg, loadingProgress, loadingStartRef } = request;
  const recId = result?.[0]?.record?.recommendationId ?? null;

  // 탭바는 결과 화면에서만. 입력 단계는 집중해서 끝내는 흐름이라 숨기고(나가기는 "← 홈"·뒤로가기),
  // 추천을 기다리는 동안에도 숨긴다 — 다른 탭으로 가면 이 화면이 내려가 받던 결과를 놓친다
  useLayoutEffect(() => {
    onChromeChange?.(!loading && view !== 'steps');
  }, [loading, view, onChromeChange]);

  // 주소 → 화면: 뒤로·앞으로 가기로 주소가 바뀌면 화면을 맞춘다(렌더 중 조정 — 효과에서 setState하지 않는다)
  const [prevScreen, setPrevScreen] = useState(screen);
  if (prevScreen !== screen) {
    setPrevScreen(screen);
    if (screen === 'recommend' && view !== 'steps') setView('steps');
    if (screen === 'result' && view === 'steps' && result && result.length > 0) setView('result');
  }

  // 화면 → 주소: 결과가 나오면 /app/result?id=, 조건 수정이면 /app/recommend.
  // 기록은 사용자가 화면을 옮겼을 때만 쌓는다(추천 단계 → 결과, 결과 → 조건 수정). 나머지(처음 열기·같은 화면 안 정리)는 바꿔치기.
  // ?grp=(그룹 호스트 복귀)는 자동 추천 판정에 쓰므로 남기고 ?new=만 지운다.
  const hasResult = !!result && result.length > 0;
  useEffect(() => {
    if (loading) return;
    const { pathname, search } = window.location;
    if (view === 'steps') {
      const q = new URLSearchParams(search);
      q.delete('new');
      q.delete('id');
      const qs = q.toString();
      const want = `/app/recommend${qs ? `?${qs}` : ''}`;
      if (`${pathname}${search}` !== want) navigateApp(want, { replace: !(pathname === '/app/result' && hasResult) });
      return;
    }
    if (recId == null) return;   // 복원 중 — 추천 ID를 알 때 맞춘다
    const want = `/app/result?id=${recId}`;
    if (`${pathname}${search}` !== want) navigateApp(want, { replace: pathname !== '/app/recommend' });
  }, [view, recId, loading, hasResult]);

  // 처음부터 다시 — 결과·입력 취향을 전부 지우고 첫 화면으로. 파괴적이라 반드시 확인 1회.
  function handleFullReset() {
    // 그룹 링크가 살아있으면 확인 문구에 그 사실을 먼저 알린다 — 친구들에게 보낸 링크가 함께 죽기 때문.
    const msg = sessionId
      ? '추천 결과와 입력한 취향이 모두 지워져요.\n친구들에게 보낸 초대 링크도 함께 취소돼요.\n\n처음부터 다시 시작할까요?'
      : '추천 결과와 입력한 취향이 모두 지워져요.\n처음부터 다시 시작할까요?';
    if (!window.confirm(msg)) return;
    // 서버에도 알려야 옛 링크가 실제로 죽는다 — 안 알리면 그 링크로 들어온 게스트가 영원히 결과를 기다린다.
    if (sessionId) cancelGroupSessionOnServer(sessionId, group.hostToken);
    clearResultSnapshot();
    try { localStorage.removeItem(INPUT_DRAFT_KEY); sessionStorage.removeItem(INPUT_DRAFT_KEY); localStorage.removeItem(GROUP_SESSION_KEY); } catch { /* ignore */ }
    resultState.reset();
    flow.reset();
    group.reset();
    input.reset();
  }

  // 로딩
  if (loading) {
    const msgs = getLoadingMessages(midpointData?.areaName);
    const elapsed = loadingStartRef.current ? Date.now() - loadingStartRef.current : 0;
    const loadingMessage = elapsed > LOADING_SLOW_MS ? LOADING_SLOW_MESSAGE : msgs[loadingMsg % msgs.length];
    return <LoadingScreen progress={loadingProgress} message={loadingMessage} />;
  }

  // 예약 페이지
  if (view === 'reserve' && result && result.length > 0) {
    return (
      <div style={{ paddingBottom: 'var(--mint-tabbar-h, 0px)' }}>
        <Reserve
          placeName={result[0].placeName}
          address={result[0].address || result[0].area}
          openingHours={result[0].openingHours ?? ''}
          slotId={result[0].record?.slotId}
          onBack={() => setView('result')}
        />
      </div>
    );
  }

  // 추천 결과
  if (view === 'result' && result && result.length > 0) {
    return (
      <HomeResultView
        result={result}
        flow={flow} input={input} resultState={resultState} actions={actions} nav={nav}
        onShare={handleShare} onFullReset={handleFullReset}
      />
    );
  }

  // 입력 플로우
  return <HomeStepsView flow={flow} input={input} group={group} request={request} groupActions={groupActions} actions={actions} nav={nav} />;
}
