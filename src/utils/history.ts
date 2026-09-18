import type { ResultSummary, HistoryEntry } from '@/types';
// 추천 히스토리 — localStorage에 최근 5개 보관.
// snapshot은 Home의 결과 복원 스냅샷(RESULT_STORAGE_KEY 포맷) 그대로라,
// 히스토리 클릭 시 스냅샷을 심고 /app으로 이동하면 결과 화면이 그대로 살아난다.

export const RESULT_STORAGE_KEY = 'mint_last_result_v1';
const HISTORY_KEY = 'mint_history_v1';
const MAX_ENTRIES = 5;

// 입력 초안·그룹 세션 키 — 원래 Home 안에 있었지만, 홈 바깥(로그인 복귀 안내 등)에서도
// "다음에 홈을 열 때 무엇이 되살아나는가"를 통째로 끊어야 해서 여기로 모았다.
export const INPUT_DRAFT_KEY = 'mint_input_draft_v1';
export const GROUP_SESSION_KEY = 'mint_group_session_v1';

// 결과 스냅샷은 localStorage에 보관 — 모바일에서 홈버튼·카톡 공유 등으로 앱을 벗어나면
// OS가 웹뷰 프로세스를 재시작하며 sessionStorage가 통째로 날아가 추천이 초기화되던 문제 방지.
// 유효기간이 지난 스냅샷은 자동 복원하지 않는다 (지난 약속이 불쑥 뜨지 않게 — 히스토리로는 여전히 열람 가능)
const RESULT_TTL_MS = 24 * 60 * 60 * 1000;

export function saveResultSnapshot(snapshot: unknown) {
  try {
    localStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), snapshot }));
  } catch { /* 저장 실패는 치명적이지 않음 */ }
}

export function loadResultSnapshot(): unknown | null {
  try {
    const raw = localStorage.getItem(RESULT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.savedAt === 'number' && parsed.snapshot) {
        if (Date.now() - parsed.savedAt <= RESULT_TTL_MS) return parsed.snapshot;
        localStorage.removeItem(RESULT_STORAGE_KEY);
        return null;
      }
    }
    // 구버전(sessionStorage 직저장) 스냅샷 마이그레이션 — 배포 시점에 결과 화면이던 세션 보호
    const legacy = sessionStorage.getItem(RESULT_STORAGE_KEY);
    if (legacy) {
      const snapshot = JSON.parse(legacy);
      sessionStorage.removeItem(RESULT_STORAGE_KEY);
      saveResultSnapshot(snapshot);
      return snapshot;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearResultSnapshot() {
  try {
    localStorage.removeItem(RESULT_STORAGE_KEY);
    sessionStorage.removeItem(RESULT_STORAGE_KEY);
  } catch { /* ignore */ }
}

// 다음에 홈을 열 때 "앱을 처음 켠 첫 화면"이 나오게 한다 — 결과 복원과 입력 초안 복원을 함께 끊는다.
// 결과만 지우면 입력 초안이 남아 마지막 단계로 되살아나므로 첫 화면이 아니게 된다.
// 추천 자체는 히스토리(mint_history_v1)에 남아 '지난 추천'으로 다시 열 수 있다.
export function clearRecommendSession() {
  clearResultSnapshot();
  try {
    localStorage.removeItem(INPUT_DRAFT_KEY);
    sessionStorage.removeItem(INPUT_DRAFT_KEY);
    localStorage.removeItem(GROUP_SESSION_KEY);
  } catch { /* ignore */ }
}

// "보던 추천이 아직 살아 있나"만 가볍게 확인할 때 쓴다(로그인 복귀 안내 등).
// Home의 스냅샷 전체 타입을 셸까지 끌고 오지 않으려고 표시에 필요한 필드만 좁혀 읽는다.
// TTL 판정은 loadResultSnapshot에 맡긴다 — 만료된 추천은 여기서도 없는 것으로 취급된다.

export function loadResultSummary(): ResultSummary | null {
  const snapshot = loadResultSnapshot() as {
    result?: { placeName?: unknown }[];
    purpose?: { second?: unknown };
    midpointData?: { areaName?: unknown };
  } | null;

  const first = snapshot?.result?.[0];
  if (!first || typeof first.placeName !== 'string' || !first.placeName) return null;

  // 2차 장소는 '2차 코스를 고른 경우'에만 의미가 있다 — Home이 히스토리를 쌓는 규칙과 같게 맞춘다.
  const second = snapshot?.result?.[1];
  const hasSecondCourse =
    typeof snapshot?.purpose?.second === 'string' && snapshot.purpose.second !== '없음';
  const areaName = snapshot?.midpointData?.areaName;

  return {
    placeName: first.placeName,
    secondPlaceName:
      hasSecondCourse && typeof second?.placeName === 'string' && second.placeName
        ? second.placeName
        : null,
    areaName: typeof areaName === 'string' && areaName ? areaName : null,
  };
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is HistoryEntry =>
        !!e && typeof e === 'object' && typeof e.placeName === 'string' && typeof e.savedAt === 'number' && !!e.snapshot,
    );
  } catch {
    return [];
  }
}

export function saveHistory(entry: HistoryEntry) {
  try {
    // 같은 코스(1차+2차 조합)는 최신 것 하나만 유지
    const rest = loadHistory().filter(
      (e) => !(e.placeName === entry.placeName && (e.secondPlaceName ?? null) === (entry.secondPlaceName ?? null)),
    );
    localStorage.setItem(HISTORY_KEY, JSON.stringify([entry, ...rest].slice(0, MAX_ENTRIES)));
  } catch { /* 저장 실패는 치명적이지 않음 */ }
}

// 히스토리 항목을 결과 화면으로 복원 — 스냅샷을 심고 /app으로 이동
export function openHistoryEntry(entry: HistoryEntry) {
  saveResultSnapshot(entry.snapshot);
  window.location.pathname = '/app';
}

// 결과·입력초안 모두 localStorage에 보관 — 홈버튼·공유로 앱을 벗어나 웹뷰가 재시작돼도 유지
// (sessionStorage는 모바일에서 프로세스 재시작 시 통째로 사라짐)
// 키 자체는 utils/history가 보유한다 — 홈 바깥에서도 복원을 끊어야 하므로.
export const INPUT_DRAFT_TTL_MS = 6 * 60 * 60 * 1000; // 입력하다 만 초안은 6시간까지만 복원
// 그룹 호스트 세션 — sessionId는 서버 세션의 유일한 열쇠라 state에만 두면 새로고침 시 링크·대기현황이 통째로 증발한다

export const GROUP_SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 그룹 대기 세션도 6시간까지만 복원
