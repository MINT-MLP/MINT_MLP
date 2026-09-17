import { useEffect, useState } from 'react';
import { IconFeedback } from '@/components/icons';
import { trackEvent } from '@/utils/analytics';
import { getDeviceId } from '@/utils/points';

interface Props {
  hidden: boolean;      // 피드백 시트가 열려 있는 동안엔 비운다(언마운트는 하지 않는다 — 아래 주석)
  onOpen: () => void;
}

// 한 번이라도 피드백을 연 유저 → 유도 말풍선을 영구 중단한다(AppShell이 열 때 심는다).
export const FEEDBACK_OPENED_KEY = 'mint_feedback_opened';
// 유도 말풍선 정책 — '평생 1회'로는 약해서(피드백 열람이 2건뿐이었다) 참여할 때까지 조른다.
// 단 매번은 구걸이라: 세션당 1회 + 누적 NUDGE_MAX회까지만. 참여하면 즉시 멈춘다.
const NUDGE_COUNT_KEY = 'mint_feedback_nudge_count';       // 누적 노출 횟수(세션 무관)
const NUDGE_SESSION_KEY = 'mint_feedback_nudge_session';   // 이번 세션에 이미 띄웠는지
const NUDGE_MAX = 5;                                       // 이 횟수까지만 조른다(이후 조용히)
const NUDGE_DELAY_MS = 1400;   // 화면이 자리를 잡은 뒤에 말을 건다
const NUDGE_LIFE_MS = 6500;    // 읽고 결정할 만큼 넉넉히

// 우하단 피드백 진입점. AppShell이 탭바를 보여줄 때만 마운트되므로
// 입력 스텝 중·결과 화면·바텀시트가 열린 동안은 규칙 하나로 알아서 사라진다.
// 왼쪽이 아니라 오른쪽인 이유: 폰을 한 손으로 쥐면 엄지가 가장 편하게 닿는 구석이 오른쪽 아래고,
// 떠 있는 동그란 말풍선이 거기 있으면 "여기 눌러 말 걸어라"로 이미 읽힌다(다들 그 자리에 둔다).
// 학습 비용 0이어야 피드백이 실제로 쌓인다.
// 컬럼(max-w-md)에 붙이는 이유: 앱 콘텐츠가 전부 가운데 컬럼이라 뷰포트 구석에 붙이면
// 데스크톱에서 혼자 화면 끝으로 떨어져 나간다.
export default function FeedbackFab({ hidden, onOpen }: Props) {
  const [scrolling, setScrolling] = useState(false);
  const [nudge, setNudge] = useState(false);

  // 스크롤 중에는 살짝 물러난다. 치우지는 않되 읽기를 방해하지 않는 최소한의 예의.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      setScrolling(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setScrolling(false), 350);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // 유도 말풍선 — "MINT의 첫 번째 유저가 되어주세요". 참여(피드백 열기) 전까지, 세션당 1회·누적 NUDGE_MAX회.
  // 소멸이 아니라 '노출 시점'에 기록한다: 이 FAB은 탭바와 함께 조건부 마운트라, 말풍선이 떠 있는 동안
  // 입력 스텝으로 들어가면 언마운트되며 dismiss가 안 불린다(소멸 시 기록하면 매번 다시 뜬다).
  useEffect(() => {
    try {
      if (localStorage.getItem(FEEDBACK_OPENED_KEY)) return;   // 이미 참여 → 끝
      if (sessionStorage.getItem(NUDGE_SESSION_KEY)) return;   // 이번 세션 이미 노출
      if (Number(localStorage.getItem(NUDGE_COUNT_KEY) || '0') >= NUDGE_MAX) return; // 충분히 졸랐음
    } catch {
      return; // localStorage를 못 쓰는 환경이면 넛지도 포기한다(매번 뜨는 게 더 나쁘다)
    }

    let alive = false;
    const dismiss = () => {
      if (!alive) return;
      alive = false;
      setNudge(false);
      window.removeEventListener('pointerdown', dismiss);
    };
    const showTimer = setTimeout(() => {
      alive = true;
      setNudge(true);
      try {
        sessionStorage.setItem(NUDGE_SESSION_KEY, '1');
        localStorage.setItem(NUDGE_COUNT_KEY, String(Number(localStorage.getItem(NUDGE_COUNT_KEY) || '0') + 1));
      } catch { /* ignore */ }
      trackEvent('feedback_hint_shown', { device_id: getDeviceId() });
      // 바깥 아무 곳이나 누르면 닫는다. 말풍선/버튼 자체 탭은 각자 pointerdown에서 stopPropagation.
      window.addEventListener('pointerdown', dismiss);
    }, NUDGE_DELAY_MS);
    const hideTimer = setTimeout(dismiss, NUDGE_DELAY_MS + NUDGE_LIFE_MS);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      window.removeEventListener('pointerdown', dismiss);
    };
  }, []);

  return (
    // 시트가 열려도 언마운트하지 않는 이유: 닫을 때 포커스를 이 버튼으로 돌려줘야 한다.
    // 대신 투명하게 비우고 탭 순서에서 뺀다(시트의 포커스 트랩과 싸우지 않게).
    <div
      className="pointer-events-none fixed inset-x-0 z-40"
      style={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }}
    >
      {/* 말풍선이 버튼 왼쪽에 서고 둘이 오른쪽 끝으로 정렬된다 — 꼬리도 따라서 오른쪽을 본다. */}
      <div className="mx-auto flex max-w-md items-center justify-end gap-2 px-4">
        {nudge && !hidden && (
          // 말풍선 자체가 버튼 — 탭하면 바로 피드백 시트가 열린다(학습 비용 0).
          // MINT가 말 거는 카드톤: 흰 배경 + 민트 그라데이션 아바타 + 민트 액센트(결과·정보 카드와 동일 언어).
          <button
            onClick={() => { trackEvent('feedback_hint_click', { device_id: getDeviceId() }); onOpen(); }}
            onPointerDown={(e) => e.stopPropagation()}
            className="group pointer-events-auto relative flex max-w-[16.5rem] items-center gap-2.5 rounded-[1.25rem] bg-[#E8F8F5] py-2 pl-2 pr-3.5 text-left shadow-xl shadow-[#2AB5A0]/20 ring-1 ring-[#3CDBC0]/35 animate-fade-in-up active:scale-[0.97]"
          >
            {/* 우리 마스코트(민트 병아리) — 옅은 민트 카드 위에서 묻히지 않게 흰 원 위에 얹는다 */}
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white shadow-sm shadow-[#2AB5A0]/25 ring-1 ring-[#3CDBC0]/20">
              <img src="/image/mascot-bird.webp" alt="" aria-hidden="true" className="h-7 w-7 select-none" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-black leading-tight text-gray-800">어떤 피드백이든 남겨주세요!</span>
              <span className="mt-0.5 flex items-center gap-1 text-[11px] font-bold text-[#1A7A6E]">
                짧은 한마디도 큰 힘이 돼요
                <span className="transition-transform group-active:translate-x-0.5">→</span>
              </span>
            </span>
            {/* 꼬리 — 카드와 같은 옅은 민트가 오른쪽 FAB을 향해 뾰족하게 나온다.
                카드 본문 위에 겹쳐 그려져 안쪽 이음새는 보이지 않고 바깥 모서리만 point가 된다. */}
            <span
              aria-hidden
              className="absolute -right-[5px] top-1/2 h-3 w-3 -translate-y-1/2 rotate-45 rounded-[3px] bg-[#E8F8F5]"
            />
          </button>
        )}

        {/* 버튼 + 시선 유도용 펄스 링(말풍선이 떠 있는 동안만) */}
        <div className="pointer-events-none relative shrink-0">
          {nudge && !hidden && (
            <span aria-hidden className="absolute inset-0 rounded-full bg-[#3CDBC0] opacity-50 animate-ping" />
          )}
          <button
            onClick={onOpen}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="피드백 남기기"
            tabIndex={hidden ? -1 : 0}
            className={`relative flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#3CDBC0] to-[#2AB5A0] text-white shadow-lg shadow-[#2AB5A0]/30 transition-[opacity,transform] duration-200 ${
              hidden ? 'opacity-0' : 'pointer-events-auto'
            } ${!hidden && scrolling ? 'scale-90 opacity-50' : ''} active:scale-95`}
          >
            <IconFeedback className="h-[22px] w-[22px]" strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}
