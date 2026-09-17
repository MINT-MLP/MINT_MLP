import type { Coordinates } from '@/types';

// 좌표를 하나도 못 구했을 때의 최후 폴백(서울시청). 좌표가 1개라도 있으면 그 좌표를 써야 한다 —
// findBalancedAreas는 1개도 정상 처리하는데, 예전 호출부가 2개 미만이면 버리고 이 값을 넣어
// "좌표 있는 멤버 1명 + 임의지역 멤버" 그룹의 중간지점이 엉뚱하게 서울시청이 됐다.
export const SEOUL_CENTER: Coordinates = { lat: 37.5665, lng: 126.978 };
