import type { PlaceRecommendation, Coordinates, ChangeReason } from '@/types';
import { distMeters } from '@/utils/geo';

// 재추천이 이전 결과 대비 "뭐가 달라졌는지" 한 줄 — 실측 가능한 사실(거리)만 숫자로 말한다
export function buildChangeNote(
  prev: PlaceRecommendation | null,
  next: PlaceRecommendation | undefined,
  midpoint: Coordinates,
  reason: ChangeReason,
): string | null {
  if (!prev || !next || prev.placeName === next.placeName) return null;

  let distPart: string | null = null;
  if (prev.lat && prev.lng && next.lat && next.lng && prev.lat !== 0 && next.lat !== 0) {
    const diff = distMeters(midpoint.lat, midpoint.lng, prev.lat, prev.lng)
      - distMeters(midpoint.lat, midpoint.lng, next.lat, next.lng);
    if (diff > 150) distPart = `중간지점에서 ${diff >= 1000 ? `${(diff / 1000).toFixed(1)}km` : `${Math.round(diff / 50) * 50}m`} 더 가까워졌어요`;
  }

  switch (reason) {
    case 'expensive':
      return `${prev.placeName} 대신 가격 부담을 낮춘 곳으로 다시 골랐어요 (이번엔 ${next.priceRange})`;
    case 'far':
      return distPart
        ? `${prev.placeName} 대신 ${distPart.replace('졌어요', '운 곳')}으로 바꿨어요`
        : `${prev.placeName} 대신 이동 부담을 줄이는 방향으로 다시 골랐어요`;
    case 'vibe':
      return `분위기를 바꿔 ${next.placeName}(${next.category})로 다시 골랐어요`;
    case 'adjust':
      return `조절한 취향을 반영해 ${next.placeName}로 바꿨어요${distPart ? ` · ${distPart}` : ''}`;
    default:
      return `아까 본 ${prev.placeName} 말고 새로운 곳으로 골랐어요${distPart ? ` · ${distPart}` : ''}`;
  }
}
