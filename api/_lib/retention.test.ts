import { describe, it, expect } from 'vitest';
import { buildRetention, RETENTION_USER_CAP, type VisitRow } from './retention';

function v(device_id: string, visit_date: string, hhmm = '10:00', user_id: string | null = null): VisitRow {
  // KST hh:mm → UTC ISO
  const [h, m] = hhmm.split(':').map(Number);
  const at = new Date(Date.parse(`${visit_date}T00:00:00Z`) + ((h - 9) * 60 + m) * 60_000).toISOString();
  return { device_id, user_id, visit_date, created_at: at, path: '/app' };
}

describe('buildRetention', () => {
  it('기기별로 묶고 날짜순으로 N번째를 매긴다', () => {
    const { users } = buildRetention([v('a', '2026-10-05'), v('a', '2026-10-01'), v('a', '2026-10-03')], []);
    expect(users).toHaveLength(1);
    expect(users[0].steps.map((s) => [s.n, s.date])).toEqual([[1, '2026-10-01'], [2, '2026-10-03'], [3, '2026-10-05']]);
    expect(users[0].visitCount).toBe(3);
  });

  it('간격은 달력일 차이 — 첫 방문은 null', () => {
    const { users } = buildRetention([v('a', '2026-10-01', '23:50'), v('a', '2026-10-02', '00:10'), v('a', '2026-10-09')], []);
    expect(users[0].steps.map((s) => s.gapDays)).toEqual([null, 1, 7]);
  });

  it('닉네임은 user_id 우선, 없으면 device_id로 찾는다', () => {
    const profiles = [
      { id: 'u1', nickname: '민트', device_id: 'x' },
      { id: 'u2', nickname: '초코', device_id: 'b' },
    ];
    const { users } = buildRetention([v('a', '2026-10-01', '10:00', 'u1'), v('b', '2026-10-01')], profiles);
    const byDevice = Object.fromEntries(users.map((u) => [u.deviceId, u]));
    expect(byDevice.a.nickname).toBe('민트');
    expect(byDevice.a.userId).toBe('u1');
    expect(byDevice.b.nickname).toBe('초코');
    expect(byDevice.b.userId).toBeNull();
  });

  it('요약 — 분포·재방문 수·평균·첫 재방문 간격 중앙값', () => {
    const rows = [
      v('a', '2026-10-01'),
      v('b', '2026-10-01'), v('b', '2026-10-02'),
      v('c', '2026-10-01'), v('c', '2026-10-04'), v('c', '2026-10-05'),
      ...['01', '02', '03', '04', '05', '06'].map((d) => v('d', `2026-10-${d}`)),
    ];
    const { summary, users } = buildRetention(rows, []);
    expect(summary.users).toBe(4);
    expect(summary.returning).toBe(3);
    expect(summary.threePlus).toBe(2);
    expect(summary.distribution).toEqual({ one: 1, two: 1, three: 1, four: 0, fivePlus: 1 });
    expect(summary.avgVisits).toBe(3);
    expect(summary.medianFirstGapDays).toBe(1); // [1, 3, 1]
    expect(users.map((u) => u.deviceId)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('유저 목록은 상한까지만, 요약은 전체로', () => {
    const rows = Array.from({ length: RETENTION_USER_CAP + 5 }, (_, i) => v(`dev${i}`, '2026-10-01'));
    const { summary, users } = buildRetention(rows, []);
    expect(users).toHaveLength(RETENTION_USER_CAP);
    expect(summary.users).toBe(RETENTION_USER_CAP + 5);
  });

  it('빈 입력', () => {
    const { summary, users } = buildRetention([], []);
    expect(users).toEqual([]);
    expect(summary).toMatchObject({ users: 0, returning: 0, avgVisits: null, medianFirstGapDays: null });
  });
});
