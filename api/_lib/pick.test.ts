import { describe, it, expect } from 'vitest';
import { seededRandom, weightedPick, addressInScope } from './pick';

describe('seededRandom', () => {
  it('같은 시드는 같은 수열, 다른 시드는 다른 수열', () => {
    const a = seededRandom('sess-1'); const b = seededRandom('sess-1'); const c = seededRandom('sess-2');
    const sa = [a(), a(), a()]; const sb = [b(), b(), b()]; const sc = [c(), c(), c()];
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    for (const v of sa) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
});

describe('weightedPick', () => {
  const items = [{ n: 'a', s: 90 }, { n: 'b', s: 80 }, { n: 'c', s: 70 }, { n: 'd', s: 40 }];
  const score = (i: { s: number }) => i.s;

  it('k개를 중복 없이 뽑고, 후보가 모자라면 있는 만큼', () => {
    const out = weightedPick(items, score, 3, seededRandom('x'));
    expect(out).toHaveLength(3);
    expect(new Set(out.map((i) => i.n)).size).toBe(3);
    expect(weightedPick(items, score, 10, seededRandom('x'))).toHaveLength(4);
  });

  it('같은 시드면 같은 선택', () => {
    const a = weightedPick(items, score, 2, seededRandom('s')).map((i) => i.n);
    const b = weightedPick(items, score, 2, seededRandom('s')).map((i) => i.n);
    expect(a).toEqual(b);
  });

  it('점수가 높을수록 1위로 뽑히는 빈도가 높다', () => {
    // temperature 20: 90점 대비 40점의 가중치가 e^-2.5 ≈ 8% — 최하위도 가끔 나와야 노출 다양성이 있다
    const count: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
    for (let i = 0; i < 1000; i++) count[weightedPick(items, score, 1, seededRandom(`seed-${i}`), 20)[0].n]++;
    expect(count.a).toBeGreaterThan(count.b);
    expect(count.b).toBeGreaterThan(count.c);
    expect(count.c).toBeGreaterThan(count.d);
    expect(count.d).toBeGreaterThan(0);
  });

  it('기본 temperature 8이면 1위 쏠림이 강하다 — 90점 vs 80점이면 1위가 3배 이상', () => {
    const count: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
    for (let i = 0; i < 1000; i++) count[weightedPick(items, score, 1, seededRandom(`s-${i}`))[0].n]++;
    expect(count.a).toBeGreaterThan(count.b * 2);
  });

  it('temperature 0이면 점수순 상위 k', () => {
    expect(weightedPick(items, score, 2, seededRandom('s'), 0).map((i) => i.n)).toEqual(['a', 'b']);
  });
});

describe('addressInScope', () => {
  it('토큰이 전부 들어 있어야 통과, 공백 차이는 무시', () => {
    expect(addressInScope('인천 미추홀구 주안동 123', ['인천', '미추홀구'])).toBe(true);
    expect(addressInScope('인천 미추홀 구 주안동', ['미추홀구'])).toBe(true);
    expect(addressInScope('인천 남동구 구월동', ['인천', '미추홀구'])).toBe(false);
    expect(addressInScope(undefined, ['인천'])).toBe(false);
  });
});
