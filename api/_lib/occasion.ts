// 관계별 "특별한 날" 칩과 그 칩이 서버 프롬프트에 붙이는 문구. 화면(src/constants/occasion.ts가 재수출)과 서버가 이 파일 하나를 쓴다.
// occasion: null 은 "평범/그냥" — 특별 처리 없이 순수 관계만 반영.

export interface OccChip { key: string; occasion: string | null; emoji: string }

export const OCCASION_BY_RELATION: Record<string, OccChip[]> = {
  '친구들': [
    { key: '축하할 일', occasion: '축하', emoji: '🎉' },
    { key: '위로가 필요', occasion: '위로', emoji: '🫂' },
    { key: '오랜만에',   occasion: null,   emoji: '👋' },
    { key: '그냥 한잔',  occasion: null,   emoji: '🍺' },
  ],
  '연인': [
    { key: '기념일',      occasion: '기념일', emoji: '💐' },
    { key: '소개팅·썸',   occasion: '소개팅', emoji: '💘' },
    { key: '생일',        occasion: '생일',   emoji: '🎂' },
    { key: '평범한 데이트', occasion: null,   emoji: '💑' },
  ],
  '가족': [
    { key: '생일',      occasion: '생일', emoji: '🎂' },
    { key: '축하할 일', occasion: '축하', emoji: '🎉' },
    { key: '명절·모임', occasion: null,   emoji: '🍱' },
    { key: '그냥 식사', occasion: null,   emoji: '🍚' },
  ],
};
// 미리보기 한 줄 — 유저가 자기 선택의 효과를 즉시 본다(입력 부담 0). OCCASION_HINT를 친근하게 축약.
export const OCCASION_PREVIEW: Record<string, string> = {
  '생일':   '프라이빗룸·케이크 반입 OK 위주로 찾을게요 🎂',
  '기념일': '분위기 있는 조용한 좌석 위주로 찾을게요 🥂',
  '소개팅': '대화하기 좋은 조용한 곳 위주로 찾을게요 ☕',
  '축하':   '신나는 분위기·파티 가능한 곳 위주로 찾을게요 🎉',
  '위로':   '조용하고 편안하게 오래 머물 곳 위주로 찾을게요 🌙',
};

// 행사별 프롬프트 문구. 키는 위 칩의 occasion 값과 같아야 한다
export const OCCASION_HINT: Record<string, string> = {
  '생일':   '프라이빗룸 또는 케이크 반입 가능 우선, 이벤트 연출 가능한 곳',
  '기념일': '분위기 있는 공간, 프라이빗 좌석, 조용한 환경 선호',
  '소개팅': '조용하고 대화하기 좋은 공간, 테이블 간격 넓은 곳',
  '축하':   '신나는 분위기, 파티 가능한 곳, 큰 테이블 선호',
  '위로':   '조용하고 편안한 분위기, 오래 머물 수 있는 곳',
};
