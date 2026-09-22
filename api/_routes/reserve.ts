import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';

// 예약(오픈 알림) 수요 기록 — 기존 클라이언트 anon insert를 서버 경유로 이전.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const body = (req.body ?? {}) as {
    placeName?: string;
    address?: string;
    guestName?: string;
    people?: string;
  };

  const placeName = (body.placeName ?? '').trim();
  const guestName = (body.guestName ?? '').trim();
  const people = (body.people ?? '').trim();
  if (!placeName || !guestName || !people ||
      placeName.length > 100 || guestName.length > 30 || people.length > 10 ||
      (body.address ?? '').length > 200) {
    return res.status(400).json({ error: '입력값이 올바르지 않아요.' });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Supabase 설정이 없습니다.' });

  try {
    const { error } = await supabase.from('reservations').insert({
      id: Date.now().toString(),
      place_name: placeName,
      address: body.address ?? '',
      guest_name: guestName,
      people,
      arrival_time: '-',
      created_at: new Date().toISOString(),
    });
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[reserve] insert failed', e);
    return res.status(500).json({ error: '신청을 저장하지 못했어요. 잠시 후 다시 시도해주세요.' });
  }
}
