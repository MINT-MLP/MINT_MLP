import { useState } from 'react';
import type { PlaceRecommendation } from '@/types';
import { congestionDotClass } from '@/services/seoulData';
import type { CongestionLevel } from '@/services/seoulData';
import { findCertifications } from '@/constants/certifications';
import { trackEvent } from '@/utils/analytics';
import WishlistButton from '@/components/WishlistButton';
import ResultCertSheet from '@/components/ResultCertSheet';
import { GpsPin, hideOnError, parseOpenStatus, congestionInfo, FitScoreBar, kakaoUrl, openPlace, certPrefix } from '@/components/placeCardBits';

// 메인(1차) 장소 카드 — 사진·인증 뱃지·추천 이유·적합도·영업 상태·더보기. 카드 탭 = 카카오맵.
interface Props {
  place: PlaceRecommendation;
  extraResults?: PlaceRecommendation[];
  gradient: string;
  shadowColor: string;
  wishRank?: 'first' | 'second' | 'candidate';
}

export default function ResultPlaceCard({ place, extraResults = [], gradient, shadowColor, wishRank = 'first' }: Props) {
  const [moreVisible, setMoreVisible] = useState(false);
  const [openCertId, setOpenCertId] = useState<string | null>(null);
  const openStatus = parseOpenStatus(place.openingHours);
  const cong = congestionInfo(place.congestionLevel);
  const url = kakaoUrl(place);
  // 통과한 인증들(우슐랭·미쉐린·백년가게 …). 이름·시·도·구군 3중 게이트를 모두 넘긴 것만. 최대 2개 노출.
  const certs = findCertifications(place).slice(0, 2);
  const openCert = certs.find((c) => c.source.id === openCertId)?.source ?? null;

  return (
    <>
    <div
      role="link"
      tabIndex={0}
      aria-label={`${place.placeName} 카카오맵에서 열기`}
      className={`rounded-2xl text-white overflow-hidden cursor-pointer active:scale-[0.99] transition-transform shadow-xl outline-none focus-visible:ring-2 focus-visible:ring-[#3CDBC0] focus-visible:ring-offset-2 ${shadowColor}`}
      style={{ background: gradient }}
      onClick={() => openPlace(url, 'place_click_rank1', place)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlace(url, 'place_click_rank1', place); } }}
    >
      {/* 대표 사진 — 카드 신뢰도의 절반 */}
      {place.imageUrl && (
        <img
          src={place.imageUrl}
          alt={place.placeName}
          className="w-full h-36 object-cover"
          loading="lazy"
          onError={hideOnError}
        />
      )}
      <div className="py-3 px-4">
        {/* 카테고리 (+ 우슐랭 인증) + 혼잡도 */}
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-black bg-white/30 text-white px-3 py-0.5 rounded-full border border-white/30 truncate">
              {place.category}
            </span>
            {certs.map((c) => (
              <button
                key={c.source.id}
                onClick={(e) => { e.stopPropagation(); trackEvent('cert_badge_open'); setOpenCertId(c.source.id); }}
                className="text-[11px] font-black bg-white px-2.5 py-0.5 rounded-full shadow-sm shrink-0 active:scale-95 transition-transform"
                style={{ color: c.source.badgeTextColor }}
                aria-label={`${c.source.label} 인증 안내 열기`}
              >
                {c.source.emoji} {c.source.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {place.congestionLevel && (
              <div className="flex items-center gap-1">
                <span className={`${cong.dot} text-xs leading-none`}>●</span>
                <span className="text-xs text-white/80">{cong.label}</span>
              </div>
            )}
            <WishlistButton place={place} rank={wishRank} source="result" tone="onDark" />
          </div>
        </div>

        {/* 장소명 */}
        <h2 className="text-xl font-black leading-tight mb-1">{place.placeName}</h2>

        {/* 추천 이유 — 큐레이션의 핵심 */}
        {place.description && (
          <p className="text-sm text-white/90 leading-snug mb-2 font-medium">{place.description}</p>
        )}

        {/* 적합도 점수 */}
        <FitScoreBar score={place.fitScore} className="mb-2" />

        {/* 해시태그 */}
        <div className="flex flex-wrap gap-1 mb-2">
          {place.vibeTags.slice(0, 3).map((tag) => (
            <span key={tag} className="text-xs text-white/80 bg-white/15 px-2 py-0.5 rounded-full">
              #{tag}
            </span>
          ))}
        </div>

        {/* 핵심 정보 */}
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-xs text-white/80">
            <GpsPin className="opacity-80 shrink-0" />
            <span className="leading-tight">{place.address || place.area}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-white/80 flex-wrap">
            {place.priceRange && (
              <span className="flex items-center gap-1">
                <span>💰</span>
                <span>{place.priceRange}</span>
              </span>
            )}
            {place.openingHours && (
              <span className="flex items-center gap-1">
                <span>🕐</span>
                <span>{place.openingHours}</span>
                {openStatus && (
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                    openStatus.isOpen ? 'bg-green-400 text-white' : 'bg-red-400/80 text-white'
                  }`}>
                    {openStatus.label}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>

        {/* 더보기 버튼 */}
        {extraResults.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); if (!moreVisible) trackEvent('candidates_expand'); setMoreVisible(!moreVisible); }}
            className="w-full mt-3 text-white/70 text-sm font-bold flex items-center justify-center gap-1 active:scale-95 transition-all"
          >
            {moreVisible ? '접기 ▲' : `추천 더보기 (${extraResults.length}개 더) ▼`}
          </button>
        )}
      </div>

      {/* 더보기 펼침 */}
      {moreVisible && extraResults.length > 0 && (
        <div className="border-t border-white/20 px-4 pb-3 pt-3 flex flex-col gap-2 animate-fade-in-up">
          {extraResults.map((p, idx) => (
            <div
              key={idx}
              className="bg-white/15 rounded-xl p-3 cursor-pointer active:bg-white/25 transition-colors"
              onClick={(e) => { e.stopPropagation(); openPlace(kakaoUrl(p), 'place_click_candidate', p); }}
            >
              <div className="flex items-start justify-between mb-1">
                <div>
                  <p className="text-sm font-black">{certPrefix(p)}{p.placeName}</p>
                  <p className="text-xs text-white/70">{p.category}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {p.fitScore != null && (
                    <span className="text-xs font-black text-white/90 bg-white/20 px-1.5 py-0.5 rounded-full">
                      {p.fitScore}점
                    </span>
                  )}
                  {p.congestionLevel && (
                    <>
                      <div className={`w-1.5 h-1.5 rounded-full ${congestionDotClass(p.congestionLevel as CongestionLevel)}`} />
                      <span className="text-xs text-white/60">{p.congestionLevel}</span>
                    </>
                  )}
                </div>
              </div>
              <p className="text-xs text-white/70 mb-1.5 leading-relaxed">{p.description}</p>
              <div className="flex items-center gap-3 text-xs text-white/60">
                <span>💰 {p.priceRange}</span>
                {p.address && (
                  <span className="flex items-center gap-1 truncate flex-1">
                    <GpsPin className="opacity-60" /> {p.address}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
    {openCert && <ResultCertSheet source={openCert} onClose={() => setOpenCertId(null)} />}
    </>
  );
}
