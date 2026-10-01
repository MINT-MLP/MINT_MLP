import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MeetingLocation, PurposeValue, Step } from '@/types';
import { OCCASION_BY_RELATION } from '@/constants/occasion';
import { saveResultSnapshot, loadResultSnapshot, clearResultSnapshot, INPUT_DRAFT_KEY, GROUP_SESSION_KEY, INPUT_DRAFT_TTL_MS, GROUP_SESSION_TTL_MS } from '@/storage/history';
import { restoreResultSnapshot, stripMeetingLocation, resolveMeetingLocation, resolveOrigins, stripOrigins } from '@/services/resultRestore';
import { RecRestoreError } from '@/services/recRestore';
import { rememberResult, recallResult, forgetResult } from '@/stores/resultMemory';
import { trackSessionDuration } from '@/services/analytics';
import { supabase } from '@/services/supabase';
import { migrateVibeState } from '@/utils/vibeMigrate';
import type { RecommendFlow } from '@/hooks/useRecommendFlow';
import type { RecommendInput } from '@/hooks/useRecommendInput';
import type { GroupSession } from '@/hooks/useGroupSession';
import type { ResultState } from '@/hooks/useResultState';
import type { RequestState } from '@/hooks/useRequestState';

// localStorage 복원·저장. 복원 layout effect 3개의 선언 순서(결과→입력초안→그룹세션)는 동작에 영향을 주므로
// (그룹세션 복원이 결과 복원의 view/step을 덮어써야 한다) 한 훅 안에 원래 순서대로 둔다.
export function useHomePersistence({ flow, input, group, result: resultState, request }: {
  flow: RecommendFlow; input: RecommendInput; group: GroupSession; result: ResultState; request: RequestState;
}) {
  const { view, setView, step, setStep, appMode, setAppMode, isGroup } = flow;
  const {
    groupSize, setGroupSize, setCustomOccasion, setEtcRelOpen, setOccasionChip, locations, setLocations, setLocationsVersion,
    purpose, setPurpose, vibe, setVibe, budget, setBudget, meetingLocation, setMeetingLocation,
    keywords, setKeywords, conditions, setConditions, vibeCustom, setVibeCustom, customOccasion,
  } = input;
  const { sessionId, setSessionId, expectedCount, setExpectedCount } = group;
  const {
    result, setResult, resultSecondMissing, setResultSecondMissing,
    midpointData, setMidpointData, resultWeather, setResultWeather,
    resultThird, setResultThird, resultThirdLabel, setResultThirdLabel, treasurer, setTreasurer,
    resultTravelTimes, setResultTravelTimes,
  } = resultState;
  const { setLoading, setLoadingProgress, loadingStartRef } = request;
  const lastSessionResultRef = useRef<string | null>(null); // 그룹 결과 세션 저장 중복 억제

  useEffect(() => {
    if (!sessionStorage.getItem('mintSessionStart')) {
      sessionStorage.setItem('mintSessionStart', Date.now().toString());
    }
  }, []);

  // 마지막 추천 결과 복원 (탭 이동·새로고침·앱 전환 후 재진입 시 추천이 증발하지 않게).
  //  - 탭 이동(같은 탭 세션): 메모리에 든 화면 상태를 그대로 되살린다 — 서버·카카오 호출 없음
  //  - 새로고침·재진입: 폰엔 추천 ID와 화면 상태만 있어, 서버 슬롯 → 카카오 재검색으로 채운다(그동안 로딩 화면)
  useLayoutEffect(() => {
    const snap = loadResultSnapshot();
    if (!snap) return;
    // 살아 있는 그룹 세션이 다른 세션이면 그 대기 화면이 우선이다(그룹 세션 복원이 이어서 연다). 결과 복원은 하지 않는다.
    if (otherGroupSessionAlive(snap.sessionId)) return;

    // 혼자/다같이 선택은 저장본에 따로 없다 — 그룹 결과에만 sessionId가 있으므로 그걸로 판정한다.
    // 안 넣으면 'mode-select'로 남아, 결과에서 입력 화면으로 돌아갔을 때 선택이 풀려 보인다.
    setAppMode(snap.sessionId ? 'group' : 'solo');
    const mem = recallResult(snap.recommendationId);
    if (mem) {
      setResult(mem.result);
      setResultThird(mem.resultThird);
      setResultThirdLabel(mem.resultThirdLabel);
      setResultSecondMissing(mem.resultSecondMissing);
      if (mem.midpointData) setMidpointData(mem.midpointData);
      setTreasurer(mem.treasurer);
      if (mem.meetingLocation) setMeetingLocation(mem.meetingLocation);
      setResultTravelTimes(mem.resultTravelTimes);
      setResultWeather(mem.resultWeather);
      if (snap.purpose) setPurpose(snap.purpose);
      if (snap.vibe) setVibe(migrateVibeState(snap.vibe));
      if (Array.isArray(snap.keywords)) setKeywords(snap.keywords);
      if (Array.isArray(snap.conditions)) setConditions(snap.conditions);
      setView('result');
      return;
    }

    if (snap.purpose) setPurpose(snap.purpose);
    if (snap.vibe) setVibe(migrateVibeState(snap.vibe));            // 개인화 배너 복원용
    if (Array.isArray(snap.keywords)) setKeywords(snap.keywords);
    if (Array.isArray(snap.conditions)) setConditions(snap.conditions);
    if (snap.resultWeather) setResultWeather(snap.resultWeather);
    setView('result');
    loadingStartRef.current = Date.now();
    setLoadingProgress(60);
    setLoading(true);
    let alive = true;
    restoreResultSnapshot(snap)
      .then((r) => {
        if (!alive) return;
        setResult(r.places);
        setResultSecondMissing(r.secondMissing);
        setMidpointData(r.midpointData);
        if (r.meetingLocation) setMeetingLocation(r.meetingLocation);
      })
      .catch((e) => {
        if (!alive) return;
        // 권한 없음·없는 추천(익명화·삭제)만 스냅샷을 지운다. 네트워크·한도 초과는 남겨 다음에 다시 시도한다.
        if (e instanceof RecRestoreError && (e.status === 403 || e.status === 404)) clearResultSnapshot();
        setView('steps');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [setAppMode, setView, setResult, setResultThird, setResultThirdLabel, setResultSecondMissing, setPurpose, setMidpointData, setTreasurer, setMeetingLocation, setResultTravelTimes, setResultWeather, setVibe, setKeywords, setConditions, setLoading, setLoadingProgress, loadingStartRef]);

  // 입력 초안 복원 — 결과가 없을 때만. 그룹도 링크 생성 전에는 서버 세션이 없으므로 로컬 초안에서 복원한다.
  useLayoutEffect(() => {
    try {
      if (loadResultSnapshot()) return; // 결과 복원이 우선
      // 구버전(sessionStorage) 초안도 한 번은 읽어줌 — 배포 시점에 입력 중이던 세션 보호
      const raw = localStorage.getItem(INPUT_DRAFT_KEY) ?? sessionStorage.getItem(INPUT_DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.appMode !== 'solo' && d.appMode !== 'group') return;
      // 오래 방치된 초안은 복원하지 않음 (savedAt 없는 구버전 초안은 그대로 복원)
      if (typeof d.savedAt === 'number' && Date.now() - d.savedAt > INPUT_DRAFT_TTL_MS) {
        localStorage.removeItem(INPUT_DRAFT_KEY);
        return;
      }
      // 마운트 시 localStorage 입력 초안을 페인트 전에 복원(만료 초안 삭제 등 부수효과 포함)
      setAppMode(d.appMode);
      if (typeof d.step === 'number') setStep(d.step as Step);
      if (typeof d.expectedCount === 'number') setExpectedCount(d.expectedCount);
      if (d.groupSize) setGroupSize(d.groupSize);
      if (d.purpose) setPurpose(d.purpose);
      if (d.vibe) setVibe(migrateVibeState(d.vibe));
      if (Array.isArray(d.keywords)) setKeywords(d.keywords);
      if (Array.isArray(d.conditions)) setConditions(d.conditions);
      if (d.vibeCustom) setVibeCustom(d.vibeCustom);
      if (d.meetingLocation) {
        setMeetingLocation(d.meetingLocation);
        void resolveMeetingLocation(d.meetingLocation).then((loc) => { if (loc !== d.meetingLocation) setMeetingLocation(loc); });
      }
      if (d.budget !== undefined) setBudget(d.budget);
      if (typeof d.customOccasion === 'string') setCustomOccasion(d.customOccasion);
      // 기타 콕! 자유입력 모드 복원 (occasion만 있고 relation 없으면 기타콕으로 입력한 것)
      if (d.purpose?.occasion && !d.purpose?.relation) setEtcRelOpen(true);
      // 스텝2 2층 칩 복원 — 관계+occasion이 매핑 칩과 일치하면 선택 표시 되살림
      if (d.purpose?.relation && d.purpose?.occasion) {
        const chip = OCCASION_BY_RELATION[d.purpose.relation]?.find((c) => c.occasion === d.purpose.occasion);
        if (chip) setOccasionChip(chip.key);
      }
      // 출발지는 검색어·ID만 저장돼 있다 — 다시 찾아 채우고 입력 칸을 다시 그린다
      if (Array.isArray(d.origins) && d.origins.length > 0) {
        void resolveOrigins(d.origins).then((list) => {
          if (list.length === 0) return;
          setLocations(list);
          setLocationsVersion((v) => v + 1);
        });
      }
    } catch { /* 손상된 초안 무시 */ }
  }, [setAppMode, setStep, setExpectedCount, setGroupSize, setPurpose, setVibe, setKeywords, setConditions, setVibeCustom, setMeetingLocation, setBudget, setCustomOccasion, setEtcRelOpen, setOccasionChip, setLocations, setLocationsVersion]);

  // 그룹 호스트 세션 복원 — 결과 스냅샷 유무와 무관하게 항상 복원한다.
  // 예전에는 결과가 있으면 통째로 skip했는데, 그러면 혼자 모드로 먼저 써본 유저(광고 유입은 거의 전부)가
  // 그룹 링크를 만들고 /app?grp=로 돌아왔을 때 24시간짜리 옛 결과 때문에 sessionId가 복원되지 않았다.
  // → 폴링도 자동추천도 안 붙고, step 2에는 "링크 생성하기"가 다시 떠서 두 번째 세션을 만든다
  //   (첫 링크로 제출한 친구들이 전원 고아가 된다). 결과 스냅샷은 'view를 결과로 열지'만 결정하고,
  //   그룹 컨텍스트(sessionId·정원·코스·지역)는 별도로 살린다. TTL도 결과 24h / 그룹세션 6h로 각자 유지.
  useLayoutEffect(() => {
    try {
      const raw = localStorage.getItem(GROUP_SESSION_KEY);
      if (!raw) return;
      const g = JSON.parse(raw) as {
        savedAt?: number; sessionId?: string; expectedCount?: number;
        purpose?: PurposeValue; meetingLocation?: MeetingLocation;
      };
      if (!g.sessionId) return;
      if (typeof g.savedAt === 'number' && Date.now() - g.savedAt > GROUP_SESSION_TTL_MS) {
        localStorage.removeItem(GROUP_SESSION_KEY);
        return;
      }
      // 마운트 시 localStorage 그룹 세션을 페인트 전에 복원(결과 복원보다 뒤에 실행돼 step/appMode/view를 덮어써야 함)
      setSessionId(g.sessionId);
      if (typeof g.expectedCount === 'number') setExpectedCount(g.expectedCount);
      if (g.purpose) setPurpose(g.purpose);              // 호스트가 정한 코스 복원
      if (g.meetingLocation) {                                      // 호스트가 정한 지역 복원(좌표는 다시 찾는다)
        setMeetingLocation(g.meetingLocation);
        const saved = g.meetingLocation;
        void resolveMeetingLocation(saved).then((loc) => { if (loc !== saved) setMeetingLocation(loc); });
      }
      setStep(2);                 // 공유·대기 화면(step 2)으로 되돌린다
      setAppMode('group');        // 폴링이 다시 붙어 멤버 현황을 서버에서 재수화한다
      // 살아있는 그룹 세션이 있으면 기본적으로 대기 화면을 연다. 예외는 '이 세션으로 이미 받은 결과'뿐.
      // ?grp= 유무로 판정하던 때는 랜딩·북마크로 돌아온 호스트가 옛 혼자 모드 결과에 갇혔다 —
      // 폴링·자동추천이 둘 다 view==='steps'/step===2를 요구해서 멤버가 영영 안 채워졌다.
      const snap = loadResultSnapshot() as { sessionId?: string } | null;
      if (!snap || snap.sessionId !== g.sessionId) setView('steps');
    } catch { /* 손상된 그룹 세션 무시 */ }
  }, [setSessionId, setExpectedCount, setPurpose, setMeetingLocation, setStep, setAppMode, setView]);

  // 그룹 호스트 세션 저장 — sessionId가 살아있는 동안 코스·지역까지 함께 보존(새로고침 복원용)
  useEffect(() => {
    if (appMode !== 'group' || !sessionId) return;
    try {
      localStorage.setItem(GROUP_SESSION_KEY, JSON.stringify({
        savedAt: Date.now(), sessionId, expectedCount, purpose, meetingLocation: stripMeetingLocation(meetingLocation),
      }));
    } catch { /* 저장 실패는 치명적이지 않음 */ }
  }, [appMode, sessionId, expectedCount, purpose, meetingLocation]);

  // 입력 초안 저장 — solo 전체와 그룹 링크 생성 전까지 보존한다.
  // 그룹 링크 생성 후에는 GROUP_SESSION_KEY가 서버 세션 ID와 함께 이어서 보존한다.
  useEffect(() => {
    if (view !== 'steps') return;
    if (appMode !== 'solo' && !(appMode === 'group' && !sessionId)) return;
    try {
      localStorage.setItem(INPUT_DRAFT_KEY, JSON.stringify({
        savedAt: Date.now(),
        appMode, step, groupSize, expectedCount, purpose, vibe, keywords, conditions, vibeCustom,
        meetingLocation: stripMeetingLocation(meetingLocation), budget, customOccasion,
        origins: stripOrigins(locations),   // 지명·좌표 대신 검색어·장소 ID(복원 때 재검색)
      }));
    } catch { /* 저장 실패는 치명적이지 않음 */ }
  }, [view, appMode, sessionId, step, groupSize, expectedCount, purpose, vibe, keywords, conditions, vibeCustom, meetingLocation, budget, customOccasion, locations]);

  // 결과 화면 상태가 확정될 때마다 스냅샷 저장. 추천 ID와 화면 상태만 — 가게 정보·좌표·모델 문구·출발지 이름은 넣지 않는다.
  // 저장되지 않은 추천(record 없음)은 되살릴 수 없으므로 스냅샷을 남기지 않는다.
  useEffect(() => {
    if (view !== 'result' || !result || result.length === 0) return;
    const rec = result[0].record;
    if (!rec) {
      // 저장에 실패한 추천 — 예전 추천 스냅샷이 남아 있으면 나중에 그게 되살아나므로 지운다
      clearResultSnapshot();
      forgetResult();
      return;
    }
    rememberResult({
      recommendationId: rec.recommendationId, result, resultThird, resultThirdLabel, resultSecondMissing,
      midpointData, treasurer, meetingLocation, resultTravelTimes, resultWeather,
    });
    saveResultSnapshot({
      v: 2,
      recommendationId: rec.recommendationId,
      ...(rec.claimToken ? { claimToken: rec.claimToken } : {}),
      resultSecondMissing,
      purpose: purpose ?? undefined,
      vibe,
      keywords,
      conditions,
      meetingLocation: stripMeetingLocation(meetingLocation),
      areaName: midpointData?.areaName ?? '',
      nearestAreas: midpointData?.nearestAreas ?? [],
      resultWeather,
      sessionId, // 이 결과가 '어느 그룹 세션의 것인지' — 재진입 시 대기 화면과 결과 화면 중 무엇을 열지 가른다
    });
  }, [view, result, resultThird, resultThirdLabel, resultSecondMissing, purpose, midpointData, treasurer, meetingLocation, resultTravelTimes, resultWeather, vibe, keywords, conditions, sessionId]);

  // 그룹 호스트가 추천을 받으면 추천 ID를 세션에 전달(010) → 게스트 화면이 폴링으로 받아 재검색으로 복원.
  // 가게 정보는 보내지 않는다. 재추천으로 추천이 바뀌면 새 ID를 다시 보낸다. 실패는 무해(카톡 공유로도 전달 가능).
  useEffect(() => {
    if (view !== 'result' || !isGroup || !sessionId || !result || result.length === 0) return;
    const rec = result[0].record;
    if (!rec) {
      // 추천 저장이 실패해 친구들에게 보낼 추천 ID가 없다 — 조용히 넘기면 게스트는 영원히 기다린다
      const failKey = `${sessionId}:none:${result[0].kakaoPlaceId ?? result[0].placeName}`;
      if (lastSessionResultRef.current === failKey) return;
      lastSessionResultRef.current = failKey;
      window.alert('친구들에게 결과를 전달하지 못했어요. 카카오톡 공유로 결과를 보내주세요.');
      return;
    }
    const key = `${sessionId}:${rec.recommendationId}`;
    if (lastSessionResultRef.current === key) return;
    lastSessionResultRef.current = key;
    void (async () => {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'result', id: sessionId, recommendationId: rec.recommendationId, ...(rec.claimToken ? { claimToken: rec.claimToken } : {}) }),
      }).catch(() => { /* 실패 무해 */ });
    })();
  }, [view, isGroup, sessionId, result]);

  useEffect(() => {
    if (view === 'result') {
      const startStr = sessionStorage.getItem('mintSessionStart');
      if (startStr) {
        const seconds = Math.round((Date.now() - parseInt(startStr)) / 1000);
        trackSessionDuration(seconds);
        sessionStorage.removeItem('mintSessionStart');
      }
    }
  }, [view]);
}

// 살아 있는(6시간 안) 그룹 세션이 이 스냅샷과 다른 세션인가
function otherGroupSessionAlive(snapSessionId: string | null | undefined): boolean {
  try {
    const raw = localStorage.getItem(GROUP_SESSION_KEY);
    if (!raw) return false;
    const g = JSON.parse(raw) as { savedAt?: number; sessionId?: string };
    if (!g.sessionId) return false;
    if (typeof g.savedAt === 'number' && Date.now() - g.savedAt > GROUP_SESSION_TTL_MS) return false;
    return g.sessionId !== snapSessionId;
  } catch {
    return false;
  }
}
