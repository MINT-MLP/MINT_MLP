import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findBalancedAreas, areaCoords, type Coordinates } from './midpointCore.js';

// 저장된 추천(008)을 공유·그룹·새로고침 복원에 내줄 때 쓰는 서버 공통 부분.
// 화면에는 조건 일부와 슬롯(장소 ID·검색 호출)만 준다. 출발지는 주지 않는다(준식별 정보) —
// 대신 자동 중간지점이면 서버가 출발지로 검색 중심을 계산해 좌표만 돌려준다(저장하지 않는다).

export interface RecPayload {
  recommendationId: number;
  ownerIsMember: boolean;       // 회원 계정 추천인가(찜 가능). 비회원 추천은 일회용 토큰으로 옮긴 뒤 찜
  condition: {
    id: number;
    mode: string; group_size: string; first_purpose: string; second_purpose: string | null;
    area_type: 'auto' | 'region' | 'preset'; area_label: string; area_query: string | null;
  };
  slots: {
    id: number; course: 'first' | 'second'; role: 'main' | 'alt'; rank: number; kakao_place_id: string;
    search_kind: 'keyword' | 'category'; search_query: string | null; search_page: number; search_radius: number | null;
  }[];
  center: Coordinates | null;   // 본인 추천(own)만. null이면 앱이 지역 검색어로 직접 찾는다(직접 입력 지역)
  // 공유·그룹: 서버가 재검색한 결과(슬롯 ID → 가게). 중심은 출발지 무게중심이라 역산되므로 밖으로 내보내지 않는다.
  places?: Record<number, RestoredPlace | null>;
  // 본인 추천(own)만 — 지난 추천에서 "이 조건으로 다시 추천받기"에 쓰는 나머지 입력. 공유·그룹에는 넣지 않는다(남의 직접 입력).
  detail?: RecDetail;
}

export interface RecDetail {
  createdAt: string;
  relation: string | null; occasion: string | null; budget: string | null;
  firstCategoryPath: string | null; secondCategoryPath: string | null; regionLevel: string | null;
  menus: { course: 'first' | 'second'; ord: number; menu: string }[];
  choices: { course: 'first' | 'second' | 'all'; code: string | null; kind: string | null; label: string }[];
  origins: { query: string; kakaoPlaceId: string }[];
}

export interface RestoredPlace {
  name: string; category: string; address: string; lat: number; lng: number; url: string;
}

export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

// 그룹 호스트인가(012) — 세션 ID는 게스트도 다 갖고 있으므로, 참여자 상세·결과 전달·취소는 비밀값으로 호스트만.
// 비밀값이 없는 세션(012 이전 생성)은 예전처럼 둔다(7일 안에 정리된다). 세션이 없으면 null.
export async function isSessionHost(supabase: SupabaseClient, sid: string, token: unknown): Promise<boolean | null> {
  const { data, error } = await supabase.from('mint_sessions').select('host_token_hash').eq('id', sid).maybeSingle();
  if (error || !data) return null;
  const hash = (data as { host_token_hash: string | null }).host_token_hash;
  if (!hash) return true;
  return typeof token === 'string' && token.length >= 20 && sha256(token) === hash;
}

// 내 추천인가: 회원이면 주인, 비회원이면 저장 때 받은 일회용 토큰(009)
export async function ownsRecommendation(
  supabase: SupabaseClient, recId: number, memberId: string | null, claimToken: unknown,
): Promise<boolean> {
  const { data } = await supabase.from('recommendation').select('user_id, claim_token_hash').eq('id', recId).maybeSingle();
  if (!data) return false;
  const row = data as { user_id: string | null; claim_token_hash: string | null };
  if (row.user_id) return !!memberId && row.user_id === memberId;
  return typeof claimToken === 'string' && claimToken.length >= 20 && !!row.claim_token_hash && sha256(claimToken) === row.claim_token_hash;
}

async function kakaoFind(key: string, query: string, placeId: string): Promise<Coordinates | null> {
  try {
    const r = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=15`, {
      headers: { Authorization: `KakaoAK ${key}` },
    });
    if (!r.ok) return null;
    const d = await r.json() as { documents?: { id: string; x: string; y: string }[] };
    const hit = d.documents?.find((x) => x.id === placeId);
    return hit ? { lat: parseFloat(hit.y), lng: parseFloat(hit.x) } : null;
  } catch {
    return null;
  }
}

// 추천 때와 같은 규칙: 출발지 평균, 상권으로 옮겨졌던 경우(snapHubs)는 area_label 상권 좌표
function centerFrom(coords: Coordinates[], areaLabel: string): Coordinates | null {
  if (coords.length === 0) return areaCoords(areaLabel);
  const b = findBalancedAreas(coords);
  return b.snapHubs && b.snapHubs.length > 0 ? areaCoords(areaLabel) ?? b.midpoint : b.midpoint;
}

// 기록한 카카오 호출을 같은 반경으로 다시 해 같은 ID를 찾는다(앱 restore.ts의 findById와 같은 규칙: 기록 페이지 → 다음 → 이전)
async function findByIdServer(
  key: string, slot: RecPayload['slots'][number], center: Coordinates,
): Promise<RestoredPlace | null> {
  const radius = Math.min(slot.search_radius ?? 3000, 20000);
  const pages = [slot.search_page, slot.search_page + 1, slot.search_page - 1].filter((p) => p >= 1 && p <= 3);
  let lastPage = 3;
  for (const page of pages) {
    if (page > lastPage) continue;
    const base = `x=${center.lng}&y=${center.lat}&radius=${radius}&page=${page}&size=15`;
    const url = slot.search_kind === 'keyword'
      ? `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(slot.search_query ?? '')}&${base}`
      : `https://dapi.kakao.com/v2/local/search/category.json?category_group_code=${encodeURIComponent(slot.search_query ?? '')}&sort=distance&${base}`;
    try {
      const r = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` } });
      if (!r.ok) return null;
      const d = await r.json() as { documents?: { id: string; place_name: string; category_name?: string; road_address_name?: string; address_name?: string; x: string; y: string; place_url: string }[] };
      const docs = d.documents ?? [];
      const hit = docs.find((x) => x.id === slot.kakao_place_id);
      if (hit) {
        const path = (hit.category_name ?? '').split('>').map((t) => t.trim());
        return {
          name: hit.place_name,
          category: path.slice(1, 3).filter(Boolean).join(' > ') || '음식점',
          address: hit.road_address_name || hit.address_name || '',
          lat: parseFloat(hit.y), lng: parseFloat(hit.x), url: hit.place_url,
        };
      }
      if (docs.length < 15) lastPage = page;
    } catch {
      return null;
    }
  }
  return null;
}

// opts.restoreOnServer: 공유·그룹. 중심이 있으면 서버가 가게를 찾아 places로 주고 center는 비운다.
export async function loadRecPayload(
  supabase: SupabaseClient, recId: number, opts: { sessionId?: string; restoreOnServer?: boolean; withDetail?: boolean } = {},
): Promise<RecPayload | null> {
  const { data, error } = await supabase
    .from('recommendation')
    .select(`id, user_id, created_at, condition:search_condition(id, mode, group_size, first_purpose, second_purpose, area_type, area_label, area_query,
      relation, occasion, budget, first_category_path, second_category_path, region_level,
      search_origin(ord, query, kakao_place_id), search_menu(course, ord, menu),
      search_choice(course, custom_text, option:choice_option(code, kind, label))),
      slots:recommendation_slot(id, course, role, rank, kakao_place_id, search_kind, search_query, search_page, search_radius)`)
    .eq('id', recId)
    .maybeSingle();
  if (error || !data) return null;
  type Extra = {
    relation: string | null; occasion: string | null; budget: string | null;
    first_category_path: string | null; second_category_path: string | null; region_level: string | null;
    search_origin: { ord: number; query: string; kakao_place_id: string }[];
    search_menu: { course: 'first' | 'second'; ord: number; menu: string }[];
    search_choice: { course: 'first' | 'second' | 'all'; custom_text: string | null; option: { code: string; kind: string; label: string } | null }[];
  };
  const row = data as unknown as {
    id: number;
    user_id: string | null;
    created_at: string;
    condition: RecPayload['condition'] & Extra;
    slots: RecPayload['slots'];
  };
  const {
    search_origin: origins, search_menu: menus, search_choice: choices,
    relation, occasion, budget, first_category_path, second_category_path, region_level,
    ...condition
  } = row.condition;

  let center: Coordinates | null = null;
  if (condition.area_type === 'preset') {
    center = areaCoords(condition.area_label);
  } else if (condition.area_type === 'auto') {
    let list: { query: string; kakao_place_id: string }[] = [];
    if (opts.sessionId) {
      // 그룹: 참여자 출발지(검색어·장소 ID)로 계산. 호스트가 추천받은 시점까지 제출한 사람만 —
      // 그 뒤에 들어오거나 출발지를 바꾼 사람까지 넣으면 추천 때와 중심이 달라져 가게를 못 찾는다.
      const { data: sess } = await supabase.from('mint_sessions').select('result_at').eq('id', opts.sessionId).maybeSingle();
      const resultAt = (sess as { result_at: string | null } | null)?.result_at ?? null;
      let q = supabase.from('mint_session_members').select('location_query, location_place_id').eq('session_id', opts.sessionId);
      if (resultAt) q = q.lte('submitted_at', resultAt);
      const { data: members } = await q;
      list = ((members ?? []) as { location_query: string | null; location_place_id: string | null }[])
        .filter((m) => m.location_query && m.location_place_id)
        .map((m) => ({ query: m.location_query!, kakao_place_id: m.location_place_id! }));
    } else if (origins?.length) {
      list = [...origins].sort((a, b) => a.ord - b.ord);
    }
    const key = process.env.VITE_KAKAO_REST_API_KEY;
    const found = key && list.length ? await Promise.all(list.map((o) => kakaoFind(key, o.query, o.kakao_place_id))) : [];
    // 하나라도 못 찾으면 그 일부의 중간점은 틀린 값이라 상권 근사로
    const coords = found.length > 0 && found.every(Boolean) ? (found as Coordinates[]) : [];
    center = centerFrom(coords, condition.area_label);
  }

  const slots = row.slots ?? [];
  const detail: RecDetail | undefined = opts.withDetail ? {
    createdAt: row.created_at,
    relation, occasion, budget,
    firstCategoryPath: first_category_path, secondCategoryPath: second_category_path, regionLevel: region_level,
    menus: [...(menus ?? [])].sort((a, b) => a.ord - b.ord),
    choices: (choices ?? [])
      .map((c) => ({ course: c.course, code: c.option?.code ?? null, kind: c.option?.kind ?? null, label: c.option?.label ?? c.custom_text ?? '' }))
      .filter((c) => c.label),
    origins: [...(origins ?? [])].sort((a, b) => a.ord - b.ord).map((o) => ({ query: o.query, kakaoPlaceId: o.kakao_place_id })),
  } : undefined;
  const base = { recommendationId: row.id, ownerIsMember: !!row.user_id, condition, slots, ...(detail ? { detail } : {}) };
  const key = process.env.VITE_KAKAO_REST_API_KEY;
  if (opts.restoreOnServer && center && key) {
    const found = await Promise.all(slots.map(async (sl) => [sl.id, await findByIdServer(key, sl, center!)] as const));
    return { ...base, center: null, places: Object.fromEntries(found) };
  }
  // 공유·그룹인데 서버가 못 찾는 경우(직접 입력 지역)엔 중심이 원래 없다 — 앱이 지역 검색어로 찾는다
  return { ...base, center: opts.restoreOnServer ? null : center };
}
