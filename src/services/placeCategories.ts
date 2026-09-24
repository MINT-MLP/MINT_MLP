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

// ── 선택 화면용 정리 ──
// 카카오 분류 이름 중 사람이 부르는 이름과 다른 것만 바꿔 보여준다. 서버로는 원래 경로를 보낸다.
const DISPLAY_LABEL: Record<string, string> = {
  '일본식주점': '이자카야',
  '실내포장마차': '실내포차',
  '육류,고기': '고깃집',
};
export function categoryLabel(name: string): string {
  return DISPLAY_LABEL[name] ?? name.replace(/,/g, '·');
}

export interface FlatOption { label: string; path: string }

// 술·카페는 단계 없이 한 줄로 고른다("술집 > 와인바", "한식 > 육류,고기" 같은 경로를 그대로 값으로).
const FLAT_ORDER = ['호프,요리주점', '일본식주점', '실내포장마차', '와인바', '칵테일바', '오뎅바', '육류,고기', '커피전문점', '테마카페', '전통찻집'];
export function flatOptions(all: PlaceCategory[], purpose: '술' | '카페'): FlatOption[] {
  const seen = new Set<string>();
  const out: FlatOption[] = [];
  for (const c of categoriesForPurpose(all, purpose)) {
    if (!c.depth3) continue;
    const path = categoryPath(c.depth2, c.depth3);
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ label: categoryLabel(c.depth3), path });
  }
  const rank = (p: string) => { const i = FLAT_ORDER.indexOf(p.split(' > ')[1] ?? ''); return i < 0 ? 99 : i; };
  return out.sort((a, b) => rank(a.path) - rank(b.path));
}

export interface CategorySub { name: string; children: string[] }
export interface CategoryGroup { name: string; subs: CategorySub[] }

// 밥은 대분류 → 세부(→ 그 아래 한 단계 더, 예: 육류·고기 → 삼겹살). 자주 찾는 대분류를 앞에 둔다.
const GROUP_ORDER = ['한식', '일식', '양식', '중식', '아시아음식', '분식', '치킨', '샤브샤브', '뷔페', '샐러드', '철판요리', '패밀리레스토랑', '패스트푸드'];
export const QUICK_GROUPS = ['한식', '일식', '양식', '중식', '아시아음식', '분식'];
export function riceGroups(all: PlaceCategory[]): CategoryGroup[] {
  const map = new Map<string, Map<string, Set<string>>>();
  for (const c of categoriesForPurpose(all, '밥')) {
    if (!map.has(c.depth2)) map.set(c.depth2, new Map());
    const subs = map.get(c.depth2)!;
    if (!c.depth3) continue;
    if (!subs.has(c.depth3)) subs.set(c.depth3, new Set());
    if (c.depth4) subs.get(c.depth3)!.add(c.depth4);
  }
  const rank = (n: string) => { const i = GROUP_ORDER.indexOf(n); return i < 0 ? 99 : i; };
  return [...map.entries()]
    .map(([name, subs]) => ({ name, subs: [...subs.entries()].map(([n, ch]) => ({ name: n, children: [...ch] })) }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, 'ko'));
}
