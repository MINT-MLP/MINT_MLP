import { askClaude, CLAUDE_MODELS } from '../_lib/claude.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clientIp, checkRateLimit, validateRecommendBody } from '../_lib/guard.js';
import { getBubbleScoresCacheOnly } from '../_lib/blogBuzz.js';
import { fetchStoresInRadius, matchStoreToPlace, lookupYearsAlive, computeLocalGem } from '../_lib/publicData.js';
import { isStoreAllowedForPurpose, isGloballyExcludedStore, classifyStoreGroup } from '../_lib/purposeGate.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { placeKey } from '../_lib/placeKey.js';
import { computeFinalScores } from '../_lib/scoring.js';
import { fetchCongestion } from '../_lib/congestion.js';
import { safeEqualStr } from '../_lib/adminAuth.js';

interface NaverPlace {
  name: string;
  category: string;
  address: string;   // 표시용 (도로명 우선)
  jibun?: string;    // 지번주소 — 동(법정동) 이름이 들어있어 동 단위 스코프 매칭에 사용
  lat: number;
  lng: number;
}

interface WeatherInfo {
  description: string;
  temp: number;
  isRainy: boolean;
  isHot: boolean;
  isCold: boolean;
}

interface FinalistPlace extends Record<string, unknown> {
  slotRank?: number;
  purposeSlot?: number;
  sourceIndex?: number;
  placeName: string;
  category?: string;
  description?: string;
  priceRange?: string;
  vibeTags?: string[];
  address: string;
  area?: string;
  fitScore?: number;
  finalScore?: number;
  bubbleScore?: number;
  buzzCount?: number;
  naverRank?: number | null;
  isPublicGem?: boolean;
  rank?: number;
  lat?: number;
  lng?: number;
  congestionLevel?: string;
  openingHours?: string;
  kakaoPlaceUrl?: string;
  imageUrl?: string;
  walkingToNext?: number;
}

// 중간지점 반경 (1차: 1.5km, 부족하면 3km로 확장)
const MIDPOINT_RADIUS_KM = 1.5;

// L1(블로그 버즈)·L3(괴리 보정) 재채점을 위해 Claude가 먼저 확정 표시 개수보다
// 넉넉히 파이널리스트를 뽑게 한 뒤, 재채점 후 최종 표시 개수로 슬라이스한다.
// 표시는 단일 3곳 / 이중 6곳이라, 재정렬 풀은 8·5면 충분하다(출력 토큰 절감).
// 표시는 단일 3곳 / 이중 6곳. 재채점 여유분만 남기고 축소해 Claude 출력 토큰을 줄인다(속도).
// (시 전체는 구 골고루 위해 별도로 12/9로 확대 — cityWideSel 분기 참고)
const FINALIST_COUNT_SINGLE = 6;
const FINALIST_COUNT_PER_PURPOSE = 4;

function distKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function walkingMinutes(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return Math.round((distKm(lat1, lng1, lat2, lng2) / 4) * 60);
}

// 중간지점 기준 반경 내 장소만 필터링.
// 1단계: 1.5km 이내 3개 이상 → 반환
// 2단계: 부족하면 3km로 확장
// 3단계: 그래도 없으면 거리순 정렬 후 전체 반환 (시골·비도심 대응)
function filterByRadius(places: NaverPlace[], midLat: number, midLng: number): NaverPlace[] {
  const withDist = places.map((p) => ({ ...p, _dist: distKm(midLat, midLng, p.lat, p.lng) }));
  const inPrimary = withDist.filter((p) => p._dist <= MIDPOINT_RADIUS_KM);
  if (inPrimary.length >= 3) return inPrimary;
  const inExpanded = withDist.filter((p) => p._dist <= MIDPOINT_RADIUS_KM * 2);
  if (inExpanded.length > 0) return inExpanded;
  // 반경 내 장소 없음 → 무게중심에서 가장 가까운 순으로 전체 반환
  return withDist.sort((a, b) => a._dist - b._dist);
}

// ── 행정단위 스코프(시/구/동) ──
// 클라이언트가 선택한 행정단위에 맞춰 추천 범위를 고정한다. 고정 반경 대신
// "결과 주소에 그 시/구/동 이름이 들어있는지"로 걸러 '구 전체 / 동 전체'가 진짜로 성립하게 한다.
interface RegionScope {
  level: 'city' | 'district' | 'dong';
  matchTokens: string[];   // 결과 주소에 모두 포함돼야 하는 행정 토큰 (예: ['인천','미추홀구'])
  centerLat: number;
  centerLng: number;
}

function stripSpace(s: string): string {
  return (s || '').replace(/\s/g, '');
}

// 주소에 matchTokens가 모두 들어있는 장소만 통과 (공백 무시 부분매칭).
// 도로명주소엔 동 이름이 없으므로 지번(jibun)까지 함께 본다 — 동 단위 스코프의 핵심.
function filterByAddressTokens<T extends NaverPlace>(places: T[], tokens: string[]): T[] {
  const toks = tokens.map(stripSpace).filter(Boolean);
  if (!toks.length) return places;
  return places.filter((p) => {
    const hay = stripSpace(p.address) + '|' + stripSpace(p.jibun ?? '');
    return toks.every((t) => hay.includes(t));
  });
}

// 주소에서 구/군 토큰 추출 (시 전체 추천 시 '구 골고루' 분산용)
function guOfAddress(address: string): string {
  const t = (address || '').trim().split(/\s+/).find((tok) => /(구|군)$/.test(tok));
  return t ?? '';
}

// 행정단위 스코프 적용: 주소매칭 우선, 부족하면 레벨별 반경으로 보완(빈 결과 방지)
function scopePlaces(raw: NaverPlace[], scope: RegionScope | null, midLat: number, midLng: number): NaverPlace[] {
  if (!scope) return filterByRadius(raw, midLat, midLng);
  const byAddr = filterByAddressTokens(raw, scope.matchTokens);
  if (byAddr.length >= 3) return byAddr;
  // 주소매칭이 부족하면(희소 지역) 레벨에 맞는 반경으로 보완 — 그래도 근처 위주
  const km = scope.level === 'city' ? 15 : scope.level === 'district' ? 6 : 2.5;
  const withDist = raw.map((p) => ({ ...p, _d: distKm(scope.centerLat, scope.centerLng, p.lat, p.lng) }));
  const near = withDist.filter((p) => p._d <= km).sort((a, b) => a._d - b._d);
  const seen = new Set(byAddr.map((p) => `${p.name}|${p.address}`));
  const merged = [...byAddr];
  for (const p of near) {
    const k = `${p.name}|${p.address}`;
    if (!seen.has(k)) { seen.add(k); merged.push(p); }
  }
  if (merged.length > 0) return merged;
  return withDist.sort((a, b) => a._d - b._d);
}

// 카카오 로컬 단일 카테고리 좌표+반경 검색 (음식점 FD6 / 카페 CE7).
async function fetchKakaoByCategory(
  lat: number, lng: number, radiusM: number, cat: 'FD6' | 'CE7', restApiKey: string, pages = 3,
): Promise<NaverPlace[]> {
  const out: NaverPlace[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= pages; page++) {
    try {
      const url = `https://dapi.kakao.com/v2/local/search/category.json?category_group_code=${cat}&x=${lng}&y=${lat}&radius=${Math.min(radiusM, 20000)}&size=15&page=${page}&sort=distance`;
      const res = await fetch(url, { headers: { Authorization: `KakaoAK ${restApiKey}` } });
      if (!res.ok) break;
      const data = await res.json() as {
        documents?: { place_name: string; category_name: string; road_address_name?: string; address_name?: string; x: string; y: string }[];
        meta?: { is_end?: boolean };
      };
      for (const d of data.documents ?? []) {
        const key = `${d.place_name}|${d.road_address_name || d.address_name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          name: d.place_name,
          category: d.category_name,
          address: d.road_address_name || d.address_name || '',
          jibun: d.address_name || d.road_address_name || '', // 지번(동 포함)
          lat: parseFloat(d.y),
          lng: parseFloat(d.x),
        });
      }
      if (data.meta?.is_end) break;
    } catch { break; }
  }
  return out;
}

// 카카오 로컬 좌표+반경 음식점/카페 검색 — 네이버가 희소한 동이어도 좌표 기반으로 후보를 보장.
// (네이버 지역검색은 키워드 기반이라 좌표 스코프가 없음 → 카카오로 지오코드 커버리지 확보)
async function fetchKakaoLocalFood(
  lat: number, lng: number, radiusM: number, restApiKey: string,
): Promise<NaverPlace[]> {
  const [fd, ce] = await Promise.all([
    fetchKakaoByCategory(lat, lng, radiusM, 'FD6', restApiKey),
    fetchKakaoByCategory(lat, lng, radiusM, 'CE7', restApiKey),
  ]);
  const seen = new Set<string>();
  const out: NaverPlace[] = [];
  for (const p of [...fd, ...ce]) {
    const key = `${p.name}|${p.address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

// ── 3차(이어서 갈 곳) 성격 규칙 ──
// 마지막 코스(2차, 없으면 1차) + 현재 시각으로 3차 성격을 결정론적으로 정한다(AI 판단 아님).
// category: 카카오 카테고리 코드. tokens: 있으면 그 토큰이 가게명/카테고리에 있어야 통과(술집/야식 좁히기).
function thirdCourseSpec(
  lastCourse: string, hour: number,
): { label: string; category: 'FD6' | 'CE7'; tokens?: string[] } | null {
  const c = lastCourse || '';
  const BAR_TOKENS = ['술집', '바', '포차', '호프', '이자카야', '와인', '펍', '칵테일', '오뎅', '요리주점', '맥주', '주점'];
  const LATE_TOKENS = ['국밥', '해장', '포차', '분식', '치킨', '라멘', '족발', '우동', '국수', '곱창', '노포', '포장마차'];
  const isLate = hour >= 21 || hour < 5;
  if (c.includes('술')) {
    // 술 다음: 늦은 시간이면 야식·해장, 아니면 카페로 마무리
    return isLate
      ? { label: '야식·해장', category: 'FD6', tokens: LATE_TOKENS }
      : { label: '카페·디저트', category: 'CE7' };
  }
  if (c.includes('카페')) {
    // 카페 단독 코스 다음: 술 한잔
    return { label: '술 한잔', category: 'FD6', tokens: BAR_TOKENS };
  }
  // 밥 / 기타(메뉴 콕·커스텀): 저녁 이후면 술, 낮이면 카페
  return hour >= 20 || hour < 5
    ? { label: '술 한잔', category: 'FD6', tokens: BAR_TOKENS }
    : { label: '카페·디저트', category: 'CE7' };
}

// 시 전체 추천 시 구/군이 한쪽에 쏠리지 않게 골고루 섞는다(점수순 유지하며 라운드로빈).
function spreadByGu<T extends { address: string }>(sorted: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const p of sorted) {
    const gu = guOfAddress(p.address) || '__none__';
    if (!groups.has(gu)) groups.set(gu, []);
    groups.get(gu)!.push(p);
  }
  if (groups.size <= 1) return sorted;
  const buckets = [...groups.values()];
  const out: T[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const b of buckets) {
      const next = b.shift();
      if (next) { out.push(next); added = true; }
    }
  }
  return out;
}

// 시 전체 2코스: 대표 1차·2차(rank1·rank2)가 걸어서 이어지는 한 쌍이 되도록 선택.
// (시 전체는 구 골고루 분산 탓에 1차·2차가 먼 구로 갈라져 코스가 비현실적이 되던 걸 교정)
const PAIR_MAX_KM = 2.0;        // 하드캡(도보 ~30분 / 택시 기본요금 거리)
const PAIR_WALK_PENALTY = 0.5;  // 점(0~110 스케일)/도보 1분
const PAIR_SCORE_FLOOR = 15;    // 1패스: 각 슬롯 최고점 대비 허용 하락폭

function pickClosePrimaryPair(
  first: FinalistPlace[], second: FinalistPlace[], numScore: (p: FinalistPlace) => number,
): { f: FinalistPlace; s: FinalistPlace } | null {
  const ok = (p: FinalistPlace) =>
    typeof p.lat === 'number' && typeof p.lng === 'number' && p.lat !== 0 && p.lng !== 0;
  const topF = first.length ? Math.max(...first.map(numScore)) : 0;
  const topS = second.length ? Math.max(...second.map(numScore)) : 0;

  const scan = (applyFloor: boolean) => {
    let best: { f: FinalistPlace; s: FinalistPlace; obj: number; km: number } | null = null;
    for (const f of first) {
      if (!ok(f)) continue;
      if (applyFloor && numScore(f) < topF - PAIR_SCORE_FLOOR) continue;
      for (const s of second) {
        if (!ok(s)) continue;
        if (applyFloor && numScore(s) < topS - PAIR_SCORE_FLOOR) continue;
        // 같은 가게가 1차·2차 양쪽 후보에 있을 수 있음(예: 술↔술) — 자기 자신 쌍 금지
        if (f.placeName === s.placeName && f.address === s.address) continue;
        const km = distKm(f.lat as number, f.lng as number, s.lat as number, s.lng as number);
        if (km > PAIR_MAX_KM) continue;
        const obj = numScore(f) + numScore(s) - PAIR_WALK_PENALTY * (km / 4) * 60;
        if (!best || obj > best.obj
            || (obj === best.obj && (km < best.km
            || (km === best.km && numScore(f) > numScore(best.f))))) {
          best = { f, s, obj, km };
        }
      }
    }
    return best;
  };

  // 1패스: 품질 하한 적용 → 2패스: 하한 해제. 둘 다 없으면 2km 내 쌍 없음 → null(폴백).
  const hit = scan(true) ?? scan(false);
  return hit ? { f: hit.f, s: hit.s } : null;
}

// 목적별 검색 키워드 (각 10개, 병렬 쿼리로 최대 50개 장소 확보)
const PURPOSE_KEYWORDS: Record<string, string[]> = {
  '밥':    ['맛집', '식당', '한식', '일식당', '고깃집', '파스타', '이탈리안', '삼겹살', '스시', '해산물'],
  // 타깃은 2030 MZ. 단, 특정 유형(포차·소주방=남성/특정문화 편중)에 가중치를 주지 않고 모든 술집 유형을 동등하게 둔다.
  // 여성친화(와인바·칵테일바·하이볼바·루프탑바)와 캐주얼(술집·호프·펍·포차)을 균형 배치 → 실제 차별화는 분위기/모임조건이 결정.
  '술':    ['이자카야', '술집', '와인바', '칵테일바', '하이볼바', '요리주점', '호프', '펍', '루프탑바', '포차'],
  '카페':  ['카페', '커피', '브런치', '디저트', '베이커리', '루프탑카페', '감성카페', '티카페', '핸드드립', '스페셜티'],
  '기타':  ['맛집', '음식점', '식당', '카페', '바', '이자카야', '포차', '브런치', '고깃집', '커피'],
};

// 장르 좁히기 — 사용자가 밥/술의 장르를 지정하면 검색 키워드 풀을 통째로 교체한다.
// 키(라벨)는 클라이언트 PURPOSE_GENRES와 반드시 일치.
const GENRE_KEYWORDS: Record<string, string[]> = {
  '한식':      ['한식', '한식 맛집', '국밥', '고깃집', '삼겹살', '한정식', '찌개', '백반', '족발', '갈비'],
  '중식':      ['중식당', '중국집', '짬뽕', '마라탕', '딤섬', '양꼬치', '중화요리', '탕수육'],
  '일식':      ['일식당', '스시', '초밥', '라멘', '돈카츠', '우동', '텐동', '오마카세', '덮밥'],
  '양식':      ['파스타', '이탈리안', '스테이크', '피자', '수제버거', '브런치', '비스트로', '프렌치'],
  '아시안':    ['쌀국수', '베트남 음식', '태국 음식', '팟타이', '커리', '아시안 음식', '분짜'],
  '소주·맥주': ['술집', '포차', '호프', '맥주집', '소주방', '펍', '노포 술집', '수제맥주'],
  '와인':      ['와인바', '내추럴와인', '와인 비스트로', '보틀샵', '와인'],
  '칵테일':    ['칵테일바', '라운지바', '스피크이지', '루프탑바', '바'],
  '이자카야':  ['이자카야', '사케바', '일본식 주점', '오뎅바', '하이볼바', '야키토리'],
};

// 편식 필터 — 사용자가 입력한 못 먹는 음식명 → 가게명/카테고리에서 걸러낼 확장 토큰.
// 입력 텍스트가 키를 포함하면 확장 토큰을 적용하고, 입력 자체(2자 이상)도 토큰으로 쓴다.
// '회'처럼 1글자 음식은 그대로 매칭하면 오탐('회식', '회관')이 나므로 확장 토큰으로만 거른다.
const EXCLUDE_FOOD_EXPANSIONS: [string, string[]][] = [
  ['회', ['횟집', '회센터', '물회', '사시미', '오마카세', '참치', '스시', '초밥']],
  ['날생선', ['횟집', '회센터', '물회', '사시미', '스시', '초밥']],
  ['생선', ['횟집', '회센터', '물회', '사시미', '생선구이', '생선조림']],
  ['조개', ['조개', '꼬막', '홍합', '오이스터']],
  ['굴', ['굴국', '굴보쌈', '굴전', '굴찜', '석화', '오이스터']],
  ['새우', ['새우', '쉬림프', '랍스터']],
  ['게', ['대게', '꽃게', '킹크랩', '크랩', '게장']],
  ['갑각', ['새우', '쉬림프', '랍스터', '대게', '꽃게', '킹크랩', '크랩']],
  ['해산물', ['해물', '해산물', '횟집', '조개', '수산']],
  ['곱창', ['곱창', '대창', '막창', '양곱창']],
  ['내장', ['곱창', '대창', '막창', '양곱창', '내장']],
  ['순대', ['순대', '순댓']],
  ['선지', ['선지', '선짓']],
  ['양고기', ['양고기', '양꼬치', '양갈비']],
  ['양꼬치', ['양고기', '양꼬치', '양갈비']],
  ['매운', ['마라', '불닭', '매운', '매콤', '짬뽕', '낙곱새']],
  ['맵', ['마라', '불닭', '매운', '매콤', '짬뽕', '낙곱새']],
  ['돼지', ['돼지', '삼겹', '족발', '보쌈', '돈까스', '돈카츠']],
  ['닭', ['치킨', '닭갈비', '닭발', '닭한마리', '삼계탕', '찜닭']],
  ['소고기', ['소고기', '한우', '갈비', '스테이크']],
];

function excludeFoodTokens(excludeFoods: string[]): string[] {
  const tokens = new Set<string>();
  for (const raw of excludeFoods) {
    const food = raw.trim();
    if (!food) continue;
    if (food.length >= 2) tokens.add(food); // 입력 자체도 매칭 토큰으로
    for (const [key, expansions] of EXCLUDE_FOOD_EXPANSIONS) {
      if (food.includes(key)) expansions.forEach((t) => tokens.add(t));
    }
  }
  return [...tokens];
}

function filterExcludedFoods<T extends NaverPlace>(places: T[], tokens: string[]): T[] {
  if (tokens.length === 0) return places;
  const filtered = places.filter((p) => !tokens.some((t) => p.name.includes(t) || p.category.includes(t)));
  // 후보가 전멸하면 사전 필터는 포기하고 프롬프트 하드 제약에만 맡긴다 (추천 불가보다 낫다)
  return filtered.length > 0 ? filtered : places;
}

// 행사별 추가 키워드 (1순위 지역에 extra 쿼리로 추가)
const OCCASION_EXTRA_KEYWORDS: Record<string, string[]> = {
  '생일':   ['프라이빗룸 식당', '생일 케이크 반입', '이벤트 레스토랑', '생일 맛집'],
  '기념일': ['프라이빗룸 식당', '기념일 레스토랑', '코스요리', '분위기 좋은 레스토랑'],
  '소개팅': ['소개팅 맛집', '분위기 좋은 식당', '조용한 레스토랑', '데이트 맛집'],
  '축하':   ['단체 모임 맛집', '파티 가능 식당', '이벤트 레스토랑'],
  '위로':   ['감성 맛집', '조용한 술집', '힐링 카페'],
};

// 관계별 추가 키워드
const RELATION_EXTRA_KEYWORDS: Record<string, string[]> = {
  '연인':    ['데이트 맛집', '커플 맛집'],
  '직장동료': ['회식 맛집', '단체 식당'],
  '가족':    ['가족 식사 맛집', '넓은 식당'],
};

// 행사별 Claude 힌트
const OCCASION_HINT: Record<string, string> = {
  '생일':   '프라이빗룸 또는 케이크 반입 가능 우선, 이벤트 연출 가능한 곳',
  '기념일': '분위기 있는 공간, 프라이빗 좌석, 조용한 환경 선호',
  '소개팅': '조용하고 대화하기 좋은 공간, 테이블 간격 넓은 곳',
  '축하':   '신나는 분위기, 파티 가능한 곳, 큰 테이블 선호',
  '위로':   '조용하고 편안한 분위기, 오래 머물 수 있는 곳',
};

// 혼잡도 area명 → 네이버 검색에 효과적인 동네명으로 매핑
const AREA_SEARCH_NAME: Record<string, string> = {
  '강남 MICE 관광특구': '강남역',
  '동대문 관광특구':    '동대문',
  '이태원 관광특구':    '이태원',
  '잠실 관광특구':      '잠실',
  '신촌·이대역':        '신촌',
  '한남·이태원':        '한남동',
  '합정역':             '합정',
  '성수역':             '성수동',
  '건대입구역':         '건대',
  '북촌한옥마을':       '북촌',
  '고양 정발산역':      '일산',
  '홍대입구역':         '홍대',
};

function toSearchName(area: string): string {
  // 매핑에 없으면 '관광특구' 접미사만 제거 — "홍대 관광특구 술집" 같은 저효율 쿼리 방지
  return AREA_SEARCH_NAME[area] ?? area.replace(/\s*관광특구$/, '');
}

// 단일 Naver 쿼리 → raw items 반환 (display=5 is API max for local search)
// 429(초당 호출 제한)는 잠깐 쉬고 1회 재시도 — 키워드/목적 쿼리가 조용히 누락되는 걸 방지
async function fetchNaverQuery(
  query: string,
  clientId: string,
  clientSecret: string,
  attempt = 0,
): Promise<NaverPlace[]> {
  try {
    const url = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=5&start=1&sort=random`;
    const res = await fetch(url, {
      headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret },
    });
    // 429(초당 호출 제한) — 시 전체 검색은 쿼리가 많아 429가 잦다. 백오프하며 최대 3회 재시도.
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1) + Math.random() * 400));
      return fetchNaverQuery(query, clientId, clientSecret, attempt + 1);
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[Naver API] FAIL query="${query}" status=${res.status} body=${errText.slice(0, 200)}`);
      return [];
    }
    const data = await res.json() as {
      items?: { title: string; category: string; roadAddress: string; address: string; mapx: string; mapy: string }[];
    };
    const items = data.items ?? [];
    console.log(`[Naver API] OK query="${query}" count=${items.length}`);
    return items.map((item) => ({
      // 태그 제거 + HTML 엔티티 복원 ("&amp;" 그대로 노출 방지)
      name: item.title.replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
      category: item.category,
      address: item.roadAddress || item.address,
      jibun: item.address || item.roadAddress, // 지번(동 포함) — 동 단위 스코프 매칭용
      lat: parseInt(item.mapy) / 1e7,
      lng: parseInt(item.mapx) / 1e7,
    }));
  } catch (e) {
    console.error(`[Naver API] ERROR query="${query}"`, e);
    return [];
  }
}

/**
 * 목적별 다중 키워드로 네이버 검색 → 중복 제거 + 거리순 정렬 → 최대 50개 반환.
 * - 1순위 지역: 전체 키워드(10개) × display=5 → 최대 50개 raw
 * - 2순위 지역: 상위 5개 키워드 추가
 * - 3순위 지역: 상위 3개 키워드 추가
 */
async function searchNaverMulti(
  purpose: string,
  areas: string[],
  groupSize: number,
  midLat: number,
  midLng: number,
  occasion?: string | null,
  relation?: string | null,
  budget?: string | null,
  userKeywords: string[] = [],
  genre?: string | null,
  balanced = false, // 시 전체 추천: 지역(구)별로 후보를 고르게 소싱 (한 구 쏠림 방지)
): Promise<NaverPlace[]> {
  const clientId     = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return [];

  const isLargeGroup = groupSize >= 5;
  const groupPrefix  = isLargeGroup ? '단체 ' : '';
  const budgetPrefix = budget === '~2만원' ? '가성비 ' : budget === '4만원+' ? '고급 ' : '';
  // '메뉴 콕'(기타) 목적은 입력한 메뉴 자체가 최우선 검색 키워드 — 안 넣으면 원하는 업종이 후보에 아예 없음.
  // 여러 메뉴는 쉼표로 결합돼 오므로(예: "보쌈,피자") 각각을 검색 키워드로 분리해 모두 반영한다.
  const isCustomPurpose = !PURPOSE_KEYWORDS[purpose];
  const customMenus = purpose.split(',').map((s) => s.trim()).filter(Boolean);
  // "회&초밥"은 한 집에서 함께 파는 곳을 원한다는 뜻 → 파트를 공백으로 이어 하나의 검색어로.
  // (예: "회 초밥" 검색 → 회·초밥 둘 다 취급하는 일식집이 후보로 잡힘). 쉼표로 나뉜 메뉴는 각각 별도 검색.
  const customSearchKeywords = customMenus.map((m) =>
    m.split('&').map((s) => s.trim()).filter(Boolean).join(' '),
  );
  // (구버전 호환) 장르가 지정되면 키워드 풀을 통째로 해당 장르로 교체.
  const genrePool = genre
    ? (GENRE_KEYWORDS[genre] ?? genre.split(',').map((s) => s.trim()).filter(Boolean))
    : undefined;
  const baseKeywords = genrePool ?? (isCustomPurpose ? customSearchKeywords : PURPOSE_KEYWORDS[purpose]);

  // 행사/관계 추가 키워드 병합
  const extraKeywords = [
    ...(occasion ? (OCCASION_EXTRA_KEYWORDS[occasion] ?? []) : []),
    ...(relation ? (RELATION_EXTRA_KEYWORDS[relation] ?? []) : []),
  ];
  const keywords = [...extraKeywords, ...baseKeywords];

  const searchAreas  = areas.map(toSearchName).filter(Boolean);

  const categoryHint = genre && GENRE_KEYWORDS[genre]
    ? genre
    : isCustomPurpose
      ? (customSearchKeywords[0] ?? '맛집')
      : ({ '밥': '맛집', '술': '술집', '카페': '카페' } as Record<string, string>)[purpose] ?? '맛집';

  // 쿼리 빌드 — 각 쿼리에 소속 지역 인덱스(areaIdx)를 붙여 나중에 구별 균형 소싱에 쓴다.
  const queries: { q: string; areaIdx: number }[] = [];
  if (balanced) {
    // 시 전체: 여러 유명상권(구)에 키워드를 고르게 분배 — 한 구 쏠림 방지.
    // 쿼리 순서를 '키워드 바깥·지역 안쪽'으로 인터리브해서, 네이버 QPS로 뒷부분이 잘려도
    // 각 구가 고르게 남게 한다(지역별로 몰아 넣으면 앞 구만 채워짐).
    // 구당 키워드를 3개로 줄여 총 쿼리 수를 낮춘다(네이버 429 방지). 구 스프레드가 우선.
    const cityAreas = searchAreas.slice(0, 5);
    const per = keywords.slice(0, 3);
    per.forEach((kw) => {
      cityAreas.forEach((area, idx) => queries.push({ q: `${area} ${groupPrefix}${budgetPrefix}${kw}`, areaIdx: idx }));
    });
  } else {
    // 기본: 1순위×8, 2순위×3 (3순위 제거로 쿼리 수·429·지연 축소 — 후보 풀은 50캡·반경필터라 충분)
    if (searchAreas[0]) keywords.slice(0, 8).forEach((kw) => queries.push({ q: `${searchAreas[0]} ${groupPrefix}${budgetPrefix}${kw}`, areaIdx: 0 }));
    if (searchAreas[1]) keywords.slice(0, 3).forEach((kw) => queries.push({ q: `${searchAreas[1]} ${groupPrefix}${budgetPrefix}${kw}`, areaIdx: 1 }));
    // 사용자 지정 키워드(편의시설 칩·직접 입력)를 목적 힌트와 결합해 후보 검색에 직접 반영
    for (const kw of userKeywords.slice(0, 3)) {
      if (searchAreas[0]) queries.push({ q: `${searchAreas[0]} ${kw} ${categoryHint}`, areaIdx: 0 });
    }
  }

  // 네이버 QPS 제한(초당 10회) — 1·2차 검색이 병렬로 돌므로 끊어 실행.
  // 시 전체(balanced)는 쿼리가 많아 더 작게·느리게 끊어 429를 줄인다.
  // 시 전체는 1·2차가 병렬로 도는 걸 감안해 배치를 작게(2개)·느리게(500ms) — 합산 QPS를
  // 네이버 한도 아래로 눌러 뒤쪽 구가 429로 잘리는 걸 막는다.
  const chunkSize = balanced ? 2 : 5;
  const gapMs = balanced ? 500 : 350;
  const batches: { places: NaverPlace[]; areaIdx: number }[] = [];
  for (let i = 0; i < queries.length; i += chunkSize) {
    if (i > 0) await new Promise((r) => setTimeout(r, gapMs));
    const chunk = await Promise.all(
      queries.slice(i, i + chunkSize).map(async (item) => ({ places: await fetchNaverQuery(item.q, clientId, clientSecret), areaIdx: item.areaIdx })),
    );
    batches.push(...chunk);
  }

  // 중복 제거 (이름+주소 기준) + 지역별 그룹핑
  const seen = new Set<string>();
  const byArea = new Map<number, (NaverPlace & { dist: number })[]>();
  for (const batch of batches) {
    for (const p of batch.places) {
      const key = `${p.name}|${p.address}`;
      if (seen.has(key) || !p.lat || !p.lng) continue;
      seen.add(key);
      const dist = Math.hypot(p.lat - midLat, p.lng - midLng);
      if (!byArea.has(batch.areaIdx)) byArea.set(batch.areaIdx, []);
      byArea.get(batch.areaIdx)!.push({ ...p, dist });
    }
  }

  if (balanced) {
    // 구별 라운드로빈으로 최대 50개 — 각 지역(구)에서 가까운 순으로 번갈아 뽑아 골고루 채운다
    for (const arr of byArea.values()) arr.sort((a, b) => a.dist - b.dist);
    const buckets = [...byArea.values()];
    const out: (NaverPlace & { dist: number })[] = [];
    let added = true;
    while (added && out.length < 50) {
      added = false;
      for (const b of buckets) {
        const next = b.shift();
        if (next) { out.push(next); added = true; if (out.length >= 50) break; }
      }
    }
    return out;
  }

  // 기본: 거리 가까운 순으로 정렬 후 50개
  const all = [...byArea.values()].flat();
  all.sort((a, b) => a.dist - b.dist);
  return all.slice(0, 50);
}

// Open-Meteo 현재 날씨 조회 — API 키 불필요.
// (기존 OpenWeather는 프로덕션에서 항상 null을 반환하고 있었음 — 키 인증 실패.
//  키 관리가 필요 없는 Open-Meteo로 교체해 이 고장 유형 자체를 제거)
function wmoDescription(code: number): string {
  if (code === 0) return '맑음';
  if (code <= 2) return '구름 조금';
  if (code === 3) return '흐림';
  if (code === 45 || code === 48) return '안개';
  if (code <= 57) return '이슬비';
  if (code <= 67) return '비';
  if (code <= 77) return '눈';
  if (code <= 82) return '소나기';
  if (code <= 86) return '소낙눈';
  return '뇌우';
}

async function fetchWeather(lat: number, lng: number): Promise<WeatherInfo | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,weather_code&timezone=Asia%2FSeoul`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json() as {
      current?: { temperature_2m?: number; precipitation?: number; weather_code?: number };
    };
    const cur = data.current;
    if (!cur || typeof cur.temperature_2m !== 'number') return null;
    const code = cur.weather_code ?? 0;
    const temp = cur.temperature_2m;
    return {
      description: wmoDescription(code),
      temp: Math.round(temp),
      // WMO 51 이상 = 강수(이슬비~뇌우). 실측 강수량도 함께 본다.
      isRainy: code >= 51 || (cur.precipitation ?? 0) > 0.1,
      isHot: temp >= 28,
      isCold: temp <= 5,
    };
  } catch {
    return null;
  }
}

// ── 대표 이미지 오매칭 방지 사전/유틸 ──
// 이미지검색은 "장소"가 아니라 "웹 이미지"를 찾으므로, 결과가 이 장소의 사진인지 사후 검증한다.
// 원칙: 애매하면 붙이지 않는다(null). 틀린 사진 한 장이 신뢰를 통째로 깬다.
const IMG_HOTEL_RE = /모텔|호텔|무인텔|펜션|풀빌라|게스트하우스|리조트|숙박|객실|투숙/;
const IMG_REALTY_RE = /부동산|공인중개|매물|원룸|투룸|오피스텔|아파트|분양|입주|전세|월세|임대|시세/;
const IMG_NONPHOTO_RE = /지도|약도|찾아오시는|오시는\s*길|위치\s*안내|로고|채용|구인|구직/;
const IMG_ADULT_RE = /유흥|노래방\s*도우미|성인/;
const IMG_BADDOMAIN_RE = /yanolja|goodchoice|여기어때|agoda|booking\.|airbnb|hotelscombined|zigbang|dabang|r114|kbland|hogangnono/i;
const IMG_FOOD_RE = /맛집|메뉴|안주|사케|하이볼|오마카세|회|꼬치|식당|요리|카페|디저트|맛있|존맛|술집|이자카야|포차|바베큐|고기|파스타|초밥|스시/;
const IMG_REVIEW_RE = /후기|리뷰|방문|다녀왔|내돈내산/;

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}
function shortenCategory(category?: string | null): string {
  if (!category) return '';
  const parts = category.split(/[>·,/|]/).map((s) => s.trim()).filter(Boolean);
  return (parts[parts.length - 1] ?? '').slice(0, 20);
}
function placeNameTokens(name: string): string[] {
  return name.split(/[\s()[\]·,./&]+/).map((t) => t.trim()).filter((t) => t.length >= 2);
}

// 네이버 이미지 검색으로 장소 대표 사진 1장 확보 — 단, 상호가 제목에서 확인되고
// 오탐 사전(모텔·부동산·비사진 등)을 통과하며 보조 신호가 있을 때만. 미달이면 null(이미지 없음).
async function fetchPlaceImage(
  name: string,
  area: string,
  category: string,
  clientId: string,
  clientSecret: string,
): Promise<string | null> {
  try {
    const cat = shortenCategory(category);
    const query = [area, name, cat].filter(Boolean).join(' ').trim();
    const url = `https://openapi.naver.com/v1/search/image?query=${encodeURIComponent(query)}&display=10&sort=sim`;
    const res = await fetch(url, {
      headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret },
    });
    if (!res.ok) return null;
    const data = await res.json() as { items?: { title?: string; link?: string; thumbnail?: string; sizewidth?: string; sizeheight?: string }[] };
    const items = data.items ?? [];

    const tokens = placeNameTokens(name);
    // 짧은/일반명사 상호는 오탐 급증 → area 매칭까지 사실상 필수화(임계 상향)
    const isShortName = tokens.length <= 1 && name.replace(/\s/g, '').length <= 2;
    const T = isShortName ? 75 : 60;

    let best: string | null = null;
    let bestScore = -1;
    items.forEach((it, idx) => {
      const thumb = it.thumbnail ?? '';
      if (!thumb.startsWith('https://')) return;
      const title = stripTags(it.title ?? '');
      const link = it.link ?? '';
      const w = Number(it.sizewidth) || 0;
      const h = Number(it.sizeheight) || 0;

      // 하드 제외 게이트
      if (IMG_HOTEL_RE.test(title) || IMG_REALTY_RE.test(title) || IMG_NONPHOTO_RE.test(title) || IMG_ADULT_RE.test(title)) return;
      if (IMG_BADDOMAIN_RE.test(link)) return;
      if (w && h && (w < 200 || h < 200)) return;         // 아이콘/로고
      if (w && h && (w / h > 3 || h / w > 3)) return;      // 배너·간판 스트립·지도

      // 상호 토큰 매칭 필수 — 없으면 채택 불가(모텔 사고 직접 차단선)
      const nameHit = name.length >= 2 && title.includes(name);
      const tokenHit = tokens.some((t) => title.includes(t));
      if (!nameHit && !tokenHit) return;

      let score = nameHit ? 60 : 50;
      if (area && title.includes(area)) score += 15;
      if ((cat && title.includes(cat)) || IMG_FOOD_RE.test(title)) score += 10;
      if (IMG_REVIEW_RE.test(title)) score += 5;
      if (/blog\.naver|post\.naver|instagram/.test(link)) score += 5;
      if (/메뉴판|가격표|배달/.test(title)) score -= 10;
      score += Math.max(0, 5 - idx); // sim 상위 타이브레이크

      if (score > bestScore) { bestScore = score; best = thumb; }
    });

    if (!best || bestScore < T) return null; // 애매하면 이미지 없음
    return (best as string).replace(/type=b\d+/, 'type=b400');
  } catch {
    return null;
  }
}

async function searchKakaoPlaceUrl(
  name: string,
  lat: number,
  lng: number,
  restApiKey: string,
): Promise<string | null> {
  try {
    const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(name)}&x=${lng}&y=${lat}&radius=300&size=1`;
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${restApiKey}` } });
    if (!res.ok) return null;
    const data = await res.json() as { documents?: { place_url: string }[] };
    return data.documents?.[0]?.place_url ?? null;
  } catch {
    return null;
  }
}

// Claude 응답에서 places 배열을 추출한다. 정상이면 JSON.parse 한 방에 되지만,
// max_tokens로 응답이 잘리면 마지막 객체가 불완전해 parse가 실패한다. 그럴 때
// 균형 잡힌 중괄호로 "완전한 객체만" 골라 복구한다(장소 몇 곳이라도 건지는 게 500보다 낫다).
function extractPlaces(text: string): FinalistPlace[] | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed.places)) return parsed.places as FinalistPlace[];
      if (parsed.placeName) return [parsed as FinalistPlace];
    } catch { /* 잘린 JSON → 아래 부분 복구로 폴백 */ }
  }

  // 부분 복구: "places" 배열 이후 균형 잡힌 최상위 {…} 객체들만 개별 파싱
  const placesIdx = text.indexOf('places');
  const arrStart = placesIdx >= 0 ? text.indexOf('[', placesIdx) : text.indexOf('[');
  if (arrStart < 0) return null;

  const objects: FinalistPlace[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let escaped = false;
  for (let i = arrStart; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try { objects.push(JSON.parse(text.slice(start, i + 1)) as FinalistPlace); } catch { /* 이 조각은 버림 */ }
        start = -1;
      }
    }
  }
  return objects.length ? objects : null;
}

function formatNaverPlaces(places: (NaverPlace & { _isPublicGem?: boolean; _buzzHint?: string })[]): string {
  return places.map((p, i) => {
    const tag = p._isPublicGem ? '[공공데이터 발굴 후보 — 정보 적음, 업종/연차 기반 보수적 평가, 배제 금지(단, 목적 업종과 무관하면 제외 가능)] ' : '';
    const hint = p._buzzHint ? ` (참고: ${p._buzzHint})` : '';
    return `${i + 1}. ${tag}${p.name} | ${p.category} | ${p.address} | lat:${p.lat.toFixed(4)}, lng:${p.lng.toFixed(4)}${hint}`;
  }).join('\n');
}

// 결과 표시 후처리(카카오 장소 URL + 대표 사진)를 분리한 경량 핸들러.
// 메인 추천 응답을 이 왕복만큼 앞당기고, 클라이언트가 결과를 그린 뒤 채워 넣는다.
// (Vercel Hobby 함수 12개 상한 때문에 새 엔드포인트가 아니라 stage 분기로 처리)
async function handleEnrich(req: VercelRequest, res: VercelResponse) {
  const body = req.body as { places?: unknown };
  const raw = Array.isArray(body.places) ? body.places : [];
  const places = raw
    .filter((p): p is { placeName: string; lat: number; lng: number; area?: string; category?: string } =>
      !!p && typeof p === 'object'
      && typeof (p as { placeName?: unknown }).placeName === 'string'
      && (p as { placeName: string }).placeName.length <= 80
      && typeof (p as { lat?: unknown }).lat === 'number'
      && typeof (p as { lng?: unknown }).lng === 'number')
    .slice(0, 7); // 1차 메인+대안(4) + 2차 메인+대안(2) + 3차(1) = 최대 7곳까지 사진·URL 보강
  const kakaoRestKey = process.env.VITE_KAKAO_REST_API_KEY;
  const naverImgId = process.env.NAVER_CLIENT_ID;
  const naverImgSecret = process.env.NAVER_CLIENT_SECRET;
  const enriched = await Promise.all(places.map(async (p) => {
    const hasCoords = !!p.lat && !!p.lng && p.lat !== 0;
    const [placeUrl, imageUrl] = await Promise.all([
      kakaoRestKey && hasCoords ? searchKakaoPlaceUrl(p.placeName, p.lat, p.lng, kakaoRestKey) : Promise.resolve(null),
      naverImgId && naverImgSecret
        ? fetchPlaceImage(p.placeName, toSearchName(typeof p.area === 'string' ? p.area : ''), typeof p.category === 'string' ? p.category.slice(0, 60) : '', naverImgId, naverImgSecret)
        : Promise.resolve(null),
    ]);
    return { placeName: p.placeName, kakaoPlaceUrl: placeUrl ?? undefined, imageUrl: imageUrl ?? undefined };
  }));
  return res.status(200).json({ enriched });
}

// '조용한 곳' 의도가 어느 통로로 들어왔는지 상관없이 하나로 판정한다.
// 그룹 집계는 분위기 라벨을 승자 하나만 vibe.first에 남기고 나머지는 keywords로 흘려보내므로,
// first만 보면 같은 의도가 통로에 따라 사라진다. 프롬프트가 정반대("활기찬")로 뒤집히는 항목이라
// 판정은 넓게 잡는 쪽이 안전하다 — 조용한 곳을 원했는데 시끄러운 곳을 받는 실패가 훨씬 크다.
function detectQuiet(...sources: (string[] | undefined)[]): boolean {
  return sources.some((s) => Array.isArray(s) && s.some((v) => typeof v === 'string' && v.includes('조용')));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  // 후처리 분리 요청(사진·URL) — 검증/레이트리밋 없이 가볍게 처리
  if (req.body?.stage === 'enrich') return handleEnrich(req, res);

  // 입력 검증 — 임의 페이로드로 인한 예외/프롬프트 오염 차단
  const invalidMsg = validateRecommendBody(req.body);
  if (invalidMsg) return res.status(400).json({ error: invalidMsg });

  // 레이트리밋 — IP당 분당 5회, 전체 일일 상한. 데이터 fetch와 병렬로 돌리고 Claude(과금) 직전에 확인.
  const gatePromise = checkRateLimit(
    getSupabaseAdmin(),
    'recommend',
    clientIp(req),
    5,
    Number(process.env.RECOMMEND_DAILY_CAP ?? 500),
  );

  try {
    const { input, midpoint, congestionData } = req.body;

    // 탐색 에피소드 세션키(선택) — recommendation_log·events를 한 에피소드로 조인. 형식 방어.
    const sessionKey: string | null = (() => {
      const sk = req.body.sessionKey;
      return typeof sk === 'string' && sk.length > 0 && sk.length <= 100 ? sk : null;
    })();

    // 행정단위 스코프(선택) — 있으면 시/구/동 범위로 결과를 고정한다.
    const regionScope: RegionScope | null = (() => {
      const rs = req.body.regionScope;
      if (!rs || typeof rs !== 'object') return null;
      const r = rs as Record<string, unknown>;
      if (r.level !== 'city' && r.level !== 'district' && r.level !== 'dong') return null;
      if (!Array.isArray(r.matchTokens)) return null;
      const tokens = r.matchTokens.filter((t): t is string => typeof t === 'string' && !!t.trim());
      if (!tokens.length) return null;
      if (typeof r.centerLat !== 'number' || typeof r.centerLng !== 'number') return null;
      return { level: r.level, matchTokens: tokens, centerLat: r.centerLat, centerLng: r.centerLng };
    })();

    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const purpose = input.purpose as {
      first: string; second: string | null; firstGenre?: string | null; secondGenre?: string | null;
    };
    const hasTwoPurposes = !!(purpose.second && purpose.second !== '없음');
    // 장르 좁히기 — 알려진 장르만 인정 (임의 문자열로 프롬프트/검색 오염 방지)
    // 프리셋 장르(GENRE_KEYWORDS) + 사용자가 직접 입력한 메뉴(예: 두루치기)도 그대로 수용.
    // 직접 입력 메뉴는 아래 searchNaverMulti에서 검색 키워드 풀을 그 메뉴로 교체해 확실히 반영한다.
    const firstGenre = purpose.firstGenre?.trim() || null;
    const secondGenre = purpose.secondGenre?.trim() || null;
    const purposeFirstLabel = firstGenre ? `${purpose.first}·${firstGenre}` : purpose.first;
    const purposeSecondLabel = secondGenre && purpose.second ? `${purpose.second}·${secondGenre}` : purpose.second;
    const vibe = input.vibe as { first?: string[]; second?: string[] } | undefined;
    const vibeFirstStr = vibe?.first?.length ? vibe.first.join(', ') : '자유롭게';
    const vibeSecondStr = vibe?.second?.length ? vibe.second.join(', ') : '';
    const groupSize: number = typeof input.groupSize === 'number' ? input.groupSize : parseInt(input.groupSize) || 2;
    const relation: string | null = input.relation ?? null;
    const occasion: string | null = input.occasion ?? null;
    const budget: string | null = input.budget ?? null;

    const keywords: string[] = Array.isArray(input.keywords) ? input.keywords : [];
    const keywordsSecond: string[] = Array.isArray(input.keywordsSecond) ? input.keywordsSecond : [];

    // '조용하게'는 vibe.first에만 있는 게 아니다.
    // 혼자 모드는 고른 분위기 라벨이 전부 vibe.first에 들어가지만, 그룹 모드는 집계가
    // 최다 득표 라벨만 first에 남긴다 — 전원이 '아늑한 + 조용하게'를 골라도 승자가 '아늑한'이면
    // first에 '조용하게'가 없고, 진 라벨은 vibe.second나 keywords로 흘러간다.
    // 그래서 first만 보면 조용한 곳을 원한 팀에게 프롬프트가 "활기찬 분위기"를 넣어버렸다.
    // 라벨이 어느 통로로 왔든 의도는 같으므로 세 곳을 모두 본다.
    const isQuiet = detectQuiet(vibe?.first, vibe?.second, keywords);

    // 편식 필터 — 후보 사전 제거(아래 filterExcludedFoods) + 프롬프트 절대 제약 이중 적용
    const excludeFoods: string[] = Array.isArray(input.excludeFoods)
      ? (input.excludeFoods as unknown[])
          .filter((f): f is string => typeof f === 'string' && !!f.trim())
          .map((f) => f.trim())
      : [];
    const excludeTokens = excludeFoodTokens(excludeFoods);

    // 지역명 목록: 신버전 클라이언트는 areas만 보내고 혼잡도는 서버가 병렬 조회(왕복 1회 절감),
    // 구버전 클라이언트는 congestionData에 조회 결과를 담아 보냄 — 둘 다 수용
    const clientCongestion = congestionData as { areaName: string; level: string }[];
    const areaList: string[] = clientCongestion.length
      ? clientCongestion.map((c) => c.areaName)
      : (Array.isArray(req.body.areas) ? (req.body.areas as string[]) : []);

    const areaNames = areaList.join(', ');
    const locationStr = (input.locations as { name: string }[])
      .map((l) => l.name)
      .filter(Boolean)
      .join(', ');
    const primaryArea = areaList[0] || areaNames;

    // 날씨 + 네이버 장소 + 혼잡도 병렬 fetch
    const midLat: number = midpoint?.lat ?? 37.5665;
    const midLng: number = midpoint?.lng ?? 126.9780;

    // 검색 지역 목록. 시 전체 추천은 클라이언트가 유명상권 여러 곳을 보내므로 더 넉넉히 사용.
    const searchAreas = areaList.slice(0, regionScope?.level === 'city' ? 6 : 3);

    // 동/구 단위 선택 시: 네이버가 희소해도 그 범위가 비지 않게 카카오 좌표+반경 검색으로 보강.
    // (네이버 지역검색은 좌표 스코프가 없어 카카오로 지오코드 커버리지를 보장)
    const kakaoRestKeyEarly = process.env.VITE_KAKAO_REST_API_KEY;
    const kakaoSupplementRadius = regionScope?.level === 'dong' ? 2500 : regionScope?.level === 'district' ? 6000 : 0;

    const [weather, naverFirstRaw, naverSecondRaw, publicStores, congestionResolved, kakaoLocalRaw] = await Promise.all([
      fetchWeather(midLat, midLng),
      searchNaverMulti(purpose.first, searchAreas, groupSize, midLat, midLng, occasion, relation, budget, keywords, firstGenre, regionScope?.level === 'city'),
      hasTwoPurposes && purpose.second
        ? searchNaverMulti(purpose.second, searchAreas, groupSize, midLat, midLng, occasion, relation, budget, keywordsSecond.length ? keywordsSecond : keywords, secondGenre, regionScope?.level === 'city')
        : Promise.resolve([]),
      fetchStoresInRadius(midLat, midLng, MIDPOINT_RADIUS_KM * 1000).catch((e) => {
        console.error('[recommend] L0 public data fetch failed', e);
        return [];
      }),
      clientCongestion.length
        ? Promise.resolve(clientCongestion)
        : fetchCongestion(areaList).catch(() => [] as { areaName: string; level: string }[]),
      regionScope && kakaoSupplementRadius > 0 && kakaoRestKeyEarly
        ? fetchKakaoLocalFood(regionScope.centerLat, regionScope.centerLng, kakaoSupplementRadius, kakaoRestKeyEarly)
            .catch((e) => { console.error('[recommend] kakao local supplement failed', e); return [] as NaverPlace[]; })
        : Promise.resolve([] as NaverPlace[]),
    ]);
    const congestionSummary = congestionResolved.map((c) => `${c.areaName}: ${c.level}`).join(', ');
    if (regionScope) {
      console.log(`[recommend] regionScope level=${regionScope.level} tokens=${regionScope.matchTokens.join('/')} kakaoSupplement=${kakaoLocalRaw.length} naverRaw=${naverFirstRaw.length}`);
    }
    // 스코프가 있으면 행정단위(주소)로, 없으면 기존 반경으로 후보를 좁힌다. + 편식 전문점 사전 제거.
    // 카카오 좌표 보강분은 네이버 원본에 합쳐 함께 스코프/편식 필터를 태운다.
    const firstRawScoped = regionScope ? [...naverFirstRaw, ...kakaoLocalRaw] : naverFirstRaw;
    const secondRawScoped = regionScope ? [...naverSecondRaw, ...kakaoLocalRaw] : naverSecondRaw;
    const naverFirstPlaces: (NaverPlace & { _isPublicGem?: boolean })[] =
      filterExcludedFoods(scopePlaces(firstRawScoped, regionScope, midLat, midLng), excludeTokens);
    const naverSecondPlaces: (NaverPlace & { _isPublicGem?: boolean })[] =
      (hasTwoPurposes && secondRawScoped.length) ? filterExcludedFoods(scopePlaces(secondRawScoped, regionScope, midLat, midLng), excludeTokens) : [];
    if (excludeTokens.length > 0) {
      console.log(`[recommend] excludeFoods=${excludeFoods.join(',')} → first ${naverFirstPlaces.length}, second ${naverSecondPlaces.length}`);
    }

    // '메뉴 콕'(기타·직접입력) 목적은 업종 그룹(밥/술/카페)으로 좁힐 수 없다 → 입력 메뉴 토큰으로 게이트.
    // 밥/술/카페 프리셋은 장르가 직접입력이어도 그룹 판정이 더 안전하므로 토큰을 넘기지 않는다(과차단 방지).
    const gateCustomMenuTokens: string[] = ['밥', '술', '카페'].includes(purpose.first)
      ? []
      : [purpose.first, ...(firstGenre ? [firstGenre] : [])]
          .flatMap((s) => s.split(/[,&·]/))
          .map((s) => s.trim())
          .filter((s) => s.length >= 2 && s !== '기타');

    // L0: 네이버에 없는(=매칭 실패) 공공데이터 상가 중 localGem 상위 소수를 후보 풀에 추가.
    // yearsAlive는 license_cache(사전 배치 적재) 매칭 성공 시에만 채워지며, 실패하면 localGem 0
    // 처리되어 자연히 상위권에서 제외된다(정보 없음 = 배제, 임의 추정 안 함).
    try {
      const allKnownPlaces = [...naverFirstPlaces, ...naverSecondPlaces];
      const unmatchedStores = publicStores.filter((s) => !matchStoreToPlace(s, allKnownPlaces));
      // 목적 대비 업종 게이트 — 공공데이터는 음식 대분류(I2) 전수라 제과점·구내식당까지 섞여 온다.
      // 이걸 거르지 않으면 '노포' 조건에 오래 버틴 빵집이 최상위로 올라온다(실제 발생 버그).
      // lookupYearsAlive(Supabase 왕복)를 태우기 전에 걸러 예산을 아낀다.
      let gatedStores = unmatchedStores.filter((s) => isStoreAllowedForPurpose(s, purpose.first, gateCustomMenuTokens));
      // 안전판: 업종 사전이 실제 어휘를 못 맞혀 후보가 통째로 사라지면, '분류 불능'만 통과시켜
      // 재시도한다. 이때도 명시적 거절(제과·카페 등 목적 밖 업종)은 그대로 막히므로 빵집은
      // 되살아나지 않는다. 사전이 틀려도 L0 발굴 기능이 조용히 죽지 않게 하는 장치.
      let gateRelaxed = false;
      if (gatedStores.length === 0 && unmatchedStores.length > 0) {
        gatedStores = unmatchedStores.filter((s) => isStoreAllowedForPurpose(s, purpose.first, gateCustomMenuTokens, true));
        gateRelaxed = gatedStores.length > 0;
      }
      // 관측용: 어휘 사전이 실측 미검증이라, '분류 불능'으로 탈락한 실제 업종명을 소수만 남겨
      // 배포 후 로그를 보고 purposeGate 사전을 교정할 수 있게 한다(업종명이라 개인정보 아님).
      const gateUnknownSamples: string[] = [];
      for (const s of unmatchedStores) {
        if (gateUnknownSamples.length >= 5) break;
        if (gatedStores.includes(s)) continue;
        if (isGloballyExcludedStore(s) || classifyStoreGroup(s) !== null) continue; // 의도된 탈락은 제외
        const label = `${s.mclsName ?? '-'}/${s.category ?? '-'}`.slice(0, 40);
        if (!gateUnknownSamples.includes(label)) gateUnknownSamples.push(label);
      }
      const gemCandidates = (
        await Promise.all(
          gatedStores.slice(0, 30).map(async (store) => {
            const yearsAlive = await lookupYearsAlive(store);
            const localGem = computeLocalGem(yearsAlive, 0);
            return { store, localGem };
          })
        )
      )
        .filter((g) => g.localGem > 0)
        .sort((a, b) => b.localGem - a.localGem)
        .slice(0, 3);

      // 1차 목록에만 추가 — 2차 목록에도 같은 가게를 넣으면 1차·2차 양쪽에 동시 추천되거나
      // 버즈 분석이 같은 곳을 중복 호출할 수 있다.
      for (const { store } of gemCandidates) {
        // 편식 필터는 공공데이터 발굴 후보에도 동일 적용
        if (excludeTokens.some((t) => store.name.includes(t) || store.category.includes(t))) continue;
        naverFirstPlaces.push({
          name: store.name, category: store.category, address: store.address,
          lat: store.lat, lng: store.lng, _isPublicGem: true,
        });
      }
      console.log(
        `[recommend] L0 publicStores=${publicStores.length} purpose=${purpose.first}`
        + ` gateIn=${unmatchedStores.length} gateOut=${gatedStores.length}${gateRelaxed ? '(relaxed)' : ''} gemCandidates=${gemCandidates.length}`
        + (gateUnknownSamples.length ? ` gateUnknown=${gateUnknownSamples.join(' | ').slice(0, 200)}` : ''),
      );
    } catch (e) {
      console.error('[recommend] L0 gem candidate injection failed', e);
    }

    // 재추천 제외: 방금 추천한 장소를 후보 목록에서 빼서 Claude가 못 고르게 한다.
    // (부분 문자열 매칭 — "아키야마 성수본점"과 "아키야마" 같은 표기 차이 흡수)
    const excludeNames: string[] = Array.isArray(req.body.excludeNames)
      ? (req.body.excludeNames as unknown[]).filter((n): n is string => typeof n === 'string' && n.length > 0)
      : [];
    if (excludeNames.length > 0) {
      const isExcluded = (name: string) =>
        excludeNames.some((ex) => name.includes(ex) || ex.includes(name));
      // 후보가 너무 줄면 추천 자체가 불가 → 3곳 이상 남을 때만 제외 적용
      const filteredFirst = naverFirstPlaces.filter((p) => !isExcluded(p.name));
      if (filteredFirst.length >= 3) naverFirstPlaces.splice(0, naverFirstPlaces.length, ...filteredFirst);
      const filteredSecond = naverSecondPlaces.filter((p) => !isExcluded(p.name));
      if (filteredSecond.length >= 3) naverSecondPlaces.splice(0, naverSecondPlaces.length, ...filteredSecond);
      console.log(`[recommend] excludeNames=${excludeNames.length} → first ${naverFirstPlaces.length}, second ${naverSecondPlaces.length}`);
    }

    const hasNaverData = naverFirstPlaces.length > 0;
    console.log(`[recommend] naverFirst=${naverFirstPlaces.length} naverSecond=${naverSecondPlaces.length} hasNaverData=${hasNaverData}`);
    // 2차 네이버 데이터 없으면 단일 목적 모드로 폴백 (할루시네이션 방지)
    const effectiveTwoPurposes = hasTwoPurposes && naverSecondPlaces.length > 0;

    // L2: 이전 요청에서 이미 캐시된 버즈 신호가 있으면(재추천 등) 참고용으로 프롬프트에 노출.
    // 라이브 블로그 분석(L1)은 파이널리스트 확정 후에만 돌기 때문에 최초 요청은 히트가 없을 수 있다.
    try {
      const allCandidates = [...naverFirstPlaces, ...naverSecondPlaces];
      const bubbleCache = await getBubbleScoresCacheOnly(
        allCandidates.map((p) => ({ name: p.name, address: p.address })),
      );
      for (const p of allCandidates as (NaverPlace & { _buzzHint?: string })[]) {
        const hit = bubbleCache.get(`${p.name}|${p.address}`);
        if (hit) p._buzzHint = `버즈 ${hit.buzzCount}건, 협찬률 ${Math.round(hit.sponsoredRatio * 100)}%`;
      }
    } catch (e) {
      console.error('[recommend] L2 buzz cache hint injection failed', e);
    }

    // 네이버 데이터 있을 때 전용 규칙
    const naverSection = hasNaverData ? `
## 네이버 검색으로 확인된 실존 장소 목록 (총 ${naverFirstPlaces.length}개 중 최적 선택)
### 1차 목적 "${purposeFirstLabel}" 후보
${formatNaverPlaces(naverFirstPlaces)}
${effectiveTwoPurposes ? `
### 2차 목적 "${purposeSecondLabel}" 후보
${formatNaverPlaces(naverSecondPlaces)}` : ''}

⚠️ 반드시 위 목록의 번호(1~N)에서만 선택. 목록 외 장소 생성 절대 금지.
⚠️ sourceIndex는 선택한 목록 번호를 정확히 기재. 같은 목록 내 중복 사용 금지.
⚠️ placeName은 위 데이터 그대로 복사. 절대 임의 생성 금지.
⚠️ 상황(예산·인원·분위기·목적)에 가장 맞는 장소를 프랜차이즈 여부에 무관하게 선택.` : `
## 절대 규칙
1. 실제 존재하고 영업 중인 장소만 추천
2. 상황(예산·인원·분위기·목적)에 가장 맞는 곳 우선 — 프랜차이즈 여부보다 조건 부합이 중요
3. address 불확실하면 동네명만, lat/lng 모르면 0 기재`;

    // 날씨 컨텍스트
    const weatherSection = weather ? `
## 현재 날씨 (${primaryArea})
- 날씨: ${weather.description}, 기온: ${weather.temp}°C
- ${weather.isRainy ? '비 또는 눈이 오고 있음 → 실내 장소 우선 추천' : ''}${weather.isHot ? '더운 날씨 → 에어컨 완비된 실내 선호' : ''}${weather.isCold ? '추운 날씨 → 따뜻한 실내 분위기 선호' : ''}` : '';

    const relationLine = relation ? `\n- 모임 관계: ${relation}` : '';
    const occasionLine = occasion ? `\n- 특별한 행사: ${occasion} → ${OCCASION_HINT[occasion] ?? '분위기에 맞는 곳'}` : '';
    const budgetLine = budget ? `\n- 예산: 1인 ${budget}` : '';
    const keywordsLine = keywords.length > 0
      ? `\n- 1차 필수 키워드: ${keywords.map((k) => `#${k}`).join(' ')} ← 1차 장소는 이 조건에 부합하는 곳 최우선`
      : '';
    const keywordsSecondLine = keywordsSecond.length > 0
      ? `\n- 2차 필수 키워드: ${keywordsSecond.map((k) => `#${k}`).join(' ')} ← 2차 장소는 이 조건에 부합하는 곳 최우선`
      : '';
    const excludeFoodsLine = excludeFoods.length > 0
      ? `\n- 🚫 못 먹는 음식(절대 제외): ${excludeFoods.join(', ')} ← 이 음식/재료가 주력 메뉴이거나 피하기 어려운 장소는 fitScore와 무관하게 절대 선택 금지 (편식·알레르기 하드 제약)`
      : '';
    const hasAmpCombo = /&/.test(purpose.first) || /&/.test(purpose.second ?? '');
    // 쉼표(,)로 나뉜 메뉴(예: "보쌈,파스타")는 서로 다른 메뉴 → 장소를 골고루 분산해야 하는데,
    // 기존엔 이 지시가 & 조합일 때만 떠서 한 메뉴로 쏠렸다. 쉼표 입력에도 분산 지시를 노출.
    const hasCommaMenu = /,/.test(purpose.first) || /,/.test(purpose.second ?? '');
    const menuComboLine = (hasAmpCombo || hasCommaMenu)
      ? `\n- 🍽️ 메뉴 규칙: "A&B"(앰퍼샌드)는 A·B를 한 곳에서 함께 파는 단일 장소를 우선 선택(각각 다른 집으로 분리 금지). "A,B"(쉼표)는 서로 다른 메뉴이므로 각 메뉴를 취급하는 장소를 골고루 분산 추천(예: 보쌈집 + 파스타집 각각). 절대 한 메뉴로만 몰지 말 것.`
      : '';
    const genreLine = firstGenre || secondGenre
      ? `\n- 장르 지정: ${[
          firstGenre ? `1차(${purpose.first})는 ${firstGenre}` : null,
          secondGenre ? `2차(${purpose.second})는 ${secondGenre}` : null,
        ].filter(Boolean).join(', ')} ← 지정 장르에 해당하는 장소만 선택`
      : '';

    const WEIGHT_DESC: Record<number, string> = { 1: '거의 무시', 2: '낮음', 3: '보통', 4: '중요', 5: '최우선 반영' };
    const vibeWeights: Record<string, number> = input.vibeWeights ?? {};
    const weightsSection = Object.keys(vibeWeights).length > 0
      ? `\n## 재추천 가중치 (사용자 지정)\n${Object.entries(vibeWeights).map(([label, w]) => `- ${label}: ${w}/5 (${WEIGHT_DESC[w] ?? '보통'})`).join('\n')}\n위 가중치를 반드시 고려하여 높은 가중치 항목을 최우선으로 반영하세요.`
      : '';

    const commonInfo = `
## 모임 정보
- 출발지: ${locationStr || `미입력 (${areaNames} 일대에서 모임)`}
- 추천 지역: ${areaNames}
- 인원: ${groupSize}명${groupSize >= 5 ? ' (단체석 또는 넓은 공간 필수)' : ''}${relationLine}${occasionLine}${budgetLine}${keywordsLine}${keywordsSecondLine}${excludeFoodsLine}${genreLine}${menuComboLine}
- 분위기: ${vibeFirstStr}${vibeSecondStr ? ` / 2차: ${vibeSecondStr}` : ''}
- 현재 시각: ${currentTime}
- 혼잡도: ${congestionSummary || '정보 없음'}
${weatherSection}${weightsSection}

## 추천 조건
- "${vibeFirstStr}" 분위기에 맞는 곳
- ${isQuiet ? '조용하고 여유로운 분위기' : '활기찬 분위기'}
- ${groupSize}명 수용 가능 규모${groupSize >= 5 ? ' (단체석 우선)' : ''}
- ${currentTime} 기준 영업 중 또는 곧 영업 시작 우선${excludeFoods.length > 0 ? `\n- ⚠️ ${excludeFoods.join(', ')} 위주 메뉴 장소 절대 금지 — 일행 중 못 먹는 사람이 있음` : ''}${occasion ? `\n- ${OCCASION_HINT[occasion] ?? ''}` : ''}${budget ? `\n- 1인 예산 ${budget} 내외` : ''}${relation === '연인' ? '\n- 커플 분위기, 프라이빗하고 조용한 공간 선호' : ''}${relation === '직장동료' ? '\n- 회식에 적합한 단체 공간, 넓은 테이블 선호' : ''}${relation === '가족' ? '\n- 가족 모임에 편한 공간, 소음 덜한 환경 선호' : ''}`;

    // 노포 가산은 사용자가 명시적으로 원했을 때만 강하게. 기본값은 업력 중립 —
    // 2030 여성 이탈 방지(노포·포차 편중 완화), 취향 선택권은 유지.
    const NOPO_SIGNAL = /노포|포차|레트로|옛날|오래된/;
    const wantsNopo =
      [...keywords, ...keywordsSecond].some((k) => NOPO_SIGNAL.test(k))
      || [...(vibe?.first ?? []), ...(vibe?.second ?? [])].includes('레트로')
      || Object.keys(vibeWeights).some((k) => NOPO_SIGNAL.test(k));
    // 기본(중립): 업력 자체엔 가산 금지 + 공간 완성도로 균형. 노포/레트로 명시 선택 시에만 노포 가산.
    const nopoTrustLine = wantsNopo
      ? `  · 오래된 가게(노포)·전문성 있는 단일 메뉴 위주 (+5~8점) ← 사용자가 노포/레트로 취향을 직접 선택함, 적극 반영
    ※ 단, 이 노포 가산은 1차 목적("${purposeFirstLabel}") 업종에 부합하는 곳에만 적용한다. 주력 업종이 목적과 명백히 다른 곳(예: '밥' 목적에 빵집·디저트카페, '카페' 목적에 곱창집)은 업력이 아무리 길어도 가산하지 말고 선택 자체를 피하라. '명백히 다른' 경우만 해당하며, 브런치카페·베이커리카페·치킨호프처럼 목적에 걸치는 곳은 정상 후보로 평가한다.
  · 공간 완성도 — 일행 누구나 편하게 머물 수 있는 공간인가 (+2~3점)`
      : `  · 전문성 신호 — 시그니처 메뉴·좁고 깊은 메뉴 구성의 완성도. 노포든 신생·모던 가게든 동등하게 평가하고, 업력이 오래됐다는 사실 자체에는 가산점을 주지 말 것 (+3~5점)
  · 공간 완성도 — 인테리어·조명·좌석·청결 등 일행 누구나 편하게 머물고 대화할 수 있는 공간인가 (감성 카페·와인바·브런치 같은 유형도 이 신호로 동등 평가) (+3~5점)`;

    const fitScoreGuide = `
## 적합도 점수 (fitScore) 산정 기준 — 각 장소마다 0~100 정수 기재
- 취향/분위기 일치도 (35점): 사용자 선택 vibe와 얼마나 잘 맞는가
- 목적 적합도 (20점): "${purposeFirstLabel}" 목적에 얼마나 적합한가${vibeWeights && Object.keys(vibeWeights).length > 0 ? '\n- 가중치 반영 (추가 +10점 풀): 위 재추천 가중치가 높은 항목일수록 더 높게' : ''}
- 예산 적합도 (15점): 예산 조건 충족 여부 (예산 없으면 만점)
- 혼잡도/시간 적합도 (10점): 현재 시각 기준 혼잡도와 영업 여부
- 진짜 맛집 신뢰도 (20점): 다음 신호로 판단 —
${nopoTrustLine}
  · 리뷰가 음식 맛·재방문 위주이며 마케팅성 "인생샷/감성/협찬" 냄새가 없음 (+5~7점)
  · 과도한 SNS 노출·체험단 냄새 없이 입소문으로 알려진 로컬 맛집 (+3~5점)
  · 상황(예산·인원·목적)에 진짜로 맞는 선택인가 (프랜차이즈라도 최선이면 만점 가능) (+0~5점)
  · 목록에 "(참고: 버즈 N건, 협찬률 N%)"가 표기된 곳은 실측 데이터다. 이렇게 해석하라 —
    · 버즈(블로그 언급) 건수가 많으면서 협찬률이 낮은 곳 = 협찬 아닌 진짜 입소문 맛집 → 최우선 (+5~8점)
    · 버즈는 많은데 협찬률이 높은 곳 = 마케팅으로 뜬 거품 의심 → 보수적으로 감점
    · 버즈가 적은 곳 = 신규이거나 알려지지 않은 곳(나쁜 신호 아님) → 다른 신호로 판단
    · 표기가 아예 없는 곳은 판단 재료 부족으로만 취급하고 불리하게 감점하지 말 것(정보 없음 ≠ 거품 있음)
rank 1이 반드시 가장 높아야 하며, 장소마다 솔직하고 차별화된 점수를 부여하세요.`;

    // slotRank: 해당 purposeSlot 목록 내에서 Claude가 매긴 선호 순서(1이 최선).
    // purposeSlot: 1=1차 목적, 2=2차 목적. 최종 표시 3~6곳으로 줄이기 전, 버즈 분석(L1)·
    // 괴리 보정(L3) 재채점을 위해 넉넉한 파이널리스트를 먼저 받는다.
    // 네이버 후보 목록이 없을 때 sourceIndex를 요구하면 모델이 "목록이 없어 선택 불가"로
    // 거부해 JSON 파싱이 실패한다(간헐 500의 원인). 목록 있을 때만 스키마에 포함.
    // AI 출력 다이어트: 주소·좌표·카테고리·지역은 어차피 서버가 네이버 실데이터로 덮어쓰고,
    // 혼잡도는 서버가 실측값으로 대체/제거한다 — 목록이 있으면 스키마에서 제외해
    // 출력 토큰을 ~35% 줄인다(응답 속도 단축, 최종 데이터는 동일).
    const finalistSchema = (slotRank: number, purposeSlot: number) => hasNaverData ? `{
  "slotRank": ${slotRank},
  "purposeSlot": ${purposeSlot},
  "sourceIndex": <목록번호>,
  "placeName": "장소명 (목록에서 그대로)",
  "description": "한 줄 설명 20자 내외",
  "priceRange": "1인 예상 가격대",
  "vibeTags": ["태그1", "태그2", "태그3"],
  "fitScore": <0~100>
}` : `{
  "slotRank": ${slotRank},
  "purposeSlot": ${purposeSlot},
  "placeName": "장소명",
  "category": "카테고리",
  "description": "한 줄 설명 20자 내외",
  "priceRange": "1인 예상 가격대",
  "vibeTags": ["태그1", "태그2", "태그3"],
  "address": "주소 (모르면 동네명만)",
  "area": "지역명",
  "fitScore": <0~100>,
  "lat": 0,
  "lng": 0
}`;

    // 시 전체 추천: 파이널리스트를 넉넉히 받아 한 구 물량을 넘기게 한다 → 여러 구가 강제로 섞임.
    // (spreadByGu가 최종 순위를 구별 라운드로빈으로 재배열하므로, 파이널리스트가 여러 구를 담기만 하면 됨)
    const cityWideSel = regionScope?.level === 'city';
    const finalistPer = cityWideSel ? 9 : FINALIST_COUNT_PER_PURPOSE;
    const finalistSingle = cityWideSel ? 12 : FINALIST_COUNT_SINGLE;
    const guSpreadLine = cityWideSel
      ? `\n- ⭐ 시 전체 추천이므로 선택하는 곳들을 여러 행정구(구/군)에 최대한 고르게 분산하세요. 후보 주소의 구 이름을 보고 한 구에 몰지 말고 최소 3개 이상 서로 다른 구가 포함되게 선택.`
      : '';

    const prompt = effectiveTwoPurposes
      ? `당신은 한국 모임 장소 큐레이터입니다. 1차·2차 코스 장소 후보를 각각 선호 순서대로 ${finalistPer}곳씩 추천해주세요.
${naverSection}
${commonInfo}
${fitScoreGuide}

## 응답 구성 (${hasNaverData ? `1차 목록에서 ${finalistPer}곳 + 2차 목록에서 ${finalistPer}곳, ` : ''}총 ${finalistPer * 2}곳)
- purposeSlot 1(1차 "${purposeFirstLabel}") ${finalistPer}곳: slotRank 1이 가장 적합, 내림차순. 같은 슬롯 내 ${hasNaverData ? 'sourceIndex' : '장소'} 중복 금지
- purposeSlot 2(2차 "${purposeSecondLabel}") ${finalistPer}곳: slotRank 1이 가장 적합, 내림차순. 같은 슬롯 내 ${hasNaverData ? 'sourceIndex' : '장소'} 중복 금지
- 각 슬롯의 slotRank 1은 서로 도보 15분 이내로 이어질 수 있는 조합을 우선 고려${guSpreadLine}

## 응답 형식 (JSON만, 다른 텍스트 없이)
{"places": [
  ${Array.from({ length: finalistPer }, (_, i) => finalistSchema(i + 1, 1)).join(',\n  ')},
  ${Array.from({ length: finalistPer }, (_, i) => finalistSchema(i + 1, 2)).join(',\n  ')}
]}`
      : `당신은 한국 모임 장소 큐레이터입니다. "${purposeFirstLabel}" 장소 후보를 선호 순서대로 ${finalistSingle}곳 추천해주세요.
${naverSection}
${commonInfo}
${fitScoreGuide}

## 응답 구성 (${hasNaverData ? '1차 목록에서 ' : ''}서로 다른 ${finalistSingle}곳, purposeSlot은 항상 1)
- slotRank 1이 가장 적합, 내림차순. ${hasNaverData ? 'sourceIndex' : '장소'} 중복 금지${guSpreadLine}

## 응답 형식 (JSON만, 다른 텍스트 없이)
{"places": [
  ${Array.from({ length: finalistSingle }, (_, i) => finalistSchema(i + 1, 1)).join(',\n  ')}
]}`;

    // 파이널리스트 12곳 JSON이 잘리지 않도록 넉넉하게. non-streaming이라 timeout 여유 안에서 8192.
    const MAX_TOKENS = 8192;
    // 모델 A/B 실험용 오버라이드 — 관리자 키 일치 시에만 (일반 사용자 요청에는 영향 없음)
    // 사람용 어드민 비밀번호(Supabase admin_credentials)와 별개인 기계용 키다 — curl로 수동
    // A/B할 때만 쓴다. ADMIN_BENCH_KEY 우선, 없으면 종전대로 ADMIN_PASSWORD.
    const benchKey = (process.env.ADMIN_BENCH_KEY ?? process.env.ADMIN_PASSWORD ?? '').trim();
    const headerKey = req.headers['x-admin-key'];
    const benchModel = typeof req.body._benchModel === 'string'
      && !!benchKey
      && typeof headerKey === 'string'
      && safeEqualStr(headerKey, benchKey)
      ? req.body._benchModel : null;
    // 기본 모델·폴백 규칙은 _lib/claude.ts에 있다. 여기서는 A/B 오버라이드만 얹는다.
    const model = benchModel ?? CLAUDE_MODELS.fast;

    // 레이트리밋 확인 — 과금되는 Claude 호출 직전에. (데이터 fetch와 병렬로 이미 돌고 있었음)
    const gate = await gatePromise;
    if (!gate.allowed) {
      return res.status(429).json({
        error: gate.reason === 'daily'
          ? '오늘 추천 요청이 몰려서 잠시 쉬어가고 있어요. 내일 다시 만나요!'
          : '요청이 너무 잦아요. 잠시 후 다시 시도해주세요.',
      });
    }

    // 호출·529 폴백·텍스트 추출은 공용 모듈. 프롬프트와 응답 해석(extractPlaces)만 여기 남는다.
    const ai = await askClaude(prompt, { model, maxTokens: MAX_TOKENS });
    const aiMs = ai.ms;

    if (ai.truncated) {
      console.warn('[recommend] 응답이 max_tokens에서 잘림 — 부분 복구 시도');
    }

    const text = ai.text;

    const finalists = extractPlaces(text);
    if (!finalists || finalists.length === 0) {
      console.error('[recommend] places 추출 실패. 응답 앞부분:', text.slice(0, 300));
      return res.status(500).json({ error: '추천 결과를 정리하지 못했어요. 다시 시도해주세요.' });
    }

    // 네이버 실존 데이터로 강제 덮어쓰기 (할루시네이션 방지) — purposeSlot 기준으로 목록 선택
    if (hasNaverData) {
      const usedFirst = new Set<number>();
      const usedSecond = new Set<number>();

      for (const place of finalists) {
        const isSecond = place.purposeSlot === 2;
        const naverList: NaverPlace[] = isSecond ? naverSecondPlaces : naverFirstPlaces;
        const used = isSecond ? usedSecond : usedFirst;
        if (!naverList.length) continue;

        // AI가 선택한 sourceIndex (1-based → 0-based)
        let idx = typeof place.sourceIndex === 'number' ? place.sourceIndex - 1 : -1;

        // sourceIndex가 잘못됐거나 중복이면 이름 매칭으로 대체
        if (idx < 0 || idx >= naverList.length || used.has(idx)) {
          const pName = typeof place.placeName === 'string' ? place.placeName : '';
          const nameIdx = naverList.findIndex(
            (p) => p.name.includes(pName) || pName.includes(p.name)
          );
          idx = nameIdx >= 0 && !used.has(nameIdx)
            ? nameIdx
            : naverList.findIndex((_, i) => !used.has(i));
        }

        // 미사용 슬롯 없음(네이버 결과 부족) → 첫 번째 실존 데이터 재사용 (할루시네이션보다 낫음)
        if (idx < 0) idx = 0;

        used.add(idx);
        const naver = naverList[idx];
        place.placeName = naver.name;
        place.address = naver.address;
        place.lat = naver.lat;
        place.lng = naver.lng;
        if (naver.category) place.category = naver.category;
        // 슬림 스키마에는 area가 없으므로 서버가 채움 (UI의 address 폴백 표기용)
        if (place.area == null) place.area = primaryArea;

        // openingHours는 Naver에 없어서 항상 할루시네이션 → 제거
        delete place.openingHours;
        delete place.sourceIndex;
      }
    }

    // L1: 파이널리스트 버즈 점수를 캐시에서 '한 번에' 조회(대량). 라이브 블로그 fetch를 응답 경로에서
    // 제거해 지연을 없앤다. 캐시 미스는 0점(=감점 없음, 기존 실패 폴백과 동일) — 야간 크론이 캐시를 채운다.
    try {
      const cache = await getBubbleScoresCacheOnly(
        finalists.map((p) => ({ name: p.placeName, address: p.address })),
      );
      for (const place of finalists) {
        const hit = cache.get(`${place.placeName}|${place.address}`);
        place.bubbleScore = hit?.bubbleScore ?? 0;
        place.buzzCount = hit?.buzzCount ?? 0;
      }
    } catch (e) {
      console.error('[recommend] L1 buzz cache lookup failed', e);
    }

    // L3: naverRank(네이버 거리순 검색 결과에서의 위치 — 원 노출순위 프록시)와
    // isPublicGem(L0에서 localGem 상위로 이미 선별된 공공데이터 발굴 후보) 태깅 후 finalScore 계산.
    // 프랜차이즈 후순위 로직은 부활시키지 않는다 — naverRank는 정렬용이 아니라 괴리 감지용 신호일 뿐.
    try {
      for (const f of finalists) {
        const list = f.purposeSlot === 2 ? naverSecondPlaces : naverFirstPlaces;
        const idx = list.findIndex((p) => p.name === f.placeName && p.address === f.address);
        f.naverRank = idx >= 0 ? idx : null;
        f.isPublicGem = idx >= 0 ? Boolean(list[idx]._isPublicGem) : false;
      }

      // 사용자 지정 키워드가 장소의 태그/설명에 실제로 매칭된 개수 — 객관 순위 신호
      const countKeywordHits = (f: { placeName?: string; vibeTags?: string[]; description?: string; category?: string }, slot: number): number => {
        const slotKeywords = slot === 2 && keywordsSecond.length > 0 ? keywordsSecond : keywords;
        if (slotKeywords.length === 0) return 0;
        const haystack = [
          f.placeName ?? '',
          ...(Array.isArray(f.vibeTags) ? f.vibeTags : []),
          f.description ?? '',
          f.category ?? '',
        ].join(' ').replace(/\s/g, '');
        return slotKeywords.filter((k) => haystack.includes(k.replace(/\s/g, ''))).length;
      };

      const scoreSlot = (slot: number) => {
        const input: {
          placeName: string; address: string; fitScore: number; bubbleScore: number;
          naverRank: number | null; isPublicGem: boolean; keywordHits: number;
        }[] = finalists
          .filter((f) => f.purposeSlot === slot)
          .map((f) => ({
            placeName: typeof f.placeName === 'string' ? f.placeName : '',
            address: typeof f.address === 'string' ? f.address : '',
            fitScore: typeof f.fitScore === 'number' ? f.fitScore : 0,
            bubbleScore: typeof f.bubbleScore === 'number' ? f.bubbleScore : 0,
            naverRank: typeof f.naverRank === 'number' ? f.naverRank : null,
            isPublicGem: f.isPublicGem === true,
            keywordHits: countKeywordHits(f, slot),
          }));
        return computeFinalScores(input);
      };

      const finalScoreByKey = new Map<string, number>();
      for (const s of [...scoreSlot(1), ...scoreSlot(2)]) {
        finalScoreByKey.set(`${s.placeName}|${s.address}`, s.finalScore);
      }
      for (const f of finalists) {
        f.finalScore = finalScoreByKey.get(`${f.placeName}|${f.address}`) ?? f.fitScore;
      }
    } catch (e) {
      console.error('[recommend] L3 scoring failed', e);
    }

    // 최종 표시 개수로 슬라이스 — finalScore(L3 재정렬) 내림차순
    const numScore = (p: FinalistPlace) =>
      typeof p.finalScore === 'number' ? p.finalScore
      : typeof p.fitScore === 'number' ? p.fitScore : 0;
    // 시 전체 추천이면 점수순을 유지하되 구/군이 한쪽에 쏠리지 않게 골고루 섞는다.
    const cityWide = regionScope?.level === 'city';
    const bySlot = (slot: number) => {
      const sorted = finalists.filter((p) => p.purposeSlot === slot).sort((a, b) => numScore(b) - numScore(a));
      return cityWide ? spreadByGu(sorted) : sorted;
    };

    let places: FinalistPlace[];
    if (effectiveTwoPurposes) {
      const firstSorted = bySlot(1);   // cityWide면 이미 spreadByGu 순서
      const secondSorted = bySlot(2);

      // 시 전체: 대표 1차·2차는 걸어서 이어지는 쌍으로 교체(코스 정합성). 나머지 3~6위는
      // spreadByGu 순서 그대로 → 구 분산(다양성)은 대안 슬롯이 담당. 비-city는 기존과 동일.
      let f0 = firstSorted[0];
      let s0 = secondSorted[0];
      if (cityWide) {
        const pair = pickClosePrimaryPair(firstSorted, secondSorted, numScore);
        if (pair) { f0 = pair.f; s0 = pair.s; }
      }
      const restFirst = firstSorted.filter((p) => p !== f0);
      const restSecond = secondSorted.filter((p) => p !== s0);

      places = ([
        f0            && { ...f0,            rank: 1 },
        s0            && { ...s0,            rank: 2 },
        restFirst[0]  && { ...restFirst[0],  rank: 3 },
        restFirst[1]  && { ...restFirst[1],  rank: 4 },
        restSecond[0] && { ...restSecond[0], rank: 5 },
        restSecond[1] && { ...restSecond[1], rank: 6 },
      ].filter(Boolean) as FinalistPlace[]);
    } else {
      places = bySlot(1)
        .slice(0, 3)
        .map((p, i) => ({ ...p, rank: i + 1 }));
    }

    const debugBubbleScores = finalists.map((p) => ({
      placeName: p.placeName,
      bubbleScore: p.bubbleScore,
      buzzCount: p.buzzCount,
    }));

    // 클라이언트 응답에서 내부 전용 필드 제거
    for (const p of places) {
      delete p.slotRank;
      delete p.purposeSlot;
    }

    // 카카오 장소 URL + 대표 사진은 응답을 막지 않도록 분리 — 클라이언트가 결과를 그린 뒤
    // stage:'enrich' 호출로 채워 넣는다(초기 로딩 단축). area는 클라이언트 병합에 쓰이므로 유지.

    // 혼잡도 정직화: 서울 실시간 데이터가 실제로 있을 때만 노출, 없으면 필드 제거
    // (기존에는 Claude가 지어낸 혼잡도가 그대로 나갔다 — 실측 아닌 값은 보여주지 않는다)
    const realCongestion = congestionResolved
      .find((c) => c.level && c.level !== '알 수 없음')?.level ?? null;
    for (const p of places) {
      if (realCongestion) p.congestionLevel = realCongestion;
      else delete p.congestionLevel;
    }

    // 1차·2차 도보 시간 haversine으로 보정 (rank 1 → rank 2)
    if (effectiveTwoPurposes) {
      const rank1 = places.find((p) => p.rank === 1);
      const rank2 = places.find((p) => p.rank === 2);
      if (rank1 && rank2 && rank1.lat && rank1.lng && rank2.lat && rank2.lng &&
          rank1.lat !== 0 && rank2.lat !== 0) {
        rank1.walkingToNext = walkingMinutes(rank1.lat, rank1.lng, rank2.lat, rank2.lng);
      }
    }

    // ── 3차(이어서 갈 곳) 자동 첨부 ──
    // 입력 단계는 1·2차만. 마지막 코스(2차, 없으면 1차) 근처에서 다음 성격(카페/술/야식)의 실존 장소 1곳을 붙인다.
    // 카카오 로컬(네이버와 별도 쿼터)로 소싱 → 네이버 QPS·초기 로딩에 영향 0. 모든 실패는 thirdStop=null로 수렴(1·2차 결과는 무조건 온전).
    let thirdStop: FinalistPlace | null = null;
    let thirdLabel: string | null = null;
    try {
      const kakaoRestKey3 = process.env.VITE_KAKAO_REST_API_KEY;
      const anchor = places.find((p) => p.rank === 2) ?? places.find((p) => p.rank === 1);
      const lastCourse = effectiveTwoPurposes ? (purpose.second ?? purpose.first) : purpose.first;
      const spec = thirdCourseSpec(lastCourse, now.getHours());
      if (kakaoRestKey3 && spec && anchor
          && typeof anchor.lat === 'number' && typeof anchor.lng === 'number'
          && anchor.lat !== 0 && anchor.lng !== 0) {
        const aLat = anchor.lat, aLng = anchor.lng;
        const raw = await fetchKakaoByCategory(aLat, aLng, 1500, spec.category, kakaoRestKey3, 2);
        // 이미 쓴 1·2차 장소(공백무시 부분매칭)와 편식 필터를 3차 후보에도 적용
        const usedNames = places.map((p) => stripSpace(p.placeName || '')).filter(Boolean);
        const pick = filterExcludedFoods(raw, excludeTokens)
          .filter((p) => (spec.tokens ? spec.tokens.some((t) => p.category.includes(t) || p.name.includes(t)) : true))
          .filter((p) => {
            const nm = stripSpace(p.name);
            return nm && !usedNames.some((u) => u.includes(nm) || nm.includes(u));
          })
          .map((p) => ({ p, d: distKm(aLat, aLng, p.lat, p.lng) }))
          .filter((x) => x.d <= 2.0)
          .sort((a, b) => a.d - b.d)[0]?.p;
        if (pick) {
          thirdStop = {
            placeName: pick.name,
            // 카카오 category_name "음식점 > 카페 > 디저트" → 마지막 세그먼트만("디저트")
            category: pick.category.split('>').pop()?.trim() || pick.category,
            description: `${anchor.placeName} 근처, 걸어서 이어가기 좋은 ${spec.label}`,
            priceRange: '',
            vibeTags: [spec.label],
            address: pick.address,
            area: primaryArea,
            lat: pick.lat,
            lng: pick.lng,
            ...(realCongestion ? { congestionLevel: realCongestion } : {}),
          };
          thirdLabel = spec.label;
          // 앵커(2차·없으면 1차) → 3차 도보 시간을 앵커의 walkingToNext에 기록 (단일 모드에서 이 필드는 UI 미사용이라 충돌 없음)
          anchor.walkingToNext = walkingMinutes(aLat, aLng, pick.lat, pick.lng);
        }
      }
    } catch (e) {
      console.error('[recommend] thirdStop attach failed', e);
    }

    // 파일럿 일련번호 — 유저에겐 안 보이는 내부 조인키(혼동문자 0/O·1/I·L 제외 6자).
    // 추천 응답에 실어 클라이언트가 localStorage에 보관 → 파일럿에서 이 추천을 되살린다.
    const makeSerial = (): string => {
      const cs = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      let s = '';
      for (let i = 0; i < 6; i++) s += cs[Math.floor(Math.random() * cs.length)];
      return s;
    };
    let serial = makeSerial();

    // L4: 후보별 신호·노출·선택 기록 (분석은 v2 스코프 — 지금은 기록만, 실패해도 응답엔 무영향)
    try {
      const supabase = getSupabaseAdmin();
      if (supabase) {
        const displayedByKey = new Map(
          places.map((p) => [`${p.placeName}|${p.address}`, p.rank as number]),
        );
        const candidates = finalists.map((f) => {
          const key = `${f.placeName}|${f.address}`;
          return {
            place_key: placeKey(f.placeName, f.address),
            purposeSlot: f.purposeSlot ?? null,
            slotRank: f.slotRank ?? null,
            fitScore: f.fitScore ?? null,
            bubbleScore: f.bubbleScore ?? null,
            buzzCount: f.buzzCount ?? null,
            naverRank: f.naverRank ?? null,
            isPublicGem: f.isPublicGem ?? false,
            finalScore: f.finalScore ?? null,
            finalRank: displayedByKey.get(key) ?? null,
            displayed: displayedByKey.has(key),
          };
        });

        // 같은 세션키의 이전 추천 행을 retried=true로 표시(재시도/거절/조정이 있었다는 신호).
        // 이번 insert가 그 세션의 최신 노출이 된다.
        if (sessionKey) {
          await supabase.from('recommendation_log').update({ retried: true }).eq('session_key', sessionKey);
        }

        // 사람이 읽는 추천장소 스냅샷 — candidates엔 해시키만 있어 파일럿/어드민에서 못 읽으므로 별도 저장
        const placesDisplay: { rank: number | null; placeName: string; category: string | null; address: string | null }[] =
          places.slice(0, 8).map((p) => ({
            rank: (p.rank as number) ?? null,
            placeName: p.placeName,
            category: p.category ?? null,
            address: p.address ?? null,
          }));
        if (thirdStop) placesDisplay.push({ rank: 99, placeName: thirdStop.placeName, category: thirdStop.category ?? null, address: thirdStop.address ?? null });

        const baseRow = {
          session_key: sessionKey,
          group_size: groupSize,
          purpose_first: purpose.first,
          purpose_second: purpose.second,
          budget,
          vibe_first: vibeFirstStr,
          vibe_second: vibeSecondStr || null,
          midpoint_lat: midLat,
          midpoint_lng: midLng,
          candidates,
        };
        // serial/places_display 포함 insert → 컬럼 미배포(42703) 시 레거시 insert 폴백, serial 충돌(23505) 시 1회 재발급
        let ins = await supabase.from('recommendation_log').insert({ ...baseRow, serial, places_display: placesDisplay });
        if (ins.error?.code === '23505') {
          serial = makeSerial();
          ins = await supabase.from('recommendation_log').insert({ ...baseRow, serial, places_display: placesDisplay });
        }
        if (ins.error?.code === '42703') {
          await supabase.from('recommendation_log').insert(baseRow);
        }
      }
    } catch (e) {
      console.error('[recommend] L4 recommendation_log insert failed', e);
    }

    return res.status(200).json({
      places,
      // 파일럿 일련번호 — 클라이언트가 localStorage에 보관(유저 비노출, 내부 조인키)
      serial,
      // 3차(이어서 갈 곳) — 없으면 null. 클라이언트는 있을 때만 렌더한다.
      thirdStop,
      thirdLabel,
      // 유저 배너용 날씨 요약 — 프롬프트에는 이미 반영됨(우천 시 실내 우선), 이제 그 사실을 유저에게도 보여준다
      weather: weather
        ? { description: weather.description, temp: weather.temp, isRainy: weather.isRainy, isHot: weather.isHot, isCold: weather.isCold }
        : null,
      // 내부 스코어링은 디버그 플래그 켰을 때만 노출
      ...(process.env.EXPOSE_DEBUG === '1'
        ? { _debug: { naverPlacesCount: naverFirstPlaces.length, bubbleScores: debugBubbleScores } }
        : {}),
      // 모델 실험 시에만 측정 메타 노출
      ...(benchModel ? { _bench: { model, aiMs, outputTokens: ai.outputTokens } } : {}),
      // 스코프 진단 — 요청에 _diag가 있을 때만: 후보 풀의 구 분포(시 전체 구 스프레드 확인용)
      ...(req.body._diag ? { _diag: (() => {
        const g: Record<string, number> = {};
        for (const p of naverFirstPlaces) { const gu = guOfAddress(p.address) || '기타'; g[gu] = (g[gu] ?? 0) + 1; }
        return { poolSize: naverFirstPlaces.length, poolGus: g };
      })() } : {}),
    });
  } catch (e) {
    console.error('[recommend] failed', e);
    return res.status(500).json({ error: '추천을 만드는 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.' });
  }
}
