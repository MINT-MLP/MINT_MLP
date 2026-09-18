// 내 모임 탭 목업 데이터 — 서버 모임 기능은 아직 없다. 화면 수요 검증용.
export interface MockMeeting {
  id: string; title: string; dateLabel: string; dateISO: string;
  respondedCount: number; totalCount: number;
  placeName: string | null; areaName: string | null;
  isHost: boolean; status: 'collecting' | 'confirmed' | 'past';
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

// 목업 날짜를 고정하면 며칠만 지나도 "다가오는 모임"이 과거가 된다 — 항상 오늘 기준으로 만든다.
function nextFriday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
  return d;
}

function schedule(offsetDays: number, hh: number, mm: number): { dateISO: string; dateLabel: string } {
  const d = nextFriday();
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    // 로컬 시각으로 파싱되도록 타임존 표기 없이 둔다(D-day는 날짜만 본다)
    dateISO: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(hh)}:${p(mm)}`,
    dateLabel: `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]}) ${p(hh)}:${p(mm)}`,
  };
}

export const MOCK_MEETINGS: MockMeeting[] = [
  { id: 'm1', title: '이번주 금요일 저녁 모임', ...schedule(0, 19, 0), respondedCount: 3, totalCount: 6, placeName: null, areaName: '홍대', isHost: true, status: 'collecting' },
  { id: 'm2', title: '토요일 브런치 모임', ...schedule(1, 12, 0), respondedCount: 2, totalCount: 4, placeName: null, areaName: '망원', isHost: true, status: 'collecting' },
  { id: 'm3', title: '대학 동기 모임', ...schedule(7, 18, 30), respondedCount: 5, totalCount: 5, placeName: '아키야마 성수본점', areaName: '성수', isHost: false, status: 'confirmed' },
  { id: 'm4', title: '프로젝트 회식', ...schedule(-14, 19, 0), respondedCount: 4, totalCount: 4, placeName: '몽탄', areaName: '용산', isHost: true, status: 'past' },
  { id: 'm5', title: '생일 축하 모임', ...schedule(-25, 19, 30), respondedCount: 6, totalCount: 6, placeName: '이자카야 모모', areaName: '연남', isHost: false, status: 'past' },
  { id: 'm6', title: '오랜만에 동창 모임', ...schedule(-40, 18, 0), respondedCount: 4, totalCount: 5, placeName: '성수 화로구이', areaName: '성수', isHost: true, status: 'past' },
];
