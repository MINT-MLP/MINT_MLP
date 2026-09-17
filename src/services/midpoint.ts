import type { Coordinates, PresetRegion } from '@/types';

// 구형(球形) 지구 기준 두 좌표 간 직선거리 (km)
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 전국 주요 도시 (수도권 외)
const NATIONAL_AREAS: { name: string; lat: number; lng: number }[] = [
  // 제주
  { name: '제주시 연동',   lat: 33.4996, lng: 126.5312 },
  { name: '제주 애월',     lat: 33.4601, lng: 126.3124 },
  { name: '제주 중문',     lat: 33.2544, lng: 126.4120 },
  { name: '서귀포시',      lat: 33.2534, lng: 126.5600 },
  { name: '제주 성산',     lat: 33.4614, lng: 126.9199 },
  // 부산
  { name: '부산 해운대',   lat: 35.1631, lng: 129.1635 },
  { name: '부산 서면',     lat: 35.1579, lng: 129.0586 },
  { name: '부산 남포동',   lat: 35.0976, lng: 129.0319 },
  { name: '부산역',        lat: 35.1151, lng: 129.0424 },
  // 대구
  { name: '대구 동성로',   lat: 35.8714, lng: 128.5958 },
  { name: '대구 수성구',   lat: 35.8585, lng: 128.6313 },
  // 광주
  { name: '광주 상무지구', lat: 35.1544, lng: 126.8526 },
  { name: '광주 충장로',   lat: 35.1467, lng: 126.9157 },
  // 대전
  { name: '대전 둔산동',   lat: 36.3504, lng: 127.3845 },
  { name: '대전역',        lat: 36.3323, lng: 127.4343 },
  // 울산
  { name: '울산 삼산동',   lat: 35.5428, lng: 129.3320 },
  // 강원
  { name: '강릉 시내',     lat: 37.7519, lng: 128.8760 },
  { name: '춘천 명동',     lat: 37.8813, lng: 127.7298 },
  // 충청
  { name: '청주 성안길',   lat: 36.6424, lng: 127.4890 },
  // 전라
  { name: '전주 한옥마을', lat: 35.8150, lng: 127.1531 },
  // 경상
  { name: '경주 시내',     lat: 35.8562, lng: 129.2247 },
];

// 수도권 도심 상업지역만 포함 (도시화 낮은 지역 제외)
const METRO_AREAS: { name: string; lat: number; lng: number }[] = [
  // 서울
  { name: '강남 MICE 관광특구', lat: 37.5115, lng: 127.0595 },
  { name: '동대문 관광특구',     lat: 37.5700, lng: 127.0097 },
  { name: '명동',               lat: 37.5636, lng: 126.9869 },
  { name: '홍대입구역',          lat: 37.5573, lng: 126.9243 },
  { name: '이태원 관광특구',     lat: 37.5344, lng: 126.9942 },
  { name: '합정역',              lat: 37.5498, lng: 126.9137 },
  { name: '성수역',              lat: 37.5447, lng: 127.0557 },
  { name: '건대입구역',          lat: 37.5403, lng: 127.0699 },
  { name: '신촌·이대역',         lat: 37.5576, lng: 126.9368 },
  { name: '왕십리역',            lat: 37.5612, lng: 127.0383 },
  { name: '여의도',              lat: 37.5219, lng: 126.9245 },
  { name: '강남역',              lat: 37.4979, lng: 127.0276 },
  { name: '삼성역',              lat: 37.5088, lng: 127.0630 },
  { name: '역삼역',              lat: 37.5001, lng: 127.0366 },
  { name: '서울역',              lat: 37.5547, lng: 126.9707 },
  { name: '종각역',              lat: 37.5701, lng: 126.9823 },
  { name: '혜화역',              lat: 37.5822, lng: 127.0016 },
  { name: '한남·이태원',         lat: 37.5338, lng: 126.9976 },
  { name: '잠실 관광특구',       lat: 37.5131, lng: 127.1000 },
  { name: '북촌한옥마을',        lat: 37.5827, lng: 126.9845 },
  // 경기 남부 (상업 중심지만)
  { name: '수원역',              lat: 37.2660, lng: 127.0000 },
  { name: '수원 인계동',         lat: 37.2636, lng: 127.0286 },
  { name: '판교역',              lat: 37.3943, lng: 127.1108 },
  { name: '분당 서현역',         lat: 37.3838, lng: 127.1228 },
  { name: '성남 모란역',         lat: 37.4340, lng: 127.1290 },
  { name: '안양 범계역',         lat: 37.3934, lng: 126.9528 },
  // 경기 북부 (상업 중심지만)
  { name: '고양 정발산역',       lat: 37.6759, lng: 126.7716 },
  { name: '의정부역',            lat: 37.7381, lng: 127.0439 },
  // 경기 서부 / 인천
  { name: '부천 중동',           lat: 37.5033, lng: 126.7613 },
  { name: '인천 부평역',         lat: 37.4883, lng: 126.7238 },
];

const ALL_AREAS = [...METRO_AREAS, ...NATIONAL_AREAS];

// 서울 중심 기준점
const SEOUL_CENTER: Coordinates = { lat: 37.5665, lng: 126.9780 };

// 무게중심 스냅 임계값 —
//  · SNAP_HUB_KM: 무게중심이 최근접 상권에서 이 거리를 넘으면 '빈 구간'으로 보고 상권으로 스냅.
//  · EXPLAIN_HUB_KM: 스냅 사실을 토스트로 설명할 최소 거리(그 아래는 조용히 스냅만).
//  · FAR_WARNING_KM: 수도권 밖 인원 섞임 경고(의정부↔수원 52km까지는 정상 범위라 60으로 둔다).
const SNAP_HUB_KM = 3;
const EXPLAIN_HUB_KM = 5;
const FAR_WARNING_KM = 60;

// 후보 상권을 '공평함' 순으로 정렬 — 1순위는 '가장 멀리 오는 사람의 거리(minimax)'가 최소인 곳.
// 한 명이 유난히 멀어지는 걸 막는 게 핵심. 동률이면 총 이동거리로 결정론적 타이브레이크(테스트 고정).
// 상위 2곳을 호출부가 실측 대중교통 시간으로 다시 비교하므로(하이브리드), 단일 선택이 아니라 랭킹을 준다.
function rankHubsByFairness<T extends { lat: number; lng: number }>(
  candidates: T[],
  departures: Coordinates[],
): T[] {
  return candidates
    .map((c) => {
      const ds = departures.map((d) => haversineKm(d.lat, d.lng, c.lat, c.lng));
      return { c, mx: Math.max(...ds), sum: ds.reduce((s, v) => s + v, 0) };
    })
    .sort((a, b) => (a.mx !== b.mx ? a.mx - b.mx : a.sum - b.sum))
    .map((x) => x.c);
}


/**
 * 출발지들의 인원 산술평균을 중간지점으로 쓴다.
 *
 * 예전에는 볼록 껍질의 면적 무게중심(Shoelace)을 썼는데 두 가지가 틀렸다.
 * 첫째, 볼록 껍질은 안쪽에 있는 사람을 통째로 버린다 — 강남역·역삼·삼성·잠실·일산 5명이면
 * 껍질이 [일산, 강남역, 잠실]이라 역삼·삼성 두 명의 출발지는 계산에 한 글자도 안 들어간다.
 * 그 두 사람은 조건을 냈는데 위치는 없는 셈이 된다.
 * 둘째, 면적 무게중심은 사람 수를 세지 않는다. 3명이 강남, 1명이 홍대면 3:1인데 결과는 1:1이다.
 * 위 5명 예시에서 총 이동거리가 60.8km → 50.0km로 줄어든다.
 *
 * n이 3 이하면 두 방식의 결과가 원래 같다(2점은 중점, 삼각형은 무게중심=꼭짓점 평균).
 * 즉 이건 새로운 철학이 아니라, n이 4 이상일 때만 어긋나던 것을 원래 규칙에 맞춘 것이다.
 *
 * 추가 규칙(상권 스냅): 산술평균이 상권에서 SNAP_HUB_KM(3km) 넘게 떨어지면 — 즉 정중앙이 상권 없는
 * 빈 구간이면(예: 서울·소래·안산의 정중앙인 광명·시흥 부근) — 최근접 상권 5곳 중 minimax(가장 먼
 * 사람의 거리 최소)로 중간지점을 옮긴다. 안 그러면 서버가 그 빈 좌표 기준 거리순으로만 정렬해 결과가
 * 세 동네로 흩어지고, 화면에 뜬 지역명과도 어긋난다(부천으로 나온 사고의 원인). 출발지 1곳이면 스냅 안 함.
 */
export function findBalancedAreas(
  departures: Coordinates[],
  count = 3,
): {
  areas: string[];
  midpoint: Coordinates;
  areaName: string;
  compromiseMessage?: string;
  // 스냅이 일어났을 때만: 거리로 좁힌 상위 2개 상권 후보(호출부가 실측 대중교통 시간으로 최종 결정).
  snapHubs?: { name: string; lat: number; lng: number }[];
} {
  const fallback = { areas: ['명동', '홍대입구역', '강남역'], midpoint: SEOUL_CENTER, areaName: '서울 중심부' };
  if (departures.length === 0) return fallback;

  // 모든 출발지가 똑같이 한 표씩 — 안쪽에 있다는 이유로 빠지는 사람이 없어야 한다.
  const centroid = {
    lat: departures.reduce((s, p) => s + p.lat, 0) / departures.length,
    lng: departures.reduce((s, p) => s + p.lng, 0) / departures.length,
  };

  // 출발지 간 최대 직선거리
  let maxPairDist = 0;
  for (let i = 0; i < departures.length; i++) {
    for (let j = i + 1; j < departures.length; j++) {
      const d = haversineKm(departures[i].lat, departures[i].lng, departures[j].lat, departures[j].lng);
      if (d > maxPairDist) maxPairDist = d;
    }
  }

  // 무게중심에서 가장 가까운 상권 순으로 정렬
  const nearestToCentroid = ALL_AREAS
    .map((area) => ({ ...area, dist: haversineKm(centroid.lat, centroid.lng, area.lat, area.lng) }))
    .sort((a, b) => a.dist - b.dist);

  // 무게중심 ↔ 최근접 상권 거리. 크면 "산술 중앙이 상권 없는 빈 구간에 찍혔다"는 뜻 —
  // 그 좌표를 그대로 서버에 보내면 결과가 여러 동네로 흩어지고 화면 지역명과도 어긋난다.
  const hubGap = nearestToCentroid[0]?.dist ?? Infinity;

  // 빈 구간이면 무게중심을 '가장 공평한 실제 상권'(minimax)으로 스냅한다 — 유저는 아무것도 더 안 한다.
  // 출발지 1곳이면 스냅하지 않는다(혼자인데 10km 밖 상권으로 끌려가면 안 된다).
  let midpoint: Coordinates = centroid;
  let hub = nearestToCentroid[0];
  let snapHubs: { name: string; lat: number; lng: number }[] | undefined;
  if (departures.length >= 2 && hubGap > SNAP_HUB_KM && hub) {
    const ranked = rankHubsByFairness(nearestToCentroid.slice(0, 5), departures);
    hub = ranked[0];
    midpoint = { lat: hub.lat, lng: hub.lng };
    // 거리 기준 상위 2곳을 노출 → 호출부가 실측 대중교통 시간으로 타이브레이크(하이브리드).
    snapHubs = ranked.slice(0, 2).map((h) => ({ name: h.name, lat: h.lat, lng: h.lng }));
  }

  // 표시 지역명·검색 지역을 '스냅된' 중간지점 기준으로 산출 → 헤더 지역명 = 검색 지역 = 결과가 일치.
  const ranked = ALL_AREAS
    .map((area) => ({ ...area, dist: haversineKm(midpoint.lat, midpoint.lng, area.lat, area.lng) }))
    .sort((a, b) => a.dist - b.dist);
  const areas = ranked.slice(0, count).map((a) => a.name);
  const areaName = hub?.name ?? ranked[0]?.name ?? '알 수 없는 지역';

  // 두 종류의 안내(1곳일 땐 '공평'이 성립하지 않으므로 둘 다 뜨지 않는다):
  //  · maxPairDist > 60km — 수도권 밖 인원 섞임. 지역 직접 선택을 권함.
  //  · hubGap > 5km — 중앙에 상권이 없어 공평한 곳으로 옮겼다는 사실을 설명(부천/안양이 왜 나왔는지).
  //    3~5km는 체감 차이가 없어 조용히 스냅만 한다.
  const compromiseMessage = maxPairDist > FAR_WARNING_KM
    ? `출발지가 서로 ${Math.round(maxPairDist)}km나 떨어져 있어요. 그나마 공평한 ${areaName} 근처로 찾았는데, 다들 멀다면 지역을 직접 골라도 좋아요 📍`
    : (departures.length >= 2 && hubGap > EXPLAIN_HUB_KM)
      ? `딱 중간엔 마땅한 상권이 없어서, 모두에게 가장 공평한 ${areaName} 근처로 찾았어요 🧭`
      : undefined;

  return { areas, midpoint, areaName, compromiseMessage, snapHubs };
}

// 특정 좌표 근처 지역명 반환 — 전국 목록 사용
export function findNearestAreas(midpoint: Coordinates, count = 3): string[] {
  return ALL_AREAS
    .map((area) => ({
      name: area.name,
      dist: haversineKm(area.lat, area.lng, midpoint.lat, midpoint.lng),
    }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, count)
    .map((a) => a.name);
}

// 하위 호환용 (프리셋 등에서 사용)
export function calcMidpoint(coords: Coordinates[]): Coordinates {
  if (coords.length === 0) return { lat: 37.5665, lng: 126.9780 };
  return {
    lat: coords.reduce((s, c) => s + c.lat, 0) / coords.length,
    lng: coords.reduce((s, c) => s + c.lng, 0) / coords.length,
  };
}

// 직접 선택용 지역 프리셋

export const PRESET_REGIONS: PresetRegion[] = [
  { id: 'gangnam',        label: '강남/서초',   sublabel: '강남역·역삼·선릉',     midpoint: { lat: 37.4979, lng: 127.0276 } },
  { id: 'hongdae',        label: '홍대/마포',   sublabel: '홍대입구·합정·연남',   midpoint: { lat: 37.5535, lng: 126.9240 } },
  { id: 'itaewon',        label: '이태원/한남', sublabel: '이태원·경리단길·한남', midpoint: { lat: 37.5344, lng: 126.9942 } },
  { id: 'sinchon',        label: '신촌/연대',   sublabel: '신촌·이대·연남동',     midpoint: { lat: 37.5576, lng: 126.9368 } },
  { id: 'seongsu',        label: '성수/건대',   sublabel: '성수역·건대입구·뚝섬', midpoint: { lat: 37.5425, lng: 127.0628 } },
  { id: 'myeongdong',     label: '명동/시청',   sublabel: '명동·을지로·종각',     midpoint: { lat: 37.5636, lng: 126.9869 } },
  { id: 'jamsil',         label: '잠실/송파',   sublabel: '잠실역·잠실나루·석촌', midpoint: { lat: 37.5131, lng: 127.1000 } },
  { id: 'jongno',         label: '종로/혜화',   sublabel: '대학로·혜화·낙원동',   midpoint: { lat: 37.5822, lng: 127.0016 } },
  { id: 'yeouido',        label: '여의도',      sublabel: '여의도·영등포역',      midpoint: { lat: 37.5219, lng: 126.9245 } },
  { id: 'gyeonggi-south', label: '경기 남부',   sublabel: '수원·성남·판교',       midpoint: { lat: 37.3500, lng: 127.0500 } },
  { id: 'gyeonggi-north', label: '경기 북부',   sublabel: '고양·일산·의정부',     midpoint: { lat: 37.6600, lng: 126.8900 } },
  { id: 'incheon',        label: '인천/부천',   sublabel: '인천·부천·김포',       midpoint: { lat: 37.4900, lng: 126.7500 } },
];
