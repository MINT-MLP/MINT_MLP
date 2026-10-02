// Supabase 마이그레이션 필요(SQL Editor에서 실행):
//   ALTER TABLE events ADD COLUMN IF NOT EXISTS duration_seconds integer;
//   ALTER TABLE events ADD COLUMN IF NOT EXISTS session_key TEXT;   -- 탐색 에피소드 조인 키
//   ALTER TABLE events ADD COLUMN IF NOT EXISTS payload JSONB;      -- 이벤트 맥락(place_key/priceRange/query 등)
// ⚠️ 아직 실행 안 됐어도 안전: 새 컬럼 insert가 실패하면 자동으로 {type}만 재삽입(폴백)해 수집이 끊기지 않는다.

import { supabase } from '@/services/supabase';
import { getAttr } from '@/services/attribution';

type EventType = 'landing_view' | 'cta_click' | 'reservation_attempt' | 'session_duration' | 'kakao_share' | 'kakao_share_fallback' | 'pwa_install_click' | 'landing_demo_place_click'
  | 'retry_fresh' | 'retry_adjust' | 'reject_expensive' | 'reject_far' | 'reject_vibe'
  | 'reserve_deeplink_catchtable' | 'reserve_deeplink_naver' | 'reserve_deeplink_kakaomap'
  // 추천 퍼널 — 노출(분모)·실패율. 추천 요청/노출/에러
  | 'recommend_request' | 'recommend_shown' | 'recommend_error'
  // 선택 신호(ground truth) — 노출된 후보 중 실제로 어떤 순위를 클릭했나
  | 'place_click_rank1' | 'place_click_second' | 'place_click_candidate' | 'place_click_third'
  // 결과 화면 품질 상호작용
  | 'candidates_expand' | 'cert_badge_open'
  // PWA 설치 결과(클릭≠설치)
  | 'pwa_install_accepted' | 'pwa_install_dismissed'
  // 입력 단계 이탈 퍼널 (step N → N+1 진행) & 지역검색 실패
  | 'step_next_0' | 'step_next_1' | 'step_next_2'
  | 'location_search_zero' | 'location_search_error'
  // 그룹 링크 생성(바이럴 루프 분해)
  | 'group_session_create'
  // A. 방문 인증 + 포인트 — 추천→실제 방문 전환율 씨앗
  | 'visit_cert_open' | 'visit_cert_done' | 'visit_cert_fail' | 'points_store_teaser_click'
  // B. 총무 플랜 가짜 문 — 가격 검증(frame별 전환율)
  | 'plan_entry_click' | 'plan_detail_view' | 'plan_preregister' | 'plan_detail_close'
  // B-1. 오늘의 총무 팝업 — mode=location(출발지로 뽑음) / rule(출발지 없어 공정 규칙으로 뽑음).
  //      rule 비중이 높으면 '지역 직접 선택' 유저가 총무 기능을 반쪽으로 쓰고 있다는 신호.
  | 'treasurer_open'
  // C. 참석 확정(가요/못가요)
  | 'rsvp_submit'
  // D. 찜(발굴) 기록 — 1호 발굴자 소급 씨앗
  | 'wishlist_add' | 'wishlist_remove' | 'wishlist_open' | 'wishlist_login_prompt'
  | 'home_hub_view' | 'home_start' | 'home_resume'   // 앱 홈(/app) — 보기·새로 시작·이어하기
  // E. 탭 셸 — 어떤 탭이 실제로 쓰이나 + 민트샵 쿠폰 수요(가짜 문)
  | 'tab_click' | 'shop_coupon_click'
  // F. 골목 쿠폰 알림 신청(가짜 문) — 어떤 혜택 유형·가격대를 원하나
  | 'coupon_notify_add' | 'coupon_notify_remove'
  | 'shop_filter_click' | 'shop_page_change'
  // F-1. 쿠폰 상세에서의 의도 — 진짜 동작(예약) vs 가짜 문(구매) 클릭을 나눠 본다
  | 'coupon_reserve_click' | 'coupon_purchase_click'
  | 'meetings_empty_cta_click'
  | 'discover_gem_map_open'
  // G. 카카오 로그인 복귀 — 보던 추천 이어보기 제안(수락/새로 시작)
  | 'resume_prompt_shown' | 'resume_prompt_accept' | 'resume_prompt_discard'
  // H. 그룹 게스트 결과 화면 개인 유틸 — 길찾기·캘린더 저장(실제 이동 전환 관측)
  | 'guest_directions_click' | 'guest_calendar_add'
  // I. 상시 유저 피드백(우하단 FAB) — 원문은 user_feedback 테이블에만 남기고 여기엔 카운트만 싣는다
  // feedback_hint_shown/click: 피드백 유도 말풍선의 노출→탭 전환율(넛지 효과 측정)
  | 'feedback_open' | 'feedback_submit' | 'feedback_close' | 'feedback_send_fail'
  | 'feedback_hint_shown' | 'feedback_hint_click'
  // J. 탭 세션당 1회(새 광고 클릭으로 터치가 갱신되면 재발화) — 소스별 유입수의 분모.
  //    광고가 /app·/join으로 직행하면 landing_view가 안 쏘여
  //    "이 소재로 몇 명이 들어왔나"를 셀 방법이 아예 없다.
  | 'entry_view';

const PAUSE_KEY = 'mint_tracking_paused';

export function isTrackingPaused(): boolean {
  try { return localStorage.getItem(PAUSE_KEY) === 'true'; } catch { return false; }
}

export function setTrackingPaused(paused: boolean): void {
  try { localStorage.setItem(PAUSE_KEY, paused ? 'true' : 'false'); } catch { /* 저장소가 막힌 환경 — 추적 일시정지는 이번 세션에만 적용된다 */ }
}

function pushDataLayer(event: string) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event });
}

// ── 세션키: 한 탐색 에피소드(초기 추천→재시도→거절→선택)를 묶는 익명 키 ──
// Home이 추천 시작 시 발급/설정하고, 이후 발생하는 모든 이벤트에 자동으로 태깅된다.
let currentSessionKey: string | null = null;

export function newSessionKey(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* 폴백으로 진행 */ }
  return `sk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function setSessionKey(key: string | null): void {
  currentSessionKey = key;
}

// events 바깥(user_feedback 등)에 같은 에피소드로 조인할 키를 실어야 할 때 쓴다.
// 모듈 안에서만 알던 값이라 getter를 열었다 — 쓰기는 여전히 setSessionKey 하나뿐이다.
export function getSessionKey(): string | null {
  return currentSessionKey;
}

type EventPayload = Record<string, unknown>;

// ── 어트리뷰션 탑재: 호출부가 아니라 여기 한 곳에서 붙인다 ──
// session_key는 추천 플로우에서만 발급되므로 랜딩·탭·피드백·그룹 이벤트는 전용 이벤트와 조인할 수
// 없다 — 광고 판단에 꼭 필요한 퍼널 앞단이 통째로 빠진다. 그래서 모든 행의 payload에 직접 싣는다.
// 비용은 행당 100byte 남짓이고, 대신 어드민은 조인 없이 단일 순회로 소스별 퍼널을 그릴 수 있다.
// `_attr`은 예약 키다 — 기존 payload 키는 전부 snake_case라 충돌하지 않는다.
function withAttr(payload?: EventPayload): EventPayload | undefined {
  const attr = getAttr();
  if (!attr) return payload && Object.keys(payload).length > 0 ? payload : undefined;
  return { ...payload, _attr: attr };
}

export function trackEvent(type: Exclude<EventType, 'session_duration'>, payload?: EventPayload): void {
  if (isTrackingPaused()) return;
  pushDataLayer(type);
  const row: Record<string, unknown> = { type };
  if (currentSessionKey) row.session_key = currentSessionKey;
  const merged = withAttr(payload);
  if (merged) row.payload = merged;
  supabase.from('events').insert(row).then(({ error }) => {
    // 마이그레이션 전(session_key/payload 컬럼 부재 등)이면 최소 필드로 폴백 — 수집 자체는 절대 끊기지 않게
    if (error) supabase.from('events').insert({ type }).then(() => {});
  });
}

export function trackSessionDuration(seconds: number): void {
  if (isTrackingPaused()) return;
  const row: Record<string, unknown> = { type: 'session_duration', duration_seconds: seconds };
  if (currentSessionKey) row.session_key = currentSessionKey;
  // 세션(앱 진입 프록시)도 소스별로 갈라 봐야 광고 유입의 체류를 판단할 수 있다.
  const merged = withAttr();
  if (merged) row.payload = merged;
  supabase.from('events').insert(row).then(({ error }) => {
    if (error) supabase.from('events').insert({ type: 'session_duration', duration_seconds: seconds }).then(() => {});
  });
}

// 분석 지표 조회는 /api/admin/data(서버)로 이전 — anon select 제거
