// 공유 결과 페이지 — mint_share_snapshots.payload 계약 (Home이 쓰고 SharedResult가 읽는다)

export interface VoteCandidate {
  n: string;
  c?: string;
  s?: number | null;
}

export interface SlimPlace {
  placeName: string;
  category?: string;
  description?: string;
  priceRange?: string;
  vibeTags?: string[];
  address?: string;
  area?: string;
  congestionLevel?: string | null;
  lat?: number | null;
  lng?: number | null;
  imageUrl?: string | null;
  kakaoPlaceUrl?: string | null;
  kakaoPlaceId?: string;
  shareSlot?: SlotRef;       // 공유·그룹 화면에서 회원 찜(wish_from_slot)에 쓴다
}

// 남의 추천 슬롯을 내 찜으로 — 그 슬롯을 보여준 공유 링크나 그룹 세션이 근거
export interface SlotRef {
  slotId: number;
  shareId?: string;
  sessionId?: string;
}

export interface SnapshotPayload {
  first: SlimPlace;
  second?: SlimPlace | null;
  third?: SlimPlace | null;
  thirdLabel?: string | null;
  purposeFirst?: string | null;
  purposeSecond?: string | null;
  areaName?: string | null;
  treasurer?: string | null;
  shareId?: string;
  candidates?: VoteCandidate[];
}
