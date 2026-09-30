import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Coordinates, MeetingLocation, PlaceRecommendation, PurposeValue, Step, TravelTimeData, VibeState, WeatherSummary } from '@/types';
import { OCCASION_BY_RELATION } from '@/constants/occasion';
import { saveResultSnapshot, loadResultSnapshot, saveHistory, INPUT_DRAFT_KEY, GROUP_SESSION_KEY, INPUT_DRAFT_TTL_MS, GROUP_SESSION_TTL_MS } from '@/storage/history';
import { trackSessionDuration } from '@/services/analytics';
import { migrateVibeState } from '@/utils/vibeMigrate';
import type { RecommendFlow } from '@/hooks/useRecommendFlow';
import type { RecommendInput } from '@/hooks/useRecommendInput';
import type { GroupSession } from '@/hooks/useGroupSession';
import { resultHasSecond, type ResultState } from '@/hooks/useResultState';
import type { RequestState } from '@/hooks/useRequestState';

// localStorage 복원·저장. 복원 layout effect 3개의 선언 순서(결과→입력초안→그룹세션)는 동작에 영향을 주므로
// (그룹세션 복원이 결과 복원의 view/step을 덮어써야 한다) 한 훅 안에 원래 순서대로 둔다.
export function useHomePersistence({ flow, input, group, result: resultState }: {
  flow: RecommendFlow; input: RecommendInput; group: GroupSession; result: ResultState; request: RequestState;
}) {
  const { view, setView, step, setStep, appMode, setAppMode, isGroup } = flow;
  const {
    groupSize, setGroupSize, setCustomOccasion, setEtcRelOpen, setOccasionChip, locations, setLocations,
    purpose, setPurpose, vibe, setVibe, budget, setBudget, meetingLocation, setMeetingLocation,
    keywords, setKeywords, conditions, setConditions, vibeCustom, setVibeCustom, customOccasion,
  } = input;
  const { sessionId, setSessionId, expectedCount, setExpectedCount } = group;
  const {
    result, setResult, setResultThird, resultThird, setResultThirdLabel, resultThirdLabel, resultSecondMissing, setResultSecondMissing,
    midpointData, setMidpointData, treasurer, setTreasurer, resultTravelTimes, setResultTravelTimes,
    resultWeather, setResultWeather,
  } = resultState;
  const lastSessionResultRef = useRef<string | null>(null); // 그룹 결과 세션 저장 중복 억제

  useEffect(() => {
    if (!sessionStorage.getItem('mintSessionStart')) {
      sessionStorage.setItem('mintSessionStart', Date.now().toString());
    }
  }, []);

  // 마지막 추천 결과 복원 (새로고침·홈 이탈·앱 전환 후 재진입 시 추천이 증발하지 않게)
  useLayoutEffect(() => {
    try {
      const saved = loadResultSnapshot() as {
        result?: PlaceRecommendation[];
        resultThird?: PlaceRecommendation | null;
        resultThirdLabel?: string | null;
        resultSecondMissing?: boolean;
        purpose?: PurposeValue;
        midpointData?: { midpoint: Coordinates; areaName: string; nearestAreas: string[] };
        treasurer?: string;
        meetingLocation?: MeetingLocation;
        resultTravelTimes?: TravelTimeData;
        resultWeather?: WeatherSummary;
        vibe?: VibeState;
        keywords?: string[];
        conditions?: string[];
      } | null;
      if (!saved || !Array.isArray(saved.result) || saved.result.length === 0) return;
      // 마운트 시 localStorage 스냅샷을 페인트 전에 복원(useLayoutEffect, 깜빡임 방지)
      setResult(saved.result);
      if (saved.resultThird) setResultThird(saved.resultThird);
      if (saved.resultThirdLabel) setResultThirdLabel(saved.resultThirdLabel);
      setResultSecondMissing(saved.resultSecondMissing === true);
      if (saved.purpose) setPurpose(saved.purpose);
      if (saved.midpointData) setMidpointData(saved.midpointData);
      if (saved.treasurer) setTreasurer(saved.treasurer);
      if (saved.meetingLocation) setMeetingLocation(saved.meetingLocation);
      if (saved.resultTravelTimes) setResultTravelTimes(saved.resultTravelTimes);
      if (saved.resultWeather) setResultWeather(saved.resultWeather);
      if (saved.vibe) setVibe(migrateVibeState(saved.vibe));            // 개인화 배너 복원용
      if (Array.isArray(saved.keywords)) setKeywords(saved.keywords);
      if (Array.isArray(saved.conditions)) setConditions(saved.conditions);
      setView('result');
    } catch { /* 손상된 캐시는 무시 */ }
  }, [setView, setResult, setResultThird, setResultThirdLabel, setResultSecondMissing, setPurpose, setMidpointData, setTreasurer, setMeetingLocation, setResultTravelTimes, setResultWeather, setVibe, setKeywords, setConditions]);

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
      if (d.meetingLocation) setMeetingLocation(d.meetingLocation);
      if (d.budget !== undefined) setBudget(d.budget);
      if (typeof d.customOccasion === 'string') setCustomOccasion(d.customOccasion);
      // 기타 콕! 자유입력 모드 복원 (occasion만 있고 relation 없으면 기타콕으로 입력한 것)
      if (d.purpose?.occasion && !d.purpose?.relation) setEtcRelOpen(true);
      // 스텝2 2층 칩 복원 — 관계+occasion이 매핑 칩과 일치하면 선택 표시 되살림
      if (d.purpose?.relation && d.purpose?.occasion) {
        const chip = OCCASION_BY_RELATION[d.purpose.relation]?.find((c) => c.occasion === d.purpose.occasion);
        if (chip) setOccasionChip(chip.key);
      }
      if (Array.isArray(d.locations)) setLocations(d.locations);
    } catch { /* 손상된 초안 무시 */ }
  }, [setAppMode, setStep, setExpectedCount, setGroupSize, setPurpose, setVibe, setKeywords, setConditions, setVibeCustom, setMeetingLocation, setBudget, setCustomOccasion, setEtcRelOpen, setOccasionChip, setLocations]);

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
      if (g.meetingLocation) setMeetingLocation(g.meetingLocation); // 호스트가 정한 지역 복원
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
        savedAt: Date.now(), sessionId, expectedCount, purpose, meetingLocation,
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
        meetingLocation, budget, customOccasion, locations,
      }));
    } catch { /* 저장 실패는 치명적이지 않음 */ }
  }, [view, appMode, sessionId, step, groupSize, expectedCount, purpose, vibe, keywords, conditions, vibeCustom, meetingLocation, budget, customOccasion, locations]);

  // 결과 화면 상태가 확정될 때마다 스냅샷 저장 (setState 커밋 이후라 stale closure 없음)
  // + 같은 스냅샷을 localStorage 히스토리에도 적재 — 랜딩 "지난 추천"에서 그대로 복원
  useEffect(() => {
    if (view !== 'result' || !result || result.length === 0) return;
    const snapshot = {
      result, resultThird, resultThirdLabel, resultSecondMissing, purpose, midpointData, treasurer, meetingLocation, resultTravelTimes, resultWeather, vibe, keywords, conditions,
      sessionId, // 이 결과가 '어느 그룹 세션의 것인지' — 재진입 시 대기 화면과 결과 화면 중 무엇을 열지 가른다
    };
    saveResultSnapshot(snapshot);
    const hasSecondCourse = resultHasSecond(purpose, resultSecondMissing);
    saveHistory({
      savedAt: Date.now(),
      placeName: result[0].placeName,
      secondPlaceName: hasSecondCourse ? result[1]?.placeName ?? null : null,
      areaName: midpointData?.areaName ?? null,
      purposeFirst: purpose?.first ?? null,
      snapshot,
    });
  }, [view, result, resultThird, resultThirdLabel, resultSecondMissing, purpose, midpointData, treasurer, meetingLocation, resultTravelTimes, resultWeather, vibe, keywords, conditions, sessionId]);

  // 그룹 호스트가 추천을 받으면 결과 요약을 세션에 저장 → 게스트 done 화면이 폴링으로 수신(협업 루프 완결).
  // enrich·재추천으로 결과가 바뀌면 자동 재저장. 실패는 무해(게스트가 못 볼 뿐, 카톡 공유로도 전달 가능).
  useEffect(() => {
    if (view !== 'result' || !isGroup || !sessionId || !result || result.length === 0) return;
    const hasSecondCourse = resultHasSecond(purpose, resultSecondMissing);
    // v:2 — 게스트 화면을 호스트와 동등하게 만들기 위해 신뢰 요소(사진·적합도·영업·해시태그·혼잡도)를 함께 실어 보낸다.
    // 이미지 URL이 길어 페이로드가 커지므로 /api/session 결과 저장 상한(24KB)에 맞춰 vibeTags는 3개로 제한.
    const slim = (p: PlaceRecommendation) => ({
      placeName: p.placeName, category: p.category, description: p.description,
      priceRange: p.priceRange, address: p.address, area: p.area,
      lat: p.lat ?? null, lng: p.lng ?? null, kakaoPlaceUrl: p.kakaoPlaceUrl ?? null,
      imageUrl: p.imageUrl ?? null,
      vibeTags: Array.isArray(p.vibeTags) ? p.vibeTags.slice(0, 3) : [],
      fitScore: p.fitScore ?? null,
      openingHours: p.openingHours ?? null,
      walkingToNext: p.walkingToNext ?? null,
      congestionLevel: p.congestionLevel ?? null,
    });
    const summary = {
      v: 2,
      first: slim(result[0]),
      second: hasSecondCourse && result[1] ? slim(result[1]) : null,
      third: resultThird ? slim(resultThird) : null,
      thirdLabel: resultThird ? (resultThirdLabel ?? '이어서') : null,
      purposeFirst: purpose?.first ?? null,
      purposeSecond: hasSecondCourse ? purpose?.second ?? null : null,
      areaName: midpointData?.areaName ?? null,
      // 총무 발표·날씨 — 호스트 결과에 있는 '재미/맥락' 요소를 게스트도 그대로 받는다(작은 필드).
      treasurer: treasurer ?? null,
      weather: resultWeather
        ? { description: resultWeather.description, temp: resultWeather.temp, isRainy: resultWeather.isRainy }
        : null,
    };
    // 서버 상한(24KB) 초과 시 이미지 URL부터 버리고 재직렬화 — 리치 화면 일부를 잃더라도
    // 결과 전송 자체가 실패(게스트가 아무것도 못 봄)하는 최악을 막는다. 이미지 없이도 v:2 나머지는 유지.
    let payload = summary;
    let raw = JSON.stringify(summary);
    if (raw.length > 23_000) {
      const drop = (p: typeof summary.first | null) => (p ? { ...p, imageUrl: null } : p);
      payload = { ...summary, first: drop(summary.first)!, second: drop(summary.second), third: drop(summary.third) };
      raw = JSON.stringify(payload);
    }
    if (lastSessionResultRef.current === raw) return;
    lastSessionResultRef.current = raw;
    fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'result', id: sessionId, result: payload }),
    }).catch(() => { /* 실패 무해 */ });
  }, [view, isGroup, sessionId, result, resultThird, resultThirdLabel, resultSecondMissing, purpose, midpointData, treasurer, resultWeather]);

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
