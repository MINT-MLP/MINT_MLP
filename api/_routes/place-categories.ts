import type { VercelRequest, VercelResponse } from '@vercel/node';
import { loadPlaceCategories } from '../_lib/placeCategory.js';

// 장소 카테고리 선택 목록. place_category의 비브랜드 행을 그대로 내려준다(우리 분류표라 공개 무방).
// 클라이언트가 목적(밥/술/카페)별로 걸러 칩을 그린다. 10분 캐시.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const c = await loadPlaceCategories();
  const categories = (c?.rows ?? [])
    .filter((r) => !r.is_brand && r.depth1 === '음식점' && r.depth2)
    .map((r) => ({ id: r.id, depth2: r.depth2, depth3: r.depth3, depth4: r.depth4 }))
    .sort((a, b) => a.depth2.localeCompare(b.depth2, 'ko') || a.depth3.localeCompare(b.depth3, 'ko') || a.depth4.localeCompare(b.depth4, 'ko'));
  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=600');
  return res.status(200).json({ categories });
}
