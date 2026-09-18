import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/utils/supabase';
import { getDeviceId } from '@/utils/points';
import { loadHistory } from '@/utils/history';
import type { ActivityPayload, ActivityRow } from '@/types';

// 카카오 기본 로그인 — 로그인은 어디까지나 '선택'이다.
// 비로그인 사용자의 추천·찜·포인트는 localStorage로 그대로 동작하며, 여기의 어떤 함수도 그 흐름을 막지 않는다.
// supabase-js v2는 detectSessionInUrl/persistSession이 기본 true라 OAuth 콜백 파싱·세션 저장은 자동이다.

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

export async function getCurrentUser(): Promise<User | null> {
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export function onAuthChange(cb: (session: Session | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

export async function signInWithKakao(): Promise<void> {
  // 로그인 후 프로필 탭으로 복귀 (커스텀 라우터는 pathname만 보므로 ?tab=profile은 /app으로 매칭된다)
  await supabase.auth.signInWithOAuth({
    provider: 'kakao',
    options: {
      redirectTo: `${window.location.origin}/app?tab=profile`,
      // 비즈앱 전환으로 account_email 권한이 열려 KOE205가 해소됐다. 그래도 scope는 계속 명시한다 —
      // 우리가 무엇을 받는지 코드에 남겨두기 위해서, 그리고 기본 scope가 바뀌어도 흔들리지 않기 위해서.
      // 이메일은 카카오에서 '선택 동의'라 거부하는 사용자가 있다. 그 경우 user.email이 비므로
      // 이메일을 로그인의 전제로 삼지 않는다(Supabase의 'Allow users without an email' 유지).
      scopes: 'profile_nickname profile_image account_email',
    },
  });
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

// user_metadata 필드명은 provider·시점에 따라 달라서 후보를 순서대로 훑는다.
function pick(meta: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = meta[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return null;
}

export function getNickname(user: User | null): string | null {
  if (!user) return null;
  return pick(user.user_metadata ?? {}, ['name', 'full_name', 'preferred_username', 'nickname', 'user_name']);
}

export function getAvatarUrl(user: User | null): string | null {
  if (!user) return null;
  return pick(user.user_metadata ?? {}, ['avatar_url', 'picture', 'profile_image_url', 'profile_image']);
}

export async function syncProfile(): Promise<void> {
  try {
    const session = await getSession();
    const user = session?.user;
    if (!user) return;

    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const kakaoId =
      pick(meta, ['provider_id', 'sub', 'kakao_id', 'id']) ??
      (user.identities?.[0]?.id ?? null);

    await supabase.from('mint_profiles').upsert(
      {
        id: user.id,
        kakao_id: kakaoId,
        nickname: getNickname(user),
        avatar_url: getAvatarUrl(user),
        device_id: getDeviceId(),
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );
  } catch {
    /* 프로필 동기화 실패는 무해 — 로그인 자체는 유지된다 */
  }
}

// 로그인 사용자만 가벼운 활동 로그를 남긴다. 비로그인이면 즉시 no-op.
// 추천 플로우를 절대 깨면 안 되므로 어떤 실패도 조용히 삼킨다.
export async function logActivityIfSignedIn(payload: ActivityPayload): Promise<void> {
  try {
    const session = await getSession();
    if (!session?.user) return;

    await supabase.from('mint_activity_log').insert({
      user_id: session.user.id,
      device_id: getDeviceId(),
      place_name: payload.placeName,
      second_place_name: payload.secondPlaceName ?? null,
      area_name: payload.areaName ?? null,
      purpose_first: payload.purposeFirst ?? null,
      group_size: payload.groupSize ?? null,
    });
  } catch {
    /* 로그 실패는 사용자에게 보이지 않는다 */
  }
}

// 모듈 전역 캐시 — Profile은 탭 전환마다 언마운트→재마운트되므로 React state로는 중복 요청을 못 막는다.
let activityCache: { userId: string; fetchedAt: number; rows: ActivityRow[]; count: number } | null = null;
const ACTIVITY_CACHE_TTL_MS = 60_000;

export function clearActivityCache(): void {
  activityCache = null;
}

// 계정에 저장된 모임 기록 조회. 비로그인이면 null.
// 실패 시 throw — 호출부가 잡아 "불러오지 못했어요" 상태를 보여줘야 하므로 조용히 삼키지 않는다.
export async function getActivityHistory(
  force = false
): Promise<{ rows: ActivityRow[]; count: number } | null> {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return null;

  if (
    !force &&
    activityCache &&
    activityCache.userId === userId &&
    Date.now() - activityCache.fetchedAt < ACTIVITY_CACHE_TTL_MS
  ) {
    return { rows: activityCache.rows, count: activityCache.count };
  }

  // count: 'exact'로 총 건수를 같은 요청에서 받는다 — 전체 행을 내려받지 않고 "총 N번째"를 표시하기 위해.
  const { data, count, error } = await supabase
    .from('mint_activity_log')
    .select(
      'id, place_name, second_place_name, area_name, purpose_first, group_size, created_at, source',
      { count: 'exact' }
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) throw error;

  const rows = (data ?? []) as ActivityRow[];
  const total = count ?? rows.length;
  activityCache = { userId, fetchedAt: Date.now(), rows, count: total };
  return { rows, count: total };
}

// 최초 로그인 시 이 기기의 로컬 기록을 계정으로 한 번만 올린다.
// "로그인하면 이어져요"라는 약속을 과거 기록에도 소급 적용하기 위한 일회성 작업.
const BACKFILL_HINT_KEY = 'mint_backfill_hint_v1';

export async function backfillHistoryIfNeeded(): Promise<void> {
  try {
    const session = await getSession();
    const user = session?.user;
    if (!user) return;

    // 로컬 힌트 — 순수 속도 최적화. 신뢰 원천은 어디까지나 mint_profiles.backfilled_at이다.
    try {
      if (localStorage.getItem(BACKFILL_HINT_KEY) === user.id) return;
    } catch { /* localStorage 접근 불가 시 서버 확인으로 진행 */ }

    const { data: profile, error: profileError } = await supabase
      .from('mint_profiles')
      .select('backfilled_at')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    if (profile?.backfilled_at) {
      setBackfillHint(user.id);
      return;
    }

    const entries = loadHistory();
    if (entries.length > 0) {
      const deviceId = getDeviceId();
      const { error: insertError } = await supabase.from('mint_activity_log').insert(
        entries.map((e) => ({
          user_id: user.id,
          device_id: deviceId,
          place_name: e.placeName,
          second_place_name: e.secondPlaceName ?? null,
          area_name: e.areaName ?? null,
          purpose_first: e.purposeFirst ?? null,
          group_size: null, // 로컬 HistoryEntry에는 없는 필드
          source: 'backfill',
          // 지금 시각이 아니라 원래 저장 시각 — 2주 전 모임이 2주 전으로 정렬돼야 한다.
          created_at: new Date(e.savedAt).toISOString(),
        }))
      );
      // 23505 = unique_violation. 다른 기기가 먼저 백필한 정상 상황이므로 조용히 통과.
      if (insertError && (insertError as { code?: string }).code !== '23505') throw insertError;
    }

    // 로컬이 0건이어도 표시해둔다 — 다음 마운트마다 텅 빈 로컬을 재확인하지 않도록.
    const { error: updateError } = await supabase
      .from('mint_profiles')
      .update({ backfilled_at: new Date().toISOString() })
      .eq('id', user.id);
    if (updateError) throw updateError;

    setBackfillHint(user.id);
    clearActivityCache(); // 방금 올린 기록이 곧바로 보이도록
  } catch {
    /* 실패해도 로그인·다른 기능에 영향 없음. 힌트를 세팅하지 않았으므로 다음 마운트에 자연 재시도된다. */
  }
}

function setBackfillHint(userId: string) {
  try {
    localStorage.setItem(BACKFILL_HINT_KEY, userId);
  } catch { /* 저장 실패는 무해 — 다음에 서버를 한 번 더 확인할 뿐 */ }
}

export async function deleteAccount(): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.access_token) return { ok: false, error: '로그인 상태가 아니에요.' };

  try {
    // 서버리스 함수 대신 DB 함수(security definer)로 지운다 — Vercel Hobby의 함수 12개 한도를 넘겨
    // 배포가 막혔기 때문. 지우는 대상이 auth.uid()로 못박혀 있어 자기 계정만 삭제된다.
    const { error } = await supabase.rpc('delete_own_account');
    if (error) return { ok: false, error: '탈퇴 처리에 실패했어요. 잠시 후 다시 시도해주세요.' };

    clearActivityCache();
    await signOut();
    return { ok: true };
  } catch {
    return { ok: false, error: '탈퇴 처리에 실패했어요. 잠시 후 다시 시도해주세요.' };
  }
}
