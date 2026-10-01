import { describe, it, expect } from 'vitest';
import { buildRetention, activityToVisits, kstDate, RETENTION_USER_CAP, type VisitRow } from './retention';

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

  it('계정은 행의 user_id 우선, 없으면 프로필의 device_id로 찾는다', () => {
    const profiles = [
      { id: 'u1', nickname: '민트', device_id: 'x' },
      { id: 'u2', nickname: '초코', device_id: 'b' },
    ];
    const { users } = buildRetention([v('a', '2026-10-01', '10:00', 'u1'), v('b', '2026-10-01'), v('c', '2026-10-01')], profiles);
    const byDevice = Object.fromEntries(users.map((u) => [u.deviceId, u]));
    expect(byDevice.a).toMatchObject({ key: 'u:u1', userId: 'u1', nickname: '민트' });
    expect(byDevice.b).toMatchObject({ key: 'u:u2', userId: 'u2', nickname: '초코' });
    expect(byDevice.c).toMatchObject({ key: 'c', userId: null, nickname: null, deviceCount: 1 });
  });

  it('같은 계정의 여러 기기는 한 줄로 합치고, 같은 날은 1회로 접는다', () => {
    const rows = [
      v('phone', '2026-10-01', '09:00', 'u1'),
      v('pc', '2026-10-01', '08:00', 'u1'),
      v('pc', '2026-10-03', '12:00'),              // 로그인 전 방문 — 같은 기기라 함께 묶인다
      v('phone', '2026-10-05', '20:00', 'u1'),
    ];
    const { users, summary } = buildRetention(rows, [{ id: 'u1', nickname: '민트', device_id: 'phone' }]);
    expect(users).toHaveLength(1);
    expect(summary.users).toBe(1);
    expect(users[0]).toMatchObject({ key: 'u:u1', deviceCount: 2, visitCount: 3, deviceId: 'phone', nickname: '민트' });
    expect(users[0].steps.map((s) => [s.date, s.gapDays])).toEqual([['2026-10-01', null], ['2026-10-03', 2], ['2026-10-05', 2]]);
    expect(users[0].firstAt).toBe(rows[1].created_at); // 그날 더 이른 pc 접속
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

describe('activityToVisits (수집 시작 전 추정)', () => {
  it('KST 날짜 경계 — UTC 15시가 다음 날', () => {
    expect(kstDate('2026-09-20T14:59:00Z')).toBe('2026-09-20');
    expect(kstDate('2026-09-20T15:00:00Z')).toBe('2026-09-21');
  });

  it('기기·KST 하루당 1행, 그날 가장 이른 흔적을 남긴다', () => {
    const visits = activityToVisits([
      { device_id: 'a', user_id: null, created_at: '2026-09-20T05:00:00Z', source: 'wishlist_add' },
      { device_id: 'a', user_id: null, created_at: '2026-09-20T01:00:00Z', source: 'tab_click' },
      { device_id: 'a', user_id: 'u1', created_at: '2026-09-20T06:00:00Z', source: '추천 기록' },
      { device_id: 'a', user_id: null, created_at: '2026-09-22T01:00:00Z', source: 'tab_click' },
      { device_id: 'd_anon', user_id: null, created_at: '2026-09-22T01:00:00Z', source: 'tab_click' },
    ]);
    expect(visits).toHaveLength(2);
    const first = visits.find((v) => v.visit_date === '2026-09-20')!;
    expect(first.path).toBe('tab_click');
    expect(first.user_id).toBe('u1');
    const { users } = buildRetention(visits, []);
    expect(users[0].steps.map((s) => s.gapDays)).toEqual([null, 2]);
  });
});
