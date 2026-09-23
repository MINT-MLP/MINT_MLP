import { randomUUID } from 'crypto';

// HyperCLOVA X(CLOVA Studio Chat Completions v3) 호출 규칙은 여기 하나만.
// 인증은 CLOVA Studio 콘솔의 테스트 API 키(CLOVA_STUDIO_API_KEY) 하나. 모델은 CLOVA_MODEL로 바꾼다.

export const HCX_MODELS = {
  default: 'HCX-007',     // 구조화 JSON 출력 지원. 추론(thinking)은 끈다
  light: 'HCX-DASH-002',
} as const;

const ENDPOINT = 'https://clovastudio.stream.ntruss.com/v3/chat-completions';

export interface HcxOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  system?: string;
  /** HCX-007 전용 구조화 출력(JSON Schema). 추론·function calling과 동시 사용 불가라 thinking을 끈다 */
  jsonSchema?: Record<string, unknown>;
  apiKey?: string;
}

export interface HcxResult {
  text: string;
  model: string;
  ms: number;
  truncated: boolean;      // finishReason === 'length'
  outputTokens: number | null;
}

export class HcxError extends Error {
  constructor(message: string, readonly status: number, readonly body: string) {
    super(message);
    this.name = 'HcxError';
  }
}

// 테스트에서 가짜 fetch를 꽂기 위한 최소 형태
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
  Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

interface HcxResponse {
  status?: { code?: string; message?: string };
  result?: {
    message?: { role?: string; content?: string };
    finishReason?: string;
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  };
}

export async function askHcx(prompt: string, opts: HcxOptions = {}, fetchImpl: FetchLike = fetch): Promise<HcxResult> {
  const apiKey = opts.apiKey ?? process.env.CLOVA_STUDIO_API_KEY;
  if (!apiKey) throw new HcxError('CLOVA_STUDIO_API_KEY 미설정', 0, '');
  const model = opts.model ?? process.env.CLOVA_MODEL ?? HCX_MODELS.default;

  const body = {
    messages: [
      ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
      { role: 'user', content: prompt },
    ],
    maxCompletionTokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.5,
    topP: 0.8,
    ...(model.startsWith('HCX-007') ? { thinking: { effort: 'none' } } : {}),
    ...(opts.jsonSchema ? { responseFormat: { type: 'json', schema: opts.jsonSchema } } : {}),
  };

  const start = Date.now();
  const res = await fetchImpl(`${ENDPOINT}/${model}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-NCP-CLOVASTUDIO-REQUEST-ID': randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) throw new HcxError(`HCX HTTP ${res.status}`, res.status, raw.slice(0, 500));

  let data: HcxResponse;
  try {
    data = JSON.parse(raw) as HcxResponse;
  } catch {
    throw new HcxError('HCX 응답이 JSON이 아님', res.status, raw.slice(0, 500));
  }
  if (data.status?.code && data.status.code !== '20000') {
    throw new HcxError(`HCX ${data.status.code} ${data.status.message ?? ''}`.trim(), res.status, raw.slice(0, 500));
  }

  return {
    text: data.result?.message?.content ?? '',
    model,
    ms: Date.now() - start,
    truncated: data.result?.finishReason === 'length',
    outputTokens: data.result?.usage?.completionTokens ?? null,
  };
}
