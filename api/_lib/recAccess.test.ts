import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ownsRecommendation, isSessionHost } from './recAccess';

const fake = (row: { user_id: string | null; claim_token_hash: string | null } | null) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }),
}) as unknown as SupabaseClient;

const token = 'x'.repeat(32);
const hash = createHash('sha256').update(token, 'utf8').digest('hex');

describe('ownsRecommendation', () => {
  it('회원 추천은 주인 회원만', async () => {
    expect(await ownsRecommendation(fake({ user_id: 'u1', claim_token_hash: null }), 1, 'u1', undefined)).toBe(true);
    expect(await ownsRecommendation(fake({ user_id: 'u1', claim_token_hash: null }), 1, 'u2', undefined)).toBe(false);
    expect(await ownsRecommendation(fake({ user_id: 'u1', claim_token_hash: null }), 1, null, token)).toBe(false);
  });

  it('비회원 추천은 일회용 토큰이 맞을 때만', async () => {
    expect(await ownsRecommendation(fake({ user_id: null, claim_token_hash: hash }), 1, null, token)).toBe(true);
    expect(await ownsRecommendation(fake({ user_id: null, claim_token_hash: hash }), 1, null, 'y'.repeat(32))).toBe(false);
    expect(await ownsRecommendation(fake({ user_id: null, claim_token_hash: null }), 1, 'u1', token)).toBe(false);
  });

  it('없는 추천은 거부', async () => {
    expect(await ownsRecommendation(fake(null), 1, 'u1', token)).toBe(false);
  });
});

const fakeSession = (row: { host_token_hash: string | null } | null) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
}) as unknown as SupabaseClient;

describe('isSessionHost', () => {
  it('비밀값이 맞아야 호스트', async () => {
    expect(await isSessionHost(fakeSession({ host_token_hash: hash }), 's1', token)).toBe(true);
    expect(await isSessionHost(fakeSession({ host_token_hash: hash }), 's1', 'y'.repeat(32))).toBe(false);
    expect(await isSessionHost(fakeSession({ host_token_hash: hash }), 's1', undefined)).toBe(false);
  });

  it('비밀값 없는 옛 세션은 예전처럼 허용, 없는 세션은 null', async () => {
    expect(await isSessionHost(fakeSession({ host_token_hash: null }), 's1', undefined)).toBe(true);
    expect(await isSessionHost(fakeSession(null), 's1', token)).toBe(null);
  });
});
