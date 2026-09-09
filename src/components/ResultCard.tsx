import { useState, useCallback } from 'react';
import type { PlaceRecommendation } from '../services/ai';
import { congestionDotClass } from '../services/seoulData';
import type { CongestionLevel } from '../services/seoulData';
import MiniMap from './MiniMap';
import type { MapPin } from './MiniMap';
import { findCertifications } from '../data/certifications';
import type { CertSource } from '../data/certifications';
import { trackEvent } from '../utils/analytics';
import WishlistButton from './WishlistButton';
import VisitCertModal from './VisitCertModal';
import TreasurerPlanSheet from './TreasurerPlanSheet';
import { getPlanFrame, planPriceLabel, isPreregistered } from '../utils/plan';
import { getDeviceId } from '../utils/points';
import { GpsPin, hideOnError, parseOpenStatus, congestionInfo, FitScoreBar, kakaoUrl } from './placeCardBits';

// 선택 신호(ground truth) — 노출된 후보 중 실제로 어떤 순위를 눌러 지도를 열었나.
// recommend.ts가 이미 기록 중인 노출 순위(finalRank)와 대비하면 랭킹 튜닝 학습셋이 된다.
type PlaceClickEvent = 'place_click_rank1' | 'place_click_second' | 'place_click_candidate' | 'place_click_third';
function openPlace(url: string, type: PlaceClickEvent, place?: PlaceRecommendation) {
  // payload: 어떤 장소를 실제 선택했나. session_key로 recommendation_log의 노출 순위와 대비하면 랭킹 정답 레이블.
  trackEvent(type, place ? { placeName: place.placeName, address: place.address, priceRange: place.priceRange, fitScore: place.fitScore } : undefined);
  window.open(url, '_blank');
}

// 출발지를 한 곳도 안 적은 경우(지역 직접 선택 모드)엔 뽑을 지명이 없다.
// 그래도 '오늘의 총무' 버튼은 눌리는 버튼이어야 하므로, 데이터 없이도 성립하는 공정 규칙을 대신 뽑는다.
const TREASURER_RULES = [
  '가장 늦게 도착한 분이',
  '가위바위보에서 진 분이',
  '생일이 가장 빠른 분이',
  '오늘 제일 배고픈 분이',
  '이 링크를 처음 연 분이',
];
function rollTreasurerRule(prev?: string): string {
  const pool = TREASURER_RULES.filter((r) => r !== prev);
  return pool[Math.floor(Math.random() * pool.length)];
}

// 매칭된 인증 이모지(최대 2개)를 리스트 행 앞에 붙일 접두사로 — 대안/더보기 행의 인증 표식.
function certPrefix(place: { placeName?: string; address?: string; area?: string }): string {
  const c = findCertifications(place).slice(0, 2);
  return c.length ? c.map((m) => m.source.emoji).join('') + ' ' : '';
}

interface TravelResult {
  label: string;
  formatted: string;
  source?: string;
  error?: boolean;
}

interface TravelTimeData {
  first: { transit: TravelResult[]; driving: TravelResult[] };
  second: { transit: TravelResult[]; driving: TravelResult[] } | null;
}

interface Props {
  results: PlaceRecommendation[];
  thirdResult?: PlaceRecommendation | null;   // 3차 '이어서 갈 곳' (없으면 미노출)
  thirdLabel?: string | null;                 // 3차 성격 라벨
  travelTimes: TravelTimeData | null;
  showTravelTime?: boolean;
  midpointAreaName?: string;
  purpose?: { first: string; second: string | null };
  vibeLabels?: string[];
  keywords?: string[];
  genreLabels?: string[];
  excludeFoods?: string[];
  treasurer: string | null;
  onRetry: () => void;
  onAdjust?: () => void;
  onReserve: () => void;
  onReject?: (reason: 'expensive' | 'far' | 'vibe') => void;
  onPointsChange?: (balance: number) => void;
}

interface CardProps {
  place: PlaceRecommendation;
  extraResults?: PlaceRecommendation[];
  gradient: string;
  shadowColor: string;
  wishRank?: 'first' | 'second' | 'candidate';
}

// 대안 추천 카드 — 항상 펼쳐진 독립 카드
function AltsSection({ alts, accentColor = '#3CDBC0', label }: { alts: PlaceRecommendation[]; accentColor?: string; label?: string }) {
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

function PlaceCard({ place, extraResults = [], gradient, shadowColor, wishRank = 'first' }: CardProps) {
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
    {openCert && <CertSheet source={openCert} onClose={() => setOpenCertId(null)} />}
    </>
  );
}

// 인증 안내 바텀시트 — 소스별 문구를 그대로 렌더. 카드 루트가 overflow-hidden이라 카드 밖 형제로 띄운다(잘림 방지).
function CertSheet({ source, onClose }: { source: CertSource; onClose: () => void }) {
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

export default function ResultCard({
  results,
  travelTimes,
  thirdResult,
  thirdLabel,
  showTravelTime = true,
  midpointAreaName,
  purpose,
  vibeLabels = [],
  keywords = [],
  genreLabels = [],
  excludeFoods = [],
  treasurer,
  onRetry,
  onAdjust,
  onReserve,
  onReject,
  onPointsChange,
}: Props) {
  const [showTreasurerPopup, setShowTreasurerPopup] = useState(false);
  const [treasurerRule, setTreasurerRule] = useState(() => rollTreasurerRule());
  const [showVisitCert, setShowVisitCert] = useState(false);
  const [showPlanSheet, setShowPlanSheet] = useState(false);
  const [preregistered, setPreregistered] = useState(() => isPreregistered());
  const planFrame = getPlanFrame();
  const [destTarget, setDestTarget] = useState<'first' | 'second'>('first');
  const [transportMode, setTransportMode] = useState<'transit' | 'driving'>('transit');

  const hasSecond = !!(purpose?.second && purpose.second !== '없음');
  const result = results[0];
  const secondResult = hasSecond ? results[1] : null;
  const extraFirstResults = hasSecond ? results.slice(2, 4) : results.slice(1);
  const extraSecondResults = hasSecond ? results.slice(4) : [];

  // 개인화 설득 문구 — 사용자가 고른 장르/취향/키워드를 결과에 되짚어준다.
  // 장르(최대 2개)는 전용 슬롯을 두어 항상 노출하고, 분위기·키워드(최대 3개)는
  // 장르가 슬롯을 잠식해 안 보이는 일이 없도록 별도로 확보한다.
  const matchChips = [...genreLabels.slice(0, 2), ...[...vibeLabels, ...keywords].slice(0, 3)];

  const toggleDest = useCallback(() => {
    if (hasSecond && travelTimes?.second) setDestTarget((d) => d === 'first' ? 'second' : 'first');
  }, [hasSecond, travelTimes]);

  const toggleTransport = useCallback(() => {
    setTransportMode((m) => m === 'transit' ? 'driving' : 'transit');
  }, []);

  const activeTimes = travelTimes
    ? (destTarget === 'first' ? travelTimes.first : travelTimes.second)?.[transportMode] ?? []
    : null;

  const destLabel = destTarget === 'first'
    ? `1차 ${result.placeName}`
    : `2차 ${secondResult?.placeName ?? ''}`;

  const canToggleDest = hasSecond && !!(travelTimes?.second);

  return (
    <div className="flex flex-col gap-2 animate-fade-in-up">

      {/* 개인화 설득 배너 — "내 취향을 반영했다"는 체감 */}
      {(matchChips.length > 0 || excludeFoods.length > 0) && (
        <div className="bg-[#E8F8F5] border border-[#3CDBC0]/30 rounded-2xl px-4 py-3 flex flex-col gap-1">
          {matchChips.length > 0 && (
            <p className="text-xs text-[#2AB5A0] leading-relaxed">
              <span className="font-black">
                {matchChips.map((c) => `#${c}`).join(' ')}
              </span>
              <span className="text-[#2AB5A0]/80"> 취향에 딱 맞는 곳으로 골랐어요</span>
            </p>
          )}
          {excludeFoods.length > 0 && (
            <p className="text-xs text-[#2AB5A0] leading-relaxed">
              <span className="font-black">🚫 {excludeFoods.join(', ')}</span>
              <span className="text-[#2AB5A0]/80"> 못 드시는 건 빼고 골랐어요</span>
            </p>
          )}
        </div>
      )}

      {/* 상단 요약 바 — 자동 중간지점 모드에서만 소요시간 표시 */}
      {midpointAreaName && showTravelTime && (
        <div className="bg-white rounded-2xl border border-gray-100 p-3 shadow-sm">
          <div className="flex items-center justify-between mb-1.5">
            {/* 왼쪽: 목적지 토글 */}
            <button
              onClick={toggleDest}
              className={`flex items-center gap-1 text-xs font-black px-2 py-0.5 rounded-full transition-colors ${canToggleDest ? 'text-[#2AB5A0] bg-[#E8F8F5] active:bg-[#3CDBC0]/20' : 'text-gray-700'}`}
            >
              <GpsPin className="text-[#3CDBC0]" />
              <span className="truncate max-w-[140px]">{destLabel}까지</span>
              {canToggleDest && <span className="text-[#3CDBC0] text-[10px]">⇅</span>}
            </button>
            {/* 오른쪽: 교통수단 토글 */}
            <button
              onClick={toggleTransport}
              className="flex items-center gap-0.5 text-xs text-gray-400 active:text-gray-600 transition-colors"
            >
              <span>{transportMode === 'transit' ? '대중교통 예상' : '자차 이동'}</span>
              <span className="text-[10px]">▽</span>
            </button>
          </div>
          {activeTimes === null ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <div className="w-3.5 h-3.5 border-2 border-[#3CDBC0] border-t-transparent rounded-full animate-spin-slow" />
              계산 중...
            </div>
          ) : activeTimes.length === 0 ? (
            <p className="text-xs text-gray-400">소요시간을 가져올 수 없어요</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {activeTimes.map((t, i) => (
                  <div key={i} className="flex items-center gap-1 text-xs">
                    <span className="text-gray-500 truncate max-w-[80px]">{t.label}</span>
                    <span className="text-gray-400">→ 약</span>
                    <span className={`font-black ${t.error ? 'text-gray-400' : 'text-[#3CDBC0]'}`}>
                      {t.formatted}
                    </span>
                  </div>
                ))}
              </div>
              {/* 실측 경로가 아닌 추정치면 정직하게 표기 */}
              {activeTimes.some((t) => t.source === 'estimate') && (
                <p className="text-[10px] text-gray-300 mt-1.5">* 직선거리 기반 예상치예요</p>
              )}
            </>
          )}
        </div>
      )}

      {/* 1차 라벨 + 힌트 */}
      <div className="flex items-center justify-between -mt-1">
        {hasSecond ? (
          <span className="text-xs font-black bg-[#3CDBC0] text-white px-3 py-1 rounded-full">
            1차 추천 {purpose!.first}
          </span>
        ) : <span />}
        <p className="text-[10px] text-gray-400 text-right">카드 터치 시 카카오맵에서 확인</p>
      </div>

      {/* 1차 카드 */}
      <PlaceCard
        place={result}
        extraResults={[]}
        gradient="linear-gradient(135deg, #3CDBC0 0%, #2AB5A0 100%)"
        shadowColor="shadow-[#3CDBC0]/25"
      />

      {/* 코스 지도 — 1차·2차·대안 위치를 한 장에 (대안은 회색 점) */}
      {result.lat != null && result.lng != null && result.lat !== 0 && (
        <MiniMap
          lat={result.lat}
          lng={result.lng}
          placeName={result.placeName}
          pins={(() => {
            const pins: MapPin[] = [{ lat: result.lat!, lng: result.lng!, name: result.placeName, kind: 'first' }];
            if (secondResult?.lat && secondResult.lng && secondResult.lat !== 0) {
              pins.push({ lat: secondResult.lat, lng: secondResult.lng, name: secondResult.placeName, kind: 'second' });
            }
            if (thirdResult?.lat && thirdResult.lng && thirdResult.lat !== 0) {
              pins.push({ lat: thirdResult.lat, lng: thirdResult.lng, name: thirdResult.placeName, kind: 'third' });
            }
            for (const p of [...extraFirstResults, ...extraSecondResults]) {
              if (p.lat && p.lng && p.lat !== 0) pins.push({ lat: p.lat, lng: p.lng, name: p.placeName, kind: 'alt' });
            }
            return pins;
          })()}
        />
      )}

      {/* 1차 대안 추천 — 1차 카드 바로 아래에 붙여 소속을 명확히 */}
      {!hasSecond && <AltsSection alts={extraFirstResults} accentColor="#3CDBC0" />}
      {hasSecond && extraFirstResults.length > 0 && (
        <AltsSection
          alts={extraFirstResults}
          accentColor="#3CDBC0"
          label={`1차 ${purpose!.first} · 다른 추천 ${extraFirstResults.length}곳`}
        />
      )}

      {/* 도보 정중앙 + 2차 배지 왼쪽 */}
      {hasSecond && secondResult && (
        <div className="relative flex items-center py-1">
          <span className="text-xs font-black bg-[#1A7A6E] text-white px-3 py-1 rounded-full">
            2차 추천 {purpose!.second}
          </span>
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 text-xs text-gray-400 font-medium pointer-events-none">
            <span className="text-[#3CDBC0] text-base leading-none">↓</span>
            <span>도보 약 {result.walkingToNext ? `${result.walkingToNext}분` : '10~15분'}</span>
          </div>
        </div>
      )}

      {/* 2차 카드 */}
      {hasSecond && secondResult && (
        <div className="flex flex-col gap-1">

          {/* 2차 카드 */}
          <div
            role="link"
            tabIndex={0}
            aria-label={`${secondResult.placeName} 카카오맵에서 열기`}
            className="rounded-2xl text-white shadow-xl shadow-[#1A7A6E]/25 overflow-hidden cursor-pointer active:scale-[0.99] transition-transform outline-none focus-visible:ring-2 focus-visible:ring-[#3CDBC0] focus-visible:ring-offset-2"
            style={{ background: 'linear-gradient(135deg, #1A7A6E 0%, #155E54 100%)' }}
            onClick={() => openPlace(kakaoUrl(secondResult), 'place_click_second', secondResult)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlace(kakaoUrl(secondResult), 'place_click_second', secondResult); } }}
          >
            {secondResult.imageUrl && (
              <img
                src={secondResult.imageUrl}
                alt={secondResult.placeName}
                className="w-full h-36 object-cover"
                loading="lazy"
                onError={hideOnError}
              />
            )}
            <div className="py-3 px-4">
              {(() => {
                const cong = congestionInfo(secondResult.congestionLevel);
                return (
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-black bg-white/20 text-white px-3 py-0.5 rounded-full border border-white/20">
                      {secondResult.category}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      {secondResult.congestionLevel && (
                        <div className="flex items-center gap-1">
                          <span className={`${cong.dot} text-xs leading-none`}>●</span>
                          <span className="text-xs text-white/80">{cong.label}</span>
                        </div>
                      )}
                      <WishlistButton place={secondResult} rank="second" source="result" tone="onDark" />
                    </div>
                  </div>
                );
              })()}
              <h2 className="text-xl font-black leading-tight mb-1.5">{secondResult.placeName}</h2>
              <FitScoreBar score={secondResult.fitScore} className="mb-2" />
              <div className="flex flex-wrap gap-1 mb-2">
                {secondResult.vibeTags.slice(0, 3).map((tag) => (
                  <span key={tag} className="text-xs text-white/80 bg-white/15 px-2 py-0.5 rounded-full">
                    #{tag}
                  </span>
                ))}
              </div>
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5 text-xs text-white/80">
                  <GpsPin className="opacity-80 shrink-0" />
                  <span className="leading-tight">{secondResult.address || secondResult.area}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-white/80 flex-wrap">
                  <span className="flex items-center gap-1"><span>💰</span><span>{secondResult.priceRange}</span></span>
                  {secondResult.openingHours && (
                    <span className="flex items-center gap-1">
                      <span>🕐</span><span>{secondResult.openingHours}</span>
                      {(() => {
                        const s = parseOpenStatus(secondResult.openingHours);
                        return s ? (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${s.isOpen ? 'bg-green-400 text-white' : 'bg-red-400/80 text-white'}`}>
                            {s.label}
                          </span>
                        ) : null;
                      })()}
                    </span>
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* 2차 대안 추천 — 2차 카드 바로 아래 */}
      {hasSecond && extraSecondResults.length > 0 && (
        <AltsSection
          alts={extraSecondResults}
          accentColor="#1A7A6E"
          label={`2차 ${purpose!.second} · 다른 추천 ${extraSecondResults.length}곳`}
        />
      )}

      {/* 3차 '이어서 갈 곳' — 서버가 붙여준 경우에만. 앵커(2차·없으면 1차)에서 도보로 이어가는 마무리 코스 */}
      {thirdResult && (
        <>
          <div className="relative flex items-center py-1">
            <span className="text-xs font-black bg-[#0F4E46] text-white px-3 py-1 rounded-full">
              3차 · {thirdLabel ?? '이어서 가기'}
            </span>
            {(() => {
              const walk = hasSecond ? secondResult?.walkingToNext : result.walkingToNext;
              return (
                <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 text-xs text-gray-400 font-medium pointer-events-none">
                  <span className="text-[#3CDBC0] text-base leading-none">↓</span>
                  <span>도보 약 {walk ? `${walk}분` : '5~10분'}</span>
                </div>
              );
            })()}
          </div>
          {/* 3차는 '덤' 성격이라 흰 카드+다크틸 좌측 보더로 경량화(주인공=1차 위계 유지). 중첩 버튼이 없어 시맨틱 <a>로 처리 */}
          <a
            href={kakaoUrl(thirdResult)}
            target="_blank"
            rel="noreferrer"
            onClick={() => trackEvent('place_click_third', { placeName: thirdResult.placeName, address: thirdResult.address })}
            aria-label={`${thirdResult.placeName} 카카오맵에서 열기`}
            className="block rounded-2xl bg-white border border-gray-200 border-l-4 border-l-[#0F4E46] p-3.5 shadow-sm active:scale-[0.99] transition-transform outline-none focus-visible:ring-2 focus-visible:ring-[#0F4E46] focus-visible:ring-offset-2"
          >
            <div className="flex items-start gap-3">
              {thirdResult.imageUrl && (
                <img
                  src={thirdResult.imageUrl}
                  alt={thirdResult.placeName}
                  className="w-16 h-16 rounded-xl object-cover flex-shrink-0"
                  loading="lazy"
                  onError={hideOnError}
                />
              )}
              <div className="min-w-0 flex-1">
                <span className="inline-block text-[11px] font-bold text-[#0F4E46] bg-[#0F4E46]/10 px-2 py-0.5 rounded-full mb-1">{thirdResult.category}</span>
                <p className="text-base font-black text-gray-800 leading-tight">{thirdResult.placeName}</p>
                {thirdResult.description && (
                  <p className="text-xs text-gray-500 leading-snug mt-0.5 break-keep">{thirdResult.description}</p>
                )}
                <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-1.5">
                  <GpsPin className="text-gray-400 shrink-0" />
                  <span className="truncate">{thirdResult.address || thirdResult.area}</span>
                </div>
              </div>
            </div>
          </a>
        </>
      )}

      {/* ── 재추천 영역: 3역할 명확 분리 ── */}
      <div className="bg-white border border-gray-100 rounded-2xl p-3.5 flex flex-col gap-3 mt-1">
        {/* ① 이유 기반 — "왜 별로였는지" */}
        {onReject && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-gray-500 text-center font-bold">별로였다면, 이유를 알려주세요</p>
            <p className="text-[10px] text-gray-400 text-center -mt-1">이유를 반영해 다른 곳으로 다시 골라드려요</p>
            <div className="grid grid-cols-3 gap-2 mt-0.5">
              {([
                { reason: 'expensive', emoji: '💸', label: '너무 비싸' },
                { reason: 'far',       emoji: '📍', label: '너무 멀어' },
                { reason: 'vibe',      emoji: '🎭', label: '분위기 달라' },
              ] as const).map(({ reason, emoji, label }) => (
                <button
                  key={reason}
                  onClick={() => onReject(reason)}
                  className="flex flex-col items-center justify-center gap-0.5 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-500 text-xs font-bold hover:border-[#3CDBC0] hover:text-[#2AB5A0] hover:bg-[#E8F8F5] transition-all active:scale-95"
                >
                  <span className="text-base leading-none">{emoji}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ② 그냥 다른 곳 + ③ 취향 직접 조절 */}
        <div className="flex gap-2 pt-1 border-t border-gray-100">
          <button
            onClick={onRetry}
            className="flex-1 py-2.5 rounded-xl bg-[#E8F8F5] text-[#2AB5A0] font-black text-sm flex items-center justify-center gap-1.5 hover:bg-[#d4f3ee] transition-all active:scale-95"
          >
            <span className="text-base">🔄</span>
            <span>다른 곳 보기</span>
          </button>
          {onAdjust && (
            <button
              onClick={onAdjust}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-500 font-bold text-sm flex items-center justify-center gap-1.5 hover:border-[#3CDBC0] hover:text-[#2AB5A0] transition-all active:scale-95"
            >
              <span className="text-base">🎚️</span>
              <span>취향 조절</span>
            </button>
          )}
        </div>
      </div>

      {/* ── 방문 인증 → 포인트 (추천→실제 방문 전환율 씨앗) ── */}
      <button
        onClick={() => { trackEvent('visit_cert_open', { device_id: getDeviceId(), place_key: `${result.placeName}|${result.address ?? ''}`, source: 'result' }); setShowVisitCert(true); }}
        className="w-full py-3 rounded-2xl bg-[#E8F8F5] border-2 border-[#3CDBC0]/40 text-[#2AB5A0] font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
      >
        <span className="text-lg">📍</span>
        <span>여기 방문 인증하고 500P 받기</span>
      </button>

      {/* ── 보조: 총무 + 예약(연동 준비 중) ── */}
      <div className="flex gap-2">
        <button
          onClick={() => {
            // treasurer가 null(출발지 미입력)이어도 팝업은 뜬다 — 예전엔 여기서 조용히 무시돼
            // 버튼이 눌리지 않는 것처럼 보였다.
            if (!treasurer) setTreasurerRule((prev) => rollTreasurerRule(prev));
            trackEvent('treasurer_open', { device_id: getDeviceId(), mode: treasurer ? 'location' : 'rule' });
            setShowTreasurerPopup(true);
          }}
          className="flex-1 py-2.5 rounded-2xl bg-gradient-to-r from-amber-50 to-yellow-50 border-2 border-amber-200 flex items-center justify-center gap-2 active:scale-95 transition-all"
        >
          <span className="text-lg">💰</span>
          <span className="text-sm font-black text-amber-700">오늘의 총무</span>
        </button>
        <button
          onClick={onReserve}
          className="flex-1 py-2.5 rounded-2xl border border-gray-200 bg-white text-gray-500 font-bold text-sm flex items-center justify-center gap-2 hover:border-[#3CDBC0] hover:text-[#2AB5A0] transition-all active:scale-95"
        >
          <span className="text-lg">📋</span>
          <span>예약 문의</span>
        </button>
      </div>

      {/* ── 총무 플랜 '가짜 문' — 장소 독박 해방 구독 검증 ── */}
      <button
        onClick={() => { trackEvent('plan_entry_click', { device_id: getDeviceId(), frame: planFrame }); setShowPlanSheet(true); }}
        className="w-full text-left rounded-2xl bg-gradient-to-r from-amber-50 to-yellow-50 border-2 border-amber-200 px-4 py-3 flex items-center gap-3 active:scale-[0.99] transition-all"
      >
        <span className="text-2xl shrink-0">🙋</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-amber-800 leading-snug break-keep">매번 장소 정하는 거, 이제 독박 그만</p>
          <p className="text-xs text-amber-600 mt-0.5">
            {preregistered ? '사전등록 완료 · 출시되면 알려드릴게요' : `총무 플랜 ${planPriceLabel(planFrame)} · 자세히 알아보기 →`}
          </p>
        </div>
      </button>

      <div className="pb-2" />

      {/* 방문 인증 모달 */}
      {showVisitCert && (
        <VisitCertModal
          place={result}
          source="result"
          onClose={() => setShowVisitCert(false)}
          onCertified={(bal) => onPointsChange?.(bal)}
        />
      )}

      {/* 총무 플랜 상세 시트 */}
      {showPlanSheet && (
        <TreasurerPlanSheet
          frame={planFrame}
          onClose={() => { setShowPlanSheet(false); setPreregistered(isPreregistered()); }}
        />
      )}

      {/* 총무 팝업 */}
      {showTreasurerPopup && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-6"
          onClick={() => setShowTreasurerPopup(false)}
        >
          <div
            className="bg-white rounded-3xl p-7 w-full max-w-sm text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-5xl mb-4">🎲</div>
            <p className="text-lg font-black text-gray-800 leading-snug break-keep">
              {treasurer
                ? <>{treasurer}에서 출발하는 분이<br />오늘의 총무 당첨!</>
                : <>{treasurerRule}<br />오늘의 총무 당첨!</>}
            </p>
            {!treasurer && (
              <p className="text-xs text-gray-400 mt-2 break-keep">출발지를 입력하면 출발지로 뽑아드려요</p>
            )}
            <div className="mt-5 flex gap-2">
              {!treasurer && (
                <button
                  onClick={() => setTreasurerRule((prev) => rollTreasurerRule(prev))}
                  className="flex-1 py-3 rounded-2xl border-2 border-amber-200 bg-amber-50 text-amber-700 font-black text-base active:scale-95 transition-transform"
                >
                  다시 뽑기
                </button>
              )}
              <button
                onClick={() => setShowTreasurerPopup(false)}
                className="flex-1 py-3 rounded-2xl bg-[#3CDBC0] text-white font-black text-base active:scale-95 transition-transform"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
