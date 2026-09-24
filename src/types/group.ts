// 그룹 약속 — 세션 참여자와 호스트→게스트 결과 전달 계약

// mint_session_members 행 (서버 응답 모양)
export interface GroupMember {
  member_name: string;
  location_name: string | null;
  // 임의 지역 모드 게스트는 출발지를 입력하지 않으므로 좌표가 null일 수 있다
  location_lat: number | null;
  location_lng: number | null;
  purpose_first?: string | null;
  purpose_second?: string | null;
  vibe_atmosphere: string | null;
  vibe_budget: string | null;
  vibe_keywords?: string[];
}

// mint_sessions.result_json — 호스트(Home)가 쓰고 게스트(MemberInput)가 읽는다
export interface GroupResultPlace {
  placeName: string; category?: string; description?: string; priceRange?: string;
  address?: string; area?: string; lat?: number | null; lng?: number | null; kakaoPlaceUrl?: string | null;
  imageUrl?: string | null; vibeTags?: string[]; fitScore?: number | null;
  openingHours?: string | null; walkingToNext?: number | null; congestionLevel?: string | null;
}

export interface GroupResult {
  first: GroupResultPlace; second?: GroupResultPlace | null; third?: GroupResultPlace | null;
  thirdLabel?: string | null; purposeFirst?: string | null; purposeSecond?: string | null; areaName?: string | null;
  treasurer?: string | null;
  weather?: { description: string; temp: number; isRainy: boolean } | null;
}

// 게스트가 입력 단계에서 들고 다니는 자기 응답
export interface GuestCtx {
  locName: string | null;
  locLat: number | null;
  locLng: number | null;
  chips: string[];
  budget: string | null;
}
