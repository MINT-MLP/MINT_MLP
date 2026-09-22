import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { clientIp, checkRateLimit } from '../_lib/guard.js';
import { verifyAdminPassword } from '../_lib/adminAuth.js';

const FEEDBACK_BUCKET = 'pilot-feedback'; // 인증 이미지(공개)
const PRIZE_BUCKET = 'pilot-prizes';       // 기프티콘(비공개 — 서명 URL로만)
const SIGNED_TTL = 600;                     // 기프티콘 서명 URL 유효기간(초) = 10분

function validPaths(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((p) =>
    typeof p === 'string' &&
    p.length <= 300 &&
    !p.includes('..') &&
    /^[a-z0-9/_\-.]+$/i.test(p)
  );
}

function feedbackPublicUrl(path: string): string {
  const url = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
  return `${url}/storage/v1/object/public/${FEEDBACK_BUCKET}/${encodeURI(path)}`;
}

async function prizeSignedUrl(supabase: SupabaseClient, path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(PRIZE_BUCKET).createSignedUrl(path, SIGNED_TTL);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// 사람이 읽고 부를 수 있는 당첨코드 (혼동문자 제외). 예: MINT-7Q3KP
function makeClaimCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `MINT-${s}`;
}

function makePrizeId(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let id = 'pz';
  for (let i = 0; i < 14; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

type PrizeRow = {
  id: string;
  title: string;
  tier: string;
  image_path: string;
  status: string;
  assigned_feedback_id: string | null;
  claim_code: string | null;
};

/**
 * 원자적 배정 — RPC(claim_pilot_prize) 우선, 미배포 시 코드 폴백.
 * 반환: 배정된 prize 행 | null(재고 없음)
 * 멱등: 같은 feedbackId면 항상 같은 상품.
 */
async function claimPrize(
  supabase: SupabaseClient,
  feedbackId: string,
  claimCode: string,
): Promise<PrizeRow | null> {
  // 1) RPC 우선
  const rpc = await supabase.rpc('claim_pilot_prize', {
    p_feedback_id: feedbackId,
    p_claim_code: claimCode,
  });
  if (!rpc.error) {
    const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
    return (row as PrizeRow) ?? null;
  }
  // RPC 미배포(함수 없음 42883) 등 → 폴백
  if (rpc.error.code && rpc.error.code !== '42883' && rpc.error.code !== 'PGRST202') {
    console.error('[pilot] claim rpc failed', rpc.error);
  }

  // 2) 폴백: 멱등 조회 → available 낚아채기(unique 제약이 이중배정 최종 차단)
  const existing = await supabase
    .from('pilot_prizes').select('*').eq('assigned_feedback_id', feedbackId).limit(1).maybeSingle();
  if (existing.data) return existing.data as PrizeRow;

  for (let attempt = 0; attempt < 5; attempt++) {
    const pick = await supabase
      .from('pilot_prizes').select('*').eq('status', 'available')
      .order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (!pick.data) return null; // 재고 없음
    const row = pick.data as PrizeRow;
    const upd = await supabase
      .from('pilot_prizes')
      .update({ status: 'assigned', assigned_feedback_id: feedbackId, assigned_at: new Date().toISOString(), claim_code: claimCode })
      .eq('id', row.id).eq('status', 'available')
      .select('*').maybeSingle();
    if (upd.data) return upd.data as PrizeRow;
    // 경합으로 놓침(다른 제출이 선점) → 재시도
  }
  return null;
}

// 어드민 인증 — admin-data와 같은 헬퍼(Supabase admin_credentials, 없으면 env ADMIN_PASSWORD 폴백).
// 반환 계약은 그대로 유지: null(통과) | '__unauth__'(401) | 설정오류 메시지(500)
async function requireAdmin(supabase: SupabaseClient, rawBody: Record<string, unknown>): Promise<string | null> {
  const auth = await verifyAdminPassword(supabase, rawBody.password);
  if (auth.ok) return null;
  return auth.reason === 'unauth' ? '__unauth__' : '어드민 비밀번호가 설정되지 않았어요.';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Supabase 설정이 없습니다.' });

  const rawBody = (req.body ?? {}) as Record<string, unknown>;
  const action = typeof rawBody.action === 'string' ? rawBody.action : '';

  // ───────────────────────── 어드민: 제출 데이터 조회 ─────────────────────────
  if (action === 'admin-list') {
    const authErr = await requireAdmin(supabase, rawBody);
    if (authErr === '__unauth__') return res.status(401).json({ error: '비밀번호가 틀렸어요' });
    if (authErr) return res.status(500).json({ error: authErr });

    try {
      const { data, error } = await supabase
        .from('pilot_feedback').select('*')
        .order('created_at', { ascending: false }).limit(500);
      if (error) throw error;

      const feedback = (data ?? []).map((r) => {
        const recPaths = Array.isArray(r.recommendation_image_paths) ? r.recommendation_image_paths : [];
        const payPaths = Array.isArray(r.payment_image_paths) ? r.payment_image_paths : [];
        return {
          id: r.id,
          createdAt: r.created_at,
          fitRating: r.fit_rating,
          fitText: r.fit_text,
          extraText: r.extra_text,
          contact: r.contact,
          sessionKey: r.session_key ?? null,
          selections: r.selections ?? null,
          placeName: r.place_name ?? null,
          claimCode: r.claim_code ?? null,
          serial: r.serial ?? null,
          entryType: r.entry_type ?? null,
          recSnapshot: r.rec_snapshot ?? null,
          visited: r.visited ?? null,
          qaAnswers: r.qa_answers ?? null,
          recommendationImageUrls: recPaths.map(feedbackPublicUrl),
          paymentImageUrls: payPaths.map(feedbackPublicUrl),
        };
      });

      const ratings = feedback.map((f) => Number(f.fitRating)).filter((n) => Number.isFinite(n));
      const distribution = [1, 2, 3, 4, 5].map((score) => ratings.filter((n) => n === score).length);
      const avgFitRating = ratings.length > 0
        ? Math.round((ratings.reduce((s, n) => s + n, 0) / ratings.length) * 10) / 10
        : null;

      return res.status(200).json({ feedback, summary: { count: feedback.length, avgFitRating, distribution } });
    } catch (e) {
      console.error('[pilot-feedback] admin list failed', e);
      return res.status(500).json({ error: '데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.' });
    }
  }

  // ─────────────── 어드민: 기프티콘 업로드용 서명 URL 발급 ───────────────
  if (action === 'admin-prize-upload-url') {
    const authErr = await requireAdmin(supabase, rawBody);
    if (authErr === '__unauth__') return res.status(401).json({ error: '비밀번호가 틀렸어요' });
    if (authErr) return res.status(500).json({ error: authErr });

    const count = Math.min(Math.max(Number(rawBody.count) || 1, 1), 20);
    try {
      const slots: { path: string; token: string }[] = [];
      for (let i = 0; i < count; i++) {
        const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.img`;
        const { data, error } = await supabase.storage.from(PRIZE_BUCKET).createSignedUploadUrl(path);
        if (error || !data) throw error ?? new Error('upload url 실패');
        slots.push({ path: data.path, token: data.token });
      }
      return res.status(200).json({ slots });
    } catch (e) {
      console.error('[pilot-feedback] prize upload-url failed', e);
      return res.status(500).json({ error: '업로드 준비에 실패했어요. private 버킷(pilot-prizes) SQL이 실행됐는지 확인해주세요.' });
    }
  }

  // ─────────────── 어드민: 업로드된 기프티콘을 재고로 등록 ───────────────
  if (action === 'admin-prize-register') {
    const authErr = await requireAdmin(supabase, rawBody);
    if (authErr === '__unauth__') return res.status(401).json({ error: '비밀번호가 틀렸어요' });
    if (authErr) return res.status(500).json({ error: authErr });

    const items = rawBody.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > 20) {
      return res.status(400).json({ error: '등록할 상품이 없어요.' });
    }
    const rows = [];
    for (const it of items) {
      if (!it || typeof it !== 'object') return res.status(400).json({ error: '상품 형식이 올바르지 않아요.' });
      const o = it as Record<string, unknown>;
      const title = typeof o.title === 'string' ? o.title.trim() : '';
      const tier = typeof o.tier === 'string' && o.tier.trim() ? o.tier.trim().slice(0, 20) : 'basic';
      const path = typeof o.path === 'string' ? o.path : '';
      if (!title || title.length > 60 || !validPaths([path])) {
        return res.status(400).json({ error: '상품명/이미지를 확인해주세요.' });
      }
      rows.push({ id: makePrizeId(), title, tier, image_path: path, status: 'available' });
    }
    try {
      const { error } = await supabase.from('pilot_prizes').insert(rows);
      if (error) throw error;
      return res.status(200).json({ ok: true, added: rows.length });
    } catch (e) {
      console.error('[pilot-feedback] prize register failed', e);
      return res.status(500).json({ error: '재고 등록에 실패했어요. 잠시 후 다시 시도해주세요.' });
    }
  }

  // ─────────────── 어드민: 재고/지급 현황 조회 ───────────────
  if (action === 'admin-prize-list') {
    const authErr = await requireAdmin(supabase, rawBody);
    if (authErr === '__unauth__') return res.status(401).json({ error: '비밀번호가 틀렸어요' });
    if (authErr) return res.status(500).json({ error: authErr });

    try {
      const { data, error } = await supabase
        .from('pilot_prizes').select('*')
        .order('created_at', { ascending: false }).limit(500);
      if (error) throw error;

      const prizes = await Promise.all((data ?? []).map(async (r) => ({
        id: r.id,
        title: r.title,
        tier: r.tier,
        status: r.status,
        claimCode: r.claim_code ?? null,
        assignedFeedbackId: r.assigned_feedback_id ?? null,
        assignedAt: r.assigned_at ?? null,
        createdAt: r.created_at,
        imageUrl: await prizeSignedUrl(supabase, r.image_path),
      })));

      const counts = { available: 0, assigned: 0, redeemed: 0, void: 0 };
      for (const p of prizes) if (p.status in counts) counts[p.status as keyof typeof counts]++;

      return res.status(200).json({ prizes, counts });
    } catch (e) {
      console.error('[pilot-feedback] prize list failed', e);
      return res.status(500).json({ error: '재고를 불러오지 못했어요. pilot_prizes SQL이 실행됐는지 확인해주세요.' });
    }
  }

  // ─────────────── 어드민: 재고 void(무효화) ───────────────
  if (action === 'admin-prize-void') {
    const authErr = await requireAdmin(supabase, rawBody);
    if (authErr === '__unauth__') return res.status(401).json({ error: '비밀번호가 틀렸어요' });
    if (authErr) return res.status(500).json({ error: authErr });

    const id = typeof rawBody.id === 'string' ? rawBody.id : '';
    if (!/^pz[a-z0-9]{14}$/i.test(id)) return res.status(400).json({ error: '잘못된 상품이에요.' });
    try {
      const { error } = await supabase.from('pilot_prizes').update({ status: 'void' }).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('[pilot-feedback] prize void failed', e);
      return res.status(500).json({ error: '처리에 실패했어요.' });
    }
  }

  // ─────────────── 유저: 당첨코드로 재수령 ───────────────
  if (action === 'reclaim') {
    const code = typeof rawBody.code === 'string' ? rawBody.code.trim().toUpperCase() : '';
    if (!/^MINT-[A-Z0-9]{5}$/.test(code)) return res.status(400).json({ error: '당첨코드 형식이 올바르지 않아요.' });
    try {
      const prize = await supabase
        .from('pilot_prizes').select('*').eq('claim_code', code)
        .in('status', ['assigned', 'redeemed']).limit(1).maybeSingle();
      if (prize.data) {
        const p = prize.data as PrizeRow;
        const imageUrl = await prizeSignedUrl(supabase, p.image_path);
        return res.status(200).json({ ok: true, prize: { title: p.title, tier: p.tier, imageUrl, claimCode: code } });
      }
      // 배정된 상품은 없지만 제출은 존재 → 품절대기(재고 충전 후 지급 예정)
      const fb = await supabase.from('pilot_feedback').select('id').eq('claim_code', code).limit(1).maybeSingle();
      if (fb.data) return res.status(200).json({ ok: true, pending: true });
      return res.status(404).json({ error: '해당 당첨코드를 찾을 수 없어요.' });
    } catch (e) {
      console.error('[pilot-feedback] reclaim failed', e);
      return res.status(500).json({ error: '조회에 실패했어요. 잠시 후 다시 시도해주세요.' });
    }
  }

  // ─────────────── 유저: 품절대기 건 연락처 저장 ───────────────
  if (action === 'set-contact') {
    const code = typeof rawBody.code === 'string' ? rawBody.code.trim().toUpperCase() : '';
    const contact = typeof rawBody.contact === 'string' ? rawBody.contact.trim() : '';
    if (!/^MINT-[A-Z0-9]{5}$/.test(code) || !contact || contact.length > 100) {
      return res.status(400).json({ error: '연락처를 확인해주세요.' });
    }
    try {
      const { error } = await supabase.from('pilot_feedback').update({ contact }).eq('claim_code', code);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('[pilot-feedback] set-contact failed', e);
      return res.status(500).json({ error: '저장에 실패했어요. 잠시 후 다시 시도해주세요.' });
    }
  }

  // ───────────────────────── 유저: 제출 + 즉시 배정 ─────────────────────────
  const ip = clientIp(req);
  const gate = await checkRateLimit(supabase, 'pilot-submit', ip, 5, 2000);
  if (!gate.allowed) return res.status(429).json({ error: '잠시 후 다시 시도해주세요.' });

  // 어뷰징(한 IP의 재고 털기) 방지 — IP당 하루 지급 상한
  try {
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const { count } = await supabase.from('api_hits').select('*', { count: 'exact', head: true })
      .eq('endpoint', 'pilot-submit').eq('ip', ip).gte('ts', dayAgo);
    if ((count ?? 0) > 8) return res.status(429).json({ error: '오늘은 참여 횟수를 초과했어요. 내일 다시 참여해주세요.' });
  } catch { /* fail-open */ }

  const body = rawBody as {
    id?: string;
    recommendationImagePaths?: unknown;
    paymentImagePaths?: unknown;
    fitRating?: number;
    fitText?: string;
    extraText?: string;
    contact?: string | null;
    sessionKey?: string | null;
    selections?: unknown;
    placeName?: string | null;
    serial?: string | null;
    entryType?: string | null;
    recSnapshot?: unknown;
    visited?: unknown;
    qaAnswers?: unknown;
  };

  const id = (body.id ?? '').trim();
  const fitRating = Number(body.fitRating);
  const fitText = (body.fitText ?? '').trim();
  const extraText = (body.extraText ?? '').trim();
  const contact = typeof body.contact === 'string' ? body.contact.trim() : null;
  const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey.trim().slice(0, 64) : null;
  const placeName = typeof body.placeName === 'string' ? body.placeName.trim().slice(0, 120) : null;
  const serial = typeof body.serial === 'string' && /^[A-Z0-9]{6}$/.test(body.serial.trim().toUpperCase())
    ? body.serial.trim().toUpperCase() : null;
  const entryType = body.entryType === 'auto' ? 'auto' : 'manual';

  const jsonWithin = (v: unknown, max: number): unknown => {
    if (!v || typeof v !== 'object') return null;
    try { return JSON.stringify(v).length <= max ? v : null; } catch { return null; }
  };
  const selections = jsonWithin(body.selections, 2000);
  const recSnapshot = jsonWithin(body.recSnapshot, 4000);
  const visited = jsonWithin(body.visited, 2000);
  const qaAnswers = jsonWithin(body.qaAnswers, 4000);

  // 추천 결과 캡처는 auto 경로(일련번호가 증거)에선 불필요 → 없으면 빈 배열(레거시 NOT NULL 충족)
  const recPaths: string[] = validPaths(body.recommendationImagePaths) ? (body.recommendationImagePaths as string[]) : [];

  if (!/^pf[a-z0-9]{14}$/i.test(id) ||
      !validPaths(body.paymentImagePaths) ||
      !Number.isInteger(fitRating) || fitRating < 1 || fitRating > 5 ||
      fitText.length > 2000 ||
      extraText.length > 2000 ||
      (contact != null && contact.length > 100)) {
    return res.status(400).json({ error: '필수 항목을 확인해주세요.' });
  }

  const claimCode = makeClaimCode();
  const fitTextSafe = fitText || '(후기 없음)'; // fit_text는 레거시 스키마에서 NOT NULL
  try {
    const { error } = await supabase.from('pilot_feedback').insert({
      id,
      recommendation_image_paths: recPaths,
      payment_image_paths: body.paymentImagePaths,
      fit_rating: fitRating,
      fit_text: fitTextSafe,
      extra_text: extraText || null,
      contact,
      session_key: sessionKey,
      selections,
      place_name: placeName,
      claim_code: claimCode,
      serial,
      entry_type: entryType,
      rec_snapshot: recSnapshot,
      visited,
      qa_answers: qaAnswers,
    });
    // 마이그레이션 미실행(신규 컬럼 없음/extra_text NOT NULL) → 레거시 컬럼으로 재시도
    if (error?.code === '42703' || error?.code === '23502') {
      const legacy = await supabase.from('pilot_feedback').insert({
        id,
        recommendation_image_paths: recPaths,
        payment_image_paths: body.paymentImagePaths,
        fit_rating: fitRating,
        fit_text: fitTextSafe,
        extra_text: extraText || fitTextSafe, // 구스키마 NOT NULL 충족
        contact,
      });
      if (legacy.error) throw legacy.error;
    } else if (error) {
      throw error;
    }
  } catch (e) {
    console.error('[pilot-feedback] insert failed', e);
    return res.status(500).json({ error: '제출을 저장하지 못했어요. 잠시 후 다시 시도해주세요.' });
  }

  // 제출 성공 → 그 자리에서 꽝 없는 배정
  let prize: { title: string; tier: string; imageUrl: string | null; claimCode: string } | null = null;
  try {
    const won = await claimPrize(supabase, id, claimCode);
    if (won) {
      prize = {
        title: won.title,
        tier: won.tier,
        imageUrl: await prizeSignedUrl(supabase, won.image_path),
        claimCode,
      };
    }
  } catch (e) {
    console.error('[pilot-feedback] claim failed', e);
  }

  // prize=null이면 재고 소진(품절대기). 어느 경우든 당첨코드는 발급됨.
  return res.status(200).json({ ok: true, prize, claimCode, soldOut: prize === null });
}
