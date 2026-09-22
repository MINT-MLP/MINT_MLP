import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clientIp, checkRateLimit } from '../_lib/guard.js';

// ── 그룹 세션 단일 엔드포인트 ────────────────────────────────────────────────
// Vercel Hobby 플랜의 서버리스 함수 상한(12개)에 딱 차서 새 기능을 못 붙이는 상태였다.
// 원래 session-create / session-join / session-get(+result 저장 POST) 3개 함수였던 것을
// 이 파일 하나로 합쳐 여유를 만든다. 각 분기 로직은 원본 그대로 이식했고
// 로그 태그([session-create] 등)와 rate limit 키도 Vercel 로그·api_hits 이력 연속성을 위해 유지한다.
//
// 라우팅은 "경로"가 아니라 "메서드 + 바디 필드"로만 판별한다.
// vercel.json의 rewrite로 옛 경로(/api/session-create 등)가 여기로 들어오기 때문에
// 원경로 헤더에 의존하면 안 된다.

const ID_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';

function randomId(len = 8): string {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  }
  return s;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const url = (process.env.SUPABASE_URL ?? '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!url || !key) {
    return res.status(500).json({ error: 'Supabase 설정이 없습니다.' });
  }
  const supabase = createClient(url, key);

  if (req.method === 'GET') return handleGet(req, res, supabase);

  const body = (req.body ?? {}) as Record<string, unknown>;

  // 1) 신 번들은 action을 명시해 보낸다 — 명시가 추론을 이겨야 로그만 보고 디버깅이 된다.
  const action = typeof body.action === 'string' ? body.action : '';
  if (action === 'create') return handleCreate(req, res, supabase);
  if (action === 'join') return handleJoin(req, res, supabase);
  if (action === 'result') return handleResult(req, res, supabase);
  // cancel은 action 명시로만 받는다. 바디가 { id } 하나뿐이라 필드 추론에 끼워 넣으면
  // 다른 분기(특히 result)와 구분이 안 되고, 남의 세션을 죽이는 오폭 통로가 된다.
  if (action === 'cancel') return handleCancel(req, res, supabase);

  // 2) action이 없으면 필드로 추론한다 — rewrite를 타고 들어온 옛 번들 호환용 폴백이다.
  //    세 바디의 판별 키는 실측상 상호 배타적이다.
  //    result 판별에 id를 쓰지 않는 이유: id는 너무 흔해 오판 위험이 크다.
  if (body.session_id !== undefined) return handleJoin(req, res, supabase);
  if (body.result !== undefined) return handleResult(req, res, supabase);
  if (body.expected_count !== undefined) return handleCreate(req, res, supabase);

  // 옛 create는 빈 바디도 기본값 2로 만들어줬지만, 여기선 400이다.
  // 실제 클라는 항상 expected_count를 보내므로 회귀가 없고,
  // 빈 바디를 create로 기본 라우팅하면 의도치 않은 세션 대량 생성 통로가 열린다.
  return res.status(400).json({ error: '잘못된 요청이에요.' });
}

// ── create: 그룹 세션 생성 (구 api/session-create.ts) ────────────────────────
async function handleCreate(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient) {
  try {
    const body = (req.body ?? {}) as { expected_count?: number; has_second?: boolean };
    const expected = Math.min(6, Math.max(2, Number(body.expected_count) || 2));
    const has_second = body.has_second === true;

    for (let attempt = 0; attempt < 3; attempt++) {
      const id = randomId();
      const { error } = await supabase
        .from('mint_sessions')
        .insert({ id, expected_count: expected, status: 'waiting', has_second });

      if (!error) return res.status(200).json({ id });
      if (error.code !== '23505') {
        // has_second 컬럼 없으면 fallback
        if (error.code === '42703') {
          const { error: e2 } = await supabase
            .from('mint_sessions')
            .insert({ id, expected_count: expected, status: 'waiting' });
          if (!e2) return res.status(200).json({ id });
        }
        console.error('[session-create] insert failed', error);
        return res.status(500).json({ error: '링크 생성에 실패했어요. 잠시 후 다시 시도해주세요.' });
      }
    }

    return res.status(409).json({ error: '세션 ID 생성에 실패했어요. 다시 시도해주세요.' });
  } catch (e) {
    console.error('[session-create] failed', e);
    return res.status(500).json({ error: '링크 생성에 실패했어요. 잠시 후 다시 시도해주세요.' });
  }
}

// ── join: 게스트 참여 제출 (구 api/session-join.ts) ──────────────────────────
async function handleJoin(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient) {
  try {
    const body = (req.body ?? {}) as {
      session_id?: string;
      member_name?: string;
      location_name?: string;
      location_lat?: number;
      location_lng?: number;
      purpose_first?: string | null;
      purpose_second?: string | null;
      vibe_atmosphere?: string | null;
      vibe_budget?: string | null;
      vibe_keywords?: string[] | null;
      device_id?: string;
    };

    const { session_id, member_name } = body;
    // 같은 사람의 재제출 식별자(선택). 구 번들은 보내지 않으므로 없어도 전부 기존대로 동작해야 한다.
    // 형식이 어긋나면 던지지 말고 그냥 무시한다 — 식별자 하나 때문에 제출을 막을 이유가 없다.
    const deviceId = typeof body.device_id === 'string'
      && body.device_id.length > 0 && body.device_id.length <= 64
      ? body.device_id
      : null;
    // 출발지는 '중간지점 자동' 모드에서만 필요 — 임의 지역 모드 게스트는 미입력이므로 선택적으로 처리
    const location_name = body.location_name ?? '';
    const hasCoords = body.location_lat != null && body.location_lng != null
      && !Number.isNaN(Number(body.location_lat)) && !Number.isNaN(Number(body.location_lng));
    const location_lat = hasCoords ? Number(body.location_lat) : null;
    const location_lng = hasCoords ? Number(body.location_lng) : null;

    if (!session_id || !member_name) {
      return res.status(400).json({ error: '필수 항목이 누락되었어요.' });
    }
    if (member_name.length > 20 || location_name.length > 80) {
      return res.status(400).json({ error: '입력값이 올바르지 않아요.' });
    }
    if (hasCoords && (location_lat! < 33 || location_lat! > 39 || location_lng! < 124 || location_lng! > 132)) {
      return res.status(400).json({ error: '출발지 좌표가 올바르지 않아요.' });
    }

    // 세션 존재 + 정원 검증 (기존엔 클라이언트 sessionStorage만 믿어서 무한 제출이 가능했다)
    // status까지 같이 읽는다 — 호스트가 취소한 링크로 들어온 게스트를 여기서 잘라야
    // "제출은 성공했는데 결과가 영원히 안 오는" 침묵 실패가 사라진다.
    let session: Record<string, unknown> | null = null;
    let sessionErr: { code?: string } | null = null;
    {
      const primary = await supabase
        .from('mint_sessions')
        .select('expected_count, status')
        .eq('id', session_id)
        .maybeSingle();
      session = primary.data;
      sessionErr = primary.error;
      if (sessionErr?.code === '42703') {
        // status 컬럼이 없는 구 DB — 취소 개념 자체가 없으므로 정원 검증만 하고 넘어간다.
        const fallback = await supabase
          .from('mint_sessions')
          .select('expected_count')
          .eq('id', session_id)
          .maybeSingle();
        session = fallback.data;
        sessionErr = fallback.error;
      }
    }
    if (sessionErr) {
      console.error('[session-join] session lookup failed', sessionErr);
      return res.status(500).json({ error: '세션 확인 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.' });
    }
    if (!session) return res.status(404).json({ error: '존재하지 않는 세션이에요. 링크를 다시 확인해주세요.' });

    if (session.status === 'cancelled') {
      return res.status(409).json({ error: '호스트가 이 초대 링크를 취소했어요. 새 링크를 받아주세요.' });
    }

    // 순번 비교에 쓰이므로 NaN이 절대 새어 들어오면 안 된다 —
    // NaN이면 모든 비교가 false가 되어 전원이 409를 맞는다(F1과 똑같은 증상).
    const expectedRaw = Number(session.expected_count);
    const expectedCount = Number.isFinite(expectedRaw) && expectedRaw > 0 ? expectedRaw : 6;

    const baseData = {
      session_id,
      member_name,
      location_name,
      location_lat,
      location_lng,
      vibe_atmosphere: body.vibe_atmosphere ?? null,
      vibe_budget: body.vibe_budget ?? null,
    };

    const keywords = Array.isArray(body.vibe_keywords) && body.vibe_keywords.length > 0
      ? body.vibe_keywords
      : null;

    const fullData = {
      ...baseData,
      purpose_first: body.purpose_first ?? null,
      purpose_second: body.purpose_second ?? null,
      ...(keywords ? { vibe_keywords: JSON.stringify(keywords) } : {}),
    };

    // ── 재제출(같은 기기) 처리 ────────────────────────────────────────────────
    // 같은 사람이 두 번 제출하면 예전엔 멤버 행이 2개 생겨 정원을 갉아먹었고,
    // 실제로 올 친구가 대신 409를 맞았다. 재제출은 새 자리가 아니라 "갱신"이어야 한다.
    // device_id 컬럼이 아직 없는 DB(마이그레이션 전)에서는 이 경로 전체를 끄고 기존과 똑같이 동작시킨다.
    let deviceSupported = deviceId !== null;
    let existingRowId: number | null = null;
    if (deviceId !== null) {
      const probe = await supabase
        .from('mint_session_members')
        .select('id')
        .eq('session_id', session_id)
        .eq('device_id', deviceId)
        .maybeSingle();
      if (probe.error?.code === '42703') {
        deviceSupported = false; // 컬럼 미생성 — 아래 insert에서도 device_id를 빼야 한다
      } else if (probe.error) {
        console.error('[session-join] device lookup failed', probe.error);
        deviceSupported = false; // 조회 실패는 치명적이지 않다. 중복 제거만 포기하고 제출은 살린다.
      } else {
        existingRowId = (probe.data as { id?: number } | null)?.id ?? null;
      }
    }

    const deviceField: Record<string, unknown> = deviceSupported && deviceId !== null
      ? { device_id: deviceId }
      : {};

    if (existingRowId != null) {
      // 이미 자리를 차지한 사람이므로 정원 검사도, 순번 검사도 건너뛴다.
      //
      // 좌표 NOT NULL 폴백을 여기에도 둔다. insert 경로에만 있었더니, 좌표 없이(임의 지역 모드)
      // 재제출한 사람이 500을 맞고 갱신이 통째로 실패했다 — 프로덕션에서 그대로 재현됐다.
      // (supabase/setup.sql의 DROP NOT NULL이 아직 실행되지 않은 DB에서만 나는 증상이다.)
      const updateWithFallback = async (data: Record<string, unknown>) => {
        const r = await supabase.from('mint_session_members').update(data).eq('id', existingRowId);
        if (r.error?.code === '23502' && data.location_lat == null) {
          return supabase.from('mint_session_members')
            .update({ ...data, location_lat: 37.5665, location_lng: 126.978 }).eq('id', existingRowId);
        }
        return r;
      };
      let upd = await updateWithFallback(fullData);
      if (upd.error?.code === '42703') {
        upd = await updateWithFallback(baseData);
      }
      if (upd.error) {
        console.error('[session-join] resubmit update failed', upd.error);
        return res.status(500).json({ error: '제출에 실패했어요. 잠시 후 다시 시도해주세요.' });
      }
      return res.status(200).json({ ok: true });
    }

    // 사전 정원 검사 — 이미 꽉 찬 세션은 굳이 넣었다 지우지 않는다(응답 메시지도 이 경우만의 것이다).
    const { count: memberCount } = await supabase
      .from('mint_session_members')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', session_id);
    if ((memberCount ?? 0) >= expectedCount) {
      return res.status(409).json({ error: '이미 모든 인원이 입력을 마친 세션이에요.' });
    }

    // 출발지 없는(임의 지역) 멤버 삽입 헬퍼 — location 컬럼이 아직 NOT NULL이면(마이그레이션 전)
    // 좌표 자리에 서울 중심을 넣어 삽입만 성공시킨다. 임의 지역 모드에선 이 좌표를 추천에 쓰지 않는다.
    async function insertWithFallback(data: Record<string, unknown>) {
      const { data: inserted, error } = await supabase
        .from('mint_session_members')
        .insert(data)
        .select('id')
        .single();
      if (!error) return { error: null, insertedId: (inserted as { id?: number } | null)?.id ?? null };
      // NOT NULL 위반 → 좌표 자리에 서울 중심 채워 재시도
      if (error.code === '23502' && data.location_lat == null) {
        return insertWithFallback({ ...data, location_lat: 37.5665, location_lng: 126.978 });
      }
      return { error, insertedId: null };
    }

    let insertResult = await insertWithFallback({ ...fullData, ...deviceField });

    // 아직 없는 컬럼(purpose/vibe_keywords) 때문이면 기본 데이터로 재시도
    if (insertResult.error && insertResult.error.code === '42703') {
      insertResult = await insertWithFallback({ ...baseData, ...deviceField });
    }

    // 부분 유니크 인덱스 위반 = 같은 기기가 동시에 두 번 보냈다(더블탭·재시도).
    // 먼저 들어간 행이 곧 이 사람의 자리이므로 실패가 아니라 성공으로 돌려준다.
    if (insertResult.error && insertResult.error.code === '23505' && deviceSupported) {
      return res.status(200).json({ ok: true });
    }

    if (insertResult.error) {
      console.error('[session-join] insert failed', insertResult.error);
      return res.status(500).json({ error: '제출에 실패했어요. 잠시 후 다시 시도해주세요.' });
    }

    // ── 정원 초과 판정: "몇 명인가"가 아니라 "내가 몇 번째인가"로 본다 ─────────
    // 예전엔 insert 후 총원이 정원을 넘으면 각자 자기 행을 지웠다. 동시에 4명이 들어오면
    // 4명 모두 "넘쳤다"를 보고 4명 모두 자기 행을 지운다 — 롤백이 대칭이라 과교정되어
    // 남은 자리가 통째로 증발하고 아무도 못 들어간다(단톡방에 링크를 뿌리면 정확히 이 상황).
    // 그래서 전순서를 만들어 앞에서 expected_count명만 남긴다. submitted_at은 default now()라
    // 동률이 날 수 있으므로 bigserial id를 2차 키로 반드시 함께 건다 — 그래야 모든 요청이
    // 서로 다른 결론이 아니라 '같은 줄 세우기'를 보게 되고, 결과가 동시성과 무관해진다.
    const ordered = await supabase
      .from('mint_session_members')
      .select('id')
      .eq('session_id', session_id)
      .order('submitted_at', { ascending: true })
      .order('id', { ascending: true });

    if (ordered.error || !ordered.data) {
      // 줄 세우기를 못 읽었다고 이미 성공한 제출을 되돌리진 않는다(fail-open).
      // 최악이라도 정원 초과 한두 행이고, 이는 집계에서 감당된다. 되돌리면 유실이다.
      console.error('[session-join] order check failed (fail-open)', ordered.error);
      return res.status(200).json({ ok: true });
    }
    if (insertResult.insertedId == null) {
      // .select('id')가 비는 경우는 실측상 없지만, id를 모르면 지울 대상을 특정할 수 없다.
      // 남의 행을 지우느니 통과시킨다.
      console.error('[session-join] inserted id missing (fail-open)', { session_id });
      return res.status(200).json({ ok: true });
    }

    const myIndex = (ordered.data as { id: number }[]).findIndex((r) => r.id === insertResult.insertedId);
    if (myIndex >= 0 && myIndex < expectedCount) {
      return res.status(200).json({ ok: true });
    }

    // 경합에서 밀렸다 — 내 행만 지운다. 앞선 expected_count명은 그대로 살아남는다.
    const del = await supabase.from('mint_session_members').delete().eq('id', insertResult.insertedId);
    if (del.error) {
      // 삭제 실패는 조용히 넘기면 안 된다. 초과 행이 DB에 남아 다음 게스트의 자리를 먹는다.
      console.error('[session-join] overflow rollback delete failed', {
        session_id, id: insertResult.insertedId, error: del.error,
      });
    }
    return res.status(409).json({ error: '방금 모든 인원이 입력을 마친 세션이에요.' });
  } catch (e) {
    console.error('[session-join] failed', e);
    return res.status(500).json({ error: '제출에 실패했어요. 잠시 후 다시 시도해주세요.' });
  }
}

// ── result: 호스트가 그룹 추천 결과 요약을 세션에 저장(게스트 폴링이 수신) ──
// 구 api/session-get.ts의 POST 분기 — 별도 함수가 아니었다.
async function handleResult(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient) {
  const body = (req.body ?? {}) as { id?: string; result?: unknown };
  const sid = String(body.id ?? '');
  if (!/^[a-z0-9]{4,32}$/.test(sid)) return res.status(400).json({ error: '잘못된 요청이에요.' });
  const result = body.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return res.status(400).json({ error: '잘못된 요청이에요.' });
  }
  let raw = '';
  try { raw = JSON.stringify(result); } catch { /* noop */ }
  // 24KB — v:2 요약은 3개 장소 × (긴 네이버 썸네일 URL + 해시태그)가 실려 10KB를 넘을 수 있다.
  if (!raw || raw.length > 24_000) return res.status(400).json({ error: '결과 데이터가 너무 커요.' });

  // 일일 상한을 IP 단위로 잰다. 이 엔드포인트는 호스트 1회 추천당 약 2번 불리고 비용이 0인데,
  // 엔드포인트 전체 합계로 재면 하루 약 1000팀이면 상한에 닿아 그 뒤 모든 호스트의
  // 결과 전달이 조용히 429가 된다 — 게스트는 이유도 모른 채 영원히 대기 화면을 본다.
  const gate = await checkRateLimit(supabase, 'session-result', clientIp(req), 10, 2000, 'ip');
  if (!gate.allowed) return res.status(429).json({ error: '잠시 후 다시 시도해주세요.' });

  // .select('id')로 "실제 몇 행이 갱신됐는지"를 받는다. update는 0행이어도 에러가 아니라서
  // 예전엔 존재하지도 않는 세션 id에 저장해도 {ok:true}가 나갔다 — 호스트는 성공했다고 믿는다.
  // 한계: 이 검사는 "세션이 있는가"만 본다. 호스트 토큰 인증이 아직 없어
  //       링크(=세션 id)를 가진 사람은 여전히 남의 결과를 덮어쓸 수 있다.
  let upd = await supabase.from('mint_sessions')
    .update({ result_json: result, result_at: new Date().toISOString() })
    .eq('id', sid)
    .select('id');
  if (upd.error?.code === '42703') {
    upd = await supabase.from('mint_sessions').update({ result_json: result }).eq('id', sid).select('id');
  }
  if (upd.error) {
    if (upd.error.code !== '42703') console.error('[session-get] result save failed', upd.error);
    return res.status(200).json({ ok: false, disabled: true }); // 컬럼 미생성 등 — 조용히 off
  }
  if (!upd.data || upd.data.length === 0) {
    return res.status(404).json({ error: '세션을 찾을 수 없어요.' });
  }
  return res.status(200).json({ ok: true });
}

// ── cancel: 호스트가 초대 링크를 무효화 ──────────────────────────────────────
// 예전엔 무효화가 클라이언트 상태·localStorage에서만 일어나 서버는 아무것도 몰랐다.
// 그래서 이미 뿌려진 옛 링크가 계속 살아 있었고, 그 링크로 들어온 게스트는 제출에 성공한 뒤
// 아무도 읽지 않을 세션에서 영원히 결과를 기다렸다(에러 한 줄 없이).
async function handleCancel(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient) {
  const body = (req.body ?? {}) as { id?: string };
  const sid = String(body.id ?? '');
  if (!/^[a-z0-9]{4,32}$/.test(sid)) return res.status(400).json({ error: '잘못된 요청이에요.' });

  const upd = await supabase.from('mint_sessions')
    .update({ status: 'cancelled' })
    .eq('id', sid)
    .select('id');

  if (upd.error) {
    // status 컬럼이 없는 구 DB — 취소 개념이 없으니 실패로 알리기보단 기능만 끈다(result 분기와 같은 방식).
    if (upd.error.code === '42703') return res.status(200).json({ ok: false, disabled: true });
    console.error('[session-cancel] update failed', upd.error);
    return res.status(500).json({ error: '링크 취소에 실패했어요. 잠시 후 다시 시도해주세요.' });
  }
  if (!upd.data || upd.data.length === 0) {
    return res.status(404).json({ error: '세션을 찾을 수 없어요.' });
  }
  return res.status(200).json({ ok: true });
}

// ── get: 세션 조회(호스트·게스트 폴링) (구 api/session-get.ts의 GET 분기) ────
async function handleGet(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient) {
  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!id) return res.status(400).json({ error: 'session id가 필요해요.' });

  try {

    // has_second / result_json / status 포함 시도, 없으면 한 단계씩 떨어뜨린다.
    // status를 맨 앞 단계에만 넣고 폴백 사슬을 한 칸 늘린 이유: status 컬럼이 없는 DB에서도
    // 그 아래 단계들이 예전과 완전히 동일한 select를 그대로 밟게 하기 위해서다(회귀 0).
    let { data: session, error: sErr } = await supabase
      .from('mint_sessions')
      .select('expected_count, has_second, result_json, status')
      .eq('id', id)
      .single();

    if (sErr?.code === '42703') {
      ({ data: session, error: sErr } = await supabase
        .from('mint_sessions')
        .select('expected_count, has_second, result_json')
        .eq('id', id)
        .single());
    }
    if (sErr?.code === '42703') {
      ({ data: session, error: sErr } = await supabase
        .from('mint_sessions')
        .select('expected_count, has_second')
        .eq('id', id)
        .single());
    }
    if (sErr?.code === '42703') {
      ({ data: session, error: sErr } = await supabase
        .from('mint_sessions')
        .select('expected_count')
        .eq('id', id)
        .single());
    }

    if (sErr || !session) {
      return res.status(404).json({ error: '세션을 찾을 수 없어요.' });
    }

    // 멤버 조회 (purpose + keywords 포함 시도, 없으면 fallback)
    // members는 두 쿼리(컬럼 수 다름) 결과를 모두 받으므로 넓은 타입으로 선언한다.
    const primary = await supabase
      .from('mint_session_members')
      .select('member_name, location_name, location_lat, location_lng, vibe_atmosphere, vibe_budget, vibe_keywords, purpose_first, purpose_second')
      .eq('session_id', id)
      .order('submitted_at', { ascending: true });

    let members: Record<string, unknown>[] | null = primary.data;
    let mErr = primary.error;

    if (mErr?.code === '42703') {
      // 일부 컬럼 없을 수 있음, 기본 필드만 조회
      const fallback = await supabase
        .from('mint_session_members')
        .select('member_name, location_name, location_lat, location_lng, vibe_atmosphere, vibe_budget')
        .eq('session_id', id)
        .order('submitted_at', { ascending: true });
      members = fallback.data;
      mErr = fallback.error;
    }

    if (mErr) {
      console.error('[session-get] members fetch failed', mErr);
      return res.status(500).json({ error: '세션 정보를 불러오지 못했어요.' });
    }

    const parsedMembers = (members ?? []).map((m: Record<string, unknown>) => ({
      ...m,
      vibe_keywords: m.vibe_keywords
        ? (() => { try { return JSON.parse(m.vibe_keywords as string); } catch { return []; } })()
        : [],
    }));

    return res.status(200).json({
      expected_count: session.expected_count,
      has_second: (session as Record<string, unknown>).has_second ?? false,
      result_json: (session as Record<string, unknown>).result_json ?? null,
      // 게스트 화면이 취소된 링크를 알아볼 수 있게 추가한다. 기존 필드는 그대로 둔다.
      // status 컬럼이 없는 DB에서는 null이 나가고, 클라이언트는 'cancelled'만 특별 취급하므로 안전하다.
      status: (session as Record<string, unknown>).status ?? null,
      members: parsedMembers,
    });
  } catch (e) {
    console.error('[session-get] failed', e);
    return res.status(500).json({ error: '세션 정보를 불러오지 못했어요.' });
  }
}
