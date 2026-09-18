// 찜(발굴) 기록 — 클라이언트 저장 + events 로그(analytics)로 이중화.
// 진짜 목적은 "누가·어떤 곳을·언제 찜했나"의 데이터 씨앗: 나중 '발굴 게임'에서
// place_key의 최초 wishlist_add device_id = 1호 발굴자로 소급 인정할 수 있게 한다.

import { placeKey } from '@/storage/points';
import type { WishItem, WishTargetInput } from '@/types';

const WISHLIST_KEY = 'mint_wishlist';
const MAX = 100;

export function getWishlist(): WishItem[] {
  try {
    const raw = localStorage.getItem(WISHLIST_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function isWished(key: string): boolean {
  return getWishlist().some((w) => w.place_key === key);
}

function save(list: WishItem[]): void {
  try {
    localStorage.setItem(WISHLIST_KEY, JSON.stringify(list.slice(0, MAX)));
  } catch { /* 저장 실패는 무시 — events 로그가 원장 */ }
}

// 추가하고 갱신된 목록을 반환(이미 있으면 그대로)
export function addWish(target: WishTargetInput): WishItem[] {
  const key = placeKey(target);
  const list = getWishlist();
  if (list.some((w) => w.place_key === key)) return list;
  const item: WishItem = {
    place_key: key,
    place_name: (target.placeName ?? '').trim(),
    address: (target.address ?? target.area ?? '').trim(),
    category: (target.category ?? '').trim(),
    lat: target.lat ?? null,
    lng: target.lng ?? null,
    saved_at: new Date().toISOString(),
  };
  const next = [item, ...list];
  save(next);
  return next;
}

export function removeWish(key: string): WishItem[] {
  const next = getWishlist().filter((w) => w.place_key !== key);
  save(next);
  return next;
}

// 지도 딥링크 — 결과/공유 카드와 동일 규칙. 찜 항목이 아닌 원석 카드도 쓸 수 있게 분리했다.
export function buildMapLink(name: string, lat?: number | null, lng?: number | null): string {
  if (lat && lng && lat !== 0) {
    return `https://map.kakao.com/link/map/${encodeURIComponent(name)},${lat},${lng}`;
  }
  return `https://map.kakao.com/link/search/${encodeURIComponent(name)}`;
}

export function wishMapLink(w: WishItem): string {
  return buildMapLink(w.place_name, w.lat, w.lng);
}
