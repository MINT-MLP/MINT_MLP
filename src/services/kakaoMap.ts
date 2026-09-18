import { ensureKakaoMaps } from '@/utils/kakaoLoader';
import { HOTPLACES } from '@/constants/hotplaces';
import type { KakaoPlace, Neighborhood, RegionSuggestion } from '@/types';

const cache = new Map<string, KakaoPlace[]>();

export async function searchKakaoKeyword(
  keyword: string,
  options?: { x?: string; y?: string; radius?: number; size?: number }
): Promise<KakaoPlace[]> {
  const cacheKey = keyword + JSON.stringify(options ?? {});
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  await ensureKakaoMaps();

  return new Promise((resolve, reject) => {
    const ps = new window.kakao.maps.services.Places();
    const opts: Record<string, unknown> = { size: options?.size ?? 5 };
    if (options?.x) opts.x = Number(options.x);
    if (options?.y) opts.y = Number(options.y);
    if (options?.radius) opts.radius = options.radius;
    ps.keywordSearch(
      keyword,
      (results: KakaoPlace[], status: string) => {
        const { OK, ZERO_RESULT } = window.kakao.maps.services.Status;
        if (status === OK) {
          cache.set(cacheKey, results);
          resolve(results);
        } else if (status === ZERO_RESULT) {
          cache.set(cacheKey, []);
          resolve([]);
        } else {
          reject(new Error('카카오 장소 검색 실패'));
        }
      },
      opts
    );
  });
}

export async function searchAddress(keyword: string): Promise<KakaoPlace[]> {
  return searchKakaoKeyword(keyword);
}

// 지번 주소(address_name)에서 '시 [구...] 동' 부분만 뽑는다.
// 동/읍/면/가/리로 끝나는 첫 토큰까지 포함 → 성남시 분당구처럼 구가 여러 토큰이어도 안전.
function toDongLabel(addressName: string): string | null {
  if (!addressName) return null;
  const tokens = addressName.trim().split(/\s+/);
  const idx = tokens.findIndex((t) => /(동|읍|면|가|리)$/.test(t));
  if (idx < 0) return null;
  return tokens.slice(0, idx + 1).join(' ');
}

// 만날 '지역' 검색 전용 — POI가 아니라 시/구/동 동네 단위 제안 목록을 돌려준다.
// keywordSearch 결과의 지번 주소에서 동네를 뽑아 중복 제거.
export async function searchNeighborhoods(keyword: string): Promise<Neighborhood[]> {
  const places = await searchKakaoKeyword(keyword);
  const seen = new Set<string>();
  const out: Neighborhood[] = [];
  for (const p of places) {
    const area = toDongLabel(p.address_name);
    if (!area || seen.has(area)) continue;
    seen.add(area);
    out.push({ area, lat: parseFloat(p.y), lng: parseFloat(p.x) });
    if (out.length >= 6) break;
  }
  return out;
}

// 행정단위(시/구/동) + 핫플레이스 연관검색 자동완성 (네이버 검색제안 스타일).
// 카카오 JS SDK 키워드검색 주소를 계층 파싱하고, 커브레이티드 핫플 테이블을 동기로 매칭해
// "원종동"·"홍대"처럼 접두어 없이 이름만 쳐도 즉시 제안이 뜬다. (별도 서버 함수 없음)

const GU_RE = /(구|군)$/;
const SI_RE = /시$/;
const DONG_RE = /(동|읍|면|가|리)$/;
const noSpace = (s: string) => (s || '').replace(/\s/g, '');

function shortSido(s: string): string {
  return s
    .replace(/특별자치시$/, '').replace(/특별자치도$/, '')
    .replace(/특별시$/, '').replace(/광역시$/, '')
    .replace(/자치도$/, '').replace(/도$/, '')
    .trim();
}

// 시 전체 추천 시 '유명상권 우선'으로 검색할 대표 상권 (구를 흩어 배치 → 구 골고루)
const FAMOUS_AREAS: Record<string, string[]> = {
  '서울': ['강남역', '홍대', '성수동', '종로', '잠실', '여의도'],
  '인천': ['부평', '송도', '구월동', '인천 차이나타운', '청라'],
  '부산': ['서면', '해운대', '남포동', '광안리', '전포동'],
  '대구': ['동성로', '수성못', '들안길', '앞산카페거리'],
  '대전': ['둔산동', '은행동', '유성온천', '봉명동'],
  '광주': ['상무지구', '충장로', '첨단', '수완지구'],
  '울산': ['삼산동', '성남동', '무거동'],
  '세종': ['나성동', '조치원', '어진동'],
  '수원': ['수원역', '인계동', '광교', '영통'],
  '성남': ['판교', '서현역', '모란'],
  '용인': ['수지', '기흥역', '동백'],
  '고양': ['일산', '정발산', '화정'],
  '전주': ['한옥마을', '객사', '신시가지'],
  '제주': ['제주시청', '연동', '노형동', '중문'],
};

// ── 핫플레이스 즉시 매칭 (동기, 네트워크 0 — 팝업 첫 프레임에 바로 뜬다) ──
export function matchHotplaces(q: string): RegionSuggestion[] {
  const n = noSpace(q);
  if (n.length < 1) return [];
  const scored = HOTPLACES.flatMap((h) => {
    const names = [h.name, ...h.aliases].map(noSpace);
    let s = 0;
    if (names.some((x) => x === n)) s = 3;                       // 정확
    else if (names.some((x) => x.startsWith(n))) s = 2;          // 접두 (홍 → 홍대)
    else if (n.length >= 2 && names.some((x) => x.includes(n))) s = 1; // 부분
    return s ? [{ h, s }] : [];
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, 4).map(({ h }) => ({
    level: 'dong' as const, kind: 'hotplace' as const,
    label: `${h.name} · ${h.labelSuffix}`, query: h.name,
    sido: h.city, matchTokens: h.matchTokens, searchAreas: h.searchAreas,
    lat: h.lat, lng: h.lng,
  }));
}

interface Parsed { sido: string; si: string; siShort: string; gu: string; dong: string; lat: number; lng: number; }

// "인천 미추홀구 학익동 …"(2단계) / "경기 부천시 오정구 원종동 …"(3단계, 도) → 계층 분해
function parseAddr(addressName: string, lat: number, lng: number): Parsed | null {
  if (!addressName) return null;
  const tokens = addressName.trim().split(/\s+/);
  if (tokens.length < 2 || !lat || !lng) return null;
  const sido = shortSido(tokens[0]);
  if (!sido) return null;
  const rest = tokens.slice(1);
  const si = rest.find((t) => SI_RE.test(t)) ?? '';
  const gu = rest.find((t) => GU_RE.test(t)) ?? '';
  const dong = rest.find((t) => DONG_RE.test(t) && !GU_RE.test(t) && !SI_RE.test(t)) ?? '';
  const siShort = si ? si.replace(/시$/, '') : '';
  return { sido, si, siShort, gu, dong, lat, lng };
}

// 랭킹 메타를 붙인 후보
interface Cand { s: RegionSuggestion; components: string[]; own: string; idx: number; }

function buildCandidates(p: Parsed, idx: number): Cand[] {
  const out: Cand[] = [];
  const cityName = p.si ? p.siShort : p.sido; // 3단계(도)면 시가 도시 단위, 아니면 광역시
  // CITY — 라벨은 3단계(도 산하 시)면 "부천시 전체", 광역시면 "인천 전체"
  const cityLabel = `${cityName}${p.si ? '시' : ''} 전체`;
  out.push({
    s: { level: 'city', kind: 'region', label: cityLabel, query: cityName, sido: p.sido,
      matchTokens: [cityName], searchAreas: [cityName], lat: p.lat, lng: p.lng },
    components: [cityName], own: cityName, idx,
  });
  // DISTRICT (구/군 있을 때)
  if (p.gu) {
    const label = p.si ? `${p.sido} ${p.si} ${p.gu}` : `${p.sido} ${p.gu}`;
    const anchor = p.si ? p.siShort : p.sido;
    out.push({
      s: { level: 'district', kind: 'region', label, query: label, sido: p.sido, gu: p.gu,
        matchTokens: [anchor, p.gu], searchAreas: [`${anchor} ${p.gu}`], lat: p.lat, lng: p.lng },
      components: p.si ? [p.sido, p.siShort, p.gu] : [p.sido, p.gu], own: p.gu, idx,
    });
  }
  // DONG (동/읍/면 있을 때)
  if (p.dong) {
    const guPart = p.gu ? ` ${p.gu}` : '';
    const label = p.si ? `${p.sido} ${p.si}${guPart} ${p.dong}` : `${p.sido}${guPart} ${p.dong}`;
    // 3단계(도)는 도로명주소가 구를 자주 생략 → 시(短)로 매칭. 2단계는 구(있으면)로.
    const anchor = p.si ? p.siShort : (p.gu || p.sido);
    const searchPrefix = p.si ? p.siShort : p.sido;
    out.push({
      s: { level: 'dong', kind: 'region', label, query: label, sido: p.sido, gu: p.gu, dong: p.dong,
        matchTokens: [anchor, p.dong], searchAreas: [`${searchPrefix} ${p.dong}`], lat: p.lat, lng: p.lng },
      components: [p.sido, p.siShort, p.gu, p.dong].filter(Boolean), own: p.dong, idx,
    });
  }
  return out;
}

// 토큰↔행정명 매칭 품질: 정확3 / 접두2 / 부분1(2자+) / 불일치0
function matchQuality(qTok: string, comp: string): 0 | 1 | 2 | 3 {
  const q = noSpace(qTok), c = noSpace(comp);
  if (!c) return 0;
  if (c === q) return 3;
  if (c.startsWith(q)) return 2;
  if (q.length >= 2 && c.includes(q)) return 1;
  return 0;
}

function scoreCand(qTokens: string[], cand: Cand): number | null {
  // 입력한 모든 토큰이 후보의 어떤 행정명 성분과든 매칭돼야 함
  for (const t of qTokens) {
    if (!cand.components.some((c) => matchQuality(t, c) > 0)) return null;
  }
  // ownQ = 입력 마지막 토큰이 후보의 '자기 레벨명'(city=시명, district=구명, dong=동명)과 맞는 정도.
  // 이걸 최우선으로 둬야 "인천"만 치면 city('인천 전체')가 최상단에 뜬다(과거엔 동 base가 높아 밀렸음).
  // ownQ=0(무관하게 상위 토큰만 걸린 후보)은 아래로 내려 drill-down용으로만 노출.
  const ownQ = matchQuality(qTokens[qTokens.length - 1], cand.own);
  const levelTie = { city: 3, district: 2, dong: 1 }[cand.s.level]; // 동률(ownQ 같음) 시 상위 행정단위 우선
  return ownQ * 100 + levelTie * 5 - cand.idx * 0.2; // idx=카카오 인기순 미세 가산
}

const regionCache = new Map<string, RegionSuggestion[]>();

export async function searchRegions(q: string): Promise<RegionSuggestion[]> {
  const key = q.trim();
  if (!key) return [];
  if (regionCache.has(key)) return regionCache.get(key)!;

  const hot = matchHotplaces(key);

  let places: KakaoPlace[] = [];
  try {
    places = await searchKakaoKeyword(key, { size: 15 });
  } catch {
    return hot; // 카카오 실패해도 핫플만은 보여준다
  }

  const qTokens = key.split(/\s+/).filter(Boolean);
  const candMap = new Map<string, Cand>(); // label 기준 dedupe (첫 등장=인기순)
  const cityAreas = new Map<string, Set<string>>(); // 시 fallback searchAreas 수집

  places.forEach((pl, idx) => {
    const p = parseAddr(pl.address_name, parseFloat(pl.y), parseFloat(pl.x));
    if (!p) return;
    for (const c of buildCandidates(p, idx)) {
      const k = noSpace(c.s.label);
      if (!candMap.has(k)) candMap.set(k, c);
      // 시 fallback용: 그 시의 구 검색어 축적
      if (c.s.level === 'district') {
        const cityName = p.si ? p.siShort : p.sido;
        if (!cityAreas.has(cityName)) cityAreas.set(cityName, new Set());
        cityAreas.get(cityName)!.add(c.s.searchAreas[0]);
      }
    }
    // 지하철역 → 동 레벨 제안 (역명만으로 검색 가능)
    const isStation = /지하철/.test(pl.category_name) || (/역$/.test(pl.place_name) && /교통|지하철/.test(pl.category_name));
    if (isStation) {
      const label = `${pl.place_name} · ${[p.sido, p.si, p.gu].filter(Boolean).join(' ')}`;
      const k = noSpace(label);
      if (!candMap.has(k)) {
        candMap.set(k, {
          s: { level: 'dong', kind: 'station', label, query: pl.place_name, sido: p.sido, gu: p.gu,
            matchTokens: [p.gu || p.siShort || p.sido].filter(Boolean), searchAreas: [pl.place_name],
            lat: parseFloat(pl.y), lng: parseFloat(pl.x) },
          components: [p.sido, p.siShort, p.gu, pl.place_name.replace(/역$/, ''), pl.place_name].filter(Boolean),
          own: pl.place_name, idx,
        });
      }
    }
  });

  // 시 검색어 보강: 유명상권 우선, 없으면 결과에서 모은 구들, 그래도 없으면 [시명]
  for (const cand of candMap.values()) {
    if (cand.s.level !== 'city') continue;
    const c = cand.s.query;
    const famous = FAMOUS_AREAS[c];
    if (famous?.length) cand.s.searchAreas = famous.map((a) => (a.includes(c) ? a : `${c} ${a}`)).slice(0, 6);
    else {
      const gus = [...(cityAreas.get(c) ?? [])];
      cand.s.searchAreas = gus.length ? gus.slice(0, 5) : [c];
    }
  }

  // 점수화 → 정렬
  const scored = [...candMap.values()]
    .map((c) => ({ c, score: scoreCand(qTokens, c) }))
    .filter((x): x is { c: Cand; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c.s);

  // 핫플 우선 + 지역, label 기준 dedupe
  const seen = new Set<string>();
  const out: RegionSuggestion[] = [];
  for (const s of [...hot, ...scored]) {
    const k = noSpace(s.label);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= 8) break;
  }

  regionCache.set(key, out);
  return out;
}

// 동네 이름("대구 수성구 대흥동") → 동 대표 좌표. 실패 시 null.
export async function geocodeArea(area: string): Promise<{ lat: number; lng: number } | null> {
  try {
    await ensureKakaoMaps();
    const geocoder = new window.kakao.maps.services.Geocoder();
    const OK = window.kakao.maps.services.Status.OK;
    return await new Promise((resolve) => {
      geocoder.addressSearch(area, (res: any[], status: string) => {
        resolve(status === OK && res[0] ? { lat: parseFloat(res[0].y), lng: parseFloat(res[0].x) } : null);
      });
    });
  } catch {
    return null;
  }
}
