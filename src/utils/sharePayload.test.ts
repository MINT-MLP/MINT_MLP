import { describe, it, expect } from 'vitest';
import { safeKakaoPlaceUrl, sanitizeSnapshot } from './sharePayload';

describe('safeKakaoPlaceUrl', () => {
  it('카카오 장소 페이지만 통과', () => {
    expect(safeKakaoPlaceUrl('http://place.map.kakao.com/12345')).toBe('http://place.map.kakao.com/12345');
    expect(safeKakaoPlaceUrl('https://map.kakao.com/link/map/a,1,2')).toBe('https://map.kakao.com/link/map/a,1,2');
    expect(safeKakaoPlaceUrl('javascript:alert(1)')).toBeNull();
    expect(safeKakaoPlaceUrl('https://evil.com/?map.kakao.com/')).toBeNull();
    expect(safeKakaoPlaceUrl(123)).toBeNull();
  });
});

describe('sanitizeSnapshot', () => {
  it('first가 없으면 null', () => {
    expect(sanitizeSnapshot({})).toBeNull();
    expect(sanitizeSnapshot({ first: { placeName: '' } })).toBeNull();
    expect(sanitizeSnapshot(null)).toBeNull();
  });

  it('candidates가 배열이 아니면 버리고, 원소는 n이 문자열인 것만', () => {
    expect(sanitizeSnapshot({ first: { placeName: 'A' }, candidates: 'x' })?.candidates).toBeUndefined();
    const r = sanitizeSnapshot({ first: { placeName: 'A' }, candidates: [{ n: 'B', s: 80 }, null, { n: 3 }, { n: 'C', s: 'x' }] });
    expect(r?.candidates).toEqual([{ n: 'B', c: undefined, s: 80 }, { n: 'C', c: undefined, s: null }]);
  });

  it('위험한 링크와 잘못된 필드를 정리한다', () => {
    const r = sanitizeSnapshot({
      first: { placeName: 'A', kakaoPlaceUrl: 'javascript:alert(1)', vibeTags: ['t', 1], lat: '37', imageUrl: 'http://x' },
      second: { nope: true },
    });
    expect(r?.first.kakaoPlaceUrl).toBeNull();
    expect(r?.first.vibeTags).toEqual(['t']);
    expect(r?.first.lat).toBeNull();
    expect(r?.first.imageUrl).toBeNull();
    expect(r?.second).toBeNull();
  });
});
