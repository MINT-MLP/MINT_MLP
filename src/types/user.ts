// 로그인 사용자 활동 기록 (mint_activity_log)

export interface ActivityPayload {
  placeName: string;
  secondPlaceName?: string | null;
  areaName?: string | null;
  purposeFirst?: string | null;
  groupSize?: string | null;
}

export interface ActivityRow {
  id: number;
  place_name: string | null;
  second_place_name: string | null;
  area_name: string | null;
  purpose_first: string | null;
  group_size: string | null;
  created_at: string;
  source: string | null;
}
