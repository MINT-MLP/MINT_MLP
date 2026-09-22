import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { askClaude, CLAUDE_MODELS, type MessagesClient } from './claude';

// SDK 없이 가짜 클라이언트로 호출 규칙만 잠근다.
function fakeClient(plan: Array<{ throwStatus?: number; text?: string[]; stop?: string; outputTokens?: number }>) {
  const calls: unknown[] = [];
  let i = 0;
  const client = {
    messages: {
      create: (async (params: unknown) => {
        calls.push(params);
        const step = plan[i++];
        if (step.throwStatus) throw new Anthropic.APIError(step.throwStatus, undefined, 'overloaded', undefined);
        return {
          content: (step.text ?? ['ok']).map((t) => ({ type: 'text', text: t })),
          stop_reason: step.stop ?? 'end_turn',
          usage: { output_tokens: step.outputTokens ?? 7 },
        };
      }) as unknown as MessagesClient['messages']['create'],
    },
  } as MessagesClient;
  return { client, calls: calls as Array<{ model: string; max_tokens: number; thinking?: unknown; messages: unknown[] }> };
}

describe('askClaude', () => {
  it('기본 모델은 fast, max_tokens 8192, user 메시지 하나', async () => {
    const { client, calls } = fakeClient([{ text: ['hello'] }]);
    const r = await askClaude('질문', {}, client);
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe(CLAUDE_MODELS.fast);
    expect(calls[0].max_tokens).toBe(8192);
    expect(calls[0].messages).toEqual([{ role: 'user', content: '질문' }]);
    expect(r.text).toBe('hello');
    expect(r.model).toBe(CLAUDE_MODELS.fast);
    expect(r.truncated).toBe(false);
    expect(r.outputTokens).toBe(7);
  });

  it('529면 폴백 모델로 한 번 더 부르고 응답 모델을 폴백으로 보고한다', async () => {
    const { client, calls } = fakeClient([{ throwStatus: 529 }, { text: ['fallback'] }]);
    const r = await askClaude('q', {}, client);
    expect(calls.map((c) => c.model)).toEqual([CLAUDE_MODELS.fast, CLAUDE_MODELS.fallback]);
    expect(r.text).toBe('fallback');
    expect(r.model).toBe(CLAUDE_MODELS.fallback);
  });

  it('529가 아닌 에러는 폴백 없이 그대로 던진다', async () => {
    const { client, calls } = fakeClient([{ throwStatus: 401 }]);
    await expect(askClaude('q', {}, client)).rejects.toBeInstanceOf(Anthropic.APIError);
    expect(calls).toHaveLength(1);
  });

  it('fallbackModel: null이면 529도 그대로 던진다', async () => {
    const { client, calls } = fakeClient([{ throwStatus: 529 }]);
    await expect(askClaude('q', { fallbackModel: null }, client)).rejects.toBeInstanceOf(Anthropic.APIError);
    expect(calls).toHaveLength(1);
  });

  it('sonnet-5 계열만 thinking을 끈다', async () => {
    const a = fakeClient([{}]);
    await askClaude('q', { model: 'claude-sonnet-5' }, a.client);
    expect(a.calls[0].thinking).toEqual({ type: 'disabled' });
    const b = fakeClient([{}]);
    await askClaude('q', { model: CLAUDE_MODELS.fast }, b.client);
    expect(b.calls[0].thinking).toBeUndefined();
  });

  it('텍스트 블록만 이어 붙이고, max_tokens 종료는 truncated로 표시한다', async () => {
    const { client } = fakeClient([{ text: ['a', 'b'], stop: 'max_tokens', outputTokens: 8192 }]);
    const r = await askClaude('q', { maxTokens: 100 }, client);
    expect(r.text).toBe('ab');
    expect(r.truncated).toBe(true);
    expect(r.outputTokens).toBe(8192);
  });
});
