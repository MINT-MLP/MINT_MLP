import type { CertSource } from '@/types';

// 인증 안내 바텀시트 — 소스별 문구를 그대로 렌더. 카드 루트가 overflow-hidden이라 카드 밖 형제로 띄운다(잘림 방지).
export default function ResultCertSheet({ source, onClose }: { source: CertSource; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40"
      onClick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <div
        className="fixed bottom-0 left-0 right-0 z-50 max-w-md mx-auto bg-white rounded-t-3xl px-6 pt-6 pb-[max(2rem,calc(env(safe-area-inset-bottom)+0.75rem))] animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-4xl text-center">{source.emoji}</p>
        <h3 className="text-lg font-black text-gray-900 text-center mt-2">{source.sheetTitle}</h3>
        <p className="text-sm text-gray-600 leading-relaxed text-center mt-2">
          {source.sheetBody}
        </p>
        <p className="text-[11px] text-gray-400 text-center mt-3">
          {source.sourceLine}
        </p>
        {source.disclaimer && (
          <p className="text-[10px] text-gray-300 text-center mt-1.5 leading-relaxed">
            {source.disclaimer}
          </p>
        )}
        <button
          onClick={onClose}
          className="w-full mt-5 py-3.5 rounded-2xl bg-[#3CDBC0] text-white font-black active:scale-[0.98] transition-transform"
        >
          {source.ctaLabel}
        </button>
      </div>
    </div>
  );
}
