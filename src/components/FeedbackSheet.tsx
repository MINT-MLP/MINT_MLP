import { useEffect, useRef, useState } from 'react';
import { getDeviceId } from '@/storage/device';
import { trackEvent } from '@/services/analytics';
import {
  CATEGORY_OPTIONS, FEEDBACK_COUNTER_FROM, FEEDBACK_MAX_LEN, FEEDBACK_MIN_LEN,
  flushOutbox, loadDraft, saveDraftDebounced, submitFeedback, textLength,
} from '@/storage/feedback';
import type { FeedbackCategory } from '@/types';

interface Props {
  tab: string;          // AppShell의 activeTab — "어느 화면에서 나온 말인지" 자동으로 실린다
  onClose: () => void;
}

// 성공 화면이 스스로 물러나는 시간. 확인 버튼은 성급한 유저용, 이 타이머는 손이 안 가는 유저용이다.
const SUCCESS_AUTO_CLOSE_MS = 1800;

/**
 * iOS Safari는 키보드가 떠도 layout viewport를 줄이지 않아 fixed bottom-0 시트가 키보드 밑에 깔린다.
 * visualViewport로 가려진 높이를 재서 시트를 그만큼 위로 올린다(미지원 웹뷰는 inset 0 = 기존 동작).
 * 올릴 때 transform이 아니라 bottom을 쓰는 이유: 시트에 걸린 animate-fade-in-up이
 * transform을 both 필모드로 붙잡고 있어서 인라인 transform이 먹지 않는다.
 */
function useKeyboardInset(): { inset: number; visibleHeight: number | null } {
  const [state, setState] = useState<{ inset: number; visibleHeight: number | null }>({
    inset: 0, visibleHeight: null,
  });

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      setState({
        inset: Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop))),
        visibleHeight: Math.round(vv.height),
      });
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    };
  }, []);

  return state;
}

// 피드백 시트 — CouponDetailSheet/TreasurerPlanSheet와 같은 헤더/본문/CTA 3분할 바텀시트.
// 필수 입력은 텍스트 하나뿐이고, 보내기를 누른 순간 유저의 일은 끝난다(전송은 앱이 뒤에서 책임진다).
export default function FeedbackSheet({ tab, onClose }: Props) {
  // 초안 복원은 최초 렌더에서 끝낸다 — 마운트 후 setState로 덮으면 빈 입력창이 한 번 깜빡인다.
  const [draft] = useState(loadDraft);
  const [text, setText] = useState(draft?.text ?? '');
  const [category, setCategory] = useState<FeedbackCategory | null>(draft?.category ?? null);
  const [contact, setContact] = useState(draft?.contact ?? '');
  const [sent, setSent] = useState(false);

  const sheetRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const doneButtonRef = useRef<HTMLButtonElement | null>(null);
  const { inset, visibleHeight } = useKeyboardInset();

  const trimmed = text.trim();
  // 길이는 코드포인트로 센다 — 서버·DB(char_length)와 같은 단위여야 '👍' 하나짜리 피드백이
  // 여기선 통과하고 DB에서만 터지는 일이 안 생긴다(JS의 .length는 '👍'를 2로 센다).
  const textLen = textLength(text);
  const canSend = textLength(trimmed) >= FEEDBACK_MIN_LEN;

  // 열릴 때: 쓰기 의도로 열었으니 곧장 textarea에 포커스 → 밀린 아웃박스도 이참에 흘려보낸다.
  // 닫힐 때: 포커스를 열어준 요소(FAB)로 돌려준다.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    textareaRef.current?.focus();
    trackEvent('feedback_open', { device_id: getDeviceId(), tab, trigger: 'fab' });
    flushOutbox();
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 입력이 바뀔 때마다 초안 저장(디바운스). 제출 후에는 저장할 것도, 되살릴 것도 없다.
  useEffect(() => {
    if (sent) return;
    saveDraftDebounced({ text, category, contact });
  }, [text, category, contact, sent]);

  // 제출 성공 화면은 한 박자만 머문다.
  // onClose를 의존성에 두지 않고 ref로 읽는 이유: 부모가 인라인 화살표를 넘기면 리렌더마다
  // 참조가 바뀌어 이 타이머가 매번 리셋된다 — 성공 화면이 영영 안 닫힐 수 있다.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!sent) return;
    // 제출 버튼이 언마운트되며 포커스가 <body>로 날아가면, 시트 div에 걸린 keydown 핸들러를
    // 이벤트가 통과하지 않아 ESC도 탭 트랩도 죽는다. 성공 화면의 확인 버튼으로 데려온다.
    doneButtonRef.current?.focus();
    const timer = setTimeout(() => onCloseRef.current(), SUCCESS_AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [sent]);

  // 닫기·백드롭 탭에 "나가시겠어요?"를 붙이지 않는다 — 초안이 저장되므로 잃을 게 없고,
  // 그 확인 모달이야말로 마찰이다. 제출까지 간 경우는 close 이벤트로 세지 않는다(퍼널 분모 오염 방지).
  function close() {
    if (!sent) {
      trackEvent('feedback_close', { device_id: getDeviceId(), had_text: trimmed.length > 0 });
    }
    onClose();
  }

  function handleSubmit() {
    if (!canSend) return;
    submitFeedback({ text: trimmed, category, contact: contact.trim() || null, tab });
    trackEvent('feedback_submit', {
      device_id: getDeviceId(), tab, category,
      text_length: trimmed.length, has_contact: contact.trim().length > 0,
    });
    setSent(true); // submitFeedback이 이미 아웃박스 선저장 + 초안 삭제까지 끝냈다
  }

  // ESC로 닫기 + 포커스 트랩(라이브러리 없이 keydown 하나로). 시트 밖으로 탭이 새 나가지 않게 순환시킨다.
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const root = sheetRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>('button, textarea, input, a[href], [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    // 백드롭 닫기는 click이 아니라 pointerdown + 타깃 확인이다. click은 mousedown/mouseup의
    // 공통 조상에서 나므로, textarea 안에서 드래그로 글자를 고르다 백드롭 위에서 손을 떼면
    // 타깃이 백드롭이 되어 시트가 갑자기 닫혔다.
    <div
      className="fixed inset-0 z-50 bg-black/50"
      onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-sheet-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        className="fixed inset-x-0 z-50 mx-auto flex max-h-[85dvh] max-w-md flex-col rounded-t-3xl bg-mint-50 animate-fade-in-up transition-[bottom] duration-150"
        style={{ bottom: inset, ...(visibleHeight ? { maxHeight: visibleHeight - 16 } : {}) }}
      >
        {/* 헤더 */}
        <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-4">
          <span className="rounded-full bg-mint-100 px-3 py-1 text-xs font-black text-mint-600">피드백</span>
          <button onClick={close} className="px-2 text-sm font-bold text-gray-400 active:scale-95">닫기</button>
        </div>

        {sent ? (
          // 성공은 토스트가 아니라 화면이다 — "빠르게 반영하겠다"는 약속은 한 박자 머물러야 전달된다.
          <div className="px-6 pb-[max(1.5rem,calc(env(safe-area-inset-bottom)+0.75rem))] pt-2 text-center">
            <div className="mb-3 text-5xl">🌱</div>
            <p id="feedback-sheet-title" className="text-lg font-black text-gray-900">잘 받았어요!</p>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-500 break-keep">
              보내주신 의견은 <span className="font-black text-mint-600">전부 읽고</span>,<br />
              다음 업데이트에 빠르게 반영할게요.
            </p>
            <button
              ref={doneButtonRef}
              onClick={onClose}
              className="mt-5 w-full rounded-2xl bg-mint-500 py-3.5 font-black text-white transition-transform active:scale-[0.98]"
            >
              확인
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 pb-4">
              <h2 id="feedback-sheet-title" className="text-[20px] font-black leading-snug text-gray-900 break-keep">
                어떤 피드백이든 남겨주세요
              </h2>
              <p className="mt-1 text-sm text-gray-500 break-keep">한 줄이면 충분해요. 빠르게 반영할게요 🌱</p>

              <div className="relative mt-3">
                <textarea
                  ref={textareaRef}
                  value={text}
                  // maxLength 속성과 .slice()는 둘 다 UTF-16 코드유닛을 세므로 500번째 자리에
                  // 이모지가 걸리면 서로게이트 쌍을 반으로 자른다. 그렇게 잘린 문자열은 서버가
                  // 400으로 거절하고, 클라는 400을 영구 실패로 보고 버린다 — 긴 글이 통째로 사라진다.
                  onChange={(e) => setText([...e.target.value].slice(0, FEEDBACK_MAX_LEN).join(''))}
                  rows={3}
                  placeholder="예: 추천이 좀 멀어요 / 이런 기능 있으면 좋겠어요"
                  className="w-full resize-none rounded-2xl border-2 border-gray-200 bg-white px-4 py-3 text-sm leading-relaxed outline-none focus:border-mint-500"
                />
                {textLen >= FEEDBACK_COUNTER_FROM && (
                  <span className="absolute bottom-3 right-3 text-[11px] text-gray-400">
                    {textLen}/{FEEDBACK_MAX_LEN}
                  </span>
                )}
              </div>

              {/* 분류는 순수 보너스다 — 안 골라도 보낼 수 있고, 다시 누르면 해제된다. */}
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {CATEGORY_OPTIONS.map((opt) => {
                  const on = category === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setCategory(on ? null : opt.value)}
                      aria-pressed={on}
                      className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors active:scale-95 ${
                        on ? 'border-mint-500 bg-mint-100 text-mint-600' : 'border-gray-200 bg-white text-gray-500'
                      }`}
                    >
                      {opt.emoji} {opt.label}
                    </button>
                  );
                })}
              </div>

              {/* 연락처를 필수로 두는 순간 "귀찮은 설문"이 되고, 신원 노출 부담에
                  가장 값진 부정적 피드백부터 먼저 사라진다. 그래서 끝까지 선택이다. */}
              <input
                type="text"
                value={contact}
                onChange={(e) => setContact(e.target.value.slice(0, 100))}
                placeholder="답변 받고 싶다면 (선택)"
                className="mt-2.5 w-full rounded-2xl border-2 border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-mint-500"
              />
            </div>

            {/* 하단 고정 CTA — 전송 스피너는 없다. 누르는 즉시 성공이고, 실패는 앱이 뒤에서 재시도한다. */}
            <div className="shrink-0 border-t border-gray-100 bg-white px-5 pt-3 pb-[max(1.5rem,calc(env(safe-area-inset-bottom)+0.75rem))]">
              <button
                onClick={handleSubmit}
                disabled={!canSend}
                className={`w-full rounded-2xl py-4 text-base font-black transition-transform active:scale-95 ${
                  canSend ? 'bg-mint-500 text-white shadow-lg shadow-mint-500/30' : 'bg-gray-200 text-gray-400'
                }`}
              >
                보내기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
