import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import StepProgress from '../components/StepProgress';
import LocationInput from '../components/LocationInput';
import type { LocationEntry } from '../components/LocationInput';
import PurposeSelect from '../components/PurposeSelect';
import type { PurposeValue } from '../components/PurposeSelect';
import VibeSelect from '../components/VibeSelect';
import type { VibeState } from '../components/VibeSelect';
import { VIBE_KEY_TO_LABEL, migrateVibeState } from '../components/VibeSelect';
import MeetingLocationSelect from '../components/MeetingLocationSelect';
import type { MeetingLocation } from '../components/MeetingLocationSelect';
import ResultCard from '../components/ResultCard';
import RetryWeightModal from '../components/RetryWeightModal';
import type { VibeWeights } from '../components/RetryWeightModal';
import Reserve from './Reserve';
import { PRESET_REGIONS, findNearestAreas, findBalancedAreas } from '../services/midpoint';
import type { PresetRegion, Coordinates } from '../services/midpoint';
import { getAIRecommendation, enrichPlaces } from '../services/ai';
import type { PlaceRecommendation, UserInput, WeatherSummary, RegionScope } from '../services/ai';
import { saveResultSnapshot, loadResultSnapshot, clearResultSnapshot, saveHistory, INPUT_DRAFT_KEY, GROUP_SESSION_KEY } from '../utils/history';
import { computeTravelTimes, transitMinutesTo } from '../services/travelTime';
import { trackSessionDuration, trackEvent, setSessionKey, newSessionKey } from '../utils/analytics';
import { savePilotHandoff, buildCoursePicks } from '../utils/pilotHandoff';
import { aggregateVibe, aggregateBudget, splitMemberKeywords } from '../utils/groupAggregate';
import type { GroupMember } from '../utils/groupAggregate';
import LoadingScreen from '../components/home/LoadingScreen';
import GroupWaiting from '../components/home/GroupWaiting';
import { encodeHostContext } from '../utils/groupLink';
import PointsBadge from '../components/PointsBadge';
import WishlistSheet from '../components/WishlistSheet';
import { getBalance } from '../utils/points';
import { logActivityIfSignedIn } from '../utils/auth';

type Step = 0 | 1 | 2 | 3;
type View = 'steps' | 'result' | 'reserve';

// 스텝2(관계) 2층 — 관계를 고르면 문맥에 맞는 '특별한 날' 칩이 등장한다.
// occasion 값은 api/recommend.ts의 OCCASION_EXTRA_KEYWORDS·OCCASION_HINT 키(생일/기념일/소개팅/축하/위로)에 맞춘다.
// occasion: null 은 "평범/그냥" — 특별 처리 없이 순수 관계만 반영.
interface OccChip { key: string; occasion: string | null; emoji: string; }
const OCCASION_BY_RELATION: Record<string, OccChip[]> = {
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
const OCCASION_PREVIEW: Record<string, string> = {
  '생일':   '프라이빗룸·케이크 반입 OK 위주로 찾을게요 🎂',
  '기념일': '분위기 있는 조용한 좌석 위주로 찾을게요 🥂',
  '소개팅': '대화하기 좋은 조용한 곳 위주로 찾을게요 ☕',
  '축하':   '신나는 분위기·파티 가능한 곳 위주로 찾을게요 🎉',
  '위로':   '조용하고 편안하게 오래 머물 곳 위주로 찾을게요 🌙',
};
// 'mode-select' = 유형 미선택 상태(step 0), 'solo' = 혼자, 'group' = 다같이(호스트)
type AppMode = 'mode-select' | 'solo' | 'group';

interface TravelResult {
  label: string;
  formatted: string;
  source?: string;
  error?: boolean;
}

interface ResultTravelTimes {
  first: { transit: TravelResult[]; driving: TravelResult[] };
  second: { transit: TravelResult[]; driving: TravelResult[] } | null;
}

// 로딩 메시지 — 첫 줄에 선택 지역명을 넣어 "내 조건을 보고 있다"는 체감을 준다.
// (전국 서비스라 '서울' 고정은 부산·인천 사용자에게 신뢰가 깨지는 순간이 됨)
function getLoadingMessages(areaName?: string | null): string[] {
  const place = areaName?.trim() || '동네';
  return [
    `🗺️ ${place} 구석구석 탐색 중...`,
    '👥 우리 팀 취향 분석 중...',
    '🔍 딱 맞는 곳 걸러내는 중...',
    '💰 가격대 & 영업시간 체크 중...',
    '✨ 오늘의 코스 완성 직전!',
  ];
}
const LOADING_MESSAGE_COUNT = 5;
// AI 응답이 오래 걸릴 때(약속한 30초 근처) 진행바 대신 '지연 인정' 카피로 전환 — 불확정 대기의 체감을 줄인다.
const LOADING_SLOW_MS = 25000;
const LOADING_SLOW_MESSAGE = '🍀 후보가 많은 동네라 꼼꼼히 보는 중이에요. 거의 다 왔어요!';

// 결과·입력초안 모두 localStorage에 보관 — 홈버튼·공유로 앱을 벗어나 웹뷰가 재시작돼도 유지
// (sessionStorage는 모바일에서 프로세스 재시작 시 통째로 사라짐)
// 키 자체는 utils/history가 보유한다 — 홈 바깥에서도 복원을 끊어야 하므로.
const INPUT_DRAFT_TTL_MS = 6 * 60 * 60 * 1000; // 입력하다 만 초안은 6시간까지만 복원

// 그룹 호스트 세션 — sessionId는 서버 세션의 유일한 열쇠라 state에만 두면 새로고침 시 링크·대기현황이 통째로 증발한다

const GROUP_SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 그룹 대기 세션도 6시간까지만 복원

// 좌표를 하나도 못 구했을 때의 최후 폴백(서울시청). 좌표가 1개라도 있으면 그 좌표를 써야 한다 —
// findBalancedAreas는 1개도 정상 처리하는데, 예전 호출부가 2개 미만이면 버리고 이 값을 넣어
// "좌표 있는 멤버 1명 + 임의지역 멤버" 그룹의 중간지점이 엉뚱하게 서울시청이 됐다.
const SEOUL_CENTER: Coordinates = { lat: 37.5665, lng: 126.978 };

// 분위기성 라벨 집합 — "분위기가 별로" 거절을 실제로 작동시키기 위한 목록.
// 그룹에서는 집계에서 진 멤버의 분위기가 vibe가 아니라 keywords로 넘어오기 때문에(멤버 제출 시 대표 1개만
// vibe_atmosphere, 나머지는 vibe_keywords에 라벨로 실린다), vibe만 낮추면 그 라벨들이
// '1차 필수 키워드 ← 최우선'으로 살아남아 똑같은 분위기의 장소가 다시 나온다.
// pref_*(주차·룸 등 편의시설)는 분위기가 아니라 하드 조건이므로 제외한다.
const ATMOSPHERE_LABELS: ReadonlySet<string> = new Set(
  Object.entries(VIBE_KEY_TO_LABEL).filter(([k]) => k.startsWith('atm_')).map(([, label]) => label),
);

// 그룹 링크 무효화를 서버에도 알린다 — 알리지 않으면 옛 링크가 계속 살아 있어서,
// 그 링크로 들어온 게스트는 제출까지 마치고도 아무도 보지 않는 세션에서 영원히 결과를 기다린다.
// 실패해도(구버전 서버·오프라인) 로컬 무효화는 그대로 진행해야 하므로 fire-and-forget.
function cancelGroupSessionOnServer(id: string): void {
  void fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'cancel', id }),
  }).catch(() => { /* 서버가 cancel을 몰라도 로컬 무효화는 이미 끝났다 */ });
}

// 공유 투표용 ID (세션 아님 — 공유 클릭마다 새로 발급)
const SHARE_ID_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';
function newShareId(): string {
  let s = 'sh';
  for (let i = 0; i < 10; i++) s += SHARE_ID_CHARS[Math.floor(Math.random() * SHARE_ID_CHARS.length)];
  return s;
}

// 공유 결과 스냅샷을 서버에 저장 — 1.5초 안에 ok:true여야 짧은 링크(/shared?id=)를 쓴다.
// 실패·타임아웃·오프라인·테이블 미생성(disabled)이면 false → 호출부가 레거시 ?data= URL로 폴백.
async function saveShareSnapshot(shareId: string, payload: object): Promise<boolean> {
  if (navigator.onLine === false) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch('/api/share-vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'snapshot', shareId, payload }),
      signal: ctrl.signal,
    });
    // clearTimeout은 본문 파싱까지 끝난 뒤에 — 느린 망에서 바디 읽기가 1.5초를 넘기면 abort되어
    // json이 실패(→null→false→레거시 링크 폴백)하도록. 먼저 해제하면 바디 읽기가 무제한 대기됨.
    if (!res.ok) { clearTimeout(t); return false; }
    const d = await res.json().catch(() => null);
    clearTimeout(t);
    return d?.ok === true;
  } catch {
    return false;
  }
}

// 공유 폴백 — 카카오 SDK가 없거나 실패(특히 iOS 홈화면 PWA에선 조용히 실패)할 때
// OS 네이티브 공유 시트 → 클립보드 → 최후 prompt 순으로. 어떤 환경에서도 버튼이 무반응으로 끝나지 않게 한다.
async function fallbackShare(shareText: string, sharedUrl: string) {
  if (navigator.share) {
    try {
      await navigator.share({ title: 'MINT 장소 추천', text: shareText, url: sharedUrl });
      return;
    } catch (e) {
      // 사용자가 공유 시트를 닫은 것(AbortError)은 정상 종료. 그 외 실패만 클립보드로 이어감.
      if ((e as Error)?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(`${shareText}\n${sharedUrl}`);
    alert('공유 내용이 복사되었어요! 카카오톡에 붙여넣기 해주세요.');
  } catch {
    window.prompt('아래 링크를 길게 눌러 복사한 뒤 카카오톡에 붙여넣어 주세요.', sharedUrl);
  }
}

// 카카오톡 공유 시트를 원터치로 띄우되, 실패 케이스를 전부 폴백으로 흡수한다:
//  - iOS 홈화면 PWA(standalone): sendDefault가 커스텀 스킴/window.open 제약으로 예외 없이 조용히 실패 → 아예 건너뜀
//  - Vercel env 키 누락: kakaoLoader.ts와 동일한 공개 JS 키로 폴백(그래도 falsy면 시도 안 함)
//  - 도메인 미등록·SDK 내부 예외: try/catch로 잡아 공통 폴백(fallbackShare)으로
// buildPayload는 성공 경로에서만 호출된다(Kakao.Share.sendDefault 인자).
async function shareViaKakaoOrFallback(buildPayload: () => object, shareText: string, sharedUrl: string) {
  // iPadOS 13+는 UA가 "Macintosh"로 나오므로 터치 지원(maxTouchPoints)까지 봐서 iPad를 iOS로 포함 —
  // 안 그러면 iPad 홈화면 PWA에서 sendDefault가 조용히 실패한 뒤 폴백 없이 무반응이 된다.
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isStandalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  const skipKakao = isIOS && isStandalone;
  const kakaoKey: string = import.meta.env.VITE_KAKAO_JS_API_KEY ?? '633de41eba4b85734a961345c0f55a7e';

  if (!skipKakao && kakaoKey && window.Kakao?.Share) {
    try {
      if (!window.Kakao.isInitialized()) window.Kakao.init(kakaoKey);
      if (!window.Kakao.isInitialized()) throw new Error('kakao init failed');
      window.Kakao.Share.sendDefault(buildPayload());
      return;
    } catch {
      trackEvent('kakao_share_fallback'); // 폴백 비율 관측용
    }
  }
  await fallbackShare(shareText, sharedUrl);
}

function distMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLng = (bLng - aLng) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

// 하이브리드 상권 선택 — 거리로 좁힌 후보 2곳을 '실측 대중교통 시간'으로 최종 결정한다.
// 기준은 거리 때와 동일한 minimax: '가장 멀리 오는 사람의 시간'이 더 작은 후보. 직선거리로는 비슷해도
// 지하철 연결성에 따라 실제 체감이 갈리는 걸 반영. 단, 한 명이라도 실측이 안 되면(ODsay 실패·미설정)
// 공정한 비교가 불가하므로 거리 1순위(candidates[0])를 그대로 쓴다 — 반쪽 데이터로 뒤집지 않는다.
async function refineHubByTransit(
  candidates: { name: string; lat: number; lng: number }[],
  departures: Coordinates[],
): Promise<{ name: string; lat: number; lng: number }> {
  if (candidates.length < 2 || departures.length === 0) return candidates[0];
  try {
    const worstTransit = await Promise.all(
      candidates.map(async (h) => {
        const mins = await transitMinutesTo(h, departures);
        return mins.some((m) => m == null) ? null : Math.max(...(mins as number[]));
      }),
    );
    if (worstTransit.some((m) => m == null)) return candidates[0]; // 실측 불완전 → 거리 결과 유지
    let best = 0;
    for (let i = 1; i < worstTransit.length; i++) {
      if ((worstTransit[i] as number) < (worstTransit[best] as number)) best = i;
    }
    return candidates[best];
  } catch {
    return candidates[0];
  }
}

type ChangeReason = 'retry' | 'adjust' | 'expensive' | 'far' | 'vibe';

// 재추천이 이전 결과 대비 "뭐가 달라졌는지" 한 줄 — 실측 가능한 사실(거리)만 숫자로 말한다
function buildChangeNote(
  prev: PlaceRecommendation | null,
  next: PlaceRecommendation | undefined,
  midpoint: Coordinates,
  reason: ChangeReason,
): string | null {
  if (!prev || !next || prev.placeName === next.placeName) return null;

  let distPart: string | null = null;
  if (prev.lat && prev.lng && next.lat && next.lng && prev.lat !== 0 && next.lat !== 0) {
    const diff = distMeters(midpoint.lat, midpoint.lng, prev.lat, prev.lng)
      - distMeters(midpoint.lat, midpoint.lng, next.lat, next.lng);
    if (diff > 150) distPart = `중간지점에서 ${diff >= 1000 ? `${(diff / 1000).toFixed(1)}km` : `${Math.round(diff / 50) * 50}m`} 더 가까워졌어요`;
  }

  switch (reason) {
    case 'expensive':
      return `${prev.placeName} 대신 가격 부담을 낮춘 곳으로 다시 골랐어요 (이번엔 ${next.priceRange})`;
    case 'far':
      return distPart
        ? `${prev.placeName} 대신 ${distPart.replace('졌어요', '운 곳')}으로 바꿨어요`
        : `${prev.placeName} 대신 이동 부담을 줄이는 방향으로 다시 골랐어요`;
    case 'vibe':
      return `분위기를 바꿔 ${next.placeName}(${next.category})로 다시 골랐어요`;
    case 'adjust':
      return `조절한 취향을 반영해 ${next.placeName}로 바꿨어요${distPart ? ` · ${distPart}` : ''}`;
    default:
      return `아까 본 ${prev.placeName} 말고 새로운 곳으로 골랐어요${distPart ? ` · ${distPart}` : ''}`;
  }
}

export default function Home({ onChromeChange }: { onChromeChange?: (showTabBar: boolean) => void } = {}) {
  const [appMode, setAppMode] = useState<AppMode>('mode-select');
  const [groupSize, setGroupSize] = useState<'2명' | '3~4명' | '5명 이상'>('2명');
  const [customOccasion, setCustomOccasion] = useState('');
  const [etcRelOpen, setEtcRelOpen] = useState(false); // '기타 콕!' 자유입력 모드
  const [occasionChip, setOccasionChip] = useState<string | null>(null); // 스텝2 2층에서 고른 '특별한 날' 칩 key(선택 표시용)
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expectedCount, setExpectedCount] = useState<number>(3);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [pendingGroupRecommend, setPendingGroupRecommend] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<View>('steps');
  const [step, setStep] = useState<Step>(0);
  const [locations, setLocations] = useState<LocationEntry[]>([]);
  // 그룹 전용: locations와 같은 순서의 '사람 이름' 목록. locations[].name은 지명(프롬프트·총무용)이라
  // 이동시간 표에 쓸 label을 여기 따로 들고 있는다. 혼자 모드에서는 항상 null(= locations[].name 사용).
  const [groupTravelLabels, setGroupTravelLabels] = useState<string[] | null>(null);
  const [purpose, setPurpose] = useState<PurposeValue | null>(null);
  const [vibe, setVibe] = useState<VibeState>({});
  const [budget, setBudget] = useState<string | null>(null);
  const [meetingLocation, setMeetingLocation] = useState<MeetingLocation | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState(0);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [result, setResult] = useState<PlaceRecommendation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<string[]>([]);
  // 시설형 조건(주차·룸·예약…) — 코스 구분이 없어 vibe와 분리해 들고 있다
  const [conditions, setConditions] = useState<string[]>([]);
  const [excludeFoods, setExcludeFoods] = useState<string[]>([]);
  const [vibeCustom, setVibeCustom] = useState<Record<string, string>>({});
  const [showRetryModal, setShowRetryModal] = useState(false);
  const [midpointData, setMidpointData] = useState<{
    midpoint: Coordinates;
    areaName: string;
    nearestAreas: string[];
    scope?: RegionScope | null;   // 행정단위(시/구/동) 스코프 — 재추천 시에도 같은 범위 유지
  } | null>(null);
  const [resultTravelTimes, setResultTravelTimes] = useState<ResultTravelTimes | null>(null);
  const [treasurer, setTreasurer] = useState<string | null>(null);
  const [pointsBalance, setPointsBalance] = useState<number>(() => getBalance());
  const [showWishlist, setShowWishlist] = useState(false);
  const [resultWeather, setResultWeather] = useState<WeatherSummary | null>(null);
  const [resultThird, setResultThird] = useState<PlaceRecommendation | null>(null);       // 3차 '이어서 갈 곳'
  const [resultThirdLabel, setResultThirdLabel] = useState<string | null>(null);
  const [changeNote, setChangeNote] = useState<string | null>(null);
  const [compromiseMessage, setCompromiseMessage] = useState<string | null>(null);
  const [showCompromiseToast, setShowCompromiseToast] = useState(false);
  const [showVibeScrollHint, setShowVibeScrollHint] = useState(false);
  const [showResultScrollHint, setShowResultScrollHint] = useState(false);

  const travelReqRef = useRef(0);
  const enrichReqRef = useRef(0);
  const loadingStartRef = useRef(0);   // 로딩 시작 시각 — 지연 인정 카피 전환 판단용
  const lastRecommendRef = useRef<(() => void) | null>(null); // 실패 시 같은 조건 원탭 재시도용
  const sessionKeyRef = useRef<string | null>(null);          // 탐색 에피소드 세션키 — recommendation_log·events 조인용
  const lastSessionResultRef = useRef<string | null>(null); // 그룹 결과 세션 저장 중복 억제
  const loggedActivityRef = useRef<string | null>(null);    // 활동 로그 적재한 세션키 — 에피소드당 1건 보장
  const stepScrollRef = useRef<HTMLDivElement>(null);
  const isGroup = appMode === 'group';

  // 그룹 참여 링크 — 호스트가 정한 코스·지역을 쿼리에 실어 게스트에게 전달
  function groupShareLink(): string {
    if (!sessionId) return '';
    const ctx = encodeHostContext({
      purposeFirst: purpose?.first ?? null,
      firstGenre: purpose?.firstGenre ?? null,
      purposeSecond: purpose?.second ?? null,
      secondGenre: purpose?.secondGenre ?? null,
      relation: purpose?.relation ?? null,
      occasion: purpose?.occasion ?? null,
      regionType: meetingLocation?.type === 'auto' ? 'auto' : 'manual',
      regionName: meetingLocation?.type === 'manual' ? meetingLocation.area : null,
      regionId: meetingLocation?.type === 'manual' ? meetingLocation.regionId : null,
    });
    // 참석 응답 마감시각(기본 24시간 후) — 게스트 카운트다운·마감 판정용. 서버 저장 없이 링크로 전달.
    const rsvpBy = Date.now() + 24 * 60 * 60 * 1000;
    return `${window.location.origin}/join?id=${sessionId}&${ctx}&rsvp_by=${rsvpBy}`;
  }

  useEffect(() => {
    if (!sessionStorage.getItem('mintSessionStart')) {
      sessionStorage.setItem('mintSessionStart', Date.now().toString());
    }
  }, []);

  // 마지막 추천 결과 복원 (새로고침·홈 이탈·앱 전환 후 재진입 시 추천이 증발하지 않게)
  useLayoutEffect(() => {
    try {
      const saved = loadResultSnapshot() as {
        result?: PlaceRecommendation[];
        resultThird?: PlaceRecommendation | null;
        resultThirdLabel?: string | null;
        purpose?: PurposeValue;
        midpointData?: { midpoint: Coordinates; areaName: string; nearestAreas: string[] };
        treasurer?: string;
        meetingLocation?: MeetingLocation;
        resultTravelTimes?: ResultTravelTimes;
        resultWeather?: WeatherSummary;
        vibe?: VibeState;
        keywords?: string[];
        conditions?: string[];
        excludeFoods?: string[];
      } | null;
      if (!saved || !Array.isArray(saved.result) || saved.result.length === 0) return;
      setResult(saved.result);
      if (saved.resultThird) setResultThird(saved.resultThird);
      if (saved.resultThirdLabel) setResultThirdLabel(saved.resultThirdLabel);
      if (saved.purpose) setPurpose(saved.purpose);
      if (saved.midpointData) setMidpointData(saved.midpointData);
      if (saved.treasurer) setTreasurer(saved.treasurer);
      if (saved.meetingLocation) setMeetingLocation(saved.meetingLocation);
      if (saved.resultTravelTimes) setResultTravelTimes(saved.resultTravelTimes);
      if (saved.resultWeather) setResultWeather(saved.resultWeather);
      if (saved.vibe) setVibe(migrateVibeState(saved.vibe));            // 개인화 배너 복원용
      if (Array.isArray(saved.keywords)) setKeywords(saved.keywords);
      if (Array.isArray(saved.conditions)) setConditions(saved.conditions);
      if (Array.isArray(saved.excludeFoods)) setExcludeFoods(saved.excludeFoods);
      setView('result');
    } catch { /* 손상된 캐시는 무시 */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 입력 초안 복원 — 결과가 없을 때만. 그룹도 링크 생성 전에는 서버 세션이 없으므로 로컬 초안에서 복원한다.
  useLayoutEffect(() => {
    try {
      if (loadResultSnapshot()) return; // 결과 복원이 우선
      // 구버전(sessionStorage) 초안도 한 번은 읽어줌 — 배포 시점에 입력 중이던 세션 보호
      const raw = localStorage.getItem(INPUT_DRAFT_KEY) ?? sessionStorage.getItem(INPUT_DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.appMode !== 'solo' && d.appMode !== 'group') return;
      // 오래 방치된 초안은 복원하지 않음 (savedAt 없는 구버전 초안은 그대로 복원)
      if (typeof d.savedAt === 'number' && Date.now() - d.savedAt > INPUT_DRAFT_TTL_MS) {
        localStorage.removeItem(INPUT_DRAFT_KEY);
        return;
      }
      setAppMode(d.appMode);
      if (typeof d.step === 'number') setStep(d.step as Step);
      if (typeof d.expectedCount === 'number') setExpectedCount(d.expectedCount);
      if (d.groupSize) setGroupSize(d.groupSize);
      if (d.purpose) setPurpose(d.purpose);
      if (d.vibe) setVibe(migrateVibeState(d.vibe));
      if (Array.isArray(d.keywords)) setKeywords(d.keywords);
      if (Array.isArray(d.conditions)) setConditions(d.conditions);
      if (Array.isArray(d.excludeFoods)) setExcludeFoods(d.excludeFoods);
      if (d.vibeCustom) setVibeCustom(d.vibeCustom);
      if (d.meetingLocation) setMeetingLocation(d.meetingLocation);
      if (d.budget !== undefined) setBudget(d.budget);
      if (typeof d.customOccasion === 'string') setCustomOccasion(d.customOccasion);
      // 기타 콕! 자유입력 모드 복원 (occasion만 있고 relation 없으면 기타콕으로 입력한 것)
      if (d.purpose?.occasion && !d.purpose?.relation) setEtcRelOpen(true);
      // 스텝2 2층 칩 복원 — 관계+occasion이 매핑 칩과 일치하면 선택 표시 되살림
      if (d.purpose?.relation && d.purpose?.occasion) {
        const chip = OCCASION_BY_RELATION[d.purpose.relation]?.find((c) => c.occasion === d.purpose.occasion);
        if (chip) setOccasionChip(chip.key);
      }
      if (Array.isArray(d.locations)) setLocations(d.locations);
    } catch { /* 손상된 초안 무시 */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 그룹 호스트 세션 복원 — 결과 스냅샷 유무와 무관하게 항상 복원한다.
  // 예전에는 결과가 있으면 통째로 skip했는데, 그러면 혼자 모드로 먼저 써본 유저(광고 유입은 거의 전부)가
  // 그룹 링크를 만들고 /app?grp=로 돌아왔을 때 24시간짜리 옛 결과 때문에 sessionId가 복원되지 않았다.
  // → 폴링도 자동추천도 안 붙고, step 2에는 "링크 생성하기"가 다시 떠서 두 번째 세션을 만든다
  //   (첫 링크로 제출한 친구들이 전원 고아가 된다). 결과 스냅샷은 'view를 결과로 열지'만 결정하고,
  //   그룹 컨텍스트(sessionId·정원·코스·지역)는 별도로 살린다. TTL도 결과 24h / 그룹세션 6h로 각자 유지.
  useLayoutEffect(() => {
    try {
      const raw = localStorage.getItem(GROUP_SESSION_KEY);
      if (!raw) return;
      const g = JSON.parse(raw) as {
        savedAt?: number; sessionId?: string; expectedCount?: number;
        purpose?: PurposeValue; meetingLocation?: MeetingLocation;
      };
      if (!g.sessionId) return;
      if (typeof g.savedAt === 'number' && Date.now() - g.savedAt > GROUP_SESSION_TTL_MS) {
        localStorage.removeItem(GROUP_SESSION_KEY);
        return;
      }
      setSessionId(g.sessionId);
      if (typeof g.expectedCount === 'number') setExpectedCount(g.expectedCount);
      if (g.purpose) setPurpose(g.purpose);              // 호스트가 정한 코스 복원
      if (g.meetingLocation) setMeetingLocation(g.meetingLocation); // 호스트가 정한 지역 복원
      setStep(2);                 // 공유·대기 화면(step 2)으로 되돌린다
      setAppMode('group');        // 폴링이 다시 붙어 멤버 현황을 서버에서 재수화한다
      // 호스트가 ?grp= 링크를 눌러 돌아온 경우엔 옛 결과 화면을 걷어내고 대기 화면으로 보낸다.
      // 폴링·자동추천 effect가 둘 다 view==='steps'/step===2를 요구하므로, 여기서 결과 뷰를 치우지 않으면
      // 멤버 목록이 영영 채워지지 않아 자동 추천이 시작되지 않는다.
      if (new URLSearchParams(window.location.search).has('grp')) setView('steps');
    } catch { /* 손상된 그룹 세션 무시 */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 탭바 표시 여부를 AppShell에 보고 — 입력 플로우 1단계(step 0)에서만 탭바가 보인다.
  // useLayoutEffect: 페인트 전에 확정해 "탭바가 잠깐 보였다 사라지는" 깜빡임을 막는다.
  useLayoutEffect(() => {
    onChromeChange?.(view === 'steps' && step === 0);
  }, [view, step, onChromeChange]);

  // 그룹 호스트 세션 저장 — sessionId가 살아있는 동안 코스·지역까지 함께 보존(새로고침 복원용)
  useEffect(() => {
    if (appMode !== 'group' || !sessionId) return;
    try {
      localStorage.setItem(GROUP_SESSION_KEY, JSON.stringify({
        savedAt: Date.now(), sessionId, expectedCount, purpose, meetingLocation,
      }));
    } catch { /* 저장 실패는 치명적이지 않음 */ }
  }, [appMode, sessionId, expectedCount, purpose, meetingLocation]);

  // 입력 초안 저장 — solo 전체와 그룹 링크 생성 전까지 보존한다.
  // 그룹 링크 생성 후에는 GROUP_SESSION_KEY가 서버 세션 ID와 함께 이어서 보존한다.
  useEffect(() => {
    if (view !== 'steps') return;
    if (appMode !== 'solo' && !(appMode === 'group' && !sessionId)) return;
    try {
      localStorage.setItem(INPUT_DRAFT_KEY, JSON.stringify({
        savedAt: Date.now(),
        appMode, step, groupSize, expectedCount, purpose, vibe, keywords, conditions, excludeFoods, vibeCustom,
        meetingLocation, budget, customOccasion, locations,
      }));
    } catch { /* 저장 실패는 치명적이지 않음 */ }
  }, [view, appMode, sessionId, step, groupSize, expectedCount, purpose, vibe, keywords, conditions, excludeFoods, vibeCustom, meetingLocation, budget, customOccasion, locations]);

  // 결과 화면 상태가 확정될 때마다 스냅샷 저장 (setState 커밋 이후라 stale closure 없음)
  // + 같은 스냅샷을 localStorage 히스토리에도 적재 — 랜딩 "지난 추천"에서 그대로 복원
  useEffect(() => {
    if (view !== 'result' || !result || result.length === 0) return;
    const snapshot = {
      result, resultThird, resultThirdLabel, purpose, midpointData, treasurer, meetingLocation, resultTravelTimes, resultWeather, vibe, keywords, conditions, excludeFoods,
    };
    saveResultSnapshot(snapshot);
    const hasSecondCourse = !!(purpose?.second && purpose.second !== '없음');
    saveHistory({
      savedAt: Date.now(),
      placeName: result[0].placeName,
      secondPlaceName: hasSecondCourse ? result[1]?.placeName ?? null : null,
      areaName: midpointData?.areaName ?? null,
      purposeFirst: purpose?.first ?? null,
      snapshot,
    });
    // 활동 로그는 탐색 에피소드당 1건 — 이 effect는 enrich·이동시간 갱신마다 다시 도니 세션키로 걸러낸다.
    // 세션키가 없으면(스냅샷 복원으로 결과만 되살아난 경우) 새 추천이 아니므로 적재하지 않는다.
    if (sessionKeyRef.current && loggedActivityRef.current !== sessionKeyRef.current) {
      loggedActivityRef.current = sessionKeyRef.current;
      void logActivityIfSignedIn({
        placeName: result[0].placeName,
        secondPlaceName: hasSecondCourse ? result[1]?.placeName ?? null : null,
        areaName: midpointData?.areaName ?? null,
        purposeFirst: purpose?.first ?? null,
        groupSize: isGroup ? `${expectedCount}명` : groupSize,
      });
    }
  }, [view, result, resultThird, resultThirdLabel, purpose, midpointData, treasurer, meetingLocation, resultTravelTimes, resultWeather, vibe, keywords, excludeFoods, isGroup, expectedCount, groupSize]);

  // 그룹 호스트가 추천을 받으면 결과 요약을 세션에 저장 → 게스트 done 화면이 폴링으로 수신(협업 루프 완결).
  // enrich·재추천으로 결과가 바뀌면 자동 재저장. 실패는 무해(게스트가 못 볼 뿐, 카톡 공유로도 전달 가능).
  useEffect(() => {
    if (view !== 'result' || !isGroup || !sessionId || !result || result.length === 0) return;
    const hasSecondCourse = !!(purpose?.second && purpose.second !== '없음');
    // v:2 — 게스트 화면을 호스트와 동등하게 만들기 위해 신뢰 요소(사진·적합도·영업·해시태그·혼잡도)를 함께 실어 보낸다.
    // 이미지 URL이 길어 페이로드가 커지므로 /api/session 결과 저장 상한(24KB)에 맞춰 vibeTags는 3개로 제한.
    const slim = (p: PlaceRecommendation) => ({
      placeName: p.placeName, category: p.category, description: p.description,
      priceRange: p.priceRange, address: p.address, area: p.area,
      lat: p.lat ?? null, lng: p.lng ?? null, kakaoPlaceUrl: p.kakaoPlaceUrl ?? null,
      imageUrl: p.imageUrl ?? null,
      vibeTags: Array.isArray(p.vibeTags) ? p.vibeTags.slice(0, 3) : [],
      fitScore: p.fitScore ?? null,
      openingHours: p.openingHours ?? null,
      walkingToNext: p.walkingToNext ?? null,
      congestionLevel: p.congestionLevel ?? null,
    });
    const summary = {
      v: 2,
      first: slim(result[0]),
      second: hasSecondCourse && result[1] ? slim(result[1]) : null,
      third: resultThird ? slim(resultThird) : null,
      thirdLabel: resultThird ? (resultThirdLabel ?? '이어서') : null,
      purposeFirst: purpose?.first ?? null,
      purposeSecond: hasSecondCourse ? purpose?.second ?? null : null,
      areaName: midpointData?.areaName ?? null,
      // 총무 발표·날씨 — 호스트 결과에 있는 '재미/맥락' 요소를 게스트도 그대로 받는다(작은 필드).
      treasurer: treasurer ?? null,
      weather: resultWeather
        ? { description: resultWeather.description, temp: resultWeather.temp, isRainy: resultWeather.isRainy }
        : null,
    };
    // 서버 상한(24KB) 초과 시 이미지 URL부터 버리고 재직렬화 — 리치 화면 일부를 잃더라도
    // 결과 전송 자체가 실패(게스트가 아무것도 못 봄)하는 최악을 막는다. 이미지 없이도 v:2 나머지는 유지.
    let payload = summary;
    let raw = JSON.stringify(summary);
    if (raw.length > 23_000) {
      const drop = (p: typeof summary.first | null) => (p ? { ...p, imageUrl: null } : p);
      payload = { ...summary, first: drop(summary.first)!, second: drop(summary.second), third: drop(summary.third) };
      raw = JSON.stringify(payload);
    }
    if (lastSessionResultRef.current === raw) return;
    lastSessionResultRef.current = raw;
    fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'result', id: sessionId, result: payload }),
    }).catch(() => { /* 실패 무해 */ });
  }, [view, isGroup, sessionId, result, resultThird, resultThirdLabel, purpose, midpointData, treasurer, resultWeather]);


  useEffect(() => {
    if (view === 'result') {
      const startStr = sessionStorage.getItem('mintSessionStart');
      if (startStr) {
        const seconds = Math.round((Date.now() - parseInt(startStr)) / 1000);
        trackSessionDuration(seconds);
        sessionStorage.removeItem('mintSessionStart');
      }
    }
  }, [view]);

  // 혼자 정하기 분위기 단계에서 아래 키워드 영역이 화면 밖에 있을 때만 스크롤 힌트를 보여준다.
  useEffect(() => {
    if (view !== 'steps' || step !== 3 || isGroup) {
      setShowVibeScrollHint(false);
      return;
    }

    const scrollArea = stepScrollRef.current;
    if (!scrollArea) return;
    const updateHint = () => {
      const remaining = scrollArea.scrollHeight - scrollArea.scrollTop - scrollArea.clientHeight;
      setShowVibeScrollHint(remaining > 28);
    };

    const frame = requestAnimationFrame(updateHint);
    const observer = new ResizeObserver(updateHint);
    observer.observe(scrollArea);
    scrollArea.addEventListener('scroll', updateHint, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scrollArea.removeEventListener('scroll', updateHint);
    };
  }, [view, step, isGroup]);

  // 추천 결과 첫 화면에서 아래의 다른 후보·2차 코스를 놓치지 않도록 스크롤을 유도한다.
  useEffect(() => {
    if (view !== 'result' || !result || result.length < 2) return;

    const updateHint = () => {
      const remaining = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      setShowResultScrollHint(window.scrollY < 48 && remaining > 80);
    };

    const frame = requestAnimationFrame(updateHint);
    const observer = new ResizeObserver(updateHint);
    observer.observe(document.documentElement);
    window.addEventListener('scroll', updateHint, { passive: true });
    window.addEventListener('resize', updateHint);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', updateHint);
      window.removeEventListener('resize', updateHint);
    };
  }, [view, result]);

  // 그룹 대기 화면 폴링 — 입력 플로우(steps)에서만. 결과 화면에선 중단(불필요한 3초 폴링 낭비 방지)
  useEffect(() => {
    if (appMode !== 'group' || !sessionId || view !== 'steps') return;
    let active = true;

    async function poll() {
      if (document.hidden) return; // 백그라운드 탭에서는 폴링 중지
      try {
        const res = await fetch(`/api/session?id=${encodeURIComponent(sessionId!)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        if (typeof data.expected_count === 'number') setExpectedCount(data.expected_count);
        if (Array.isArray(data.members)) setGroupMembers(data.members);
      } catch {
        // 폴링 실패는 조용히 무시
      }
    }

    poll();
    const interval = setInterval(poll, 3000);
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [appMode, sessionId, view]);

  // 대기 화면 "지금 추천받기" — 집계(setState) 반영 뒤 다음 렌더에서 추천을 트리거해 stale 상태를 피한다
  useEffect(() => {
    if (!pendingGroupRecommend) return;
    setPendingGroupRecommend(false);
    if (meetingLocation) handleConfirmMeetingLocation(meetingLocation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingGroupRecommend]);

  // 호스트가 링크로 돌아왔을 때(?grp=recommend) 멤버가 모이면 자동으로 추천을 시작
  useEffect(() => {
    if (!isGroup || !sessionId || step !== 2) return;
    if (!new URLSearchParams(window.location.search).has('grp')) return;
    if (groupMembers.length < 2 || !meetingLocation) return;
    try { window.history.replaceState(null, '', '/app'); } catch { /* ignore */ }
    aggregateGroupMembers();
    setPendingGroupRecommend(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGroup, sessionId, step, groupMembers.length]);

  async function handleCreateSession() {
    setCreatingSession(true);
    setGroupError(null);
    try {
      const hasSecond = !!(purpose?.second && purpose.second !== '없음');
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', expected_count: expectedCount, has_second: hasSecond }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '링크 생성에 실패했어요. 다시 시도해주세요.');
      }
      const data = await res.json();
      setSessionId(data.id);
      setGroupMembers([]);
      trackEvent('group_session_create'); // 그룹 바이럴 루프 분해 — 링크 생성 성공 수
      // appMode/step은 그대로(step 2 공유 화면) — 링크가 생기면 같은 화면이 공유 UI로 전환된다
    } catch (e) {
      setGroupError((e as Error).message);
    } finally {
      setCreatingSession(false);
    }
  }

  function handleCopyLink() {
    const link = groupShareLink();
    if (!link) return;
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // 그룹 초대 링크를 카카오톡 UI로 원터치 공유(복사 버튼과 함께 제공 — 카톡 안 쓰는 층은 복사, 쓰는 층은 원터치).
  function handleShareGroupLink() {
    const link = groupShareLink();
    if (!link) return;
    trackEvent('kakao_share');
    const shareText = [
      '🍀 MINT에서 만날 장소 같이 정해요!',
      '',
      '링크 열고 분위기·취향만 30초 고르면 끝.',
      '코스·지역은 이미 정해뒀어요 👇',
    ].join('\n');
    void shareViaKakaoOrFallback(() => ({
      objectType: 'feed',
      content: {
        title: '🍀 MINT | 어디서 만날지 같이 정해요',
        description: '링크 열고 분위기·취향만 고르면 끝. 다같이 만날 장소를 정해요.',
        imageUrl: `${window.location.origin}/image/step5.png`,
        link: { mobileWebUrl: link, webUrl: link },
      },
      buttons: [
        { title: '참여하고 취향 입력하기', link: { mobileWebUrl: link, webUrl: link } },
      ],
    }), shareText, link);
  }

  // 특정 스텝에서 '다음'으로 진행 가능한지 — 스텝바 점프 게이트에도 재사용하려 인자화.
  function canNextAt(s: Step): boolean {
    if (s === 0) {
      // 혼자·그룹 모두 1차 목적(코스)을 골라야 다음으로
      if (appMode === 'solo' || appMode === 'group') return !!purpose?.first;
      return false; // mode-select
    }
    if (s === 1) {
      if (isGroup) return meetingLocation !== null; // 그룹: 지역 선택
      return true; // 혼자: 관계·특별한날은 선택사항
    }
    if (s === 2) {
      // 그룹: 링크 생성 + 2명 이상 입력(호스트도 '내 취향 입력하기'로 자가참여해 멤버로 합류)하면 확정 가능.
      // 전원(expectedCount)을 기다리지 않고 2명만 모여도 추천 진입 가능 — 버튼은 GroupWaiting에서 노출.
      if (isGroup) return !!sessionId && groupMembers.length >= 2;
      // 혼자: 지역·장소
      return meetingLocation !== null && (meetingLocation.type === 'manual' || locations.length >= 2);
    }
    return true; // step 3
  }

  function canNext(): boolean {
    return canNextAt(step);
  }

  // 그룹 링크 생성 후 코스·지역을 바꾸려면 이미 공유된 링크와 어긋난다 → 동의받고 세션을 무효화.
  // (handleBack·스텝바 점프가 공유 헬퍼로 재사용)
  function confirmInvalidateGroupLink(): boolean {
    const ok = window.confirm('코스·지역을 바꾸려면 지금 링크를 취소하고 다시 설정해야 해요.\n계속할까요? (이미 공유한 링크는 무효가 됩니다)');
    if (!ok) return false;
    if (sessionId) cancelGroupSessionOnServer(sessionId); // 서버에도 알려야 옛 링크가 실제로 죽는다
    setSessionId(null);
    setGroupMembers([]);
    try { localStorage.removeItem(GROUP_SESSION_KEY); } catch { /* ignore */ }
    return true;
  }

  // 스텝바 점프 허용 여부: 뒤로는 자유, 앞으로는 solo에서 경유 게이트를 모두 통과할 때만.
  // 결과 화면(view==='result')에선 모든 입력 단계가 '과거'이므로 0~3 전부 점프 가능.
  function canJumpTo(target: number): boolean {
    const t = target as Step;
    const cur = view === 'result' ? 4 : step;
    if (t === cur) return false;
    if (t < cur) return true;
    if (isGroup) return false; // 그룹 forward 점프 금지(집계·링크 흐름 보호)
    for (let k = step; k < t; k++) if (!canNextAt(k as Step)) return false;
    return true;
  }

  // 스텝바 클릭 → 해당 단계로 이동(입력값은 그대로 유지). 결과 화면에서 누르면 입력 화면으로 복귀.
  function handleStepJump(target: number) {
    const t = target as Step;
    if (!canJumpTo(t)) return;
    // 그룹: 활성 링크가 있는데 코스·지역 단계(t<2)로 내려가면 링크 무효화 동의 필요
    if (isGroup && sessionId && t < 2 && (view === 'result' || step >= 2)) {
      if (!confirmInvalidateGroupLink()) return;
    }
    if (view === 'result') { setChangeNote(null); setView('steps'); }
    setStep(t);
  }

  // 처음부터 다시 — 결과·입력 취향을 전부 지우고 첫 화면으로. 파괴적이라 반드시 확인 1회.
  function handleFullReset() {
    if (!window.confirm('추천 결과와 입력한 취향이 모두 지워져요.\n처음부터 다시 시작할까요?')) return;
    clearResultSnapshot();
    try { localStorage.removeItem(INPUT_DRAFT_KEY); sessionStorage.removeItem(INPUT_DRAFT_KEY); localStorage.removeItem(GROUP_SESSION_KEY); } catch { /* ignore */ }
    setResult(null);
    setResultThird(null);
    setResultThirdLabel(null);
    setView('steps');
    setStep(0);
    setAppMode('mode-select');
    setSessionId(null);
    setGroupMembers([]);
    setResultTravelTimes(null);
    setLocations([]);
    setGroupTravelLabels(null);
    setPurpose(null);
    setOccasionChip(null);
    setEtcRelOpen(false);
    setCustomOccasion('');
    setVibe({});
    setBudget(null);
    setKeywords([]);
    setConditions([]);
    setExcludeFoods([]);
    setVibeCustom({});
    setMeetingLocation(null);
    setMidpointData(null);
    setTreasurer(null);
    setResultWeather(null);
    setChangeNote(null);
  }

  // 그룹 확정 진입 직전: 멤버들이 각자 낸 출발지·분위기·취향을 하나로 집계.
  // 코스·지역은 호스트가 정한 state(purpose·meetingLocation)를 그대로 쓴다(재집계하지 않음).
  function aggregateGroupMembers() {
    const withCoords = groupMembers.filter((m) => m.location_lat != null && m.location_lng != null);
    // locations[].name은 '지명'으로 쓰인다 — AI 프롬프트의 "- 출발지: ○○"와 총무 발표("○○에서 출발하는 분")가
    // 이 값을 그대로 읽는다. 사람 이름을 넣으면 "김철수에서 출발하는 분이 오늘의 총무 당첨!"이
    // 결과·게스트 화면·카톡 공유 카드까지 그대로 나간다. 그래서 실제 출발지명(location_name)을 쓴다.
    const groupLocations: LocationEntry[] = withCoords
      .map((m) => ({ name: m.location_name || m.member_name, lat: m.location_lat!, lng: m.location_lng! }));
    setLocations(groupLocations);
    // 반대로 이동시간 표("○○님 25분")의 label은 사람 이름이 맞다 — 같은 배열을 두 용도로 쓰던 걸 여기서 분리한다.
    // groupLocations와 같은 순서·길이라 인덱스로 대응된다.
    setGroupTravelLabels(withCoords.map((m) => m.member_name));
    setVibe(aggregateVibe(groupMembers));
    // 편식은 전원 합집합 — 한 명이라도 못 먹으면 그 음식은 제외. 키워드는 1차/2차 분리 집계.
    const { keywords: memberKeywords, excludeFoods: memberExcludes } = splitMemberKeywords(groupMembers);
    setKeywords(memberKeywords);
    setExcludeFoods(memberExcludes);
    setBudget(aggregateBudget(groupMembers));

    // 혼자 모드 잔여 상태 청소 — 위 5개(locations/vibe/keywords/excludeFoods/budget)는 멤버 집계로 덮이지만,
    // 아래 값들은 덮이지 않아 그대로 그룹 프롬프트에 실려 나간다. 그룹 플로우에는 이 값들을 묻는 화면이 아예 없어서
    // (관계·조건·직접입력 키워드는 혼자 모드 step1/step3 전용) 유저는 자기도 모르게 붙은 조건을 볼 방법이 없다.
    // 실제 사고: "혼자 정할게요 → 관계 '연인' 선택 → 다같이 정할게요"면 6명 모임에 "커플 분위기,
    // 프라이빗하고 조용한 공간 선호"가 붙는다. 입력 초안(INPUT_DRAFT_KEY) 복원 탓에 세션을 넘어서도 살아남는다.
    // 남기는 것: 코스(purpose.first/second/genre)·지역(meetingLocation)·정원 — 호스트가 그룹 화면에서 직접 고른 값이다.
    setConditions([]);
    setVibeCustom({});
    setPurpose((prev) => (prev ? { ...prev, relation: null, occasion: null } : prev));
    setOccasionChip(null);   // 관계·특별한날의 UI 표시도 함께 정리(다시 혼자 모드로 가면 빈 상태로 보이게)
    setCustomOccasion('');
    setEtcRelOpen(false);
  }

  function requestGroupRecommend() {
    // 2명 이상 입력이면 진행. meetingLocation은 step1에서 확정·persist되어 항상 존재.
    if (!meetingLocation || groupMembers.length < 2) return;
    aggregateGroupMembers();
    setPendingGroupRecommend(true);
  }

  function handleNext() {
    // 입력 단계 이탈 퍼널 — 각 스텝을 실제로 통과(전진)한 횟수. 어디서 포기하는지 파악.
    if (step === 0 || step === 1 || step === 2) trackEvent(`step_next_${step}` as 'step_next_0' | 'step_next_1' | 'step_next_2');
    // 그룹: 대기 화면에서 바로 추천으로 진입. 집계 state 반영 뒤 effect에서 추천을 시작한다.
    if (step === 2 && isGroup) {
      requestGroupRecommend();
      return;
    }
    setStep((s) => (s + 1) as Step);
  }

  function handleBack() {
    // 그룹: 링크 생성 후 코스·지역을 바꾸면 이미 공유된 링크의 파라미터와 어긋난다.
    // 공유(step2)에서 뒤로가기는 '링크 취소 후 재설정'으로 처리해 항상 링크=설정이 일치하게 유지.
    if (isGroup && step === 2 && sessionId) {
      if (!confirmInvalidateGroupLink()) return;
      setStep(0); // 코스·지역은 유지 — 수정 후 다시 링크 생성
      return;
    }
    if (step > 0) setStep((s) => (s - 1) as Step);
  }

  function applyCompromiseMessage(msg?: string) {
    // 토스트 표시는 결과 화면 진입 시점의 effect가 맡는다(아래 useEffect).
    // 여기서 켜면 15~30초 로딩 동안 타이머가 만료돼 유저가 한 번도 못 본다(기존 버그).
    // 메시지가 없으면 명시적으로 지워 이전 추천의 안내가 남지 않게 한다(stale 방지).
    setCompromiseMessage(msg ?? null);
    setShowCompromiseToast(false);
  }

  // 중간지점 보완 토스트는 결과가 '보일 때' 떠야 한다 — 추천 요청(로딩) 시점에 켜면 15~30초 로딩 중
  // 타이머가 만료돼 못 본다(기존 버그). setState는 타이머 콜백 안에서만 호출해 이펙트 본문 동기
  // setState(cascading render)를 피하고, 50ms 지연 마운트로 페이드인 트랜지션도 자연스럽게 만든다.
  useEffect(() => {
    if (view !== 'result' || !compromiseMessage) return;
    const showT = setTimeout(() => setShowCompromiseToast(true), 50);
    const hideT = setTimeout(() => setShowCompromiseToast(false), 7050);
    return () => { clearTimeout(showT); clearTimeout(hideT); };
  }, [view, compromiseMessage]);

  function handleConfirmMeetingLocation(loc: MeetingLocation) {
    if (loc.type === 'auto') {
      void handleMidpointSelect();
    } else {
      const region = PRESET_REGIONS.find((r) => r.id === loc.regionId);
      const validLocs = locations.filter((l) => l.lat != null && l.lng != null);
      if (region) {
        void handleMidpointSelect(region);
      } else if (loc.scope && loc.lat != null && loc.lng != null) {
        // 시/구/동 단위로 검색·확정된 지역 — 그 행정단위 범위 안에서만 추천.
        // searchAreas(시=유명상권 여러 곳, 구/동=그 자체)로 네이버를 검색하고,
        // regionScope(matchTokens)로 결과 주소를 그 범위로 고정한다.
        const midpoint = { lat: loc.lat, lng: loc.lng };
        const scope: RegionScope = {
          level: loc.scope.level,
          matchTokens: loc.scope.matchTokens,
          centerLat: loc.lat,
          centerLng: loc.lng,
        };
        setMidpointData({ midpoint, areaName: loc.area, nearestAreas: loc.scope.searchAreas, scope });
        setResultTravelTimes(null);
        applyCompromiseMessage(undefined); // 직접 검색 지역은 중간지점 안내 대상이 아님 — stale 제거
        handleRecommend(midpoint, loc.scope.searchAreas, validLocs, undefined, [], undefined, scope);
      } else if (loc.lat != null && loc.lng != null) {
        // (구버전 폴백) 스코프 없이 좌표만 있는 경우 — 검색한 지역명을 검색어 1순위로.
        const midpoint = { lat: loc.lat, lng: loc.lng };
        const nearby = findNearestAreas(midpoint, 3).filter((a) => a !== loc.area);
        const searchAreas = [loc.area, ...nearby].slice(0, 3);
        setMidpointData({ midpoint, areaName: loc.area, nearestAreas: searchAreas });
        setResultTravelTimes(null);
        applyCompromiseMessage(undefined); // 직접 검색 지역은 중간지점 안내 대상이 아님 — stale 제거
        handleRecommend(midpoint, searchAreas, validLocs);
      } else {
        // 좌표 없는 텍스트만(구버전·자동완성 미선택) — 최후 폴백
        const coords = validLocs.map((l) => ({ lat: l.lat!, lng: l.lng! }));
        const balanced = findBalancedAreas(coords.length >= 1 ? coords : [SEOUL_CENTER]);
        const nearestAreas = findNearestAreas(balanced.midpoint, 3);
        setMidpointData({ midpoint: balanced.midpoint, areaName: loc.area, nearestAreas });
        setResultTravelTimes(null);
        applyCompromiseMessage(balanced.compromiseMessage);
        handleRecommend(balanced.midpoint, nearestAreas, validLocs);
      }
    }
  }

  async function handleMidpointSelect(presetRegion?: PresetRegion) {
    let midpoint: Coordinates;
    let areaName: string;
    const validLocs = locations.filter((l) => l.lat != null && l.lng != null);

    if (presetRegion) {
      midpoint = presetRegion.midpoint;
      areaName = presetRegion.label;
      applyCompromiseMessage(undefined); // 프리셋 지역은 중간지점 계산이 아니므로 이전 안내를 지운다
    } else {
      const coords = validLocs.map((l) => ({ lat: l.lat!, lng: l.lng! }));
      const balanced = findBalancedAreas(coords.length >= 1 ? coords : [SEOUL_CENTER]);
      midpoint = balanced.midpoint;
      areaName = balanced.areaName;
      applyCompromiseMessage(balanced.compromiseMessage);
      // 하이브리드: 빈 구간 스냅이 일어났으면 거리로 좁힌 후보 2곳을 실측 대중교통 시간으로 최종 결정.
      // 실측 왕복이 붙으므로 먼저 로딩 화면을 띄워 빈 대기(1~2초)를 없앤다. 실패 시 거리 결과 그대로.
      if (balanced.snapHubs && balanced.snapHubs.length >= 2 && coords.length >= 1) {
        setLoading(true);
        const chosen = await refineHubByTransit(balanced.snapHubs, coords);
        midpoint = { lat: chosen.lat, lng: chosen.lng };
        areaName = chosen.name;
      }
    }

    const nearestAreas = findNearestAreas(midpoint, 3);
    setMidpointData({ midpoint, areaName, nearestAreas });
    setResultTravelTimes(null);
    handleRecommend(midpoint, nearestAreas, validLocs);
  }

  // 이름이 있는 출발지 중 하나를 무작위로 — 같은 지명이 여러 번 나와도 후보엔 한 번만 넣는다
  // (두 명이 같은 역에서 출발한다고 그 지명이 두 배로 당첨될 이유는 없다).
  function pickTreasurer(locs: LocationEntry[]): string | null {
    const named = [...new Set(locs.map((l) => l.name?.trim()).filter((n): n is string => !!n))];
    if (named.length === 0) return null;
    return named[Math.floor(Math.random() * named.length)];
  }

  async function handleRecommend(
    midpoint: Coordinates,
    nearestAreas: string[],
    validLocs: LocationEntry[],
    vibeWeights?: Record<string, number>,
    excludeNames: string[] = [],
    changeReason?: ChangeReason,
    scope: RegionScope | null = null,
  ) {
    // 실패 시 같은 조건으로 원탭 재시도할 수 있게 이번 호출을 기억해둔다(입력 state는 그대로라 재실행만 하면 됨)
    lastRecommendRef.current = () => { void handleRecommend(midpoint, nearestAreas, validLocs, vibeWeights, excludeNames, changeReason, scope); };
    // 재추천이면 이전 1순위를 기억해뒀다가 "뭐가 달라졌는지" 한 줄에 사용
    const prevFirst = changeReason ? result?.[0] ?? null : null;
    setChangeNote(null);
    // 초기 추천에서 새 세션키 발급, 재시도/거절/조정(changeReason 있음)은 같은 키 유지 → 한 에피소드로 조인
    if (!changeReason || !sessionKeyRef.current) sessionKeyRef.current = newSessionKey();
    setSessionKey(sessionKeyRef.current); // 이후 발생하는 이벤트(클릭·거절·예약)에 자동으로 세션키 태깅
    trackEvent('recommend_request'); // 퍼널 분모: 모든 추천 호출(첫 추천·재추천 공통)
    setLoading(true);
    loadingStartRef.current = Date.now();
    setLoadingProgress(0);
    setError(null);
    setResult(null);
    setResultThird(null);
    setResultThirdLabel(null);

    const msgInterval = setInterval(() => {
      setLoadingMsg((m) => (m + 1) % LOADING_MESSAGE_COUNT);
    }, 1800);

    let aiProgressInterval: ReturnType<typeof setInterval> | null = null;

    try {
      // 혼잡도는 서버가 추천 파이프라인 안에서 병렬 조회 — 클라이언트 선행 왕복 제거
      setLoadingProgress(15);

      const vibeFirst: string[] = [];
      const vibeSecond: string[] = [];
      Object.values(vibe).forEach((g) => {
        g.first.forEach((k) => vibeFirst.push(VIBE_KEY_TO_LABEL[k] ?? k));
        g.second.forEach((k) => vibeSecond.push(VIBE_KEY_TO_LABEL[k] ?? k));
      });
      // 조건은 코스 구분이 없어 1차에 합쳐 보낸다 — API 계약(vibe.first/second 배열)은 그대로다
      conditions.forEach((k) => vibeFirst.push(VIBE_KEY_TO_LABEL[k] ?? k));

      const input: UserInput = {
        // 서버 검증 통과를 위해 이름 없는 항목 제외 (지역 직접 선택 시 빈 배열)
        locations: locations.filter((l) => l.name?.trim()),
        // 그룹 인원은 '실제 제출한 멤버 수'다. expectedCount(호스트가 선언한 정원)를 쓰면
        // 정원 6으로 링크를 만들고 2명만 모여 추천받았을 때 프롬프트에 "인원: 5명 (단체석 또는 넓은 공간 필수)"가
        // 들어가고 검색어에도 단체석 프리픽스가 붙어, 두 명이 단체룸을 추천받는다(화면엔 '2명 참여'라 떠 있다).
        // 다만 결과 화면에서 새로고침한 뒤의 재추천은 폴링이 멈춰 있어 멤버 목록이 비어 있다 —
        // 그때는 인원을 2명으로 축소해버리지 않도록 호스트가 선언한 정원으로 되돌린다.
        groupSize: isGroup
          ? (() => {
              const n = groupMembers.length >= 2 ? groupMembers.length : Math.max(2, expectedCount);
              return n >= 5 ? '5명 이상' : n >= 3 ? '3~4명' : '2명';
            })()
          : groupSize,
        purpose: {
          first: purpose!.first!,
          second: purpose!.second ?? null,
          // 장르 좁히기 — 서버가 검색 키워드 풀을 해당 장르로 좁히고 AI에도 제약 전달
          ...(purpose?.firstGenre ? { firstGenre: purpose.firstGenre } : {}),
          ...(purpose?.secondGenre && purpose.second && purpose.second !== '없음' ? { secondGenre: purpose.secondGenre } : {}),
        },
        vibe: { first: vibeFirst, second: vibeSecond },
        relation: purpose?.relation ?? null,
        occasion: purpose?.occasion?.trim().slice(0, 40) || null,
        budget,
        // 편식 필터 — 서버가 후보 사전 제거 + AI 절대 제약으로 이중 반영 (개수·길이는 서버 검증 한도에 맞춤)
        ...(excludeFoods.length > 0
          ? { excludeFoods: excludeFoods.map((f) => f.trim().slice(0, 20)).filter(Boolean).slice(0, 8) }
          : {}),
        ...(vibeWeights && Object.keys(vibeWeights).length > 0 ? { vibeWeights } : {}),
        ...((() => {
          // 1차 키워드 — 서버 검증 한도(개수 10 · 항목당 30자)에 맞춰 잘라서 전송.
          // "분위기가 별로"(changeReason==='vibe') 재추천에서는 분위기성 라벨을 키워드에서도 빼야 한다.
          // 가중치 1로 낮추기만 하면 서버 프롬프트의 '1차 필수 키워드 ← 최우선'과 네이버 검색어에 그대로 남아
          // 방금 거절한 분위기의 장소가 다시 올라온다("바꿔달라고 했는데 왜 똑같지?").
          const allKw = [...keywords, ...Object.values(vibeCustom).filter(Boolean)]
            .filter((k) => changeReason !== 'vibe' || !ATMOSPHERE_LABELS.has(k.trim()))
            .map((k) => k.trim().slice(0, 30))
            .filter(Boolean)
            .slice(0, 10);
          return allKw.length > 0 ? { keywords: allKw } : {};
        })()),
      };

      // AI 호출 동안 25→90% 타이머 (Claude 응답이 단일 fetch라 내부 진행도 불가)
      aiProgressInterval = setInterval(() => {
        setLoadingProgress((prev) => {
          if (prev >= 92) return prev;
          // 초반엔 빠르게, 92% 가까울수록 느리게 (후처리 분리로 총 소요가 짧아져 살짝 가속)
          const gap = 92 - prev;
          return prev + gap * 0.055;
        });
      }, 250);

      // 실제 마일스톤 2: AI 추천 완료 (재추천 시 이전 장소 제외)
      const { places: recommendation, weather, thirdStop, thirdLabel, serial } = await getAIRecommendation(input, midpoint, [], excludeNames, nearestAreas, scope, sessionKeyRef.current);
      clearInterval(aiProgressInterval);
      setLoadingProgress(100); // 실제 완료

      setResult(recommendation);
      setResultThird(thirdStop ?? null);
      setResultThirdLabel(thirdLabel ?? null);
      setResultWeather(weather);

      // 파일럿 핸드오프 저장 — 유저 비노출. /pilot에서 "○○집으로 추천받은 거 맞아요?" 자동 감지에 사용
      if (serial) {
        try {
          const hasSecond = !!(purpose?.second && purpose.second !== '없음');
          savePilotHandoff({
            serial,
            createdAt: Date.now(),
            conditions: {
              purpose: purpose?.first ?? null,
              relation: purpose?.relation ?? null,
              region: nearestAreas?.[0] ?? locations.find((l) => l.name)?.name ?? null,
              vibes: vibeFirst.slice(0, 3),
              budget: budget ?? null,
            },
            coursePicks: buildCoursePicks(recommendation, hasSecond, thirdStop ?? null),
          });
        } catch { /* 저장 실패해도 추천 흐름엔 무영향 */ }
      }
      if (changeReason) {
        setChangeNote(buildChangeNote(prevFirst, recommendation[0], midpoint, changeReason));
      }

      // 사진·카카오URL 후처리 — 결과를 먼저 그린 뒤 별도 호출로 채운다(초기 로딩 단축).
      // 재추천 레이스 방지용 reqId 가드 (오래된 응답이 새 결과를 덮지 않게). 3차도 함께 보강.
      const enrichId = ++enrichReqRef.current;
      const enrichTargets = [...recommendation, ...(thirdStop ? [thirdStop] : [])];
      enrichPlaces(enrichTargets.map((p) => ({ placeName: p.placeName, lat: p.lat, lng: p.lng, area: p.area, category: p.category })))
        .then((enriched) => {
          if (enrichId !== enrichReqRef.current || enriched.length === 0) return;
          const apply = (p: PlaceRecommendation) => {
            const e = enriched.find((x) => x.placeName === p.placeName);
            return e ? { ...p, kakaoPlaceUrl: e.kakaoPlaceUrl ?? p.kakaoPlaceUrl, imageUrl: e.imageUrl ?? p.imageUrl } : p;
          };
          setResult((prev) => (prev ? prev.map(apply) : prev));
          setResultThird((prev) => (prev ? apply(prev) : prev));
        });

      // 총무 후보는 '이번 추천에 실제로 쓰인 출발지'에서 뽑는다. 재추천(다시 뽑기·취향 조절·거절)은
      // setTreasurer(null) 뒤 validLocs를 인자로 넘겨 다시 들어오므로 state 반영이 늦어도 후보를 놓치지 않는다.
      // 지역 직접 선택 모드는 출발지 입력 화면 자체가 없어 후보가 0개 → null이 되고,
      // 그때는 결과 카드가 '공정 규칙' 폴백 팝업을 띄운다(버튼이 죽지 않게).
      setTreasurer(pickTreasurer(validLocs.length > 0 ? validLocs : locations));
      setView('result');
      trackEvent('recommend_shown'); // 결과가 실제로 렌더된 성공 케이스(퍼널 분자)

      // 자동 중간지점 모드에서만 소요시간 조회 (임의 지역은 UI도 안 뜨므로 호출 생략)
      if (meetingLocation?.type === 'auto' && validLocs.length >= 2) {
        const firstPlace = recommendation[0];
        const secondPlace = recommendation[1];
        const firstDest = firstPlace?.lat && firstPlace.lat !== 0
          ? { lat: firstPlace.lat, lng: firstPlace.lng! }
          : midpoint;
        const secondDest = secondPlace?.lat && secondPlace.lat !== 0
          ? { lat: secondPlace.lat, lng: secondPlace.lng! }
          : undefined;
        // 재추천 직후 이전 응답이 늦게 도착해 옛 장소의 소요시간이 표시되는 레이스 방지
        const reqId = ++travelReqRef.current;
        computeTravelTimes(
          // 이동시간 표의 label만 사람 이름을 쓴다 — locations[].name은 그룹에선 지명(출발지)이라
          // "강남역 25분"처럼 누구 이동시간인지 알 수 없게 된다. 혼자 모드는 groupTravelLabels가 null이라 그대로.
          validLocs.map((l, i) => ({ lat: l.lat!, lng: l.lng!, label: (isGroup ? groupTravelLabels?.[i] : null) || l.name })),
          { first: firstDest, ...(secondDest ? { second: secondDest } : {}) },
        )
          .then((data) => { if (reqId === travelReqRef.current) setResultTravelTimes(data); })
          .catch(() => { if (reqId === travelReqRef.current) setResultTravelTimes(null); });
      } else {
        setResultTravelTimes(null);
      }
    } catch (e) {
      if (aiProgressInterval) clearInterval(aiProgressInterval);
      trackEvent('recommend_error'); // 추천 성공률 관측 — 특정 조건/지역 실패 편중 파악
      setError((e as Error).message || '추천을 가져오지 못했어요. 다시 시도해주세요.');
    } finally {
      clearInterval(msgInterval);
      setLoading(false);
      setLoadingProgress(0);
    }
  }

  // 현재 표시 중인 추천 장소 이름 — 재추천 시 제외 목록으로 전달 (3차 포함)
  function currentExclude(): string[] {
    return [...(result ?? []), ...(resultThird ? [resultThird] : [])]
      .map((r) => r.placeName)
      .filter(Boolean);
  }

  // 🔄 다시 뽑기 = 방금 곳 제외하고 즉시 다른 곳 (조건 그대로, 모달 없음)
  function handleRetry() {
    if (!midpointData) return;
    trackEvent('retry_fresh');
    const validLocs = locations.filter((l) => l.lat != null && l.lng != null);
    const exclude = currentExclude();
    setTreasurer(null);
    setResultTravelTimes(null);
    handleRecommend(midpointData.midpoint, midpointData.nearestAreas, validLocs, undefined, exclude, 'retry', midpointData.scope ?? null);
  }

  // 🎚️ 취향 직접 조절 = 슬라이더 모달 진입
  function handleAdjust() {
    setShowRetryModal(true);
  }

  function handleRetryWithWeights(weights: VibeWeights) {
    setShowRetryModal(false);
    if (!midpointData) return;
    trackEvent('retry_adjust');
    const validLocs = locations.filter((l) => l.lat != null && l.lng != null);
    const exclude = currentExclude();
    const labeledWeights: Record<string, number> = {};
    Object.entries(weights).forEach(([k, v]) => {
      if (k.startsWith('budget:')) {
        labeledWeights[`예산 ${k.slice(7)}`] = v;
      } else {
        labeledWeights[VIBE_KEY_TO_LABEL[k] ?? k] = v;
      }
    });
    setTreasurer(null);
    setResultTravelTimes(null);
    handleRecommend(midpointData.midpoint, midpointData.nearestAreas, validLocs, labeledWeights, exclude, 'adjust', midpointData.scope ?? null);
  }

  function handleReject(reason: 'expensive' | 'far' | 'vibe') {
    if (!midpointData) return;
    // payload: 무엇을 왜 거절했나(현 1순위의 가격대·적합도). session_key로 어떤 추천이었는지 조인 가능.
    const rejected = result?.[0];
    trackEvent(`reject_${reason}`, rejected ? { placeName: rejected.placeName, address: rejected.address, priceRange: rejected.priceRange, fitScore: rejected.fitScore } : undefined);
    const validLocs = locations.filter((l) => l.lat != null && l.lng != null);
    const exclude = currentExclude();
    setTreasurer(null);
    setResultTravelTimes(null);

    // 거절 이유를 labeled weights로 변환해서 AI에 전달
    const rejectWeights: Record<string, number> = {};
    if (reason === 'expensive') {
      // 현재 vibe 유지 + 저렴한 힌트
      Object.values(vibe).forEach((g) => {
        [...g.first, ...g.second].forEach((k) => { rejectWeights[VIBE_KEY_TO_LABEL[k] ?? k] = 3; });
      });
      rejectWeights['저렴한'] = 5;
      rejectWeights['가성비'] = 5;
    } else if (reason === 'far') {
      // 현재 vibe 유지 + 접근성 힌트
      Object.values(vibe).forEach((g) => {
        [...g.first, ...g.second].forEach((k) => { rejectWeights[VIBE_KEY_TO_LABEL[k] ?? k] = 3; });
      });
      rejectWeights['가까운'] = 5;
      rejectWeights['접근하기 쉬운'] = 5;
    } else {
      // vibe 거절: 현재 분위기 weight 낮추고 다른 분위기 탐색
      Object.values(vibe).forEach((g) => {
        [...g.first, ...g.second].forEach((k) => { rejectWeights[VIBE_KEY_TO_LABEL[k] ?? k] = 1; });
      });
      // 그룹에선 vibe에 집계 승자만 남고, 나머지 멤버의 분위기는 keywords로 넘어와 있다.
      // vibe만 낮추면 거절이 절반만 작동하므로 keywords 쪽 분위기 라벨도 함께 내린다
      // (전송 목록에서 빼는 건 handleRecommend가 changeReason==='vibe'로 처리한다).
      keywords.forEach((k) => { if (ATMOSPHERE_LABELS.has(k.trim())) rejectWeights[k.trim()] = 1; });
      rejectWeights['새로운 분위기'] = 5;
    }

    handleRecommend(midpointData.midpoint, midpointData.nearestAreas, validLocs, rejectWeights, exclude, reason, midpointData.scope ?? null);
  }

  async function handleShare() {
    if (!result || result.length === 0) return;
    trackEvent('kakao_share');
    const primary = result[0];
    const mlpUrl = window.location.origin;
    const hasSecond = !!(purpose?.second && purpose.second !== '없음');
    const secondPlace = hasSecond && result.length > 1 ? result[1] : null;

    // 투표 후보 = 1차 메인 + 1차 대안들 (URL 길이를 위해 슬림 포맷: n=이름, c=카테고리, s=적합도)
    const firstCandidates = (hasSecond ? [result[0], result[2], result[3]] : result.slice(0, 3))
      .filter((p): p is PlaceRecommendation => !!p)
      .map((p) => ({ n: p.placeName, c: p.category, s: p.fitScore ?? null }));

    // SharedResult URL — 수신자가 링크 누르면 결과 카드로 바로 이동.
    // ⚠️ 전체 JSON을 쿼리에 싣기 때문에 URL이 너무 길면 일부 환경(카톡/iOS)에서 잘려 수신측 파싱이 깨진다.
    // imageUrl(긴 CDN URL)·kakaoPlaceUrl은 SharedResult에서 각각 가드/미사용이므로 payload에서 빼 URL을 짧게 유지한다.
    const shareId = newShareId();
    // 레거시 슬림 payload(?data=) — 스냅샷 저장 실패 시 폴백. imageUrl·kakaoPlaceUrl은 URL 길이 때문에 제외.
    const sharedData = {
      placeName: primary.placeName,
      category: primary.category,
      description: primary.description,
      vibeTags: primary.vibeTags,
      address: primary.address,
      area: primary.area,
      priceRange: primary.priceRange,
      congestionLevel: primary.congestionLevel,
      lat: primary.lat,
      lng: primary.lng,
      shareId,
      candidates: firstCandidates.length >= 2 ? firstCandidates : undefined,
    };
    const legacyUrl = `${mlpUrl}/shared?data=${encodeURIComponent(JSON.stringify(sharedData))}`;

    // 풀코스 스냅샷을 서버에 저장하고 짧은 링크(/shared?id=)로 공유 → URL 잘림 리스크 제거 + 수신자가 1·2·3차 전체를 봄.
    const slim = (p: PlaceRecommendation) => ({
      placeName: p.placeName, category: p.category, description: p.description,
      priceRange: p.priceRange, vibeTags: p.vibeTags, address: p.address, area: p.area,
      congestionLevel: p.congestionLevel ?? null, lat: p.lat ?? null, lng: p.lng ?? null,
      imageUrl: p.imageUrl ?? null, kakaoPlaceUrl: p.kakaoPlaceUrl ?? null,
    });
    const snapshot = {
      v: 1,
      shareId,
      first: slim(primary),
      second: secondPlace ? slim(secondPlace) : null,
      third: resultThird ? slim(resultThird) : null,
      thirdLabel: resultThird ? (resultThirdLabel ?? '이어서') : null,
      purposeFirst: purpose?.first ?? null,
      purposeSecond: hasSecond ? purpose?.second ?? null : null,
      areaName: midpointData?.areaName ?? null,
      treasurer: treasurer ?? null,
      candidates: firstCandidates.length >= 2 ? firstCandidates : undefined,
    };
    const snapshotSaved = await saveShareSnapshot(shareId, snapshot);
    const sharedUrl = snapshotSaved ? `${mlpUrl}/shared?id=${shareId}` : legacyUrl;

    const mapUrl = (p: typeof primary) =>
      p.lat && p.lng
        ? `https://map.kakao.com/link/to/${encodeURIComponent(p.placeName)},${p.lat},${p.lng}`
        : `https://map.kakao.com/link/search/${encodeURIComponent(p.placeName)}`;

    const primaryMapUrl = mapUrl(primary);
    const secondMapUrl = secondPlace ? mapUrl(secondPlace) : null;

    // 폴백(네이티브 공유/클립보드)용 텍스트 — sharedUrl은 fallbackShare에 따로 넘기므로 본문에서 분리한다.
    const shareText = [
      `🍀 MINT 추천 — ${primary.placeName}`,
      '',
      primary.description,
      '',
      ...(hasSecond && secondPlace
        ? [
            `1차(${purpose!.first}): ${primary.placeName}`,
            `  카카오맵 → ${primaryMapUrl}`,
            '',
            `2차(${purpose!.second}): ${secondPlace.placeName}`,
            `  카카오맵 → ${secondMapUrl}`,
          ]
        : [
            `📍 ${primary.address || primary.area}`,
            `  카카오맵 → ${primaryMapUrl}`,
          ]),
      ...(resultThird ? ['', `3차(${resultThirdLabel ?? '이어서'}): ${resultThird.placeName}`, `  카카오맵 → ${mapUrl(resultThird)}`] : []),
      ...(treasurer ? ['', `🎲 ${treasurer}에서 출발하는 분이 오늘의 총무 당첨!`] : []),
      '',
      '👇 결과 직접 확인',
    ].join('\n');

    void shareViaKakaoOrFallback(() => {
      const thirdDescLine = resultThird ? [`3차(${resultThirdLabel ?? '이어서'}): ${resultThird.placeName}`] : [];
      const descLines = hasSecond && secondPlace
        ? [
            `1차(${purpose!.first}): ${primary.placeName}`,
            `2차(${purpose!.second}): ${secondPlace.placeName}`,
            ...thirdDescLine,
            ...(treasurer ? [`💰 ${treasurer}에서 출발하는 분이 오늘의 총무!`] : []),
          ]
        : [
            primary.description,
            `📍 ${primary.address || primary.area} · 💰 ${primary.priceRange || ''}`,
            ...thirdDescLine,
            ...(treasurer ? [`💰 ${treasurer}에서 출발하는 분이 오늘의 총무!`] : []),
          ];

      const buttons: object[] = [
        { title: '추천 결과 보기', link: { mobileWebUrl: sharedUrl, webUrl: sharedUrl } },
      ];
      if (secondMapUrl) {
        buttons.push({ title: `2차(${purpose!.second}) 카카오맵 보기`, link: { mobileWebUrl: secondMapUrl, webUrl: secondMapUrl } });
      } else {
        buttons.push({ title: '카카오맵에서 보기', link: { mobileWebUrl: primaryMapUrl, webUrl: primaryMapUrl } });
      }

      return {
        objectType: 'feed',
        content: {
          title: `🍀 MINT 추천${hasSecond ? ` | 1차(${purpose!.first}) · 2차(${purpose!.second})` : ` | ${primary.placeName}`}`,
          description: descLines.join('\n'),
          imageUrl: `${mlpUrl}/image/step5.png`,
          link: { mobileWebUrl: sharedUrl, webUrl: sharedUrl },
        },
        buttons,
      };
    }, shareText, sharedUrl);
  }

  // 로딩
  if (loading) {
    const msgs = getLoadingMessages(midpointData?.areaName);
    const elapsed = loadingStartRef.current ? Date.now() - loadingStartRef.current : 0;
    const loadingMessage = elapsed > LOADING_SLOW_MS ? LOADING_SLOW_MESSAGE : msgs[loadingMsg % msgs.length];
    return <LoadingScreen progress={loadingProgress} message={loadingMessage} />;
  }

  // 예약 페이지
  if (view === 'reserve' && result && result.length > 0) {
    return (
      <Reserve
        placeName={result[0].placeName}
        address={result[0].address || result[0].area}
        openingHours={result[0].openingHours ?? ''}
        onBack={() => setView('result')}
      />
    );
  }

  // 추천 결과
  if (view === 'result' && result && result.length > 0) {
    return (
      <div className="min-h-screen bg-[#F5FBF8]">
        {/* 중간 지점 보완 토스트 */}
        {compromiseMessage && (
          <div className={`fixed top-[max(1rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-sm transition-all duration-500 ${showCompromiseToast ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}`}>
            <div className="bg-[#1A7A6E] text-white text-xs font-bold px-4 py-3 rounded-2xl shadow-lg flex items-start gap-2">
              <span className="text-base leading-none mt-0.5">📍</span>
              <span className="leading-snug">{compromiseMessage}</span>
            </div>
          </div>
        )}
        <div className="max-w-md mx-auto px-5 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
          {/* 헤더 3요소: 좌 '조건 수정'(값 유지), 중앙 브랜드 마크(클릭 불가), 우 '처음부터'(확인 후 전체 초기화).
              입력 단계 헤더와 동일 문법: 높이 h-10, 좌우는 같은 소형 텍스트 버튼, 로고는 절대 중앙 정렬.
              -mx-2로 버튼 내부 px-2를 상쇄해 글자 시작선을 콘텐츠 px-5에 맞춘다. */}
          <div className="relative -mx-2 flex h-10 items-center justify-between mb-1">
            <button
              onClick={() => {
                // 결과에서 조건 수정 = 바로 이전 입력 화면(마지막 스텝)으로. 입력값은 그대로 유지해 바로 수정·재추천 가능.
                setChangeNote(null);
                setView('steps');
                setStep(3);
              }}
              className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-bold text-gray-500 transition-colors hover:text-[#2AB5A0]"
            >
              ← 조건 수정
            </button>
            {/* 로고 = 랜딩페이지로 탈출. 좌우 버튼 폭과 무관하게 절대 중앙 정렬. */}
            <button
              onClick={() => { window.location.href = '/'; }}
              aria-label="MINT 홈으로"
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[#2AB5A0] font-black text-2xl tracking-tight select-none active:scale-95 transition-transform"
            >
              MINT
            </button>
            <button
              onClick={handleFullReset}
              className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-bold text-gray-500 transition-colors hover:text-[#2AB5A0]"
              title="처음부터 다시 (입력·결과 초기화)"
            >
              ↺ 처음부터
            </button>
          </div>

          {/* 포인트·찜 바 — 방문 인증 적립 잔액 + 내 찜 목록 진입 */}
          <div className="flex items-center justify-end gap-2 mb-1.5">
            <button
              onClick={() => setShowWishlist(true)}
              aria-label="내 찜 목록"
              className="flex items-center gap-1 rounded-full bg-white border border-gray-200 px-2.5 py-1.5 text-xs font-black text-gray-500 active:scale-95 transition-transform"
            >
              <span className="text-sm leading-none">🤍</span>찜
            </button>
            <PointsBadge balance={pointsBalance} />
          </div>

          {/* 상단 단계바 — 결과 화면에서도 특정 단계를 눌러 바로 수정하러 갈 수 있게(값 유지). */}
          <StepProgress
            current={4}
            total={4}
            labels={isGroup ? ['코스', '지역', '공유', '확정'] : undefined}
            onStepClick={handleStepJump}
            isStepClickable={canJumpTo}
          />

          {/* 날씨 반영 배너 — "모든 변수 반영"을 유저가 체감하게 */}
          {resultWeather && (resultWeather.isRainy || resultWeather.isHot || resultWeather.isCold) && (
            <div className="mb-2 bg-white border border-gray-100 rounded-2xl px-4 py-2.5 flex items-center gap-2 shadow-sm animate-fade-in-up">
              <span className="text-base leading-none">
                {resultWeather.isRainy ? '☔' : resultWeather.isHot ? '🥵' : '🥶'}
              </span>
              <p className="text-xs text-gray-600 leading-relaxed flex-1">
                {resultWeather.isRainy
                  ? `오늘 ${resultWeather.description} 소식이 있어 실내 위주로 골랐어요`
                  : resultWeather.isHot
                    ? `${resultWeather.temp}°C 더운 날씨라 시원한 실내 위주로 골랐어요`
                    : `${resultWeather.temp}°C 추운 날씨라 따뜻한 실내 위주로 골랐어요`}
              </p>
            </div>
          )}

          {/* 재추천 변경점 한 줄 — 이전 결과 대비 뭐가 달라졌는지 */}
          {changeNote && (
            <div className="mb-2 bg-[#E8F8F5] border border-[#3CDBC0]/40 rounded-2xl px-4 py-2.5 flex items-start gap-2 animate-fade-in-up">
              <span className="text-base leading-none mt-0.5">🔁</span>
              <p className="text-xs text-[#1A7A6E] leading-relaxed flex-1">{changeNote}</p>
              <button
                onClick={() => setChangeNote(null)}
                className="text-[#2AB5A0]/60 hover:text-[#2AB5A0] text-xs px-1"
              >
                ✕
              </button>
            </div>
          )}

          <ResultCard
            results={result}
            thirdResult={resultThird}
            thirdLabel={resultThirdLabel}
            travelTimes={resultTravelTimes}
            showTravelTime={meetingLocation?.type === 'auto'}
            midpointAreaName={midpointData?.areaName}
            purpose={purpose?.first ? { first: purpose.first, second: purpose.second ?? null } : undefined}
            vibeLabels={[...Object.values(vibe).flatMap((g) => [...g.first, ...g.second]), ...conditions].map((k) => VIBE_KEY_TO_LABEL[k] ?? k)}
            keywords={keywords}
            genreLabels={[purpose?.firstGenre, purpose?.secondGenre].filter((g): g is string => !!g)}
            excludeFoods={excludeFoods}
            treasurer={treasurer}
            onRetry={handleRetry}
            onAdjust={handleAdjust}
            onReserve={() => setView('reserve')}
            onReject={handleReject}
            onPointsChange={setPointsBalance}
          />

          {/* 하단 sticky 카톡 공유 바 — 유일한 공유 CTA. 결과 어디서든 한 탭(핵심 유입).
              콘텐츠 컨테이너 pb로 마지막 버튼(총무/예약)이 이 바에 가리지 않게 여백 확보됨. */}
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-100 bg-white/95 px-5 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
            <div className="mx-auto max-w-md">
              <button
                onClick={handleShare}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-[#FEE500] text-gray-900 font-black text-base shadow-lg shadow-yellow-200/60 active:scale-95 transition-transform"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.08 2 11.1c0 3.13 1.73 5.9 4.35 7.57V22l3.97-2.18c1.06.29 2.18.44 3.33.44 5.52 0 10-4.08 10-9.1C23.65 6.08 17.52 2 12 2z" />
                </svg>
                카카오톡으로 공유하기
              </button>
            </div>
          </div>

          {showResultScrollHint && (
            <button
              type="button"
              onClick={() => window.scrollBy({ top: Math.max(320, window.innerHeight * 0.55), behavior: 'smooth' })}
              className="fixed bottom-[max(5.5rem,calc(env(safe-area-inset-bottom)+5rem))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-[#3CDBC0]/35 bg-white/95 px-4 py-2.5 text-xs font-bold text-[#2AB5A0] shadow-xl shadow-[#2AB5A0]/20 backdrop-blur"
            >
              {purpose?.second && purpose.second !== '없음'
                ? '아래에 다른 후보와 2차 코스도 있어요'
                : '아래에 다른 후보도 있어요'}
              <span className="animate-bounce text-sm leading-none" aria-hidden>↓</span>
            </button>
          )}

          {showRetryModal && (
            <RetryWeightModal
              vibe={vibe}
              budget={budget}
              onRetryWithWeights={handleRetryWithWeights}
              onClose={() => setShowRetryModal(false)}
            />
          )}

          {showWishlist && <WishlistSheet onClose={() => setShowWishlist(false)} />}
        </div>
      </div>
    );
  }

  // 입력 플로우
  return (
    <div
      className="bg-[#F5FBF8] overflow-hidden"
      style={{
        // 높이는 스텝과 무관하게 항상 동일. step 0→1에서 탭바가 사라져도 컨테이너가
        // 재계산되지 않아 콘텐츠가 튀지 않는다(탭바 자리는 아래 padding-bottom이 흡수).
        height: 'var(--mint-app-height, 100dvh)',
      }}
    >
      {/* step 0(탭바 보임)에서만 AppShell 탭바와 동일한 계산식으로 하단을 padding으로 비워둔다. */}
      <div
        className={`h-full max-w-md mx-auto flex flex-col ${
          step === 0 ? 'pb-[calc(5.5rem+env(safe-area-inset-bottom))]' : ''
        }`}
      >

        {/* 헤더 — 노치/상단 안전영역 반영(인앱·일반 세로모드에선 16px 그대로).
            결과 화면 헤더와 같은 문법: 높이 h-10, 소형 텍스트 버튼, 로고 절대 중앙 정렬.
            좌측 "← 홈"은 결과 화면 로고처럼 랜딩페이지로 탈출, 중앙 로고는 step 0으로 되감기(의도된 비대칭). */}
        <div className="flex-shrink-0 px-5 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="relative -mx-2 flex h-10 items-center justify-center">
            <button
              onClick={() => { window.location.href = '/'; }}
              className="absolute left-0 top-1/2 -translate-y-1/2 flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-bold text-gray-500 transition-colors hover:text-[#2AB5A0]"
              aria-label="홈으로 가기"
            >
              <span aria-hidden>←</span>
              <span>홈</span>
            </button>
            <h1
              className="text-2xl font-black text-[#2AB5A0] tracking-tight cursor-pointer select-none"
              onClick={() => handleStepJump(0)}
            >
              MINT
            </h1>
          </div>
        </div>

        {/* 스텝 프로그레스 — 전 화면 4단계 고정 (그룹은 라벨만 교체) */}
        <div className="flex-shrink-0">
          <StepProgress
            current={step}
            total={4}
            labels={isGroup ? ['코스', '지역', '공유', '확정'] : undefined}
            onStepClick={handleStepJump}
            isStepClickable={canJumpTo}
          />
        </div>

        {/* 스텝 제목 */}
        <div className="flex-shrink-0 text-center px-5 pt-2 pb-0">
          <h2 className="text-xl font-black text-gray-800">
            {step === 0 && (isGroup ? '무슨 코스로 모일까요?' : '어떤 모임인가요?')}
            {step === 1 && (isGroup ? '어디서 만날까요?' : '누구와 함께하나요?')}
            {step === 2 && (isGroup ? '친구들을 초대하세요' : '어디서 만날까요?')}
            {step === 3 && (isGroup ? '다 모였어요!' : '원하는 분위기를 골라봐요')}
          </h2>
          {step === 1 && !isGroup && (
            <p className="text-xs text-gray-400 mt-1">모두 선택사항 · 선택할수록 추천이 정확해져요</p>
          )}
          {step === 1 && isGroup && (
            <p className="text-xs text-gray-400 mt-1">중간지점 자동 · 또는 만날 동네 직접 선택</p>
          )}
          {step === 2 && !isGroup && (
            <p className="text-xs text-gray-400 mt-1">원하는 동네 선택 · 또는 중간지점을 AI에게 맡겨요</p>
          )}
          {step === 2 && isGroup && (
            <p className="text-xs text-gray-400 mt-1">링크를 공유하고 각자 입력을 기다려요</p>
          )}
          {step === 3 && !isGroup && (
            <p className="text-xs text-gray-400 mt-1">프리셋으로 빠르게 고르거나, 직접 취향대로 골라보세요</p>
          )}
          {step === 3 && isGroup && (
            <p className="text-xs text-gray-400 mt-1">모두의 취향이 모였어요 · 추천을 받아보세요</p>
          )}
        </div>

        {/* 콘텐츠 — 짧은 스텝은 세로 중앙정렬(빈 공간 제거), 길면 정상 스크롤 */}
        <div className="relative flex-1 min-h-0">
          <div ref={stepScrollRef} key={step} className="h-full overflow-y-auto animate-fade-in-up">
            <div className="min-h-full flex flex-col justify-center">

          {/* Step 0: 모임 유형 선택 */}
          {step === 0 && (
            <div className="px-5 py-3 flex flex-col gap-4">
              {/* 혼자 / 그룹 선택 버튼 */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  // 혼자 모드로 전환하면 그룹 세션을 확인 없이 버린다 → 서버에도 알려 옛 링크를 죽인다.
                  // (알리지 않으면 이미 공유된 링크가 계속 살아 있고, 그 링크로 제출한 게스트는 결과를 영원히 기다린다)
                  onClick={() => { if (sessionId) cancelGroupSessionOnServer(sessionId); setAppMode('solo'); setSessionId(null); setGroupMembers([]); setGroupError(null); try { localStorage.removeItem(GROUP_SESSION_KEY); } catch { /* ignore */ } }}
                  aria-pressed={appMode === 'solo'}
                  className={`flex flex-col items-center justify-center gap-0.5 py-3 rounded-2xl border transition-all active:scale-[0.97] ${
                    appMode === 'solo'
                      ? 'border-[#3CDBC0] bg-[#E8F8F5]'
                      : 'border-gray-200 bg-white hover:border-[#3CDBC0]/50'
                  }`}
                >
                  <span className="text-lg">🙋</span>
                  <span className={`text-[13px] font-black ${appMode === 'solo' ? 'text-[#2AB5A0]' : 'text-gray-700'}`}>혼자 정할게요</span>
                  <span className="text-[10px] text-gray-400">내가 직접 입력</span>
                </button>
                <button
                  onClick={() => { if (appMode !== 'group') setAppMode('group'); }}
                  aria-pressed={isGroup}
                  className={`flex flex-col items-center justify-center gap-0.5 py-3 rounded-2xl border transition-all active:scale-[0.97] ${
                    isGroup
                      ? 'border-[#3CDBC0] bg-[#E8F8F5]'
                      : 'border-gray-200 bg-white hover:border-[#3CDBC0]/50'
                  }`}
                >
                  <span className="text-lg">👥</span>
                  <span className={`text-[13px] font-black ${isGroup ? 'text-[#2AB5A0]' : 'text-gray-700'}`}>다같이 정할게요</span>
                  <span className="text-[10px] text-gray-400">링크로 친구 취향 모으기 →</span>
                </button>
              </div>

              {/* 다같이 선택 시 미리보기 한 줄 — 진행 전에 그룹 모드가 어떻게 돌아가는지 체감시켜 진입률↑ */}
              {isGroup && (
                <p className="text-xs text-[#2AB5A0] bg-[#E8F8F5] border border-[#3CDBC0]/30 rounded-xl px-3 py-2.5 leading-relaxed animate-fade-in-up break-keep">
                  💡 링크만 공유하면 친구들은 <strong className="font-black">가입 없이 분위기만 30초</strong>. 결과는 단톡방으로 와요!
                </p>
              )}

              {/* Solo: 인원수 + 목적 */}
              {appMode === 'solo' && (
                <>
                  <div>
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">모임 인원수</p>
                    <div className="grid grid-cols-3 gap-2">
                      {(['2명', '3~4명', '5명 이상'] as const).map((size) => (
                        <button
                          key={size}
                          onClick={() => setGroupSize(size)}
                          aria-pressed={groupSize === size}
                          className={`flex items-center justify-center h-10 rounded-xl border text-sm font-bold transition-all active:scale-[0.97] ${
                            groupSize === size
                              ? 'border-[#3CDBC0] bg-[#E8F8F5] text-[#2AB5A0]'
                              : 'border-gray-200 bg-white text-gray-700 hover:border-[#3CDBC0]/50'
                          }`}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </div>
                  <PurposeSelect
                    value={purpose ?? { first: null, firstRaw: null, second: '없음', secondRaw: '없음', relation: null, occasion: null }}
                    onChange={setPurpose}
                  />
                </>
              )}

              {/* Group: 참여 인원수 + 코스(목적) — 호스트가 여기서 코스를 선점 */}
              {isGroup && (
                <>
                  <div>
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">참여 인원수 (호스트 포함)</p>
                    <div className="grid grid-cols-5 gap-2">
                      {[2, 3, 4, 5, 6].map((n) => (
                        <button
                          key={n}
                          onClick={() => setExpectedCount(n)}
                          className={`flex items-center justify-center h-10 rounded-xl border text-sm font-black transition-all active:scale-[0.97] ${
                            expectedCount === n
                              ? 'border-[#3CDBC0] bg-[#E8F8F5] text-[#2AB5A0]'
                              : 'border-gray-200 bg-white text-gray-700 hover:border-[#3CDBC0]/50'
                          }`}
                        >
                          {n === 6 ? '6+' : n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <PurposeSelect
                    value={purpose ?? { first: null, firstRaw: null, second: '없음', secondRaw: '없음', relation: null, occasion: null }}
                    onChange={setPurpose}
                  />
                </>
              )}
            </div>
          )}

          {/* Step 1 (그룹): 만날 지역 — 중간지점 자동 or 임의 지역. 출발지는 게스트가 각자 입력 */}
          {step === 1 && isGroup && (
            <div className="pb-4">
              <MeetingLocationSelect value={meetingLocation} onSelect={setMeetingLocation} />
              <p className="px-5 -mt-1 text-xs text-gray-400 leading-relaxed">
                {meetingLocation?.type === 'auto'
                  ? '참여자들이 각자 출발지를 입력하면 전원 기준 중간지점을 계산해요.'
                  : meetingLocation?.type === 'manual'
                    ? '참여자는 출발지 없이 분위기만 고르면 돼요.'
                    : '중간지점을 맡기거나, 만날 동네를 직접 골라주세요.'}
              </p>
            </div>
          )}

          {/* Step 1 (혼자): 오늘 모임 성격 — 한 줄 4개 (친목/데이트/가족/기타 콕!) */}
          {step === 1 && !isGroup && (() => {
            // relation 값은 recommend.ts의 키워드 매핑과 호환되게 매핑(연인·가족은 전용 키워드 있음)
            const REL_OPTIONS = [
              { key: '친목', relation: '친구들', emoji: '🍻' },
              { key: '데이트', relation: '연인', emoji: '💑' },
              { key: '가족', relation: '가족', emoji: '👨‍👩‍👧' },
            ];
            const curRelation = purpose?.relation ?? null;
            const occChips = curRelation ? (OCCASION_BY_RELATION[curRelation] ?? []) : [];
            const previewHint = occasionChip
              ? (OCCASION_PREVIEW[OCCASION_BY_RELATION[curRelation ?? '']?.find((c) => c.key === occasionChip)?.occasion ?? ''] ?? null)
              : null;
            function pickRel(relation: string) {
              setEtcRelOpen(false);
              setCustomOccasion('');
              setOccasionChip(null); // 관계가 바뀌면 2층 선택 초기화
              setPurpose((prev) => {
                const base = prev ?? { first: null, firstRaw: null, second: '없음', secondRaw: '없음', relation: null, occasion: null };
                // 같은 걸 다시 누르면 해제
                const next = base.relation === relation ? null : relation;
                return { ...base, relation: next, occasion: null };
              });
            }
            // 스텝2 2층 — '특별한 날' 칩. 같은 칩 재클릭 시 해제. occasion 값은 recommend.ts 키에 매핑.
            function pickOccasion(chip: OccChip) {
              setOccasionChip((cur) => {
                const isOff = cur === chip.key;
                setPurpose((prev) => {
                  const base = prev ?? { first: null, firstRaw: null, second: '없음', secondRaw: '없음', relation: null, occasion: null };
                  return { ...base, occasion: isOff ? null : chip.occasion };
                });
                return isOff ? null : chip.key;
              });
            }
            function openEtc() {
              setEtcRelOpen(true);
              setOccasionChip(null);
              setPurpose((prev) => {
                const base = prev ?? { first: null, firstRaw: null, second: '없음', secondRaw: '없음', relation: null, occasion: null };
                return { ...base, relation: null };
              });
            }
            // 기타 콕! 자유 입력 — 메뉴 콕과 동일하게 사용자가 직접 상황을 적어 추천에 반영(occasion으로 전달)
            function handleEtcText(text: string) {
              setCustomOccasion(text);
              setPurpose((prev) => {
                const base = prev ?? { first: null, firstRaw: null, second: '없음', secondRaw: '없음', relation: null, occasion: null };
                return { ...base, occasion: text.trim() ? text : null };
              });
            }
            return (
              <div className="px-5 flex flex-col gap-3 pt-3 pb-4">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">오늘 모임은?</p>
                <div className="grid grid-cols-4 gap-2">
                  {REL_OPTIONS.map((opt) => {
                    const selected = !etcRelOpen && curRelation === opt.relation;
                    return (
                      <button key={opt.key} onClick={() => pickRel(opt.relation)}
                        className={`flex flex-col items-center justify-center gap-1 h-[72px] rounded-2xl border transition-all active:scale-[0.97] ${selected ? 'border-[#3CDBC0] bg-[#E8F8F5]' : 'border-gray-200 bg-white hover:border-[#3CDBC0]/50'}`}>
                        <span className="text-xl leading-none">{opt.emoji}</span>
                        <span className={`text-xs font-bold leading-none ${selected ? 'text-[#2AB5A0]' : 'text-gray-700'}`}>{opt.key}</span>
                      </button>
                    );
                  })}
                  <button onClick={openEtc}
                    className={`flex flex-col items-center justify-center gap-1 h-[72px] rounded-2xl border transition-all active:scale-[0.97] ${etcRelOpen ? 'border-[#3CDBC0] bg-[#E8F8F5]' : 'border-gray-200 bg-white hover:border-[#3CDBC0]/50'}`}>
                    <span className="text-xl leading-none">🎯</span>
                    <span className={`text-xs font-bold leading-none ${etcRelOpen ? 'text-[#2AB5A0]' : 'text-gray-700'}`}>기타 콕!</span>
                  </button>
                </div>

                {/* 2층 — 관계를 고르면 문맥형 '특별한 날' 칩이 부드럽게 등장(선택사항) */}
                {occChips.length > 0 && !etcRelOpen && (
                  <div className="animate-fade-in-up flex flex-col gap-2 pt-1">
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">오늘 좀 특별해요?</p>
                    <div className="grid grid-cols-4 gap-2">
                      {occChips.map((chip) => {
                        const on = occasionChip === chip.key;
                        return (
                          <button key={chip.key} onClick={() => pickOccasion(chip)}
                            className={`flex flex-col items-center justify-center gap-1 h-[64px] rounded-2xl border transition-all active:scale-[0.97] ${on ? 'border-[#3CDBC0] bg-[#E8F8F5]' : 'border-gray-200 bg-white hover:border-[#3CDBC0]/50'}`}>
                            <span className="text-lg leading-none">{chip.emoji}</span>
                            <span className={`text-[11px] font-bold leading-none text-center px-0.5 ${on ? 'text-[#2AB5A0]' : 'text-gray-700'}`}>{chip.key}</span>
                          </button>
                        );
                      })}
                    </div>
                    {/* 살아있는 미리보기 — 선택 효과를 즉시 보여줌(입력 부담 0) */}
                    {previewHint && (
                      <div className="animate-fade-in-up flex items-center gap-1.5 rounded-xl bg-[#E8F8F5] px-3 py-2 mt-0.5">
                        <span className="text-sm">✨</span>
                        <span className="text-[12px] font-medium text-[#2AB5A0] leading-snug">{previewHint}</span>
                      </div>
                    )}
                  </div>
                )}

                {etcRelOpen && (
                  <div className="animate-fade-in-up">
                    <input
                      type="text"
                      autoFocus
                      value={customOccasion}
                      onChange={(e) => handleEtcText(e.target.value)}
                      placeholder="🔎 상황을 직접 적어요 (예: 회식, 상견례, 생일, 졸업)"
                      className={`w-full border rounded-xl px-4 py-3 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-[#3CDBC0] transition-colors ${
                        customOccasion.trim() ? 'border-[#3CDBC0] bg-[#E8F8F5]' : 'border-gray-200'
                      }`}
                    />
                    <p className="text-[11px] text-gray-400 mt-1.5">적은 상황을 반영해 분위기·메뉴를 맞춰 추천해요</p>
                  </div>
                )}

                <p className="text-xs text-gray-400 mt-1">모두 선택사항 · 고를수록 추천이 정확해져요</p>
              </div>
            );
          })()}

          {/* Step 2 (혼자): 만날 장소 선택 */}
          {step === 2 && !isGroup && (
            <div className="pb-4 flex flex-col gap-3">
              <MeetingLocationSelect value={meetingLocation} onSelect={setMeetingLocation} />

              {/* 중간지점(자동) 모드: 출발지 입력 */}
              {meetingLocation?.type === 'auto' && (
                <div className="animate-fade-in-up border-t border-gray-100 pt-2 px-5">
                  <LocationInput locations={locations} onChange={setLocations} />
                </div>
              )}
            </div>
          )}

          {/* Step 2 (그룹): 링크 생성 → 공유 → 실시간 참여 현황 */}
          {step === 2 && isGroup && (
            <div className="px-5 py-3">
              {!sessionId ? (
                <div className="flex flex-col gap-4">
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center">
                    <div className="text-3xl mb-2">🔗</div>
                    <p className="font-black text-gray-800 mb-1">참여 링크를 만들어요</p>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      친구들은 가입 없이 링크만 열면 분위기만 고르면 끝.<br />
                      코스·지역은 이미 골라뒀으니 링크에 담겨 전달돼요.
                    </p>
                  </div>
                  {groupError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 text-center">{groupError}</div>
                  )}
                  <button
                    onClick={handleCreateSession}
                    disabled={creatingSession}
                    className={`w-full py-4 rounded-2xl font-black text-base transition-all active:scale-95 ${
                      creatingSession
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        : 'bg-[#3CDBC0] text-white shadow-lg shadow-[#3CDBC0]/30 hover:bg-[#2AB5A0]'
                    }`}
                  >
                    {creatingSession ? '생성 중...' : '링크 생성하기 →'}
                  </button>
                </div>
              ) : (
                <GroupWaiting
                  shareLink={groupShareLink()}
                  copied={copied}
                  onCopy={handleCopyLink}
                  onKakaoShare={handleShareGroupLink}
                  onRecommend={requestGroupRecommend}
                  members={groupMembers}
                  expectedCount={expectedCount}
                  canRecommend={canNext()}
                  recommending={pendingGroupRecommend || loading}
                />
              )}
            </div>
          )}

          {/* Step 3 (혼자): 분위기 */}
          {step === 3 && !isGroup && (
            <VibeSelect
              value={vibe}
              onChange={setVibe}
              purpose={purpose ? { first: purpose.first, second: purpose.second } : undefined}
              budget={budget}
              onBudgetChange={setBudget}
              keywords={keywords}
              onKeywordsChange={setKeywords}
              conditions={conditions}
              onConditionsChange={setConditions}
              excludeFoods={excludeFoods}
              onExcludeFoodsChange={setExcludeFoods}
            />
          )}

          {/* Step 3 (그룹): 확정 요약 */}
          {step === 3 && isGroup && (
            <div className="px-5 py-3 flex flex-col gap-3">
              <div className="bg-white rounded-2xl border border-[#3CDBC0]/30 shadow-sm p-5">
                <p className="text-[10px] font-bold text-[#2AB5A0] uppercase tracking-widest mb-3">모임 요약</p>
                <div className="flex flex-col gap-2.5 text-sm">
                  <div className="flex gap-2"><span className="text-gray-400 w-12 flex-shrink-0">코스</span>
                    <span className="font-bold text-gray-800">🍀 {purpose?.first ?? '-'}{purpose?.firstGenre ? `(${purpose.firstGenre})` : ''}{purpose?.second && purpose.second !== '없음' ? ` → ${purpose.second}${purpose?.secondGenre ? `(${purpose.secondGenre})` : ''}` : ''}</span>
                  </div>
                  <div className="flex gap-2"><span className="text-gray-400 w-12 flex-shrink-0">지역</span>
                    <span className="font-bold text-gray-800">📍 {meetingLocation?.type === 'auto' ? '중간지점 자동' : meetingLocation?.type === 'manual' ? meetingLocation.area : '-'}</span>
                  </div>
                  <div className="flex gap-2"><span className="text-gray-400 w-12 flex-shrink-0">인원</span>
                    <span className="font-bold text-gray-800">👥 {groupMembers.length}명 참여</span>
                  </div>
                </div>
              </div>

              {/* 모인 취향 */}
              {(() => {
                const vibeLabels = [...Object.values(vibe).flatMap((g) => [...g.first, ...g.second]), ...conditions].map((k) => VIBE_KEY_TO_LABEL[k] ?? k);
                if (vibeLabels.length === 0 && !budget && keywords.length === 0 && excludeFoods.length === 0) return null;
                return (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <p className="text-[10px] font-bold text-[#2AB5A0] uppercase tracking-widest mb-2.5">모두의 취향 (자동 종합)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {vibeLabels.map((l) => <span key={l} className="bg-[#E8F8F5] text-[#2AB5A0] text-xs font-bold px-2.5 py-1 rounded-full">{l}</span>)}
                      {budget && <span className="bg-[#E8F8F5] text-[#2AB5A0] text-xs font-bold px-2.5 py-1 rounded-full">💰 {budget}</span>}
                      {keywords.map((k) => <span key={k} className="bg-[#E8F8F5] text-[#2AB5A0] text-xs font-bold px-2.5 py-1 rounded-full">{k}</span>)}
                      {excludeFoods.map((f) => <span key={f} className="bg-red-50 text-red-500 text-xs font-bold px-2.5 py-1 rounded-full">🚫 {f}</span>)}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
            </div>
          </div>

          {showVibeScrollHint && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center bg-gradient-to-t from-[#F5FBF8] via-[#F5FBF8]/95 to-transparent px-5 pb-2 pt-9">
              <button
                type="button"
                onClick={() => stepScrollRef.current?.scrollBy({ top: 240, behavior: 'smooth' })}
                className="pointer-events-auto flex items-center gap-2 rounded-full border border-[#3CDBC0]/35 bg-white/95 px-4 py-2 text-xs font-bold text-[#2AB5A0] shadow-lg shadow-[#2AB5A0]/15 backdrop-blur"
              >
                키워드·못 먹는 음식도 더 있어요
                <span className="animate-bounce text-sm leading-none" aria-hidden>↓</span>
              </button>
            </div>
          )}
        </div>

        {/* 에러 */}
        {error && (
          <div className="flex-shrink-0 mx-5 mb-2 p-3.5 bg-red-50 border border-red-200 rounded-xl text-center">
            <p className="text-sm text-red-600 leading-snug">{error}</p>
            <p className="mt-1 text-[11px] text-gray-500">입력하신 조건은 그대로 있어요.</p>
            {lastRecommendRef.current && (
              <button
                onClick={() => lastRecommendRef.current?.()}
                className="mt-2.5 w-full py-2.5 rounded-xl bg-[#3CDBC0] text-white text-sm font-black active:scale-95 transition-transform hover:bg-[#2AB5A0]"
              >
                🔄 다시 시도
              </button>
            )}
          </div>
        )}

        {/* 하단 버튼 — 홈 인디케이터/네이티브 툴바와 겹치지 않게 안전영역 반영
            (카톡 인앱 env=0 → 32px 그대로, 일반 브라우저에서만 더 벌어짐) */}
        <div className={`flex-shrink-0 px-5 pt-2 flex flex-col gap-2 ${step === 0 ? 'pb-3' : 'pb-[max(2rem,calc(env(safe-area-inset-bottom)+0.75rem))]'}`}>
          {step < 3 ? (
            <>
              <div className="flex gap-3">
                {step > 0 && (
                  <button
                    onClick={handleBack}
                    className="w-[92px] py-4 rounded-2xl border border-gray-200 bg-white text-gray-500 font-bold text-sm hover:border-gray-300 transition-all active:scale-95"
                  >
                    ← 이전 단계
                  </button>
                )}
                <button
                  onClick={handleNext}
                  disabled={!canNext()}
                  className={`flex-1 py-4 rounded-2xl font-black text-base transition-all duration-300 active:scale-95 ${
                    canNext()
                      ? 'bg-[#3CDBC0] text-white shadow-lg shadow-[#3CDBC0]/30 hover:bg-[#2AB5A0]'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {step === 2 && isGroup && sessionId ? `${groupMembers.length}명으로 추천받기` : '다음'}
                </button>
              </div>
              {!canNext() && (
                <p className="text-xs text-gray-400 text-center">
                  {step === 0 && appMode === 'mode-select' && '혼자 정하기 또는 다같이 정하기를 선택해주세요'}
                  {step === 0 && appMode === 'solo' && '1차 목적을 선택해주세요'}
                  {step === 0 && isGroup && '참여 인원과 1차 코스를 골라주세요'}
                  {step === 1 && isGroup && '만날 지역을 선택해주세요'}
                  {step === 2 && isGroup && !sessionId && '링크를 생성해 친구들에게 공유해주세요'}
                  {step === 2 && isGroup && sessionId && `2명 이상 입력하면 추천으로 진행할 수 있어요 (현재 ${groupMembers.length}명)`}
                </p>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-center text-xs text-gray-400">
                {purpose?.second && purpose.second !== '없음'
                  ? '추천 결과에서 1차 다른 후보와 2차 코스까지 함께 확인할 수 있어요'
                  : '추천 결과에서 1차 다른 후보도 함께 확인할 수 있어요'}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleBack}
                  className="w-[92px] py-4 rounded-2xl border border-gray-200 bg-white text-gray-500 font-bold text-sm hover:border-gray-300 transition-all active:scale-95"
                >
                  ← 이전 단계
                </button>
                <button
                  onClick={() => {
                    if (meetingLocation) handleConfirmMeetingLocation(meetingLocation);
                  }}
                  className="flex-1 py-4 rounded-2xl font-black text-base bg-[#3CDBC0] text-white shadow-lg shadow-[#3CDBC0]/30 hover:bg-[#2AB5A0] transition-all active:scale-95"
                >
                  ✨ 장소 추천받기
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
