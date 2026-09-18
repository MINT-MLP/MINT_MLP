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
