import type { ResultSummary, ResultSnapshotV2 } from '@/types';
import { forgetResult } from '@/stores/resultMemory';
// 결과 스냅샷 — 새로고침·앱 전환 뒤 결과 화면을 되살리는 용도(24시간). 가게 정보는 넣지 않고 추천 ID만(10-01).
// 기기 지난 추천(mint_history_v1)은 없앴다 — 지난 추천은 회원 계정에만 있다.

export const RESULT_STORAGE_KEY = 'mint_last_result_v2';
// 10-01 이전 형식(가게 정보 통째). 앱 시작 때 지운다(storage/legacyCleanup).
export const LEGACY_RESULT_KEYS = ['mint_last_result_v1', 'mint_history_v1'];

// 입력 초안·그룹 세션 키 — 홈 바깥(로그인 복귀 안내 등)에서도 복원을 끊어야 해서 여기로 모았다.
export const INPUT_DRAFT_KEY = 'mint_input_draft_v1';
export const GROUP_SESSION_KEY = 'mint_group_session_v1';

// localStorage에 두는 이유: 모바일에서 앱을 벗어나면 웹뷰가 재시작되며 sessionStorage가 통째로 날아간다.
// 유효기간이 지난 스냅샷은 자동 복원하지 않는다(지난 약속이 불쑥 뜨지 않게).
const RESULT_TTL_MS = 24 * 60 * 60 * 1000;

// 같은 추천을 다시 저장할 때(복원 뒤 상태 갱신)는 처음 저장 시각을 유지한다 — 열 때마다 24시간이 연장되지 않게
export function saveResultSnapshot(snapshot: ResultSnapshotV2) {
  try {
    let savedAt = Date.now();
    const prev = JSON.parse(localStorage.getItem(RESULT_STORAGE_KEY) ?? 'null') as { savedAt?: number; snapshot?: { recommendationId?: number } } | null;
    if (prev?.snapshot?.recommendationId === snapshot.recommendationId && typeof prev.savedAt === 'number') savedAt = prev.savedAt;
    localStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify({ savedAt, snapshot }));
  } catch { /* 저장 실패는 치명적이지 않음 */ }
}

export function loadResultSnapshot(): ResultSnapshotV2 | null {
  try {
    const raw = localStorage.getItem(RESULT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const snap = parsed?.snapshot as ResultSnapshotV2 | undefined;
    if (typeof parsed?.savedAt !== 'number' || snap?.v !== 2 || typeof snap.recommendationId !== 'number') return null;
    if (Date.now() - parsed.savedAt > RESULT_TTL_MS) {
      localStorage.removeItem(RESULT_STORAGE_KEY);
      return null;
    }
    return snap;
  } catch {
    return null;
  }
}

export function clearResultSnapshot() {
  forgetResult();   // 탭 이동용 메모리도 함께 — 지운 결과가 탭 복귀 때 되살아나지 않게
  try {
    localStorage.removeItem(RESULT_STORAGE_KEY);
    sessionStorage.removeItem(RESULT_STORAGE_KEY);
  } catch { /* ignore */ }
}

// 다음에 홈을 열 때 "앱을 처음 켠 첫 화면"이 나오게 한다 — 결과 복원과 입력 초안 복원을 함께 끊는다.
// 결과만 지우면 입력 초안이 남아 마지막 단계로 되살아나므로 첫 화면이 아니게 된다.
export function clearRecommendSession() {
  clearResultSnapshot();
  try {
    localStorage.removeItem(INPUT_DRAFT_KEY);
    sessionStorage.removeItem(INPUT_DRAFT_KEY);
    localStorage.removeItem(GROUP_SESSION_KEY);
  } catch { /* ignore */ }
}

// "보던 추천이 아직 살아 있나"만 가볍게 확인할 때 쓴다(로그인 복귀 안내 등). 가게 이름은 없으니 지역·목적으로.
export function loadResultSummary(): ResultSummary | null {
  const snap = loadResultSnapshot();
  if (!snap) return null;
  const first = snap.purpose?.first;
  const second = snap.purpose?.second && snap.purpose.second !== '없음' && !snap.resultSecondMissing ? snap.purpose.second : null;
  const what = first ? (second ? `${first} → ${second}` : first) : '추천';
  return { title: snap.areaName ? `${snap.areaName}에서 ${what}` : what, areaName: snap.areaName || null };
}

// 결과·입력초안 모두 localStorage에 보관 — 홈버튼·공유로 앱을 벗어나 웹뷰가 재시작돼도 유지
// (sessionStorage는 모바일에서 프로세스 재시작 시 통째로 사라짐)
// 키 자체는 utils/history가 보유한다 — 홈 바깥에서도 복원을 끊어야 하므로.
export const INPUT_DRAFT_TTL_MS = 6 * 60 * 60 * 1000; // 입력하다 만 초안은 6시간까지만 복원
// 그룹 호스트 세션 — sessionId는 서버 세션의 유일한 열쇠라 state에만 두면 새로고침 시 링크·대기현황이 통째로 증발한다

export const GROUP_SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 그룹 대기 세션도 6시간까지만 복원

// 앱 홈의 '이어서 하기' 카드용 — 살아 있는 그룹 초대 링크(호스트)와 입력하다 만 초안
export function loadGroupSessionSummary(): { sessionId: string; hostToken: string | null; purposeFirst: string | null } | null {
  try {
    const g = JSON.parse(localStorage.getItem(GROUP_SESSION_KEY) ?? 'null') as
      { savedAt?: number; sessionId?: string; hostToken?: string; purpose?: { first?: string | null } } | null;
    if (!g?.sessionId) return null;
    if (typeof g.savedAt === 'number' && Date.now() - g.savedAt > GROUP_SESSION_TTL_MS) return null;
    return { sessionId: g.sessionId, hostToken: g.hostToken ?? null, purposeFirst: g.purpose?.first ?? null };
  } catch {
    return null;
  }
}

export function loadDraftSummary(): { appMode: 'solo' | 'group'; purposeFirst: string | null } | null {
  try {
    const d = JSON.parse(localStorage.getItem(INPUT_DRAFT_KEY) ?? 'null') as
      { savedAt?: number; appMode?: string; purpose?: { first?: string | null } } | null;
    if (!d || (d.appMode !== 'solo' && d.appMode !== 'group')) return null;
    if (typeof d.savedAt === 'number' && Date.now() - d.savedAt > INPUT_DRAFT_TTL_MS) return null;
    return { appMode: d.appMode, purposeFirst: d.purpose?.first ?? null };
  } catch {
    return null;
  }
}
