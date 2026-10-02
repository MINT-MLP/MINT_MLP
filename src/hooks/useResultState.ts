import { useState } from 'react';
import type { Coordinates, PlaceRecommendation, RegionScope, TravelTimeData, WeatherSummary } from '@/types';
import { getBalance } from '@/storage/points';

// 추천 결과 상태 — 장소·중간지점·소요시간·날씨·총무·결과 화면 UI 토글. 상태만 갖는다.
export function useResultState() {
  const [result, setResult] = useState<PlaceRecommendation[] | null>(null);
  const [showRetryModal, setShowRetryModal] = useState(false);
  const [midpointData, setMidpointData] = useState<{
    midpoint: Coordinates;
    areaName: string;
    nearestAreas: string[];
    scope?: RegionScope | null;   // 행정단위(시/구/동) 스코프 — 재추천 시에도 같은 범위 유지
  } | null>(null);
  const [resultTravelTimes, setResultTravelTimes] = useState<TravelTimeData | null>(null);
  const [treasurer, setTreasurer] = useState<string | null>(null);
  const [pointsBalance, setPointsBalance] = useState<number>(() => getBalance());
  const [showWishlist, setShowWishlist] = useState(false);
  const [resultWeather, setResultWeather] = useState<WeatherSummary | null>(null);
  const [resultThird, setResultThird] = useState<PlaceRecommendation | null>(null);       // 3차 '이어서 갈 곳'
  const [resultThirdLabel, setResultThirdLabel] = useState<string | null>(null);
  // 2차를 골랐지만 서버가 2차 후보를 못 찾아 1코스로 돌려준 경우. 이때 results[1]은 1차 대안이다.
  const [resultSecondMissing, setResultSecondMissing] = useState(false);
  const [changeNote, setChangeNote] = useState<string | null>(null);
  const [compromiseMessage, setCompromiseMessage] = useState<string | null>(null);
  const [showCompromiseToast, setShowCompromiseToast] = useState(false);
  const [showResultScrollHint, setShowResultScrollHint] = useState(false);
  // 지난 추천을 열어 보는 중 — 그날의 약속용 버튼(거절·총무·이동시간·방문 인증)을 숨기고 "이 조건으로 다시 추천받기"만 둔다.
  // 새로 추천을 받으면 null로 돌아가 버튼이 원래대로 나온다.
  const [past, setPast] = useState<{ date: string; areaLabel: string } | null>(null);

  function reset() {
    setResult(null);
    setResultThird(null);
    setResultThirdLabel(null);
    setResultSecondMissing(false);
    setResultTravelTimes(null);
    setMidpointData(null);
    setTreasurer(null);
    setResultWeather(null);
    setChangeNote(null);
    setPast(null);
  }

  return {
    result, setResult, showRetryModal, setShowRetryModal, midpointData, setMidpointData,
    resultTravelTimes, setResultTravelTimes, treasurer, setTreasurer, pointsBalance, setPointsBalance,
    showWishlist, setShowWishlist, resultWeather, setResultWeather, resultThird, setResultThird,
    resultThirdLabel, setResultThirdLabel, resultSecondMissing, setResultSecondMissing, changeNote, setChangeNote, compromiseMessage, setCompromiseMessage,
    showCompromiseToast, setShowCompromiseToast, showResultScrollHint, setShowResultScrollHint, past, setPast, reset,
  };
}
export type ResultState = ReturnType<typeof useResultState>;

// 결과를 2코스로 그릴지. 사용자가 2차를 골랐어도 서버가 2차를 못 채웠으면 1코스.
export function resultHasSecond(purpose: { second?: string | null } | null | undefined, secondMissing: boolean): boolean {
  return !!(purpose?.second && purpose.second !== '없음') && !secondMissing;
}
