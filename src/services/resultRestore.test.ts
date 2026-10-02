import { describe, it, expect, vi } from 'vitest';

vi.mock('@/services/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));

const { inputsFromPayload } = await import('./resultRestore');

const base = {
  recommendationId: 1, ownerIsMember: true, slots: [], center: null,
  condition: { id: 1, mode: 'solo', group_size: '3~4명', first_purpose: '밥', second_purpose: '술', area_type: 'auto' as const, area_label: '성수', area_query: null },
};

describe('inputsFromPayload', () => {
  it('선택지 코드는 분위기·조건으로, 직접 입력·키워드는 키워드로', () => {
    const r = inputsFromPayload({
      ...base,
      detail: {
        createdAt: '2026-10-02T00:00:00Z', relation: '친구들', occasion: null, budget: '2~4만원',
        firstCategoryPath: '한식', secondCategoryPath: null, regionLevel: null, menus: [],
        choices: [
          { course: 'first', code: 'atm_quiet', kind: 'mood', label: '조용하게' },
          { course: 'second', code: 'pref_view', kind: 'pref', label: '뷰 좋은 곳' },
          { course: 'all', code: 'pref_parking', kind: 'condition', label: '주차 가능' },
          { course: 'all', code: 'kw:노포', kind: 'keyword', label: '노포' },
          { course: 'first', code: null, kind: null, label: '창가' },
        ],
        origins: [{ query: '합정역', kakaoPlaceId: '1' }],
      },
    });
    expect(r.vibe['분위기'].first).toEqual(['atm_quiet']);
    expect(r.vibe['취향'].second).toEqual(['pref_view']);
    expect(r.conditions).toEqual(['pref_parking']);
    expect(r.keywords).toEqual(['노포', '창가']);
    expect(r.purpose).toMatchObject({ first: '밥', firstRaw: '밥', firstGenre: '한식', second: '술', secondRaw: '술', relation: '친구들' });
    expect(r.budget).toBe('2~4만원');
    expect(r.groupSize).toBe('3~4명');
    expect(r.origins).toEqual([{ query: '합정역', kakaoPlaceId: '1' }]);
  });

  it('메뉴 콕은 메뉴를 쉼표로, 2차 없음은 "없음"으로', () => {
    const r = inputsFromPayload({
      ...base,
      condition: { ...base.condition, first_purpose: '메뉴', second_purpose: null },
      detail: {
        createdAt: '', relation: null, occasion: null, budget: null, firstCategoryPath: null, secondCategoryPath: null, regionLevel: null,
        menus: [{ course: 'first', ord: 1, menu: '회&초밥' }, { course: 'first', ord: 2, menu: '피자' }],
        choices: [], origins: [],
      },
    });
    expect(r.purpose).toMatchObject({ first: '회&초밥,피자', firstRaw: '기타', second: '없음', secondRaw: '없음' });
  });
});
