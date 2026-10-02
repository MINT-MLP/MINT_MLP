import type { ResultSummary } from '@/types';

// 옛 카카오 로그인 복귀(/app?tab=profile)에서만 뜬다 — 10-02부터는 홈의 '이어서 하기' 카드가 이 역할을 한다.
// 그 사이 결과 화면이 사라진 것처럼 보이지만 스냅샷은 그대로 남아 있다 —
// 사용자가 홈 탭을 직접 찾아 누르게 두지 말고, 돌아갈지 한 번 물어본다.
//
// 배경을 눌러서는 닫히지 않는다. '새로 시작'이 저장된 추천을 지우는 파괴적 선택이라,
// 빗나간 터치로 실행되면 안 되고 둘 중 하나를 명시적으로 고르게 한다.
interface Props {
  summary: ResultSummary;
  onResume: () => void;
  onDiscard: () => void;
}

export default function ResumeRecommendSheet({ summary, onResume, onDiscard }: Props) {
  const course = summary.title;

  return (
    <div className="fixed inset-0 z-50 bg-black/40" role="presentation">
      <div
        className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-md rounded-t-3xl bg-white px-5 pt-5 pb-[max(2rem,calc(env(safe-area-inset-bottom)+0.75rem))] animate-fade-in-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resume-recommend-title"
      >
        <p id="resume-recommend-title" className="text-[18px] font-black text-gray-900">
          보던 추천으로 돌아갈까요?
        </p>
        <p className="mt-1.5 text-[13px] text-gray-500">
          로그인 전에 받아둔 추천이 그대로 남아 있어요.<br />
          새로 시작하면 이 추천은 홈에서 사라져요(지난 추천에는 남아요).
        </p>

        <div className="mt-4 rounded-2xl border border-gray-100 bg-mint-50 p-4">
          <p className="text-[15px] font-bold text-gray-900">{course}</p>
          <p className="mt-0.5 text-[13px] text-gray-500">가게 정보는 열 때 다시 불러와요</p>
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onDiscard}
            className="flex-1 rounded-2xl border border-gray-200 py-3.5 text-[15px] font-bold text-gray-500"
          >
            아니요, 새로 시작
          </button>
          <button
            type="button"
            onClick={onResume}
            className="flex-[1.6] rounded-2xl bg-mint-500 py-3.5 text-[15px] font-black text-white"
          >
            네, 돌아갈래요
          </button>
        </div>
      </div>
    </div>
  );
}
