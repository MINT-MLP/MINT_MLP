// 착한가격업소 — 행정안전부·지자체가 합리적 가격과 위생을 기준으로 지정하는 공공 인증.
// ※ 이 인증은 "맛"이 아니라 "가격 정직성"을 보증한다(안내 문구에 명확히 반영).
//
// 착한가격업소는 지자체별로 수시 변동되는 대규모 목록이라, 정확한 상호+구·군이 확인되기 전에는
// 비워 둔다. 빈 배열이면 뱃지가 절대 노출되지 않아(오탐 0) 안전하며, 구조는 그대로 확장 대기.
// TODO: 행정안전부 「착한가격업소」 공공데이터 확보 시 상호·구·군만 정확히 채워 확장.

import type { CertSource, CertEntry } from '@/types';

const ENTRIES: CertEntry[] = [
  // (데이터 확보 전 — 비워 둔다)
];

export const GOODPRICE: CertSource = {
  id: 'goodprice',
  label: '착한가격',
  icon: 'coins',
  badgeTextColor: 'rgb(var(--mint-600))',
  priority: 3,
  sheetTitle: '착한가격업소',
  sheetBody:
    '지자체가 지정한 착한가격업소예요. 부담 없는 가격을 정직하게 지켜온 곳이라, 주머니 가볍게 즐기기 좋답니다 (맛이 아닌 가격·위생 기준 인증이에요)',
  sourceLine: '행정안전부·지방자치단체 착한가격업소 지정',
  ctaLabel: '가성비 좋네요!',
  entries: ENTRIES,
};
