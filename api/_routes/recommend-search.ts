import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clientIp, checkRateLimit, validateRecommendBody } from '../_lib/guard.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { safeEqualStr } from '../_lib/adminAuth.js';
import { askLlm, type LlmProvider } from '../_lib/llm.js';
import { seededRandom, weightedPick, addressInScope } from '../_lib/pick.js';
import { loadPlaceCategories, matchCategory } from '../_lib/placeCategory.js';
import {
  extractPlaces, spreadByGu, pickClosePrimaryPair, walkingMinutes, distKm, OCCASION_HINT, detectQuiet,
  excludeFoodTokens, GENRE_KEYWORDS, PURPOSE_KEYWORDS,
  type FinalistPlace, type RegionScope,
} from './recommend.js';

// 검색 우선 추천 — 후보는 카카오 로컬 검색(실존·위치·카테고리가 보장됨)에서 받고, LLM은 그 목록 안에서
// "이 모임에 맞는 순서"만 매긴다. 모델 기억에서 후보를 뽑던 recommend-prompt.ts와 반대 순서.
//
// 약관 경계(카카오 로컬): 검색 결과는 런타임에만 쓰고 버린다. 저장은 place id·URL과 우리 판정(점수·순위)만.
// 그래서 recommendation_log에는 가게 이름·주소·카테고리를 넣지 않는다.
//
// 흐름: 카카오 검색(카테고리+키워드) → 목적·편식·테이크아웃·스코프 필터 → LLM 순위(known/unknown 구분)
//      → 점수 = LLM 적합도(아는 곳) 또는 보수적 기본값(모르는 곳) − 거리 → 상위 풀에서 세션 시드 샘플링

const GATE_RADIUS_M: Record<RegionScope['level'] | 'none', number> = {
  city: 20000, district: 6000, dong: 2500, none: 3000,
};
const CANDIDATE_CAP = 60;          // LLM에 넘기는 후보 상한(토큰·응답시간)
const MIN_CANDIDATES = 4;          // 이 미만이면 스코프·반경을 완화
const PICK_COUNT_SINGLE = 10;      // LLM이 고르는 수
const PICK_COUNT_PER_SLOT = 8;
const PICK_POOL = 5;               // 최종 샘플링 풀
const PICK_TEMPERATURE = 8;
const UNKNOWN_SCORE_CAP = 65;      // 모델이 모르는 가게의 점수 상한 — "모르는데 아는 척"이 순위를 흔들지 않게
const DISTANCE_PENALTY_PER_KM = 4; // 중심에서 1km 멀어질 때마다 감점

// 모임 장소가 못 되는 곳. 카테고리(브랜드 4단계 포함)와 이름으로 거른다.
const TAKEOUT_RE = /테이크아웃|포장전문|배달전문|푸드코트|무인|키오스크|메가커피|메가mgc|컴포즈|빽다방|더벤티|매머드|구내식당|도시락/i;

// ── 카카오 카테고리 판정 (category_name을 " > "로 나눈 경로 기준. 실측 목록: place_category 테이블) ──
const NOT_MEAL = new Set(['카페', '술집', '간식', '푸드코트', '구내식당', '도시락']);
const GENRE_MATCH: Record<string, (p: string[]) => boolean> = {
  '한식':      (p) => p[1] === '한식',
  '중식':      (p) => p[1] === '중식',
  '일식':      (p) => p[1] === '일식',
  '양식':      (p) => ['양식', '패밀리레스토랑', '퓨전요리'].includes(p[1]),
  '아시안':    (p) => p[1] === '아시아음식',
  '소주·맥주': (p) => p[1] === '술집' && ['실내포장마차', '호프,요리주점', '오뎅바', ''].includes(p[2] ?? ''),
  '와인':      (p) => p[1] === '술집' && p[2] === '와인바',
  '칵테일':    (p) => p[1] === '술집' && p[2] === '칵테일바',
  '이자카야':  (p) => p[1] === '술집' && p[2] === '일본식주점',
};

// 장르가 분류 경로("한식 > 국밥", "술집 > 와인바")면 접두어 일치. 옛 라벨(한식·와인·이자카야)은 GENRE_MATCH.
function genrePath(genre: string | null): string[] | null {
  if (!genre) return null;
  if (GENRE_MATCH[genre]) return null;
  return genre.split('>').map((s) => s.trim()).filter(Boolean);
}
function matchesGenrePath(path: string[], gp: string[]): boolean {
  return gp.every((seg, i) => path[i + 1] === seg);   // path[0]은 '음식점'
}

function matchesPurpose(path: string[], purpose: string, genre: string | null): boolean {
  if (path[0] !== '음식점') return false;
  const gp = genrePath(genre);
  if (gp && gp.length) return matchesGenrePath(path, gp);
  if (genre && GENRE_MATCH[genre]) return GENRE_MATCH[genre](path);
  if (purpose === '밥') return !NOT_MEAL.has(path[1] ?? '');
  if (purpose === '술') return path[1] === '술집' || (path[1] === '한식' && path[2] === '육류,고기');
  if (purpose === '카페') return path[1] === '카페';
  // 메뉴 직접 입력: 검색어가 이미 메뉴라 카테고리로 더 좁히지 않는다. 전역 제외만.
  return !['푸드코트', '구내식당', '도시락'].includes(path[1] ?? '');
}

// 런타임 전용 후보. 응답에 싣는 것(좌표·주소·카테고리)은 표시용이고 저장하지 않는다.
interface Candidate {
  id: string;
  name: string;
  url: string;
  lat: number;
  lng: number;
  roadAddress: string;
  jibun: string;
  path: string[];        // ['음식점','한식','국밥']
  distanceM: number;
  categoryId: number | null;   // place_category.id — 로그에 남기는 건 이것뿐(카카오 문자열 아님)
}

interface KakaoDoc {
  id: string; place_name: string; place_url: string; x: string; y: string;
  road_address_name?: string; address_name?: string; category_name?: string; distance?: string;
}

async function kakaoSearch(
  key: string, kind: 'keyword' | 'category', params: Record<string, string | number>,
): Promise<{ docs: KakaoDoc[]; isEnd: boolean }> {
  try {
    const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/${kind}.json?${qs}`, {
      headers: { Authorization: `KakaoAK ${key}` },
    });
    if (!res.ok) return { docs: [], isEnd: true };
    const data = await res.json() as { documents?: KakaoDoc[]; meta?: { is_end?: boolean } };
    return { docs: data.documents ?? [], isEnd: data.meta?.is_end !== false };
  } catch {
    return { docs: [], isEnd: true };
  }
}

function toCandidate(d: KakaoDoc, centerLat: number, centerLng: number): Candidate | null {
  const lat = parseFloat(d.y); const lng = parseFloat(d.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const path = (d.category_name ?? '').split('>').map((s) => s.trim());
  const distanceM = d.distance ? Number(d.distance) : Math.round(distKm(centerLat, centerLng, lat, lng) * 1000);
  return {
    id: d.id, name: d.place_name, url: d.place_url, lat, lng,
    roadAddress: d.road_address_name ?? '', jibun: d.address_name ?? '', path, distanceM,
    categoryId: null,
  };
}

// 지번 주소에서 동네명("성수동1가" → "성수동"). 프롬프트에 좌표 대신 동네를 준다 — 모델이 훨씬 잘 안다.
function dongOf(jibun: string): string {
  const m = jibun.match(/([가-힣]+(?:동|읍|면|리))(?:\d*가)?\b/);
  return m ? m[1] : '';
}

interface FetchOpts {
  key: string; purpose: string; genre: string | null; customMenus: string[];
  areas: string[]; regionScope: RegionScope | null;
  centerLat: number; centerLng: number; radiusM: number;
  excludeTokens: string[]; excludeNames: string[];
}

// 후보 수집 — 카테고리 검색(거리순)과 키워드 검색(관련도순)을 섞는다. 카테고리 검색만 쓰면 "가까운 평범한 곳"만 오고,
// 키워드 검색만 쓰면 반경 밖이 섞인다. 둘을 합쳐 id로 중복 제거.
async function fetchCandidates(o: FetchOpts): Promise<{ list: Candidate[]; calls: number; scopeRelaxed: boolean }> {
  const seen = new Map<string, Candidate>();
  let calls = 0;
  const add = (docs: KakaoDoc[]) => {
    for (const d of docs) {
      if (seen.has(d.id)) continue;
      const c = toCandidate(d, o.centerLat, o.centerLng);
      if (c) seen.set(c.id, c);
    }
  };
  const group = o.purpose === '카페' ? 'CE7' : 'FD6';
  const base = { x: o.centerLng, y: o.centerLat, radius: Math.min(o.radiusM, 20000), size: 15 };

  // 1) 키워드 검색: 지역명 × 키워드 (관련도순). 장르가 있으면 장르 풀, 없으면 목적 풀, 직접 입력이면 그 메뉴.
  // 분류 경로 장르("한식 > 해물,생선 > 게,대게")는 가장 깊은 단계의 이름을 검색어로("게", "대게").
  const gp = genrePath(o.genre);
  const pathKeywords = gp && gp.length
    ? [...new Set(gp[gp.length - 1].split(',').map((s) => s.trim()).filter((s) => s.length >= 2))]
    : [];
  const keywords = o.customMenus.length
    ? o.customMenus
    : pathKeywords.length
      ? [...pathKeywords, ...(PURPOSE_KEYWORDS[o.purpose] ?? []).slice(0, 2)]
      : o.genre && GENRE_KEYWORDS[o.genre]
        ? GENRE_KEYWORDS[o.genre].slice(0, 4)
        : (PURPOSE_KEYWORDS[o.purpose] ?? PURPOSE_KEYWORDS['기타']).slice(0, 5);
  const areaNames = o.areas.length ? o.areas.slice(0, 2) : [o.regionScope?.matchTokens.join(' ') ?? ''];
  const keywordQueries: string[] = [];
  for (const area of areaNames) for (const kw of keywords) keywordQueries.push(`${area} ${kw}`.trim());
  await Promise.all(keywordQueries.map(async (q) => {
    for (let page = 1; page <= 2; page++) {
      const r = await kakaoSearch(o.key, 'keyword', { ...base, query: q, page }); calls++;
      add(r.docs);
      if (r.isEnd) break;
    }
  }));

  // 2) 카테고리 검색: 중심 반경 거리순 3페이지. 키워드에 안 걸리는 동네 가게를 보탠다.
  //    직접 입력 메뉴는 카테고리로 못 좁히므로 생략(키워드 결과만).
  if (!o.customMenus.length) {
    for (let page = 1; page <= 3; page++) {
      const r = await kakaoSearch(o.key, 'category', { ...base, category_group_code: group, page, sort: 'distance' }); calls++;
      add(r.docs);
      if (r.isEnd) break;
    }
  }

  // 3) 필터 — 목적·장르(카테고리 경로), 테이크아웃, 편식, 재추천 제외, 반경
  const isExcludedName = (name: string) => o.excludeNames.some((ex) => name.includes(ex) || ex.includes(name));
  const hitsExcludeFood = (c: Candidate) => {
    const hay = `${c.name} ${c.path.join(' ')}`.replace(/\s+/g, '');
    return o.excludeTokens.some((t) => hay.includes(t.replace(/\s+/g, '')));
  };
  let list = [...seen.values()].filter((c) =>
    matchesPurpose(c.path, o.purpose, o.genre)
    && !TAKEOUT_RE.test(`${c.name}|${c.path.join('|')}`)
    && !hitsExcludeFood(c)
    && !isExcludedName(c.name)
    && c.distanceM <= o.radiusM,
  );

  // 4) 행정단위 스코프 — 지번 주소 토큰. 너무 적게 남으면 반경만으로 완화.
  let scopeRelaxed = false;
  if (o.regionScope) {
    const inScope = list.filter((c) => addressInScope(c.jibun, o.regionScope!.matchTokens));
    if (inScope.length >= MIN_CANDIDATES) list = inScope;
    else scopeRelaxed = true;
  }

  // 키워드(관련도) 결과가 앞, 그다음 거리순. 상한까지만.
  return { list: list.slice(0, CANDIDATE_CAP), calls, scopeRelaxed };
}

const PLACE_SCHEMA = {
  type: 'object',
  properties: {
    sourceIndex: { type: 'integer' },
    known: { type: 'boolean' },
    fitScore: { type: 'integer' },
    description: { type: 'string' },
    priceRange: { type: 'string' },
    vibeTags: { type: 'array', items: { type: 'string' } },
  },
  required: ['sourceIndex', 'known', 'fitScore', 'description', 'priceRange', 'vibeTags'],
};
const RESPONSE_SCHEMA = { type: 'object', properties: { places: { type: 'array', items: PLACE_SCHEMA } }, required: ['places'] };

function formatCandidates(list: Candidate[]): string {
  return list.map((c, i) => {
    const cat = c.path.slice(1, 3).filter(Boolean).join(' > ') || '음식점';
    const dong = dongOf(c.jibun);
    return `${i + 1}. ${c.name} | ${cat} | ${c.distanceM}m${dong ? ` | ${dong}` : ''}`;
  }).join('\n');
}

async function handleEnrich(req: VercelRequest, res: VercelResponse) {
  // 검색 우선 경로는 응답에 이미 kakaoPlaceUrl이 실려 있다. 클라이언트 호환을 위해 받은 그대로 돌려준다.
  const body = req.body as { places?: unknown };
  const raw = Array.isArray(body.places) ? body.places : [];
  const enriched = raw
    .filter((p): p is { placeName: string; kakaoPlaceUrl?: string } => !!p && typeof p === 'object' && typeof (p as { placeName?: unknown }).placeName === 'string')
    .slice(0, 7)
    .map((p) => ({ placeName: p.placeName, kakaoPlaceUrl: p.kakaoPlaceUrl }));
  return res.status(200).json({ enriched });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  if (req.body?.stage === 'enrich') return handleEnrich(req, res);

  const invalidMsg = validateRecommendBody(req.body);
  if (invalidMsg) return res.status(400).json({ error: invalidMsg });

  const kakaoKey = process.env.VITE_KAKAO_REST_API_KEY;
  if (!kakaoKey) return res.status(500).json({ error: '추천 서비스 설정이 준비되지 않았어요.' });

  const gatePromise = checkRateLimit(
    getSupabaseAdmin(), 'recommend', clientIp(req), 5, Number(process.env.RECOMMEND_DAILY_CAP ?? 500),
  );

  try {
    const { input, midpoint } = req.body;

    const sessionKey: string | null = (() => {
      const sk = req.body.sessionKey;
      return typeof sk === 'string' && sk.length > 0 && sk.length <= 100 ? sk : null;
    })();

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
    const isQuiet = detectQuiet(vibe?.first, vibe?.second, keywords);
    const excludeFoods: string[] = Array.isArray(input.excludeFoods)
      ? (input.excludeFoods as unknown[]).filter((f): f is string => typeof f === 'string' && !!f.trim()).map((f) => f.trim())
      : [];
    const excludeTokens = excludeFoodTokens(excludeFoods);
    const excludeNames: string[] = Array.isArray(req.body.excludeNames)
      ? (req.body.excludeNames as unknown[]).filter((n): n is string => typeof n === 'string' && n.length > 0)
      : [];

    const clientCongestion = (req.body.congestionData ?? []) as { areaName: string }[];
    const areaList: string[] = clientCongestion.length
      ? clientCongestion.map((c) => c.areaName)
      : (Array.isArray(req.body.areas) ? (req.body.areas as string[]) : []);
    const areaNames = areaList.join(', ');
    const locationStr = (input.locations as { name: string }[]).map((l) => l.name).filter(Boolean).join(', ');

    const midLat: number = midpoint?.lat ?? 37.5665;
    const midLng: number = midpoint?.lng ?? 126.9780;
    const centerLat = regionScope?.centerLat ?? midLat;
    const centerLng = regionScope?.centerLng ?? midLng;
    const baseRadius = GATE_RADIUS_M[regionScope?.level ?? 'none'];
    const cityWide = regionScope?.level === 'city';

    // 메뉴 직접 입력("보쌈,피자")은 각 메뉴가 검색어. 프리셋(밥/술/카페)은 빈 배열.
    const customMenusOf = (p: string) =>
      ['밥', '술', '카페'].includes(p) ? [] : p.split(',').map((s) => s.trim()).filter(Boolean);

    // 분류표는 요청마다 읽지 않고 10분 캐시. 없어도 추천은 돈다(category_id만 비고 unmapped 카운트로 관측).
    const categories = await loadPlaceCategories();
    let unmappedPaths = 0;
    const tagCategory = (c: Candidate) => {
      const row = matchCategory(categories, c.path);
      c.categoryId = row?.id ?? null;
      if (!row) unmappedPaths++;
    };

    // ── 후보 수집 (1차·2차 병렬). 부족하면 반경 2배로 한 번 더 ──
    const fetchSlot = async (p: string, genre: string | null, excl: string[]) => {
      const opts: FetchOpts = {
        key: kakaoKey, purpose: p, genre, customMenus: customMenusOf(p), areas: areaList, regionScope,
        centerLat, centerLng, radiusM: baseRadius, excludeTokens, excludeNames: excl,
      };
      let r = await fetchCandidates(opts);
      let widened = false;
      if (r.list.length < MIN_CANDIDATES) {
        const again = await fetchCandidates({ ...opts, radiusM: baseRadius * 2, regionScope: null });
        r = { list: again.list, calls: r.calls + again.calls, scopeRelaxed: true };
        widened = true;
      }
      return { ...r, widened };
    };
    const [slot1, slot2] = await Promise.all([
      fetchSlot(purpose.first, firstGenre, excludeNames),
      hasTwoPurposes && purpose.second ? fetchSlot(purpose.second, secondGenre, excludeNames) : Promise.resolve(null),
    ]);
    const kakaoCalls = slot1.calls + (slot2?.calls ?? 0);
    slot1.list.forEach(tagCategory);
    slot2?.list.forEach(tagCategory);
    console.log(`[recommend-search] candidates slot1=${slot1.list.length}${slot1.scopeRelaxed ? '(relaxed)' : ''}${slot1.widened ? '(widened)' : ''} slot2=${slot2?.list.length ?? '-'} kakaoCalls=${kakaoCalls} categoryRows=${categories?.rows.length ?? 0} unmapped=${unmappedPaths}`);

    if (slot1.list.length === 0) {
      return res.status(500).json({ error: '조건에 맞는 장소를 찾지 못했어요. 지역이나 조건을 바꿔 다시 시도해주세요.' });
    }
    const effectiveTwoPurposes = hasTwoPurposes && !!slot2 && slot2.list.length > 0;

    // ── 프롬프트: 목록 안에서 순위만. 모르는 곳은 known:false로 받아 점수를 깎는다 ──
    const relationLine = relation ? `\n- 모임 관계: ${relation}` : '';
    const occasionLine = occasion ? `\n- 특별한 행사: ${occasion} → ${OCCASION_HINT[occasion] ?? '분위기에 맞는 곳'}` : '';
    const budgetLine = budget ? `\n- 예산: 1인 ${budget}` : '';
    const keywordsLine = keywords.length > 0 ? `\n- 1차 필수 조건: ${keywords.map((k) => `#${k}`).join(' ')}` : '';
    const keywordsSecondLine = keywordsSecond.length > 0 ? `\n- 2차 필수 조건: ${keywordsSecond.map((k) => `#${k}`).join(' ')}` : '';
    const WEIGHT_DESC: Record<number, string> = { 1: '거의 무시', 2: '낮음', 3: '보통', 4: '중요', 5: '최우선 반영' };
    const vibeWeights: Record<string, number> = input.vibeWeights ?? {};
    const weightsSection = Object.keys(vibeWeights).length > 0
      ? `\n\n## 재추천 가중치 (사용자 지정)\n${Object.entries(vibeWeights).map(([label, w]) => `- ${label}: ${w}/5 (${WEIGHT_DESC[w] ?? '보통'})`).join('\n')}\n높은 가중치 항목을 최우선으로 반영`
      : '';
    const commonInfo = `
## 모임 정보
- 출발지: ${locationStr || `미입력 (${areaNames || '중간지점'} 일대에서 모임)`}
- 추천 지역: ${regionScope ? regionScope.matchTokens.join(' ') : areaNames || '중간지점 일대'}
- 인원: ${groupSize}명${groupSize >= 5 ? ' (단체석 또는 넓은 공간 필수)' : ''}${relationLine}${occasionLine}${budgetLine}${keywordsLine}${keywordsSecondLine}
- 분위기: ${vibeFirstStr}${vibeSecondStr ? ` / 2차: ${vibeSecondStr}` : ''}${isQuiet ? ' (조용한 곳 원함)' : ''}
- 현재 시각: ${currentTime}${weightsSection}`;

    const slotPrompt = (slot: 1 | 2, list: Candidate[], count: number) => {
      const label = slot === 1 ? purposeFirstLabel : purposeSecondLabel;
      const lead = slot === 2 ? `1차 "${purposeFirstLabel}" 다음에 이어갈 2차 코스 ` : '';
      return `당신은 한국 모임 장소 큐레이터입니다. 아래는 실제 영업 중으로 확인된 ${lead}"${label}" 후보 목록입니다.
이 모임에 맞는 순서로 상위 ${Math.min(count, list.length)}곳을 고르세요.

## 후보 목록 (번호 | 상호 | 업종 | 중심에서 거리 | 동네)
${formatCandidates(list)}
${commonInfo}

## 규칙
1. 반드시 위 목록 번호(sourceIndex)로만 선택. 목록 밖 장소 금지, 번호 중복 금지
2. known: 당신이 실제로 아는 가게면 true — 평판·분위기·대표 메뉴를 근거로 점수. 모르면 false — 업종·거리·조건만으로 보수적 점수. 모르는 곳을 아는 척하지 말 것
3. fitScore 0~100 정수. 분위기·목적·예산·인원·조건 적합도. 장소마다 차별화
4. description은 20자 내외 한 줄. known:false면 업종과 조건 기준으로만 쓸 것(맛·분위기 단정 금지)
5. priceRange는 1인 예상 가격대. 모르면 업종 평균으로
6. 유명세보다 이 모임의 조건에 맞는지가 우선. 동네 가게라도 조건이 맞으면 상위에

## 응답 형식 (JSON만, 다른 텍스트 없이)
{"places": [ {"sourceIndex": 3, "known": true, "fitScore": 88, "description": "한 줄", "priceRange": "1인 2~3만원", "vibeTags": ["태그1","태그2","태그3"]}, ... ]}
places는 적합한 순서대로 ${Math.min(count, list.length)}개`;
    };

    const prompts: { slot: 1 | 2; list: Candidate[]; prompt: string }[] = effectiveTwoPurposes
      ? [
          { slot: 1, list: slot1.list, prompt: slotPrompt(1, slot1.list, PICK_COUNT_PER_SLOT) },
          { slot: 2, list: slot2!.list, prompt: slotPrompt(2, slot2!.list, PICK_COUNT_PER_SLOT) },
        ]
      : [{ slot: 1, list: slot1.list, prompt: slotPrompt(1, slot1.list, PICK_COUNT_SINGLE) }];

    const benchKey = (process.env.ADMIN_BENCH_KEY ?? process.env.ADMIN_PASSWORD ?? '').trim();
    const headerKey = req.headers['x-admin-key'];
    const providerOverride: LlmProvider | undefined =
      (req.body._provider === 'hcx' || req.body._provider === 'claude')
      && !!benchKey && typeof headerKey === 'string' && safeEqualStr(headerKey, benchKey)
        ? req.body._provider : undefined;

    const gate = await gatePromise;
    if (!gate.allowed) {
      return res.status(429).json({
        error: gate.reason === 'daily'
          ? '오늘 추천 요청이 몰려서 잠시 쉬어가고 있어요. 내일 다시 만나요!'
          : '요청이 너무 잦아요. 잠시 후 다시 시도해주세요.',
      });
    }

    // LLM 순위. 실패하면 거리순 폴백 — 후보가 실존하므로 500 대신 결정론 결과를 낸다.
    let llmFailed = false;
    const results = await Promise.all(prompts.map(async ({ prompt }) => {
      try {
        return await askLlm(prompt, {
          provider: providerOverride,
          maxTokens: 4096,
          temperature: 0.3,   // 목록 안 선택은 결정론에 가깝게. 다양성은 최종 샘플링이 맡는다
          system: '당신은 한국 모임 장소 큐레이터입니다. 주어진 목록 안에서만 JSON으로 답합니다.',
          jsonSchema: RESPONSE_SCHEMA,
        });
      } catch (e) {
        console.error('[recommend-search] llm failed', e);
        llmFailed = true;
        return null;
      }
    }));
    const ai = {
      provider: results.find((r) => r)?.provider ?? providerOverride ?? null,
      model: results.find((r) => r)?.model ?? null,
      ms: Math.max(0, ...results.map((r) => r?.ms ?? 0)),
      outputTokens: results.reduce<number>((s, r) => s + (r?.outputTokens ?? 0), 0),
    };

    // ── 응답 해석 → 후보에 매핑. 점수 = known ? fitScore : min(fitScore, cap), 거리 감점 ──
    interface Scored { cand: Candidate; slot: 1 | 2; known: boolean; fitScore: number; finalScore: number; description: string; priceRange: string; vibeTags: string[] }
    const scored: Scored[] = [];
    let knownCount = 0;
    prompts.forEach(({ slot, list }, i) => {
      const r = results[i];
      const got = r ? (extractPlaces(r.text) ?? []) : [];
      if (r?.truncated) console.warn(`[recommend-search] slot ${slot} 응답이 토큰 상한에서 잘림`);
      const used = new Set<number>();
      const fromLlm: Scored[] = [];
      for (const g of got) {
        const idx = typeof g.sourceIndex === 'number' ? g.sourceIndex - 1 : -1;
        if (idx < 0 || idx >= list.length || used.has(idx)) continue;
        used.add(idx);
        const known = g.known === true;
        const fit = typeof g.fitScore === 'number' ? Math.max(0, Math.min(100, g.fitScore)) : 50;
        if (known) knownCount++;
        fromLlm.push({
          cand: list[idx], slot, known,
          fitScore: fit,
          finalScore: (known ? fit : Math.min(fit, UNKNOWN_SCORE_CAP)) - (list[idx].distanceM / 1000) * DISTANCE_PENALTY_PER_KM,
          description: typeof g.description === 'string' ? g.description : '',
          priceRange: typeof g.priceRange === 'string' ? g.priceRange : '',
          vibeTags: Array.isArray(g.vibeTags) ? g.vibeTags.filter((t): t is string => typeof t === 'string').slice(0, 3) : [],
        });
      }
      // LLM이 비었거나 실패하면 거리순으로 상위를 채운다 — 후보는 실존이므로 결과는 낸다
      if (fromLlm.length === 0) {
        list.slice(0, 6).forEach((cand) => fromLlm.push({
          cand, slot, known: false, fitScore: 50,
          finalScore: 50 - (cand.distanceM / 1000) * DISTANCE_PENALTY_PER_KM,
          description: '', priceRange: '', vibeTags: [],
        }));
      }
      scored.push(...fromLlm);
    });

    // 1차·2차에 같은 가게가 오면 1차만
    const seenIds = new Set<string>();
    const deduped = scored.filter((s) => {
      if (seenIds.has(s.cand.id)) return false;
      seenIds.add(s.cand.id);
      return true;
    });

    const toPlace = (s: Scored): FinalistPlace => ({
      placeName: s.cand.name,
      category: s.cand.path.slice(1, 3).filter(Boolean).join(' > ') || '음식점',
      address: s.cand.roadAddress || s.cand.jibun,
      area: dongOf(s.cand.jibun) || (areaList[0] ?? ''),
      lat: s.cand.lat,
      lng: s.cand.lng,
      description: s.description,
      priceRange: s.priceRange,
      vibeTags: s.vibeTags,
      fitScore: s.fitScore,
      finalScore: Math.round(s.finalScore),
      kakaoPlaceId: s.cand.id,
      kakaoPlaceUrl: s.cand.url,
      known: s.known,
      purposeSlot: s.slot,
    });
    const numScore = (p: FinalistPlace) => (typeof p.finalScore === 'number' ? p.finalScore : 0);
    const bySlot = (slot: number) => {
      const sorted = deduped.filter((s) => s.slot === slot).map(toPlace).sort((a, b) => numScore(b) - numScore(a));
      return cityWide ? spreadByGu(sorted) : sorted;
    };

    // ── 최종 선택 — 상위 풀에서 세션키 시드 샘플링(새로고침엔 같고, 다음 모임·재추천엔 달라짐) ──
    const rnd = seededRandom(`${sessionKey ?? 'anon'}:${excludeNames.length}`);
    const pickOne = (sorted: FinalistPlace[]) =>
      cityWide ? sorted[0] : weightedPick(sorted.slice(0, PICK_POOL), numScore, 1, rnd, PICK_TEMPERATURE)[0];

    let places: FinalistPlace[];
    if (effectiveTwoPurposes && bySlot(2).length > 0) {
      const firstSorted = bySlot(1);
      const secondSorted = bySlot(2);
      let f0 = pickOne(firstSorted);
      let s0 = pickOne(secondSorted);
      if (cityWide) {
        const pair = pickClosePrimaryPair(firstSorted, secondSorted, numScore);
        if (pair) { f0 = pair.f; s0 = pair.s; }
      }
      const restFirst = firstSorted.filter((p) => p !== f0);
      const restSecond = secondSorted.filter((p) => p !== s0);
      places = ([
        f0 && { ...f0, rank: 1 },
        s0 && { ...s0, rank: 2 },
        restFirst[0] && { ...restFirst[0], rank: 3 },
        restFirst[1] && { ...restFirst[1], rank: 4 },
        restSecond[0] && { ...restSecond[0], rank: 5 },
        restSecond[1] && { ...restSecond[1], rank: 6 },
      ].filter(Boolean) as FinalistPlace[]);
    } else {
      const sorted = bySlot(1);
      const chosen = cityWide
        ? sorted.slice(0, 3)
        : weightedPick(sorted.slice(0, PICK_POOL + 1), numScore, 3, rnd, PICK_TEMPERATURE)
            .sort((a, b) => numScore(b) - numScore(a));
      places = chosen.map((p, i) => ({ ...p, rank: i + 1 }));
    }
    if (places.length === 0) {
      return res.status(500).json({ error: '조건에 맞는 장소를 찾지 못했어요. 지역이나 조건을 바꿔 다시 시도해주세요.' });
    }

    const rank1 = places.find((p) => p.rank === 1);
    const rank2 = places.find((p) => p.rank === 2);
    if (rank1 && rank2 && typeof rank1.lat === 'number' && typeof rank2.lat === 'number') {
      rank1.walkingToNext = walkingMinutes(rank1.lat, rank1.lng as number, rank2.lat, rank2.lng as number);
    }
    for (const p of places) delete p.purposeSlot;

    const makeSerial = (): string => {
      const cs = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      let s = '';
      for (let i = 0; i < 6; i++) s += cs[Math.floor(Math.random() * cs.length)];
      return s;
    };
    let serial = makeSerial();

    // ── 기록 — 카카오 place id와 우리 점수·판정만. 가게 이름·주소·카테고리는 저장하지 않는다(약관) ──
    try {
      const supabase = getSupabaseAdmin();
      if (supabase) {
        const displayedRank = new Map(places.map((p) => [p.kakaoPlaceId as string, p.rank as number]));
        const candidates = deduped.map((s) => ({
          place_key: `kakao:${s.cand.id}`,
          kakao_place_id: s.cand.id,
          category_id: s.cand.categoryId,     // place_category.id — 우리 분류표라 저장 가능
          purposeSlot: s.slot,
          slotRank: null,
          fitScore: s.fitScore,
          known: s.known,
          bubbleScore: null,
          buzzCount: null,
          naverRank: null,
          isPublicGem: false,
          finalScore: Math.round(s.finalScore),
          finalRank: displayedRank.get(s.cand.id) ?? null,
          displayed: displayedRank.has(s.cand.id),
        }));
        if (sessionKey) {
          await supabase.from('recommendation_log').update({ retried: true }).eq('session_key', sessionKey);
        }
        const categoryIdByPlace = new Map(deduped.map((s) => [s.cand.id, s.cand.categoryId]));
        const placesDisplay = places.slice(0, 8).map((p) => ({
          rank: (p.rank as number) ?? null,
          placeName: null,                       // 카카오 상호는 저장하지 않는다
          category: null,
          address: null,
          kakao_place_id: p.kakaoPlaceId ?? null,
          category_id: categoryIdByPlace.get(p.kakaoPlaceId as string) ?? null,
        }));
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
      console.error('[recommend-search] recommendation_log insert failed', e);
    }

    console.log(`[recommend-search] provider=${ai.provider} model=${ai.model} ms=${ai.ms} candidates=${slot1.list.length}+${slot2?.list.length ?? 0} known=${knownCount} llmFailed=${llmFailed}`);

    return res.status(200).json({
      places,
      serial,
      thirdStop: null,
      thirdLabel: null,
      weather: null,
      // 실험 측정용 — 후보 수·모델이 아는 비율·폴백 여부
      _llm: {
        provider: ai.provider, model: ai.model, ms: ai.ms, outputTokens: ai.outputTokens,
        engine: 'search-v1',
        candidates: slot1.list.length + (slot2?.list.length ?? 0),
        known: knownCount,
        categoryRows: categories?.rows.length ?? 0,
        unmappedPaths,
        scopeRelaxed: slot1.scopeRelaxed || !!slot2?.scopeRelaxed,
        widened: slot1.widened || !!slot2?.widened,
        llmFailed,
        kakaoCalls,
      },
    });
  } catch (e) {
    console.error('[recommend-search] failed', e);
    return res.status(500).json({ error: '추천을 만드는 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.' });
  }
}
