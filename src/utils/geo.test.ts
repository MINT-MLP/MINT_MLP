import { describe, it, expect } from 'vitest';
import { walkingMinutes } from './geo';

describe('walkingMinutes', () => {
  it('직선거리를 시속 4km로', () => {
    // 위도 0.009도 ≈ 1km → 15분
    expect(walkingMinutes({ lat: 37.5, lng: 127 }, { lat: 37.509, lng: 127 })).toBe(15);
  });

  it('좌표가 없으면 null', () => {
    expect(walkingMinutes({ lat: 37.5, lng: 127 }, { lat: null, lng: 127 })).toBe(null);
    expect(walkingMinutes(undefined, { lat: 37.5, lng: 127 })).toBe(null);
  });
});
