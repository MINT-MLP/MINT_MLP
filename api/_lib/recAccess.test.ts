import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ownsRecommendation } from './recAccess';

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
