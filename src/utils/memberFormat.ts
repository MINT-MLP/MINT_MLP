import { navigateApp } from '@/utils/appRoute';

// 회원 기록(찜·지난 추천) 화면들이 같이 쓰는 표기·이동
export function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

export function purposeLabel(c: { first_purpose: string; second_purpose: string | null }): string {
  return c.second_purpose ? `${c.first_purpose} → ${c.second_purpose}` : c.first_purpose;
}

// 지난 추천을 결과 화면으로 연다 — 지금 결과와 구분되게 &from=history
export function openPastResult(id: number): void {
  navigateApp(`/app/result?id=${id}&from=history`);
}
