import type { VibeState } from '@/types';

// 구버전 저장값({first: string|null, second: string|null})을 배열로 승격한다.
// 로컬에 남은 초안·결과 스냅샷이 새 코드에서 깨지지 않게, vibe를 로컬에서 읽는 지점은 전부 이걸 거친다.
export function migrateVibeState(raw: unknown): VibeState {
  if (!raw || typeof raw !== 'object') return {};
  const toArray = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
    if (typeof v === 'string') return [v];
    return [];
  };
  const result: VibeState = {};
  for (const [groupLabel, g] of Object.entries(raw as Record<string, unknown>)) {
    if (!g || typeof g !== 'object') continue;
    const { first, second } = g as { first?: unknown; second?: unknown };
    result[groupLabel] = { first: toArray(first), second: toArray(second) };
  }
  return result;
}
