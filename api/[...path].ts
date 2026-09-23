import type { VercelRequest, VercelResponse } from '@vercel/node';
import recommendPrompt from './_routes/recommend-prompt.js';
import congestion from './_routes/congestion.js';
import count from './_routes/count.js';
import feedback from './_routes/feedback.js';
import pilotFeedback from './_routes/pilot-feedback.js';
import reserve from './_routes/reserve.js';
import session from './_routes/session.js';
import shareVote from './_routes/share-vote.js';

// /api/* 전부를 받는 유저 함수. Hobby 플랜은 함수 12개가 상한이라 엔드포인트별 파일 대신 하나로 모은다.
// 핸들러 본문은 api/_routes/, 어드민은 api/admin/[...path].ts.

type Handler = (req: VercelRequest, res: VercelResponse) => unknown;

const ROUTES: Record<string, Handler> = {
  // 프롬프트 전용 실험 중. 네이버 지역검색 파이프라인(_routes/recommend.js)은 약관 검토로 빼 두었다 — 되돌리려면 import를 바꾼다.
  recommend: recommendPrompt,
  congestion,
  count,
  feedback,
  'pilot-feedback': pilotFeedback,
  reserve,
  session,
  'share-vote': shareVote,
  // vercel.json rewrite를 타는 옛 경로
  'session-create': session,
  'session-join': session,
  'session-get': session,
};

// "/api/share-vote?x=1" → "share-vote"
export function routeKey(url: string | undefined): string {
  const pathname = new URL(url ?? '/', 'http://localhost').pathname;
  return pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = ROUTES[routeKey(req.url)];
  if (!route) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  return route(req, res);
}
