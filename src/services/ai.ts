import type { AreaCongestion } from '@/services/seoulData';
import type { Coordinates, UserInput, PlaceRecommendation, WeatherSummary, RecommendationResult, RegionScope, PlaceEnrichment, RecommendSaveMeta } from '@/types';
import { supabase } from '@/services/supabase';

// 행정단위 스코프 — 시/구/동 단위로 추천 범위를 고정 (있을 때만 전송)

export async function getAIRecommendation(
  input: UserInput,
  midpoint: Coordinates,
  congestionData: AreaCongestion[],
  excludeNames: string[] = [],
  areas: string[] = [],
  regionScope: RegionScope | null = null,
  sessionKey: string | null = null,
  save: RecommendSaveMeta | null = null,
): Promise<RecommendationResult> {
  // 회원이면 토큰을 실어 보낸다 — 서버가 추천 기록을 계정에 저장한다(비회원은 식별자 없는 통계로만)
  // getSession은 만료된 토큰이면 갱신해서 준다(모바일 복귀 직후 오래된 토큰으로 비회원 저장되는 것 방지)
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const res = await fetch('/api/recommend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    // areas를 보내면 혼잡도는 서버가 네이버 검색과 병렬로 조회 (클라이언트 왕복 1회 절감)
    // sessionKey: 같은 탐색 에피소드(초기→재시도→선택)를 recommendation_log·events에서 조인하기 위한 키
    body: JSON.stringify({ input, midpoint, congestionData, excludeNames, areas, ...(regionScope ? { regionScope } : {}), ...(sessionKey ? { sessionKey } : {}), ...(save ? { save } : {}) }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `AI 추천 요청 실패 (${res.status})`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  // API returns { places, weather, _debug } or legacy plain array
  const places = Array.isArray(data) ? data : (data.places ?? [data]);
  if (data._debug) console.log('[recommend] debug', data._debug);
  return {
    places: places as PlaceRecommendation[],
    weather: (data.weather ?? null) as WeatherSummary | null,
    // 구버전 서버 응답이면 undefined → null 처리(배포 스큐 안전)
    thirdStop: (data.thirdStop ?? null) as PlaceRecommendation | null,
    thirdLabel: (data.thirdLabel ?? null) as string | null,
    serial: (data.serial ?? null) as string | null,
    courses: data.courses === 1 || data.courses === 2 ? data.courses : null,
    recommendationId: typeof data.recommendationId === 'number' ? data.recommendationId : null,
  };
}

// 결과 표시 후 사진·카카오URL을 채우는 후처리 호출 (초기 로딩을 앞당기려 분리)

export async function enrichPlaces(
  places: { placeName: string; lat?: number; lng?: number; area?: string; category?: string }[],
): Promise<PlaceEnrichment[]> {
  try {
    const payload = places
      .filter((p) => p.placeName && p.lat && p.lng)
      .map((p) => ({ placeName: p.placeName, lat: p.lat, lng: p.lng, area: p.area, category: p.category }));
    if (payload.length === 0) return [];
    const res = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'enrich', places: payload }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.enriched) ? (data.enriched as PlaceEnrichment[]) : [];
  } catch {
    return [];
  }
}
