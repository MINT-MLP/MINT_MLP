import { useEffect, useState } from 'react';
import { addWish as addLocalWish, removeWish as removeLocalWish, isWished } from '@/storage/wishlist';
import { getDeviceId } from '@/storage/device';
import { placeKey } from '@/storage/points';
import { trackEvent } from '@/services/analytics';
import { signInWithKakao } from '@/services/auth';
import { addWish, removeWish, wishedIds, claimRecommendation } from '@/services/memberData';
import { useUserStore } from '@/stores/userStore';
import type { PlaceRecord, WishTargetInput } from '@/types';

interface Props {
  place: WishTargetInput & { priceRange?: string; kakaoPlaceId?: string; record?: PlaceRecord };
  rank: 'first' | 'second' | 'candidate';
  source: 'result' | 'shared' | 'discover';
  // 카드 위(어두운 그라디언트)에 얹으면 'onDark', 흰 카드면 'light'
  tone?: 'onDark' | 'light';
  onChange?: () => void;
}

// 찜 하트. 서버에 저장된 추천(record 있음)은 회원 찜(계정 저장, 비회원은 로그인 안내).
// record가 없는 곳(공유·그룹 게스트·옛 결과)은 회원에게 하트를 숨긴다 — 눌러도 계정 찜 목록에 나올 수 없어서다.
// 비회원은 그런 곳에서 예전 기기 저장을 그대로 쓴다(저장 정리 4번 때 걷어낸다).
export default function WishlistButton(props: Props) {
  const isMember = useUserStore((s) => s.isMember);
  if (props.place.record && props.place.kakaoPlaceId) {
    return <MemberWish {...props} placeId={props.place.kakaoPlaceId} record={props.place.record} />;
  }
  return isMember ? null : <LocalWish {...props} />;
}

function MemberWish({ placeId, record, rank, source, tone = 'light', onChange }: Props & { placeId: string; record: PlaceRecord }) {
  const isMember = useUserStore((s) => s.isMember);
  const [wished, setWished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [claimedCond, setClaimedCond] = useState<number | null>(null);   // 로그인 뒤 내 계정으로 옮긴 조건

  useEffect(() => {
    if (!isMember) return;
    let alive = true;
    void wishedIds().then((ids) => { if (alive) setWished(ids.has(placeId)); });
    return () => { alive = false; };
  }, [isMember, placeId]);

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    if (!isMember) {
      trackEvent('wishlist_login_prompt', { rank, source });
      if (window.confirm('찜은 카카오 로그인 후 쓸 수 있어요. 로그인할까요?\n로그인 후 이 결과로 돌아와요.')) void signInWithKakao();
      return;
    }
    setBusy(true);
    // 로그인 전에 받은 추천이면 먼저 내 계정으로 옮긴다(009). 토큰이 없거나 24시간이 지났으면 옮길 수 없다.
    let rec = claimedCond !== null ? { ...record, member: true, conditionId: claimedCond } : record;
    if (!rec.member) {
      const cond = rec.claimToken ? await claimRecommendation(rec.recommendationId, rec.claimToken) : null;
      if (cond === null) {
        setBusy(false);
        window.alert('로그인 전에 받은 추천이라 찜할 수 없어요. 새로 추천받으면 찜할 수 있어요.');
        return;
      }
      setClaimedCond(cond);
      rec = { ...rec, member: true, conditionId: cond };
    }
    const next = !wished;
    setWished(next);
    const ok = next ? await addWish(placeId, rec) : await removeWish(placeId);
    if (!ok) {
      setWished(!next);
      window.alert(next ? '찜하지 못했어요. 잠시 후 다시 시도해주세요.' : '찜을 해제하지 못했어요. 잠시 후 다시 시도해주세요.');
    } else {
      trackEvent(next ? 'wishlist_add' : 'wishlist_remove', { rank, source, slot_id: record.slotId });
    }
    setBusy(false);
    onChange?.();
  }

  return <Heart wished={wished} tone={tone} onClick={toggle} />;
}

function LocalWish({ place, rank, source, tone = 'light', onChange }: Props) {
  const key = placeKey(place);
  const [wished, setWished] = useState(() => isWished(key));

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (wished) {
      removeLocalWish(key);
      setWished(false);
      trackEvent('wishlist_remove', { device_id: getDeviceId(), place_key: key });
    } else {
      addLocalWish(place);
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

  return <Heart wished={wished} tone={tone} onClick={toggle} />;
}

function Heart({ wished, tone, onClick }: { wished: boolean; tone: 'onDark' | 'light'; onClick: (e: React.MouseEvent) => void }) {
  const base = 'shrink-0 flex items-center justify-center rounded-full transition-all active:scale-90';
  const ring = tone === 'onDark'
    ? 'bg-white/20 hover:bg-white/30'
    : 'bg-white border border-gray-200 hover:border-mint-500 shadow-sm';
  return (
    <button
      onClick={onClick}
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
