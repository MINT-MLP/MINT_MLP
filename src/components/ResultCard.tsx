import { useState, useCallback } from 'react';
import type { PlaceRecommendation, MapPin, TravelTimeData } from '@/types';
import MiniMap from '@/components/MiniMap';
import ResultPlaceCard from '@/components/ResultPlaceCard';
import ResultAltsSection from '@/components/ResultAltsSection';
import WishlistButton from '@/components/WishlistButton';
import { Icon } from '@/components/icons';
import VisitCertModal from '@/components/VisitCertModal';
import TreasurerPlanSheet from '@/components/TreasurerPlanSheet';
import { trackEvent } from '@/services/analytics';
import { getPlanFrame, planPriceLabel, isPreregistered } from '@/storage/treasurerPlan';
import { getDeviceId } from '@/storage/device';
import { rollTreasurerRule } from '@/utils/treasurer';
import { GpsPin, hideOnError, parseOpenStatus, congestionInfo, FitScoreBar, kakaoUrl, openPlace } from '@/components/placeCardBits';
import { COURSE_TONE } from '@/constants/colors';
import { cn } from '@/utils/cn';

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
  treasurer: string | null;
  onRetry: () => void;
  onAdjust?: () => void;
  onReserve: () => void;
  onReject?: (reason: 'expensive' | 'far' | 'vibe') => void;
  onPointsChange?: (balance: number) => void;
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
      {matchChips.length > 0 && (
        <div className="bg-mint-100 border border-mint-500/30 rounded-2xl px-4 py-3 flex flex-col gap-1">
          {matchChips.length > 0 && (
            <p className="text-xs text-mint-600 leading-relaxed">
              <span className="font-black">
                {matchChips.map((c) => `#${c}`).join(' ')}
              </span>
              <span className="text-mint-600/80"> 취향에 딱 맞는 곳으로 골랐어요</span>
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
              className={`flex items-center gap-1 text-xs font-black px-2 py-0.5 rounded-full transition-colors ${canToggleDest ? 'text-mint-600 bg-mint-100 active:bg-mint-500/20' : 'text-gray-700'}`}
            >
              <GpsPin className="text-mint-500" />
              <span className="truncate max-w-[140px]">{destLabel}까지</span>
              {canToggleDest && <span className="text-mint-500 text-[10px]">⇅</span>}
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
              <div className="w-3.5 h-3.5 border-2 border-mint-500 border-t-transparent rounded-full animate-spin-slow" />
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
                    <span className={`font-black ${t.error ? 'text-gray-400' : 'text-mint-500'}`}>
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
          <span className={cn('text-xs font-black text-white px-3 py-1 rounded-full', COURSE_TONE.first.solid)}>
            1차 추천 {purpose!.first}
          </span>
        ) : <span />}
        <p className="text-[10px] text-gray-400 text-right">카드 터치 시 카카오맵에서 확인</p>
      </div>

      {/* 1차 카드 */}
      <ResultPlaceCard
        place={result}
        extraResults={[]}
        tone="first"
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
      {!hasSecond && <ResultAltsSection alts={extraFirstResults} tone="first" />}
      {hasSecond && extraFirstResults.length > 0 && (
        <ResultAltsSection
          alts={extraFirstResults}
          tone="first"
          label={`1차 ${purpose!.first} · 다른 추천 ${extraFirstResults.length}곳`}
        />
      )}

      {/* 도보 정중앙 + 2차 배지 왼쪽 */}
      {hasSecond && secondResult && (
        <div className="relative flex items-center py-1">
          <span className={cn('text-xs font-black text-white px-3 py-1 rounded-full', COURSE_TONE.second.solid)}>
            2차 추천 {purpose!.second}
          </span>
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 text-xs text-gray-400 font-medium pointer-events-none">
            <span className="text-mint-500 text-base leading-none">↓</span>
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
            className={cn('rounded-2xl text-white shadow-xl overflow-hidden cursor-pointer active:scale-[0.99] transition-transform outline-none focus-visible:ring-2 focus-visible:ring-mint-500 focus-visible:ring-offset-2', COURSE_TONE.second.card)}
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
                  <span className="flex items-center gap-1"><Icon name="wallet" /><span>{secondResult.priceRange}</span></span>
                  {secondResult.openingHours && (
                    <span className="flex items-center gap-1">
                      <Icon name="clock" /><span>{secondResult.openingHours}</span>
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
        <ResultAltsSection
          alts={extraSecondResults}
          tone="second"
          label={`2차 ${purpose!.second} · 다른 추천 ${extraSecondResults.length}곳`}
        />
      )}

      {/* 3차 '이어서 갈 곳' — 서버가 붙여준 경우에만. 앵커(2차·없으면 1차)에서 도보로 이어가는 마무리 코스 */}
      {thirdResult && (
        <>
          <div className="relative flex items-center py-1">
            <span className={cn('text-xs font-black text-white px-3 py-1 rounded-full', COURSE_TONE.third.solid)}>
              3차 · {thirdLabel ?? '이어서 가기'}
            </span>
            {(() => {
              const walk = hasSecond ? secondResult?.walkingToNext : result.walkingToNext;
              return (
                <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 text-xs text-gray-400 font-medium pointer-events-none">
                  <span className="text-mint-500 text-base leading-none">↓</span>
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
            onClick={() => trackEvent('place_click_third', { place_id: thirdResult.kakaoPlaceId ?? null })}
            aria-label={`${thirdResult.placeName} 카카오맵에서 열기`}
            className={cn('block rounded-2xl bg-white border border-gray-200 border-l-4 p-3.5 shadow-sm active:scale-[0.99] transition-transform outline-none focus-visible:ring-2 focus-visible:ring-mint-900 focus-visible:ring-offset-2', COURSE_TONE.third.borderL)}
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
                <span className={cn('inline-block text-[11px] font-bold px-2 py-0.5 rounded-full mb-1', COURSE_TONE.third.text, COURSE_TONE.third.tint)}>{thirdResult.category}</span>
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
                { reason: 'expensive', icon: 'wallet', label: '너무 비싸' },
                { reason: 'far',       icon: 'pin',    label: '너무 멀어' },
                { reason: 'vibe',      icon: 'mask',   label: '분위기 달라' },
              ] as const).map(({ reason, icon, label }) => (
                <button
                  key={reason}
                  onClick={() => onReject(reason)}
                  className="flex flex-col items-center justify-center gap-0.5 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-500 text-xs font-bold hover:border-mint-500 hover:text-mint-600 hover:bg-mint-100 transition-all active:scale-95"
                >
                  <Icon name={icon} className="text-base" />
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
            className="flex-1 py-2.5 rounded-xl bg-mint-100 text-mint-600 font-black text-sm flex items-center justify-center gap-1.5 hover:bg-mint-200 transition-all active:scale-95"
          >
            <Icon name="refresh" className="text-base" />
            <span>다른 곳 보기</span>
          </button>
          {onAdjust && (
            <button
              onClick={onAdjust}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-500 font-bold text-sm flex items-center justify-center gap-1.5 hover:border-mint-500 hover:text-mint-600 transition-all active:scale-95"
            >
              <Icon name="sliders" className="text-base" />
              <span>취향 조절</span>
            </button>
          )}
        </div>
      </div>

      {/* ── 방문 인증 → 포인트 (추천→실제 방문 전환율 씨앗) ── */}
      <button
        onClick={() => { trackEvent('visit_cert_open', { device_id: getDeviceId(), place_id: result.kakaoPlaceId ?? null, source: 'result' }); setShowVisitCert(true); }}
        className="w-full py-3 rounded-2xl bg-mint-100 border-2 border-mint-500/40 text-mint-600 font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
      >
        <Icon name="pin" className="text-lg" />
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
          <Icon name="wallet" className="text-lg" />
          <span className="text-sm font-black text-amber-700">오늘의 총무</span>
        </button>
        <button
          onClick={onReserve}
          className="flex-1 py-2.5 rounded-2xl border border-gray-200 bg-white text-gray-500 font-bold text-sm flex items-center justify-center gap-2 hover:border-mint-500 hover:text-mint-600 transition-all active:scale-95"
        >
          <Icon name="clipboard" className="text-lg" />
          <span>예약 문의</span>
        </button>
      </div>

      {/* ── 총무 플랜 '가짜 문' — 장소 독박 해방 구독 검증 ── */}
      <button
        onClick={() => { trackEvent('plan_entry_click', { device_id: getDeviceId(), frame: planFrame }); setShowPlanSheet(true); }}
        className="w-full text-left rounded-2xl bg-gradient-to-r from-amber-50 to-yellow-50 border-2 border-amber-200 px-4 py-3 flex items-center gap-3 active:scale-[0.99] transition-all"
      >
        <Icon name="user" className="text-2xl shrink-0" />
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
            <Icon name="dice" className="text-5xl mb-4 text-mint-500" />
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
                className="flex-1 py-3 rounded-2xl bg-mint-500 text-white font-black text-base active:scale-95 transition-transform"
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
