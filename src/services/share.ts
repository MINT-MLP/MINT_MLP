// 결과 공유 — 스냅샷 저장(짧은 링크) + 카카오톡 공유 시트 + 폴백(네이티브 공유/클립보드)
import { trackEvent } from '@/services/analytics';
import { supabase } from '@/services/supabase';

// 공유 투표용 ID (세션 아님 — 공유 클릭마다 새로 발급)
const SHARE_ID_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';
export function newShareId(): string {
  let s = 'sh';
  for (let i = 0; i < 10; i++) s += SHARE_ID_CHARS[Math.floor(Math.random() * SHARE_ID_CHARS.length)];
  return s;
}

// 공유 링크 저장(010) — 가게 정보 대신 저장된 추천 ID만 서버에 남긴다. 4초 안에 ok:true여야 짧은 링크를 쓴다.
// 내 추천인지 서버가 확인한다(회원 토큰 또는 비회원 일회용 토큰). 실패하면 호출부가 레거시 ?data= URL로 폴백.
export async function saveShareLink(shareId: string, recommendationId: number, claimToken?: string): Promise<boolean> {
  if (navigator.onLine === false) return false;
  try {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const ctrl = new AbortController();
    // 서버가 레이트리밋·회원 확인·소유 확인을 거쳐 1.5초로는 빠듯하다(콜드 스타트 포함). 넘기면 1차만 담긴 옛 링크로 폴백
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch('/api/share-vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ type: 'link', shareId, recommendationId, ...(claimToken ? { claimToken } : {}) }),
      signal: ctrl.signal,
    });
    // clearTimeout은 본문 파싱까지 끝난 뒤에 — 느린 망에서 바디 읽기가 늘어지면 abort되어 폴백하도록.
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
