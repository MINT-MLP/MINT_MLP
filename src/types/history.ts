// 폰에 두는 결과 스냅샷(새로고침·앱 전환 복원용). 카카오 가게 정보·좌표·모델 문구는 넣지 않는다 —
// 저장된 추천 ID로 서버에서 슬롯을 받아 재검색으로 다시 그린다(10-01).
import type { MeetingLocation, PurposeValue, WeatherSummary, VibeState } from '@/types/recommend';

export interface ResultSummary {
  title: string;              // "성수에서 밥 → 술"
  areaName: string | null;
}

export interface ResultSnapshotV2 {
  v: 2;
  recommendationId: number;
  claimToken?: string;        // 비회원 추천이면 복원·공유 권한 확인용
  resultSecondMissing: boolean;
  purpose?: PurposeValue;
  vibe?: VibeState;
  keywords?: string[];
  conditions?: string[];
  meetingLocation?: MeetingLocation;   // 좌표 없이(복원 때 다시 계산)
  areaName: string;
  nearestAreas: string[];
  resultWeather?: WeatherSummary | null;
  sessionId?: string | null;
}
