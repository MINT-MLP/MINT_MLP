// 쿠폰 구매는 아직 못 연다(가짜 문) — 누른 사람에게 이유와 다음 행동을 준다.
// 상세 시트(z-50) 위에 겹쳐 뜨므로 z-[60]이어야 한다.
export default function CouponPurchasePreparingModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 px-4 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-t-3xl bg-white px-6 pt-6 pb-[max(1.5rem,calc(env(safe-area-inset-bottom)+0.75rem))] text-center animate-fade-in-up sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 text-4xl">🛠️</div>
        <p className="text-lg font-black text-gray-900">쿠폰 구매는 준비 중이에요</p>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-500 break-keep">
          포인트로 쿠폰을 바로 교환하는 기능은 곧 열려요.
          먼저 알림 신청을 해두시면 가장 먼저 알려드릴게요.
        </p>
        <button
          onClick={onClose}
          className="mt-5 w-full rounded-2xl bg-[#3CDBC0] py-3.5 font-black text-white transition-transform active:scale-[0.98]"
        >
          확인
        </button>
      </div>
    </div>
  );
}
