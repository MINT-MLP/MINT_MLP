import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

// 추천 자동 저장(v2-schema 008). 카카오 데이터는 장소 ID만. 좌표·이름·점수는 넣지 않는다.
// 검색 코드를 바꿔 같은 조건의 결과가 달라지면 올린다 — 복원이 옛 규칙으로 돌았는지 구분하는 값.
export const SEARCH_VERSION = 1;

// 이 장소 ID를 돌려준 카카오 호출. 복원 때 같은 호출을 다시 해서 ID로 찾는다.
export interface SearchSource {
  kind: 'keyword' | 'category';
  query: string;          // 키워드 검색어 또는 카테고리 그룹 코드(FD6·CE7)
  page: number;
  radius: number;
}

export interface SaveMeta {
  mode?: unknown;
  areaType?: unknown;
  areaLabel?: unknown;
  areaQuery?: unknown;
  regionLevel?: unknown;
  origins?: unknown;
  retriedFromId?: unknown;
  retryReason?: unknown;
}

export interface SlotInput {
  course: 'first' | 'second';
  role: 'main' | 'alt';
  rank: number;
  kakaoPlaceId: string;
  src: SearchSource;
}

const PRESET_PURPOSES = new Set(['밥', '술', '카페']);
const GROUP_SIZES = new Set(['2명', '3~4명', '5명 이상']);
const RELATIONS = new Set(['친구들', '연인', '가족']);
const BUDGETS = new Set(['~2만원', '2~4만원', '4만원+']);
const LEVELS: Record<string, string> = { city: 'si', district: 'gu', dong: 'dong' };

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

function groupSizeOf(v: unknown): string {
  if (typeof v === 'string' && GROUP_SIZES.has(v)) return v;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (!Number.isFinite(n) || n <= 2) return '2명';
  return n <= 4 ? '3~4명' : '5명 이상';
}

function menusOf(p: string | null): string[] {
  if (!p || PRESET_PURPOSES.has(p)) return [];
  return p.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 4).map((s) => s.slice(0, 20));
}

// 요청 본문 → save_recommendation 인자. 값이 허용 목록 밖이면 비우거나 기본값으로(저장 실패로 추천을 막지 않게).
export function buildSavePayload(args: {
  userId: string | null;
  input: Record<string, unknown>;
  save: SaveMeta | undefined;
  areaFallback: string;
  slots: SlotInput[];
}): Record<string, unknown> {
  const { userId, input, save = {}, areaFallback, slots } = args;
  const purpose = (input.purpose ?? {}) as Record<string, unknown>;
  const first = str(purpose.first, 200) ?? '밥';
  const secondRaw = str(purpose.second, 200);
  const second = secondRaw && secondRaw !== '없음' ? secondRaw : null;

  const areaType = save.areaType === 'region' || save.areaType === 'preset' ? save.areaType : 'auto';
  const condition = {
    mode: save.mode === 'group' ? 'group' : 'solo',
    group_size: groupSizeOf(input.groupSize),
    first_purpose: PRESET_PURPOSES.has(first) ? first : '메뉴',
    first_category_path: str(purpose.firstGenre, 120),
    second_purpose: second ? (PRESET_PURPOSES.has(second) ? second : '메뉴') : null,
    second_category_path: second ? str(purpose.secondGenre, 120) : null,
    relation: typeof input.relation === 'string' && RELATIONS.has(input.relation) ? input.relation : null,
    occasion: str(input.occasion, 40),
    budget: typeof input.budget === 'string' && BUDGETS.has(input.budget) ? input.budget : null,
    area_type: areaType,
    area_label: str(save.areaLabel, 60) ?? (areaFallback.slice(0, 60) || '미지정'),
    area_query: areaType === 'region' ? str(save.areaQuery, 60) : null,
    region_level: areaType === 'region' && typeof save.regionLevel === 'string' ? LEVELS[save.regionLevel] ?? null : null,
  };

  const menus = [
    ...menusOf(first).map((menu, i) => ({ course: 'first', ord: i + 1, menu })),
    ...menusOf(second).map((menu, i) => ({ course: 'second', ord: i + 1, menu })),
  ];

  // 그룹 모드의 출발지는 다른 사람 것이라 호스트 계정에 남기지 않는다
  const origins = userId && condition.mode === 'solo' && Array.isArray(save.origins)
    ? (save.origins as unknown[])
        .map((o) => o as Record<string, unknown>)
        .filter((o) => str(o.query, 60) && typeof o.kakaoPlaceId === 'string' && /^\d{1,20}$/.test(o.kakaoPlaceId))
        .slice(0, 6)
        .map((o, i) => ({ ord: i + 1, query: str(o.query, 60), kakao_place_id: o.kakaoPlaceId }))
    : [];

  const vibe = (input.vibe ?? {}) as { first?: unknown; second?: unknown };
  const labels = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const keywords = labels(input.keywords);
  const choices = [
    ...labels(vibe.first).map((label) => ({ course: 'first', label, kind: 'vibe' })),
    ...labels(vibe.second).map((label) => ({ course: 'second', label, kind: 'vibe' })),
    ...keywords.map((label) => ({ course: 'all', label, kind: 'keyword' })),
  ].slice(0, 40);

  const retriedFrom = typeof save.retriedFromId === 'number' && Number.isInteger(save.retriedFromId) ? save.retriedFromId : null;
  const retryReason = save.retryReason === 'expensive' || save.retryReason === 'far' || save.retryReason === 'vibe' ? save.retryReason : null;

  return {
    user_id: userId,
    condition,
    menus,
    origins,
    choices,
    recommendation: { retried_from_id: retriedFrom, retry_reason: retryReason, search_version: SEARCH_VERSION },
    slots: slots.map((s) => ({
      course: s.course, role: s.role, rank: s.rank, kakao_place_id: s.kakaoPlaceId,
      search_kind: s.src.kind, search_query: s.src.query.slice(0, 80), search_page: s.src.page, search_radius: s.src.radius,
    })),
  };
}

// 화면 순서(rank 1~6) → 슬롯. 2코스면 1=1차 대표, 2=2차 대표, 3·4=1차 대안, 5·6=2차 대안. 1코스면 1=대표, 나머지 대안.
export function slotsFromRanks(
  places: { rank?: number; kakaoPlaceId?: string; purposeSlot?: number }[],
  twoCourses: boolean,
  srcOf: (id: string) => SearchSource | undefined,
): SlotInput[] {
  const counters = new Map<string, number>();
  const out: SlotInput[] = [];
  for (const p of [...places].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))) {
    const src = p.kakaoPlaceId ? srcOf(p.kakaoPlaceId) : undefined;
    if (!p.kakaoPlaceId || !src) continue;
    const course: 'first' | 'second' = twoCourses && p.purposeSlot === 2 ? 'second' : 'first';
    const role: 'main' | 'alt' = p.rank === 1 || (twoCourses && p.rank === 2) ? 'main' : 'alt';
    const k = `${course}:${role}`;
    const rank = (counters.get(k) ?? 0) + 1;
    counters.set(k, rank);
    out.push({ course, role, rank, kakaoPlaceId: p.kakaoPlaceId, src });
  }
  return out;
}

// Authorization: Bearer <supabase access token>. 회원(익명 아님)일 때만 id. 검증 실패는 비회원으로 본다.
export async function memberIdFromRequest(
  supabase: SupabaseClient | null,
  authHeader: string | string[] | undefined,
): Promise<string | null> {
  if (!supabase || typeof authHeader !== 'string') return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    const { data, error } = await supabase.auth.getUser(m[1]);
    if (error || !data.user || data.user.is_anonymous) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

export interface SavedRecord {
  conditionId: number;
  recommendationId: number;
  slotIds: number[];
}

// 비회원 추천을 로그인 뒤 계정으로 옮기는 일회용 토큰(009). DB엔 해시만, 원문은 응답으로 그 브라우저에만.
export function newClaimToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString('base64url');
  return { token, hash: createHash('sha256').update(token, 'utf8').digest('hex') };
}

export async function saveRecommendation(
  supabase: SupabaseClient | null,
  payload: Record<string, unknown>,
): Promise<SavedRecord | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('save_recommendation', { p: payload });
    if (error || !data) {
      if (error) console.error('[recommend] save_recommendation failed', error.message);
      return null;
    }
    const d = data as { condition_id: number; recommendation_id: number; slot_ids: number[] };
    return { conditionId: d.condition_id, recommendationId: d.recommendation_id, slotIds: d.slot_ids ?? [] };
  } catch (e) {
    console.error('[recommend] save_recommendation threw', e);
    return null;
  }
}
