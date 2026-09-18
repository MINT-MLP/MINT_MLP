// 유입 어트리뷰션 — "이 방문자가 어느 광고로 들어왔나"를 문서 로드 시점에 한 번 확정한다.
//
// 왜 main.tsx에서 부르나: utm/fbclid는 최초 문서 URL에만 존재한다. Landing→앱 이동은
// navigateInApp이 pushState('/app')를 하므로 쿼리가 자연히 사라지고, AppShell은 카카오 복귀를
// 판정한 뒤 search를 지운다. React 렌더보다도, 그 어떤 replaceState보다도 먼저 읽어야 유실이 없다.
// 덕분에 /, /app, /join, /shared, /pilot 모든 진입 경로를 이 한 곳이 커버한다.
//
// 이 파일은 analytics/supabase를 import하지 않는다 — 순수 URL 파싱 + localStorage다.
// (여기서 analytics를 동적 import하면 Rollup이 analytics를 entry에서 도달하는 동적 진입점으로 보고
//  supabase 203kB를 index 청크에 통째로 접어 넣는다. 실측으로 index가 188kB→386kB가 됐다.)
// 그래서 entry_view는 여기서 쏘지 않고 "쏠 payload"만 만들어 돌려준다 — 발화는 main.tsx가 한다.
//
// URL은 읽기만 한다. replaceState/pushState/hash를 여기서 절대 건드리지 않는다 —
// AppShell이 카카오 implicit flow 토큰(#access_token)을 해시에 남겨두는 미묘한 계약을 갖고 있어
// 다섯 번째 URL 정리 코드를 끼워 넣으면 로그인이 통째로 깨진다.

const STORE_KEY = 'mint_attr_v1';
const ENTRY_SEEN_KEY = 'mint_entry_seen';

// 30일 — 광고를 보고 며칠 뒤 돌아와 전환하는 사람까지는 같은 소재의 공으로 친다.
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

// 이 값들은 모든 이벤트 payload에 중복 저장된다. 길이 상한은 payload 비대화 방어다.
const MAX_VALUE = 100;
const MAX_REFERRER = 200;
const MAX_CLICK_ID = 40;

// 광고 성과의 분모를 오염시키는 크롤러/프리뷰 봇 패턴.
// `bot`을 단어 경계로 묶는 이유: 맨 부분일치면 CUBOT(실존 안드로이드 브랜드) UA가 봇으로 걸려
// 그 사람의 어트리뷰션도 entry_view도 통째로 사라진다 — 진짜 유입을 버리는 쪽이 훨씬 비싸다.
// `bot/`는 Googlebot/2.1처럼 슬래시로 버전을 붙이는 진짜 크롤러를 잡고, yeti는 네이버 크롤러다.
const BOT_UA = /\bbot\b|bot\/|\byeti\b|spider|crawl|headless|facebookexternal|preview/i;

export interface AttributionRecord {
  source: string;          // 파생 소스 — 집계의 1차 키
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
  fbclid?: string;
  gclid?: string;
  referrer?: string;
  landing?: string;        // 최초 진입 pathname
  capturedAt: number;      // epoch ms — TTL 판정 + entry_view 중복 판정용
}

// 이벤트 payload에 싣는 최소 형태 — 행마다 중복되므로 집계에 실제로 쓰는 4개만 남긴다.
export interface AttributionTag {
  source: string;
  medium?: string;
  campaign?: string;
  content?: string;
}

// 모듈 캐시(undefined = 아직 안 읽음). trackEvent가 이벤트마다 localStorage를 파싱하지 않게 한다.
let cache: AttributionRecord | null | undefined;

// 탭 세션당 1회 발화 보장 — sessionStorage가 막힌 환경(사파리 프라이빗 등)의 최후 방어선
let entryFired = false;

function isBot(): boolean {
  try {
    if (navigator.webdriver === true) return true;
    return BOT_UA.test(navigator.userAgent);
  } catch {
    return false; // UA를 못 읽는 환경이면 사람으로 본다 — 진짜 유입을 버리는 쪽이 더 나쁘다
  }
}

function trim(v: string | null | undefined, max: number): string | undefined {
  if (!v) return undefined;
  const s = v.trim().slice(0, max);
  return s.length > 0 ? s : undefined;
}

// referrer 호스트 → 소스. 유입원이 아닌 것(내부 이동·OAuth 왕복)은 null로 떨궈 direct로 흘린다.
function sourceFromReferrer(referrer: string | undefined): string | null {
  if (!referrer) return null;
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host || host === window.location.hostname) return null;
  // 카카오/구글 로그인 왕복은 "우리가 보낸 사람이 돌아온 것"이지 새 유입이 아니다.
  // supabase.co를 함께 막는 이유: 카카오 로그인이 supabase.auth.signInWithOAuth로 돌아서
  // 마지막 홉 referrer가 <project>.supabase.co다. 저장값이 없는 상태(인앱→외부 브라우저 전환,
  // TTL 만료, 데이터 삭제)에서 이게 유입 소스로 굳으면 그 사람의 이후 퍼널이 통째로 쓰레기 소스로 간다.
  if (host.startsWith('kauth.') || host.startsWith('accounts.') || host.endsWith('.supabase.co')) return null;
  if (host.includes('instagram')) return 'instagram';
  // Meta는 l./lm./m.facebook.com으로, 구글은 google.com/google.co.kr로 흩어져 들어온다.
  // 호스트별로 행이 쪼개지면 표본이 갈라져 소재 비교 자체가 무의미해진다 — 한 소스로 접는다.
  if (host.includes('facebook') || host.includes('fb.')) return 'instagram';
  if (host.includes('kakao')) return 'kakao';
  if (host.includes('naver')) return 'naver';
  if (host.includes('google')) return 'google';
  return host.replace(/^www\./, '');
}

// 지금 URL/referrer에서 어트리뷰션 후보를 만든다. explicit = "광고 클릭이라고 URL이 말하고 있다".
function derive(): { record: AttributionRecord; explicit: boolean } {
  const params = new URLSearchParams(window.location.search);
  const source = trim(params.get('utm_source'), MAX_VALUE);
  const medium = trim(params.get('utm_medium'), MAX_VALUE);
  const campaign = trim(params.get('utm_campaign'), MAX_VALUE);
  const content = trim(params.get('utm_content'), MAX_VALUE);
  const term = trim(params.get('utm_term'), MAX_VALUE);
  const fbclid = trim(params.get('fbclid'), MAX_CLICK_ID);
  const gclid = trim(params.get('gclid'), MAX_CLICK_ID);
  const referrer = trim(document.referrer, MAX_REFERRER);
  // index.html이 카카오톡 인앱 브라우저를 감지하면 URL에 ?from=kakao를 붙여 외부 브라우저를 연다.
  // 외부 브라우저엔 referrer가 아예 없어서, 이 신호를 안 읽으면 카카오 공유 유입이 전부 direct로 세진다.
  const fromParam = trim(params.get('from'), MAX_VALUE);

  // 소스는 캡처 시점에 확정한다 — 어드민이 매번 referrer를 다시 추론하지 않게.
  // fbclid를 instagram으로 보는 이유: 인스타 인앱 브라우저는 referrer가 비거나 l.instagram.com으로만
  // 오고 utm은 광고 URL에 직접 넣지 않으면 실리지 않는다. fbclid는 Meta가 자동 부착하므로
  // "광고를 눌렀다"는 가장 신뢰할 수 있는 신호다.
  const derived = source
    ?? (fbclid ? 'instagram' : undefined)
    ?? (gclid ? 'google_ads' : undefined)
    ?? sourceFromReferrer(referrer)
    ?? (fromParam === 'kakao' ? 'kakao' : undefined)
    ?? 'direct';

  const record: AttributionRecord = { source: derived, capturedAt: Date.now() };
  if (medium) record.medium = medium;
  if (campaign) record.campaign = campaign;
  if (content) record.content = content;
  if (term) record.term = term;
  if (fbclid) record.fbclid = fbclid;
  if (gclid) record.gclid = gclid;
  if (referrer) record.referrer = referrer;
  const landing = trim(window.location.pathname, MAX_VALUE);
  if (landing) record.landing = landing;

  // explicit은 "저장된 소스를 덮어써도 되는가"의 방아쇠다 — 소스를 실제로 확정할 수 있는 신호만 인정한다.
  // utm_campaign만 붙은 링크(Meta 광고 URL 설정에서 흔한 실수)로 재방문하면 derived는 'direct'인데
  // 예전 판정은 explicit=true라, 원래 instagram이던 저장값을 direct로 덮어썼다 — 광고 공이 direct로 샌다.
  // from=kakao도 여기 넣지 않는다: 소스는 알려주되 기존 광고 터치를 지우는 방아쇠가 되면 안 된다.
  return { record, explicit: Boolean(source || fbclid || gclid) };
}

// 같은 광고 터치인가 — 새로고침으로 같은 URL이 다시 캡처돼도 capturedAt을 갱신하지 않기 위한 비교.
// (갱신해버리면 새로고침마다 entry_view가 다시 발화한다.)
function sameTouch(a: AttributionRecord, b: AttributionRecord): boolean {
  return a.source === b.source
    && a.medium === b.medium
    && a.campaign === b.campaign
    && a.content === b.content
    && a.term === b.term
    && a.fbclid === b.fbclid
    && a.gclid === b.gclid;
}

function read(): AttributionRecord | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const rec = parsed as Partial<AttributionRecord>;
    if (typeof rec.source !== 'string' || typeof rec.capturedAt !== 'number') return null;
    if (Date.now() - rec.capturedAt > TTL_MS) {
      localStorage.removeItem(STORE_KEY);
      return null;
    }
    return rec as AttributionRecord;
  } catch {
    return null; // 파싱 실패는 "기록 없음"과 같다 — 다음 캡처가 새로 쓴다
  }
}

function save(rec: AttributionRecord): AttributionRecord {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(rec));
  } catch {
    /* 프라이빗 모드 등 저장 실패 — 이번 로드의 집계만이라도 살린다(반환값은 그대로 쓴다) */
  }
  return rec;
}

// entry_view payload. 탭 세션당 1회다 — 저장 레코드의 capturedAt을 sessionStorage 스탬프로 쓰기 때문에
// 같은 광고 터치가 유지되는 동안엔 새로고침·라우팅으로 다시 만들어지지 않고, 새 광고 클릭으로
// 터치가 갱신되면 그때 딱 한 번 더 만들어진다(문서 로드당 1회가 아니다 — 그게 더 나은 분모다).
// 광고가 /app이나 /join으로 직행하면 landing_view가 안 쏘여 소스별 "유입수" 분모가 통째로 빈다 —
// 그래서 랜딩 여부와 무관하게 탭 세션당 1회를 세는 이벤트가 따로 필요하다.
export interface EntryViewPayload {
  path: string;
  referrer: string;
  has_fbclid: boolean;
  new_touch: boolean;
}

function makeEntryView(active: AttributionRecord, seen: AttributionRecord, newTouch: boolean): EntryViewPayload | null {
  if (entryFired) return null;
  // 탭 세션당 1회. 새로고침·카카오 로그인 왕복은 저장값의 capturedAt이 그대로라 재발화하지 않고,
  // 새 광고 클릭으로 저장값이 갱신되면 capturedAt이 바뀌어 딱 한 번 더 발화한다.
  const stamp = String(active.capturedAt);
  try {
    if (sessionStorage.getItem(ENTRY_SEEN_KEY) === stamp) return null;
    sessionStorage.setItem(ENTRY_SEEN_KEY, stamp);
  } catch {
    /* 저장소가 막힌 환경 — 모듈 플래그(entryFired)만으로 중복을 막는다 */
  }
  entryFired = true;
  return {
    path: seen.landing ?? '/',
    referrer: seen.referrer ?? '',
    has_fbclid: Boolean(seen.fbclid),
    new_touch: newTouch,
  };
}

// main.tsx가 렌더 전에 한 번 부른다. 반환값이 있으면 그대로 entry_view로 쏘면 된다.
export function captureAttribution(): EntryViewPayload | null {
  // 봇은 저장도 entry_view 발화도 하지 않는다. 기존 landing_view 등 다른 이벤트의 수집 동작은
  // 건드리지 않는다 — 지금까지 쌓인 지표와의 연속성이 끊기면 비교가 불가능해진다.
  if (isBot()) return null;

  const stored = read();
  const { record, explicit } = derive();

  // first-touch가 기본이되, 명시적 광고 터치만 예외로 덮는다.
  // 순수 last-touch는 "재방문이 direct로 덮여 광고 성과가 전부 direct로 새는" 최악의 실패에 빠지고,
  // 순수 first-touch는 소재를 바꿔가며 테스트할 때 새 클릭이 옛 소재에 묻힌다.
  // 카카오 왕복 보호는 규칙에 내장돼 있다 — 왕복 URL엔 utm도 클릭 ID도 없다.
  let active: AttributionRecord;
  let newTouch: boolean;
  if (!stored) {
    active = save(record);
    newTouch = true;
  } else if (explicit && !sameTouch(stored, record)) {
    active = save(record);
    newTouch = true;
  } else {
    active = stored;
    newTouch = false;
  }

  cache = active;
  return makeEntryView(active, record, newTouch);
}

// trackEvent가 insert 직전에 부른다. 호출부 63곳은 한 줄도 바뀌지 않는다.
export function getAttr(): AttributionTag | null {
  if (cache === undefined) cache = read();
  const rec = cache;
  if (!rec) return null;
  const tag: AttributionTag = { source: rec.source };
  if (rec.medium) tag.medium = rec.medium;
  if (rec.campaign) tag.campaign = rec.campaign;
  if (rec.content) tag.content = rec.content;
  return tag;
}
