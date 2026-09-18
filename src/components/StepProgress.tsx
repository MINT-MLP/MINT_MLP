interface Props {
  current: number;
  total: number;
  labels?: string[];
  /** 있으면 각 스텝을 클릭해 해당 단계로 점프할 수 있게 한다. 없으면 순수 표시(기존 동작). */
  onStepClick?: (index: number) => void;
  /** 특정 스텝 클릭 허용 여부. 생략 시 onStepClick이 있으면 현재 단계가 아닌 모든 스텝을 허용. */
  isStepClickable?: (index: number) => boolean;
}

const DEFAULT_LABELS = ['모임·목적', '관계', '지역·장소', '분위기', '추천'];

export default function StepProgress({ current, total, labels, onStepClick, isStepClickable }: Props) {
  const STEP_LABELS = labels ?? DEFAULT_LABELS;
  // 결과 화면에서 current=total(전 단계 완료)로 넘겨도 마스코트가 밖으로 날아가지 않게 클램프.
  const progress = total > 1 ? Math.min(1, current / (total - 1)) : 0;
  return (
    <div className="w-full px-4 pt-6 pb-2">
      <div className="relative">
        <div className="flex items-center justify-between mb-3">
          {STEP_LABELS.slice(0, total).map((label, i) => {
            const clickable = !!onStepClick && (isStepClickable ? isStepClickable(i) : i !== current);
            const inner = (
              <>
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                    i < current
                      ? 'bg-mint-500 text-white'
                      : i === current
                      ? 'bg-mint-500 text-white shadow-lg shadow-mint-500/40'
                      : 'bg-gray-200 text-gray-400'
                  }`}
                >
                  {i < current ? '✓' : i + 1}
                </div>
                <span
                  className={`text-[10px] font-medium ${
                    i <= current ? 'text-mint-600' : 'text-gray-400'
                  }`}
                >
                  {label}
                </span>
              </>
            );
            // onStepClick이 없으면 기존과 100% 동일한 div 렌더(MemberInput 등 하위호환)
            if (!onStepClick) {
              return <div key={i} className="flex flex-col items-center gap-1">{inner}</div>;
            }
            return (
              <button
                key={i}
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onStepClick(i)}
                aria-label={`${label} 단계로 이동`}
                aria-current={i === current ? 'step' : undefined}
                className={`flex flex-col items-center gap-1 rounded-lg px-2 py-1.5 min-w-[48px] transition-all ${
                  clickable ? 'cursor-pointer active:scale-95 hover:opacity-80' : 'cursor-default'
                }`}
              >
                {inner}
              </button>
            );
          })}
        </div>
        <div className="relative h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-mint-500 rounded-full transition-all duration-500 ease-in-out"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        {/* 마스코트 — 진행 직선의 세로 중앙에 얹혀(슬라이더 손잡이처럼) 진행 지점을 따라 이동.
            라벨을 가리지 않도록 선 가운데 정렬 + 고정 너비(w-6)로 가장자리 찌그러짐 방지. */}
        <div
          className="absolute w-6 z-10 pointer-events-none transition-[left] duration-500 ease-in-out"
          style={{ left: `${progress * 100}%`, bottom: '3px', transform: 'translate(-50%, 50%)' }}
        >
          <img
            src="/image/mascot-bird.webp"
            alt=""
            aria-hidden="true"
            className="w-6 h-6 select-none drop-shadow-sm animate-mascot-bob"
          />
        </div>
      </div>
    </div>
  );
}
