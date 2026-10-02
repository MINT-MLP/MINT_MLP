import { useEffect, useRef } from 'react';
import type { VibeWeights } from '@/components';
import type { ChangeReason, Coordinates, LocationEntry, MeetingLocation, PlaceRecommendation, PresetRegion, RecommendSaveMeta, RegionScope, UserInput } from '@/types';
import { VIBE_KEY_TO_LABEL, ATMOSPHERE_LABELS } from '@/constants/vibeOptions';
import { SEOUL_CENTER } from '@/constants/geo';
import { PRESET_REGIONS, findNearestAreas, findBalancedAreas } from '@/services/midpoint';
import { getAIRecommendation, enrichPlaces } from '@/services/ai';
import { computeTravelTimes, NO_TRAVEL_TIMES } from '@/services/travelTime';
import { trackEvent, setSessionKey, newSessionKey } from '@/services/analytics';
import { savePilotHandoff, buildCoursePicks } from '@/storage/pilotHandoff';
import { LOADING_MESSAGE_COUNT } from '@/utils/loadingCopy';
import { refineHubByTransit } from '@/services/hubSelect';
import { buildChangeNote } from '@/utils/changeNote';
import { pickTreasurer } from '@/utils/treasurer';
import type { RecommendFlow } from '@/hooks/useRecommendFlow';
import type { RecommendInput } from '@/hooks/useRecommendInput';
import type { GroupSession } from '@/hooks/useGroupSession';
import { resultHasSecond, type ResultState } from '@/hooks/useResultState';
import type { RequestState } from '@/hooks/useRequestState';

// 추천 요청 동작 — 중간지점 확정 → AI 호출 → 결과 반영, 재추천(다시 뽑기·취향 조절·거절).
export function useRecommendActions({ flow, input, group, result: resultState, request }: {
  flow: RecommendFlow; input: RecommendInput; group: GroupSession; result: ResultState; request: RequestState;
}) {
  const { view, setView, setStep, isGroup } = flow;
  const {
    groupSize, locations, groupTravelLabels, purpose, vibe, budget, meetingLocation,
    keywords, conditions, vibeCustom,
  } = input;
  const { groupMembers, expectedCount, pendingGroupRecommend, setPendingGroupRecommend } = group;
  const {
    result, setResult, setShowRetryModal, midpointData, setMidpointData, setResultTravelTimes,
    setTreasurer, setResultWeather, resultThird, setResultThird, setResultThirdLabel, setResultSecondMissing, setChangeNote,
    compromiseMessage, setCompromiseMessage, setShowCompromiseToast, setPast,
  } = resultState;
  const {
    setLoading, setLoadingMsg, setLoadingProgress, setError,
    travelReqRef, enrichReqRef, loadingStartRef, lastRecommendRef, sessionKeyRef,
  } = request;

  // 저장용 지역 정보(좌표 없음)와 직전 추천 ID. 재추천도 같은 지역으로 저장하고 이전 추천에 잇는다.
  const areaMetaRef = useRef<Pick<RecommendSaveMeta, 'areaType' | 'areaLabel' | 'areaQuery' | 'regionLevel'> | null>(null);
  const lastRecIdRef = useRef<number | null>(null);

  // 대기 화면 "지금 추천받기" — 집계(setState) 반영 뒤 다음 렌더에서 추천을 트리거해 stale 상태를 피한다
  useEffect(() => {
    if (!pendingGroupRecommend) return;
    // 플래그 리셋: 같은 '지금 추천받기'를 다시 누를 수 있게 하고 GroupWaiting의 recommending 표시를 끈다
    setPendingGroupRecommend(false);
    if (meetingLocation) handleConfirmMeetingLocation(meetingLocation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingGroupRecommend]);

  function applyCompromiseMessage(msg?: string) {
    // 토스트 표시는 결과 화면 진입 시점의 effect가 맡는다(아래 useEffect).
    // 여기서 켜면 15~30초 로딩 동안 타이머가 만료돼 유저가 한 번도 못 본다(기존 버그).
    // 메시지가 없으면 명시적으로 지워 이전 추천의 안내가 남지 않게 한다(stale 방지).
    setCompromiseMessage(msg ?? null);
    setShowCompromiseToast(false);
  }

  // 중간지점 보완 토스트는 결과가 '보일 때' 떠야 한다 — 추천 요청(로딩) 시점에 켜면 15~30초 로딩 중
  // 타이머가 만료돼 못 본다(기존 버그). setState는 타이머 콜백 안에서만 호출해 이펙트 본문 동기
  // setState(cascading render)를 피하고, 50ms 지연 마운트로 페이드인 트랜지션도 자연스럽게 만든다.
  useEffect(() => {
    if (view !== 'result' || !compromiseMessage) return;
    const showT = setTimeout(() => setShowCompromiseToast(true), 50);
    const hideT = setTimeout(() => setShowCompromiseToast(false), 7050);
    return () => { clearTimeout(showT); clearTimeout(hideT); };
  }, [view, compromiseMessage, setShowCompromiseToast]);

  function handleConfirmMeetingLocation(loc: MeetingLocation) {
    if (loc.type === 'auto') {
      void handleMidpointSelect();
    } else {
      const region = PRESET_REGIONS.find((r) => r.id === loc.regionId);
      const validLocs = locations.filter((l) => l.lat != null && l.lng != null);
      if (region) {
        void handleMidpointSelect(region);
      } else if (loc.scope && loc.lat != null && loc.lng != null) {
        // 시/구/동 단위로 검색·확정된 지역 — 그 행정단위 범위 안에서만 추천.
        // searchAreas(시=유명상권 여러 곳, 구/동=그 자체)로 네이버를 검색하고,
        // regionScope(matchTokens)로 결과 주소를 그 범위로 고정한다.
        const midpoint = { lat: loc.lat, lng: loc.lng };
        const scope: RegionScope = {
          level: loc.scope.level,
          matchTokens: loc.scope.matchTokens,
          centerLat: loc.lat,
          centerLng: loc.lng,
        };
        setMidpointData({ midpoint, areaName: loc.area, nearestAreas: loc.scope.searchAreas, scope });
        areaMetaRef.current = { areaType: 'region', areaLabel: loc.area, areaQuery: loc.scope.query ?? loc.area, regionLevel: loc.scope.level };
        setResultTravelTimes(null);
        applyCompromiseMessage(undefined); // 직접 검색 지역은 중간지점 안내 대상이 아님 — stale 제거
        handleRecommend(midpoint, loc.scope.searchAreas, validLocs, undefined, [], undefined, scope);
      } else if (loc.lat != null && loc.lng != null) {
        // (구버전 폴백) 스코프 없이 좌표만 있는 경우 — 검색한 지역명을 검색어 1순위로.
        const midpoint = { lat: loc.lat, lng: loc.lng };
        const nearby = findNearestAreas(midpoint, 3).filter((a) => a !== loc.area);
        const searchAreas = [loc.area, ...nearby].slice(0, 3);
        setMidpointData({ midpoint, areaName: loc.area, nearestAreas: searchAreas });
        areaMetaRef.current = { areaType: 'region', areaLabel: loc.area, areaQuery: loc.area, regionLevel: null };
        setResultTravelTimes(null);
        applyCompromiseMessage(undefined); // 직접 검색 지역은 중간지점 안내 대상이 아님 — stale 제거
        handleRecommend(midpoint, searchAreas, validLocs);
      } else {
        // 좌표 없는 텍스트만(구버전·자동완성 미선택) — 최후 폴백
        const coords = validLocs.map((l) => ({ lat: l.lat!, lng: l.lng! }));
        const balanced = findBalancedAreas(coords.length >= 1 ? coords : [SEOUL_CENTER]);
        const nearestAreas = findNearestAreas(balanced.midpoint, 3);
        setMidpointData({ midpoint: balanced.midpoint, areaName: loc.area, nearestAreas });
        areaMetaRef.current = { areaType: 'auto', areaLabel: balanced.areaName };
        setResultTravelTimes(null);
        applyCompromiseMessage(balanced.compromiseMessage);
        handleRecommend(balanced.midpoint, nearestAreas, validLocs);
      }
    }
  }

  async function handleMidpointSelect(presetRegion?: PresetRegion) {
    let midpoint: Coordinates;
    let areaName: string;
    const validLocs = locations.filter((l) => l.lat != null && l.lng != null);

    // 출발지 없이 자동 중간지점을 돌리면 서울 중심으로 추천된다 — 출발지를 다시 받는다
    if (!presetRegion && validLocs.length === 0) {
      window.alert(isGroup ? '참여자 출발지를 찾지 못했어요. 잠시 후 다시 시도해주세요.' : '출발지를 다시 입력해주세요.');
      setView('steps');
      if (!isGroup) setStep(2);
      return;
    }

    if (presetRegion) {
      midpoint = presetRegion.midpoint;
      areaName = presetRegion.label;
      applyCompromiseMessage(undefined); // 프리셋 지역은 중간지점 계산이 아니므로 이전 안내를 지운다
    } else {
      const coords = validLocs.map((l) => ({ lat: l.lat!, lng: l.lng! }));
      const balanced = findBalancedAreas(coords.length >= 1 ? coords : [SEOUL_CENTER]);
      midpoint = balanced.midpoint;
      areaName = balanced.areaName;
      applyCompromiseMessage(balanced.compromiseMessage);
      // 하이브리드: 빈 구간 스냅이 일어났으면 거리로 좁힌 후보 2곳을 실측 대중교통 시간으로 최종 결정.
      // 실측 왕복이 붙으므로 먼저 로딩 화면을 띄워 빈 대기(1~2초)를 없앤다. 실패 시 거리 결과 그대로.
      if (balanced.snapHubs && balanced.snapHubs.length >= 2 && coords.length >= 1) {
        setLoading(true);
        const chosen = await refineHubByTransit(balanced.snapHubs, coords);
        midpoint = { lat: chosen.lat, lng: chosen.lng };
        areaName = chosen.name;
      }
    }

    const nearestAreas = findNearestAreas(midpoint, 3);
    setMidpointData({ midpoint, areaName, nearestAreas });
    areaMetaRef.current = presetRegion
      ? { areaType: 'preset', areaLabel: presetRegion.label }
      : { areaType: 'auto', areaLabel: areaName };
    setResultTravelTimes(null);
    handleRecommend(midpoint, nearestAreas, validLocs);
  }

  async function handleRecommend(
    midpoint: Coordinates,
    nearestAreas: string[],
    validLocs: LocationEntry[],
    vibeWeights?: Record<string, number>,
    excludeNames: string[] = [],
    changeReason?: ChangeReason,
    scope: RegionScope | null = null,
  ) {
    // 실패 시 같은 조건으로 원탭 재시도할 수 있게 이번 호출을 기억해둔다(입력 state는 그대로라 재실행만 하면 됨)
    lastRecommendRef.current = () => { void handleRecommend(midpoint, nearestAreas, validLocs, vibeWeights, excludeNames, changeReason, scope); };
    // 재추천이면 이전 1순위를 기억해뒀다가 "뭐가 달라졌는지" 한 줄에 사용
    const prevFirst = changeReason ? result?.[0] ?? null : null;
    setChangeNote(null);
    setPast(null);   // 새로 받는 추천은 지난 추천 보기가 아니다 — 결과 화면 버튼이 원래대로 나온다
    // 초기 추천에서 새 세션키 발급, 재시도/거절/조정(changeReason 있음)은 같은 키 유지 → 한 에피소드로 조인
    if (!changeReason || !sessionKeyRef.current) sessionKeyRef.current = newSessionKey();
    setSessionKey(sessionKeyRef.current); // 이후 발생하는 이벤트(클릭·거절·예약)에 자동으로 세션키 태깅
    trackEvent('recommend_request'); // 퍼널 분모: 모든 추천 호출(첫 추천·재추천 공통)
    setLoading(true);
    loadingStartRef.current = Date.now();
    setLoadingProgress(0);
    setError(null);
    setResult(null);
    setResultThird(null);
    setResultThirdLabel(null);

    const msgInterval = setInterval(() => {
      setLoadingMsg((m) => (m + 1) % LOADING_MESSAGE_COUNT);
    }, 1800);

    let aiProgressInterval: ReturnType<typeof setInterval> | null = null;

    try {
      // 혼잡도는 서버가 추천 파이프라인 안에서 병렬 조회 — 클라이언트 선행 왕복 제거
      setLoadingProgress(15);

      const vibeFirst: string[] = [];
      const vibeSecond: string[] = [];
      Object.values(vibe).forEach((g) => {
        g.first.forEach((k) => vibeFirst.push(VIBE_KEY_TO_LABEL[k] ?? k));
        g.second.forEach((k) => vibeSecond.push(VIBE_KEY_TO_LABEL[k] ?? k));
      });
      // 조건은 코스 구분이 없어 1차에 합쳐 보낸다 — API 계약(vibe.first/second 배열)은 그대로다
      conditions.forEach((k) => vibeFirst.push(VIBE_KEY_TO_LABEL[k] ?? k));

      const input: UserInput = {
        // 서버 검증 통과를 위해 이름 없는 항목 제외 (지역 직접 선택 시 빈 배열)
        locations: locations.filter((l) => l.name?.trim()),
        // 그룹 인원은 '실제 제출한 멤버 수'다. expectedCount(호스트가 선언한 정원)를 쓰면
        // 정원 6으로 링크를 만들고 2명만 모여 추천받았을 때 프롬프트에 "인원: 5명 (단체석 또는 넓은 공간 필수)"가
        // 들어가고 검색어에도 단체석 프리픽스가 붙어, 두 명이 단체룸을 추천받는다(화면엔 '2명 참여'라 떠 있다).
        // 다만 결과 화면에서 새로고침한 뒤의 재추천은 폴링이 멈춰 있어 멤버 목록이 비어 있다 —
        // 그때는 인원을 2명으로 축소해버리지 않도록 호스트가 선언한 정원으로 되돌린다.
        groupSize: isGroup
          ? (() => {
              const n = groupMembers.length >= 2 ? groupMembers.length : Math.max(2, expectedCount);
              return n >= 5 ? '5명 이상' : n >= 3 ? '3~4명' : '2명';
            })()
          : groupSize,
        purpose: {
          first: purpose!.first!,
          second: purpose!.second ?? null,
          // 장르 좁히기 — 서버가 검색 키워드 풀을 해당 장르로 좁히고 AI에도 제약 전달
          ...(purpose?.firstGenre ? { firstGenre: purpose.firstGenre } : {}),
          ...(purpose?.secondGenre && purpose.second && purpose.second !== '없음' ? { secondGenre: purpose.secondGenre } : {}),
        },
        vibe: { first: vibeFirst, second: vibeSecond },
        relation: purpose?.relation ?? null,
        occasion: purpose?.occasion?.trim().slice(0, 40) || null,
        budget,
        ...(vibeWeights && Object.keys(vibeWeights).length > 0 ? { vibeWeights } : {}),
        ...((() => {
          // 1차 키워드 — 서버 검증 한도(개수 10 · 항목당 30자)에 맞춰 잘라서 전송.
          // "분위기가 별로"(changeReason==='vibe') 재추천에서는 분위기성 라벨을 키워드에서도 빼야 한다.
          // 가중치 1로 낮추기만 하면 서버 프롬프트의 '1차 필수 키워드 ← 최우선'과 네이버 검색어에 그대로 남아
          // 방금 거절한 분위기의 장소가 다시 올라온다("바꿔달라고 했는데 왜 똑같지?").
          const allKw = [...keywords, ...Object.values(vibeCustom).filter(Boolean)]
            .filter((k) => changeReason !== 'vibe' || !ATMOSPHERE_LABELS.has(k.trim()))
            .map((k) => k.trim().slice(0, 30))
            .filter(Boolean)
            .slice(0, 10);
          return allKw.length > 0 ? { keywords: allKw } : {};
        })()),
      };

      // AI 호출 동안 25→90% 타이머 (Claude 응답이 단일 fetch라 내부 진행도 불가)
      aiProgressInterval = setInterval(() => {
        setLoadingProgress((prev) => {
          if (prev >= 92) return prev;
          // 초반엔 빠르게, 92% 가까울수록 느리게 (후처리 분리로 총 소요가 짧아져 살짝 가속)
          const gap = 92 - prev;
          return prev + gap * 0.055;
        });
      }, 250);

      // 실제 마일스톤 2: AI 추천 완료 (재추천 시 이전 장소 제외)
      const retryReason = changeReason === 'expensive' || changeReason === 'far' || changeReason === 'vibe' ? changeReason : null;
      // 출발지는 전부 검색어·ID가 있을 때만 보낸다. 일부만 보내면 복원이 그 일부의 중간점을 정답처럼 쓴다
      const originsOk = !isGroup && validLocs.length > 0 && validLocs.every((l) => !!l.query && !!l.kakaoPlaceId);
      const saveMeta: RecommendSaveMeta = {
        mode: isGroup ? 'group' : 'solo',
        ...(areaMetaRef.current ?? areaMetaFrom(meetingLocation, midpointData, nearestAreas)),
        origins: originsOk ? validLocs.map((l) => ({ query: l.query as string, kakaoPlaceId: l.kakaoPlaceId as string })) : [],
        // 새로고침으로 ref가 비었으면 스냅샷으로 되살아난 결과의 추천 ID로 잇는다
        retriedFromId: changeReason ? (lastRecIdRef.current ?? result?.[0]?.record?.recommendationId ?? null) : null,
        retryReason,
      };
      const { places: recommendation, weather, thirdStop, thirdLabel, serial, courses, recommendationId } = await getAIRecommendation(input, midpoint, [], excludeNames, nearestAreas, scope, sessionKeyRef.current, saveMeta);
      lastRecIdRef.current = recommendationId ?? null;
      clearInterval(aiProgressInterval);
      setLoadingProgress(100); // 실제 완료

      const secondMissing = !!(purpose?.second && purpose.second !== '없음') && courses === 1;
      const hasSecond = resultHasSecond(purpose, secondMissing);
      setResultSecondMissing(secondMissing);
      setResult(recommendation);
      setResultThird(thirdStop ?? null);
      setResultThirdLabel(thirdLabel ?? null);
      setResultWeather(weather);

      // 파일럿 핸드오프 저장 — 유저 비노출. /pilot에서 "○○집으로 추천받은 거 맞아요?" 자동 감지에 사용
      if (serial) {
        try {
          savePilotHandoff({
            serial,
            createdAt: Date.now(),
            conditions: {
              purpose: purpose?.first ?? null,
              relation: purpose?.relation ?? null,
              region: nearestAreas?.[0] ?? locations.find((l) => l.name)?.name ?? null,
              vibes: vibeFirst.slice(0, 3),
              budget: budget ?? null,
            },
            coursePicks: buildCoursePicks(recommendation, hasSecond, thirdStop ?? null),
          });
        } catch { /* 저장 실패해도 추천 흐름엔 무영향 */ }
      }
      if (changeReason) {
        setChangeNote(buildChangeNote(prevFirst, recommendation[0], midpoint, changeReason));
      }

      // 사진·카카오URL 후처리 — 결과를 먼저 그린 뒤 별도 호출로 채운다(초기 로딩 단축).
      // 재추천 레이스 방지용 reqId 가드 (오래된 응답이 새 결과를 덮지 않게). 3차도 함께 보강.
      const enrichId = ++enrichReqRef.current;
      const enrichTargets = [...recommendation, ...(thirdStop ? [thirdStop] : [])];
      enrichPlaces(enrichTargets.map((p) => ({ placeName: p.placeName, lat: p.lat, lng: p.lng, area: p.area, category: p.category })))
        .then((enriched) => {
          if (enrichId !== enrichReqRef.current || enriched.length === 0) return;
          const apply = (p: PlaceRecommendation) => {
            const e = enriched.find((x) => x.placeName === p.placeName);
            return e ? { ...p, kakaoPlaceUrl: e.kakaoPlaceUrl ?? p.kakaoPlaceUrl, imageUrl: e.imageUrl ?? p.imageUrl } : p;
          };
          setResult((prev) => (prev ? prev.map(apply) : prev));
          setResultThird((prev) => (prev ? apply(prev) : prev));
        });

      // 총무 후보는 '이번 추천에 실제로 쓰인 출발지'에서 뽑는다. 재추천(다시 뽑기·취향 조절·거절)은
      // setTreasurer(null) 뒤 validLocs를 인자로 넘겨 다시 들어오므로 state 반영이 늦어도 후보를 놓치지 않는다.
      // 지역 직접 선택 모드는 출발지 입력 화면 자체가 없어 후보가 0개 → null이 되고,
      // 그때는 결과 카드가 '공정 규칙' 폴백 팝업을 띄운다(버튼이 죽지 않게).
      setTreasurer(pickTreasurer(validLocs.length > 0 ? validLocs : locations));
      setView('result');
      trackEvent('recommend_shown'); // 결과가 실제로 렌더된 성공 케이스(퍼널 분자)

      // 자동 중간지점 모드에서만 소요시간 조회 (임의 지역은 UI도 안 뜨므로 호출 생략)
      if (meetingLocation?.type === 'auto' && validLocs.length >= 2) {
        const firstPlace = recommendation[0];
        const secondPlace = hasSecond ? recommendation[1] : undefined;
        const firstDest = firstPlace?.lat && firstPlace.lat !== 0
          ? { lat: firstPlace.lat, lng: firstPlace.lng! }
          : midpoint;
        const secondDest = secondPlace?.lat && secondPlace.lat !== 0
          ? { lat: secondPlace.lat, lng: secondPlace.lng! }
          : undefined;
        // 재추천 직후 이전 응답이 늦게 도착해 옛 장소의 소요시간이 표시되는 레이스 방지
        const reqId = ++travelReqRef.current;
        computeTravelTimes(
          // 이동시간 표의 label만 사람 이름을 쓴다 — locations[].name은 그룹에선 지명(출발지)이라
          // "강남역 25분"처럼 누구 이동시간인지 알 수 없게 된다. 혼자 모드는 groupTravelLabels가 null이라 그대로.
          validLocs.map((l, i) => ({ lat: l.lat!, lng: l.lng!, label: (isGroup ? groupTravelLabels?.[i] : null) || l.name })),
          { first: firstDest, ...(secondDest ? { second: secondDest } : {}) },
        )
          .then((data) => { if (reqId === travelReqRef.current) setResultTravelTimes(data); })
          .catch(() => { if (reqId === travelReqRef.current) setResultTravelTimes(NO_TRAVEL_TIMES); });
      } else {
        setResultTravelTimes(null);
      }
    } catch (e) {
      if (aiProgressInterval) clearInterval(aiProgressInterval);
      trackEvent('recommend_error'); // 추천 성공률 관측 — 특정 조건/지역 실패 편중 파악
      setError((e as Error).message || '추천을 가져오지 못했어요. 다시 시도해주세요.');
    } finally {
      clearInterval(msgInterval);
      setLoading(false);
      setLoadingProgress(0);
    }
  }

  // 현재 표시 중인 추천 장소 이름 — 재추천 시 제외 목록으로 전달 (3차 포함)
  function currentExclude(): string[] {
    return [...(result ?? []), ...(resultThird ? [resultThird] : [])]
      .map((r) => r.placeName)
      .filter(Boolean);
  }

  // 🔄 다시 뽑기 = 방금 곳 제외하고 즉시 다른 곳 (조건 그대로, 모달 없음)
  function handleRetry() {
    if (!midpointData) return;
    trackEvent('retry_fresh');
    const validLocs = locations.filter((l) => l.lat != null && l.lng != null);
    const exclude = currentExclude();
    setTreasurer(null);
    setResultTravelTimes(null);
    handleRecommend(midpointData.midpoint, midpointData.nearestAreas, validLocs, undefined, exclude, 'retry', midpointData.scope ?? null);
  }

  // 지난 추천의 "이 조건으로 다시 추천받기" — 열 때 되살린 입력(목적·지역·출발지·취향)과 검색 중심으로 새로 추천.
  // 이전 가게를 빼지 않고, 이전 추천에 잇지도 않는다(새 추천 한 건).
  function restartFromPast() {
    if (!midpointData) return;
    trackEvent('past_restart');
    areaMetaRef.current = null;
    lastRecIdRef.current = null;
    const validLocs = locations.filter((l) => l.lat != null && l.lng != null);
    setTreasurer(null);
    setResultTravelTimes(null);
    handleRecommend(midpointData.midpoint, midpointData.nearestAreas, validLocs, undefined, [], undefined, midpointData.scope ?? null);
  }

  // 🎚️ 취향 직접 조절 = 슬라이더 모달 진입
  function handleAdjust() {
    setShowRetryModal(true);
  }

  function handleRetryWithWeights(weights: VibeWeights) {
    setShowRetryModal(false);
    if (!midpointData) return;
    trackEvent('retry_adjust');
    const validLocs = locations.filter((l) => l.lat != null && l.lng != null);
    const exclude = currentExclude();
    const labeledWeights: Record<string, number> = {};
    Object.entries(weights).forEach(([k, v]) => {
      if (k.startsWith('budget:')) {
        labeledWeights[`예산 ${k.slice(7)}`] = v;
      } else {
        labeledWeights[VIBE_KEY_TO_LABEL[k] ?? k] = v;
      }
    });
    setTreasurer(null);
    setResultTravelTimes(null);
    handleRecommend(midpointData.midpoint, midpointData.nearestAreas, validLocs, labeledWeights, exclude, 'adjust', midpointData.scope ?? null);
  }

  function handleReject(reason: 'expensive' | 'far' | 'vibe') {
    if (!midpointData) return;
    // payload: 무엇을 왜 거절했나(현 1순위의 가격대·적합도). session_key로 어떤 추천이었는지 조인 가능.
    const rejected = result?.[0];
    trackEvent(`reject_${reason}`, rejected ? { place_id: rejected.kakaoPlaceId ?? null, slot_id: rejected.record?.slotId ?? null } : undefined);
    const validLocs = locations.filter((l) => l.lat != null && l.lng != null);
    const exclude = currentExclude();
    setTreasurer(null);
    setResultTravelTimes(null);

    // 거절 이유를 labeled weights로 변환해서 AI에 전달
    const rejectWeights: Record<string, number> = {};
    if (reason === 'expensive') {
      // 현재 vibe 유지 + 저렴한 힌트
      Object.values(vibe).forEach((g) => {
        [...g.first, ...g.second].forEach((k) => { rejectWeights[VIBE_KEY_TO_LABEL[k] ?? k] = 3; });
      });
      rejectWeights['저렴한'] = 5;
      rejectWeights['가성비'] = 5;
    } else if (reason === 'far') {
      // 현재 vibe 유지 + 접근성 힌트
      Object.values(vibe).forEach((g) => {
        [...g.first, ...g.second].forEach((k) => { rejectWeights[VIBE_KEY_TO_LABEL[k] ?? k] = 3; });
      });
      rejectWeights['가까운'] = 5;
      rejectWeights['접근하기 쉬운'] = 5;
    } else {
      // vibe 거절: 현재 분위기 weight 낮추고 다른 분위기 탐색
      Object.values(vibe).forEach((g) => {
        [...g.first, ...g.second].forEach((k) => { rejectWeights[VIBE_KEY_TO_LABEL[k] ?? k] = 1; });
      });
      // 그룹에선 vibe에 집계 승자만 남고, 나머지 멤버의 분위기는 keywords로 넘어와 있다.
      // vibe만 낮추면 거절이 절반만 작동하므로 keywords 쪽 분위기 라벨도 함께 내린다
      // (전송 목록에서 빼는 건 handleRecommend가 changeReason==='vibe'로 처리한다).
      keywords.forEach((k) => { if (ATMOSPHERE_LABELS.has(k.trim())) rejectWeights[k.trim()] = 1; });
      rejectWeights['새로운 분위기'] = 5;
    }

    handleRecommend(midpointData.midpoint, midpointData.nearestAreas, validLocs, rejectWeights, exclude, reason, midpointData.scope ?? null);
  }

  return { handleConfirmMeetingLocation, handleMidpointSelect, handleRecommend, handleRetry, handleAdjust, handleRetryWithWeights, handleReject, restartFromPast, applyCompromiseMessage };
}
export type RecommendActions = ReturnType<typeof useRecommendActions>;

// 새로고침·로그인 복귀로 저장용 지역 정보(ref)가 비었을 때, 스냅샷에 남은 만날 장소·중간지점 정보로 다시 만든다.
function areaMetaFrom(
  loc: MeetingLocation | null | undefined,
  mid: { areaName: string; scope?: RegionScope | null } | null | undefined,
  nearestAreas: string[],
): Pick<RecommendSaveMeta, 'areaType' | 'areaLabel' | 'areaQuery' | 'regionLevel'> {
  if (loc?.type === 'manual') {
    const preset = PRESET_REGIONS.find((r) => r.id === loc.regionId);
    if (preset) return { areaType: 'preset', areaLabel: preset.label };
    return {
      areaType: 'region',
      areaLabel: loc.area,
      areaQuery: loc.scope?.query ?? loc.area,
      regionLevel: loc.scope?.level ?? mid?.scope?.level ?? null,
    };
  }
  return { areaType: 'auto', areaLabel: mid?.areaName || nearestAreas[0] || '' };
}
