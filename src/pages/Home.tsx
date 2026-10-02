import { LoadingScreen, HomeResultView, HomeStepsView } from '@/components';
import Reserve from '@/pages/Reserve';
import { cancelGroupSessionOnServer } from '@/services/session';
import { clearResultSnapshot, INPUT_DRAFT_KEY, GROUP_SESSION_KEY } from '@/storage/history';
import { getLoadingMessages, LOADING_SLOW_MS, LOADING_SLOW_MESSAGE } from '@/utils/loadingCopy';
import {
  useRecommendFlow, useRecommendInput, useGroupSession, useResultState, useRequestState,
  useHomePersistence, useGroupActions, useRecommendActions, useStepNavigation, useShareResult,
} from '@/hooks';

// 홈 — 상태 훅(1층) → 동작 훅(2층) → 화면 선택. 화면 자체는 HomeStepsView·HomeResultView.
export default function Home({ onChromeChange }: { onChromeChange?: (showTabBar: boolean) => void } = {}) {
  // 1층 — 상태
  const flow = useRecommendFlow();
  const input = useRecommendInput();
  const group = useGroupSession();
  const resultState = useResultState();
  const request = useRequestState();
  // 2층 — 동작 (복원 effect 순서가 있어 persistence를 먼저)
  useHomePersistence({ flow, input, group, result: resultState, request });
  const groupActions = useGroupActions({ flow, input, group });
  const actions = useRecommendActions({ flow, input, group, result: resultState, request });
  const nav = useStepNavigation({ flow, input, group, result: resultState, groupActions, onChromeChange });
  const { handleShare } = useShareResult({ input, result: resultState });

  const { view, setView } = flow;
  const { sessionId } = group;
  const { result, midpointData } = resultState;
  const { loading, loadingMsg, loadingProgress, loadingStartRef } = request;

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
      <Reserve
        placeName={result[0].placeName}
        address={result[0].address || result[0].area}
        openingHours={result[0].openingHours ?? ''}
        slotId={result[0].record?.slotId}
        onBack={() => setView('result')}
      />
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
