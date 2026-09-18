// 총무 플랜 가격 프레임(A/B)·사전등록 상태 — 컴포넌트와 분리해 fast-refresh 안전.
import { getDeviceId } from '@/storage/device';

export type PlanFrame = 'monthly' | 'perhead';
const FRAME_KEY = 'mint_plan_frame';
const PREREG_KEY = 'mint_plan_preregistered';

// 기기별 프레임 배정(50/50, 재방문 일관성) — device_id 마지막 문자 코드 짝/홀
export function getPlanFrame(): PlanFrame {
  try {
    const saved = localStorage.getItem(FRAME_KEY);
    if (saved === 'monthly' || saved === 'perhead') return saved;
    const id = getDeviceId();
    const code = id.charCodeAt(id.length - 1) || 0;
    const frame: PlanFrame = code % 2 === 0 ? 'monthly' : 'perhead';
    localStorage.setItem(FRAME_KEY, frame);
    return frame;
  } catch {
    return 'monthly';
  }
}

export function isPreregistered(): boolean {
  try { return localStorage.getItem(PREREG_KEY) === '1'; } catch { return false; }
}

export function markPreregistered(): void {
  try { localStorage.setItem(PREREG_KEY, '1'); } catch { /* ignore */ }
}

// 배너/CTA에 쓰는 짧은 가격 문구
export function planPriceLabel(frame: PlanFrame): string {
  return frame === 'monthly' ? '월 4,900원' : '인당 약 600원';
}
