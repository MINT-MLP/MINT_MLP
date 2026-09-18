// 방문 인증·포인트 공용 헬퍼 (기기 식별은 storage/device.ts) (전부 클라이언트/localStorage — 신규 API 0개).
// 포인트 잔액/원장은 localStorage에 두되, 모든 적립·인증 이벤트는 events 테이블에도 남긴다(analytics).
// localStorage가 유실돼도 events 원장으로 소급 복구할 수 있도록 payload에 device_id를 항상 싣는다.

const BALANCE_KEY = 'mint_points_balance';
const LEDGER_KEY = 'mint_points_ledger';
const CERTIFIED_KEY = 'mint_certified_places';

// 방문 인증 1회당 지급 포인트
export const VISIT_POINTS = 500;
// 추천/공유 시점부터 인증 가능한 기간
export const CERT_WINDOW_DAYS = 7;
// GPS 인증 성공 반경(m)
export const CERT_RADIUS_M = 300;

// 장소 표준 키 — place ID가 없으므로 이름+주소로 통일(찜·인증 중복 판정·조인 기준)
export function placeKey(place: { placeName?: string; address?: string; area?: string }): string {
  const name = (place.placeName ?? '').trim();
  const addr = (place.address ?? place.area ?? '').trim();
  return `${name}|${addr}`;
}

// 두 좌표 사이 거리(m) — GPS 근접 인증용
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface LedgerEntry {
  place_key: string;
  place_name: string;
  points: number;
  method: 'gps' | 'photo';
  at: string; // ISO
}

export function getBalance(): number {
  try {
    const raw = localStorage.getItem(BALANCE_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function getLedger(): LedgerEntry[] {
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// 이 기기가 이미 인증한 장소인가 (place당 1회)
export function isCertified(key: string): boolean {
  try {
    const raw = localStorage.getItem(CERTIFIED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) && arr.includes(key);
  } catch {
    return false;
  }
}

// 인증 성공 시 포인트 적립 + 원장/중복표 갱신. 새 잔액을 반환.
export function creditVisit(entry: Omit<LedgerEntry, 'at'>): number {
  const at = new Date().toISOString();
  try {
    // 중복 방지 표
    const certRaw = localStorage.getItem(CERTIFIED_KEY);
    const certArr: string[] = certRaw ? JSON.parse(certRaw) : [];
    if (!certArr.includes(entry.place_key)) certArr.push(entry.place_key);
    localStorage.setItem(CERTIFIED_KEY, JSON.stringify(certArr));

    // 원장
    const ledger = getLedger();
    ledger.unshift({ ...entry, at });
    localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger.slice(0, 100)));

    // 잔액
    const next = getBalance() + entry.points;
    localStorage.setItem(BALANCE_KEY, String(next));
    return next;
  } catch {
    return getBalance();
  }
}

// 추천/공유 시점(epoch ms)으로부터 인증 가능 기간이 지났는지
export function isCertWindowExpired(issuedAtMs?: number | null): boolean {
  if (!issuedAtMs) return false; // 시점 정보가 없으면 막지 않는다(최소 불편)
  return Date.now() - issuedAtMs > CERT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}
