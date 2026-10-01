import { supabase } from '@/services/supabase';
import { recordSlotAction } from '@/services/slotAction';
import { useUserStore } from '@/stores/userStore';
import {
  resolveCenter, findById, defaultRestoreDeps, type StoredCondition, type RestoredPlace,
} from '@/services/restore';
import type { PlaceRecord, SearchSource, SlotRef } from '@/types';

// 회원 데이터(v2-schema 004): 지난 추천·찜. 권한은 DB(RLS)가 본인 것만 보여준다.
// 화면에 쓰는 가게 이름·주소는 매번 카카오 재검색으로 복원하고 저장하지 않는다.

export const HISTORY_LIMIT = 20;

export interface ConditionRow extends StoredCondition {
  id: number;
  first_purpose: string;
  second_purpose: string | null;
  group_size: string;
  created_at: string;
  search_origin: StoredCondition['origins'];
}

export interface SlotRow {
  id: number;
  course: 'first' | 'second';
  role: 'main' | 'alt';
  rank: number;
  kakao_place_id: string;
  search_kind: SearchSource['kind'];
  search_query: string | null;
  search_page: number;
  search_radius: number | null;
}

export interface HistoryItem {
  id: number;
  created_at: string;
  condition: ConditionRow;
  slots: SlotRow[];
}

export interface WishRow {
  id: number;
  kakao_place_id: string;
  course: 'first' | 'second';
  search_kind: SearchSource['kind'];
  search_query: string | null;
  search_page: number;
  search_radius: number | null;
  created_at: string;
  condition: ConditionRow;
}

const CONDITION_COLS = 'id, first_purpose, second_purpose, group_size, area_type, area_label, area_query, created_at, search_origin(ord, query, kakao_place_id)';

function userId(): string | null {
  return useUserStore.getState().user?.id ?? null;
}

function toCondition(c: ConditionRow): StoredCondition {
  return { area_type: c.area_type, area_label: c.area_label, area_query: c.area_query, origins: c.search_origin ?? [] };
}

export function slotSource(s: { search_kind: SearchSource['kind']; search_query: string | null; search_page: number; search_radius: number | null }): SearchSource {
  return { kind: s.search_kind, query: s.search_query ?? '', page: s.search_page, radius: s.search_radius ?? 3000 };
}

// 목록 조회는 사용자별로 잠깐 기억한다 — 프로필은 탭 전환마다 다시 마운트된다. 담는 건 우리 DB 행(ID)뿐.
const LIST_TTL_MS = 60_000;
const listCache = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const uid = userId();
  if (!uid) return Promise.resolve([] as unknown as T);
  const k = `${uid}:${key}`;
  const hit = listCache.get(k);
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.value as Promise<T>;
  const value = load().catch((e) => { listCache.delete(k); throw e; });
  listCache.set(k, { at: Date.now(), value });
  return value;
}

// ── 지난 추천 ──
export function fetchHistory(): Promise<HistoryItem[]> {
  return cached('history', loadHistory);
}

async function loadHistory(): Promise<HistoryItem[]> {
  const { data, error } = await supabase
    .from('recommendation')
    .select(`id, created_at, condition:search_condition(${CONDITION_COLS}), slots:recommendation_slot(id, course, role, rank, kakao_place_id, search_kind, search_query, search_page, search_radius)`)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) throw error;
  return (data ?? []) as unknown as HistoryItem[];
}

// ── 찜 ──
// 결과 화면의 하트 여러 개가 같은 조회를 함께 쓴다. 실패는 기억하지 않는다(다음 하트가 다시 시도).
let wishedCache: { user: string; ids: Promise<Set<string>> } | null = null;

export function wishedIds(): Promise<Set<string>> {
  const uid = userId();
  if (!uid) return Promise.resolve(new Set());
  if (wishedCache?.user === uid) return wishedCache.ids;
  const ids = (async () => {
    const { data, error } = await supabase.from('wishlist').select('kakao_place_id');
    if (error) throw error;
    return new Set((data ?? []).map((r: { kakao_place_id: string }) => r.kakao_place_id));
  })();
  wishedCache = { user: uid, ids };
  ids.catch(() => { if (wishedCache?.ids === ids) wishedCache = null; });
  return ids;
}

export function fetchWishlist(): Promise<WishRow[]> {
  return cached('wishlist', loadWishlist);
}

async function loadWishlist(): Promise<WishRow[]> {
  const { data, error } = await supabase
    .from('wishlist')
    .select(`id, kakao_place_id, course, search_kind, search_query, search_page, search_radius, created_at, condition:search_condition(${CONDITION_COLS})`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as WishRow[];
}

export async function addWish(placeId: string, rec: PlaceRecord): Promise<boolean> {
  const uid = userId();
  if (!uid) return false;
  const { error } = await supabase.from('wishlist').insert({
    user_id: uid,
    kakao_place_id: placeId,
    condition_id: rec.conditionId,
    course: rec.course,
    search_kind: rec.search.kind,
    search_query: rec.search.query,
    search_page: rec.search.page,
    search_radius: rec.search.radius,
  });
  // 이미 찜한 곳(unique 위반)은 성공으로 본다
  if (error && error.code !== '23505') return false;
  listCache.delete(`${uid}:wishlist`);
  (await wishedIds().catch(() => null))?.add(placeId);
  recordSlotAction(rec.slotId, 'wish');
  return true;
}

export async function removeWish(placeId: string): Promise<boolean> {
  const uid = userId();
  if (!uid) return false;
  const { error } = await supabase.from('wishlist').delete().eq('user_id', uid).eq('kakao_place_id', placeId);
  if (error) return false;
  listCache.delete(`${uid}:wishlist`);
  (await wishedIds().catch(() => null))?.delete(placeId);
  return true;
}

// 공유·그룹 화면의 가게를 내 찜으로(010 wish_from_slot). 남의 추천이면 서버가 검색 조건을 내 것으로 복사한다.
export async function wishFromSlot(placeId: string, ref: SlotRef): Promise<boolean> {
  const uid = userId();
  if (!uid) return false;
  const { data, error } = await supabase.rpc('wish_from_slot', {
    p_slot: ref.slotId, p_share: ref.shareId ?? null, p_session: ref.sessionId ?? null,
  });
  if (error || data === null) return false;
  listCache.delete(`${uid}:wishlist`);
  (await wishedIds().catch(() => null))?.add(placeId);
  return true;
}

export function clearMemberCache(): void {
  wishedCache = null;
  listCache.clear();
  restoredCache.clear();
}

// ── 비회원 때 받은 추천을 내 계정으로(009) ── 같은 추천의 하트 여럿이 눌려도 한 번만 부른다
const claims = new Map<number, Promise<number | null>>();

export function claimRecommendation(recommendationId: number, token: string): Promise<number | null> {
  const hit = claims.get(recommendationId);
  if (hit) return hit;
  const p = (async () => {
    const { data, error } = await supabase.rpc('claim_recommendation', { p_rec: recommendationId, p_token: token });
    if (!error && typeof data === 'number') return data;
    // 이미 옮긴 추천(새로고침으로 스냅샷의 member가 false로 남은 경우)이면 내 것으로 읽힌다
    const { data: own } = await supabase.from('recommendation').select('condition_id').eq('id', recommendationId).maybeSingle();
    return own ? (own as { condition_id: number }).condition_id : null;
  })();
  claims.set(recommendationId, p);
  p.then((v) => {
    if (v === null) claims.delete(recommendationId);
    else listCache.delete(`${userId()}:history`);
  });
  return p;
}

// ── 복원 ──
// 같은 조건의 중심은 한 번만 계산하고, 카카오 호출은 동시에 몇 개만 보낸다(한도·속도 제한 대비).
// 복원 결과는 이 탭이 열려 있는 동안 메모리에만 둔다 — 저장소(localStorage·DB)에는 넣지 않는다.
const RESTORE_CONCURRENCY = 3;
const restoredCache = new Map<string, RestoredPlace | null>();
const centerCache = new Map<number, Promise<{ lat: number; lng: number } | null>>();

// center: 서버가 계산해 준 검색 중심(공유·그룹의 자동 중간지점). 있으면 조건으로 다시 계산하지 않는다.
export async function restorePlaces(
  items: { key: string; placeId: string; condition: ConditionRow; source: SearchSource; center?: { lat: number; lng: number } | null }[],
): Promise<Map<string, RestoredPlace | null>> {
  const deps = await defaultRestoreDeps();
  const out = new Map<string, RestoredPlace | null>();
  const todo = items.filter((it) => {
    const k = `${it.condition.id}:${it.placeId}`;
    if (restoredCache.has(k)) { out.set(it.key, restoredCache.get(k) ?? null); return false; }
    return true;
  });
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const it = todo[next++];
      if (!centerCache.has(it.condition.id)) {
        centerCache.set(it.condition.id, it.center ? Promise.resolve(it.center) : resolveCenter(toCondition(it.condition), deps));
      }
      const center = await centerCache.get(it.condition.id)!;
      if (!center) centerCache.delete(it.condition.id);   // 중심 실패는 다음에 다시 시도
      // 호출 오류(undefined)는 기억하지 않고, 검색은 됐는데 없던 것(null)만 기억한다
      const r = center ? await findById(it.placeId, it.source, center, deps).catch(() => undefined) : null;
      if (r !== undefined && center) restoredCache.set(`${it.condition.id}:${it.placeId}`, r);
      out.set(it.key, r ?? null);
    }
  };
  await Promise.all(Array.from({ length: Math.min(RESTORE_CONCURRENCY, todo.length) }, worker));
  return out;
}
