// 찜 (localStorage)

export interface WishItem {
  place_key: string;
  place_name: string;
  address: string;
  category: string;
  lat: number | null;
  lng: number | null;
  saved_at: string; // ISO
}

export interface WishTargetInput {
  placeName?: string;
  address?: string;
  area?: string;
  category?: string;
  lat?: number | null;
  lng?: number | null;
}
