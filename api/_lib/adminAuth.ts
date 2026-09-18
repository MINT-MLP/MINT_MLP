import { scrypt as scryptCb, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── 어드민 비밀번호 검증 공용 모듈 ──
//
// 왜 이 파일이 있나: 어드민 비밀번호가 Vercel 환경변수(ADMIN_PASSWORD)에만 있으면
// Vercel 대시보드 권한이 없는 운영자는 비밀번호를 영영 바꿀 수 없다.
// 해시를 Supabase(public.admin_credentials)에 두고 어드민 화면에서 직접 바꾸게 한다.
//
// 해시 포맷: `scrypt$<N>$<r>$<p>$<salt base64>$<key base64>`
//   파라미터를 문자열에 같이 싣는 이유 — 나중에 N을 올려도 기존 행이 그대로 검증된다.
//
// 폴백 규칙(중요):
//   - admin_credentials 행이 있으면 그 해시만 인정한다. env는 쳐다보지 않는다.
//   - 행이 없거나 / 테이블이 아직 없거나 / DB 조회가 실패하면 process.env.ADMIN_PASSWORD로
//     평문 비교(상수시간)한다. 덕분에 SQL 실행과 배포 순서가 무관하다.
//   - env도 비어 있으면 'unconfigured' — 401(비밀번호 틀림)과 구분해서 500으로 알린다.
//
// 이 계층은 평문을 로그에 절대 남기지 않는다. 호출부도 마찬가지여야 한다.
// 이 파일은 node:crypto를 쓰므로 src/(브라우저 번들)에서 import하면 안 된다.

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>;

const SCRYPT_N = 16384;     // 2^14 — Node 기본값. 메모리 128*N*r = 16MB(기본 maxmem 32MB 안)
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;
const HASH_PREFIX = 'scrypt';
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;
const TABLE = 'admin_credentials';
const ROW_ID = 'admin';

// 저장된 해시가 오염돼도 서버가 GB 단위 메모리를 잡지 않도록 하는 상한(64MB).
// 정상 해시(16MB)는 여유롭게 통과한다.
const MAX_SCRYPT_MEM = 64 * 1024 * 1024;

// 한글 비밀번호는 조합형(NFD)/완성형(NFC) 차이로 같은 글자가 다른 바이트가 된다.
// 해시와 검증 양쪽에서 똑같이 NFC로 정규화한다. 한쪽만 하면 한글 비밀번호가 조용히 실패한다.
// .trim()은 호출부(API)의 몫이고 이 계층은 건드리지 않는다.
function norm(plain: string): string {
  return plain.normalize('NFC');
}

/** 평문 → `scrypt$N$r$p$salt$key` 문자열. salt는 매번 새로 뽑는다. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scrypt(norm(plain), salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return [
    HASH_PREFIX,
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

function parseIntStrict(v: string): number | null {
  if (!/^\d{1,9}$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

// base64 왕복이 원문과 같은지로 "진짜 base64인지"를 판정한다.
// Buffer.from은 이상한 문자를 조용히 버리기 때문에 길이만 봐서는 오염을 못 잡는다.
function decodeB64(v: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return null;
  try {
    const buf = Buffer.from(v, 'base64');
    if (buf.length === 0) return null;
    if (buf.toString('base64') !== v) return null;
    return buf;
  } catch {
    return null;
  }
}

/**
 * 평문이 저장된 해시와 일치하는지. 예외는 절대 위로 올리지 않고 전부 false로 흡수한다.
 * (DB 값이 오염돼도 어드민 API가 500으로 죽지 않고 그냥 "비밀번호 틀림"이 된다.)
 */
export async function verifyHash(plain: string, stored: string): Promise<boolean> {
  try {
    if (typeof stored !== 'string') return false;
    const parts = stored.split('$');
    if (parts.length !== 6) return false;
    const [prefix, nStr, rStr, pStr, saltStr, keyStr] = parts;
    if (prefix !== HASH_PREFIX) return false;

    const N = parseIntStrict(nStr);
    const r = parseIntStrict(rStr);
    const p = parseIntStrict(pStr);
    if (N === null || r === null || p === null) return false;

    // 범위 밖 파라미터는 계산하지 않는다 — 오염된 행 하나로 서버가 갈려나가면 안 된다.
    if (!isPowerOfTwo(N) || N < 1024 || N > 1 << 20) return false;
    if (r < 1 || r > 32) return false;
    if (p < 1 || p > 16) return false;
    if (128 * N * r > MAX_SCRYPT_MEM) return false;

    const salt = decodeB64(saltStr);
    const key = decodeB64(keyStr);
    if (!salt || !key) return false;

    const calc = await scrypt(norm(plain), salt, key.length, {
      N, r, p, maxmem: MAX_SCRYPT_MEM + 1024 * 1024,
    });
    if (calc.length !== key.length) return false;
    return timingSafeEqual(calc, key);
  } catch {
    return false;
  }
}

/**
 * 길이가 다르면 timingSafeEqual이 throw하므로, 양쪽을 sha256 digest(항상 32바이트)로 만든 뒤 비교한다.
 * env 평문 비밀번호처럼 길이가 제각각인 값끼리 상수시간 비교할 때 쓴다.
 */
export function safeEqualStr(a: string, b: string): boolean {
  const da = createHash('sha256').update(a ?? '', 'utf8').digest();
  const db = createHash('sha256').update(b ?? '', 'utf8').digest();
  return timingSafeEqual(da, db);
}

export type AdminPasswordSource = 'db' | 'env';
export type AdminAuthResult =
  | { ok: true; source: AdminPasswordSource }
  | { ok: false; reason: 'unauth' | 'unconfigured' };

// admin_credentials에서 해시를 읽는다. 테이블 미생성(42P01/PGRST205) 포함 어떤 실패든 null →
// 호출부는 env 폴백으로 넘어간다. 비밀번호 값은 로그에 남기지 않고 error.code만 남긴다.
async function loadStoredHash(supabase: SupabaseClient | null): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from(TABLE).select('password_hash').eq('id', ROW_ID).maybeSingle();
    if (error) {
      console.warn('[adminAuth] admin_credentials 조회 실패 — env 폴백', error.code);
      return null;
    }
    const hash = data?.password_hash;
    return typeof hash === 'string' && hash.trim() ? hash : null;
  } catch (e) {
    console.warn('[adminAuth] admin_credentials 조회 예외 — env 폴백', (e as Error)?.name);
    return null;
  }
}

/**
 * 어드민 비밀번호 검증 진입점. admin-data·pilot-feedback이 둘 다 이걸 쓴다.
 *
 * 저장된 크리덴셜을 먼저 읽고 그 다음 후보를 본다 — "설정이 아예 없는 상태"를 401로 오인하지 않게.
 * 캐시는 두지 않는다(어드민 호출당 select 1회). 비밀번호를 바꾼 직후 옛 값이 통하는 창을
 * 만들지 않는 편이, 하루 수십 번뿐인 호출을 아끼는 것보다 낫다.
 *
 * 타이밍: DB 경로는 scrypt, env 경로는 sha256이라 응답 시간이 다르다. 이 차이가 흘리는 정보는
 * "admin_credentials 행이 있는지"뿐이고 비밀번호 자체는 각 경로 안에서 상수시간으로 비교된다.
 * 후보가 빈 문자열이어도 조기 리턴하지 않고 그대로 scrypt를 돌린다(길이 노출 방지).
 */
export async function verifyAdminPassword(
  supabase: SupabaseClient | null,
  candidate: unknown,
): Promise<AdminAuthResult> {
  const plain = typeof candidate === 'string' ? candidate.trim() : '';

  const storedHash = await loadStoredHash(supabase);
  if (storedHash) {
    const ok = await verifyHash(plain, storedHash);
    return ok ? { ok: true, source: 'db' } : { ok: false, reason: 'unauth' };
  }

  const envPw = (process.env.ADMIN_PASSWORD ?? '').trim();
  if (!envPw) return { ok: false, reason: 'unconfigured' };
  return safeEqualStr(norm(plain), norm(envPw))
    ? { ok: true, source: 'env' }
    : { ok: false, reason: 'unauth' };
}

/**
 * 새 비밀번호 형식 검증. current는 "현재와 같은 값으로는 못 바꾼다"를 보기 위해서만 쓴다.
 * 에러 문구는 클라이언트(Admin.tsx)와 글자까지 맞춰둔다.
 */
export function validateNewPassword(
  v: unknown,
  current: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof v !== 'string' || !v.trim()) return { ok: false, error: '새 비밀번호를 입력해주세요.' };
  const value = v.trim();
  if (value.length < PASSWORD_MIN) return { ok: false, error: '비밀번호는 8자 이상이어야 해요.' };
  if (value.length > PASSWORD_MAX) return { ok: false, error: '비밀번호는 64자 이하여야 해요.' };
  // 제어문자는 붙여넣기 사고(개행 포함)로만 들어온다 — 본인도 다시 못 치는 비밀번호가 된다.
  // (제어문자를 "찾는" 것이 목적이라 no-control-regex는 여기선 정확히 의도한 바다)
  // eslint-disable-next-line no-control-regex
  if (/[ -]/.test(value)) {
    return { ok: false, error: '비밀번호에 쓸 수 없는 문자가 있어요.' };
  }
  if (value === (current ?? '').trim()) {
    return { ok: false, error: '현재 비밀번호와 다른 비밀번호를 입력해주세요.' };
  }
  return { ok: true, value };
}

/** 새 비밀번호를 해시해서 단일 행에 upsert. 저장 후 다시 읽어 검증까지 끝낸다. */
export async function setAdminPassword(
  supabase: SupabaseClient,
  newPlain: string,
): Promise<{ ok: true } | { ok: false; error: string; code?: string }> {
  const missingTable = '비밀번호 저장 테이블이 아직 없어요. Supabase SQL Editor에서 sql/admin-credentials.sql을 먼저 실행해주세요.';
  const saveFailed = '비밀번호를 저장하지 못했어요. 잠시 후 다시 시도해주세요.';

  let hash: string;
  try {
    hash = await hashPassword(newPlain);
  } catch (e) {
    console.error('[adminAuth] 비밀번호 해시 실패', (e as Error)?.name);
    return { ok: false, error: saveFailed };
  }

  const { error } = await supabase.from(TABLE).upsert(
    { id: ROW_ID, password_hash: hash, updated_at: new Date().toISOString() },
    { onConflict: 'id' },
  );
  if (error) {
    console.error('[adminAuth] 비밀번호 저장 실패', error.code);
    const notFound = error.code === '42P01' || error.code === 'PGRST205';
    return { ok: false, error: notFound ? missingTable : saveFailed, code: error.code };
  }

  // 자가 검증 — 저장은 됐는데 못 읽는 상태로 배포를 마치면 어드민이 통째로 잠긴다.
  const stored = await loadStoredHash(supabase);
  if (!stored || !(await verifyHash(newPlain, stored))) {
    console.error('[adminAuth] 비밀번호 저장 후 자가 검증 실패');
    return { ok: false, error: '저장은 됐지만 검증에 실패했어요. 다시 시도해주세요.' };
  }
  return { ok: true };
}
