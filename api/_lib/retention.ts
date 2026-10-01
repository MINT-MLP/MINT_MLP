// 재방문(리텐션) 집계 — user_visits 행을 기기별 방문 타임라인으로 접는다. I/O 없는 순수 함수.
//
// 방문 = 기기당 KST 하루 1행(sql/user-visits.sql). 그래서 간격은 visit_date(달력일) 차이로 잰다 —
// created_at 시각 차이로 재면 "어제 밤 11시 → 오늘 아침 9시"가 0일로 찍혀 재방문이 아닌 것처럼 보인다.

export interface VisitRow {
  device_id: string;
  user_id: string | null;
  visit_date: string;   // 'YYYY-MM-DD'
  created_at: string;
  path: string | null;
}

export interface ProfileRow {
  id: string;
  nickname: string | null;
  device_id: string | null;
}

export interface VisitStep {
  n: number;               // 1번째, 2번째 … N번째
  at: string;              // 그날 첫 접속 시각(ISO)
  date: string;            // KST 달력일
  gapDays: number | null;  // 직전 방문으로부터 며칠 뒤인가(첫 방문은 null)
  path: string | null;
}

export interface RetentionUser {
  key: string;             // 그룹 키 — 로그인 유저는 'u:<userId>', 아니면 device_id
  deviceId: string;        // 대표 기기(가장 최근 방문 기기)
  deviceCount: number;     // 합쳐진 기기 수 — 로그인 유저가 폰·PC로 온 경우 2 이상
  userId: string | null;
  nickname: string | null;
  visitCount: number;
  firstAt: string;
  lastAt: string;
  steps: VisitStep[];
}

export interface RetentionSummary {
  users: number;                     // 방문 유저 수(로그인 유저는 계정 1명, 나머지는 기기 1대)
  returning: number;                 // 2회 이상
  threePlus: number;                 // 3회 이상
  avgVisits: number | null;          // 기기당 평균 방문 횟수(소수 1자리)
  medianFirstGapDays: number | null; // 1번째 → 2번째 방문 간격의 중앙값
  distribution: { one: number; two: number; three: number; four: number; fivePlus: number };
}

// 응답 크기 상한 — 방문 많은 순으로 상위만 보낸다. 요약 수치는 전체 기기로 계산한다.
export const RETENTION_USER_CAP = 300;

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── 수집 시작 전(추정) ──
// user_visits가 생기기 전에는 "방문" 기록이 없다. 대신 device_id를 실어 둔 행동 흔적(탭 클릭·찜·피드백·
// 그룹 참여 등)이 남아 있어, "그 기기가 무언가를 누른 날"을 방문일로 추정한다.
// 들어왔다가 아무것도 안 누른 날은 빠지므로 재방문은 실제보다 적게 잡힌다(하한 추정).
export interface ActivityRow {
  device_id: string;
  user_id: string | null;
  created_at: string;
  source: string;   // 어떤 흔적으로 잡혔나 — 타임라인의 path 자리에 보여준다
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function kstDate(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t + KST_OFFSET_MS).toISOString().slice(0, 10);
}

// 행동 흔적을 user_visits와 같은 모양(기기당 KST 하루 1행, 그날 가장 이른 흔적)으로 접는다
export function activityToVisits(rows: ActivityRow[]): VisitRow[] {
  const byKey = new Map<string, VisitRow>();
  for (const r of rows) {
    if (!r.device_id || r.device_id === 'd_anon') continue;
    const date = kstDate(r.created_at);
    if (!date) continue;
    const key = `${r.device_id}|${date}`;
    const prev = byKey.get(key);
    if (!prev || r.created_at < prev.created_at) {
      byKey.set(key, {
        device_id: r.device_id,
        user_id: r.user_id ?? prev?.user_id ?? null,
        visit_date: date,
        created_at: r.created_at,
        path: r.source,
      });
    } else if (!prev.user_id && r.user_id) {
      prev.user_id = r.user_id;
    }
  }
  return [...byKey.values()];
}

export function buildRetention(
  rows: VisitRow[], profiles: ProfileRow[],
): { summary: RetentionSummary; users: RetentionUser[] } {
  const byDevice = new Map<string, VisitRow[]>();
  for (const r of rows) {
    if (!r.device_id) continue;
    const list = byDevice.get(r.device_id);
    if (list) list.push(r);
    else byDevice.set(r.device_id, [r]);
  }

  const nickByUser = new Map<string, string>();
  const userByDevice = new Map<string, string>();
  for (const p of profiles) {
    if (p.nickname) nickByUser.set(p.id, p.nickname);
    if (p.device_id) userByDevice.set(p.device_id, p.id);
  }

  // 로그인 유저는 계정 하나로 합친다 — 같은 사람이 폰·PC·인앱/외부 브라우저로 오면 기기가 여럿이라
  // 기기 기준으로는 한 사람이 여러 줄로 쪼개진다. 기기의 계정은 행의 user_id(가장 최근) → 프로필의 device_id 순.
  // 로그인 전 방문 행은 user_id가 비어 있어도 같은 기기라면 그 계정으로 함께 묶인다.
  const groups = new Map<string, { userId: string | null; rows: VisitRow[]; devices: Map<string, string> }>();
  for (const [deviceId, list] of byDevice) {
    const fromRows = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at)).find((r) => r.user_id)?.user_id;
    const userId = fromRows ?? userByDevice.get(deviceId) ?? null;
    const key = userId ? `u:${userId}` : deviceId;
    const g = groups.get(key) ?? { userId, rows: [], devices: new Map<string, string>() };
    g.rows.push(...list);
    const lastAt = list.reduce((m, r) => (r.created_at > m ? r.created_at : m), '');
    g.devices.set(deviceId, lastAt);
    groups.set(key, g);
  }

  const users: RetentionUser[] = [];
  for (const [key, g] of groups) {
    // 여러 기기가 같은 날 왔으면 하루 1회로 접는다(그날 가장 이른 접속)
    const byDate = new Map<string, VisitRow>();
    for (const r of g.rows) {
      const prev = byDate.get(r.visit_date);
      if (!prev || r.created_at < prev.created_at) byDate.set(r.visit_date, r);
    }
    const list = [...byDate.values()].sort((a, b) => a.visit_date.localeCompare(b.visit_date));
    const steps: VisitStep[] = list.map((r, i) => ({
      n: i + 1,
      at: r.created_at,
      date: r.visit_date,
      gapDays: i === 0 ? null : dayDiff(list[i - 1].visit_date, r.visit_date),
      path: r.path ?? null,
    }));
    const deviceId = [...g.devices].sort((a, b) => b[1].localeCompare(a[1]))[0][0];
    users.push({
      key,
      deviceId,
      deviceCount: g.devices.size,
      userId: g.userId,
      nickname: g.userId ? nickByUser.get(g.userId) ?? null : null,
      visitCount: steps.length,
      firstAt: steps[0].at,
      lastAt: steps[steps.length - 1].at,
      steps,
    });
  }

  const distribution = { one: 0, two: 0, three: 0, four: 0, fivePlus: 0 };
  let totalVisits = 0;
  const firstGaps: number[] = [];
  for (const u of users) {
    totalVisits += u.visitCount;
    if (u.visitCount === 1) distribution.one += 1;
    else if (u.visitCount === 2) distribution.two += 1;
    else if (u.visitCount === 3) distribution.three += 1;
    else if (u.visitCount === 4) distribution.four += 1;
    else distribution.fivePlus += 1;
    const g = u.steps[1]?.gapDays;
    if (g != null) firstGaps.push(g);
  }

  const summary: RetentionSummary = {
    users: users.length,
    returning: users.length - distribution.one,
    threePlus: distribution.three + distribution.four + distribution.fivePlus,
    avgVisits: users.length > 0 ? Math.round((totalVisits / users.length) * 10) / 10 : null,
    medianFirstGapDays: median(firstGaps),
    distribution,
  };

  users.sort((a, b) => b.visitCount - a.visitCount || b.lastAt.localeCompare(a.lastAt));
  return { summary, users: users.slice(0, RETENTION_USER_CAP) };
}
