import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/services/supabase';
import type { ActivityPayload, ActivityRow } from '@/types';

// 인증 모델 — 모든 /app 방문자는 익명 사용자(auth.users, is_anonymous=true)로 시작한다.
// 카카오 로그인은 그 익명 사용자에 identity를 '연결'하는 것이라 user.id가 바뀌지 않는다.
// public.users 행 생성과 kakao_id·닉네임 채움은 DB 트리거가 하므로 클라이언트는 여기에 쓰지 않는다.
// supabase-js v2는 detectSessionInUrl/persistSession이 기본 true라 OAuth 콜백 파싱·세션 저장은 자동이다.

const KAKAO_SCOPES = 'profile_nickname profile_image account_email';
// 로그인 후 프로필 탭으로 복귀 (커스텀 라우터는 pathname만 보므로 ?tab=profile은 /app으로 매칭된다)
const kakaoRedirectTo = () => `${window.location.origin}/app?tab=profile`;

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

// 회원 = 카카오가 연결된 사용자. 익명 세션은 user가 있어도 회원이 아니다.
export function isMember(user: User | null | undefined): user is User {
  return !!user && !user.is_anonymous;
}

// /app 진입 시 세션을 보장한다. 없으면 익명 사용자를 만든다(랜딩에서는 부르지 않는다).
// 실패해도 앱은 동작한다 — 서버 저장이 안 될 뿐 추천 플로우는 localStorage로 돈다.
export async function ensureSession(): Promise<Session | null> {
  const existing = await getSession();
  if (existing) return existing;
  try {
    const { data } = await supabase.auth.signInAnonymously();
    return data.session ?? null;
  } catch {
    return null;
  }
}

// 카카오 연결(linkIdentity)이 거부된 경우의 복구. 거부 여부는 카카오를 다녀온 뒤 복귀 URL의
// error 파라미터로만 알 수 있다(호출 시점엔 error가 없다). 이 카카오 계정이 이미 다른 사용자에
// 연결돼 있으면(identity_already_exists) 그 기존 사용자로 일반 로그인한다.
// 리다이렉트를 시작했으면 true — 호출부는 익명 세션 발급 같은 후속 작업을 건너뛴다.
export async function recoverFromLinkError(): Promise<boolean> {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const code = search.get('error_code') ?? hash.get('error_code');
  const description = search.get('error_description') ?? hash.get('error_description') ?? '';
  if (!code && !description) return false;

  // 에러 파라미터를 지운다 — 새로고침마다 같은 복구를 반복하지 않도록.
  window.history.replaceState(null, '', '/app');

  if (code === 'identity_already_exists' || /already linked/i.test(description)) {
    await supabase.auth.signInWithOAuth({
      provider: 'kakao',
      options: { redirectTo: kakaoRedirectTo(), scopes: KAKAO_SCOPES },
    });
    return true;
  }
  console.warn('[auth] OAuth 복귀 에러', code, description);
  return false;
}

export async function signInWithKakao(): Promise<void> {
  const session = await getSession();

  // 익명 세션이면 같은 user.id에 카카오를 연결한다 — 익명 시절 데이터가 그대로 이어진다.
  // 이 카카오 계정이 이미 다른 사용자에 연결돼 있으면(다른 폰에서 먼저 가입) 연결이 거부되므로
  // 일반 로그인으로 폴백한다. 이때 이 기기의 익명 데이터는 잇지 않는다(기기 한정 데이터였으므로).
  if (session?.user && session.user.is_anonymous) {
    const { error } = await supabase.auth.linkIdentity({
      provider: 'kakao',
      options: { redirectTo: kakaoRedirectTo(), scopes: KAKAO_SCOPES },
    });
    if (!error) return;
  }

  // 비즈앱 전환으로 account_email 권한이 열려 KOE205가 해소됐다. 그래도 scope는 계속 명시한다 —
  // 우리가 무엇을 받는지 코드에 남겨두기 위해서, 그리고 기본 scope가 바뀌어도 흔들리지 않기 위해서.
  // 이메일은 카카오에서 '선택 동의'라 거부하는 사용자가 있다. 그 경우 user.email이 비므로
  // 이메일을 로그인의 전제로 삼지 않는다(Supabase의 'Allow users without an email' 유지).
  await supabase.auth.signInWithOAuth({
    provider: 'kakao',
    options: { redirectTo: kakaoRedirectTo(), scopes: KAKAO_SCOPES },
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

// 회원의 최근 로그인 시각만 갱신한다. 닉네임·아바타·kakao_id는 DB 트리거가 auth.identities에서 채운다.
export async function syncProfile(): Promise<void> {
  try {
    const session = await getSession();
    if (!isMember(session?.user)) return;

    await supabase
      .from('users')
      .update({ last_sign_in_at: new Date().toISOString() })
      .eq('id', session!.user.id);
  } catch {
    /* 갱신 실패는 무해 — 로그인 자체는 유지된다 */
  }
}

// 회원만 가벼운 활동 로그를 남긴다. 익명·비로그인이면 즉시 no-op.
// 추천 플로우를 절대 깨면 안 되므로 어떤 실패도 조용히 삼킨다.
export async function logActivityIfSignedIn(payload: ActivityPayload): Promise<void> {
  try {
    const session = await getSession();
    if (!isMember(session?.user)) return;

    await supabase.from('mint_activity_log').insert({
      user_id: session!.user.id,
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

// 계정에 저장된 모임 기록 조회. 회원이 아니면 null.
// 실패 시 throw — 호출부가 잡아 "불러오지 못했어요" 상태를 보여줘야 하므로 조용히 삼키지 않는다.
export async function getActivityHistory(
  force = false
): Promise<{ rows: ActivityRow[]; count: number } | null> {
  const session = await getSession();
  if (!isMember(session?.user)) return null;
  const userId = session!.user.id;

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
