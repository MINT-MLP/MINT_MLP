import type { Coordinates, KakaoPlace, RegionSuggestion, SearchSource } from '@/types';

// 저장된 장소 ID를 화면에 다시 그리기 위한 복원. 카카오에는 ID 단건 조회가 없어서,
// 추천 때와 같은 검색을 다시 해 ID가 같은 가게를 찾는다. 찾은 이름·주소·좌표는 화면에만 쓰고 저장하지 않는다.
// 검색 중심은 저장하지 않았으므로 조건(지역 방식·이름·검색어, 출발지 검색어·ID)에서 다시 계산한다.

export interface StoredCondition {
  area_type: 'auto' | 'region' | 'preset';
  area_label: string;
  area_query: string | null;
  origins: { ord: number; query: string; kakao_place_id: string }[];
}

export interface RestoredPlace {
  id: string;
  name: string;
  category: string;
  address: string;
  lat: number;
  lng: number;
  url: string;
}

export interface RestoreDeps {
  searchPage: (kind: SearchSource['kind'], query: string, opts: { x: number; y: number; radius: number; page: number }) => Promise<KakaoPlace[]>;
  searchKeyword: (q: string) => Promise<KakaoPlace[]>;
  searchRegions: (q: string) => Promise<RegionSuggestion[]>;
  areaCoords: (name: string) => Coordinates | null;
  balance: (departures: Coordinates[]) => { midpoint: Coordinates; snapHubs?: unknown[] };
}

// 검색 중심. 못 찾으면 null(그 조건의 장소는 링크로만 보여준다)
export async function resolveCenter(cond: StoredCondition, deps: RestoreDeps): Promise<Coordinates | null> {
  if (cond.area_type === 'preset') return deps.areaCoords(cond.area_label);

  if (cond.area_type === 'region') {
    try {
      const list = await deps.searchRegions(cond.area_query || cond.area_label);
      // 라벨이 다르면 다른 지역이다 — 엉뚱한 중심으로 찾느니 못 찾음으로 둔다
      const hit = list.find((s) => s.label === cond.area_label);
      return hit ? { lat: hit.lat, lng: hit.lng } : null;
    } catch {
      return null;
    }
  }

  // 자동 중간지점: 출발지를 검색어로 다시 찾아 추천 때와 같은 계산을 한다.
  // 상권으로 옮겨졌던 경우(snapHubs)는 대중교통 비교로 고른 상권이 area_label에 남아 있다.
  const origins = [...cond.origins].sort((a, b) => a.ord - b.ord);
  if (origins.length > 0) {
    const coords: Coordinates[] = [];
    for (const o of origins) {
      try {
        const found = (await deps.searchKeyword(o.query)).find((p) => p.id === o.kakao_place_id);
        if (found) coords.push({ lat: parseFloat(found.y), lng: parseFloat(found.x) });
      } catch { /* 한 곳 실패는 아래 판정에서 걸러진다 */ }
    }
    if (coords.length === origins.length) {
      const b = deps.balance(coords);
      if (b.snapHubs && b.snapHubs.length > 0) return deps.areaCoords(cond.area_label) ?? b.midpoint;
      return b.midpoint;
    }
  }
  // 그룹 모드(출발지 미저장)·출발지 복원 실패 — 상권 좌표로 근사
  return deps.areaCoords(cond.area_label);
}

const MAX_PAGE = 3;   // 카카오 로컬은 size 15 × 3페이지(45건)까지

// 기록한 페이지에서 먼저 찾고, 새 가게가 생겨 밀렸을 수 있으니 앞뒤 페이지를 한 번씩 더 본다.
export async function findById(
  placeId: string,
  src: SearchSource,
  center: Coordinates,
  deps: Pick<RestoreDeps, 'searchPage'>,
): Promise<RestoredPlace | null> {
  const pages = [src.page, src.page + 1, src.page - 1].filter((p) => p >= 1 && p <= MAX_PAGE);
  let lastPage = MAX_PAGE;
  for (const page of pages) {
    if (page > lastPage) continue;
    const docs = await deps.searchPage(src.kind, src.query, { x: center.lng, y: center.lat, radius: src.radius, page });
    const d = docs.find((x) => x.id === placeId);
    if (d) {
      const path = (d.category_name ?? '').split('>').map((s) => s.trim());
      return {
        id: d.id,
        name: d.place_name,
        category: path.slice(1, 3).filter(Boolean).join(' > ') || '음식점',
        address: d.road_address_name || d.address_name,
        lat: parseFloat(d.y),
        lng: parseFloat(d.x),
        url: d.place_url,
      };
    }
    if (docs.length < 15) lastPage = page;   // 이 페이지가 마지막이다
  }
  return null;
}

export function kakaoPlaceLink(placeId: string): string {
  return `https://place.map.kakao.com/${encodeURIComponent(placeId)}`;
}

// 앱에서 쓰는 실제 의존성. 테스트는 가짜를 넘긴다.
export async function defaultRestoreDeps(): Promise<RestoreDeps> {
  const [{ searchKakaoPage, searchKakaoKeyword, searchRegions }, { areaCoords, findBalancedAreas }] = await Promise.all([
    import('@/services/kakaoMap'),
    import('@/services/midpoint'),
  ]);
  return {
    searchPage: searchKakaoPage,
    searchKeyword: (q) => searchKakaoKeyword(q, { size: 15 }),
    searchRegions,
    areaCoords,
    balance: (d) => findBalancedAreas(d),
  };
}
