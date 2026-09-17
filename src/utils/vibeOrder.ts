// 취향 칩 정렬 — 목적(코스)별로 관련 칩을 앞으로. 선택 자체는 자유(단순 노출 순서).
import type { PurposeCtx } from '@/types';
import { PURPOSE_CHIP_BOOST, CONDITION_PURPOSE_BOOST, KEYWORD_CHIP_BOOST } from '@/constants/vibeOptions';

function orderByBoost<T extends { key: string }>(options: T[], purpose: PurposeCtx | undefined, boostMap: Record<string, string[]>): T[] {
  const courses = [purpose?.first, purpose?.second].filter((c): c is string => !!c);
  const boost = new Set(courses.flatMap((c) => boostMap[c] ?? []));
  if (boost.size === 0) return options;
  // 안정 정렬 — 부스트된 칩만 앞으로, 그 외는 원래 순서 유지
  return [...options].sort((a, b) => (boost.has(b.key) ? 1 : 0) - (boost.has(a.key) ? 1 : 0));
}
export const orderByPurpose = <T extends { key: string }>(options: T[], purpose?: PurposeCtx) =>
  orderByBoost(options, purpose, PURPOSE_CHIP_BOOST);
export const orderConditionsByPurpose = <T extends { key: string }>(options: T[], purpose?: PurposeCtx) =>
  orderByBoost(options, purpose, CONDITION_PURPOSE_BOOST);

export function orderKeywordsByPurpose(labels: string[], purpose?: PurposeCtx): string[] {
  const courses = [purpose?.first, purpose?.second].filter((c): c is string => !!c);
  const boost = new Set(courses.flatMap((c) => KEYWORD_CHIP_BOOST[c] ?? []));
  if (boost.size === 0) return labels;
  return [...labels].sort((a, b) => (boost.has(b) ? 1 : 0) - (boost.has(a) ? 1 : 0));
}
