import type { LocationEntry } from '@/types';

// 오늘의 총무 — 출발지를 한 곳도 안 적은 경우(지역 직접 선택 모드)엔 뽑을 지명이 없다.
// 그래도 '오늘의 총무' 버튼은 눌리는 버튼이어야 하므로, 데이터 없이도 성립하는 공정 규칙을 대신 뽑는다.
const TREASURER_RULES = [
  '가장 늦게 도착한 분이',
  '가위바위보에서 진 분이',
  '생일이 가장 빠른 분이',
  '오늘 제일 배고픈 분이',
  '이 링크를 처음 연 분이',
];

export function rollTreasurerRule(prev?: string): string {
  const pool = TREASURER_RULES.filter((r) => r !== prev);
  return pool[Math.floor(Math.random() * pool.length)];
}

// 이름이 있는 출발지 중 하나를 무작위로 — 같은 지명이 여러 번 나와도 후보엔 한 번만 넣는다
// (두 명이 같은 역에서 출발한다고 그 지명이 두 배로 당첨될 이유는 없다).
export function pickTreasurer(locs: LocationEntry[]): string | null {
  const named = [...new Set(locs.map((l) => l.name?.trim()).filter((n): n is string => !!n))];
  if (named.length === 0) return null;
  return named[Math.floor(Math.random() * named.length)];
}
