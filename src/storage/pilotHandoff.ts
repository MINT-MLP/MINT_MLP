import type { CoursePick, PilotConditions, PilotHandoff } from '@/types';
// 파일럿 핸드오프 — 추천받은 세션(일련번호+조건+추천장소)을 localStorage에 보관.
// 유저는 일련번호를 볼 필요 없이, /pilot에서 "○○집으로 추천받은 거 맞아요?" 자동 감지로 확인한다.

const KEY = 'mint_pilot_handoff_v1';
const TTL = 14 * 24 * 60 * 60 * 1000; // 14일
const MAX = 3;

type MinPlace = { placeName: string; category?: string | null };

// 추천 결과 배열(+3차)을 코스별 상위 3개 픽으로. ResultCard의 코스 분리 규칙과 동일.
export function buildCoursePicks(
  results: MinPlace[],
  hasSecond: boolean,
  third?: MinPlace | null,
): CoursePick[] {
  const picks: CoursePick[] = [];
  const push = (course: string, arr: MinPlace[]) =>
    arr.slice(0, 3).forEach((p, i) => { if (p?.placeName) picks.push({ course, rank: i + 1, placeName: p.placeName, category: p.category ?? null }); });

  if (hasSecond) {
    push('1차', [results[0], ...results.slice(2, 4)].filter(Boolean));
    push('2차', [results[1], ...results.slice(4)].filter(Boolean));
  } else {
    push('1차', results.slice(0, 3));
  }
  if (third?.placeName) picks.push({ course: '3차', rank: 1, placeName: third.placeName, category: third.category ?? null });
  return picks;
}

function read(): PilotHandoff[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const now = Date.now();
    return arr.filter((h): h is PilotHandoff =>
      h && typeof h.serial === 'string' && typeof h.createdAt === 'number' && now - h.createdAt < TTL);
  } catch { return []; }
}

export function savePilotHandoff(h: PilotHandoff): void {
  if (!h.serial) return;
  try {
    const list = read().filter((x) => x.serial !== h.serial);
    list.unshift(h);
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch { /* 저장 실패해도 파일럿은 수동 폴백으로 동작 */ }
}

export function getPilotHandoffs(): PilotHandoff[] {
  return read();
}

export function markPilotHandoffUsed(serial: string): void {
  try {
    const list = read().filter((x) => x.serial !== serial);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch { /* noop */ }
}

// "강남 · 회식 · 밥" 형태의 조건 한 줄 요약
export function summaryLine(c: PilotConditions): string {
  return [c.region, c.relation, c.purpose].filter(Boolean).join(' · ');
}

// 대표 장소명(1차 1순위)
export function topPlaceName(h: PilotHandoff): string {
  const first = h.coursePicks.find((p) => p.course === '1차' && p.rank === 1);
  return first?.placeName ?? h.coursePicks[0]?.placeName ?? '추천 장소';
}

// "오늘 저녁" 같은 상대 시각
export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const h = Math.floor(diff / 3600000);
  if (h < 1) return '방금';
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return `${d}일 전`;
}
