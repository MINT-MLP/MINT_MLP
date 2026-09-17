// 소요시간 — 출발지별 대중교통/자차 결과

export interface TravelResult {
  label: string;
  formatted: string;
  source?: string;
  error?: boolean;
}

export interface TravelTimeData {
  first: { transit: TravelResult[]; driving: TravelResult[] };
  second: { transit: TravelResult[]; driving: TravelResult[] } | null;
}
