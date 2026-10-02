import { useEffect } from 'react';
import type { Step } from '@/types';
import { trackEvent } from '@/services/analytics';
import type { RecommendFlow } from '@/hooks/useRecommendFlow';
import type { RecommendInput } from '@/hooks/useRecommendInput';
import type { GroupSession } from '@/hooks/useGroupSession';
import type { ResultState } from '@/hooks/useResultState';
import type { GroupActions } from '@/hooks/useGroupActions';

// 스텝 진행 게이트(canNext)·점프·뒤로 + 화면 부수 효과(스크롤 힌트).
export function useStepNavigation({ flow, input, group, result: resultState, groupActions }: {
  flow: RecommendFlow; input: RecommendInput; group: GroupSession; result: ResultState; groupActions: GroupActions;
}) {
  const { appMode, view, setView, step, setStep, isGroup, setShowVibeScrollHint, stepScrollRef } = flow;
  const { purpose, meetingLocation, locations } = input;
  const { sessionId, groupMembers } = group;
  const { result, setChangeNote, setShowResultScrollHint } = resultState;
  const { confirmInvalidateGroupLink, requestGroupRecommend } = groupActions;

  // 혼자 정하기 분위기 단계에서 아래 키워드 영역이 화면 밖에 있을 때만 스크롤 힌트를 보여준다.
  // step 3을 벗어나면(view·step·isGroup 변경) cleanup에서 힌트를 해제한다.
  useEffect(() => {
    if (view !== 'steps' || step !== 3 || isGroup) return;

    const scrollArea = stepScrollRef.current;
    if (!scrollArea) return;
    const updateHint = () => {
      const remaining = scrollArea.scrollHeight - scrollArea.scrollTop - scrollArea.clientHeight;
      setShowVibeScrollHint(remaining > 28);
    };

    const frame = requestAnimationFrame(updateHint);
    const observer = new ResizeObserver(updateHint);
    observer.observe(scrollArea);
    scrollArea.addEventListener('scroll', updateHint, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scrollArea.removeEventListener('scroll', updateHint);
      setShowVibeScrollHint(false);
    };
  }, [view, step, isGroup, setShowVibeScrollHint, stepScrollRef]);

  // 추천 결과 첫 화면에서 아래의 다른 후보·2차 코스를 놓치지 않도록 스크롤을 유도한다.
  useEffect(() => {
    if (view !== 'result' || !result || result.length < 2) return;

    const updateHint = () => {
      const remaining = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      setShowResultScrollHint(window.scrollY < 48 && remaining > 80);
    };

    const frame = requestAnimationFrame(updateHint);
    const observer = new ResizeObserver(updateHint);
    observer.observe(document.documentElement);
    window.addEventListener('scroll', updateHint, { passive: true });
    window.addEventListener('resize', updateHint);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', updateHint);
      window.removeEventListener('resize', updateHint);
    };
  }, [view, result, setShowResultScrollHint]);

  // 특정 스텝에서 '다음'으로 진행 가능한지 — 스텝바 점프 게이트에도 재사용하려 인자화.
  function canNextAt(s: Step): boolean {
    if (s === 0) {
      // 혼자·그룹 모두 1차 목적(코스)을 골라야 다음으로
      if (appMode === 'solo' || appMode === 'group') return !!purpose?.first;
      return false; // mode-select
    }
    if (s === 1) {
      if (isGroup) return meetingLocation !== null; // 그룹: 지역 선택
      return true; // 혼자: 관계·특별한날은 선택사항
    }
    if (s === 2) {
      // 그룹: 링크 생성 + 2명 이상 입력(호스트도 '내 취향 입력하기'로 자가참여해 멤버로 합류)하면 확정 가능.
      // 전원(expectedCount)을 기다리지 않고 2명만 모여도 추천 진입 가능 — 버튼은 GroupWaiting에서 노출.
      if (isGroup) return !!sessionId && groupMembers.length >= 2;
      // 혼자: 지역·장소
      return meetingLocation !== null && (meetingLocation.type === 'manual' || locations.length >= 2);
    }
    return true; // step 3
  }

  function canNext(): boolean {
    return canNextAt(step);
  }

  // 스텝바 점프 허용 여부: 뒤로는 자유, 앞으로는 solo에서 경유 게이트를 모두 통과할 때만.
  // 결과 화면(view==='result')에선 모든 입력 단계가 '과거'이므로 0~3 전부 점프 가능.
  function canJumpTo(target: number): boolean {
    const t = target as Step;
    const cur = view === 'result' ? 4 : step;
    if (t === cur) return false;
    if (t < cur) return true;
    if (isGroup) return false; // 그룹 forward 점프 금지(집계·링크 흐름 보호)
    for (let k = step; k < t; k++) if (!canNextAt(k as Step)) return false;
    return true;
  }

  // 스텝바 클릭 → 해당 단계로 이동(입력값은 그대로 유지). 결과 화면에서 누르면 입력 화면으로 복귀.
  function handleStepJump(target: number) {
    const t = target as Step;
    if (!canJumpTo(t)) return;
    // 그룹: 활성 링크가 있는데 코스·지역 단계(t<2)로 내려가면 링크 무효화 동의 필요
    if (isGroup && sessionId && t < 2 && (view === 'result' || step >= 2)) {
      if (!confirmInvalidateGroupLink()) return;
    }
    if (view === 'result') { setChangeNote(null); setView('steps'); }
    setStep(t);
  }

  function handleNext() {
    // 입력 단계 이탈 퍼널 — 각 스텝을 실제로 통과(전진)한 횟수. 어디서 포기하는지 파악.
    if (step === 0 || step === 1 || step === 2) trackEvent(`step_next_${step}` as 'step_next_0' | 'step_next_1' | 'step_next_2');
    // 그룹: 대기 화면에서 바로 추천으로 진입. 집계 state 반영 뒤 effect에서 추천을 시작한다.
    if (step === 2 && isGroup) {
      requestGroupRecommend();
      return;
    }
    setStep((s) => (s + 1) as Step);
  }

  function handleBack() {
    // 헤더 "← 뒤로"(step>0)와 하단 "← 이전 단계"가 같이 쓴다 — 한 화면의 두 뒤로가기가 다른 곳으로 가면 안 된다.
    // 그룹: 링크 생성 후 코스·지역을 바꾸면 이미 공유된 링크의 파라미터와 어긋난다.
    // 공유(step2)에서 뒤로가기는 '링크 취소 후 재설정'으로 처리해 항상 링크=설정이 일치하게 유지.
    if (isGroup && step === 2 && sessionId) {
      if (!confirmInvalidateGroupLink()) return;
      setStep(0); // 코스·지역은 유지 — 수정 후 다시 링크 생성
      return;
    }
    if (step > 0) setStep((s) => (s - 1) as Step);
  }

  return { canNextAt, canNext, canJumpTo, handleStepJump, handleNext, handleBack };
}
export type StepNavigation = ReturnType<typeof useStepNavigation>;
