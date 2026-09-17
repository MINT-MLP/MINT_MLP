import { useRef, useState } from 'react';
import type { AppMode, Step, View } from '@/types';

// 홈 화면 흐름 상태 — 어느 화면(view)·몇 번째 단계(step)·혼자/그룹(appMode). 상태만 갖는다.
export function useRecommendFlow() {
  const [appMode, setAppMode] = useState<AppMode>('mode-select');
  const [view, setView] = useState<View>('steps');
  const [step, setStep] = useState<Step>(0);
  const [showVibeScrollHint, setShowVibeScrollHint] = useState(false);

  const stepScrollRef = useRef<HTMLDivElement>(null);
  const isGroup = appMode === 'group';

  function reset() {
    setView('steps');
    setStep(0);
    setAppMode('mode-select');
  }

  return {
    appMode, setAppMode, view, setView, step, setStep, isGroup,
    showVibeScrollHint, setShowVibeScrollHint, stepScrollRef, reset,
  };
}
export type RecommendFlow = ReturnType<typeof useRecommendFlow>;
