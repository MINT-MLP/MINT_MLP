import type { PurposeValue, VibeState, GroupMember } from '@/types';

// 그룹 모드: 멤버들이 각자 제출한 조건을 하나의 추천 입력으로 집계


// 편식·2차키워드·2차분위기 항목은 DB 스키마 변경 없이 vibe_keywords에 접두사로 실어 보낸다.
export const EXCLUDE_FOOD_PREFIX = '안먹:';
export const SECOND_KEYWORD_PREFIX = '2차:';
export const SECOND_VIBE_PREFIX = '2차분위기:';

/**
 * 멤버별 목록을 한 명씩 돌아가며 뽑아 합친다(라운드로빈).
 *
 * 그냥 flatMap으로 이어 붙이면 순서가 "1번 멤버 전부 → 2번 멤버 전부 → …"가 된다.
 * 그런데 이 배열은 전송 직전에 상한(키워드 10개·편식 8개)으로 잘리기 때문에,
 * 잘려나가는 건 언제나 늦게 제출한 사람이다. 두 명이 각자 편식 5개를 냈으면
 * 두 번째 사람의 알레르기 두 개가 아무 경고 없이 사라진다 — 서버는 그걸
 * "편식·알레르기 하드 제약"이라고 프롬프트에 쓰는데 목록에는 없는 상태가 된다.
 *
 * 한 명씩 번갈아 담으면 상한에 걸려도 모든 멤버가 앞자리를 균등하게 나눠 갖는다.
 */
function roundRobin(perMember: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const max = Math.max(0, ...perMember.map((list) => list.length));
  for (let i = 0; i < max; i++) {
    for (const list of perMember) {
      const v = list[i];
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

// 멤버 키워드에서 1차 키워드·2차 키워드를 분리. 편식(접두사)은 입력 항목이 없어졌지만 예전 세션 값이 키워드로 새지 않게 따로 떼어낸다
export function splitMemberKeywords(members: GroupMember[]): { keywords: string[]; keywordsSecond: string[]; excludeFoods: string[] } {
  const isExclude = (k: string) => k.startsWith(EXCLUDE_FOOD_PREFIX);
  const isSecond = (k: string) => k.startsWith(SECOND_KEYWORD_PREFIX);
  const isSecondVibe = (k: string) => k.startsWith(SECOND_VIBE_PREFIX);
  const byMember = members.map((m) => m.vibe_keywords ?? []);
  const strip = (prefix: string) => (k: string) => k.slice(prefix.length).trim();
  return {
    keywords: roundRobin(byMember.map((ks) => ks.filter((k) => !isExclude(k) && !isSecond(k) && !isSecondVibe(k)))),
    keywordsSecond: roundRobin(byMember.map((ks) => ks.filter(isSecond).map(strip(SECOND_KEYWORD_PREFIX)).filter(Boolean))),
    excludeFoods: roundRobin(byMember.map((ks) => ks.filter(isExclude).map(strip(EXCLUDE_FOOD_PREFIX)).filter(Boolean))),
  };
}

export function aggregatePurpose(members: GroupMember[]): PurposeValue | null {
  const fc: Record<string, number> = {};
  const sc: Record<string, number> = {};
  members.forEach((m) => {
    if (m.purpose_first) fc[m.purpose_first] = (fc[m.purpose_first] || 0) + 1;
    if (m.purpose_second) sc[m.purpose_second] = (sc[m.purpose_second] || 0) + 1;
  });
  const topFirst = Object.entries(fc).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const topSecond = Object.entries(sc).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '없음';
  if (!topFirst) return null;
  const toRaw = (v: string | null): '밥' | '술' | '카페' | '기타' | null =>
    ['밥', '술', '카페'].includes(v ?? '') ? (v as '밥' | '술' | '카페') : v ? '기타' : null;
  return {
    first: topFirst,
    firstRaw: toRaw(topFirst),
    second: topSecond,
    secondRaw: topSecond === '없음' ? '없음' : toRaw(topSecond),
    relation: null,
    occasion: null,
  };
}

export function aggregateVibe(members: GroupMember[]): VibeState {
  const firstCounts: Record<string, number> = {};
  const secondCounts: Record<string, number> = {};
  members.forEach((m) => {
    if (m.vibe_atmosphere) firstCounts[m.vibe_atmosphere] = (firstCounts[m.vibe_atmosphere] || 0) + 1;
    (m.vibe_keywords ?? []).forEach((k) => {
      if (!k.startsWith(SECOND_VIBE_PREFIX)) return;
      const second = k.slice(SECOND_VIBE_PREFIX.length).trim();
      if (second) secondCounts[second] = (secondCounts[second] || 0) + 1;
    });
  });
  // 동점이면 전부 담는다.
  // 예전에는 최다 득표 1개만 남겼는데, Object.entries의 순서가 곧 삽입 순서(=먼저 제출한 사람)라
  // 2명이 서로 다른 분위기를 하나씩 고르면 "먼저 링크를 연 사람"이 이겼다. 유저 눈에는 완전히 임의다.
  // 게다가 분위기를 딱 하나만 고른 멤버는 그게 지면 keywords에도 안 남아 흔적 없이 사라졌다.
  // 동점을 모두 담으면 진 사람의 선택도 프롬프트에 들어간다(타입이 이미 배열이라 그대로 수용된다).
  const topKeys = (counts: Record<string, number>): string[] => {
    const entries = Object.entries(counts);
    if (entries.length === 0) return [];
    const max = Math.max(...entries.map(([, c]) => c));
    return entries.filter(([, c]) => c === max).map(([k]) => k);
  };
  const first = topKeys(firstCounts);
  const second = topKeys(secondCounts);
  if (first.length === 0 && second.length === 0) return {};
  return { 분위기: { first, second } };
}

// 멤버들이 각자 고른 예산을 하나로 집계 — 최빈값, 동률이면 낮은 예산 우선(보수적).
// 예산이 낮게 잡히면 모두가 부담 없는 선택이 되므로 동률 시 저가 쪽을 택한다.
const BUDGET_ORDER = ['~2만원', '2~4만원', '4만원+'];
export function aggregateBudget(members: GroupMember[]): string | null {
  const counts: Record<string, number> = {};
  members.forEach((m) => {
    if (m.vibe_budget) counts[m.vibe_budget] = (counts[m.vibe_budget] || 0) + 1;
  });
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  const maxCount = Math.max(...entries.map(([, c]) => c));
  // 최빈값이 여럿이면 BUDGET_ORDER상 가장 낮은(저가) 예산 선택
  const tied = entries.filter(([, c]) => c === maxCount).map(([b]) => b);
  // 목록에 없는 값(구버전 링크로 들어온 레거시 예산 등)은 indexOf가 -1이라 정렬하면 맨 앞으로 와서
  // 정상 예산을 이겨버린다. 모르는 값은 뒤로 보내 아는 값이 먼저 뽑히게 한다.
  const rank = (b: string) => { const i = BUDGET_ORDER.indexOf(b); return i === -1 ? BUDGET_ORDER.length : i; };
  tied.sort((a, b) => rank(a) - rank(b));
  return tied[0] ?? null;
}
