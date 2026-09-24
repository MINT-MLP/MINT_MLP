// 추천 경로(recommend-search)가 쓰는 공용 조각. 옛 네이버 파이프라인(recommend.ts)에서 옮겨 왔다.

export interface FinalistPlace extends Record<string, unknown> {
  purposeSlot?: number;
  sourceIndex?: number;
  placeName: string;
  category?: string;
  description?: string;
  priceRange?: string;
  vibeTags?: string[];
  address: string;
  area?: string;
  fitScore?: number;
  finalScore?: number;
  rank?: number;
  lat?: number;
  lng?: number;
  kakaoPlaceUrl?: string;
  walkingToNext?: number;
}

export function distKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function walkingMinutes(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return Math.round((distKm(lat1, lng1, lat2, lng2) / 4) * 60);
}

export interface RegionScope {
  level: 'city' | 'district' | 'dong';
  matchTokens: string[];   // 결과 주소에 모두 포함돼야 하는 행정 토큰 (예: ['인천','미추홀구'])
  centerLat: number;
  centerLng: number;
}

// 주소에서 구/군 토큰 추출 (시 전체 추천 시 '구 골고루' 분산용)
function guOfAddress(address: string): string {
  const t = (address || '').trim().split(/\s+/).find((tok) => /(구|군)$/.test(tok));
  return t ?? '';
}

// 시 전체 추천 시 구/군이 한쪽에 쏠리지 않게 골고루 섞는다(점수순 유지하며 라운드로빈).
export function spreadByGu<T extends { address: string }>(sorted: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const p of sorted) {
    const gu = guOfAddress(p.address) || '__none__';
    if (!groups.has(gu)) groups.set(gu, []);
    groups.get(gu)!.push(p);
  }
  if (groups.size <= 1) return sorted;
  const buckets = [...groups.values()];
  const out: T[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const b of buckets) {
      const next = b.shift();
      if (next) { out.push(next); added = true; }
    }
  }
  return out;
}

// 시 전체 2코스: 대표 1차·2차(rank1·rank2)가 걸어서 이어지는 한 쌍이 되도록 선택.
// (시 전체는 구 골고루 분산 탓에 1차·2차가 먼 구로 갈라져 코스가 비현실적이 되던 걸 교정)
const PAIR_MAX_KM = 2.0;        // 하드캡(도보 ~30분 / 택시 기본요금 거리)
const PAIR_WALK_PENALTY = 0.5;  // 점(0~110 스케일)/도보 1분
const PAIR_SCORE_FLOOR = 15;    // 1패스: 각 슬롯 최고점 대비 허용 하락폭

export function pickClosePrimaryPair(
  first: FinalistPlace[], second: FinalistPlace[], numScore: (p: FinalistPlace) => number,
): { f: FinalistPlace; s: FinalistPlace } | null {
  const ok = (p: FinalistPlace) =>
    typeof p.lat === 'number' && typeof p.lng === 'number' && p.lat !== 0 && p.lng !== 0;
  const topF = first.length ? Math.max(...first.map(numScore)) : 0;
  const topS = second.length ? Math.max(...second.map(numScore)) : 0;

  const scan = (applyFloor: boolean) => {
    let best: { f: FinalistPlace; s: FinalistPlace; obj: number; km: number } | null = null;
    for (const f of first) {
      if (!ok(f)) continue;
      if (applyFloor && numScore(f) < topF - PAIR_SCORE_FLOOR) continue;
      for (const s of second) {
        if (!ok(s)) continue;
        if (applyFloor && numScore(s) < topS - PAIR_SCORE_FLOOR) continue;
        // 같은 가게가 1차·2차 양쪽 후보에 있을 수 있음(예: 술↔술) — 자기 자신 쌍 금지
        if (f.placeName === s.placeName && f.address === s.address) continue;
        const km = distKm(f.lat as number, f.lng as number, s.lat as number, s.lng as number);
        if (km > PAIR_MAX_KM) continue;
        const obj = numScore(f) + numScore(s) - PAIR_WALK_PENALTY * (km / 4) * 60;
        if (!best || obj > best.obj
            || (obj === best.obj && (km < best.km
            || (km === best.km && numScore(f) > numScore(best.f))))) {
          best = { f, s, obj, km };
        }
      }
    }
    return best;
  };

  // 1패스: 품질 하한 적용 → 2패스: 하한 해제. 둘 다 없으면 2km 내 쌍 없음 → null(폴백).
  const hit = scan(true) ?? scan(false);
  return hit ? { f: hit.f, s: hit.s } : null;
}

// 목적별 카카오 키워드 검색어. 카테고리 칩을 고르지 않았을 때 앞쪽 몇 개를 쓴다
export const PURPOSE_KEYWORDS: Record<string, string[]> = {
  '밥':    ['맛집', '식당', '한식', '일식당', '고깃집', '파스타', '이탈리안', '삼겹살', '스시', '해산물'],
  // 타깃은 2030 MZ. 단, 특정 유형(포차·소주방=남성/특정문화 편중)에 가중치를 주지 않고 모든 술집 유형을 동등하게 둔다.
  // 여성친화(와인바·칵테일바·하이볼바·루프탑바)와 캐주얼(술집·호프·펍·포차)을 균형 배치 → 실제 차별화는 분위기/모임조건이 결정.
  '술':    ['이자카야', '술집', '와인바', '칵테일바', '하이볼바', '요리주점', '호프', '펍', '루프탑바', '포차'],
  '카페':  ['카페', '커피', '브런치', '디저트', '베이커리', '루프탑카페', '감성카페', '티카페', '핸드드립', '스페셜티'],
  '기타':  ['맛집', '음식점', '식당', '카페', '바', '이자카야', '포차', '브런치', '고깃집', '커피'],
};

// LLM 응답에서 places 배열을 추출한다. 정상이면 JSON.parse 한 방에 되지만,
// max_tokens로 응답이 잘리면 마지막 객체가 불완전해 parse가 실패한다. 그럴 때
// 균형 잡힌 중괄호로 "완전한 객체만" 골라 복구한다(장소 몇 곳이라도 건지는 게 500보다 낫다).
export function extractPlaces(text: string): FinalistPlace[] | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed.places)) return parsed.places as FinalistPlace[];
      if (parsed.placeName) return [parsed as FinalistPlace];
    } catch { /* 잘린 JSON → 아래 부분 복구로 폴백 */ }
  }

  // 부분 복구: "places" 배열 이후 균형 잡힌 최상위 {…} 객체들만 개별 파싱
  const placesIdx = text.indexOf('places');
  const arrStart = placesIdx >= 0 ? text.indexOf('[', placesIdx) : text.indexOf('[');
  if (arrStart < 0) return null;

  const objects: FinalistPlace[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let escaped = false;
  for (let i = arrStart; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try { objects.push(JSON.parse(text.slice(start, i + 1)) as FinalistPlace); } catch { /* 이 조각은 버림 */ }
        start = -1;
      }
    }
  }
  return objects.length ? objects : null;
}

// '조용한 곳' 의도가 어느 통로로 들어왔는지 상관없이 하나로 판정한다.
// 그룹 집계는 분위기 라벨을 승자 하나만 vibe.first에 남기고 나머지는 keywords로 흘려보내므로,
// first만 보면 같은 의도가 통로에 따라 사라진다. 프롬프트가 정반대("활기찬")로 뒤집히는 항목이라
// 판정은 넓게 잡는 쪽이 안전하다 — 조용한 곳을 원했는데 시끄러운 곳을 받는 실패가 훨씬 크다.
export function detectQuiet(...sources: (string[] | undefined)[]): boolean {
  return sources.some((s) => Array.isArray(s) && s.some((v) => typeof v === 'string' && v.includes('조용')));
}
