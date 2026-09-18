import type { GroupResultPlace } from '@/types';
import WishlistButton from '@/components/WishlistButton';
import { GpsPin, hideOnError, parseOpenStatus, congestionInfo, FitScoreBar, kakaoUrl } from '@/components/placeCardBits';
import { COURSE_TONE, type CourseTone } from '@/constants/colors';
import { cn } from '@/utils/cn';

// 게스트용 리치 장소 카드 — 호스트 PlaceCard와 같은 신뢰 요소(사진·카테고리·이유·적합도·해시태그·영업)를 담는다.
// 카드 탭 = 카카오맵 이동. 찜은 카드 위에 얹되 stopPropagation으로 지도 이동과 분리(호스트와 동일 패턴).
export default function GuestPlaceCard({
  place, tone, wishRank,
}: {
  place: GroupResultPlace;
  tone: CourseTone;
  wishRank: 'first' | 'second';
}) {
  const openStatus = parseOpenStatus(place.openingHours ?? undefined);
  const cong = congestionInfo(place.congestionLevel ?? undefined);
  const open = () => window.open(kakaoUrl(place), '_blank');
  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`${place.placeName} 카카오맵에서 열기`}
      className={cn('rounded-2xl text-white overflow-hidden cursor-pointer active:scale-[0.99] transition-transform shadow-xl outline-none', COURSE_TONE[tone].card)}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
    >
      {place.imageUrl && (
        <img src={place.imageUrl} alt={place.placeName} className="w-full h-36 object-cover" loading="lazy" onError={hideOnError} />
      )}
      <div className="py-3 px-4">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-xs font-black bg-white/30 text-white px-3 py-0.5 rounded-full border border-white/30 truncate">
            {place.category}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {place.congestionLevel && (
              <div className="flex items-center gap-1">
                <span className={`${cong.dot} text-xs leading-none`}>●</span>
                <span className="text-xs text-white/80">{cong.label}</span>
              </div>
            )}
            <WishlistButton place={place} rank={wishRank} source="shared" tone="onDark" />
          </div>
        </div>

        <h2 className="text-xl font-black leading-tight mb-1">{place.placeName}</h2>

        {place.description && (
          <p className="text-sm text-white/90 leading-snug mb-2 font-medium">{place.description}</p>
        )}

        <FitScoreBar score={place.fitScore ?? undefined} className="mb-2" />

        {place.vibeTags && place.vibeTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {place.vibeTags.slice(0, 3).map((tag) => (
              <span key={tag} className="text-xs text-white/80 bg-white/15 px-2 py-0.5 rounded-full">#{tag}</span>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-xs text-white/80">
            <GpsPin className="opacity-80 shrink-0" />
            <span className="leading-tight">{place.address || place.area}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-white/80 flex-wrap">
            {place.priceRange && (
              <span className="flex items-center gap-1"><span>💰</span><span>{place.priceRange}</span></span>
            )}
            {place.openingHours && (
              <span className="flex items-center gap-1">
                <span>🕐</span><span>{place.openingHours}</span>
                {openStatus && (
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${openStatus.isOpen ? 'bg-green-400 text-white' : 'bg-red-400/80 text-white'}`}>
                    {openStatus.label}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
