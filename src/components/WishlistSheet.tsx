import { useEffect, useState } from 'react';
import { getWishlist, removeWish, wishMapLink } from '@/utils/wishlist';
import { getDeviceId } from '@/utils/points';
import { trackEvent } from '@/utils/analytics';
import type { WishItem } from '@/types';

// 내 찜 목록 바텀시트 — 저장한 곳을 모아 보고 지도로 바로 열기.
export default function WishlistSheet({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<WishItem[]>(() => getWishlist());

  useEffect(() => {
    trackEvent('wishlist_open', { device_id: getDeviceId(), count: getWishlist().length });
  }, []);

  function remove(key: string) {
    setItems(removeWish(key));
    trackEvent('wishlist_remove', { device_id: getDeviceId(), place_key: key });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose}>
      <div
        className="fixed bottom-0 left-0 right-0 z-50 max-w-md mx-auto bg-white rounded-t-3xl px-5 pt-5 pb-[max(2rem,calc(env(safe-area-inset-bottom)+0.75rem))] max-h-[80vh] flex flex-col animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-black text-gray-900">🤍 내가 찜한 곳</h3>
          <button onClick={onClose} className="text-gray-400 text-sm font-bold px-2 active:scale-95">닫기</button>
        </div>

        {items.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-4xl mb-3">🫧</p>
            <p className="text-sm text-gray-500 leading-relaxed">
              아직 찜한 곳이 없어요.<br />
              마음에 드는 곳의 하트를 눌러 저장해보세요.
            </p>
            <p className="text-[11px] text-gray-400 mt-3">먼저 발굴한 곳은 나중에 기록으로 남아요</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto flex flex-col gap-2">
            {items.map((w) => (
              <div
                key={w.place_key}
                className="flex items-center gap-3 bg-mint-50 border border-gray-100 rounded-2xl px-3.5 py-3"
              >
                <a
                  href={wishMapLink(w)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 min-w-0 active:scale-[0.99] transition-transform"
                >
                  <p className="text-sm font-black text-gray-800 truncate">{w.place_name}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {w.category ? `${w.category} · ` : ''}{w.address}
                  </p>
                </a>
                <button
                  onClick={() => remove(w.place_key)}
                  aria-label="찜 해제"
                  className="shrink-0 w-7 h-7 rounded-full bg-white border border-gray-200 text-gray-400 text-xs active:scale-90 transition-transform"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
