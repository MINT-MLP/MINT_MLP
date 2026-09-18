import type { PlaceRecommendation } from '@/types';
import WishlistButton from '@/components/WishlistButton';
import { GpsPin, hideOnError, kakaoUrl, openPlace, certPrefix } from '@/components/placeCardBits';
import { COURSE_TONE, type CourseTone } from '@/constants/colors';
import { cn } from '@/utils/cn';

// 대안 추천 카드 — 항상 펼쳐진 독립 카드. 색은 코스 톤(first/second/third)으로 받고 클래스는 COURSE_TONE에서 고른다
export default function ResultAltsSection({ alts, tone = 'first', label }: { alts: PlaceRecommendation[]; tone?: CourseTone; label?: string }) {
  if (!alts.length) return null;
  const t = COURSE_TONE[tone];
  return (
    <div className="flex flex-col gap-2">
      {label ? (
        <span className={cn('self-start text-xs font-black text-white px-3 py-1 rounded-full', t.solid)}>
          {label}
        </span>
      ) : (
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest px-1">다른 추천</p>
      )}
      {alts.map((p, idx) => (
        <div
          key={idx}
          className={cn('bg-white rounded-2xl border border-gray-100 border-l-4 p-3.5 shadow-sm cursor-pointer active:scale-[0.99] transition-transform', t.borderL)}
          onClick={() => openPlace(kakaoUrl(p), 'place_click_candidate', p)}
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={cn('text-[10px] font-black text-white px-2 py-0.5 rounded-full shrink-0', t.solid)}>
                  #{idx + 2}
                </span>
                <p className="text-sm font-black text-gray-800 truncate">{certPrefix(p)}{p.placeName}</p>
              </div>
              <p className="text-xs text-gray-400">{p.category}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {p.fitScore != null && (
                <span className={cn('text-sm font-black', t.text)}>{p.fitScore}점</span>
              )}
              <WishlistButton place={p} rank="candidate" source="result" tone="light" />
              {p.imageUrl && (
                <img
                  src={p.imageUrl}
                  alt={p.placeName}
                  className="w-14 h-14 rounded-xl object-cover"
                  loading="lazy"
                  onError={hideOnError}
                />
              )}
            </div>
          </div>
          <p className="text-xs text-gray-500 mb-2 leading-relaxed">{p.description}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
            <span>💰 {p.priceRange}</span>
            {p.address && (
              <span className="flex items-center gap-1 truncate">
                <GpsPin className="opacity-50 text-gray-400" />{p.address}
              </span>
            )}
          </div>
          {p.vibeTags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {p.vibeTags.slice(0, 3).map((tag) => (
                <span key={tag} className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">#{tag}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
