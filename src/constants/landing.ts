import type { IconName } from '@/components/icons';

// ── 모바일 히어로: 조건 → 결과 예시 바 ──
export const COMBOS: { chips: { icon?: IconName; label: string }[]; result: string }[] = [
  { chips: [{ icon: 'drink', label: '술' }, { label: '시끌벅적' }, { label: '성수' }], result: '아키야마 성수본점' },
  { chips: [{ icon: 'meal', label: '밥' }, { label: '검증된 곳' }, { label: '선릉' }], result: '농민백암순대 본점' },
  { chips: [{ icon: 'cafe', label: '카페' }, { label: '인스타감성' }, { label: '연남' }], result: '카페 레이어드 연남점' },
  { chips: [{ icon: 'heart', label: '100일 데이트' }, { label: '야경맛집' }, { label: '성수' }], result: '성수옥상' },
  { chips: [{ icon: 'briefcase', label: '회식' }, { label: '단체 가능' }, { label: '용산' }], result: '몽탄' },
];
