import type { Coordinates, LocationEntry, MeetingLocation, PlaceRecommendation, PurposeValue, RegionScope, ResultSnapshotV2, VibeState } from '@/types';
import { fetchRecPayload, restoreRecPayload, orderedSlots, type RecPayload } from '@/services/recRestore';
import { slotSource } from '@/services/memberData';
import { kakaoPlaceLink, resolveCenter, defaultRestoreDeps, type RestoredPlace } from '@/services/restore';
import { areaCoords, findNearestAreas, PRESET_REGIONS } from '@/services/midpoint';
import { GROUPS, CONDITION_OPTIONS } from '@/constants/vibeOptions';
import { SEOUL_CENTER } from '@/constants/geo';
import { walkingMinutes } from '@/utils/geo';

// 결과 화면 새로고침 복원(10-01). 폰엔 추천 ID와 화면 상태만 있고, 가게는 서버 슬롯 → 카카오 재검색으로 채운다.
// 모델이 쓴 설명·가격대·태그는 저장하지 않으므로 복원된 화면엔 없다.

// 만날 장소에서 좌표를 뺀다(폰 저장용). 복원 때 검색 중심으로 다시 채운다.
export function stripMeetingLocation(loc: MeetingLocation | null | undefined): MeetingLocation | undefined {
  if (!loc) return undefined;
  if (loc.type === 'auto') return loc;
  return { type: 'manual', regionId: loc.regionId, area: loc.area, ...(loc.scope ? { scope: loc.scope } : {}) };
}

const NOT_FOUND = '가게 정보를 다시 찾지 못했어요';

function toPlace(p: RecPayload, slotId: number, placeId: string, r: RestoredPlace | null | undefined, claimToken?: string): PlaceRecommendation {
  const slot = p.slots.find((s) => s.id === slotId)!;
  return {
    placeName: r?.name ?? NOT_FOUND,
    category: r?.category ?? '',
    description: '',
    priceRange: '',
    vibeTags: [],
    address: r?.address ?? '',
    area: p.condition.area_label,
    lat: r?.lat,
    lng: r?.lng,
    kakaoPlaceId: placeId,
    kakaoPlaceUrl: r?.url ?? kakaoPlaceLink(placeId),
    record: {
      slotId,
      conditionId: p.condition.id,
      recommendationId: p.recommendationId,
      course: slot.course,
      search: slotSource(slot),
      member: p.ownerIsMember,
      ...(!p.ownerIsMember && claimToken ? { claimToken } : {}),
    },
  };
}

// 추천 API 응답과 같은 순서로: 2코스면 [1차 대표, 2차 대표, 1차 대안…, 2차 대안…], 1코스면 [대표, 대안…]
export function placesFromPayload(
  p: RecPayload, restored: Map<number, RestoredPlace | null>, claimToken?: string,
): { places: PlaceRecommendation[]; twoCourses: boolean } {
  const slots = orderedSlots(p.slots);
  const pick = (course: 'first' | 'second', role: 'main' | 'alt') => slots.filter((s) => s.course === course && s.role === role);
  const firstMain = pick('first', 'main');
  const secondMain = pick('second', 'main');
  const twoCourses = secondMain.length > 0;
  const ordered = twoCourses
    ? [...firstMain, ...secondMain, ...pick('first', 'alt'), ...pick('second', 'alt')]
    : [...firstMain, ...pick('first', 'alt')];
  const places = ordered.map((s, i) => ({ ...toPlace(p, s.id, s.kakao_place_id, restored.get(s.id), claimToken), rank: i + 1 }));
  if (twoCourses) {
    const w = walkingMinutes(places[0], places[1]);
    if (w != null) places[0] = { ...places[0], walkingToNext: w };
  }
  return { places, twoCourses };
}

export interface RestoredResult {
  places: PlaceRecommendation[];
  secondMissing: boolean;
  midpointData: { midpoint: Coordinates; areaName: string; nearestAreas: string[]; scope?: RegionScope | null };
  meetingLocation?: MeetingLocation;
}

export async function restoreResultSnapshot(snap: ResultSnapshotV2, prefetched?: RecPayload): Promise<RestoredResult> {
  const p = prefetched ?? await fetchRecPayload({ kind: 'own', recommendationId: snap.recommendationId, claimToken: snap.claimToken });
  const restored = await restoreRecPayload(p);
  const { places, twoCourses } = placesFromPayload(p, restored, snap.claimToken);
  if (places.length === 0) throw new Error('no places');

  // 다시 추천받기에 쓸 검색 중심. 서버가 준 것(자동·프리셋) → 없으면 지역 검색어로 → 그래도 없으면 상권 좌표.
  let center: Coordinates | null = p.center;
  if (!center) {
    center = await resolveCenter({
      area_type: p.condition.area_type, area_label: p.condition.area_label, area_query: p.condition.area_query, origins: [],
    }, await defaultRestoreDeps());
  }
  const midpoint = center ?? areaCoords(snap.areaName) ?? SEOUL_CENTER;

  const loc = snap.meetingLocation;
  const scope: RegionScope | null = loc?.type === 'manual' && loc.scope
    ? { level: loc.scope.level, matchTokens: loc.scope.matchTokens, centerLat: midpoint.lat, centerLng: midpoint.lng }
    : null;
  const meetingLocation: MeetingLocation | undefined = loc?.type === 'manual' && !areaCoords(loc.area)
    ? { ...loc, lat: midpoint.lat, lng: midpoint.lng }
    : loc;

  const wantedSecond = !!(snap.purpose?.second && snap.purpose.second !== '없음');
  return {
    places,
    secondMissing: wantedSecond && !twoCourses,
    midpointData: {
      midpoint,
      areaName: snap.areaName,
      nearestAreas: snap.nearestAreas.length ? snap.nearestAreas : findNearestAreas(midpoint, 3),
      scope,
    },
    meetingLocation,
  };
}

// ── 지난 추천을 결과 화면으로 ── 회원 본인 추천만. 결과와 함께 "이 조건으로 다시 추천받기"에 쓸 입력을 되살린다.
export interface PastInputs {
  purpose: PurposeValue;
  vibe: VibeState;
  conditions: string[];
  keywords: string[];
  budget: string | null;
  groupSize: '2명' | '3~4명' | '5명 이상';
  meetingLocation: MeetingLocation;
  origins: { query: string; kakaoPlaceId: string }[];
}

export interface PastResult {
  restored: RestoredResult;
  inputs: PastInputs;
  createdAt: string;
  areaLabel: string;
}

const GROUP_OF = new Map(GROUPS.flatMap((g) => g.options.map((o) => [o.key, g.label] as const)));
const CONDITION_KEYS = new Set(CONDITION_OPTIONS.map((o) => o.key));
const GROUP_SIZES = new Set(['2명', '3~4명', '5명 이상']);

// 저장된 조건 → 입력 화면 상태. 선택지 코드는 화면 키라 그대로 쓰고, 목록에 없던 직접 입력은 키워드로 돌린다.
export function inputsFromPayload(p: RecPayload): Omit<PastInputs, 'meetingLocation'> {
  const d = p.detail;
  const menus = (course: 'first' | 'second') => (d?.menus ?? []).filter((m) => m.course === course).map((m) => m.menu).join(',');
  const c = p.condition;
  const first = c.first_purpose === '메뉴' ? { first: menus('first') || null, firstRaw: '기타' as const, firstGenre: null }
    : { first: c.first_purpose, firstRaw: c.first_purpose as PurposeValue['firstRaw'], firstGenre: d?.firstCategoryPath ?? null };
  const second = !c.second_purpose ? { second: '없음', secondRaw: '없음' as const, secondGenre: null }
    : c.second_purpose === '메뉴' ? { second: menus('second') || null, secondRaw: '기타' as const, secondGenre: null }
    : { second: c.second_purpose, secondRaw: c.second_purpose as PurposeValue['secondRaw'], secondGenre: d?.secondCategoryPath ?? null };

  const vibe: VibeState = {};
  const conditions: string[] = [];
  const keywords: string[] = [];
  for (const ch of d?.choices ?? []) {
    const group = ch.code ? GROUP_OF.get(ch.code) : undefined;
    if (ch.code && group && ch.course !== 'all') {
      const g = (vibe[group] ??= { first: [], second: [] });
      g[ch.course].push(ch.code);
    } else if (ch.code && CONDITION_KEYS.has(ch.code)) {
      conditions.push(ch.code);
    } else if (!keywords.includes(ch.label)) {
      keywords.push(ch.label);
    }
  }
  return {
    purpose: { ...first, ...second, relation: d?.relation ?? null, occasion: d?.occasion ?? null },
    vibe, conditions, keywords,
    budget: d?.budget ?? null,
    groupSize: GROUP_SIZES.has(c.group_size) ? c.group_size as PastInputs['groupSize'] : '2명',
    origins: d?.origins ?? [],
  };
}

export async function restorePastResult(recommendationId: number): Promise<PastResult> {
  const p = await fetchRecPayload({ kind: 'own', recommendationId });
  const base = inputsFromPayload(p);
  const c = p.condition;

  // 만날 장소: 프리셋은 우리 상수, 직접 입력 지역은 저장한 검색어로 다시 찾아 범위(시·구·동)까지 되살린다
  let meetingLocation: MeetingLocation = { type: 'auto' };
  let nearestAreas: string[] = [];
  if (c.area_type === 'preset') {
    const r = PRESET_REGIONS.find((x) => x.label === c.area_label);
    meetingLocation = { type: 'manual', regionId: r?.id ?? '', area: c.area_label };
  } else if (c.area_type === 'region') {
    const deps = await defaultRestoreDeps();
    const hit = (await deps.searchRegions(c.area_query || c.area_label).catch(() => [])).find((x) => x.label === c.area_label);
    meetingLocation = hit
      ? { type: 'manual', regionId: '', area: hit.label, lat: hit.lat, lng: hit.lng, scope: { level: hit.level, matchTokens: hit.matchTokens, searchAreas: hit.searchAreas, query: c.area_query || hit.query } }
      : { type: 'manual', regionId: '', area: c.area_label };
    nearestAreas = hit?.searchAreas ?? [];
  }

  const snap: ResultSnapshotV2 = {
    v: 2, recommendationId, resultSecondMissing: false,
    purpose: base.purpose, meetingLocation, origins: base.origins,
    areaName: c.area_label, nearestAreas,
  };
  const restored = await restoreResultSnapshot(snap, p);
  return { restored, inputs: { ...base, meetingLocation: restored.meetingLocation ?? meetingLocation }, createdAt: p.detail?.createdAt ?? '', areaLabel: c.area_label };
}

// ── 입력 초안·그룹 세션 복원 ── 저장본엔 좌표·지명이 없어 다시 찾는다.

// 직접 입력 지역: 저장한 검색어로 지역을 다시 찾아 라벨이 같은 제안의 좌표를 넣는다. 프리셋은 좌표가 우리 상수라 그대로.
export async function resolveMeetingLocation(loc: MeetingLocation): Promise<MeetingLocation> {
  if (loc.type !== 'manual' || loc.lat != null || areaCoords(loc.area)) return loc;
  try {
    const deps = await defaultRestoreDeps();
    const list = await deps.searchRegions(loc.scope?.query || loc.area);
    const hit = list.find((s) => s.label === loc.area);
    return hit ? { ...loc, lat: hit.lat, lng: hit.lng } : loc;
  } catch {
    return loc;
  }
}

// 출발지: 사용자가 친 검색어로 다시 검색해 같은 장소 ID를 찾는다. 못 찾은 곳은 빠진다(다시 고르게).
export async function resolveOrigins(saved: { query: string; kakaoPlaceId: string }[]): Promise<LocationEntry[]> {
  const deps = await defaultRestoreDeps();
  const found = await Promise.all(saved.map(async (o) => {
    try {
      const p = (await deps.searchKeyword(o.query)).find((x) => x.id === o.kakaoPlaceId);
      return p ? { name: p.place_name, lat: parseFloat(p.y), lng: parseFloat(p.x), query: o.query, kakaoPlaceId: p.id } : null;
    } catch {
      return null;
    }
  }));
  return found.filter((x): x is NonNullable<typeof x> => !!x);
}

// 그룹 호스트 폴링(3초)용 — 같은 참여자를 매번 다시 찾지 않게 메모리에 둔다. 못 찾은 건 다음 폴링에 다시 시도
const originCache = new Map<string, Promise<LocationEntry | null>>();
export function resolveOriginCached(query: string, kakaoPlaceId: string): Promise<LocationEntry | null> {
  const k = `${query}\u0000${kakaoPlaceId}`;
  let p = originCache.get(k);
  if (!p) {
    p = resolveOrigins([{ query, kakaoPlaceId }]).then((l) => l[0] ?? null, () => null);
    originCache.set(k, p);
    void p.then((v) => { if (!v) originCache.delete(k); });
  }
  return p;
}

// 저장용: 출발지는 검색어·ID만
export function stripOrigins(list: LocationEntry[]): { query: string; kakaoPlaceId: string }[] {
  return list
    .filter((l): l is LocationEntry & { query: string; kakaoPlaceId: string } => !!l.query && !!l.kakaoPlaceId)
    .map((l) => ({ query: l.query, kakaoPlaceId: l.kakaoPlaceId }));
}
