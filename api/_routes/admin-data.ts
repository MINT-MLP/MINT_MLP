import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { verifyAdminPassword, validateNewPassword, setAdminPassword } from '../_lib/adminAuth.js';
import { clientIp, checkRateLimit } from '../_lib/guard.js';

// 어드민 데이터 API — 비밀번호는 Supabase admin_credentials(없으면 env ADMIN_PASSWORD 폴백)로 검증
// — api/_lib/adminAuth.ts.
// 기존에는 클라이언트 하드코딩 비밀번호 + anon 키 직접 select였다(누구나 예약자 명단 열람 가능).
// 이 엔드포인트 + RLS 차단(sql/security.sql)으로 이전.
//
// 기획점검(fable5) 반영: analytics.ts EventType 15종을 전부 집계해 어드민에 노출한다.
// (이전에는 5종만 집계 — reject/retry/deeplink 등 알고리즘 개선 신호가 버려졌음)
//
// 확장: 탭 셸/민트샵/총무 플랜/발굴·찜·방문인증/참석 확정 이벤트까지 집계.
// payload(JSONB)를 함께 select해 tab·category·coupon_id·rsvp 등 맥락별로 분해한다.
// 집계는 전부 events 단일 순회 안에서 처리 — 쿼리 수·DB 부하는 그대로다.

interface EventRow {
  type: string;
  duration_seconds: number | null;
  created_at: string;
  payload: Record<string, unknown> | null; // trackEvent가 싣는 맥락(tab/category/coupon_id/rsvp/frame 등)
}

// 쿠폰 알림신청 순 수요(add - remove) 집계용
interface CouponAgg {
  couponId: string;
  shopName: string;
  benefitType: string;
  area: string;
  tier: string;
  adds: number;
  removes: number;
}

// 유입 소스별 퍼널 한 줄 — trackEvent가 모든 이벤트 payload에 실어 보낸 `_attr`로만 만든다.
// 조인이 없으므로 events 단일 순회 안에서 그대로 접힌다(쿼리 추가 0).
interface SourceRow {
  key: string;                  // 서버가 만든 조합 키 — 어드민 React key로 그대로 쓴다(구분자 불일치 방지)
  source: string;
  campaign: string;
  content: string;
  entries: number;              // entry_view — 소스별 유입수(분모)
  landingViews: number;
  ctaClicks: number;
  sessions: number;
  recommendRequests: number;    // 핵심 전환 1
  recommendShown: number;
  groupSessionCreates: number;  // 핵심 전환 2 — 바이럴 씨앗
  feedbackSubmits: number;      // 핵심 전환 3
  reservationAttempts: number;  // 핵심 전환 4
}

type SourceMetric = Exclude<keyof SourceRow, 'key' | 'source' | 'campaign' | 'content'>;

// 소스별로 세는 이벤트만 추린다. 나머지 이벤트는 전체 카운트로만 보면 충분하고,
// 소스별 행을 60칸짜리로 만들면 어드민에서 읽히지 않는다.
const SOURCE_METRIC_OF: Record<string, SourceMetric> = {
  entry_view: 'entries',
  landing_view: 'landingViews',
  cta_click: 'ctaClicks',
  session_duration: 'sessions',
  recommend_request: 'recommendRequests',
  recommend_shown: 'recommendShown',
  group_session_create: 'groupSessionCreates',
  feedback_submit: 'feedbackSubmits',
  reservation_attempt: 'reservationAttempts',
};

// utm은 URL로 들어오는 값이라 누구든 아무 문자열이나 넣을 수 있다. 맵이 무한히 커지지 않도록 상한.
// 200은 너무 낮았다 — events는 anon insert가 열려 있어 쓰레기 utm 200개면 그 뒤에 들어온 진짜
// 광고 소스가 통째로 0으로 뜬다. 1000으로 올리고, 그래도 넘친 이벤트는 세서 어드민에 보여준다.
const SOURCE_KEY_CAP = 1000;

const STAY_CAP_SECONDS = 1800; // 탭 방치 아웃라이어가 평균을 왜곡하지 않도록 상한 캡

// PostgREST는 프로젝트 max_rows(신규 프로젝트 기본 1000)로 응답을 "말없이" 자른다. HTTP 200에
// 숫자만 작게 나와 눈치챌 수도 없고, 클라이언트 .limit(50000)으로도 못 넘는 서버측 하드 캡이다.
// 그래서 최신순 정렬 + range 페이지네이션으로 전량을 모은다.
const EVENTS_PAGE = 1000;
// 안전 상한 6만 행 — 여기 걸리면 "최근 6만건만 집계했다"를 어드민이 눈으로 알 수 있어야 한다.
const EVENTS_MAX_PAGES = 60;

// 프로토타입 오염 방어. bump는 payload에서 온 문자열을 그대로 키로 쓰는데, 'constructor'가 오면
// map['constructor']는 Object 함수라 `?? 0`을 통과하고 함수+1이 문자열로 박힌다.
// shopFilterClicks는 맵을 통째로 응답에 실어서 어드민 합산이 NaN이 되고 막대가 전부 NaN%가 된다.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// 프로토타입 체인을 타지 않는 빈 집계 맵 — 위 가드와 이중 방어다.
function emptyCounts(): Record<string, number> {
  return Object.create(null) as Record<string, number>;
}

// payload는 JSONB(객체)지만, 문자열로 저장된 행/컬럼 부재도 안전하게 읽는다.
function asPayload(v: unknown): Record<string, unknown> {
  if (!v) return {};
  if (typeof v === 'string') {
    try {
      const parsed: unknown = JSON.parse(v);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

// payload 값 → 집계 키(문자열). null/undefined/객체는 빈 문자열로 떨궈 무시한다.
function pstr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

// 빈 키는 세지 않는다(payload 없는 과거 행이 '알 수 없음'으로 섞이지 않게)
function bump(map: Record<string, number>, key: string): void {
  if (!key || UNSAFE_KEYS.has(key)) return;
  map[key] = (map[key] ?? 0) + 1;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// ISO 문자열이면 반환, 아니면 null (신뢰할 수 없는 입력 방어)
function toIso(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const supabase = getSupabaseAdmin();   // 인증보다 먼저 — DB 해시를 읽어야 하므로
  const body = (req.body ?? {}) as {
    password?: unknown; action?: string; id?: string; from?: string; to?: string; newPassword?: unknown;
  };

  // 비밀번호가 사용자 변경 가능해졌으니 브루트포스를 막아둔다. 어드민은 하루 수십 번뿐이라
  // 분당 30회면 사람 사용에는 절대 안 걸리고, 자동 대입은 바로 걸린다.
  // 일일 상한은 IP 단위 — 엔드포인트 합계로 재면 운영자끼리 서로를 막게 된다.
  const gate = await checkRateLimit(supabase, 'admin-auth', clientIp(req), 30, 1000, 'ip');
  if (!gate.allowed) {
    return res.status(429).json({ error: '요청이 너무 잦아요. 잠시 후 다시 시도해주세요.' });
  }

  const auth = await verifyAdminPassword(supabase, body.password);
  if (!auth.ok) {
    if (auth.reason === 'unconfigured') {
      return res.status(500).json({ error: '어드민 비밀번호가 설정되지 않았어요. ADMIN_PASSWORD 환경변수 또는 admin_credentials 행이 필요해요.' });
    }
    return res.status(401).json({ error: '비밀번호가 틀렸어요' });
  }
  if (!supabase) return res.status(500).json({ error: 'Supabase 설정이 없습니다.' });

  try {
    switch (body.action) {
      case 'change_password': {
        // 현재 비밀번호는 위에서 이미 검증됐다(body.password). 여기선 새 비밀번호만 본다.
        const current = typeof body.password === 'string' ? body.password : '';
        const checked = validateNewPassword(body.newPassword, current);
        if (!checked.ok) return res.status(400).json({ error: checked.error });
        const saved = await setAdminPassword(supabase, checked.value);
        if (!saved.ok) return res.status(500).json({ error: saved.error });
        console.info('[admin-data] 어드민 비밀번호 변경됨');   // 값은 절대 로그에 남기지 않는다
        return res.status(200).json({ ok: true });
      }
      case 'delete_reservation': {
        if (!body.id) return res.status(400).json({ error: 'id가 필요해요.' });
        await supabase.from('reservations').delete().eq('id', body.id);
        return res.status(200).json({ ok: true });
      }
      case 'clear_reservations': {
        await supabase.from('reservations').delete().not('id', 'is', null);
        return res.status(200).json({ ok: true });
      }
      case 'clear_events': {
        await supabase.from('events').delete().not('id', 'is', null);
        return res.status(200).json({ ok: true });
      }
      default: {
        // 'load' — 분석 지표 + 예약 목록. from/to(ISO)로 기간 필터 가능.
        const from = toIso(body.from);
        const to = toIso(body.to);

        let reservationsQuery = supabase.from('reservations').select('*').order('created_at', { ascending: false });
        // 상시 유저 피드백 — 원문을 매일 읽는 화면이 있어야 "빠르게 반영하겠다"는 약속이 지켜진다.
        // 검색·상태관리는 만들지 않는다. 지금 규모에선 최신 200건 스크롤이면 충분하다.
        let feedbackQuery = supabase.from('user_feedback').select('*')
          .order('created_at', { ascending: false }).limit(200);
        if (from) {
          reservationsQuery = reservationsQuery.gte('created_at', from);
          feedbackQuery = feedbackQuery.gte('created_at', from);
        }
        if (to) {
          reservationsQuery = reservationsQuery.lte('created_at', to);
          feedbackQuery = feedbackQuery.lte('created_at', to);
        }

        // events는 한 방 select로 못 가져온다 — max_rows가 응답을 말없이 자르기 때문에,
        // 이벤트가 1000건을 넘는 순간부터 어드민은 오늘 집행 중인 광고 유입을 영영 못 본다.
        // 최신순으로 페이지를 돌며 전량을 모으고, 안전 상한에 걸리면 그 사실을 응답에 실어 보낸다.
        //
        // 아래는 페이지 한 장을 읽는다. withPayload=false는 payload 컬럼 마이그레이션 전 구 스키마
        // 경로다 — select 문자열을 변수 하나로 합치면 supabase 타입 파서가 유니온 리터럴을 못 읽어
        // 컴파일이 깨지므로 두 갈래를 리터럴 그대로 둔다.
        // 기간 필터는 페이지마다 다시 건다(쿼리를 매번 새로 만들기 때문이다).
        const loadEventsPage = async (
          withPayload: boolean, offset: number,
        ): Promise<{ data: unknown[] | null; failed: boolean }> => {
          if (withPayload) {
            let q = supabase.from('events').select('type, duration_seconds, created_at, payload');
            if (from) q = q.gte('created_at', from);
            if (to) q = q.lte('created_at', to);
            const r = await q.order('created_at', { ascending: false })
              .range(offset, offset + EVENTS_PAGE - 1);
            return { data: r.data, failed: Boolean(r.error) };
          }
          let q = supabase.from('events').select('type, duration_seconds, created_at');
          if (from) q = q.gte('created_at', from);
          if (to) q = q.lte('created_at', to);
          const r = await q.order('created_at', { ascending: false })
            .range(offset, offset + EVENTS_PAGE - 1);
          return { data: r.data, failed: Boolean(r.error) };
        };

        const collectEvents = async (withPayload: boolean): Promise<{
          rows: EventRow[]; truncated: boolean; failed: boolean;
        }> => {
          const rows: EventRow[] = [];
          for (let page = 0; page < EVENTS_MAX_PAGES; page += 1) {
            const { data, failed } = await loadEventsPage(withPayload, page * EVENTS_PAGE);
            if (failed) return { rows: [], truncated: false, failed: true };
            const batch = (data ?? []) as EventRow[];
            // 구스키마 행엔 payload가 없다 — null을 채워 EventRow 계약을 맞춘다.
            // 타입 회피가 아니라 사실의 명시다. asPayload가 null을 빈 객체로 읽으므로
            // type 카운트·체류시간 집계는 그대로 돌고, payload 기반 지표만 0이 된다.
            for (const r of batch) rows.push(withPayload ? r : { ...r, payload: null });
            // 페이지가 덜 찼으면 마지막 페이지다 — 여기서 끊어야 빈 쿼리를 한 번 더 쏘지 않는다.
            if (batch.length < EVENTS_PAGE) return { rows, truncated: false, failed: false };
          }
          return { rows, truncated: true, failed: false };
        };

        const [eventsCollected, reservationsRes, feedbackRes] = await Promise.all([
          collectEvents(true), reservationsQuery, feedbackQuery,
        ]);

        // payload 컬럼 마이그레이션 전이면 select가 통째로 실패한다 — 그때만(평상시 0회) 구 스키마로 재조회.
        // 재조회도 같은 페이지네이션을 탄다(한 방 select로 돌아가면 거기서 다시 1000행에 잘린다).
        const eventsResult = eventsCollected.failed ? await collectEvents(false) : eventsCollected;
        const events = eventsResult.rows;
        const eventsScanned = events.length;
        const eventsTruncated = eventsResult.truncated;

        // 타입별 카운트 맵 (단일 순회) — 데이터가 쌓여도 순회 1회로 처리
        const counts: Record<string, number> = emptyCounts();
        const stays: number[] = [];
        // payload 분해 집계(같은 순회 안에서 처리 — 추가 쿼리 없음)
        const tabCounts: Record<string, number> = emptyCounts();
        const shopFilterCounts: Record<string, number> = emptyCounts();
        const rsvpCounts: Record<string, number> = emptyCounts();
        const couponAgg = new Map<string, CouponAgg>();
        const couponRow = (id: string): CouponAgg => {
          const found = couponAgg.get(id);
          if (found) return found;
          const created: CouponAgg = { couponId: id, shopName: '', benefitType: '', area: '', tier: '', adds: 0, removes: 0 };
          couponAgg.set(id, created);
          return created;
        };
        // 피드백 시트 품질 신호 — "쓰다 말고 닫았나"와 "왜 전송이 실패했나"만 분해한다.
        let feedbackClosesWithText = 0;
        const feedbackSendFailReasons: Record<string, number> = emptyCounts();
        // 유입 소스별 퍼널
        const bySource = new Map<string, SourceRow>();
        // 상한 초과로 어느 행에도 못 들어간 이벤트 수 — 조용히 버리면 광고 소스가 0으로 보인다.
        let droppedSourceEvents = 0;

        for (const e of events) {
          counts[e.type] = (counts[e.type] ?? 0) + 1;
          if (e.type === 'session_duration' && e.duration_seconds != null) {
            stays.push(Math.min(e.duration_seconds, STAY_CAP_SECONDS));
          }
          // payload는 어트리뷰션 때문에 이제 거의 모든 행에 있다 — 순회당 한 번만 읽는다.
          const p = asPayload(e.payload);

          // ── 유입 소스 집계 ──
          // `_attr`이 없는 과거 행은 어느 소스에도 세지 않는다(direct로 추정해 넣으면 지표가 오염된다).
          // e.type은 DB 컬럼이라 'constructor' 같은 값이 들어와도 프로토타입 체인을 타지 않게 막는다.
          const metric = Object.prototype.hasOwnProperty.call(SOURCE_METRIC_OF, e.type)
            ? SOURCE_METRIC_OF[e.type]
            : undefined;
          if (metric && p._attr) {
            const attr = asPayload(p._attr);
            const source = pstr(attr.source).slice(0, 100);
            if (source) {
              const campaign = pstr(attr.campaign).slice(0, 100);
              const content = pstr(attr.content).slice(0, 100);
              const key = `${source}\u001f${campaign}\u001f${content}`;
              let row = bySource.get(key);
              if (!row && bySource.size < SOURCE_KEY_CAP) {
                row = {
                  key, source, campaign, content,
                  entries: 0, landingViews: 0, ctaClicks: 0, sessions: 0,
                  recommendRequests: 0, recommendShown: 0,
                  groupSessionCreates: 0, feedbackSubmits: 0, reservationAttempts: 0,
                };
                bySource.set(key, row);
              }
              if (row) row[metric] += 1;
              else droppedSourceEvents += 1;
            }
          }

          switch (e.type) {
            case 'tab_click':
              bump(tabCounts, pstr(p.tab));
              break;
            case 'shop_filter_click':
              bump(shopFilterCounts, pstr(p.category));
              break;
            case 'rsvp_submit':
              bump(rsvpCounts, pstr(p.rsvp));
              break;
            case 'feedback_close':
              // 한 글자라도 쓰다가 닫은 건 "할 말은 있었는데 시트가 불편했다"는 신호다
              if (p.had_text === true) feedbackClosesWithText += 1;
              break;
            case 'feedback_send_fail':
              // server(API 장애)와 network(오프라인)는 우리가 할 일이 완전히 다르다
              bump(feedbackSendFailReasons, pstr(p.reason));
              break;
            case 'coupon_notify_add': {
              const id = pstr(p.coupon_id);
              if (!id) break;
              const row = couponRow(id);
              row.adds += 1;
              // 메타는 add 이벤트에만 실린다(remove는 coupon_id만) — 최신 값으로 갱신
              row.shopName = pstr(p.shop_name) || row.shopName;
              row.benefitType = pstr(p.benefit_type) || row.benefitType;
              row.area = pstr(p.area) || row.area;
              row.tier = pstr(p.tier) || row.tier;
              break;
            }
            case 'coupon_notify_remove': {
              const id = pstr(p.coupon_id);
              if (id) couponRow(id).removes += 1;
              break;
            }
            default:
              break;
          }
        }
        const c = (t: string) => counts[t] ?? 0;

        // 활동 많은 순 상위 20개만 보낸다 — 그 아래는 판단에 쓸 표본이 안 된다.
        // entries 1순위 정렬은 기간 필터를 걸면 성과 낸 소재를 지워버린다: 어제 유입돼 오늘 전환한
        // 유저는 오늘 범위에서 entries가 0이라 최하위로 밀리고, 소스가 20개를 넘으면 잘려서 안 보인다.
        // 그래서 퍼널 전 구간의 활동량 합으로 정렬한다.
        const activity = (r: SourceRow): number =>
          r.entries + r.landingViews + r.ctaClicks + r.sessions
          + r.recommendRequests + r.recommendShown
          + r.groupSessionCreates + r.feedbackSubmits + r.reservationAttempts;
        const sourceRows = [...bySource.values()]
          .sort((a, b) => activity(b) - activity(a) || b.entries - a.entries);
        const attribution = {
          rows: sourceRows.slice(0, 20),
          otherCount: Math.max(0, sourceRows.length - 20),
          droppedSourceEvents,
        };

        // 쿠폰 순 신청(add-remove) Top 10 — 순 수요가 남은 것만, 내림차순
        const couponNotifyTop = [...couponAgg.values()]
          .map((r) => ({ ...r, net: r.adds - r.removes }))
          .filter((r) => r.net > 0)
          .sort((a, b) => b.net - a.net || b.adds - a.adds)
          .slice(0, 10);

        const reservations = (reservationsRes.data ?? []).map((r) => ({
          id: r.id,
          placeName: r.place_name,
          address: r.address,
          guestName: r.guest_name,
          people: r.people,
          arrivalTime: r.arrival_time,
          createdAt: r.created_at,
        }));

        // sql/user-feedback.sql 미실행이면 여기서 에러가 온다 — 빈 배열로 떨궈 전체 응답을 깨뜨리지 않는다
        // (events legacy 재조회와 같은 사상). 그 사이 제출분은 API가 events로 폴백 저장해 두고 있다.
        const userFeedback = (feedbackRes.data ?? []).map((r) => ({
          id: r.id,
          text: r.text,
          category: r.category ?? null,
          contact: r.contact ?? null,
          route: r.route ?? null,
          tab: r.tab ?? null,
          viewport: r.viewport ?? null,
          createdAt: r.created_at,
        }));
        if (feedbackRes.error) console.warn('[admin-data] user_feedback 조회 실패(테이블 미생성?)', feedbackRes.error.code);

        const analytics = {
          // 퍼널 핵심
          landingViews: c('landing_view'),
          ctaClicks: c('cta_click'),
          sessions: c('session_duration'),          // 앱 진입 프록시(세션 종료 기록 수)
          reservationAttempts: c('reservation_attempt'),
          reservationCompleted: reservations.length, // reservations 테이블 실건수(이벤트와 소스 다름)
          // 추천 퍼널 — 노출(분모)·성공률·실패
          recommendRequests: c('recommend_request'),
          recommendShown: c('recommend_shown'),
          recommendErrors: c('recommend_error'),
          // 선택 신호(ground truth) — 어떤 순위를 클릭했나
          placeClickRank1: c('place_click_rank1'),
          placeClickSecond: c('place_click_second'),
          placeClickCandidate: c('place_click_candidate'),
          placeClickThird: c('place_click_third'),
          // 결과 화면 상호작용
          candidatesExpand: c('candidates_expand'),
          certBadgeOpen: c('cert_badge_open'),
          // 입력 단계 이탈 퍼널
          stepNext0: c('step_next_0'),
          stepNext1: c('step_next_1'),
          stepNext2: c('step_next_2'),
          // 지역 검색 실패
          locationSearchZero: c('location_search_zero'),
          locationSearchError: c('location_search_error'),
          // PWA 설치 결과 & 그룹
          pwaInstallAccepted: c('pwa_install_accepted'),
          pwaInstallDismissed: c('pwa_install_dismissed'),
          groupSessionCreate: c('group_session_create'),
          // 예약 딥링크(실제 예약 채널)
          deeplinkCatchtable: c('reserve_deeplink_catchtable'),
          deeplinkNaver: c('reserve_deeplink_naver'),
          deeplinkKakaomap: c('reserve_deeplink_kakaomap'),
          // 거절 사유 — 추천 알고리즘 개선의 핵심 신호
          rejectExpensive: c('reject_expensive'),
          rejectFar: c('reject_far'),
          rejectVibe: c('reject_vibe'),
          // 재시도
          retryFresh: c('retry_fresh'),
          retryAdjust: c('retry_adjust'),
          // 공유 & 기타
          kakaoShares: c('kakao_share'),
          kakaoShareFallbacks: c('kakao_share_fallback'),
          pwaInstallClicks: c('pwa_install_click'),
          demoPlaceClicks: c('landing_demo_place_click'),
          // 체류시간 (아웃라이어 캡 후 평균·중앙값)
          avgStaySeconds: stays.length > 0
            ? Math.round(stays.reduce((sum, s) => sum + s, 0) / stays.length)
            : null,
          medianStaySeconds: median(stays),
          // ── 탭 셸 — 어떤 탭이 실제로 쓰이나 ──
          tabClicks: {
            home: tabCounts.home ?? 0,
            meetings: tabCounts.meetings ?? 0,
            discover: tabCounts.discover ?? 0,
            shop: tabCounts.shop ?? 0,
            profile: tabCounts.profile ?? 0,
          },
          tabClicksTotal: c('tab_click'),
          meetingsEmptyCtaClicks: c('meetings_empty_cta_click'),
          // ── 민트샵(가짜 문) — 쿠폰 수요 ──
          shopCouponClicks: c('shop_coupon_click'),
          shopFilterClicks: shopFilterCounts,           // 필터 key별(all/side/drink/discount/time/group/first_visit)
          shopFilterClicksTotal: c('shop_filter_click'),
          shopPageChanges: c('shop_page_change'),
          couponNotifyAdds: c('coupon_notify_add'),
          couponNotifyRemoves: c('coupon_notify_remove'),
          couponNotifyTop,                              // 순 신청(add-remove) 상위 10
          // ── 총무 플랜 퍼널(가격 검증) ──
          planEntryClicks: c('plan_entry_click'),
          planDetailViews: c('plan_detail_view'),
          planPreregisters: c('plan_preregister'),
          planDetailCloses: c('plan_detail_close'),
          // ── 발굴·찜·방문인증 ──
          wishlistAdds: c('wishlist_add'),
          wishlistRemoves: c('wishlist_remove'),
          wishlistOpens: c('wishlist_open'),
          discoverGemMapOpens: c('discover_gem_map_open'),
          visitCertOpens: c('visit_cert_open'),
          visitCertDones: c('visit_cert_done'),
          visitCertFails: c('visit_cert_fail'),
          pointsStoreTeaserClicks: c('points_store_teaser_click'),
          // ── 참석 확정(가요/못가요/미정) ──
          rsvpGoing: rsvpCounts.going ?? 0,
          rsvpNotGoing: rsvpCounts.notgoing ?? 0,
          rsvpUndecided: rsvpCounts.undecided ?? 0,
          rsvpSubmitTotal: c('rsvp_submit'),
          // ── 상시 유저 피드백 퍼널(어제 만든 기능의 생사 확인) ──
          feedbackOpens: c('feedback_open'),
          feedbackSubmits: c('feedback_submit'),
          feedbackCloses: c('feedback_close'),
          feedbackClosesWithText,
          // ⚠️ 아웃박스가 재시도할 때마다 발화한다 — "실패 이벤트 수"이지 "유실 건수"가 아니다.
          feedbackSendFails: c('feedback_send_fail'),
          feedbackSendFailReasons: {
            server: feedbackSendFailReasons.server ?? 0,
            network: feedbackSendFailReasons.network ?? 0,
          },
          // ── 쿠폰 상세에서의 의도 — 진짜 문(예약) vs 가짜 문(구매) ──
          couponReserveClicks: c('coupon_reserve_click'),
          couponPurchaseClicks: c('coupon_purchase_click'),
          // ── 카카오 로그인 복귀 후 이어보기 제안 ──
          resumePromptShown: c('resume_prompt_shown'),
          resumePromptAccepts: c('resume_prompt_accept'),
          resumePromptDiscards: c('resume_prompt_discard'),
          // ── 그룹 게스트 결과 화면의 개인 유틸(실제 이동 전환 관측) ──
          guestDirectionsClicks: c('guest_directions_click'),
          guestCalendarAdds: c('guest_calendar_add'),
          // ── 유입 소스 ──
          entryViews: c('entry_view'),
          attribution,
          // ── 집계 범위 자체의 신뢰도 ──
          // 이 두 값이 없으면 "숫자가 작다"와 "숫자가 잘렸다"를 구분할 방법이 없다.
          eventsScanned,
          eventsTruncated,
        };

        // passwordSource: 비밀번호가 아직 env에 있는지(= 운영자가 직접 못 바꾸는 상태인지) 어드민에 알린다.
        return res.status(200).json({ analytics, reservations, userFeedback, passwordSource: auth.source });
      }
    }
  } catch (e) {
    console.error('[admin-data] failed', e);
    return res.status(500).json({ error: '데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.' });
  }
}
