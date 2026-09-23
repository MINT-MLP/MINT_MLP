// 장소 카테고리 선택 목록 — 서버의 place_category(비브랜드)를 한 번 받아 모듈에 캐시한다.
export interface PlaceCategory {
  id: number;
  depth2: string;   // 한식 / 술집 / 카페 …
  depth3: string;   // 국밥 / 와인바 / 커피전문점 … ('' 가능)
  depth4: string;   // 게,대게 / 북카페 … ('' 가능)
}

let cache: PlaceCategory[] | null = null;
let inflight: Promise<PlaceCategory[]> | null = null;

export function fetchPlaceCategories(): Promise<PlaceCategory[]> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetch('/api/place-categories')
    .then((r) => (r.ok ? r.json() : { categories: [] }))
    .then((d: { categories?: PlaceCategory[] }) => {
      cache = Array.isArray(d.categories) ? d.categories : [];
      return cache;
    })
    .catch(() => [] as PlaceCategory[])
    .finally(() => { inflight = null; });
  return inflight;
}

// 서버 recommend-search.ts의 목적 판정과 같은 규칙. 여기서 보이는 칩만 골라야 서버에서도 통과한다.
const NOT_MEAL = new Set(['카페', '술집', '간식', '푸드코트', '구내식당', '도시락']);
export function categoriesForPurpose(all: PlaceCategory[], purpose: '밥' | '술' | '카페'): PlaceCategory[] {
  if (purpose === '카페') return all.filter((c) => c.depth2 === '카페');
  if (purpose === '술') return all.filter((c) => c.depth2 === '술집' || (c.depth2 === '한식' && c.depth3 === '육류,고기'));
  return all.filter((c) => !NOT_MEAL.has(c.depth2));
}

// 경로 문자열 — 서버가 접두어 일치로 판정한다. 예: "한식", "한식 > 국밥", "술집 > 와인바"
export function categoryPath(depth2: string, depth3 = '', depth4 = ''): string {
  return [depth2, depth3, depth4].filter(Boolean).join(' > ');
}
