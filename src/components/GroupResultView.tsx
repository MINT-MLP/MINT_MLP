import { useState, useEffect } from 'react';
import type { GroupResult, GroupResultPlace, GuestCtx, MapPin, TravelTimeData } from '@/types';
import MiniMap from '@/components/MiniMap';
import VisitCertModal from '@/components/VisitCertModal';
import GuestPlaceCard from '@/components/GuestPlaceCard';
import { GpsPin, hideOnError, kakaoUrl } from '@/components/placeCardBits';
import { trackEvent } from '@/utils/analytics';
import { getDeviceId } from '@/utils/points';
import { computeTravelTimes } from '@/services/travelTime';
import { downloadMeetingIcs } from '@/utils/ics';

// 게스트 결과 화면 — 호스트가 다 같이 고른 취향으로 뽑은 결과를 '호스트와 동등하게' 보여준다.
// 다만 결과를 바꾸는 조작(재추천·조절·예약)은 호스트 전용이라 뺀다 — 한 명이 다시 돌리면 전원이 어긋나므로.
// 대신 게스트에게만 의미 있는 것(내 취향 반영·찜·방문인증·총무)은 그대로 얹는다.
export default function GroupResultView({
  result, guest, placeChanged,
}: {
  result: GroupResult;
  guest: GuestCtx;
  placeChanged: boolean;
}) {
  const [visitPlace, setVisitPlace] = useState<GroupResultPlace | null>(null);
  const [myTravel, setMyTravel] = useState<TravelTimeData | null>(null);
  const [transportMode, setTransportMode] = useState<'transit' | 'driving'>('transit');
  const f = result.first;
  const hasSecond = !!result.second;
  const chips = Array.from(new Set([...guest.chips, ...(guest.budget ? [guest.budget] : [])])).slice(0, 5);
  const hasMyLoc = guest.locLat != null && guest.locLng != null;

  // 코스 지도 핀 — 1·2·3차 (좌표 있는 것만)
  const pins: MapPin[] = [];
  if (f.lat != null && f.lng != null && f.lat !== 0) pins.push({ lat: f.lat, lng: f.lng, name: f.placeName, kind: 'first' });
  if (result.second?.lat && result.second.lng && result.second.lat !== 0) pins.push({ lat: result.second.lat, lng: result.second.lng, name: result.second.placeName, kind: 'second' });
  if (result.third?.lat && result.third.lng && result.third.lat !== 0) pins.push({ lat: result.third.lat, lng: result.third.lng, name: result.third.placeName, kind: 'third' });

  // 내 출발지 → 1차/2차 개인 이동시간 — 호스트가 못 주는 '나만의' 값(게스트 기기에서 계산).
  // 임의 지역 모드(출발지 미입력)면 계산하지 않는다.
  useEffect(() => {
    if (!hasMyLoc || f.lat == null || f.lng == null || f.lat === 0) { setMyTravel(null); return; }
    let alive = true;
    const origins = [{ label: guest.locName || '내 출발지', lat: guest.locLat!, lng: guest.locLng! }];
    const dest: { first: { lat: number; lng: number }; second?: { lat: number; lng: number } } = { first: { lat: f.lat, lng: f.lng } };
    if (result.second?.lat && result.second.lng && result.second.lat !== 0) dest.second = { lat: result.second.lat, lng: result.second.lng };
    computeTravelTimes(origins, dest).then((t) => { if (alive) setMyTravel(t); }).catch(() => { /* 폴백 없이 조용히 */ });
    return () => { alive = false; };
  }, [hasMyLoc, guest.locName, guest.locLat, guest.locLng, f.lat, f.lng, result.second]);

  // 1차 길찾기 딥링크 — kakao "to"는 현재 위치에서 목적지까지 경로. 좌표 있으면 정확 매칭.
  const directionsUrl = f.lat && f.lng && f.lat !== 0
    ? `https://map.kakao.com/link/to/${encodeURIComponent(f.placeName)},${f.lat},${f.lng}`
    : `https://map.kakao.com/link/search/${encodeURIComponent(f.placeName)}`;

  const firstTransit = myTravel?.first[transportMode]?.[0];
  const secondTransit = myTravel?.second?.[transportMode]?.[0];

  return (
    <div className="min-h-[100dvh] bg-[#F5FBF8] px-5 pt-10 pb-12">
      {/* 호스트가 장소를 바꾸면 알림 — 조용한 교체 대신 명시 */}
      {placeChanged && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm font-bold px-4 py-2.5 rounded-full shadow-lg animate-fade-in-up">
          🔄 호스트가 장소를 바꿨어요 · 새 결과예요
        </div>
      )}
      <div className="max-w-md mx-auto flex flex-col gap-2">
        <div className="text-center mb-2">
          <div className="text-3xl mb-1">🎉</div>
          <h1 className="text-xl font-black text-gray-800">모임 장소가 정해졌어요!</h1>
          <p className="text-sm text-gray-500 mt-1">
            {result.areaName ? `${result.areaName} · ` : ''}다 같이 고른 취향으로 골랐어요
          </p>
        </div>

        {/* 내가 낸 취향이 반영됐다는 체감 — 호스트 결과의 개인화 배너를 게스트 '자기' 취향으로 */}
        {(chips.length > 0 || guest.excludeFoods.length > 0) && (
          <div className="bg-[#E8F8F5] border border-[#3CDBC0]/30 rounded-2xl px-4 py-3 flex flex-col gap-1">
            {chips.length > 0 && (
              <p className="text-xs text-[#2AB5A0] leading-relaxed">
                <span className="font-black">{chips.map((c) => `#${c}`).join(' ')}</span>
                <span className="text-[#2AB5A0]/80"> — 네가 고른 취향도 반영됐어요</span>
              </p>
            )}
            {guest.excludeFoods.length > 0 && (
              <p className="text-xs text-[#2AB5A0] leading-relaxed">
                <span className="font-black">🚫 {guest.excludeFoods.join(', ')}</span>
                <span className="text-[#2AB5A0]/80"> 못 먹는 건 빼고 골랐어요</span>
              </p>
            )}
          </div>
        )}

        {/* 내 출발지 기준 개인 이동시간 — 게스트만의 값 */}
        {hasMyLoc && firstTransit && (
          <div className="bg-white rounded-2xl border border-gray-100 p-3 shadow-sm">
            <div className="flex items-center justify-between mb-1.5">
              <span className="flex items-center gap-1 text-xs font-black text-[#2AB5A0]">
                <GpsPin className="text-[#3CDBC0]" />
                <span className="truncate max-w-[150px]">{guest.locName || '내 출발지'}에서</span>
              </span>
              <button
                onClick={() => setTransportMode((m) => (m === 'transit' ? 'driving' : 'transit'))}
                className="flex items-center gap-0.5 text-xs text-gray-400 active:text-gray-600 transition-colors"
              >
                <span>{transportMode === 'transit' ? '대중교통 예상' : '자차 이동'}</span>
                <span className="text-[10px]">▽</span>
              </button>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <div className="flex items-center gap-1">
                <span className="text-gray-500">1차 {f.placeName}</span>
                <span className="text-gray-400">→ 약</span>
                <span className="font-black text-[#3CDBC0]">{firstTransit.formatted}</span>
              </div>
              {secondTransit && result.second && (
                <div className="flex items-center gap-1">
                  <span className="text-gray-500">2차 {result.second.placeName}</span>
                  <span className="text-gray-400">→ 약</span>
                  <span className="font-black text-[#1A7A6E]">{secondTransit.formatted}</span>
                </div>
              )}
            </div>
            {firstTransit.source === 'estimate' && (
              <p className="text-[10px] text-gray-300 mt-1.5">* 직선거리 기반 예상치예요</p>
            )}
          </div>
        )}

        {/* 날씨 한 줄 (있을 때만) */}
        {result.weather && (
          <div className="bg-white rounded-2xl border border-gray-100 px-4 py-2.5 shadow-sm flex items-center gap-2 text-xs text-gray-600">
            <span>{result.weather.isRainy ? '🌧️' : '⛅'}</span>
            <span className="font-bold">{result.weather.temp}°</span>
            <span className="text-gray-400">{result.weather.description}</span>
          </div>
        )}

        {/* 1차 라벨 */}
        <div className="flex items-center justify-between mt-1">
          {hasSecond ? (
            <span className="text-xs font-black bg-[#3CDBC0] text-white px-3 py-1 rounded-full">
              1차 추천{result.purposeFirst ? ` ${result.purposeFirst}` : ''}
            </span>
          ) : <span />}
          <p className="text-[10px] text-gray-400 text-right">카드 터치 시 카카오맵에서 확인</p>
        </div>

        {/* 1차 카드 — 호스트와 동일한 신뢰 요소 */}
        <GuestPlaceCard
          place={f}
          gradient="linear-gradient(135deg, #3CDBC0 0%, #2AB5A0 100%)"
          shadowColor="shadow-[#3CDBC0]/25"
          wishRank="first"
        />

        {/* 코스 지도 — 1·2·3차 한 장에 */}
        {pins.length > 0 && f.lat != null && f.lng != null && f.lat !== 0 && (
          <MiniMap lat={f.lat} lng={f.lng} placeName={f.placeName} pins={pins} />
        )}

        {/* 2차 */}
        {result.second && (
          <>
            <div className="relative flex items-center py-1">
              <span className="text-xs font-black bg-[#1A7A6E] text-white px-3 py-1 rounded-full">
                2차 추천{result.purposeSecond ? ` ${result.purposeSecond}` : ''}
              </span>
              <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 text-xs text-gray-400 font-medium pointer-events-none">
                <span className="text-[#3CDBC0] text-base leading-none">↓</span>
                <span>도보 약 {f.walkingToNext ? `${f.walkingToNext}분` : '10~15분'}</span>
              </div>
            </div>
            <GuestPlaceCard
              place={result.second}
              gradient="linear-gradient(135deg, #1A7A6E 0%, #155E54 100%)"
              shadowColor="shadow-[#1A7A6E]/25"
              wishRank="second"
            />
          </>
        )}

        {/* 3차 '이어서 갈 곳' — 덤 성격이라 흰 카드+좌측 보더로 경량화(호스트와 동일 위계) */}
        {result.third && (
          <>
            <div className="relative flex items-center py-1">
              <span className="text-xs font-black bg-[#0F4E46] text-white px-3 py-1 rounded-full">
                3차 · {result.thirdLabel ?? '이어서 가기'}
              </span>
              <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 text-xs text-gray-400 font-medium pointer-events-none">
                <span className="text-[#3CDBC0] text-base leading-none">↓</span>
                <span>도보 약 {(hasSecond ? result.second?.walkingToNext : f.walkingToNext) ? `${hasSecond ? result.second?.walkingToNext : f.walkingToNext}분` : '5~10분'}</span>
              </div>
            </div>
            <a
              href={kakaoUrl(result.third)}
              target="_blank"
              rel="noreferrer"
              className="block rounded-2xl bg-white border border-gray-200 border-l-4 border-l-[#0F4E46] p-3.5 shadow-sm active:scale-[0.99] transition-transform"
            >
              <div className="flex items-start gap-3">
                {result.third.imageUrl && (
                  <img src={result.third.imageUrl} alt={result.third.placeName} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" loading="lazy" onError={hideOnError} />
                )}
                <div className="min-w-0 flex-1">
                  <span className="inline-block text-[11px] font-bold text-[#0F4E46] bg-[#0F4E46]/10 px-2 py-0.5 rounded-full mb-1">{result.third.category}</span>
                  <p className="text-base font-black text-gray-800 leading-tight">{result.third.placeName}</p>
                  {result.third.description && (
                    <p className="text-xs text-gray-500 leading-snug mt-0.5 break-keep">{result.third.description}</p>
                  )}
                  <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-1.5">
                    <GpsPin className="text-gray-400 shrink-0" />
                    <span className="truncate">{result.third.address || result.third.area}</span>
                  </div>
                </div>
              </div>
            </a>
          </>
        )}

        {/* 총무 발표 — 단톡방 스크린샷 감. 호스트 폰에서만 뜨던 재미 요소를 게스트도 */}
        {result.treasurer && (
          <div className="mt-1 rounded-2xl bg-gradient-to-r from-amber-50 to-yellow-50 border-2 border-amber-200 px-4 py-3 flex items-center gap-3">
            <span className="text-2xl shrink-0">🎲</span>
            <p className="text-sm font-black text-amber-800 leading-snug">
              {result.treasurer}에서 출발하는 분이 오늘의 총무 당첨!
            </p>
          </div>
        )}

        {/* 길찾기 + 캘린더 — 게스트가 바로 움직일 수 있게(호스트 화면엔 없는 개인 유틸) */}
        <div className="flex gap-2">
          <a
            href={directionsUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => trackEvent('guest_directions_click', { device_id: getDeviceId(), place_key: `${f.placeName}|${f.address ?? ''}` })}
            className="flex-1 py-2.5 rounded-2xl bg-white border border-gray-200 text-gray-600 font-bold text-sm flex items-center justify-center gap-1.5 hover:border-[#3CDBC0] hover:text-[#2AB5A0] transition-all active:scale-95"
          >
            <span className="text-base">🧭</span><span>길찾기</span>
          </a>
          <button
            onClick={() => { trackEvent('guest_calendar_add', { device_id: getDeviceId() }); downloadMeetingIcs(f.placeName, f.address || f.area || ''); }}
            className="flex-1 py-2.5 rounded-2xl bg-white border border-gray-200 text-gray-600 font-bold text-sm flex items-center justify-center gap-1.5 hover:border-[#3CDBC0] hover:text-[#2AB5A0] transition-all active:scale-95"
          >
            <span className="text-base">📅</span><span>캘린더 저장</span>
          </button>
        </div>

        {/* 방문 인증 → 500P (추천→실제 방문 전환 씨앗) — 실제 방문자의 다수는 게스트다 */}
        <button
          onClick={() => { trackEvent('visit_cert_open', { device_id: getDeviceId(), place_key: `${f.placeName}|${f.address ?? ''}`, source: 'shared' }); setVisitPlace(f); }}
          className="w-full py-3 rounded-2xl bg-[#E8F8F5] border-2 border-[#3CDBC0]/40 text-[#2AB5A0] font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
        >
          <span className="text-lg">📍</span>
          <span>여기 방문 인증하고 500P 받기</span>
        </button>

        {/* 신규 유입 CTA — 결과로 신뢰를 준 뒤 마지막에. "다음엔 내가 모임 만들기" 프레이밍 */}
        <a
          href="/app?ref=grp"
          className="block w-full mt-2 py-4 rounded-2xl bg-[#3CDBC0] text-white font-black text-base text-center shadow-lg shadow-[#3CDBC0]/30 active:scale-95 transition-transform"
        >
          🌿 다음엔 내가 모임 만들어보기 →
        </a>
      </div>

      {/* 방문 인증 모달 — 게스트 surface는 'shared' */}
      {visitPlace && (
        <VisitCertModal
          place={visitPlace}
          source="shared"
          onClose={() => setVisitPlace(null)}
          onCertified={() => setVisitPlace(null)}
        />
      )}
    </div>
  );
}
