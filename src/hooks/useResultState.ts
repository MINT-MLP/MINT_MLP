import { useState } from 'react';
import type { Coordinates, PlaceRecommendation, RegionScope, TravelTimeData, WeatherSummary } from '@/types';
import { getBalance } from '@/utils/points';

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
  const [changeNote, setChangeNote] = useState<string | null>(null);
  const [compromiseMessage, setCompromiseMessage] = useState<string | null>(null);
  const [showCompromiseToast, setShowCompromiseToast] = useState(false);
  const [showResultScrollHint, setShowResultScrollHint] = useState(false);

  function reset() {
    setResult(null);
    setResultThird(null);
    setResultThirdLabel(null);
    setResultTravelTimes(null);
    setMidpointData(null);
    setTreasurer(null);
    setResultWeather(null);
    setChangeNote(null);
  }

  return {
    result, setResult, showRetryModal, setShowRetryModal, midpointData, setMidpointData,
    resultTravelTimes, setResultTravelTimes, treasurer, setTreasurer, pointsBalance, setPointsBalance,
    showWishlist, setShowWishlist, resultWeather, setResultWeather, resultThird, setResultThird,
    resultThirdLabel, setResultThirdLabel, changeNote, setChangeNote, compromiseMessage, setCompromiseMessage,
    showCompromiseToast, setShowCompromiseToast, showResultScrollHint, setShowResultScrollHint, reset,
  };
}
export type ResultState = ReturnType<typeof useResultState>;
