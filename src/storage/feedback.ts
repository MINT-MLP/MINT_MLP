// 상시 유저 피드백 — 초안 보관 · 아웃박스 선저장 · 재전송.
//
// 핵심 원리는 "선저장 후전송"이다. 유저가 보내기를 누른 순간 payload를 먼저 localStorage에 쓰고,
// 그 다음에야 네트워크를 탄다. 네트워크는 전송 수단일 뿐 진실의 원본이 아니다 —
// 그래서 화면은 전송 결과를 기다리지 않고 즉시 성공으로 넘어가도 거짓말이 아니다.

import { getDeviceId } from '@/storage/device';
import { getSessionKey, trackEvent } from '@/services/analytics';
import type { FeedbackCategory, FeedbackDraft, FeedbackPayload, FeedbackInput } from '@/types';
import type { IconName } from '@/components/icons';

const DRAFT_KEY = 'mint_feedback_draft';
const OUTBOX_KEY = 'mint_feedback_outbox';

// 쓰다 만 불만은 하루쯤 유효하다 — 입력 초안(6시간)보다 넉넉하게 잡는다.
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
// 넘치면 오래된 것부터 밀려난다. 오래된 미전송 건이야말로 못 보낸 채 쌓인 것이라 더 소중하므로,
// 밀어내기가 애초에 일어나지 않을 만큼 넉넉히 잡는다(한 건이 1KB 남짓이라 용량 부담이 없다).
const OUTBOX_MAX = 50;
// 이 엔드포인트는 요청 하나에 Supabase 왕복이 여러 번이라 콜드스타트가 겹치면 5초를 쉽게 넘겼다.
// 타임아웃이 나면 서버는 이미 저장했는데 클라만 실패로 알고 재시도해 레이트리밋을 태운다.
const SEND_TIMEOUT_MS = 12_000;

// 길이는 "문자(코드포인트)" 단위다 — 서버·DB(char_length)와 같은 단위여야 한다.
// JS의 .length는 UTF-16 코드유닛이라 '👍'가 2로 잡힌다. 그 차이 때문에 이모지 한 글자짜리
// 피드백이 클라·서버를 통과하고 DB에서만 터지는 버그가 있었다.
export function textLength(s: string): number {
  return [...s].length;
}

// 👍 한 글자도 충분히 유효한 피드백이다. 하한을 2로 두면 그게 막힌다.
export const FEEDBACK_MIN_LEN = 1;
export const FEEDBACK_MAX_LEN = 500;
// 카운터를 처음부터 보여주면 "길게 써야 하나?" 압박이 된다. 한계가 가까워질 때만 켠다.
export const FEEDBACK_COUNTER_FROM = 400;

// 미선택 허용 — 자동 추론은 오분류 시 어드민 데이터만 오염시킨다. 어차피 원문은 사람이 읽는다.
export const CATEGORY_OPTIONS: { value: FeedbackCategory; icon: IconName; label: string }[] = [
  { value: 'bug', icon: 'bug', label: '버그' },
  { value: 'pain', icon: 'sad', label: '불편해요' },
  { value: 'idea', icon: 'bulb', label: '아이디어' },
  { value: 'praise', icon: 'heart', label: '칭찬' },
];

function isCategory(v: unknown): v is FeedbackCategory {
  return v === 'bug' || v === 'pain' || v === 'idea' || v === 'praise';
}

// pilot의 'pf' 패턴 답습 — 혼동문자를 뺀 소문자·숫자 14자. 서버 PK라 멱등성 키를 겸한다.
function makeFeedbackId(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let id = 'fb';
  for (let i = 0; i < 14; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

/* ── 초안 ── */

let draftTimer: ReturnType<typeof setTimeout> | null = null;

export function loadDraft(): FeedbackDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FeedbackDraft> | null;
    if (!parsed || typeof parsed.text !== 'string' || typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return {
      text: parsed.text,
      category: isCategory(parsed.category) ? parsed.category : null,
      contact: typeof parsed.contact === 'string' ? parsed.contact : '',
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

// 입력이 바뀔 때마다 부르되 실제 쓰기는 500ms 뒤 한 번 — 타이핑마다 JSON.stringify 하지 않는다.
export function saveDraftDebounced(draft: Omit<FeedbackDraft, 'savedAt'>): void {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    draftTimer = null;
    try {
      if (!draft.text.trim() && !draft.contact.trim() && draft.category == null) {
        localStorage.removeItem(DRAFT_KEY);
        return;
      }
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
    } catch { /* 저장 실패는 치명적이지 않음 */ }
  }, 500);
}

// 예약된 디바운스 쓰기까지 같이 취소한다 — 안 그러면 제출 직후 지운 초안이 500ms 뒤 되살아난다.
export function clearDraft(): void {
  if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

/* ── 아웃박스 ── */

function readOutbox(): FeedbackPayload[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is FeedbackPayload =>
        !!p && typeof p === 'object' &&
        typeof (p as FeedbackPayload).id === 'string' &&
        typeof (p as FeedbackPayload).text === 'string',
    );
  } catch {
    return [];
  }
}

// localStorage에 못 쓰는 환경(쿠키 차단·프라이빗 모드·일부 인앱 웹뷰)이 실제로 있다.
// 거기서 쓰기 실패를 그냥 삼키면 "선저장 후전송"의 선저장이 없었던 게 되고, 전송까지 실패하면
// 유저가 쓴 문장이 어디에도 남지 않은 채 사라진다 — 화면은 이미 "잘 받았어요"라고 말한 뒤에.
// 그래서 최소한 이 세션 동안만이라도 메모리에 붙들어 둔다. 탭을 닫으면 잃지만, 그 전까지는 재시도된다.
let memoryOutbox: FeedbackPayload[] = [];

function writeOutbox(items: FeedbackPayload[]): boolean {
  try {
    if (items.length === 0) localStorage.removeItem(OUTBOX_KEY);
    else localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
    memoryOutbox = [];
    return true;
  } catch {
    memoryOutbox = items;
    return false;
  }
}

// 저장소와 메모리를 합쳐서 본다 — 위 폴백으로 메모리에만 있는 건이 재전송에서 빠지면 안 된다.
function pendingOutbox(): FeedbackPayload[] {
  const stored = readOutbox();
  const seen = new Set(stored.map((p) => p.id));
  return [...stored, ...memoryOutbox.filter((p) => !seen.has(p.id))];
}

function dropFromOutbox(id: string): void {
  memoryOutbox = memoryOutbox.filter((p) => p.id !== id);
  const stored = readOutbox();
  if (stored.some((p) => p.id === id)) writeOutbox(stored.filter((p) => p.id !== id));
}

// 전송 1건. 성공/영구실패면 아웃박스에서 빼고, 일시적 실패면 남겨 다음 기회를 노린다.
async function send(payload: FeedbackPayload): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (res.ok) {
      dropFromOutbox(payload.id);
      return;
    }
    // 400은 서버가 영원히 받아주지 않을 형식이다. 계속 재전송해봐야 아웃박스 자리만 막는다.
    // 429/5xx는 "지금은 안 되지만 나중엔 된다"이므로 그대로 둔다.
    if (res.status === 400) {
      dropFromOutbox(payload.id);
      return;
    }
    trackEvent('feedback_send_fail', { device_id: getDeviceId(), reason: 'server' });
  } catch {
    // 타임아웃·오프라인 — 유저에게 알리지 않는다. 앱을 다시 켜면 알아서 다시 보낸다.
    trackEvent('feedback_send_fail', { device_id: getDeviceId(), reason: 'network' });
  } finally {
    clearTimeout(timer);
  }
}

// 앱을 켤 때(AppShell 마운트) · 피드백 시트를 열 때 각각 1회 — 밀린 건을 조용히 흘려보낸다.
// 서버가 id PK 충돌을 ok로 응답하므로 중복 저장은 구조적으로 불가능하다.
//
// 한 건씩 순서대로 보낸다(예전엔 최대치를 한꺼번에 쐈다). 서버 레이트리밋은 분당 카운트라
// 동시에 여러 건을 쏘면 뒤쪽이 429를 맞고, 더 나쁘게는 그 직후 유저가 새로 쓴 피드백 자신이
// 밀린 건들에 밀려 429가 됐다. 밀린 건은 급하지 않다 — 순서대로 천천히 보내는 게 맞다.
// flushing 가드: 앱 켜기 flush와 시트 열기 flush가 겹쳐 같은 건을 두 번 쏘는 걸 막는다.
let flushing = false;

export function flushOutbox(): void {
  if (flushing) return;
  const pending = pendingOutbox();
  if (pending.length === 0) return;
  flushing = true;
  void (async () => {
    try {
      for (const payload of pending) await send(payload);
    } finally {
      flushing = false;
    }
  })();
}

// 탭을 닫거나 백그라운드로 보낼 때의 마지막 한 번.
// 광고로 들어온 사람은 대개 앱을 다시 켜지 않는다. 재전송 기회가 "앱 켜기"와 "시트 열기"뿐이면
// 그 사람의 밀린 피드백은 영영 못 나간다. sendBeacon은 문서가 사라져도 브라우저가 끝까지 보낸다.
// 서버는 같은 id를 23505로 흡수하므로 중복 전송이어도 안전하다.
function beaconPending(): void {
  const pending = pendingOutbox();
  if (pending.length === 0) return;
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return;
  for (const payload of pending) {
    try {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon('/api/feedback', blob);
    } catch { /* 보낼 수 있으면 보내고, 아니면 다음 기회에 */ }
  }
}

// AppShell이 한 번 호출한다. pagehide는 iOS 사파리에서 unload보다 신뢰할 수 있고,
// visibilitychange(hidden)는 앱 전환·탭 이동까지 잡는다. 둘 다 걸어야 실제로 놓치지 않는다.
let exitHookBound = false;

export function bindOutboxExitFlush(): void {
  if (exitHookBound || typeof window === 'undefined') return;
  exitHookBound = true;
  window.addEventListener('pagehide', beaconPending);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') beaconPending();
  });
}

/* ── 제출 ── */

/**
 * 제출 — 아웃박스에 먼저 쓰고 전송을 시작한다(결과를 기다리지 않는다).
 * 호출부는 이 함수가 돌아온 직후 성공 화면으로 넘어가면 된다.
 */
export function submitFeedback(input: FeedbackInput): void {
  // 자를 때도 코드포인트 단위여야 한다. .slice(0, 500)은 500번째 자리에 이모지가 걸리면
  // 서로게이트 쌍을 반으로 잘라 고립 서로게이트를 남기고, 그건 Postgres의 json 파서가 거부한다
  // → 400 → 클라가 "영구 실패"로 보고 아웃박스에서 지운다. 긴 피드백이 통째로 사라진다.
  const text = [...input.text.trim()].slice(0, FEEDBACK_MAX_LEN).join('');
  if (textLength(text) < FEEDBACK_MIN_LEN) return;
  const contact = input.contact?.trim().slice(0, 100) || null;

  const payload: FeedbackPayload = {
    id: makeFeedbackId(),
    text,
    category: input.category,
    contact,
    context: {
      route: window.location.pathname,
      tab: input.tab,
      sessionKey: getSessionKey(),
      deviceId: getDeviceId(),
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    },
  };

  // [1] 선저장 — 여기까지 오면 이 문장은 보존됐다(저장소가 막혔으면 최소한 메모리에라도).
  writeOutbox([...pendingOutbox(), payload].slice(-OUTBOX_MAX));
  clearDraft();
  // [2] 후전송 — 실패해도 아웃박스에 남아 다음 실행 때 재시도된다.
  void send(payload);
}
