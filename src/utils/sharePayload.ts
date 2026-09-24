import type { SlimPlace, SnapshotPayload, VoteCandidate } from '@/types';

// 공유 링크로 들어온 데이터는 누구나 조작할 수 있다. 화면에 쓰기 전에 형태와 링크 스킴을 확인한다.

// 카카오 장소 페이지만 허용. 그 외(javascript: 등)는 버리고 호출부가 좌표·검색 링크로 대신 만든다.
export function safeKakaoPlaceUrl(url: unknown): string | null {
  return typeof url === 'string' && /^https?:\/\/(place\.)?map\.kakao\.com\//.test(url) ? url : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function sanitizeSlimPlace(p: unknown): SlimPlace | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  if (typeof o.placeName !== 'string' || !o.placeName) return null;
  return {
    placeName: o.placeName,
    category: str(o.category),
    description: str(o.description),
    priceRange: str(o.priceRange),
    vibeTags: Array.isArray(o.vibeTags) ? o.vibeTags.filter((t): t is string => typeof t === 'string') : [],
    address: str(o.address),
    area: str(o.area),
    congestionLevel: str(o.congestionLevel) ?? null,
    lat: num(o.lat),
    lng: num(o.lng),
    imageUrl: typeof o.imageUrl === 'string' && o.imageUrl.startsWith('https://') ? o.imageUrl : null,
    kakaoPlaceUrl: safeKakaoPlaceUrl(o.kakaoPlaceUrl),
  };
}

export function sanitizeSnapshot(p: unknown): SnapshotPayload | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const first = sanitizeSlimPlace(o.first);
  if (!first) return null;
  const candidates: VoteCandidate[] | undefined = Array.isArray(o.candidates)
    ? o.candidates
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object' && typeof (c as Record<string, unknown>).n === 'string')
        .map((c) => ({ n: c.n as string, c: str(c.c), s: num(c.s) }))
    : undefined;
  return {
    first,
    second: sanitizeSlimPlace(o.second),
    third: sanitizeSlimPlace(o.third),
    thirdLabel: str(o.thirdLabel) ?? null,
    purposeFirst: str(o.purposeFirst) ?? null,
    purposeSecond: str(o.purposeSecond) ?? null,
    areaName: str(o.areaName) ?? null,
    treasurer: str(o.treasurer) ?? null,
    shareId: str(o.shareId),
    candidates,
  };
}
