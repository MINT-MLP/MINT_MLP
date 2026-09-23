import { describe, it, expect } from 'vitest';
import { askLlm, defaultProvider, type LlmDeps } from './llm';
import { HcxError } from './hcx';

function deps(plan: { hcx?: Array<{ throwStatus?: number; text?: string }>; claudeText?: string }) {
  const hcxCalls: Array<Record<string, unknown> | undefined> = [];
  const claudeCalls: string[] = [];
  let i = 0;
  const d: LlmDeps = {
    hcx: async (_prompt, opts) => {
      hcxCalls.push(opts as Record<string, unknown>);
      const step = plan.hcx?.[i++] ?? {};
      if (step.throwStatus) throw new HcxError('boom', step.throwStatus, 'schema invalid');
      return { text: step.text ?? 'hcx', model: 'HCX-007', ms: 1, truncated: false, outputTokens: 3 };
    },
    claude: async (prompt) => {
      claudeCalls.push(prompt);
      return { text: plan.claudeText ?? 'claude', model: 'claude-haiku-4-5-20251001', ms: 1, truncated: false, outputTokens: 2 };
    },
  };
  return { d, hcxCalls, claudeCalls };
}

describe('askLlm', () => {
  it('기본 벤더는 CLOVA_STUDIO_API_KEY 유무로 정해진다', () => {
    const saved = process.env.CLOVA_STUDIO_API_KEY;
    try {
      delete process.env.CLOVA_STUDIO_API_KEY;
      expect(defaultProvider()).toBe('claude');
      process.env.CLOVA_STUDIO_API_KEY = 'nv-x';
      expect(defaultProvider()).toBe('hcx');
    } finally {
      if (saved === undefined) delete process.env.CLOVA_STUDIO_API_KEY;
      else process.env.CLOVA_STUDIO_API_KEY = saved;
    }
  });

  it('provider claude면 Claude만 부르고 provider를 보고한다', async () => {
    const { d, hcxCalls, claudeCalls } = deps({});
    const r = await askLlm('q', { provider: 'claude' }, d);
    expect(claudeCalls).toEqual(['q']);
    expect(hcxCalls).toHaveLength(0);
    expect(r.provider).toBe('claude');
    expect(r.text).toBe('claude');
  });

  it('HCX가 스키마를 4xx로 거부하면 스키마 없이 한 번 더 부른다', async () => {
    const { d, hcxCalls } = deps({ hcx: [{ throwStatus: 400 }, { text: 'retry' }] });
    const r = await askLlm('q', { provider: 'hcx', jsonSchema: { type: 'object' } }, d);
    expect(hcxCalls).toHaveLength(2);
    expect(hcxCalls[0]?.jsonSchema).toBeDefined();
    expect(hcxCalls[1]?.jsonSchema).toBeUndefined();
    expect(r.text).toBe('retry');
  });

  it('스키마 없는 호출의 4xx나 5xx는 그대로 던진다', async () => {
    const a = deps({ hcx: [{ throwStatus: 400 }] });
    await expect(askLlm('q', { provider: 'hcx' }, a.d)).rejects.toBeInstanceOf(HcxError);
    const b = deps({ hcx: [{ throwStatus: 500 }] });
    await expect(askLlm('q', { provider: 'hcx', jsonSchema: { type: 'object' } }, b.d)).rejects.toBeInstanceOf(HcxError);
    expect(b.hcxCalls).toHaveLength(1);
  });
});
