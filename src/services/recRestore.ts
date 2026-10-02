import { supabase } from '@/services/supabase';
import { restorePlaces, slotSource, type ConditionRow, type SlotRow } from '@/services/memberData';
import { kakaoPlaceLink, type RestoredPlace } from '@/services/restore';
import type { GroupResult, GroupResultPlace } from '@/types';
import { walkingMinutes } from '@/utils/geo';

// 공유 링크·그룹 결과·새로고침에서 저장된 추천을 다시 그린다(010).
// 서버(/api/restore)는 조건 일부와 슬롯만 주고, 가게 이름·주소는 여기서 카카오 재검색으로 찾는다.

export interface RecPayload {
  recommendationId: number;
  ownerIsMember: boolean;
  condition: {
    id: number;
    mode: string; group_size: string; first_purpose: string; second_purpose: string | null;
    area_type: 'auto' | 'region' | 'preset'; area_label: string; area_query: string | null;
  };
  slots: SlotRow[];
  center: { lat: number; lng: number } | null;
  // 공유·그룹: 서버가 재검색해 준 가게(슬롯 ID → 가게). 있으면 앱은 카카오를 다시 부르지 않는다.
  places?: Record<string, { name: string; category: string; address: string; lat: number; lng: number; url: string } | null>;
}

export type RecRequest =
  | { kind: 'share'; id: string }
  | { kind: 'session'; id: string }
  | { kind: 'own'; recommendationId: number; claimToken?: string };

export class RecRestoreError extends Error {
  status: number;
  expired: boolean;
  constructor(status: number, expired = false) {
    super(`restore ${status}`);
    this.status = status;
    this.expired = expired;
  }
}

export async function fetchRecPayload(req: RecRequest): Promise<RecPayload> {
  const token = req.kind === 'own' ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
  const res = await fetch('/api/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(req),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new RecRestoreError(res.status, !!data?.expired);
  return data as RecPayload;
}

// 슬롯 ID → 복원된 가게(못 찾으면 null)
export async function restoreRecPayload(p: RecPayload): Promise<Map<number, RestoredPlace | null>> {
  if (p.places) {
    const out = new Map<number, RestoredPlace | null>();
    for (const s of p.slots) {
      const r = p.places[String(s.id)];
      out.set(s.id, r ? { id: s.kakao_place_id, ...r } : null);
    }
    return out;
  }
  const cond: ConditionRow = {
    id: -p.recommendationId,            // 복원 캐시 키(회원 조건 ID와 겹치지 않게 음수)
    first_purpose: p.condition.first_purpose,
    second_purpose: p.condition.second_purpose,
    group_size: p.condition.group_size,
    created_at: '',
    area_type: p.condition.area_type,
    area_label: p.condition.area_label,
    area_query: p.condition.area_query,
    origins: [],
    search_origin: [],
  };
  const byKey = await restorePlaces(p.slots.map((s) => ({
    key: String(s.id), placeId: s.kakao_place_id, condition: cond, source: slotSource(s), center: p.center,
  })));
  const out = new Map<number, RestoredPlace | null>();
  for (const s of p.slots) out.set(s.id, byKey.get(String(s.id)) ?? null);
  return out;
}

// 화면 순서: 코스(1차→2차), 대표→대안, 순서
export function orderedSlots(slots: SlotRow[]): SlotRow[] {
  const w = (s: SlotRow) => (s.course === 'first' ? 0 : 100) + (s.role === 'main' ? 0 : 10) + s.rank;
  return [...slots].sort((a, b) => w(a) - w(b));
}

// 그룹 게스트 화면용 — 세션에 전달된 추천을 복원해 GroupResult 모양으로. 설명·가격대 같은 모델 문구는 없다.
export async function loadGroupResult(sessionId: string): Promise<{ recommendationId: number; result: GroupResult }> {
  const p = await fetchRecPayload({ kind: 'session', id: sessionId });
  const restored = await restoreRecPayload(p);
  const slots = orderedSlots(p.slots);
  const toPlace = (s: SlotRow | undefined): GroupResultPlace | null => {
    if (!s) return null;
    const r = restored.get(s.id);
    return {
      placeName: r?.name ?? '가게 정보를 다시 찾지 못했어요',
      category: r?.category,
      address: r?.address,
      area: p.condition.area_label,
      lat: r?.lat ?? null,
      lng: r?.lng ?? null,
      kakaoPlaceUrl: r?.url ?? kakaoPlaceLink(s.kakao_place_id),
      kakaoPlaceId: s.kakao_place_id,
      shareSlot: { slotId: s.id, sessionId },
    };
  };
  const first = toPlace(slots.find((s) => s.course === 'first' && s.role === 'main'));
  if (!first) throw new Error('no slots');
  const second = toPlace(slots.find((s) => s.course === 'second' && s.role === 'main'));
  if (second) first.walkingToNext = walkingMinutes(first, second);
  return {
    recommendationId: p.recommendationId,
    result: {
      first,
      second,
      third: null,
      purposeFirst: p.condition.first_purpose,
      purposeSecond: p.condition.second_purpose,
      areaName: p.condition.area_label,
    },
  };
}
