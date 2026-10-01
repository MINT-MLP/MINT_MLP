import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { clientIp, checkRateLimit } from '../_lib/guard.js';
import { memberIdFromRequest } from '../_lib/recordRecommendation.js';
import { ownsRecommendation } from '../_lib/recAccess.js';

// 공유 결과 페이지 멤버 투표.
// GET  ?id=<shareId>            → { counts: { [choice]: number } } (테이블 미생성/오류 시 { disabled: true })
// POST { shareId, voterId, choice } → { ok: true } (같은 voter 재투표는 upsert로 교체). choice는 1차 슬롯 순서(대표, 대안1, 대안2)
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
    const body = (req.body ?? {}) as { type?: string; shareId?: string; voterId?: string; choice?: number; payload?: unknown; recommendationId?: unknown; claimToken?: unknown };

    // 공유 링크 — { type:'link', shareId, recommendationId, claimToken? }. 내 추천만 공유할 수 있다(회원 토큰 또는 일회용 토큰).
    // 저장은 추천 ID뿐. 링크를 연 쪽은 /api/restore로 슬롯을 받아 재검색한다.
    if (body.type === 'link') {
      const linkId = String(body.shareId ?? '');
      const recId = Number(body.recommendationId);
      if (!ID_RE.test(linkId) || !Number.isInteger(recId) || recId <= 0) return res.status(400).json({ error: '잘못된 요청이에요.' });
      // 레이트리밋과 회원 확인을 동시에 — 공유 버튼이 기다리는 시간을 줄인다
      const [gate, memberId] = await Promise.all([
        checkRateLimit(supabase, 'share-link', clientIp(req), 10, 2000),
        memberIdFromRequest(supabase, req.headers.authorization),
      ]);
      if (!gate.allowed) return res.status(429).json({ error: '잠시 후 다시 시도해주세요.' });
      if (!(await ownsRecommendation(supabase, recId, memberId, body.claimToken))) {
        return res.status(403).json({ error: '공유할 수 없는 추천이에요.' });
      }
      const { error } = await supabase.from('share_link').upsert({ id: linkId, recommendation_id: recId }, { onConflict: 'id', ignoreDuplicates: true });
      if (error) {
        console.error('[share-vote] share_link insert failed', error.message);
        return res.status(200).json({ ok: false });
      }
      return res.status(200).json({ ok: true });
    }

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
