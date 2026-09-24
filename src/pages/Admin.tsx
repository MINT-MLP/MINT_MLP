import { useState } from 'react';
import { isTrackingPaused, setTrackingPaused } from '@/services/analytics';
import type { ReservationRecord } from '@/pages/Reserve';
import { AdminPasswordGate, AdminPasswordChangeCard, AdminStatCard, AdminBarRow, AdminMiniStat, AdminFunnelStep } from '@/components';
import { pct, pctLabel, formatDuration, formatDate, formatRelative } from '@/utils/format';
import { downloadCsv } from '@/utils/csv';
import { callAdmin } from '@/services/admin';
import { Icon, type IconName } from '@/components/icons';

// 어드민 — 모든 데이터 접근은 /api/admin/data(서버 비밀번호 검증 + service role) 경유.
// 클라이언트 하드코딩 비밀번호와 anon 키 직접 select는 보안 문제로 제거됨.
//
// 기획점검(fable5) 반영: analytics.ts 이벤트 15종을 퍼널·거절사유·재시도 관점으로 노출.

// 쿠폰 알림신청 순 수요(add-remove) 행 — payload에 실려온 매장 메타 포함
interface CouponNotifyRow {
  couponId: string;
  shopName: string;
  benefitType: string;
  area: string;
  tier: string;
  adds: number;
  removes: number;
  net: number;
}

// 유입 소스별 퍼널 한 줄 — 이벤트 payload에 실려온 `_attr`을 서버가 소스(캠페인/소재)별로 접은 것
interface AttributionRow {
  key: string;   // 서버가 만든 조합 키 — 어드민이 다시 조합하면 utm에 구분자가 섞였을 때 키가 충돌한다
  source: string;
  campaign: string;
  content: string;
  entries: number;
  landingViews: number;
  ctaClicks: number;
  sessions: number;
  recommendRequests: number;
  recommendShown: number;
  groupSessionCreates: number;
  feedbackSubmits: number;
  reservationAttempts: number;
}

// 상시 유저 피드백 한 건 — 원문은 user_feedback 테이블에만 있고 여기로만 흘러온다
interface UserFeedbackRow {
  id: string;
  text: string;
  category: string | null;
  contact: string | null;
  route: string | null;
  tab: string | null;
  viewport: string | null;
  createdAt: string;
}

// 미분류(null)까지 한 자리를 준다 — 안 고르고 보낸 사람이 제일 많을 수 있다
const FEEDBACK_CATEGORIES: { key: string; icon?: IconName; label: string; badge: string; bar: `bg-${string}` }[] = [
  { key: 'bug', icon: 'bug', label: '버그', badge: 'bg-red-50 text-red-500', bar: 'bg-red-500' },
  { key: 'pain', icon: 'sad', label: '불편', badge: 'bg-amber-50 text-amber-600', bar: 'bg-amber-500' },
  { key: 'idea', icon: 'bulb', label: '아이디어', badge: 'bg-blue-50 text-blue-500', bar: 'bg-blue-500' },
  { key: 'praise', icon: 'heart', label: '칭찬', badge: 'bg-mint-100 text-mint-600', bar: 'bg-mint-500' },
  { key: '', label: '미분류', badge: 'bg-gray-100 text-gray-400', bar: 'bg-slate-400' },
];

interface AdminAnalytics {
  landingViews: number;
  ctaClicks: number;
  sessions: number;
  reservationAttempts: number;
  reservationCompleted: number;
  recommendRequests: number;
  recommendShown: number;
  recommendErrors: number;
  placeClickRank1: number;
  placeClickSecond: number;
  placeClickCandidate: number;
  placeClickThird: number;
  candidatesExpand: number;
  certBadgeOpen: number;
  stepNext0: number;
  stepNext1: number;
  stepNext2: number;
  locationSearchZero: number;
  locationSearchError: number;
  pwaInstallAccepted: number;
  pwaInstallDismissed: number;
  groupSessionCreate: number;
  deeplinkCatchtable: number;
  deeplinkNaver: number;
  deeplinkKakaomap: number;
  rejectExpensive: number;
  rejectFar: number;
  rejectVibe: number;
  retryFresh: number;
  retryAdjust: number;
  kakaoShares: number;
  kakaoShareFallbacks: number;
  pwaInstallClicks: number;
  demoPlaceClicks: number;
  avgStaySeconds: number | null;
  medianStaySeconds: number | null;
  // 탭 셸
  tabClicks: Record<string, number>;
  tabClicksTotal: number;
  meetingsEmptyCtaClicks: number;
  // 민트샵(가짜 문)
  shopCouponClicks: number;
  shopFilterClicks: Record<string, number>;
  shopFilterClicksTotal: number;
  shopPageChanges: number;
  couponNotifyAdds: number;
  couponNotifyRemoves: number;
  couponNotifyTop: CouponNotifyRow[];
  // 총무 플랜 퍼널
  planEntryClicks: number;
  planDetailViews: number;
  planPreregisters: number;
  planDetailCloses: number;
  // 발굴·찜·방문인증
  wishlistAdds: number;
  wishlistRemoves: number;
  wishlistOpens: number;
  discoverGemMapOpens: number;
  visitCertOpens: number;
  visitCertDones: number;
  visitCertFails: number;
  pointsStoreTeaserClicks: number;
  // 참석 확정
  rsvpGoing: number;
  rsvpNotGoing: number;
  rsvpUndecided: number;
  rsvpSubmitTotal: number;
  // 상시 유저 피드백 퍼널
  feedbackOpens: number;
  feedbackSubmits: number;
  feedbackCloses: number;
  feedbackClosesWithText: number;
  feedbackSendFails: number;
  feedbackSendFailReasons: Record<string, number>;
  // 쿠폰 상세 의도(진짜 문 vs 가짜 문)
  couponReserveClicks: number;
  couponPurchaseClicks: number;
  // 복귀·게스트 동선
  resumePromptShown: number;
  resumePromptAccepts: number;
  resumePromptDiscards: number;
  guestDirectionsClicks: number;
  guestCalendarAdds: number;
  // 유입 소스
  entryViews: number;
  attribution: { rows: AttributionRow[]; otherCount: number; droppedSourceEvents: number };
  // 집계 범위 — 서버가 실제로 훑은 이벤트 행 수와, 안전 상한에 걸려 잘렸는지 여부
  eventsScanned: number;
  eventsTruncated: boolean;
}

const EMPTY_ANALYTICS: AdminAnalytics = {
  landingViews: 0, ctaClicks: 0, sessions: 0, reservationAttempts: 0, reservationCompleted: 0,
  recommendRequests: 0, recommendShown: 0, recommendErrors: 0,
  placeClickRank1: 0, placeClickSecond: 0, placeClickCandidate: 0, placeClickThird: 0,
  candidatesExpand: 0, certBadgeOpen: 0,
  stepNext0: 0, stepNext1: 0, stepNext2: 0,
  locationSearchZero: 0, locationSearchError: 0,
  pwaInstallAccepted: 0, pwaInstallDismissed: 0, groupSessionCreate: 0,
  deeplinkCatchtable: 0, deeplinkNaver: 0, deeplinkKakaomap: 0,
  rejectExpensive: 0, rejectFar: 0, rejectVibe: 0,
  retryFresh: 0, retryAdjust: 0,
  kakaoShares: 0, kakaoShareFallbacks: 0, pwaInstallClicks: 0, demoPlaceClicks: 0,
  avgStaySeconds: null, medianStaySeconds: null,
  tabClicks: {}, tabClicksTotal: 0, meetingsEmptyCtaClicks: 0,
  shopCouponClicks: 0, shopFilterClicks: {}, shopFilterClicksTotal: 0, shopPageChanges: 0,
  couponNotifyAdds: 0, couponNotifyRemoves: 0, couponNotifyTop: [],
  planEntryClicks: 0, planDetailViews: 0, planPreregisters: 0, planDetailCloses: 0,
  wishlistAdds: 0, wishlistRemoves: 0, wishlistOpens: 0, discoverGemMapOpens: 0,
  visitCertOpens: 0, visitCertDones: 0, visitCertFails: 0, pointsStoreTeaserClicks: 0,
  rsvpGoing: 0, rsvpNotGoing: 0, rsvpUndecided: 0, rsvpSubmitTotal: 0,
  feedbackOpens: 0, feedbackSubmits: 0, feedbackCloses: 0, feedbackClosesWithText: 0,
  feedbackSendFails: 0, feedbackSendFailReasons: {},
  couponReserveClicks: 0, couponPurchaseClicks: 0,
  resumePromptShown: 0, resumePromptAccepts: 0, resumePromptDiscards: 0,
  guestDirectionsClicks: 0, guestCalendarAdds: 0,
  entryViews: 0, attribution: { rows: [], otherCount: 0, droppedSourceEvents: 0 },
  eventsScanned: 0, eventsTruncated: false,
};

// 탭·필터 key → 화면 라벨 (서버가 모르는 key를 보내도 key 그대로 렌더된다)
const TAB_LABELS: Record<string, string> = {
  home: '홈', meetings: '내 모임', discover: '발굴', shop: '민트샵', profile: '프로필',
};
const TAB_ORDER = ['home', 'meetings', 'discover', 'shop', 'profile'];
const SHOP_FILTER_LABELS: Record<string, string> = {
  all: '전체', side: '사이드', drink: '음료', discount: '할인',
  time: '시간대', group: '모임', first_visit: '첫 방문',
};

// api/admin-data.ts의 SOURCE_KEY_CAP과 같은 값 — 각주에서 "몇 개 상한인지"를 말해주기 위한 표시용이다.
const SOURCE_ROW_CAP = 1000;

type RangeKey = 'today' | '7d' | '30d' | 'all';
const RANGE_LABELS: { key: RangeKey; label: string }[] = [
  { key: 'today', label: '오늘' },
  { key: '7d', label: '7일' },
  { key: '30d', label: '30일' },
  { key: 'all', label: '전체' },
];

function rangeToFrom(range: RangeKey): string | undefined {
  const now = Date.now();
  if (range === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); }
  if (range === '7d') return new Date(now - 7 * 86400000).toISOString();
  if (range === '30d') return new Date(now - 30 * 86400000).toISOString();
  return undefined; // all
}

export default function Admin() {
  const [password, setPassword] = useState<string | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [records, setRecords] = useState<ReservationRecord[]>([]);
  const [feedback, setFeedback] = useState<UserFeedbackRow[]>([]);
  const [analytics, setAnalytics] = useState<AdminAnalytics>(EMPTY_ANALYTICS);
  const [loading, setLoading] = useState(false);
  const [paused, setPaused] = useState(() => isTrackingPaused());
  const [dbError, setDbError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>('all');
  // 지금 로그인에 쓰인 비밀번호가 어디서 왔는지 — 'env'면 아직 한 번도 안 바꾼 상태다
  const [passwordSource, setPasswordSource] = useState<'db' | 'env' | null>(null);

  const a = analytics;
  const rejectTotal = a.rejectExpensive + a.rejectFar + a.rejectVibe;
  const retryTotal = a.retryFresh + a.retryAdjust;
  const deeplinkTotal = a.deeplinkCatchtable + a.deeplinkNaver + a.deeplinkKakaomap;
  const placeClickTotal = a.placeClickRank1 + a.placeClickSecond + a.placeClickCandidate + a.placeClickThird;
  const tabCounts = a.tabClicks ?? {};
  const tabTotal = TAB_ORDER.reduce((sum, k) => sum + (tabCounts[k] ?? 0), 0);
  const shopFilterEntries = Object.entries(a.shopFilterClicks ?? {}).sort((x, y) => y[1] - x[1]);
  const shopFilterTotal = shopFilterEntries.reduce((sum, [, v]) => sum + v, 0);
  const couponTop = a.couponNotifyTop ?? [];
  const rsvpTotal = a.rsvpGoing + a.rsvpNotGoing + a.rsvpUndecided;
  const attrRows = a.attribution?.rows ?? [];
  const attrOtherCount = a.attribution?.otherCount ?? 0;
  const attrDropped = a.attribution?.droppedSourceEvents ?? 0;
  const sendFail = a.feedbackSendFailReasons ?? {};
  const feedbackCounts = FEEDBACK_CATEGORIES.map((cat) => ({
    ...cat,
    count: feedback.filter((f) => (f.category ?? '') === cat.key).length,
  }));

  function applyData(data: {
    analytics?: Partial<AdminAnalytics>;
    reservations?: ReservationRecord[];
    userFeedback?: UserFeedbackRow[];
    passwordSource?: 'db' | 'env';
  }) {
    // 서버가 아직 새 필드를 안 보내는 배포 시점에도 기본값으로 안전하게 렌더된다.
    setAnalytics({ ...EMPTY_ANALYTICS, ...(data.analytics ?? {}) });
    setRecords(Array.isArray(data.reservations) ? data.reservations : []);
    setFeedback(Array.isArray(data.userFeedback) ? data.userFeedback : []);
    setPasswordSource(data.passwordSource ?? null);
  }

  async function loadData(pw: string, r: RangeKey = range) {
    setLoading(true);
    setDbError(null);
    try {
      applyData(await callAdmin(pw, { from: rangeToFrom(r) }));
    } catch (e) {
      setDbError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleUnlock(pw: string) {
    setVerifying(true);
    setGateError(null);
    try {
      const data = await callAdmin(pw, { from: rangeToFrom(range) });
      setPassword(pw);
      applyData(data);
    } catch (e) {
      setGateError((e as Error).message);
    } finally {
      setVerifying(false);
    }
  }

  function handleRange(r: RangeKey) {
    setRange(r);
    if (password) loadData(password, r);
  }

  async function handleDelete(id: string) {
    if (!password) return;
    try {
      await callAdmin(password, { action: 'delete_reservation', id });
      setRecords((prev) => prev.filter((rec) => rec.id !== id));
    } catch (e) {
      setDbError((e as Error).message);
    }
  }

  async function handleClear() {
    if (!password || !confirm('전체 예약 내역을 삭제할까요? (되돌릴 수 없어요 — 필요하면 먼저 CSV로 내보내세요)')) return;
    try {
      await callAdmin(password, { action: 'clear_reservations' });
      setRecords([]);
    } catch (e) {
      setDbError((e as Error).message);
    }
  }

  async function handleClearAnalytics() {
    if (!password || !confirm('분석 이벤트 전체를 초기화할까요? (되돌릴 수 없어요 — 필요하면 먼저 CSV로 내보내세요)')) return;
    try {
      await callAdmin(password, { action: 'clear_events' });
      setAnalytics(EMPTY_ANALYTICS);
    } catch (e) {
      setDbError((e as Error).message);
    }
  }

  function handleExport() {
    const label = RANGE_LABELS.find((r) => r.key === range)?.label ?? '전체';
    const rows: (string | number | null)[][] = [
      [`MINT 어드민 지표 — 기간: ${label}`, `내보낸 시각: ${formatDate(new Date().toISOString())}`],
      [],
      ['지표', '값'],
      ['랜딩 조회', a.landingViews],
      ['CTA 클릭', a.ctaClicks],
      ['앱 진입(세션)', a.sessions],
      ['예약 시도(이벤트)', a.reservationAttempts],
      ['예약 완료(테이블)', a.reservationCompleted],
      ['추천 요청', a.recommendRequests],
      ['추천 노출', a.recommendShown],
      ['추천 에러', a.recommendErrors],
      ['클릭·1순위', a.placeClickRank1],
      ['클릭·2차', a.placeClickSecond],
      ['클릭·대안', a.placeClickCandidate],
      ['클릭·3차', a.placeClickThird],
      ['후보 펼침', a.candidatesExpand],
      ['인증 뱃지 열람', a.certBadgeOpen],
      ['입력 1단계 통과', a.stepNext0],
      ['입력 2단계 통과', a.stepNext1],
      ['입력 3단계 통과', a.stepNext2],
      ['검색 0건', a.locationSearchZero],
      ['검색 에러', a.locationSearchError],
      ['PWA 설치 수락', a.pwaInstallAccepted],
      ['PWA 설치 취소', a.pwaInstallDismissed],
      ['그룹 링크 생성', a.groupSessionCreate],
      ['딥링크·캐치테이블', a.deeplinkCatchtable],
      ['딥링크·네이버', a.deeplinkNaver],
      ['딥링크·카카오맵', a.deeplinkKakaomap],
      ['거절·비쌈', a.rejectExpensive],
      ['거절·멂', a.rejectFar],
      ['거절·분위기', a.rejectVibe],
      ['재시도·새로', a.retryFresh],
      ['재시도·조정', a.retryAdjust],
      ['카카오 공유', a.kakaoShares],
      ['카카오 공유 폴백', a.kakaoShareFallbacks],
      ['PWA 설치 클릭', a.pwaInstallClicks],
      ['데모 장소 클릭', a.demoPlaceClicks],
      ['평균 체류(초)', a.avgStaySeconds],
      ['중앙값 체류(초)', a.medianStaySeconds],
      // ↓ 신규 지표는 기존 행 순서를 건드리지 않고 뒤에만 추가한다.
      ['탭·홈', tabCounts.home ?? 0],
      ['탭·내 모임', tabCounts.meetings ?? 0],
      ['탭·발굴', tabCounts.discover ?? 0],
      ['탭·민트샵', tabCounts.shop ?? 0],
      ['탭·프로필', tabCounts.profile ?? 0],
      ['탭 이동 합계', a.tabClicksTotal],
      ['빈 모임 CTA 클릭', a.meetingsEmptyCtaClicks],
      ['민트샵 쿠폰 탭', a.shopCouponClicks],
      ['민트샵 필터 클릭', a.shopFilterClicksTotal],
      ...shopFilterEntries.map(([key, count]) => [`민트샵 필터·${SHOP_FILTER_LABELS[key] ?? key}`, count]),
      ['민트샵 페이지 이동', a.shopPageChanges],
      ['쿠폰 알림신청', a.couponNotifyAdds],
      ['쿠폰 알림취소', a.couponNotifyRemoves],
      ['쿠폰 순 알림신청', a.couponNotifyAdds - a.couponNotifyRemoves],
      ['플랜 진입 클릭', a.planEntryClicks],
      ['플랜 상세 열람', a.planDetailViews],
      ['플랜 사전 신청', a.planPreregisters],
      ['플랜 상세 이탈', a.planDetailCloses],
      ['찜 추가', a.wishlistAdds],
      ['찜 해제', a.wishlistRemoves],
      ['찜 목록 열람', a.wishlistOpens],
      ['발굴 지도 열기', a.discoverGemMapOpens],
      ['방문인증 시작', a.visitCertOpens],
      ['방문인증 완료', a.visitCertDones],
      ['방문인증 전환율(%)', pct(a.visitCertDones, a.visitCertOpens)],
      ['방문인증 실패', a.visitCertFails],
      ['포인트샵 티저 클릭', a.pointsStoreTeaserClicks],
      ['참석·가요', a.rsvpGoing],
      ['참석·못가요', a.rsvpNotGoing],
      ['참석·미정', a.rsvpUndecided],
      ['참석 응답 합계', a.rsvpSubmitTotal],
      ['피드백 열림', a.feedbackOpens],
      ['피드백 제출', a.feedbackSubmits],
      ['피드백 닫음', a.feedbackCloses],
      ['피드백 쓰다 말고 닫음', a.feedbackClosesWithText],
      ['피드백 전송실패(이벤트)', a.feedbackSendFails],
      ['피드백 전송실패·server', sendFail.server ?? 0],
      ['피드백 전송실패·network', sendFail.network ?? 0],
      ['쿠폰 예약하기 클릭', a.couponReserveClicks],
      ['쿠폰 구매 클릭', a.couponPurchaseClicks],
      ['이어보기 제안 노출', a.resumePromptShown],
      ['이어보기 선택', a.resumePromptAccepts],
      ['새로 시작 선택', a.resumePromptDiscards],
      ['게스트 길찾기 클릭', a.guestDirectionsClicks],
      ['게스트 캘린더 저장', a.guestCalendarAdds],
      ['유입(entry_view)', a.entryViews],
      // 집계 범위 자체를 CSV에도 남긴다 — 나중에 이 파일만 보고 숫자를 비교할 때 잘린 스냅샷인지 알아야 한다.
      ['집계한 이벤트 행 수', a.eventsScanned],
      ['집계 상한 도달(잘림)', a.eventsTruncated ? '예' : '아니오'],
      ['소스 상한 초과로 버린 이벤트', attrDropped],
      [],
      ['유입 소스별 퍼널 (상위 20)'],
      // "세션"은 session_duration인데 결과 화면 도달 시에만 쏘인다 — 추천 노출보다 뒤 단계다.
      ['소스', '캠페인', '소재', '유입', '랜딩', 'CTA', '결과도달', '추천요청(재시도 포함)', '추천노출', '그룹생성', '피드백', '예약시도'],
      ...attrRows.map((row) => [
        row.source, row.campaign, row.content, row.entries, row.landingViews, row.ctaClicks, row.sessions,
        row.recommendRequests, row.recommendShown, row.groupSessionCreates, row.feedbackSubmits, row.reservationAttempts,
      ]),
      [],
      ['쿠폰 알림신청 Top 10'],
      ['순위', '쿠폰ID', '매장', '지역', '혜택유형', '등급', '순신청', '신청', '취소'],
      ...couponTop.map((cp, i) => [i + 1, cp.couponId, cp.shopName, cp.area, cp.benefitType, cp.tier, cp.net, cp.adds, cp.removes]),
      [],
      ['예약 목록'],
      ['장소명', '주소', '예약자', '인원', '요청시간'],
      ...records.map((r) => [r.placeName, r.address, r.guestName, r.people, formatDate(r.createdAt)]),
    ];
    downloadCsv(`mint-admin-${range}-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  }

  function handleTogglePause() {
    const next = !paused;
    setTrackingPaused(next);
    setPaused(next);
  }

  // 비밀번호 변경. 현재 비밀번호는 password state를 재사용하지 않고 사용자가 방금 친 값을 쓴다
  // (방치된 탭을 남이 잡아 비밀번호를 바꿔버리는 걸 막는다).
  async function handleChangePassword(current: string, next: string) {
    await callAdmin(current, { action: 'change_password', newPassword: next });
    // 저장이 끝났으면 새 비밀번호가 실제로 통하는지 바로 확인한다 — 여기서 실패하면
    // 화면을 새로고침한 순간 아무도 못 들어가는 상태이므로 복구 방법까지 알려줘야 한다.
    try {
      const data = await callAdmin(next, { from: rangeToFrom(range) });
      setPassword(next);
      applyData(data);
    } catch {
      throw new Error('저장은 됐는데 새 비밀번호로 확인 로그인이 실패했어요. 새로고침 후 새 비밀번호로 다시 시도하고, 그래도 안 되면 Supabase에서 admin_credentials 행을 삭제하면 기존 환경변수 비밀번호로 돌아가요.');
    }
  }

  if (!password) return <AdminPasswordGate onUnlock={handleUnlock} verifying={verifying} error={gateError} />;

  if (loading) {
    return (
      <div className="min-h-screen bg-mint-50 flex items-center justify-center">
        <p className="text-gray-400">불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-mint-50">
      <div className="max-w-3xl mx-auto px-4 pt-8 pb-16">

        {/* 헤더 */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-black text-mint-600">MINT 어드민</h1>
            <p className="text-sm text-gray-400">데이터 대시보드</p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/pilot-admin"
              className="text-xs bg-white border border-gray-200 text-gray-500 px-2.5 py-1 rounded-full hover:border-mint-500 hover:text-mint-500 transition-colors"
            >
              선발대 피드백 →
            </a>
            <button
              onClick={() => loadData(password)}
              className="text-xs bg-white border border-gray-200 text-gray-500 px-2.5 py-1 rounded-full hover:border-mint-500 hover:text-mint-500 transition-colors"
            >
              새로고침
            </button>
            <button
              onClick={handleExport}
              className="text-xs bg-white border border-gray-200 text-gray-500 px-2.5 py-1 rounded-full hover:border-mint-500 hover:text-mint-500 transition-colors"
            >
              CSV
            </button>
          </div>
        </div>

        {/* 기간 필터 */}
        <div className="flex items-center gap-1.5 mb-5">
          {RANGE_LABELS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => handleRange(key)}
              className={`text-xs font-bold px-3 py-1.5 rounded-full transition-all ${
                range === key ? 'bg-mint-500 text-white' : 'bg-white border border-gray-200 text-gray-400 hover:text-gray-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 오류 표시 */}
        {dbError && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-2xl p-4">
            <div className="text-sm font-bold text-red-600 mb-1">데이터 오류</div>
            <div className="text-xs text-red-500 break-all">{dbError}</div>
          </div>
        )}

        {/* 집계 상한 경고 — 안 잘렸으면 조용히 사라진다.
            잘렸는데 말이 없으면 "숫자가 작다"와 "숫자가 잘렸다"를 구분할 수 없어 예산 판단이 틀어진다. */}
        {a.eventsTruncated && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <div className="text-sm font-bold text-amber-700 mb-1"><Icon name="alert" className="mr-1" />이벤트 상한에 걸렸어요</div>
            <div className="text-xs text-amber-600">
              이벤트 {a.eventsScanned.toLocaleString()}건 상한에 걸려 최근 것만 집계했어요.
              아래 숫자는 이 기간 전체가 아니라 최근 {a.eventsScanned.toLocaleString()}건 기준이에요 —
              기간을 좁혀서 다시 보세요.
            </div>
          </div>
        )}

        {/* 비밀번호가 아직 env에 있으면 운영자는 스스로 바꿀 수 없다 — 한 번 바꾸라고 계속 알린다. */}
        {passwordSource === 'env' && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <div className="text-sm font-bold text-amber-700 mb-1"><Icon name="alert" className="mr-1" />비밀번호가 아직 Vercel 환경변수에 있어요</div>
            <div className="text-xs text-amber-600">
              아래 "어드민 비밀번호"에서 한 번 바꾸면 이후엔 여기서 직접 관리할 수 있어요.
            </div>
          </div>
        )}

        {/* 데이터 수집 일시정지 토글 */}
        <div className="mb-6">
          <button
            onClick={handleTogglePause}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl border-2 transition-all ${
              paused ? 'border-orange-300 bg-orange-50' : 'border-gray-200 bg-white'
            }`}
          >
            <div className="flex items-center gap-3">
              <Icon name={paused ? 'pause' : 'play'} className="text-xl" />
              <div className="text-left">
                <div className={`font-black text-sm ${paused ? 'text-orange-600' : 'text-gray-700'}`}>
                  이 기기 수집 {paused ? '일시정지 중' : '수집 중'}
                </div>
                <div className="text-xs text-gray-400">
                  {paused ? '이 브라우저에서만 기록이 멈춰요 (다른 사용자는 계속 수집돼요)' : '클릭하면 이 기기에서만 수집이 멈춰요'}
                </div>
              </div>
            </div>
            <div className={`w-10 h-6 rounded-full transition-colors relative ${paused ? 'bg-orange-400' : 'bg-mint-500'}`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${paused ? 'left-1' : 'left-5'}`} />
            </div>
          </button>
        </div>

        {/* ── 퍼널 ── */}
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-black text-gray-600"><Icon name="funnel" className="mr-1" />전환 퍼널</h2>
            <button
              onClick={handleClearAnalytics}
              className="text-xs text-red-400 border border-red-200 px-2.5 py-1 rounded-full hover:bg-red-50 transition-colors"
            >
              이벤트 초기화
            </button>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-2">
            <AdminFunnelStep label="랜딩 조회" value={a.landingViews} rate={null} />
            <AdminFunnelStep label="CTA 클릭" value={a.ctaClicks} rate={pctLabel(a.ctaClicks, a.landingViews)} />
            <AdminFunnelStep label="앱 진입(세션)" value={a.sessions} rate={pctLabel(a.sessions, a.ctaClicks)} />
            <AdminFunnelStep label="예약 시도" value={a.reservationAttempts} rate={pctLabel(a.reservationAttempts, a.sessions)} />
            <AdminFunnelStep label="예약 완료" value={a.reservationCompleted} rate={pctLabel(a.reservationCompleted, a.reservationAttempts)} last />
          </div>
          <p className="text-[11px] text-gray-400 mt-2 px-1">
            * 예약 시도는 이벤트, 예약 완료는 reservations 테이블 실건수 — 소스가 달라 초기화 대상도 달라요.
          </p>
        </section>

        {/* ── 유입 소스 — 퍼널 바로 아래. "어느 소재가 돈값을 하나"는 전환율 다음으로 먼저 볼 숫자다 ── */}
        <section className="mb-6">
          <h2 className="text-sm font-black text-gray-600 mb-3">
            <Icon name="megaphone" className="mr-1" />유입 소스 <span className="text-gray-300 font-normal">(광고 소재 판단)</span>
          </h2>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            {attrRows.length === 0 ? (
              <div className="text-center py-3">
                <p className="text-xs text-gray-400">아직 어트리뷰션 데이터가 없어요.</p>
                <p className="text-[11px] text-gray-300 mt-1">
                  광고 URL에 utm_source·utm_campaign·utm_content=소재명을 붙였는지 확인하세요.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {attrRows.map((row) => (
                  <div
                    key={row.key}
                    className="flex items-start gap-2 text-xs py-1.5 border-b border-gray-50 last:border-0"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block font-bold text-gray-700 truncate">{row.source}</span>
                      <span className="block text-[11px] text-gray-400 truncate">
                        {[row.campaign, row.content].filter(Boolean).join(' · ') || '캠페인·소재 미지정'}
                      </span>
                      {/* session_duration은 결과 화면 도달 시에만 쏘인다 — 추천 노출보다 뒤 단계라
                          "세션"이라고 부르면 존재할 수 없는 이탈 구간처럼 읽힌다. 그래서 "결과도달". */}
                      <span className="block text-[11px] text-gray-300 truncate">
                        랜딩 {row.landingViews} · CTA {row.ctaClicks} · 결과도달 {row.sessions} · 그룹 {row.groupSessionCreates} · 피드백 {row.feedbackSubmits} · 예약시도 {row.reservationAttempts}
                      </span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className="block font-black text-mint-500">유입 {row.entries}</span>
                      {/* 비율의 분자는 recommend_shown이다. recommend_request는 재추천·조정마다 다시 쏘여서
                          한 명이 "다시 추천"을 세 번 누르면 400%가 나오고, 재시도가 많다는 부정 신호가
                          화면에선 성과처럼 보인다. 요청 수는 절대수로만 남긴다. */}
                      <span className="block text-[11px] text-gray-400">
                        추천노출 {row.recommendShown} ({pctLabel(row.recommendShown, row.entries)})
                      </span>
                      <span className="block text-[11px] text-gray-300">요청 {row.recommendRequests} (재시도 포함)</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="text-[11px] text-gray-400 mt-2 px-1">
            * 유입은 탭 세션당 1회(entry_view, 새 광고 클릭이면 다시 발화) 기준이라 랜딩을 거치지 않고
            /app·/join으로 직행한 광고도 잡혀요.
            예약 "완료"는 reservations 테이블이라 소스를 알 수 없어 예약 시도로 대신 봐요.
            {attrOtherCount > 0 && ` 상위 20개 외 ${attrOtherCount}개 소스는 생략했어요.`}
            {attrDropped > 0 && ` 소스 종류가 ${SOURCE_ROW_CAP}개 상한을 넘어 ${attrDropped}건의 이벤트는 어느 행에도 못 들어갔어요(utm 값이 오염됐을 수 있어요).`}
          </p>
        </section>

        {/* ── 핵심 지표 카드 ── */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <AdminStatCard label="전환율 (랜딩→CTA)" value={pctLabel(a.ctaClicks, a.landingViews)} highlight />
          <AdminStatCard label="예약 완료율 (시도→완료)" value={pctLabel(a.reservationCompleted, a.reservationAttempts)} highlight />
          <AdminStatCard label="평균 체류시간" value={a.avgStaySeconds != null ? formatDuration(a.avgStaySeconds) : '—'} sub={a.medianStaySeconds != null ? `중앙값 ${formatDuration(a.medianStaySeconds)}` : '아직 기록 없음'} />
          <AdminStatCard label="카카오 공유" value={a.kakaoShares} unit="회" sub={a.kakaoShareFallbacks > 0 ? `폴백 ${a.kakaoShareFallbacks}회` : undefined} />
        </div>

        {/* ── 거절 사유 (알고리즘 핵심 신호) ── */}
        <section className="mb-6">
          <h2 className="text-sm font-black text-gray-600 mb-3"><Icon name="ban" className="mr-1" />거절 사유 <span className="text-gray-300 font-normal">(추천 알고리즘 개선 신호)</span></h2>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            {rejectTotal === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">아직 거절 기록이 없어요.</p>
            ) : (
              <div className="flex flex-col gap-2">
                <AdminBarRow label="비쌈" count={a.rejectExpensive} total={rejectTotal} bar="bg-amber-500" />
                <AdminBarRow label="멀어요" count={a.rejectFar} total={rejectTotal} bar="bg-red-500" />
                <AdminBarRow label="분위기" count={a.rejectVibe} total={rejectTotal} bar="bg-violet-500" />
                <div className="text-[11px] text-gray-400 mt-1 pt-2 border-t border-gray-50">총 {rejectTotal}건 거절</div>
              </div>
            )}
          </div>
        </section>

        {/* ── 재시도 & 예약 채널 ── */}
        <div className="grid md:grid-cols-2 gap-3 mb-8">
          <section>
            <h2 className="text-sm font-black text-gray-600 mb-3"><Icon name="refresh" className="mr-1" />재시도</h2>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              {retryTotal === 0 ? (
                <p className="text-xs text-gray-400 text-center py-3">기록 없음</p>
              ) : (
                <div className="flex flex-col gap-2">
                  <AdminBarRow label="새로" count={a.retryFresh} total={retryTotal} />
                  <AdminBarRow label="조정" count={a.retryAdjust} total={retryTotal} bar="bg-sky-500" />
                </div>
              )}
            </div>
          </section>
          <section>
            <h2 className="text-sm font-black text-gray-600 mb-3"><Icon name="link" className="mr-1" />예약 채널</h2>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              {deeplinkTotal === 0 ? (
                <p className="text-xs text-gray-400 text-center py-3">기록 없음</p>
              ) : (
                <div className="flex flex-col gap-2">
                  <AdminBarRow label="캐치" count={a.deeplinkCatchtable} total={deeplinkTotal} />
                  <AdminBarRow label="네이버" count={a.deeplinkNaver} total={deeplinkTotal} bar="bg-green-500" />
                  <AdminBarRow label="카카오맵" count={a.deeplinkKakaomap} total={deeplinkTotal} bar="bg-yellow-500" />
                </div>
              )}
            </div>
          </section>
        </div>

        {/* ── 추천 품질 (노출·성공률·선택 신호) ── */}
        <section className="mb-6">
          <h2 className="text-sm font-black text-gray-600 mb-3"><Icon name="target" className="mr-1" />추천 품질 <span className="text-gray-300 font-normal">(랭킹 튜닝 신호)</span></h2>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <AdminStatCard label="추천 노출" value={a.recommendShown} unit="회" sub={`요청 ${a.recommendRequests}회`} />
            <AdminStatCard label="추천 성공률" value={pctLabel(a.recommendShown, a.recommendRequests)} sub={a.recommendErrors > 0 ? `에러 ${a.recommendErrors}회` : '에러 없음'} highlight />
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs font-black text-gray-500 mb-2">선택 순위 분포 <span className="text-gray-300 font-normal">(어떤 순위를 눌렀나 = ground truth)</span></p>
            {placeClickTotal === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">아직 장소 클릭 기록이 없어요.</p>
            ) : (
              <div className="flex flex-col gap-2">
                <AdminBarRow label="1순위" count={a.placeClickRank1} total={placeClickTotal} />
                <AdminBarRow label="2차" count={a.placeClickSecond} total={placeClickTotal} bar="bg-mint-800" />
                <AdminBarRow label="대안" count={a.placeClickCandidate} total={placeClickTotal} bar="bg-sky-500" />
                <AdminBarRow label="3차" count={a.placeClickThird} total={placeClickTotal} bar="bg-violet-500" />
                <div className="text-[11px] text-gray-400 mt-1 pt-2 border-t border-gray-50">
                  후보 펼침 {a.candidatesExpand}회 · 인증 뱃지 열람 {a.certBadgeOpen}회
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── 입력 단계 이탈 & 검색 실패 ── */}
        <div className="grid md:grid-cols-2 gap-3 mb-6">
          <section>
            <h2 className="text-sm font-black text-gray-600 mb-3"><Icon name="edit" className="mr-1" />입력 단계 진행</h2>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-2">
              <AdminFunnelStep label="1단계 통과" value={a.stepNext0} rate={null} />
              <AdminFunnelStep label="2단계 통과" value={a.stepNext1} rate={pctLabel(a.stepNext1, a.stepNext0)} />
              <AdminFunnelStep label="3단계 통과" value={a.stepNext2} rate={pctLabel(a.stepNext2, a.stepNext1)} last />
            </div>
          </section>
          <section>
            <h2 className="text-sm font-black text-gray-600 mb-3"><Icon name="search" className="mr-1" />검색·설치·그룹</h2>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <AdminMiniStat label="검색 0건" value={a.locationSearchZero} />
              <AdminMiniStat label="검색 에러" value={a.locationSearchError} />
              <AdminMiniStat label="PWA 설치" value={a.pwaInstallAccepted} />
              <AdminMiniStat label="PWA 취소" value={a.pwaInstallDismissed} />
              <AdminMiniStat label="그룹 링크 생성" value={a.groupSessionCreate} />
              <AdminMiniStat label="데모 장소 클릭" value={a.demoPlaceClicks} />
            </div>
          </section>
        </div>

        {/* ── 탭 사용 ── */}
        <section className="mb-6">
          <h2 className="text-sm font-black text-gray-600 mb-3"><Icon name="phone" className="mr-1" />탭 사용 <span className="text-gray-300 font-normal">(어떤 탭이 실제로 쓰이나)</span></h2>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            {tabTotal === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">아직 탭 이동 기록이 없어요.</p>
            ) : (
              <div className="flex flex-col gap-2">
                <AdminBarRow label={TAB_LABELS.home} count={tabCounts.home ?? 0} total={tabTotal} />
                <AdminBarRow label={TAB_LABELS.meetings} count={tabCounts.meetings ?? 0} total={tabTotal} bar="bg-sky-500" />
                <AdminBarRow label={TAB_LABELS.discover} count={tabCounts.discover ?? 0} total={tabTotal} bar="bg-violet-500" />
                <AdminBarRow label={TAB_LABELS.shop} count={tabCounts.shop ?? 0} total={tabTotal} bar="bg-amber-500" />
                <AdminBarRow label={TAB_LABELS.profile} count={tabCounts.profile ?? 0} total={tabTotal} bar="bg-slate-400" />
                <div className="text-[11px] text-gray-400 mt-1 pt-2 border-t border-gray-50">
                  총 {a.tabClicksTotal || tabTotal}회 이동 · 빈 모임 CTA 클릭 {a.meetingsEmptyCtaClicks}회
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── 민트샵 반응 ── */}
        <section className="mb-6">
          <h2 className="text-sm font-black text-gray-600 mb-3"><Icon name="bag" className="mr-1" />민트샵 반응 <span className="text-gray-300 font-normal">(쿠폰 수요 = 가짜 문)</span></h2>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <AdminStatCard label="쿠폰 탭" value={a.shopCouponClicks} unit="회" sub={`페이지 이동 ${a.shopPageChanges}회`} />
            <AdminStatCard label="순 알림신청" value={a.couponNotifyAdds - a.couponNotifyRemoves} unit="건" sub={`신청 ${a.couponNotifyAdds} · 취소 ${a.couponNotifyRemoves}`} highlight />
            {/* 쿠폰 상세를 연 사람이 어느 문을 두드렸나 — 예약은 진짜 문, 구매는 아직 가짜 문이다 */}
            <AdminStatCard label="예약하기 클릭 (진짜 문)" value={a.couponReserveClicks} unit="회" sub={`쿠폰 탭 대비 ${pctLabel(a.couponReserveClicks, a.shopCouponClicks)}`} />
            <AdminStatCard label="구매 클릭 (가짜 문)" value={a.couponPurchaseClicks} unit="회" sub={`쿠폰 탭 대비 ${pctLabel(a.couponPurchaseClicks, a.shopCouponClicks)}`} />
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-3">
            <p className="text-xs font-black text-gray-500 mb-2">필터 사용 <span className="text-gray-300 font-normal">(어떤 혜택을 찾나)</span></p>
            {shopFilterTotal === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">아직 필터 기록이 없어요.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {shopFilterEntries.map(([key, count]) => (
                  <AdminBarRow key={key} label={SHOP_FILTER_LABELS[key] ?? key} count={count} total={shopFilterTotal} bar="bg-amber-500" />
                ))}
                <div className="text-[11px] text-gray-400 mt-1 pt-2 border-t border-gray-50">총 {a.shopFilterClicksTotal || shopFilterTotal}회 필터</div>
              </div>
            )}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs font-black text-gray-500 mb-2">쿠폰 알림신청 Top 10 <span className="text-gray-300 font-normal">(신청 − 취소)</span></p>
            {couponTop.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">아직 알림신청이 없어요.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {couponTop.map((cp, i) => (
                  <div key={cp.couponId} className="flex items-center gap-2 text-xs py-1 border-b border-gray-50 last:border-0">
                    <span className="w-5 text-gray-300 font-black shrink-0">{i + 1}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-bold text-gray-700 truncate">{cp.shopName || cp.couponId}</span>
                      <span className="block text-[11px] text-gray-400 truncate">
                        {[cp.area, cp.benefitType, cp.tier].filter(Boolean).join(' · ') || cp.couponId}
                      </span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className="block font-black text-mint-500">{cp.net}건</span>
                      {cp.removes > 0 && <span className="block text-[11px] text-gray-300">취소 {cp.removes}</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ── 총무 플랜 퍼널 ── */}
        <section className="mb-6">
          <h2 className="text-sm font-black text-gray-600 mb-3"><Icon name="user" className="mr-1" />총무 플랜 퍼널 <span className="text-gray-300 font-normal">(가격 검증)</span></h2>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-2">
            <AdminFunnelStep label="진입 클릭" value={a.planEntryClicks} rate={null} />
            <AdminFunnelStep label="상세 열람" value={a.planDetailViews} rate={pctLabel(a.planDetailViews, a.planEntryClicks)} />
            <AdminFunnelStep label="사전 신청" value={a.planPreregisters} rate={pctLabel(a.planPreregisters, a.planDetailViews)} last />
          </div>
          <p className="text-[11px] text-gray-400 mt-2 px-1">
            * 상세만 보고 닫음(이탈) {a.planDetailCloses}건 — 열람 대비 {pctLabel(a.planDetailCloses, a.planDetailViews)}
          </p>
        </section>

        {/* ── 발굴·찜·방문인증 ── */}
        <div className="grid md:grid-cols-2 gap-3 mb-6">
          <section>
            <h2 className="text-sm font-black text-gray-600 mb-3"><Icon name="compass" className="mr-1" />발굴·찜</h2>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <AdminMiniStat label="찜 추가" value={a.wishlistAdds} />
              <AdminMiniStat label="찜 해제" value={a.wishlistRemoves} />
              <AdminMiniStat label="찜 목록 열람" value={a.wishlistOpens} />
              <AdminMiniStat label="지도 열기" value={a.discoverGemMapOpens} />
              <AdminMiniStat label="포인트샵 티저" value={a.pointsStoreTeaserClicks} />
              <AdminMiniStat label="순 찜" value={a.wishlistAdds - a.wishlistRemoves} />
            </div>
          </section>
          <section>
            <h2 className="text-sm font-black text-gray-600 mb-3"><Icon name="pin" className="mr-1" />방문 인증</h2>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-2">
              <AdminFunnelStep label="인증 시작" value={a.visitCertOpens} rate={null} />
              <AdminFunnelStep label="인증 완료" value={a.visitCertDones} rate={pctLabel(a.visitCertDones, a.visitCertOpens)} last />
              <div className="text-[11px] text-gray-400 pt-2 border-t border-gray-50">
                전환율 {pctLabel(a.visitCertDones, a.visitCertOpens)} · 실패 {a.visitCertFails}건
              </div>
            </div>
          </section>
        </div>

        {/* ── 참석 확정 ── */}
        <section className="mb-8">
          <h2 className="text-sm font-black text-gray-600 mb-3"><Icon name="vote" className="mr-1" />참석 확정 <span className="text-gray-300 font-normal">(가요/못가요)</span></h2>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            {rsvpTotal === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">아직 참석 응답이 없어요.</p>
            ) : (
              <div className="flex flex-col gap-2">
                <AdminBarRow label="가요" count={a.rsvpGoing} total={rsvpTotal} bar="bg-green-500" />
                <AdminBarRow label="못가요" count={a.rsvpNotGoing} total={rsvpTotal} bar="bg-red-500" />
                <AdminBarRow label="미정" count={a.rsvpUndecided} total={rsvpTotal} bar="bg-slate-400" />
                <div className="text-[11px] text-gray-400 mt-1 pt-2 border-t border-gray-50">총 {a.rsvpSubmitTotal || rsvpTotal}건 응답</div>
              </div>
            )}
          </div>
        </section>

        {/* ── 복귀·게스트 동선 ── */}
        {/* 🔎 검색·설치·그룹 카드에 끼우지 않는다 — 거긴 이미 6칸이라 11칸이 되면 아무도 못 읽는다 */}
        <section className="mb-8">
          <h2 className="text-sm font-black text-gray-600 mb-3">
            <Icon name="bookmark" className="mr-1" />복귀·게스트 동선 <span className="text-gray-300 font-normal">(로그인 왕복 후 이탈 방지)</span>
          </h2>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <AdminMiniStat label="이어보기 제안 노출" value={a.resumePromptShown} />
            <AdminMiniStat label="이어보기 선택" value={a.resumePromptAccepts} />
            <AdminMiniStat label="새로 시작 선택" value={a.resumePromptDiscards} />
            <AdminMiniStat label="게스트 길찾기" value={a.guestDirectionsClicks} />
            <AdminMiniStat label="게스트 캘린더 저장" value={a.guestCalendarAdds} />
          </div>
          <p className="text-[11px] text-gray-400 mt-2 px-1">
            * 이어보기 수락률 {pctLabel(a.resumePromptAccepts, a.resumePromptShown)} — 카카오 로그인으로 앱을 떠났던 사람이 보던 추천으로 돌아온 비율이에요.
          </p>
        </section>

        {/* ── 상시 유저 피드백 ── */}
        <section className="mb-8">
          <h2 className="text-sm font-black text-gray-600 mb-3">
            <Icon name="chat" className="mr-1" />유저 피드백 <span className="text-mint-600">{feedback.length}건</span>
          </h2>
          {/* 퍼널을 원문 목록과 한 섹션에 둔다 — 목적이 "어제 만든 피드백 기능이 살아 있나"의 확인이라
              원문이 0건일 때 열림/제출 숫자가 바로 옆에 있어야 원인을 가릴 수 있다. */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-3 flex flex-col gap-2">
            <AdminFunnelStep label="시트 열림" value={a.feedbackOpens} rate={null} />
            <AdminFunnelStep label="제출" value={a.feedbackSubmits} rate={pctLabel(a.feedbackSubmits, a.feedbackOpens)} last />
            <div className="text-[11px] text-gray-400 pt-2 border-t border-gray-50">
              쓰다 말고 닫음 {a.feedbackClosesWithText}건 (닫음 {a.feedbackCloses}건 중) ·
              전송 실패 server {sendFail.server ?? 0} / network {sendFail.network ?? 0}
            </div>
            <p className="text-[11px] text-gray-300">
              * 전송 실패는 아웃박스가 <b>재시도할 때마다</b> 찍혀요 — "실패 이벤트 수"지 "유실 건수"가 아니에요.
              아래 원문 실건수와 대조해서 읽으세요.
            </p>
          </div>
          {feedback.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-400 text-center py-3">
                이 기간에 남겨진 피드백이 없어요.
              </p>
              <p className="text-[11px] text-gray-300 text-center">
                * 계속 비어 있다면 Supabase SQL Editor에서 sql/user-feedback.sql이 실행됐는지 확인해주세요
                (그 전 제출분은 events 테이블에 feedback_submit으로 쌓입니다).
              </p>
            </div>
          ) : (
            <>
              {/* 집계는 카드 하나로 족하다 — 검색·필터·상태관리는 만들지 않는다 */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-3 flex flex-col gap-2">
                {feedbackCounts.map((cat) => (
                  <AdminBarRow key={cat.key || 'none'} label={cat.label} count={cat.count} total={feedback.length} bar={cat.bar} />
                ))}
              </div>
              <div className="flex flex-col gap-2">
                {feedback.map((f) => {
                  const meta = FEEDBACK_CATEGORIES.find((c) => c.key === (f.category ?? '')) ?? FEEDBACK_CATEGORIES[4];
                  return (
                    <div key={f.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className={`text-[11px] font-black px-2 py-0.5 rounded-full shrink-0 ${meta.badge}`}>
                          {meta.icon && <Icon name={meta.icon} className="mr-1" />}{meta.label}
                        </span>
                        <span className="text-[11px] text-gray-300 shrink-0">{formatRelative(f.createdAt)}</span>
                      </div>
                      <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap break-keep">{f.text}</p>
                      <div className="text-[11px] text-gray-400 mt-2 pt-2 border-t border-gray-50">
                        {[f.tab, f.route, f.viewport].filter(Boolean).join(' · ') || '맥락 없음'}
                      </div>
                      {f.contact && (
                        // 연락처를 남겼다는 건 답을 기다린다는 뜻이다 — 목록에서 눈에 띄어야 한다
                        <div className="mt-1.5 text-xs font-bold text-mint-600 bg-mint-100 rounded-lg px-2.5 py-1.5">
                          <Icon name="mail" className="mr-1" />답장 대상 · {f.contact}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>

        {/* ── 예약 목록 ── */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-black text-gray-600"><Icon name="clipboard" className="mr-1" />예약 요청 <span className="text-mint-600">{records.length}건</span></h2>
          {records.length > 0 && (
            <button
              onClick={handleClear}
              className="text-xs text-red-400 border border-red-200 px-2.5 py-1 rounded-full hover:bg-red-50 transition-colors"
            >
              전체 삭제
            </button>
          )}
        </div>
        {records.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
            <Icon name="clipboard" className="text-4xl mb-3 text-gray-300" />
            <p className="text-gray-400">이 기간에 예약 요청이 없어요.</p>
            <a href="/app" className="inline-block mt-4 text-sm text-mint-500 underline">
              MINT로 장소 추천받기 →
            </a>
          </div>
        ) : (
          <>
            {/* 모바일: 카드형 */}
            <div className="flex flex-col gap-3 md:hidden">
              {records.map((r) => (
                <div key={r.id} className="bg-white rounded-2xl border-2 border-gray-100 p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-black text-gray-800">{r.placeName}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{r.address}</div>
                    </div>
                    <button
                      onClick={() => handleDelete(r.id)}
                      className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none ml-2"
                    >
                      ×
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-400">예약자</span>
                      <span className="font-bold text-gray-700">{r.guestName}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-gray-400">인원</span>
                      <span className="font-bold text-gray-700">{r.people}명</span>
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 mt-2">요청: {formatDate(r.createdAt)}</div>
                </div>
              ))}
            </div>

            {/* 데스크탑: 테이블형 */}
            <div className="hidden md:block bg-white rounded-2xl border-2 border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-mint-100 text-left">
                    <th className="px-4 py-3 font-bold text-mint-600">장소명</th>
                    <th className="px-4 py-3 font-bold text-mint-600">주소</th>
                    <th className="px-4 py-3 font-bold text-mint-600">예약자</th>
                    <th className="px-4 py-3 font-bold text-mint-600">인원</th>
                    <th className="px-4 py-3 font-bold text-mint-600">요청시간</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r, i) => (
                    <tr
                      key={r.id}
                      className={`border-t border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                    >
                      <td className="px-4 py-3 font-bold text-gray-800">{r.placeName}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-[160px] truncate">{r.address}</td>
                      <td className="px-4 py-3 font-medium text-gray-700">{r.guestName}</td>
                      <td className="px-4 py-3">
                        <span className="bg-mint-100 text-mint-600 font-bold px-2 py-0.5 rounded-full text-xs">
                          {r.people}명
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(r.createdAt)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleDelete(r.id)}
                          className="text-gray-300 hover:text-red-400 transition-colors"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── 어드민 비밀번호 ── */}
        {/* 예약/피드백이 한 건도 없어도 보여야 하므로 목록 조건 밖(상시)에 둔다. */}
        <section className="mt-8">
          <h2 className="text-sm font-black text-gray-600 mb-3"><Icon name="lock" className="mr-1" />어드민 비밀번호</h2>
          <AdminPasswordChangeCard onChange={handleChangePassword} source={passwordSource} />
        </section>
      </div>
    </div>
  );
}
