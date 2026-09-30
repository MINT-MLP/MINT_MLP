// 재방문(리텐션) 기록 — 기기당 KST 하루 1회. 2026-10-01부터 수집(어드민 배너의 날짜와 짝).
//
// 신뢰 원천은 DB다: record_visit()가 (device_id, visit_date) 유니크로 중복을 막고 날짜도 서버 now()로 정한다.
// 여기의 localStorage 날짜 키는 같은 날 반복 RPC를 아끼는 캐시일 뿐이다.
// 서버리스 함수를 새로 만들지 않는 이유: Vercel Hobby 12개 한도 — sql/user-visits.sql 참고.

import { supabase } from '@/services/supabase';
import { getDeviceId } from '@/storage/device';
import { isTrackingPaused } from '@/services/analytics';
import { isBot } from '@/services/attribution';

const DAY_KEY = 'mint_visit_day_v1';
let inflight = false;

// 'YYYY-MM-DD' (KST). Intl이 timeZone을 거부하는 구형 환경이면 UTC 날짜 — 최악은 RPC 한 번 더이고 DB가 흡수한다.
export function kstDay(now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function recordVisitIfNewDay(): void {
  if (isTrackingPaused() || isBot()) return;
  const path = window.location.pathname;
  // 운영자 자신은 세지 않는다
  if (path.startsWith('/admin') || path.startsWith('/pilot-admin')) return;
  const today = kstDay();
  try {
    if (localStorage.getItem(DAY_KEY) === today) return;
  } catch { /* 저장소 막힘 — 서버 유니크가 막는다 */ }
  if (inflight) return;
  inflight = true;
  void supabase.rpc('record_visit', { p_device_id: getDeviceId(), p_path: path.slice(0, 100) })
    .then(({ error }) => {
      inflight = false;
      // sql/user-visits.sql 미실행 등 — 조용히 넘기고 다음 로드에서 다시 시도한다(수집이 앱을 깨면 안 된다)
      if (error) return;
      try { localStorage.setItem(DAY_KEY, today); } catch { /* 무해 */ }
    }, () => { inflight = false; });
}

// 문서 로드 1회 + 탭이 다시 보일 때마다. 홈 화면에 설치된 PWA는 며칠을 새로고침 없이 살아 있어서
// 로드 시점만 보면 가장 충성도 높은 유저의 재방문이 통째로 빠진다.
export function bindVisitTracking(): void {
  recordVisitIfNewDay();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') recordVisitIfNewDay();
  });
}
