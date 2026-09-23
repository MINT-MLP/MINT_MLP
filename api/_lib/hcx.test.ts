import { describe, it, expect } from 'vitest';
import { askHcx, HcxError, HCX_MODELS, type FetchLike } from './hcx';

// 실제 네트워크 없이 요청 형태와 응답 해석만 잠근다.
function fakeFetch(plan: { status?: number; body: unknown }) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const status = plan.status ?? 200;
    const text = typeof plan.body === 'string' ? plan.body : JSON.stringify(plan.body);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  return { impl, calls };
}

const ok = (content: string, finishReason = 'stop') => ({
  status: { code: '20000', message: 'OK' },
  result: { message: { role: 'assistant', content }, finishReason, usage: { promptTokens: 10, completionTokens: 7, totalTokens: 17 } },
});

describe('askHcx', () => {
  it('기본 모델 HCX-007, Bearer 인증, thinking none, user 메시지 하나', async () => {
    const { impl, calls } = fakeFetch({ body: ok('hello') });
    const r = await askHcx('질문', { apiKey: 'nv-test' }, impl);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://clovastudio.stream.ntruss.com/v3/chat-completions/${HCX_MODELS.default}`);
    expect(calls[0].headers.Authorization).toBe('Bearer nv-test');
    expect(calls[0].headers['X-NCP-CLOVASTUDIO-REQUEST-ID']).toBeTruthy();
    expect(calls[0].body.messages).toEqual([{ role: 'user', content: '질문' }]);
    expect(calls[0].body.maxCompletionTokens).toBe(4096);
    expect(calls[0].body.thinking).toEqual({ effort: 'none' });
    expect(calls[0].body.responseFormat).toBeUndefined();
    expect(r.text).toBe('hello');
    expect(r.model).toBe(HCX_MODELS.default);
    expect(r.truncated).toBe(false);
    expect(r.outputTokens).toBe(7);
  });

  it('system과 jsonSchema를 주면 system 메시지와 responseFormat json이 실린다', async () => {
    const { impl, calls } = fakeFetch({ body: ok('{"a":1}') });
    const schema = { type: 'object', properties: { a: { type: 'integer' } } };
    await askHcx('q', { apiKey: 'k', system: '큐레이터', jsonSchema: schema, maxTokens: 100, temperature: 0.2 }, impl);
    expect(calls[0].body.messages).toEqual([{ role: 'system', content: '큐레이터' }, { role: 'user', content: 'q' }]);
    expect(calls[0].body.responseFormat).toEqual({ type: 'json', schema });
    expect(calls[0].body.maxCompletionTokens).toBe(100);
    expect(calls[0].body.temperature).toBe(0.2);
  });

  it('HCX-007이 아닌 모델에는 thinking을 보내지 않는다', async () => {
    const { impl, calls } = fakeFetch({ body: ok('x') });
    await askHcx('q', { apiKey: 'k', model: HCX_MODELS.light }, impl);
    expect(calls[0].url.endsWith('/HCX-DASH-002')).toBe(true);
    expect(calls[0].body.thinking).toBeUndefined();
  });

  it('finishReason length는 truncated', async () => {
    const { impl } = fakeFetch({ body: ok('partial', 'length') });
    const r = await askHcx('q', { apiKey: 'k' }, impl);
    expect(r.truncated).toBe(true);
  });

  it('HTTP 오류는 상태코드와 본문을 담아 던진다', async () => {
    const { impl } = fakeFetch({ status: 401, body: { status: { code: '40100', message: 'Unauthorized' } } });
    const err = await askHcx('q', { apiKey: 'k' }, impl).catch((e) => e);
    expect(err).toBeInstanceOf(HcxError);
    expect(err.status).toBe(401);
    expect(err.body).toContain('40100');
  });

  it('HTTP 200이어도 status.code가 20000이 아니면 던진다', async () => {
    const { impl } = fakeFetch({ body: { status: { code: '42901', message: 'Too many requests' } } });
    await expect(askHcx('q', { apiKey: 'k' }, impl)).rejects.toThrow('42901');
  });

  it('키가 없으면 호출 없이 던진다', async () => {
    const { impl, calls } = fakeFetch({ body: ok('x') });
    const saved = process.env.CLOVA_STUDIO_API_KEY;
    delete process.env.CLOVA_STUDIO_API_KEY;
    try {
      await expect(askHcx('q', {}, impl)).rejects.toThrow('CLOVA_STUDIO_API_KEY');
      expect(calls).toHaveLength(0);
    } finally {
      if (saved !== undefined) process.env.CLOVA_STUDIO_API_KEY = saved;
    }
  });
});
