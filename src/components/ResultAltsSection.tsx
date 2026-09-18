import type { PlaceRecommendation } from '@/types';
import WishlistButton from '@/components/WishlistButton';
import { GpsPin, hideOnError, kakaoUrl, openPlace, certPrefix } from '@/components/placeCardBits';

// 대안 추천 카드 — 항상 펼쳐진 독립 카드
export default function ResultAltsSection({ alts, accentColor = '#3CDBC0', label }: { alts: PlaceRecommendation[]; accentColor?: string; label?: string }) {
  if (!alts.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {label ? (
        <span
          className="self-start text-xs font-black text-white px-3 py-1 rounded-full"
          style={{ background: accentColor }}
        >
          {label}
        </span>
      ) : (
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest px-1">다른 추천</p>
      )}
      {alts.map((p, idx) => (
        <div
          key={idx}
          className="bg-white rounded-2xl border border-gray-100 border-l-4 p-3.5 shadow-sm cursor-pointer active:scale-[0.99] transition-transform"
          style={{ borderLeftColor: accentColor }}
          onClick={() => openPlace(kakaoUrl(p), 'place_click_candidate', p)}
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[10px] font-black text-white px-2 py-0.5 rounded-full shrink-0" style={{ background: accentColor }}>
                  #{idx + 2}
                </span>
                <p className="text-sm font-black text-gray-800 truncate">{certPrefix(p)}{p.placeName}</p>
              </div>
              <p className="text-xs text-gray-400">{p.category}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {p.fitScore != null && (
                <span className="text-sm font-black" style={{ color: accentColor }}>{p.fitScore}점</span>
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
