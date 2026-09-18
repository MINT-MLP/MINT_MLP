import { useState } from 'react';
import { addWish, removeWish, isWished } from '@/storage/wishlist';
import { getDeviceId } from '@/storage/device';
import { placeKey } from '@/storage/points';
import { trackEvent } from '@/services/analytics';
import type { WishTargetInput } from '@/types';

interface Props {
  place: WishTargetInput & { priceRange?: string };
  rank: 'first' | 'second' | 'candidate';
  source: 'result' | 'shared' | 'discover';
  // 카드 위(어두운 그라디언트)에 얹으면 'onDark', 흰 카드면 'light'
  tone?: 'onDark' | 'light';
  onChange?: () => void;
}

// 찜 하트 — 탭 한 번으로 저장/해제. 저장은 localStorage + events(1호 발굴자 소급 씨앗).
export default function WishlistButton({ place, rank, source, tone = 'light', onChange }: Props) {
  const key = placeKey(place);
  const [wished, setWished] = useState(() => isWished(key));

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (wished) {
      removeWish(key);
      setWished(false);
      trackEvent('wishlist_remove', { device_id: getDeviceId(), place_key: key });
    } else {
      addWish(place);
      setWished(true);
      trackEvent('wishlist_add', {
        device_id: getDeviceId(),
        place_key: key,
        place_name: place.placeName ?? '',
        address: place.address ?? place.area ?? '',
        category: place.category ?? '',
        price_range: place.priceRange ?? '',
        lat: place.lat ?? null,
        lng: place.lng ?? null,
        rank,
        source,
        at_iso: new Date().toISOString(),
      });
    }
    onChange?.();
  }

  const base = 'shrink-0 flex items-center justify-center rounded-full transition-all active:scale-90';
  const ring = tone === 'onDark'
    ? 'bg-white/20 hover:bg-white/30'
    : 'bg-white border border-gray-200 hover:border-mint-500 shadow-sm';

  return (
    <button
      onClick={toggle}
      aria-label={wished ? '찜 해제' : '찜하기'}
      aria-pressed={wished}
      className={`${base} ${ring} w-8 h-8`}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" className="transition-colors"
        fill={wished ? '#F43F5E' : 'none'}
        stroke={wished ? '#F43F5E' : (tone === 'onDark' ? '#ffffff' : '#9CA3AF')}
        strokeWidth="2.2"
      >
        <path d="M12 21s-6.7-4.35-9.33-8.07C1.1 10.6 1.6 7.4 4 6c1.9-1.1 4.2-.5 5.4 1.1L12 10l2.6-2.9C15.8 5.5 18.1 4.9 20 6c2.4 1.4 2.9 4.6 1.33 6.93C18.7 16.65 12 21 12 21z" />
      </svg>
    </button>
  );
}
