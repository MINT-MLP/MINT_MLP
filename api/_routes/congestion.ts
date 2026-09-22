import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchCongestion, UNKNOWN_CONGESTION } from '../_lib/congestion.js';

// 서울 실시간 도시데이터(citydata_ppltn) 혼잡도 조회.
// 기존에는 클라이언트가 vite dev 프록시(/api/seoul)로 직접 호출했는데, 그 프록시는
// 개발 서버 전용이라 프로덕션에서는 항상 실패("알 수 없음" 폴백)했다. 서버리스로 이전.
// 키는 서버 env(SEOUL_DATA_API_KEY) 우선, 과거 클라이언트용 VITE_ 키를 폴백으로 허용.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const raw = Array.isArray(req.query.areas) ? req.query.areas[0] : req.query.areas;
  const areas = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);

  if (areas.length === 0) return res.status(400).json({ error: 'areas 파라미터가 필요해요.' });

  const key = (process.env.SEOUL_DATA_API_KEY ?? process.env.VITE_SEOUL_DATA_API_KEY ?? '').trim();
  if (!key) {
    return res.status(200).json({ areas: areas.map(UNKNOWN_CONGESTION) });
  }

  const results = await fetchCongestion(areas);
  // 혼잡도는 분 단위로 변하므로 CDN 2분 캐시
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
  return res.status(200).json({ areas: results });
}
