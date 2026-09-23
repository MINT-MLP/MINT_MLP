import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clientIp, checkRateLimit, validateRecommendBody } from '../_lib/guard.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { placeKey } from '../_lib/placeKey.js';
import { safeEqualStr } from '../_lib/adminAuth.js';
import { askLlm, type LlmProvider } from '../_lib/llm.js';
import {
  extractPlaces, spreadByGu, pickClosePrimaryPair, walkingMinutes, distKm, OCCASION_HINT, detectQuiet,
  type FinalistPlace, type RegionScope,
} from './recommend.js';

// 프롬프트 전용 추천(실험). 후보를 검색 API 대신 모델 기억에서 받는다.
// 외부 호출은 카카오 키워드 검색 하나뿐이고, 실존(폐업) 확인과 장소 URL에만 실시간으로 쓴다.
// 카카오 응답은 비교 후 버리고 URL만 남긴다(카카오 로컬 정책: 응답 저장 불가, ID·URL만 허용).
// 기존 파이프라인은 ./recommend.ts 그대로 두고 라우터에서 이 파일로 바꿔 끼웠다.

const GATE_RADIUS_M: Record<RegionScope['level'] | 'none', number> = {
  city: 20000, district: 6000, dong: 2500, none: 3000,
};

const FINALIST_SINGLE = 10;
const FINALIST_PER_PURPOSE = 6;
const FINALIST_SINGLE_CITY = 12;
const FINALIST_PER_PURPOSE_CITY = 9;

const PLACE_SCHEMA = {
  type: 'object',
  properties: {
    slotRank: { type: 'integer' },
    purposeSlot: { type: 'integer' },
    placeName: { type: 'string' },
    category: { type: 'string' },
    address: { type: 'string' },
    area: { type: 'string' },
    lat: { type: 'number' },
    lng: { type: 'number' },
    description: { type: 'string' },
    priceRange: { type: 'string' },
    vibeTags: { type: 'array', items: { type: 'string' } },
    fitScore: { type: 'integer' },
  },
  required: ['slotRank', 'purposeSlot', 'placeName', 'category', 'address', 'area', 'lat', 'lng', 'description', 'priceRange', 'vibeTags', 'fitScore'],
};
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: { places: { type: 'array', items: PLACE_SCHEMA } },
  required: ['places'],
};

function normName(s: string): string {
  return (s || '').replace(/\s+/g, '').toLowerCase();
}

// 모임 장소가 못 되는 곳. 프롬프트로도 막지만 모델이 흘리면 여기서 한 번 더 거른다.
const TAKEOUT_RE = /테이크아웃|포장전문|배달전문|푸드코트|무인|키오스크|메가커피|메가mgc|컴포즈|빽다방|더벤티|매머드/i;
function isTakeoutOnly(p: { placeName?: string; category?: string; description?: string }): boolean {
  return TAKEOUT_RE.test(normName(`${p.placeName ?? ''}|${p.category ?? ''}|${p.description ?? ''}`));
}

// "북창동순두부 강남신사점" → "북창동순두부". 지점명만 틀린 경우를 살리기 위한 비교용
function brandName(s: string): string {
  return normName(s).replace(/(본점|\S{1,6}점)$/, '');
}

function validCoord(lat: unknown, lng: unknown): lat is number {
  return typeof lat === 'number' && typeof lng === 'number'
    && lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;
}

interface KakaoHit { placeUrl: string; lat: number; lng: number; match: 'exact' | 'brand' }

// 실존 게이트. 상호가 반경 안에서 검색되고 이름이 맞으면 통과. 응답은 여기서만 쓰고 버린다.
async function kakaoLookup(name: string, lat: number, lng: number, radiusM: number, key: string): Promise<KakaoHit | null> {
  try {
    const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(name)}&x=${lng}&y=${lat}&radius=${Math.min(radiusM, 20000)}&size=3`;
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` } });
    if (!res.ok) return null;
    const data = await res.json() as { documents?: { place_name: string; place_url: string; x: string; y: string }[] };
    const docs = data.documents ?? [];
    const want = normName(name);
    const exact = docs.find((d) => {
      const got = normName(d.place_name);
      return got.length >= 2 && (got.includes(want) || want.includes(got));
    });
    const wantBrand = brandName(name);
    const brand = exact ? null : docs.find((d) => {
      const got = brandName(d.place_name);
      return got.length >= 2 && wantBrand.length >= 2 && (got.includes(wantBrand) || wantBrand.includes(got));
    });
    const hit = exact ?? brand;
    return hit ? { placeUrl: hit.place_url, lat: parseFloat(hit.y), lng: parseFloat(hit.x), match: exact ? 'exact' : 'brand' } : null;
  } catch {
    return null;
  }
}

async function handleEnrich(req: VercelRequest, res: VercelResponse) {
  const body = req.body as { places?: unknown };
  const raw = Array.isArray(body.places) ? body.places : [];
  const key = process.env.VITE_KAKAO_REST_API_KEY;
  const places = raw
    .filter((p): p is { placeName: string; lat: number; lng: number } =>
      !!p && typeof p === 'object'
      && typeof (p as { placeName?: unknown }).placeName === 'string'
      && (p as { placeName: string }).placeName.length <= 80
      && validCoord((p as { lat?: unknown }).lat, (p as { lng?: unknown }).lng))
    .slice(0, 7);
  const enriched = await Promise.all(places.map(async (p) => {
    const hit = key ? await kakaoLookup(p.placeName, p.lat, p.lng, 2000, key) : null;
    return { placeName: p.placeName, kakaoPlaceUrl: hit?.placeUrl ?? undefined };
  }));
  return res.status(200).json({ enriched });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  if (req.body?.stage === 'enrich') return handleEnrich(req, res);

  const invalidMsg = validateRecommendBody(req.body);
  if (invalidMsg) return res.status(400).json({ error: invalidMsg });

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
    const excludeNames: string[] = Array.isArray(req.body.excludeNames)
      ? (req.body.excludeNames as unknown[]).filter((n): n is string => typeof n === 'string' && n.length > 0)
      : [];

    const clientCongestion = (req.body.congestionData ?? []) as { areaName: string }[];
    const areaList: string[] = clientCongestion.length
      ? clientCongestion.map((c) => c.areaName)
      : (Array.isArray(req.body.areas) ? (req.body.areas as string[]) : []);
    const areaNames = areaList.join(', ');
    const locationStr = (input.locations as { name: string }[]).map((l) => l.name).filter(Boolean).join(', ');
    const primaryArea = areaList[0] || areaNames;

    const midLat: number = midpoint?.lat ?? 37.5665;
    const midLng: number = midpoint?.lng ?? 126.9780;
    const gateLat = regionScope?.centerLat ?? midLat;
    const gateLng = regionScope?.centerLng ?? midLng;
    const gateRadius = GATE_RADIUS_M[regionScope?.level ?? 'none'];

    const cityWide = regionScope?.level === 'city';
    const finalistPer = cityWide ? FINALIST_PER_PURPOSE_CITY : FINALIST_PER_PURPOSE;
    const finalistSingle = cityWide ? FINALIST_SINGLE_CITY : FINALIST_SINGLE;

    const regionSection = regionScope
      ? `- 추천 범위: "${regionScope.matchTokens.join(' ')}" 행정구역 안에서만 (${regionScope.level === 'city' ? '시 전체' : regionScope.level === 'district' ? '구 단위' : '동 단위'}). 이 구역 밖 장소는 절대 넣지 말 것. 중심 좌표 ${regionScope.centerLat.toFixed(4)}, ${regionScope.centerLng.toFixed(4)}`
      : `- 추천 지역: ${areaNames || '중간지점 일대'}. 중간지점 좌표 ${midLat.toFixed(4)}, ${midLng.toFixed(4)}에서 반경 1.5km 이내 우선, 최대 3km`;
    const relationLine = relation ? `\n- 모임 관계: ${relation}` : '';
    const occasionLine = occasion ? `\n- 특별한 행사: ${occasion} → ${OCCASION_HINT[occasion] ?? '분위기에 맞는 곳'}` : '';
    const budgetLine = budget ? `\n- 예산: 1인 ${budget}` : '';
    const keywordsLine = keywords.length > 0 ? `\n- 1차 필수 조건: ${keywords.map((k) => `#${k}`).join(' ')}` : '';
    const keywordsSecondLine = keywordsSecond.length > 0 ? `\n- 2차 필수 조건: ${keywordsSecond.map((k) => `#${k}`).join(' ')}` : '';
    const excludeFoodsLine = excludeFoods.length > 0 ? `\n- 못 먹는 음식(제외): ${excludeFoods.join(', ')}` : '';
    const excludeNamesLine = excludeNames.length > 0 ? `\n- 이미 추천한 곳(다시 넣지 말 것): ${excludeNames.join(', ')}` : '';
    const genreLine = firstGenre || secondGenre
      ? `\n- 장르 지정: ${[firstGenre ? `1차(${purpose.first})는 ${firstGenre}` : null, secondGenre ? `2차(${purpose.second})는 ${secondGenre}` : null].filter(Boolean).join(', ')}`
      : '';
    const guSpreadLine = cityWide ? `\n- 시 전체 추천이므로 최소 3개 이상 서로 다른 구에 고르게 분산` : '';
    const WEIGHT_DESC: Record<number, string> = { 1: '거의 무시', 2: '낮음', 3: '보통', 4: '중요', 5: '최우선 반영' };
    const vibeWeights: Record<string, number> = input.vibeWeights ?? {};
    const weightsSection = Object.keys(vibeWeights).length > 0
      ? `\n\n## 재추천 가중치 (사용자 지정)\n${Object.entries(vibeWeights).map(([label, w]) => `- ${label}: ${w}/5 (${WEIGHT_DESC[w] ?? '보통'})`).join('\n')}\n높은 가중치 항목을 최우선으로 반영`
      : '';

    const commonInfo = `
## 모임 정보
- 출발지: ${locationStr || `미입력 (${areaNames} 일대에서 모임)`}
${regionSection}
- 인원: ${groupSize}명${groupSize >= 5 ? ' (단체석 또는 넓은 공간 필수)' : ''}${relationLine}${occasionLine}${budgetLine}${keywordsLine}${keywordsSecondLine}${excludeFoodsLine}${genreLine}${excludeNamesLine}
- 분위기: ${vibeFirstStr}${vibeSecondStr ? ` / 2차: ${vibeSecondStr}` : ''}${isQuiet ? ' (조용한 곳 원함)' : ''}
- 현재 시각: ${currentTime}${weightsSection}

## 절대 규칙
1. 당신이 실제로 알고 있고, 현재 영업 중이라고 확신하는 장소만. 확신이 없으면 넣지 말 것. 폐업했거나 이름이 바뀐 곳 금지
2. 유명하지 않아도 되지만 지어낸 이름은 절대 금지. 프랜차이즈는 지점명까지(예: "OO 성수점")
3. address는 아는 만큼 정확히(도로명 또는 지번). lat/lng는 아는 값만, 모르면 0
4. category는 업종(예: 이자카야, 파스타, 카페)
5. fitScore는 0~100 정수. 분위기·목적·예산·인원 적합도. rank 1이 가장 높게, 장소마다 차별화
6. 일행이 앉아서 머물 수 있는 곳만. 테이크아웃·포장·배달 전문점, 좌석 없는 매장, 푸드코트, 저가 테이크아웃 커피 체인(메가커피·컴포즈·빽다방·더벤티·매머드 등)은 절대 금지`;

    const schemaText = `{"slotRank": 1, "purposeSlot": 1, "placeName": "장소명", "category": "업종", "address": "주소", "area": "동네명", "lat": 0, "lng": 0, "description": "한 줄 설명 20자 내외", "priceRange": "1인 예상 가격대", "vibeTags": ["태그1", "태그2", "태그3"], "fitScore": 0}`;

    const prompt = hasTwoPurposes
      ? `당신은 한국 모임 장소 큐레이터입니다. 1차·2차 코스 장소를 각각 선호 순서대로 ${finalistPer}곳씩 추천해주세요.
${commonInfo}

## 응답 구성 (총 ${finalistPer * 2}곳)
- purposeSlot 1(1차 "${purposeFirstLabel}") ${finalistPer}곳: slotRank 1이 가장 적합, 내림차순. 장소 중복 금지
- purposeSlot 2(2차 "${purposeSecondLabel}") ${finalistPer}곳: slotRank 1이 가장 적합, 내림차순. 장소 중복 금지
- 각 슬롯의 slotRank 1은 서로 도보 15분 이내로 이어질 수 있는 조합을 우선${guSpreadLine}

## 응답 형식 (JSON만, 다른 텍스트 없이)
{"places": [ ${schemaText}, ... ]}
places 배열에 purposeSlot 1의 slotRank 1~${finalistPer}, 이어서 purposeSlot 2의 slotRank 1~${finalistPer} 순으로 ${finalistPer * 2}개`
      : `당신은 한국 모임 장소 큐레이터입니다. "${purposeFirstLabel}" 장소를 선호 순서대로 ${finalistSingle}곳 추천해주세요.
${commonInfo}

## 응답 구성 (서로 다른 ${finalistSingle}곳, purposeSlot은 항상 1)
- slotRank 1이 가장 적합, 내림차순. 장소 중복 금지${guSpreadLine}

## 응답 형식 (JSON만, 다른 텍스트 없이)
{"places": [ ${schemaText}, ... ]}
places 배열에 slotRank 1~${finalistSingle} 순으로 ${finalistSingle}개, purposeSlot은 모두 1`;

    // 벤더 A/B — 관리자 키가 맞을 때만 요청 본문의 _provider로 바꾼다
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

    const ai = await askLlm(prompt, {
      provider: providerOverride,
      maxTokens: 6144,
      temperature: 0.3,
      system: '당신은 한국 모임 장소 큐레이터입니다. 실제로 아는 장소만 JSON으로 답합니다.',
      jsonSchema: RESPONSE_SCHEMA,
    });
    if (ai.truncated) console.warn('[recommend-prompt] 응답이 토큰 상한에서 잘림, 부분 복구 시도');

    const finalists = extractPlaces(ai.text);
    if (!finalists || finalists.length === 0) {
      console.error('[recommend-prompt] places 추출 실패. 응답 앞부분:', ai.text.slice(0, 300));
      return res.status(500).json({ error: '추천 결과를 정리하지 못했어요. 다시 시도해주세요.' });
    }
    for (const f of finalists) {
      if (typeof f.placeName !== 'string') f.placeName = String(f.placeName ?? '');
      if (typeof f.address !== 'string') f.address = String(f.address ?? '');
      if (!validCoord(f.lat, f.lng)) { f.lat = 0; f.lng = 0; }
      if (f.area == null) f.area = primaryArea;
      delete f.openingHours;
      delete f.sourceIndex;
    }

    // 실존 게이트 — 모델이 낸 이름을 상권 중심 반경으로 카카오에 실시간 조회. 미확인은 탈락.
    // 모델 좌표는 표시·기록에 그대로 쓰고, 카카오 좌표는 오차 측정 로그에만 쓴 뒤 버린다.
    const kakaoKey = process.env.VITE_KAKAO_REST_API_KEY;
    let verified: FinalistPlace[] = finalists;
    if (kakaoKey) {
      const isExcluded = (name: string) => excludeNames.some((ex) => name.includes(ex) || ex.includes(name));
      const checked = await Promise.all(finalists.map(async (f) => {
        if (!f.placeName || isExcluded(f.placeName)) return null;
        if (isTakeoutOnly(f)) {
          console.log(`[recommend-prompt] gate "${f.placeName}" slot=${f.purposeSlot} dropped=takeout`);
          return null;
        }
        const hit = await kakaoLookup(f.placeName, gateLat, gateLng, gateRadius, kakaoKey);
        const errKm = hit && validCoord(f.lat, f.lng) ? distKm(f.lat as number, f.lng as number, hit.lat, hit.lng) : null;
        console.log(`[recommend-prompt] gate "${f.placeName}" slot=${f.purposeSlot} found=${!!hit}${hit ? ` match=${hit.match}` : ''}${errKm != null ? ` modelCoordErrKm=${errKm.toFixed(2)}` : ''}`);
        if (!hit) return null;
        f.kakaoPlaceUrl = hit.placeUrl;
        return f;
      }));
      verified = checked.filter((f): f is FinalistPlace => f !== null);
    } else {
      console.warn('[recommend-prompt] VITE_KAKAO_REST_API_KEY 없음, 실존 게이트 생략');
      verified = finalists.filter((f) => !isTakeoutOnly(f));
    }
    console.log(`[recommend-prompt] provider=${ai.provider} model=${ai.model} ms=${ai.ms} asked=${finalists.length} verified=${verified.length}`);

    const effectiveTwoPurposes = hasTwoPurposes && verified.some((p) => p.purposeSlot === 2);
    if (!verified.some((p) => p.purposeSlot !== 2)) {
      return res.status(500).json({ error: '실제로 확인된 장소를 찾지 못했어요. 지역이나 조건을 바꿔 다시 시도해주세요.' });
    }

    const numScore = (p: FinalistPlace) => (typeof p.fitScore === 'number' ? p.fitScore : 0);
    const bySlot = (slot: number) => {
      const sorted = verified.filter((p) => p.purposeSlot === slot).sort((a, b) => numScore(b) - numScore(a));
      return cityWide ? spreadByGu(sorted) : sorted;
    };

    let places: FinalistPlace[];
    if (effectiveTwoPurposes) {
      const firstSorted = bySlot(1);
      const secondSorted = bySlot(2);
      let f0 = firstSorted[0];
      let s0 = secondSorted[0];
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
      places = bySlot(1).slice(0, 3).map((p, i) => ({ ...p, rank: i + 1 }));
    }

    for (const p of places) {
      delete p.slotRank;
      delete p.purposeSlot;
      delete p.congestionLevel;
    }

    if (effectiveTwoPurposes) {
      const rank1 = places.find((p) => p.rank === 1);
      const rank2 = places.find((p) => p.rank === 2);
      if (rank1 && rank2 && validCoord(rank1.lat, rank1.lng) && validCoord(rank2.lat, rank2.lng)) {
        rank1.walkingToNext = walkingMinutes(rank1.lat as number, rank1.lng as number, rank2.lat as number, rank2.lng as number);
      }
    }

    const makeSerial = (): string => {
      const cs = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      let s = '';
      for (let i = 0; i < 6; i++) s += cs[Math.floor(Math.random() * cs.length)];
      return s;
    };
    let serial = makeSerial();

    // 기록 — 모델 출력과 우리 판정만 저장한다(카카오 응답은 URL 외 아무것도 남기지 않음)
    try {
      const supabase = getSupabaseAdmin();
      if (supabase) {
        const displayedByKey = new Map(places.map((p) => [`${p.placeName}|${p.address}`, p.rank as number]));
        const candidates = finalists.map((f) => {
          const key = `${f.placeName}|${f.address}`;
          return {
            place_key: placeKey(f.placeName, f.address),
            purposeSlot: f.purposeSlot ?? null,
            slotRank: f.slotRank ?? null,
            fitScore: f.fitScore ?? null,
            bubbleScore: null,
            buzzCount: null,
            naverRank: null,
            isPublicGem: false,
            finalScore: f.fitScore ?? null,
            finalRank: displayedByKey.get(key) ?? null,
            displayed: displayedByKey.has(key),
          };
        });
        if (sessionKey) {
          await supabase.from('recommendation_log').update({ retried: true }).eq('session_key', sessionKey);
        }
        const placesDisplay = places.slice(0, 8).map((p) => ({
          rank: (p.rank as number) ?? null,
          placeName: p.placeName,
          category: p.category ?? null,
          address: p.address ?? null,
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
      console.error('[recommend-prompt] recommendation_log insert failed', e);
    }

    return res.status(200).json({
      places,
      serial,
      thirdStop: null,
      thirdLabel: null,
      weather: null,
      // 실험 측정용 — 벤더·모델·소요·후보 대비 실존 확인 수
      _llm: { provider: ai.provider, model: ai.model, ms: ai.ms, outputTokens: ai.outputTokens, asked: finalists.length, verified: verified.length },
    });
  } catch (e) {
    console.error('[recommend-prompt] failed', e);
    return res.status(500).json({ error: '추천을 만드는 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.' });
  }
}
