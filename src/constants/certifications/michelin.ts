// 미쉐린 가이드 등재 — 「미쉐린 가이드 서울·부산」에 수년간 안정적으로 이름을 올린 곳만 선별 수록.
// 출처: 미쉐린 가이드 서울·부산 공식 셀렉션(빕 구르망 포함).
//
// ※ MINT는 미쉐린과 무관한 독립 서비스이며, 미쉐린 가이드 셀렉션을 참고 정보로만 안내한다.
// ⚠️ 창작·추정 금지. 등재가 확인된 상호만, 정확한 구·군과 함께 추가한다(오탐 = 신뢰 붕괴).
// TODO: 매년 발표되는 신규 셀렉션을 반영해 확장(현재는 장기 등재 대표 업소 중심 보수적 시드).

import type { CertSource, CertEntry } from '@/types';

const ENTRIES: CertEntry[] = [
  // ── 서울 (평양냉면·노포 등 장기 등재) ──
  { name: '우래옥', region: '서울', district: '중구', category: '평양냉면' },
  { name: '필동면옥', region: '서울', district: '중구', category: '평양냉면' },
  { name: '을밀대', region: '서울', district: '마포구', category: '평양냉면' },
  { name: '광화문국밥', region: '서울', district: '중구', category: '돼지국밥' },
  { name: '하동관', region: '서울', district: '중구', category: '곰탕' },
  { name: '만족오향족발', region: '서울', district: '중구', category: '족발' },
  { name: '은주정', region: '서울', district: '중구', category: '김치찌개' },
  { name: '부촌육회', region: '서울', district: '종로구', category: '육회' },
  { name: '대성집', region: '서울', district: '종로구', category: '도가니탕' },
  { name: '평래옥', region: '서울', district: '중구', category: '냉면' },
  { name: '남포면옥', region: '서울', district: '중구', category: '냉면' },
  { name: '잼배옥', region: '서울', district: '중구', category: '설렁탕' },

  // ── 부산 ──
  { name: '원조본전돼지국밥', region: '부산', district: '부산진구', category: '돼지국밥' },
  { name: '신발원', region: '부산', district: '동구', category: '만두·중식' },
];

export const MICHELIN: CertSource = {
  id: 'michelin',
  label: '미쉐린',
  emoji: '⭐',
  badgeTextColor: '#111827',
  priority: 0,
  sheetTitle: '미쉐린 가이드 등재',
  sheetBody:
    '미쉐린 가이드 서울·부산 셀렉션에 이름을 올린 곳이에요. 한 끼의 완성도를 세계적인 기준으로 검증받은 집이라는 뜻이랍니다 ✨',
  sourceLine: '미쉐린 가이드 서울·부산 셀렉션',
  ctaLabel: '기대돼요, 가볼게요!',
  disclaimer: 'MINT는 미쉐린과 무관한 독립 서비스이며, 등재 정보를 참고용으로 안내해요.',
  entries: ENTRIES,
};
