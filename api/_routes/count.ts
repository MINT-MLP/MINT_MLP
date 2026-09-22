import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';

// 랜딩 소셜 프루프용 누적 방문 카운트.
// events 테이블의 landing_view 행 수를 그대로 사용한다 (head+count 쿼리라 데이터 전송 없음).
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) return res.status(200).json({ count: 0 });

    const { count, error } = await supabase
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'landing_view');
    if (error) throw error;

    // CDN 5분 캐시 — 트래픽이 늘어도 DB 부하 없음
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ count: count ?? 0 });
  } catch {
    return res.status(200).json({ count: 0 });
  }
}
