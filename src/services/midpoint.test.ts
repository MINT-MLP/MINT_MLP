import { describe, it, expect } from 'vitest';
import { findBalancedAreas, findNearestAreas, calcMidpoint } from '@/services/midpoint';

const GANGNAM = { lat: 37.4979, lng: 127.0276 };
const HONGDAE = { lat: 37.5573, lng: 126.9243 };
const SEONGSU = { lat: 37.5447, lng: 127.0557 };

describe('findBalancedAreas (중간지점 계산)', () => {
  it('출발지 0곳이면 서울 중심부 폴백', () => {
    const r = findBalancedAreas([]);
    expect(r.areaName).toBe('서울 중심부');
    expect(r.midpoint.lat).toBeCloseTo(37.5665, 3);
  });

  it('2명이면 선분의 정확한 중점', () => {
    const r = findBalancedAreas([GANGNAM, HONGDAE]);
    expect(r.midpoint.lat).toBeCloseTo((GANGNAM.lat + HONGDAE.lat) / 2, 6);
    expect(r.midpoint.lng).toBeCloseTo((GANGNAM.lng + HONGDAE.lng) / 2, 6);
  });

  it('3명이면 삼각형 무게중심(산술평균과 일치)', () => {
    const pts = [GANGNAM, HONGDAE, SEONGSU];
    const r = findBalancedAreas(pts);
    expect(r.midpoint.lat).toBeCloseTo(pts.reduce((s, p) => s + p.lat, 0) / 3, 5);
    expect(r.midpoint.lng).toBeCloseTo(pts.reduce((s, p) => s + p.lng, 0) / 3, 5);
  });

  it('일직선 좌표(면적 0)여도 NaN 없이 평균으로 폴백', () => {
    const collinear = [
      { lat: 37.5, lng: 127.0 },
      { lat: 37.6, lng: 127.0 },
      { lat: 37.7, lng: 127.0 },
    ];
    const r = findBalancedAreas(collinear);
    expect(Number.isFinite(r.midpoint.lat)).toBe(true);
    expect(r.midpoint.lng).toBeCloseTo(127.0, 6);
  });

  it('출발지가 150km 이상 떨어지면 보완 메시지 제공', () => {
    const seoul = { lat: 37.5665, lng: 126.978 };
    const busan = { lat: 35.1631, lng: 129.1635 };
    const r = findBalancedAreas([seoul, busan]);
    expect(r.compromiseMessage).toBeTruthy();
  });

  it('무게중심이 상권 없는 빈 구간이면 실제 상권으로 스냅하고 안내한다 (서울·소래·안산)', () => {
    const seoul = { lat: 37.5665, lng: 126.978 };
    const sorae = { lat: 37.4012, lng: 126.738 };   // 소래포구
    const ansan = { lat: 37.3219, lng: 126.8309 };  // 안산시청
    const r = findBalancedAreas([seoul, sorae, ansan]);
    // hubGap이 5km를 넘어 안내가 뜬다("왜 부천/안양?"의 설명)
    expect(r.compromiseMessage).toBeTruthy();
    // 표시 지역명 = 검색 지역 1순위 → 헤더·결과 정합성
    expect(r.areas[0]).toBe(r.areaName);
    // 중간지점이 산술평균이 아니라 실제 상권 좌표로 옮겨졌다
    const meanLat = (seoul.lat + sorae.lat + ansan.lat) / 3;
    const meanLng = (seoul.lng + sorae.lng + ansan.lng) / 3;
    expect(Math.abs(r.midpoint.lat - meanLat) + Math.abs(r.midpoint.lng - meanLng)).toBeGreaterThan(0.001);
  });

  it('출발지 1곳이면 스냅하지 않고 그 좌표를 그대로 쓴다(공평 안내도 없음)', () => {
    const sorae = { lat: 37.4012, lng: 126.738 }; // 상권에서 떨어진 단일 지점
    const r = findBalancedAreas([sorae]);
    expect(r.midpoint.lat).toBeCloseTo(sorae.lat, 6);
    expect(r.midpoint.lng).toBeCloseTo(sorae.lng, 6);
    expect(r.compromiseMessage).toBeFalsy();
  });

  it('수도권 시내 조합은 스냅하지 않고 산술평균을 유지한다(회귀 방지)', () => {
    const r = findBalancedAreas([GANGNAM, HONGDAE, SEONGSU]);
    const meanLat = (GANGNAM.lat + HONGDAE.lat + SEONGSU.lat) / 3;
    const meanLng = (GANGNAM.lng + HONGDAE.lng + SEONGSU.lng) / 3;
    expect(r.midpoint.lat).toBeCloseTo(meanLat, 5);
    expect(r.midpoint.lng).toBeCloseTo(meanLng, 5);
    expect(r.compromiseMessage).toBeFalsy();
  });
});

describe('findNearestAreas', () => {
  it('요청한 개수만큼 가까운 지역명을 반환', () => {
    const areas = findNearestAreas(GANGNAM, 3);
    expect(areas).toHaveLength(3);
    expect(areas[0]).toBe('강남역');
  });
});

describe('calcMidpoint (하위 호환)', () => {
  it('좌표 평균을 반환', () => {
    const r = calcMidpoint([GANGNAM, HONGDAE]);
    expect(r.lat).toBeCloseTo((GANGNAM.lat + HONGDAE.lat) / 2, 6);
  });
});
