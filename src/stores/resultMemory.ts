import type { Coordinates, MeetingLocation, PlaceRecommendation, RegionScope, TravelTimeData, WeatherSummary } from '@/types';

// 결과 화면 상태를 메모리에만 들고 있는다. 탭을 옮기면 Home이 다시 마운트되는데(AppShell key),
// 그때마다 서버 복원·카카오 재검색을 돌리면 느리고 모델 설명·사진·이동시간이 사라진다.
// 같은 추천이면 여기서 그대로 되살린다. 저장소(localStorage·DB)에는 넣지 않는다 — 탭을 닫으면 사라진다.
export interface ResultMemory {
  recommendationId: number;
  result: PlaceRecommendation[];
  resultThird: PlaceRecommendation | null;
  resultThirdLabel: string | null;
  resultSecondMissing: boolean;
  midpointData: { midpoint: Coordinates; areaName: string; nearestAreas: string[]; scope?: RegionScope | null } | null;
  treasurer: string | null;
  meetingLocation: MeetingLocation | null;
  resultTravelTimes: TravelTimeData | null;
  resultWeather: WeatherSummary | null;
}

let memory: ResultMemory | null = null;

export function rememberResult(m: ResultMemory): void {
  memory = m;
}

export function recallResult(recommendationId: number): ResultMemory | null {
  return memory && memory.recommendationId === recommendationId ? memory : null;
}

export function forgetResult(): void {
  memory = null;
}
