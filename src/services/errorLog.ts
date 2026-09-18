import { supabase } from '@/services/supabase';

// 경량 클라이언트 에러 로깅 — 외부 서비스 없이 Supabase client_errors 테이블로 수집.
// "조용한 고장"(혼잡도 프록시가 프로덕션에서 죽어 있던 것 같은)을 조기에 발견하기 위한 장치.
// 세션당 최대 3건, 같은 메시지는 1회만 전송해 스팸을 막는다.

const MAX_PER_SESSION = 3;
let sent = 0;
const seenMessages = new Set<string>();

function report(message: string, stack?: string) {
  if (sent >= MAX_PER_SESSION) return;
  const key = message.slice(0, 200);
  if (seenMessages.has(key)) return;
  seenMessages.add(key);
  sent++;
  try {
    supabase.from('client_errors').insert({
      message: message.slice(0, 500),
      stack: (stack ?? '').slice(0, 2000),
      url: location.href.slice(0, 300),
      ua: navigator.userAgent.slice(0, 300),
    }).then(() => {});
  } catch { /* 로깅 실패는 무시 */ }
}

export function initErrorLogging() {
  window.addEventListener('error', (e) => {
    report(e.message ?? 'unknown error', e.error?.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    report(
      reason instanceof Error ? reason.message : String(reason ?? 'unhandled rejection'),
      reason instanceof Error ? reason.stack : undefined,
    );
  });
}
