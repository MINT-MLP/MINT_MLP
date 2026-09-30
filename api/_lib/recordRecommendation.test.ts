import { describe, it, expect } from 'vitest';
import { buildSavePayload, slotsFromRanks, type SearchSource } from './recordRecommendation';

const src = (q: string): SearchSource => ({ kind: 'keyword', query: q, page: 1, radius: 3000 });

describe('slotsFromRanks', () => {
  it('2코스: 1·2위는 대표, 나머지는 코스별 대안 순서', () => {
    const places = [
      { rank: 1, kakaoPlaceId: 'a', purposeSlot: 1 },
      { rank: 2, kakaoPlaceId: 'b', purposeSlot: 2 },
      { rank: 3, kakaoPlaceId: 'c', purposeSlot: 1 },
      { rank: 4, kakaoPlaceId: 'd', purposeSlot: 1 },
      { rank: 5, kakaoPlaceId: 'e', purposeSlot: 2 },
    ];
    const slots = slotsFromRanks(places, true, (id) => src(id));
    expect(slots.map((s) => `${s.kakaoPlaceId}:${s.course}:${s.role}:${s.rank}`)).toEqual([
      'a:first:main:1', 'b:second:main:1', 'c:first:alt:1', 'd:first:alt:2', 'e:second:alt:1',
    ]);
  });

  it('1코스: 1위만 대표, 출처 없는 장소는 뺀다', () => {
    const places = [
      { rank: 2, kakaoPlaceId: 'b', purposeSlot: 1 },
      { rank: 1, kakaoPlaceId: 'a', purposeSlot: 1 },
      { rank: 3, kakaoPlaceId: 'x', purposeSlot: 1 },
    ];
    const slots = slotsFromRanks(places, false, (id) => (id === 'x' ? undefined : src(id)));
    expect(slots.map((s) => `${s.kakaoPlaceId}:${s.role}:${s.rank}`)).toEqual(['a:main:1', 'b:alt:1']);
  });
});

describe('buildSavePayload', () => {
  const base = {
    groupSize: '3~4명',
    purpose: { first: '보쌈,회&초밥', second: '술', firstGenre: null, secondGenre: '술집 > 와인바' },
    vibe: { first: ['조용하게', '주차 가능'], second: ['감성적인'] },
    relation: '연인',
    occasion: '기념일',
    budget: '2~4만원',
    keywords: ['루프탑', '콜키지'],
  };

  it('메뉴 콕은 목적 "메뉴" + 메뉴 행으로, 2차 목적은 그대로', () => {
    const p = buildSavePayload({ userId: 'u1', input: base, save: { mode: 'solo' }, areaFallback: '성수역', slots: [] });
    const c = p.condition as Record<string, unknown>;
    expect(c.first_purpose).toBe('메뉴');
    expect(c.second_purpose).toBe('술');
    expect(c.second_category_path).toBe('술집 > 와인바');
    expect(p.menus).toEqual([
      { course: 'first', ord: 1, menu: '보쌈' },
      { course: 'first', ord: 2, menu: '회&초밥' },
    ]);
  });

  it('허용 목록 밖 값은 비우거나 기본값', () => {
    const p = buildSavePayload({
      userId: null,
      input: { ...base, groupSize: 7, relation: '동료', budget: '10만원', purpose: { first: '밥', second: '없음' } },
      save: { areaType: 'weird', areaLabel: '' },
      areaFallback: '강남역',
      slots: [],
    });
    const c = p.condition as Record<string, unknown>;
    expect(c.group_size).toBe('5명 이상');
    expect(c.relation).toBeNull();
    expect(c.budget).toBeNull();
    expect(c.second_purpose).toBeNull();
    expect(c.area_type).toBe('auto');
    expect(c.area_label).toBe('강남역');
  });

  it('출발지는 회원·혼자 모드에서만, 장소 ID가 숫자일 때만', () => {
    const origins = [{ query: '성수', kakaoPlaceId: '21160631' }, { query: '합정', kakaoPlaceId: 'x1' }];
    const member = buildSavePayload({ userId: 'u1', input: base, save: { mode: 'solo', origins }, areaFallback: '', slots: [] });
    expect(member.origins).toEqual([{ ord: 1, query: '성수', kakao_place_id: '21160631' }]);
    const guest = buildSavePayload({ userId: null, input: base, save: { mode: 'solo', origins }, areaFallback: '', slots: [] });
    expect(guest.origins).toEqual([]);
    const group = buildSavePayload({ userId: 'u1', input: base, save: { mode: 'group', origins }, areaFallback: '', slots: [] });
    expect(group.origins).toEqual([]);
  });

  it('직접 입력 지역은 검색어와 단위를 남기고, 다른 방식은 비운다', () => {
    const region = buildSavePayload({
      userId: 'u1', input: base,
      save: { areaType: 'region', areaLabel: '인천 미추홀구', areaQuery: '미추홀', regionLevel: 'district' },
      areaFallback: '', slots: [],
    });
    expect(region.condition).toMatchObject({ area_type: 'region', area_query: '미추홀', region_level: 'gu' });
    const preset = buildSavePayload({
      userId: 'u1', input: base, save: { areaType: 'preset', areaLabel: '성수/건대', areaQuery: 'x', regionLevel: 'dong' },
      areaFallback: '', slots: [],
    });
    expect(preset.condition).toMatchObject({ area_type: 'preset', area_query: null, region_level: null });
  });

  it('선택지: 분위기는 코스별, 키워드는 all', () => {
    const p = buildSavePayload({ userId: null, input: base, save: {}, areaFallback: '', slots: [] });
    expect(p.choices).toEqual([
      { course: 'first', label: '조용하게', kind: 'vibe' },
      { course: 'first', label: '주차 가능', kind: 'vibe' },
      { course: 'second', label: '감성적인', kind: 'vibe' },
      { course: 'all', label: '루프탑', kind: 'keyword' },
      { course: 'all', label: '콜키지', kind: 'keyword' },
    ]);
  });

  it('재추천 사유는 정해진 값만', () => {
    const p = buildSavePayload({ userId: 'u1', input: base, save: { retriedFromId: 12, retryReason: 'far' }, areaFallback: '', slots: [] });
    expect(p.recommendation).toMatchObject({ retried_from_id: 12, retry_reason: 'far' });
    const bad = buildSavePayload({ userId: 'u1', input: base, save: { retriedFromId: '12', retryReason: 'retry' }, areaFallback: '', slots: [] });
    expect(bad.recommendation).toMatchObject({ retried_from_id: null, retry_reason: null });
  });
});

describe('newClaimToken', () => {
  it('토큰마다 다르고, 해시는 sha256 hex 64자', async () => {
    const { newClaimToken } = await import('./recordRecommendation');
    const { createHash } = await import('node:crypto');
    const a = newClaimToken();
    const b = newClaimToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(createHash('sha256').update(a.token, 'utf8').digest('hex'));
  });
});
