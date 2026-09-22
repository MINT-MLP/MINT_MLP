import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { clientIp, checkRateLimit } from '../_lib/guard.js';

// 공유 결과 페이지 멤버 투표.
// GET  ?id=<shareId>            → { counts: { [choice]: number } } (테이블 미생성/오류 시 { disabled: true })
// POST { shareId, voterId, choice, placeName } → { ok: true } (같은 voter 재투표는 upsert로 교체)
const ID_RE = /^[a-z0-9_-]{6,40}$/i;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(200).json({ disabled: true });

  if (req.method === 'GET') {
    const id = String(req.query.id ?? '');
    if (!ID_RE.test(id)) return res.status(400).json({ error: '잘못된 요청이에요.' });

    // 결과 스냅샷 조회 — ?id=&type=snapshot (공유 링크 /shared?id=)
    if (req.query.type === 'snapshot') {
      const { data, error } = await supabase
        .from('mint_share_snapshots')
        .select('payload')
        .eq('share_id', id)
        .maybeSingle();
      if (error) return res.status(200).json({ disabled: true }); // 테이블 미생성 등 → 클라 폴백
      if (!data) return res.status(404).json({ error: '공유 링크를 찾을 수 없어요.' });
      return res.status(200).json({ payload: data.payload });
    }

    const { data, error } = await supabase
      .from('mint_share_votes')
      .select('choice')
      .eq('share_id', id)
      .limit(500);
    // 테이블 미생성 등 — 투표 기능만 조용히 끈다 (공유 페이지 본문은 정상 동작)
    if (error) return res.status(200).json({ disabled: true });
    const counts: Record<number, number> = {};
    for (const row of data ?? []) counts[row.choice] = (counts[row.choice] ?? 0) + 1;
    return res.status(200).json({ counts });
  }

  if (req.method === 'POST') {
    const body = (req.body ?? {}) as { type?: string; shareId?: string; voterId?: string; choice?: number; placeName?: string; payload?: unknown };

    // 결과 스냅샷 저장 — { type:'snapshot', shareId, payload }
    if (body.type === 'snapshot') {
      const snapId = String(body.shareId ?? '');
      const payload = body.payload;
      if (!ID_RE.test(snapId) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return res.status(400).json({ error: '잘못된 요청이에요.' });
      }
      let raw = '';
      try { raw = JSON.stringify(payload); } catch { /* noop */ }
      if (!raw || raw.length > 20_000) return res.status(400).json({ error: '공유 데이터가 너무 커요.' });

      const gate = await checkRateLimit(supabase, 'share-snapshot', clientIp(req), 10, 2000);
      if (!gate.allowed) return res.status(429).json({ error: '잠시 후 다시 시도해주세요.' });

      // 같은 id 덮어쓰기 금지(선점 우선) — 공유 클릭마다 새 id라 충돌 없음
      const { error } = await supabase
        .from('mint_share_snapshots')
        .upsert({ share_id: snapId, payload }, { onConflict: 'share_id', ignoreDuplicates: true });
      if (error) {
        console.error('[share-vote] snapshot insert failed', error);
        return res.status(200).json({ ok: false, disabled: true }); // 테이블 미생성 → 클라가 ?data= 폴백
      }
      return res.status(200).json({ ok: true });
    }

    const shareId = String(body.shareId ?? '');
    const voterId = String(body.voterId ?? '');
    const choice = Number(body.choice);
    if (!ID_RE.test(shareId) || !ID_RE.test(voterId) || !Number.isInteger(choice) || choice < 0 || choice > 5) {
      return res.status(400).json({ error: '잘못된 요청이에요.' });
    }

    const gate = await checkRateLimit(supabase, 'share-vote', clientIp(req), 20, 5000);
    if (!gate.allowed) return res.status(429).json({ error: '잠시 후 다시 시도해주세요.' });

    const { error } = await supabase
      .from('mint_share_votes')
      .upsert(
        {
          share_id: shareId,
          voter_id: voterId,
          choice,
          place_name: typeof body.placeName === 'string' ? body.placeName.slice(0, 80) : null,
        },
        { onConflict: 'share_id,voter_id' },
      );
    if (error) {
      console.error('[share-vote] upsert failed', error);
      return res.status(200).json({ ok: false, disabled: true });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
