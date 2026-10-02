// 두 좌표 사이 직선거리(m). midpoint.ts·travelTime.ts에도 km 단위 haversine이 각자 있다 — 통합은 별건.
export function distMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLng = (bLng - aLng) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

// 1차→2차 도보(분). 추천 서버(recommendCore.walkingMinutes)와 같은 규칙: 직선거리를 시속 4km로
export function walkingMinutes(a: { lat?: number | null; lng?: number | null } | null | undefined, b: { lat?: number | null; lng?: number | null } | null | undefined): number | null {
  if (a?.lat == null || a.lng == null || b?.lat == null || b.lng == null) return null;
  return Math.round((distMeters(a.lat, a.lng, b.lat, b.lng) / 1000 / 4) * 60);
}
