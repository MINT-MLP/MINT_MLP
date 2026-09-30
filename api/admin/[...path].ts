import type { VercelRequest, VercelResponse } from '@vercel/node';
import adminData from '../_routes/admin-data.js';

// /api/admin/* 를 받는 어드민 함수. service role을 쓰는 코드라 유저 함수와 배포 단위를 분리한다.
// 인증은 각 핸들러가 한다.

type Handler = (req: VercelRequest, res: VercelResponse) => unknown;

const ROUTES: Record<string, Handler> = {
  data: adminData,
};

export function adminRouteKey(url: string | undefined): string {
  const pathname = new URL(url ?? '/', 'http://localhost').pathname;
  return pathname.replace(/^\/api\/admin\/?/, '').replace(/\/+$/, '');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = ROUTES[adminRouteKey(req.url)];
  if (!route) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  return route(req, res);
}
