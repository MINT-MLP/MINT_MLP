// 좌표·지역·카카오 장소 — 위치를 다루는 모든 모듈의 공통 어휘

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface PresetRegion {
  id: string;
  label: string;
  sublabel: string;
  midpoint: Coordinates;
}

// 카카오 로컬 API 응답 원형 (x=lng, y=lat, 문자열)
export interface KakaoPlace {
  id: string;
  place_name: string;
  category_name: string;
  address_name: string;
  road_address_name: string;
  phone: string;
  place_url: string;
  x: string;
  y: string;
}

export interface Neighborhood {
  area: string;   // "대구 수성구 대흥동" 형태 (시 구 동)
  lat: number;
  lng: number;
}

export type RegionLevel = 'city' | 'district' | 'dong';

export interface RegionSuggestion {
  level: RegionLevel;
  kind?: 'region' | 'hotplace' | 'station'; // UI 배지용
  label: string;
  query: string;
  sido: string;
  gu?: string;
  dong?: string;
  matchTokens: string[];// 결과 주소에 모두 포함돼야 하는 행정 토큰 (추천 범위 고정용)
  searchAreas: string[];// 네이버 검색 프리픽스
  lat: number;
  lng: number;
}

// 전국 핫플레이스(상권·랜드마크) 시드 (constants/hotplaces) — 구/시 안 쳐도 이름만으로 자동완성되게 하는 데이터.
// matchTokens는 결과 주소를 걸러낼 '울타리'(보통 구 1개, substring 매칭이라 짧을수록 안전).
// searchAreas는 네이버 검색 프리픽스(좁은 상권명일수록 정확).
export interface Hotplace {
  name: string;         // 대표 표시명 (예: '홍대')
  aliases: string[];    // 추가 입력 트리거 (예: '홍대입구','홍익대')
  city: string;         // 시/도 짧은표기 (예: '서울')
  labelSuffix: string;  // 라벨 꼬리표 (예: '서울 마포구')
  matchTokens: string[];
  searchAreas: string[];
  lat: number;
  lng: number;
}

export interface MapPin {
  lat: number;
  lng: number;
  name: string;
  kind: 'first' | 'second' | 'third' | 'alt';
}
