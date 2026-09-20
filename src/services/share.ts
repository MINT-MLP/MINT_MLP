// 결과 공유 — 스냅샷 저장(짧은 링크) + 카카오톡 공유 시트 + 폴백(네이티브 공유/클립보드)
import { trackEvent } from '@/services/analytics';

// 공유 투표용 ID (세션 아님 — 공유 클릭마다 새로 발급)
const SHARE_ID_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';
export function newShareId(): string {
  let s = 'sh';
  for (let i = 0; i < 10; i++) s += SHARE_ID_CHARS[Math.floor(Math.random() * SHARE_ID_CHARS.length)];
  return s;
}

// 공유 결과 스냅샷을 서버에 저장 — 1.5초 안에 ok:true여야 짧은 링크(/shared?id=)를 쓴다.
// 실패·타임아웃·오프라인·테이블 미생성(disabled)이면 false → 호출부가 레거시 ?data= URL로 폴백.
export async function saveShareSnapshot(shareId: string, payload: object): Promise<boolean> {
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
export async function fallbackShare(shareText: string, sharedUrl: string) {
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
export async function shareViaKakaoOrFallback(buildPayload: () => object, shareText: string, sharedUrl: string) {
  // iPadOS 13+는 UA가 "Macintosh"로 나오므로 터치 지원(maxTouchPoints)까지 봐서 iPad를 iOS로 포함 —
  // 안 그러면 iPad 홈화면 PWA에서 sendDefault가 조용히 실패한 뒤 폴백 없이 무반응이 된다.
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isStandalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  const skipKakao = isIOS && isStandalone;
  const kakaoKey: string = import.meta.env.VITE_KAKAO_JS_API_KEY ?? '633de41eba4b85734a961345c0f55a7e';

  // v2 SDK는 init() 뒤에야 Share 모듈이 생긴다 — init 전에 Kakao.Share를 검사하면 항상 폴백으로 빠진다.
  if (!skipKakao && kakaoKey && window.Kakao) {
    try {
      if (!window.Kakao.isInitialized()) window.Kakao.init(kakaoKey);
      if (!window.Kakao.isInitialized() || !window.Kakao.Share) throw new Error('kakao init failed');
      window.Kakao.Share.sendDefault(buildPayload());
      return;
    } catch {
      trackEvent('kakao_share_fallback'); // 폴백 비율 관측용
    }
  }
  await fallbackShare(shareText, sharedUrl);
}
