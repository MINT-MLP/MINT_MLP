// 취향 선택(VibeSelect) 데이터 — 칩 목록·프리셋·부스트 맵·예산. 서버(recommend.ts)와 값이 맞물리는 것은 주석 참조.
import type { VibePreset } from '@/types';

// 서버 전송 라벨 매핑 — 그리드에서 내린 키(atm_hip 등)도 절대 지우지 않는다.
// 옛 세션 복원값과 그룹 집계가 과거 멤버의 제출값을 그대로 읽어와 이 맵을 참조한다.
export const VIBE_KEY_TO_LABEL: Record<string, string> = {
  atm_loud:     '시끌벅적',
  atm_quiet:    '조용하게',
  atm_cozy:     '아늑한',
  atm_trendy:   '트렌디한',
  atm_mood:     '감성적인',
  atm_hip:      '힙한',
  pref_new:     '새로운 곳',
  pref_known:   '검증된 곳',
  pref_view:    '뷰 좋은 곳',
  pref_insta:   '인스타감성',
  pref_spacious:'넓은 공간',
  pref_quick:   '웨이팅 없음',
  atm_romantic: '로맨틱한',
  atm_modern:   '모던한',
  atm_retro:    '레트로',
  atm_lively:   '활기찬',
  atm_exotic:   '이국적인',
  atm_clean:    '깔끔한',
  pref_parking: '주차 가능',
  pref_room:    '룸 있는 곳',
  pref_reserve: '예약 가능',
  pref_late:    '늦게까지',
  pref_pet:     '반려동물',
  pref_station: '역세권',
};

// 그리드는 14개만 노출한다. 뜻이 겹치던 힙한·로맨틱한·레트로·이국적인은
// 지운 게 아니라 아래 RECOMMENDED_KEYWORDS로 내려, 탭 한 번으로 여전히 고를 수 있다.
export const GROUPS = [
  {
    label: '분위기',
    options: [
      { key: 'atm_loud',   label: '시끌벅적', emoji: '🎵' },
      { key: 'atm_quiet',  label: '조용하게', emoji: '🌿' },
      { key: 'atm_cozy',   label: '아늑한',   emoji: '🕯️' },
      { key: 'atm_trendy', label: '트렌디한', emoji: '✨' },
      { key: 'atm_mood',   label: '감성적인', emoji: '🌸' },
      { key: 'atm_modern', label: '모던한',   emoji: '🏙️' },
      { key: 'atm_lively', label: '활기찬',   emoji: '🎉' },
      { key: 'atm_clean',  label: '깔끔한',   emoji: '🤍' },
    ],
  },
  {
    label: '취향',
    options: [
      { key: 'pref_new',      label: '새로운 곳',   emoji: '🗺️' },
      { key: 'pref_known',    label: '검증된 곳',   emoji: '👍' },
      { key: 'pref_view',     label: '뷰 좋은 곳',  emoji: '🌅' },
      { key: 'pref_insta',    label: '인스타감성',  emoji: '📸' },
      { key: 'pref_spacious', label: '넓은 공간',   emoji: '🏠' },
      { key: 'pref_quick',    label: '웨이팅 없음', emoji: '⚡' },
    ],
  },
];

// '취향'에서 떼어낸 시설형 조건 — 주차 가능을 '2차 분위기'로 고른다는 건 말이 안 된다.
// 코스 구분 없는 전역 필터라 별도 체크리스트로 접어둔다.
export const CONDITION_OPTIONS = [
  { key: 'pref_parking', label: '주차 가능',  emoji: '🚗' },
  { key: 'pref_room',    label: '룸 있는 곳', emoji: '🚪' },
  { key: 'pref_reserve', label: '예약 가능',  emoji: '📅' },
  { key: 'pref_late',    label: '늦게까지',   emoji: '🌙' },
  { key: 'pref_pet',     label: '반려동물',   emoji: '🐶' },
  { key: 'pref_station', label: '역세권',     emoji: '🚇' },
];

// 목적(코스)별로 관련 칩을 앞으로 정렬 — "AI가 선택지까지 준비해준다"는 체감. 선택 자체는 자유(단순 노출 순서).
export const PURPOSE_CHIP_BOOST: Record<string, string[]> = {
  '밥':   ['pref_known', 'atm_clean'],
  '술':   ['atm_loud', 'atm_lively'],
  '카페': ['atm_cozy', 'atm_mood', 'pref_view', 'pref_insta'],
};

// 조건 체크리스트는 값 도메인이 달라 부스트 맵을 따로 둔다 — 합치면 조용히 정렬이 사라진다.
export const CONDITION_PURPOSE_BOOST: Record<string, string[]> = {
  '밥':   ['pref_room', 'pref_parking', 'pref_reserve'],
  '술':   ['pref_late', 'pref_station'],
  '카페': ['pref_reserve'],
};

// 그리드에서 내린 칩은 절대 참조하지 않는다 — 선택은 됐는데 화면에 없어서 해제 못 하는 칩이 생긴다.
export const VIBE_PRESETS: VibePreset[] = [
  { id: 'cozy_quiet',    emoji: '🕯️', title: '조용하고 아늑하게',    desc: '차분히 대화하기 좋은 곳',
    mood: ['atm_quiet', 'atm_cozy'],    pref: ['pref_known', 'pref_spacious'], conditions: ['pref_reserve'] },
  { id: 'lively_party',  emoji: '🎉', title: '신나게 왁자지껄',      desc: '텐션 올리는 활기찬 자리',
    mood: ['atm_loud', 'atm_lively'],   pref: ['pref_new'],                    conditions: ['pref_late', 'pref_room'] },
  { id: 'trendy_hip',    emoji: '✨', title: '요즘 뜨는 트렌디한 곳', desc: '감각적이고 힙한 분위기',
    mood: ['atm_trendy'],               pref: ['pref_insta', 'pref_new'],      conditions: ['pref_station'] },
  { id: 'romantic_mood', emoji: '💕', title: '분위기 있는 데이트',    desc: '로맨틱하고 감성적인 순간',
    mood: ['atm_mood'],                 pref: ['pref_view'],                   conditions: ['pref_reserve'] },
  { id: 'clean_modern',  emoji: '🏙️', title: '깔끔하고 모던하게',    desc: '깨끗하고 세련된, 무난히 좋은 곳',
    mood: ['atm_modern', 'atm_clean'],  pref: ['pref_known'],                  conditions: ['pref_parking'] },
  { id: 'easy_casual',   emoji: '⚡', title: '가볍고 편하게',        desc: '웨이팅 없이 부담 없는 자리',
    mood: ['atm_quiet', 'atm_clean'],   pref: ['pref_quick'],                  conditions: ['pref_parking', 'pref_pet'] },
];

// 그리드에서 내린 분위기 4개 + 예시 문구로만 떠돌던 해시태그들을 "탭하면 태그"로 승격.
// 모바일에서 키보드가 최대 마찰이라, 타이핑을 탭으로 바꾸는 게 목적이다.
// vibe key 체계와 무관하다 — 라벨 문자열이 그대로 keywords에 들어간다(직접 친 것과 같은 취급).
// 8개로 고정한다 — 9개면 마지막 한 칩만 셋째 줄에 홀로 떨어져 4/4/1로 보인다.
// 뺀 건 '콜키지': 술에만 걸리는 데다 매장 정책 용어라 다른 칩(장소 성격)과 결이 다르다.
export const RECOMMENDED_KEYWORDS = ['힙한', '로맨틱한', '레트로', '이국적인', '노포', '오마카세', '창가자리', '루프탑'];

// 코스당 3개씩 — 어느 코스로 들어와도 앞줄에 올라오는 칩 수가 같다
export const KEYWORD_CHIP_BOOST: Record<string, string[]> = {
  '밥':   ['노포', '오마카세', '창가자리'],
  '술':   ['루프탑', '힙한', '레트로'],
  '카페': ['루프탑', '창가자리', '이국적인'],
};

// 코스당 소프트 상한 — 무제한이면 AI 프롬프트에 넘길 라벨이 산만해진다
export const MAX_PER_COURSE = 6;

// 값은 서버(recommend.ts)·집계(groupAggregate BUDGET_ORDER)와 반드시 일치시켜야 검색 프리픽스/예산 반영이 작동한다
export const BUDGET_OPTIONS = [
  { value: '~2만원',  label: '~2만원',  emoji: '💵', sub: '가성비' },
  { value: '2~4만원', label: '2~4만원', emoji: '🍽️', sub: '적당히' },
  { value: '4만원+',  label: '4만원+',  emoji: '💎', sub: '플렉스' },
];

// 분위기성 라벨 집합 — "분위기가 별로" 거절을 실제로 작동시키기 위한 목록.
// 그룹에서는 집계에서 진 멤버의 분위기가 vibe가 아니라 keywords로 넘어오기 때문에(멤버 제출 시 대표 1개만
// vibe_atmosphere, 나머지는 vibe_keywords에 라벨로 실린다), vibe만 낮추면 그 라벨들이
// '1차 필수 키워드 ← 최우선'으로 살아남아 똑같은 분위기의 장소가 다시 나온다.
// pref_*(주차·룸 등 편의시설)는 분위기가 아니라 하드 조건이므로 제외한다.
export const ATMOSPHERE_LABELS: ReadonlySet<string> = new Set(
  Object.entries(VIBE_KEY_TO_LABEL).filter(([k]) => k.startsWith('atm_')).map(([, label]) => label),
);
