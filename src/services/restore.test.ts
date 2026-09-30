import { describe, it, expect, vi } from 'vitest';
import { resolveCenter, findById, type RestoreDeps, type StoredCondition } from './restore';
import type { KakaoPlace } from '@/types';

const place = (id: string, x = '127.0', y = '37.5'): KakaoPlace => ({
  id, place_name: `가게${id}`, category_name: '음식점 > 한식 > 국밥', address_name: '서울 성동구 성수동1가 1',
  road_address_name: '서울 성동구 성수이로 1', phone: '', place_url: `http://place.map.kakao.com/${id}`, x, y,
});

function deps(over: Partial<RestoreDeps> = {}): RestoreDeps {
  return {
    searchPage: vi.fn(async () => []),
    searchKeyword: vi.fn(async () => []),
    searchRegions: vi.fn(async () => []),
    areaCoords: vi.fn((name: string) => (name === '성수/건대' || name === '강남역' ? { lat: 1, lng: 2 } : null)),
    balance: vi.fn(() => ({ midpoint: { lat: 9, lng: 9 } })),
    ...over,
  };
}

const cond = (c: Partial<StoredCondition>): StoredCondition => ({
  area_type: 'auto', area_label: '강남역', area_query: null, origins: [], ...c,
});

describe('resolveCenter', () => {
  it('지역 바로가기는 우리 좌표', async () => {
    expect(await resolveCenter(cond({ area_type: 'preset', area_label: '성수/건대' }), deps())).toEqual({ lat: 1, lng: 2 });
  });

  it('직접 입력은 같은 검색어로 찾아 라벨이 같은 제안의 좌표', async () => {
    const d = deps({
      searchRegions: vi.fn(async () => [
        { label: '다른 곳', lat: 0, lng: 0 },
        { label: '인천 미추홀구', lat: 37.4, lng: 126.6 },
      ] as never),
    });
    expect(await resolveCenter(cond({ area_type: 'region', area_label: '인천 미추홀구', area_query: '미추홀' }), d))
      .toEqual({ lat: 37.4, lng: 126.6 });
    expect(d.searchRegions).toHaveBeenCalledWith('미추홀');
  });

  it('직접 입력: 라벨이 같은 제안이 없으면 엉뚱한 중심 대신 null', async () => {
    const d = deps({ searchRegions: vi.fn(async () => [{ label: '다른 곳', lat: 0, lng: 0 }] as never) });
    expect(await resolveCenter(cond({ area_type: 'region', area_label: '인천 미추홀구', area_query: '미추홀' }), d)).toBeNull();
  });

  it('자동: 출발지를 모두 찾으면 중간점, 상권으로 옮겨졌던 경우는 상권 좌표', async () => {
    const origins = [{ ord: 1, query: '성수', kakao_place_id: '1' }, { ord: 2, query: '합정', kakao_place_id: '2' }];
    const found = deps({ searchKeyword: vi.fn(async (q: string) => [place(q === '성수' ? '1' : '2')]) });
    expect(await resolveCenter(cond({ origins }), found)).toEqual({ lat: 9, lng: 9 });

    const snapped = deps({
      searchKeyword: vi.fn(async (q: string) => [place(q === '성수' ? '1' : '2')]),
      balance: vi.fn(() => ({ midpoint: { lat: 9, lng: 9 }, snapHubs: [{}, {}] })),
    });
    expect(await resolveCenter(cond({ origins }), snapped)).toEqual({ lat: 1, lng: 2 });
  });

  it('자동: 출발지를 하나라도 못 찾거나 없으면 상권 좌표로 근사', async () => {
    const origins = [{ ord: 1, query: '성수', kakao_place_id: '1' }, { ord: 2, query: '폐업역', kakao_place_id: '404' }];
    const d = deps({ searchKeyword: vi.fn(async (q: string) => (q === '성수' ? [place('1')] : [])) });
    expect(await resolveCenter(cond({ origins }), d)).toEqual({ lat: 1, lng: 2 });
    expect(await resolveCenter(cond({ origins: [] }), deps())).toEqual({ lat: 1, lng: 2 });
  });
});

describe('findById', () => {
  const src = { kind: 'keyword' as const, query: '성수 국밥', page: 2, radius: 3000 };
  const full = (ids: string[]) => ids.map((id) => place(id));
  const fifteen = (prefix: string) => Array.from({ length: 15 }, (_, i) => `${prefix}${i}`);

  it('기록한 페이지에서 찾으면 그 가게 정보', async () => {
    const searchPage = vi.fn(async () => full(['x', 'target']));
    const r = await findById('target', src, { lat: 37.5, lng: 127 }, { searchPage });
    expect(r?.name).toBe('가게target');
    expect(r?.category).toBe('한식 > 국밥');
    expect(searchPage).toHaveBeenCalledWith('keyword', '성수 국밥', { x: 127, y: 37.5, radius: 3000, page: 2 });
  });

  it('밀렸으면 다음 페이지, 당겨졌으면 이전 페이지까지 본다', async () => {
    const byPage: Record<number, string[]> = { 1: [...fifteen('a'), 'target'].slice(0, 15), 2: fifteen('b'), 3: ['c1'] };
    byPage[1] = [...fifteen('a').slice(0, 14), 'target'];
    const searchPage = vi.fn(async (_k: unknown, _q: unknown, o: { page: number }) => full(byPage[o.page] ?? []));
    const r = await findById('target', src, { lat: 0, lng: 0 }, { searchPage });
    expect(r?.id).toBe('target');
    expect(searchPage.mock.calls.map((c) => (c[2] as { page: number }).page)).toEqual([2, 3, 1]);
  });

  it('마지막 페이지를 넘으면 더 뒤는 보지 않고, 없으면 null', async () => {
    const searchPage = vi.fn(async (_k: unknown, _q: unknown, o: { page: number }) => (o.page === 2 ? full(['only']) : full(fifteen('z'))));
    const r = await findById('target', src, { lat: 0, lng: 0 }, { searchPage });
    expect(r).toBeNull();
    expect(searchPage.mock.calls.map((c) => (c[2] as { page: number }).page)).toEqual([2, 1]);
  });
});
