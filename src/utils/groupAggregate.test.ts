import { describe, it, expect } from 'vitest';
import { aggregateVibe, aggregatePurpose, aggregateBudget, splitMemberKeywords, EXCLUDE_FOOD_PREFIX, SECOND_VIBE_PREFIX } from '@/utils/groupAggregate';
import type { GroupMember } from '@/types';

function member(keywords: string[]): GroupMember {
  return {
    member_name: 'x', location_name: 'y', location_lat: 37.5, location_lng: 127,
    vibe_atmosphere: null, vibe_budget: null, vibe_keywords: keywords,
  };
}

describe('splitMemberKeywords', () => {
  it('편식 접두사 항목을 일반 키워드와 분리한다', () => {
    const { keywords, excludeFoods } = splitMemberKeywords([
      member(['단체룸', `${EXCLUDE_FOOD_PREFIX}회`]),
      member([`${EXCLUDE_FOOD_PREFIX}오이`, '주차가능']),
    ]);
    expect(keywords).toEqual(['단체룸', '주차가능']);
    expect(excludeFoods).toEqual(['회', '오이']);
  });

  it('전원 합집합 — 중복 편식은 하나로 합친다', () => {
    const { excludeFoods } = splitMemberKeywords([
      member([`${EXCLUDE_FOOD_PREFIX}곱창`]),
      member([`${EXCLUDE_FOOD_PREFIX}곱창`, `${EXCLUDE_FOOD_PREFIX}매운 음식`]),
    ]);
    expect(excludeFoods).toEqual(['곱창', '매운 음식']);
  });

  it('키워드가 없는 멤버·빈 접두사 항목은 무시한다', () => {
    const noKw = member([]);
    delete (noKw as Partial<GroupMember>).vibe_keywords;
    const { keywords, excludeFoods } = splitMemberKeywords([noKw, member([EXCLUDE_FOOD_PREFIX])]);
    expect(keywords).toEqual([]);
    expect(excludeFoods).toEqual([]);
  });

  it('2차 분위기 접두사 항목은 일반 키워드에서 제외한다', () => {
    const { keywords } = splitMemberKeywords([
      member(['단체룸', `${SECOND_VIBE_PREFIX}atm_quiet`]),
    ]);
    expect(keywords).toEqual(['단체룸']);
  });
});

// 단일 멤버로도 집계 함수가 크래시 없이 유효한 입력을 만들어내는지 잠근다(회귀 방지).
describe('단일 멤버 집계', () => {
  const solo: GroupMember = {
    member_name: '친구', location_name: '서면', location_lat: 35.15, location_lng: 129.06,
    vibe_atmosphere: 'atm_cozy', vibe_budget: '2~4만원', vibe_keywords: ['조용한', `${EXCLUDE_FOOD_PREFIX}오이`],
    purpose_first: '밥', purpose_second: '카페',
  };

  it('목적을 단일 멤버 값으로 집계한다', () => {
    const p = aggregatePurpose([solo]);
    expect(p?.first).toBe('밥');
    expect(p?.second).toBe('카페');
  });

  it('예산·분위기·키워드가 유실 없이 집계된다', () => {
    expect(aggregateBudget([solo])).toBe('2~4만원');
    expect(aggregateVibe([solo])).toEqual({ 분위기: { first: ['atm_cozy'], second: [] } });
    const { keywords, excludeFoods } = splitMemberKeywords([solo]);
    expect(keywords).toEqual(['조용한']);
    expect(excludeFoods).toEqual(['오이']);
  });
});

describe('aggregateVibe', () => {
  it('1차와 2차 분위기를 따로 집계한다', () => {
    const vibe = aggregateVibe([
      { ...member([`${SECOND_VIBE_PREFIX}atm_quiet`]), vibe_atmosphere: 'atm_loud' },
      { ...member([`${SECOND_VIBE_PREFIX}atm_quiet`]), vibe_atmosphere: 'atm_cozy' },
      { ...member([`${SECOND_VIBE_PREFIX}atm_hip`]), vibe_atmosphere: 'atm_loud' },
    ]);
    expect(vibe).toEqual({ 분위기: { first: ['atm_loud'], second: ['atm_quiet'] } });
  });
});
