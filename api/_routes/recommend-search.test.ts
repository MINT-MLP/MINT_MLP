import { describe, it, expect } from 'vitest';
import { dongOf } from './recommend-search';

describe('dongOf', () => {
  it('지번 주소에서 동네명을 뽑는다', () => {
    expect(dongOf('서울 강남구 역삼동 858')).toBe('역삼동');
    expect(dongOf('서울 마포구 서교동')).toBe('서교동');
    expect(dongOf('서울 성동구 성수동1가 13-1')).toBe('성수동');
    expect(dongOf('경기 양평군 양평읍 양근리 1')).toBe('양평읍');
    expect(dongOf('')).toBe('');
  });
});
