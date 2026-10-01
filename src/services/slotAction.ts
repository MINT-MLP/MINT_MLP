import { supabase } from '@/services/supabase';

// 추천 슬롯에서 일어난 행동(v2-schema 004 slot_action). 회원은 내 추천, 비회원은 통계 추천에만 남는다(권한은 DB가 판정).
// 방문 인증의 "예약하러 가기를 누른 가게만" 조건과 랭킹 학습 신호로 쓴다. 실패는 조용히 넘긴다.
export type SlotActionType = 'map_open' | 'reserve' | 'share' | 'wish';

export function recordSlotAction(slotId: number | null | undefined, action: SlotActionType): void {
  if (!slotId) return;
  void supabase.from('slot_action').insert({ slot_id: slotId, action }).then(() => {}, () => {});
}
