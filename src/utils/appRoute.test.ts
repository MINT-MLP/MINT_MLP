import { describe, it, expect } from 'vitest';
import { parseAppRoute, tabPath } from './appRoute';

describe('parseAppRoute', () => {
  it('홈 탭 세 화면', () => {
    expect(parseAppRoute('/app', '')).toMatchObject({ tab: 'home', home: 'hub' });
    expect(parseAppRoute('/app/recommend', '')).toMatchObject({ tab: 'home', home: 'recommend', fresh: null });
    expect(parseAppRoute('/app/recommend', '?new=group')).toMatchObject({ home: 'recommend', fresh: 'group' });
    expect(parseAppRoute('/app/recommend', '?new=x')).toMatchObject({ fresh: null });
    expect(parseAppRoute('/app/recommend', '?new=1')).toMatchObject({ fresh: 'start' });
    expect(parseAppRoute('/app/result', '?id=12')).toMatchObject({ home: 'result', resultId: 12 });
    expect(parseAppRoute('/app/result', '?id=abc')).toMatchObject({ home: 'result', resultId: null });
  });

  it('다른 탭과 옛 주소', () => {
    expect(parseAppRoute('/app/profile', '')).toMatchObject({ tab: 'profile' });
    expect(parseAppRoute('/app', '?tab=profile')).toMatchObject({ tab: 'profile' });
    expect(parseAppRoute('/app', '?grp=abcd1234')).toMatchObject({ tab: 'home', home: 'recommend' });
    expect(parseAppRoute('/app/unknown', '')).toMatchObject({ tab: 'home', home: 'hub' });
  });

  it('탭 주소', () => {
    expect(tabPath('home')).toBe('/app');
    expect(tabPath('shop')).toBe('/app/shop');
  });
});
