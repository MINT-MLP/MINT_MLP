import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { clientIp, checkRateLimit } from '../_lib/guard.js';
import { memberIdFromRequest } from '../_lib/recordRecommendation.js';
import { loadRecPayload, ownsRecommendation } from '../_lib/recAccess.js';

// 저장된 추천을 화면에 다시 그리기 위한 조회. 가게 이름은 주지 않는다 — 앱이 슬롯의 검색 호출로 카카오를 다시 찾는다.
// POST { kind:'share', id } | { kind:'session', id } | { kind:'own', recommendationId, claimToken? }
const SHARE_ID_RE = /^[a-z0-9_-]{6,40}$/i;
const SESSION_ID_RE = /^[a-z0-9]{4,32}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: '설정이 준비되지 않았어요.' });

  const gate = await checkRateLimit(supabase, 'restore', clientIp(req), 30, 5000, 'ip');
  if (!gate.allowed) return res.status(429).json({ error: '잠시 후 다시 시도해주세요.' });

  const body = (req.body ?? {}) as Record<string, unknown>;
  let recId: number;
  let sessionId: string | undefined;

  if (body.kind === 'share') {
    const id = String(body.id ?? '');
    if (!SHARE_ID_RE.test(id)) return res.status(400).json({ error: '잘못된 요청이에요.' });
    const { data } = await supabase.from('share_link').select('recommendation_id, expires_at').eq('id', id).maybeSingle();
    const link = data as { recommendation_id: number; expires_at: string } | null;
    if (!link || new Date(link.expires_at).getTime() < Date.now()) {
      return res.status(404).json({ error: '만료됐거나 없는 링크예요.', expired: true });
    }
    recId = link.recommendation_id;
  } else if (body.kind === 'session') {
    const id = String(body.id ?? '');
    if (!SESSION_ID_RE.test(id)) return res.status(400).json({ error: '잘못된 요청이에요.' });
    const { data } = await supabase.from('mint_sessions').select('recommendation_id').eq('id', id).maybeSingle();
    const sessRec = (data as { recommendation_id: number | null } | null)?.recommendation_id ?? null;
    if (!sessRec) return res.status(404).json({ error: '아직 결과가 없어요.' });
    recId = sessRec;
    sessionId = id;
  } else if (body.kind === 'own') {
    const id = Number(body.recommendationId);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '잘못된 요청이에요.' });
    const memberId = await memberIdFromRequest(supabase, req.headers.authorization);
    if (!(await ownsRecommendation(supabase, id, memberId, body.claimToken))) {
      return res.status(403).json({ error: '볼 수 없는 추천이에요.' });
    }
    recId = id;
  } else {
    return res.status(400).json({ error: '잘못된 요청이에요.' });
  }

  // 공유·그룹은 서버가 재검색까지 한다(검색 중심 = 출발지 무게중심이라 내보내면 역산된다)
  const payload = await loadRecPayload(supabase, recId, { sessionId, restoreOnServer: body.kind !== 'own' });
  if (!payload) return res.status(404).json({ error: '추천을 찾을 수 없어요.' });
  return res.status(200).json(payload);
}
