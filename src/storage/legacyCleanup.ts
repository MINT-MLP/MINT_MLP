import type { GuestCtxSaved } from '@/types';
import { LEGACY_RESULT_KEYS, INPUT_DRAFT_KEY, GROUP_SESSION_KEY } from '@/storage/history';

// 10-01 저장 정리 — 예전 폰 저장분 가운데 카카오 가게 정보·좌표가 든 것을 한 번 지운다.
// 지난 추천은 회원 계정으로 옮겼다(폰 데이터는 옮기지 않기로 함). 포인트는 기능 보류 중이라 그대로 둔다.
const DONE_KEY = 'mint_cleanup_v1';
// mint_wishlist는 목업 발굴 페이지(퍼블리싱)가 아직 쓰므로 지우지 않는다. 일반 화면은 더 이상 이 키를 쓰지 않는다.
const LEGACY_KEYS = [...LEGACY_RESULT_KEYS];

export function runLegacyCleanup(): void {
  cleanupGuestOrigins();
  try {
    if (localStorage.getItem(DONE_KEY)) return;
    for (const k of LEGACY_KEYS) localStorage.removeItem(k);
    // 입력 초안: 예전 형식(locations에 지명·좌표)이면 지운다(6시간짜리라 잃는 게 적다)
    const draft = localStorage.getItem(INPUT_DRAFT_KEY);
    if (draft && draft.includes('"locations"')) localStorage.removeItem(INPUT_DRAFT_KEY);
    // 그룹 세션: 호스트의 링크 정보라 지우지 않고 만날 장소 좌표만 뺀다
    const raw = localStorage.getItem(GROUP_SESSION_KEY);
    if (raw) {
      const g = JSON.parse(raw) as { meetingLocation?: { lat?: unknown; lng?: unknown } };
      if (g.meetingLocation) {
        delete g.meetingLocation.lat;
        delete g.meetingLocation.lng;
        localStorage.setItem(GROUP_SESSION_KEY, JSON.stringify(g));
      }
    }
    localStorage.setItem(DONE_KEY, '1');
  } catch { /* 저장소가 막힌 환경 — 다음 실행에서 다시 시도 */ }
}

// 10-02 — 그룹 게스트 저장본(mint_guest_ctx_*)의 출발지 이름·좌표를 뺀다. 이제는 검색어·장소 ID만 저장한다
function cleanupGuestOrigins(): void {
  try {
    if (localStorage.getItem('mint_cleanup_v2')) return;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k?.startsWith('mint_guest_ctx_')) continue;
      const c = JSON.parse(localStorage.getItem(k) ?? 'null') as Partial<GuestCtxSaved> | null;
      localStorage.setItem(k, JSON.stringify({
        locQuery: c?.locQuery ?? null, locPlaceId: c?.locPlaceId ?? null, chips: c?.chips ?? [], budget: c?.budget ?? null,
      } satisfies GuestCtxSaved));
    }
    localStorage.setItem('mint_cleanup_v2', '1');
  } catch { /* 다음 실행에서 다시 시도 */ }
}
