// 로컬 추천 기록 (localStorage)

export interface ResultSummary {
  placeName: string;
  secondPlaceName: string | null;
  areaName: string | null;
}

export interface HistoryEntry {
  savedAt: number;
  placeName: string;
  secondPlaceName?: string | null;
  areaName?: string | null;
  purposeFirst?: string | null;
  snapshot: unknown;
}
