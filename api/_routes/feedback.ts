import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { clientIp, checkRateLimit } from '../_lib/guard.js';

// 상시 유저 피드백 수집 — POST only. pilot-feedback.ts 컨벤션(service role, clientIp, 한국어 에러) 그대로.
//
// 이 엔드포인트의 유일한 책임은 "유저가 쓴 문장을 잃지 않는 것"이다.
// 그래서 실패로 끝나는 경로를 최대한 줄였다: id 중복은 성공으로 흡수하고(아웃박스 재전송의 정상 경로),
// 테이블이 아직 없으면 events로 흘려보낸다(마이그레이션 전 배포에서도 한 건도 안 버린다).

const CATEGORIES = ['bug', 'pain', 'idea', 'praise'] as const;
type Category = (typeof CATEGORIES)[number];

function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);
}

// 유저가 직접 쓰지 않은 맥락 필드는 길이가 이상해도 400을 내지 않고 잘라서 담는다.
// 여기서 거절하면 정작 소중한 본문까지 같이 버려진다.
function clip(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Supabase 설정이 없습니다.' });

  // 넉넉하게 잡는다. guard의 perDay는 IP별이 아니라 "엔드포인트 전체"의 일일 상한이라,
  // 광고로 하루 수천 명이 들어오는 상황에서 300은 전 유저의 피드백을 24시간 막아버리는 숫자였다.
  // perMinute도 마찬가지다 — 캐리어 NAT(SKT/KT/LGU+)은 다수 유저가 공인 IP 하나를 공유하므로
  // 분당 3건이면 같은 통신사 유저 4명이 동시에 쓰는 것만으로 4번째가 막힌다.
  // 피드백은 도배당해도 비용이 거의 없고, 막히면 유저의 문장이 조용히 사라진다. 느슨한 쪽이 옳다.
  const ip = clientIp(req);
  const gate = await checkRateLimit(supabase, 'feedback', ip, 12, 5000);
  if (!gate.allowed) return res.status(429).json({ error: '잠시 후 다시 시도해주세요.' });

  const body = (req.body ?? {}) as {
    id?: unknown;
    text?: unknown;
    category?: unknown;
    contact?: unknown;
    context?: unknown;
  };

  const invalid = '내용을 확인해주세요.';
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const contact = typeof body.contact === 'string' ? body.contact.trim() : '';

  // 길이는 반드시 "문자(코드포인트)" 단위로 센다 — DB의 char_length와 같은 단위여야 한다.
  // JS의 text.length는 UTF-16 코드유닛이라 '👍'가 2로 잡히고, 그러면 이모지 하나짜리 피드백이
  // 여기를 통과한 뒤 DB check(char_length=1)에서만 터져 500이 나가고 아웃박스가 영원히 재시도한다.
  const textLen = [...text].length;
  if (!/^fb[a-z0-9]{14}$/.test(id)) return res.status(400).json({ error: invalid });
  if (textLen < 1 || textLen > 500) return res.status(400).json({ error: invalid });
  if (body.category != null && !isCategory(body.category)) return res.status(400).json({ error: invalid });
  if (contact.length > 100) return res.status(400).json({ error: invalid });

  const category: Category | null = isCategory(body.category) ? body.category : null;
  const ctx = (body.context ?? {}) as Record<string, unknown>;
  const route = clip(ctx.route, 120);
  const tab = clip(ctx.tab, 20);
  const sessionKey = clip(ctx.sessionKey, 64);
  const deviceId = clip(ctx.deviceId, 64);
  const viewport = clip(ctx.viewport, 20);

  const rawUa = req.headers['user-agent'];
  const userAgent = clip(Array.isArray(rawUa) ? rawUa[0] : rawUa, 300);

  const row = {
    id,
    text,
    category,
    contact: contact || null,
    route,
    tab,
    session_key: sessionKey,
    device_id: deviceId,
    user_agent: userAgent,
    viewport,
  };

  // 같은 기기가 같은 문장을 아주 짧은 시간 안에 또 보냈다면 연타다. 조용히 접수 처리한다.
  // 창을 5분에서 30초로 줄인 이유: 아웃박스 재전송은 항상 같은 id를 쓰므로 아래 23505가 이미
  // 막는다. 여기 남은 역할은 "연타" 하나뿐인데, 5분이면 "느려요" 같은 짧고 흔한 문장을 다른 화면에서
  // 다시 남긴 정당한 제보까지 삼켜버린다(텍스트만 비교하므로 카테고리·연락처가 달라도 걸린다).
  // 삼켜진 쪽은 200을 받아 아웃박스에서도 지워지므로 어드민에 영영 안 나타난다.
  if (deviceId) {
    const dup = await supabase
      .from('user_feedback').select('id')
      .eq('device_id', deviceId).eq('text', text)
      .gte('created_at', new Date(Date.now() - 30_000).toISOString())
      .limit(1).maybeSingle();
    if (dup.data) return res.status(200).json({ ok: true });
    // dup.error(테이블 미생성 등)는 무시 — 아래 insert가 폴백까지 책임진다.
  }

  const { error } = await supabase.from('user_feedback').insert(row);
  if (!error) return res.status(200).json({ ok: true });

  // 아웃박스가 이미 저장된 건을 다시 보낸 경우 — 재전송의 정상 경로다.
  if (error.code === '23505') return res.status(200).json({ ok: true });

  // sql/user-feedback.sql 미실행(42P01 테이블 없음 / 42703 컬럼 없음) → events로 흘려보낸다.
  // analytics.ts·pilot-feedback.ts의 "수집은 절대 끊기지 않는다" 폴백 철학 그대로.
  if (error.code === '42P01' || error.code === '42703') {
    const fallback = await supabase.from('events').insert({
      type: 'feedback_submit',
      session_key: sessionKey,
      payload: row,
    });
    // events조차 payload/session_key 컬럼이 없는 구스키마면 최소 필드로 한 번 더.
    if (fallback.error) await supabase.from('events').insert({ type: 'feedback_submit' });
    console.warn('[feedback] user_feedback 테이블 없음 — events로 폴백 저장했습니다.');
    return res.status(200).json({ ok: true });
  }

  // 아무리 재시도해도 DB가 받아주지 않을 형식이면 500이 아니라 400을 줘야 한다.
  // 클라이언트는 500을 "지금은 안 되지만 나중엔 된다"로 읽어 아웃박스에 영원히 남기고
  // 앱을 켤 때마다 재시도하며 레이트리밋만 태운다. 400이어야 그 자리에서 정리된다.
  //   23514 check 위반 / 22P05 표현 불가 문자 / 22021 잘못된 바이트열(잘린 서로게이트 등)
  if (error.code === '23514' || error.code === '22P05' || error.code === '22021') {
    console.error('[feedback] 저장 불가 형식 — 재시도해도 소용없어 400으로 정리한다', error.code, error.message);
    return res.status(400).json({ error: invalid });
  }

  console.error('[feedback] insert failed', error);
  return res.status(500).json({ error: '잠시 후 다시 시도해주세요.' });
}
