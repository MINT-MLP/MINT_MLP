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
  // 이 결과를 만든 나머지 입력(조건 수정·다시 뽑기용). 출발지는 검색어·장소 ID만 — 복원 때 다시 찾는다
  origins?: { query: string; kakaoPlaceId: string }[];
  groupSize?: '2명' | '3~4명' | '5명 이상';
  budget?: string | null;
  vibeCustom?: Record<string, string>;
  customOccasion?: string;
  areaName: string;
  nearestAreas: string[];
  resultWeather?: WeatherSummary | null;
  sessionId?: string | null;
}
