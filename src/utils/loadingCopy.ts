// 로딩 메시지 — 첫 줄에 선택 지역명을 넣어 "내 조건을 보고 있다"는 체감을 준다.
// (전국 서비스라 '서울' 고정은 부산·인천 사용자에게 신뢰가 깨지는 순간이 됨)
export function getLoadingMessages(areaName?: string | null): string[] {
  const place = areaName?.trim() || '동네';
  return [
    `${place} 구석구석 탐색 중...`,
    '우리 팀 취향 분석 중...',
    '딱 맞는 곳 걸러내는 중...',
    '가격대 & 영업시간 체크 중...',
    '오늘의 코스 완성 직전!',
  ];
}
export const LOADING_MESSAGE_COUNT = 5;
// AI 응답이 오래 걸릴 때(약속한 30초 근처) 진행바 대신 '지연 인정' 카피로 전환 — 불확정 대기의 체감을 줄인다.
export const LOADING_SLOW_MS = 25000;
export const LOADING_SLOW_MESSAGE = '후보가 많은 동네라 꼼꼼히 보는 중이에요. 거의 다 왔어요!';
