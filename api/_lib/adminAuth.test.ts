import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  hashPassword,
  verifyHash,
  safeEqualStr,
  validateNewPassword,
  verifyAdminPassword,
} from './adminAuth';

const ORIGINAL_ENV = process.env.ADMIN_PASSWORD;

afterAll(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = ORIGINAL_ENV;
});

// verifyAdminPassword가 실제로 부르는 체인(from → select → eq → maybeSingle)만 흉내낸다.
function fakeSupabase(data: { password_hash?: string } | null, error: { code: string } | null = null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data, error }),
        }),
      }),
    }),
  } as never;
}

describe('hashPassword / verifyHash', () => {
  it('해시한 비밀번호는 같은 값으로 검증에 성공한다', async () => {
    const hash = await hashPassword('mint-admin-1234');
    expect(await verifyHash('mint-admin-1234', hash)).toBe(true);
  });

  it('다른 비밀번호는 검증에 실패한다', async () => {
    const hash = await hashPassword('mint-admin-1234');
    expect(await verifyHash('mint-admin-1235', hash)).toBe(false);
  });

  it('같은 비밀번호라도 salt가 매번 달라 해시 문자열이 다르다', async () => {
    const a = await hashPassword('mint-admin-1234');
    const b = await hashPassword('mint-admin-1234');
    expect(a).not.toBe(b);
    expect(await verifyHash('mint-admin-1234', b)).toBe(true);
  });

  it('해시 포맷은 scrypt$N$r$p$salt$key 6조각이다', async () => {
    const parts = (await hashPassword('mint-admin-1234')).split('$');
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe('scrypt');
  });

  it('조각 수가 모자란 문자열은 예외 없이 false', async () => {
    expect(await verifyHash('pw', 'scrypt$16384$8$1$abcd')).toBe(false);
    expect(await verifyHash('pw', '')).toBe(false);
  });

  it('prefix가 다르면 false', async () => {
    const hash = await hashPassword('mint-admin-1234');
    expect(await verifyHash('mint-admin-1234', hash.replace('scrypt', 'bcrypt'))).toBe(false);
  });

  it('N이 허용 범위 밖이거나 2의 거듭제곱이 아니면 false', async () => {
    const hash = await hashPassword('mint-admin-1234');
    const [, , r, p, salt, key] = hash.split('$');
    expect(await verifyHash('mint-admin-1234', ['scrypt', '12345', r, p, salt, key].join('$'))).toBe(false);
    expect(await verifyHash('mint-admin-1234', ['scrypt', '512', r, p, salt, key].join('$'))).toBe(false);
    expect(await verifyHash('mint-admin-1234', ['scrypt', '4194304', r, p, salt, key].join('$'))).toBe(false);
  });

  it('salt/key가 base64가 아니면 false', async () => {
    const hash = await hashPassword('mint-admin-1234');
    const [, n, r, p, , key] = hash.split('$');
    expect(await verifyHash('mint-admin-1234', ['scrypt', n, r, p, '!!not-b64!!', key].join('$'))).toBe(false);
  });

  it('한글 비밀번호는 NFD로 입력해도 NFC 해시와 일치한다', async () => {
    const hash = await hashPassword('민초비밀번호'.normalize('NFD'));
    expect(await verifyHash('민초비밀번호'.normalize('NFC'), hash)).toBe(true);
  });
});

describe('safeEqualStr', () => {
  it('같은 문자열이면 true, 길이가 달라도 예외 없이 false', () => {
    expect(safeEqualStr('abc', 'abc')).toBe(true);
    expect(safeEqualStr('abc', 'abcdefgh')).toBe(false);
    expect(safeEqualStr('', '')).toBe(true);
  });
});

describe('validateNewPassword', () => {
  it('7자는 거부하고 8자는 통과', () => {
    expect(validateNewPassword('1234567', 'old-password')).toEqual({
      ok: false, error: '비밀번호는 8자 이상이어야 해요.',
    });
    expect(validateNewPassword('12345678', 'old-password')).toEqual({ ok: true, value: '12345678' });
  });

  it('65자는 거부', () => {
    const r = validateNewPassword('a'.repeat(65), 'old-password');
    expect(r).toEqual({ ok: false, error: '비밀번호는 64자 이하여야 해요.' });
  });

  it('빈 값·문자열 아님은 안내 문구로 거부', () => {
    expect(validateNewPassword('   ', 'old-password')).toEqual({
      ok: false, error: '새 비밀번호를 입력해주세요.',
    });
    expect(validateNewPassword(undefined, 'old-password')).toEqual({
      ok: false, error: '새 비밀번호를 입력해주세요.',
    });
  });

  it('제어문자가 섞이면 거부', () => {
    expect(validateNewPassword('abcd\nefgh', 'old-password')).toEqual({
      ok: false, error: '비밀번호에 쓸 수 없는 문자가 있어요.',
    });
  });

  it('현재 비밀번호와 같으면 거부 (앞뒤 공백 무시)', () => {
    expect(validateNewPassword('  same-password  ', 'same-password')).toEqual({
      ok: false, error: '현재 비밀번호와 다른 비밀번호를 입력해주세요.',
    });
  });

  it('앞뒤 공백은 잘라서 저장값으로 쓴다', () => {
    expect(validateNewPassword('  new-password  ', 'old-password')).toEqual({
      ok: true, value: 'new-password',
    });
  });
});

describe('verifyAdminPassword', () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = 'env-password';
  });

  it('DB 행이 있으면 DB 해시만 인정하고 env는 무시한다', async () => {
    const hash = await hashPassword('db-password');
    const sb = fakeSupabase({ password_hash: hash });
    expect(await verifyAdminPassword(sb, 'db-password')).toEqual({ ok: true, source: 'db' });
    expect(await verifyAdminPassword(sb, 'env-password')).toEqual({ ok: false, reason: 'unauth' });
  });

  it('DB 행이 없으면 env로 폴백한다', async () => {
    const sb = fakeSupabase(null);
    expect(await verifyAdminPassword(sb, 'env-password')).toEqual({ ok: true, source: 'env' });
    expect(await verifyAdminPassword(sb, 'wrong')).toEqual({ ok: false, reason: 'unauth' });
  });

  it('DB 조회가 실패해도(테이블 미생성 등) env로 폴백한다', async () => {
    const sb = fakeSupabase(null, { code: '42P01' });
    expect(await verifyAdminPassword(sb, 'env-password')).toEqual({ ok: true, source: 'env' });
  });

  it('supabase 클라이언트가 없으면 env로 폴백한다', async () => {
    expect(await verifyAdminPassword(null, 'env-password')).toEqual({ ok: true, source: 'env' });
  });

  it('DB 행도 env도 없으면 unconfigured', async () => {
    delete process.env.ADMIN_PASSWORD;
    expect(await verifyAdminPassword(fakeSupabase(null), 'anything')).toEqual({
      ok: false, reason: 'unconfigured',
    });
  });

  it('문자열이 아닌 후보는 빈 문자열로 취급해 통과시키지 않는다', async () => {
    const sb = fakeSupabase(null);
    expect(await verifyAdminPassword(sb, undefined)).toEqual({ ok: false, reason: 'unauth' });
    expect(await verifyAdminPassword(sb, { toString: () => 'env-password' })).toEqual({
      ok: false, reason: 'unauth',
    });
  });

  it('앞뒤 공백이 있는 후보도 통과한다', async () => {
    expect(await verifyAdminPassword(fakeSupabase(null), '  env-password  ')).toEqual({
      ok: true, source: 'env',
    });
  });
});
