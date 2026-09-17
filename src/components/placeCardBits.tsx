// 결과 카드 공용 프레젠테이션 조각 — 호스트(ResultCard)와 게스트(GroupResultView)가
// 같은 신뢰 요소(사진·적합도·영업중·혼잡도)를 '한 벌'로 공유하기 위한 순수 표현 헬퍼.
// 액션(재추천·예약·총무)은 각 화면이 카드 바깥에서 조립한다 — 여긴 표현만.
import type React from 'react';
import type { PlaceRecommendation } from '@/types';
import { trackEvent } from '@/utils/analytics';
import { findCertifications } from '@/constants/certifications';

// 깨진 이미지는 흔적 없이 숨긴다 (네이버 썸네일 만료 대응)
export function hideOnError(e: React.SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.style.display = 'none';
}

export function GpsPin({ className = '' }: { className?: string }) {
  return (
    <svg
      width="13" height="13" viewBox="0 0 24 24" fill="currentColor"
      className={`shrink-0 ${className}`}
    >
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
    </svg>
  );
}

export function parseOpenStatus(openingHours?: string): { label: string; isOpen: boolean } | null {
  if (!openingHours) return null;
  const match = openingHours.match(/(\d{2}):(\d{2})\s*[~\-]\s*(\d{2}):(\d{2})/);
  if (!match) return null;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const openMin = parseInt(match[1]) * 60 + parseInt(match[2]);
  let closeMin = parseInt(match[3]) * 60 + parseInt(match[4]);
  if (closeMin < openMin) closeMin += 24 * 60;
  const isOpen = nowMin >= openMin && nowMin < closeMin;
  return { label: isOpen ? '영업중' : nowMin < openMin ? '영업 전' : '영업 종료', isOpen };
}

export function congestionInfo(level?: string): { dot: string; label: string } {
  if (!level) return { dot: 'text-white/50', label: '-' };
  if (level.includes('여유') || level.includes('원활')) return { dot: 'text-green-300', label: '여유' };
  if (level.includes('보통')) return { dot: 'text-yellow-300', label: '보통' };
  return { dot: 'text-red-300', label: '혼잡' };
}

// 점수 구간별 근거 한 줄 — "왜 이 점수인지" 체감
export function fitScoreReason(score: number): string {
  if (score >= 90) return '취향에 딱 맞아요';
  if (score >= 80) return '조건과 잘 맞아요';
  if (score >= 70) return '무난하게 맞아요';
  return '차선책이에요';
}

export function FitScoreBar({ score, className = '' }: { score?: number; className?: string }) {
  if (score == null) return null;
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 80 ? 'bg-white' : pct >= 60 ? 'bg-white/75' : 'bg-white/50';
  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-white/60 font-bold shrink-0">적합도</span>
        <div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs font-black text-white shrink-0">{score}점</span>
      </div>
      <p className="text-[10px] text-white/70 text-right mt-0.5">{fitScoreReason(pct)}</p>
    </div>
  );
}

// 카카오맵 링크 — kakaoPlaceUrl 우선, 좌표 있으면 지도, 없으면 검색.
export function kakaoUrl(place: { placeName: string; lat?: number | null; lng?: number | null; kakaoPlaceUrl?: string | null }) {
  if (place.kakaoPlaceUrl) return place.kakaoPlaceUrl;
  if (place.lat && place.lng && place.lat !== 0 && place.lng !== 0)
    return `https://map.kakao.com/link/map/${encodeURIComponent(place.placeName)},${place.lat},${place.lng}`;
  return `https://map.kakao.com/link/search/${encodeURIComponent(place.placeName)}`;
}

// 선택 신호(ground truth) — 노출된 후보 중 실제로 어떤 순위를 눌러 지도를 열었나.
// recommend.ts가 이미 기록 중인 노출 순위(finalRank)와 대비하면 랭킹 튜닝 학습셋이 된다.
export type PlaceClickEvent = 'place_click_rank1' | 'place_click_second' | 'place_click_candidate' | 'place_click_third';
export function openPlace(url: string, type: PlaceClickEvent, place?: PlaceRecommendation) {
  // payload: 어떤 장소를 실제 선택했나. session_key로 recommendation_log의 노출 순위와 대비하면 랭킹 정답 레이블.
  trackEvent(type, place ? { placeName: place.placeName, address: place.address, priceRange: place.priceRange, fitScore: place.fitScore } : undefined);
  window.open(url, '_blank');
}

// 매칭된 인증 이모지(최대 2개)를 리스트 행 앞에 붙일 접두사로 — 대안/더보기 행의 인증 표식.
export function certPrefix(place: { placeName?: string; address?: string; area?: string }): string {
  const c = findCertifications(place).slice(0, 2);
  return c.length ? c.map((m) => m.source.emoji).join('') + ' ' : '';
}
