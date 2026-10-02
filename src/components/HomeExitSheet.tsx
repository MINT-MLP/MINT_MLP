// 추천 입력 중 홈으로 나갈 때 — 입력한 내용을 남길지 묻는다. 셋 중 하나라 기본 확인창(확인/취소)으로는 못 한다.
// 배경을 눌러도 닫히지 않는다 — '저장하지 않고 나가기'가 입력을 지우는 선택이라 빗나간 터치로 정해지면 안 된다.
export default function HomeExitSheet({ onSave, onDiscard, onClose }: {
  onSave: () => void; onDiscard: () => void; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40" role="presentation">
      <div
        className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-md rounded-t-3xl bg-white px-5 pt-5 pb-[max(2rem,calc(env(safe-area-inset-bottom)+0.75rem))] animate-fade-in-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-exit-title"
      >
        <p id="home-exit-title" className="text-[18px] font-black text-gray-900">진행 사항을 저장할까요?</p>
        <p className="mt-1.5 text-[13px] text-gray-500">저장하면 홈의 &lsquo;이어서 하기&rsquo;에서 이어서 입력할 수 있어요.</p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            onClick={onSave}
            className="w-full rounded-2xl bg-mint-500 py-3.5 text-sm font-black text-white active:scale-[0.99] transition-transform"
          >
            저장하고 나가기
          </button>
          <button
            onClick={onDiscard}
            className="w-full rounded-2xl border border-gray-200 bg-white py-3.5 text-sm font-bold text-gray-600 active:scale-[0.99] transition-transform"
          >
            저장하지 않고 나가기
          </button>
          <button onClick={onClose} className="w-full py-2.5 text-sm font-bold text-gray-400">
            계속 입력하기
          </button>
        </div>
      </div>
    </div>
  );
}
