// 골목 쿠폰 알림 신청(가짜 문) — 포인트 차감 없이 "원한다"는 신호만 기기에 남긴다.
// 포인트 잔액(mint_points_balance)은 절대 건드리지 않는다.

const NOTIFY_KEY = 'mint_coupon_notify_v1';

export function getNotifyList(): string[] {
  try {
    const raw = localStorage.getItem(NOTIFY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function isNotifyRequested(id: string): boolean {
  return getNotifyList().includes(id);
}

// 토글 후 갱신된 목록과 결과 상태를 반환
export function toggleNotify(id: string): { list: string[]; applied: boolean } {
  const list = getNotifyList();
  const applied = !list.includes(id);
  const next = applied ? [id, ...list] : list.filter((v) => v !== id);
  try {
    localStorage.setItem(NOTIFY_KEY, JSON.stringify(next));
  } catch { /* 저장 실패는 무시 — events 로그가 원장 */ }
  return { list: next, applied };
}
