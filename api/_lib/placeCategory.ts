import { getSupabaseAdmin } from './supabaseAdmin.js';

// 장소 카테고리 분류표(place_category) — 카카오 category_name 경로를 우리 id로 잇는다.
// 런타임엔 카카오 응답의 경로를 이 표에 대고 가장 긴 접두어와 맞는 행을 찾는다.
// 로그에는 카카오 문자열 대신 이 id를 남긴다(우리 데이터라 저장 가능).

export interface PlaceCategoryRow {
  id: number;
  depth1: string;
  depth2: string;
  depth3: string;
  depth4: string;
  is_brand: boolean;
}

interface Cache { rows: PlaceCategoryRow[]; byPath: Map<string, PlaceCategoryRow>; loadedAt: number }
let cache: Cache | null = null;
const TTL_MS = 10 * 60 * 1000;

const key = (d1: string, d2 = '', d3 = '', d4 = '') => [d1, d2, d3, d4].join('|');

export async function loadPlaceCategories(force = false): Promise<Cache | null> {
  if (!force && cache && Date.now() - cache.loadedAt < TTL_MS) return cache;
  const supabase = getSupabaseAdmin();
  if (!supabase) return cache;
  try {
    const { data, error } = await supabase
      .from('place_category')
      .select('id, depth1, depth2, depth3, depth4, is_brand')
      .limit(5000);
    if (error) throw error;
    const rows = (data ?? []) as PlaceCategoryRow[];
    const byPath = new Map(rows.map((r) => [key(r.depth1, r.depth2, r.depth3, r.depth4), r]));
    cache = { rows, byPath, loadedAt: Date.now() };
    return cache;
  } catch (e) {
    console.error('[placeCategory] load failed', e);
    return cache;
  }
}

// 경로(['음식점','한식','국밥','가마솥순대국밥'])에 가장 길게 맞는 행. 브랜드 행(4단계 상호)은 건너뛰고
// 그 위 단계로 올라간다 — 로그에는 업종이 남아야지 상호가 남으면 안 된다.
export function matchCategory(c: Cache | null, path: string[]): PlaceCategoryRow | null {
  if (!c) return null;
  const p = [path[0] ?? '', path[1] ?? '', path[2] ?? '', path[3] ?? ''];
  for (let depth = 4; depth >= 1; depth--) {
    const row = c.byPath.get(key(p[0], depth >= 2 ? p[1] : '', depth >= 3 ? p[2] : '', depth >= 4 ? p[3] : ''));
    if (row && !row.is_brand) return row;
  }
  return null;
}
