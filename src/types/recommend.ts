// 추천 플로우 — 입력(사용자 선택)부터 결과(장소)까지의 도메인 타입
import type { Coordinates, RegionLevel } from '@/types/geo';

// ── 입력 ──────────────────────────────────────────────────────────────

export interface LocationEntry {
  name: string;
  lat?: number;
  lng?: number;
}

export interface PurposeValue {
  first: string | null;
  firstRaw: '밥' | '술' | '카페' | '기타' | null;
  second: string | null;
  secondRaw: '밥' | '술' | '카페' | '기타' | '없음' | null;
  relation: string | null;
  occasion: string | null;
  // 카테고리 선택(선택사항). 분류 경로 문자열 — "한식", "한식 > 국밥", "술집 > 와인바". 서버가 접두어 일치로 거른다.
  // 메뉴 콕(기타)일 땐 항상 null(세부 메뉴는 first/second에 쉼표로 저장).
  firstGenre?: string | null;
  secondGenre?: string | null;
}

export type GroupVibeState = { first: string[]; second: string[] };
export type VibeState = Record<string, GroupVibeState>;

export interface RegionScopeInfo {
  level: RegionLevel;
  matchTokens: string[];
  searchAreas: string[];
}

export type MeetingLocation =
  | { type: 'auto' }
  // 직접 입력 지역은 실제 좌표(lat/lng) + 행정단위 스코프(scope)를 담아 그 시/구/동 범위로 추천된다.
  // 프리셋 지역(regionId 있음)은 좌표가 서비스(PRESET_REGIONS)에 있어 생략 가능.
  | { type: 'manual'; regionId: string; area: string; lat?: number; lng?: number; scope?: RegionScopeInfo };

// ── 서버 요청/응답 계약 (api/recommend.ts와 모양을 맞춘다) ─────────────

export interface UserInput {
  locations: { name: string; coords?: Coordinates }[];
  groupSize: '2명' | '3~4명' | '5명 이상';
  purpose: { first: string; second: string | null; firstGenre?: string | null; secondGenre?: string | null };
  vibe: { first: string[]; second: string[] };
  relation?: string | null;
  occasion?: string | null;
  budget?: string | null;
  vibeWeights?: Record<string, number>;
  keywords?: string[];          // 1차 키워드
  keywordsSecond?: string[];    // 2차 키워드
  excludeFoods?: string[];
}

export interface RegionScope {
  level: 'city' | 'district' | 'dong';
  matchTokens: string[];
  centerLat: number;
  centerLng: number;
}

export interface PlaceRecommendation {
  rank?: number;
  placeName: string;
  category: string;
  description: string;
  priceRange: string;
  vibeTags: string[];
  address: string;
  area: string;
  congestionLevel?: string;
  openingHours?: string;
  kakaoPlaceId?: string;
  kakaoPlaceUrl?: string;
  lat?: number;
  lng?: number;
  nearbySpots?: string[];
  walkingToNext?: number;
  fitScore?: number;
  imageUrl?: string;
}

export interface WeatherSummary {
  description: string;
  temp: number;
  isRainy: boolean;
  isHot: boolean;
  isCold: boolean;
}

export interface RecommendationResult {
  places: PlaceRecommendation[];
  weather: WeatherSummary | null;
  thirdStop?: PlaceRecommendation | null;   // 3차 '이어서 갈 곳' — 서버가 붙여줌(없으면 null)
  thirdLabel?: string | null;               // 3차 성격 라벨(예: '카페·디저트', '술 한잔')
  serial?: string | null;                   // 파일럿 일련번호(내부 조인키, 유저 비노출)
}

export interface PlaceEnrichment {
  placeName: string;
  kakaoPlaceUrl?: string;
  imageUrl?: string;
}

// 스텝2 2층 '특별한 날' 칩 (constants/occasion). occasion: null 은 "평범/그냥".
export interface OccChip { key: string; occasion: string | null; emoji: string; }

// ── 홈 화면 흐름 ───────────────────────────────────────────────────────

export type Step = 0 | 1 | 2 | 3;
export type View = 'steps' | 'result' | 'reserve';
// 'mode-select' = 유형 미선택 상태(step 0), 'solo' = 혼자, 'group' = 다같이(호스트)
export type AppMode = 'mode-select' | 'solo' | 'group';
export type ChangeReason = 'retry' | 'adjust' | 'expensive' | 'far' | 'vibe';

// ── 취향 선택 UI 데이터 ────────────────────────────────────────────────

// 코스 컨텍스트 — 목적(1차/2차)에 따라 칩 노출 순서를 바꿀 때 쓴다
export type PurposeCtx = { first: string | null; second?: string | null };

export interface VibePreset {
  id: string;
  emoji: string;
  title: string;
  desc: string;
  mood: string[];       // '분위기' — 지금 보고 있는 코스에 채운다
  pref: string[];       // '취향' — 상동
  conditions: string[]; // 조건 — 코스 구분이 없어 항상 함께 적용된다
}
