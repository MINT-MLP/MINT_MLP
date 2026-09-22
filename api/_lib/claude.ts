import Anthropic from '@anthropic-ai/sdk';

// Claude 호출 규칙은 여기 하나만. 호출부는 프롬프트를 만들고 응답 텍스트를 해석한다.

export const CLAUDE_MODELS = {
  fast: 'claude-haiku-4-5-20251001',   // 후보 선별만 하므로 저지연 모델로 충분
  fallback: 'claude-sonnet-4-6',       // 529 과부하 시 한 번
} as const;

export interface AskOptions {
  model?: string;
  maxTokens?: number;
  /** null이면 529에도 폴백하지 않고 던진다 */
  fallbackModel?: string | null;
}

export interface AskResult {
  text: string;
  model: string;           // 실제 응답한 모델
  ms: number;
  truncated: boolean;      // stop_reason === 'max_tokens'
  outputTokens: number | null;
}

export type MessagesClient = { messages: { create: Anthropic['messages']['create'] } };

let cached: Anthropic | null = null;
function defaultClient(): MessagesClient {
  if (!cached) cached = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return cached;
}

export async function askClaude(prompt: string, opts: AskOptions = {}, client: MessagesClient = defaultClient()): Promise<AskResult> {
  const model = opts.model ?? CLAUDE_MODELS.fast;
  const maxTokens = opts.maxTokens ?? 8192;
  const fallbackModel = opts.fallbackModel === undefined ? CLAUDE_MODELS.fallback : opts.fallbackModel;

  const create = (m: string) => client.messages.create({
    model: m,
    max_tokens: maxTokens,
    // sonnet-5는 기본이 adaptive thinking — JSON 선택 작업이라 끈다
    ...(m.startsWith('claude-sonnet-5') ? { thinking: { type: 'disabled' as const } } : {}),
    messages: [{ role: 'user', content: prompt }],
  });

  const start = Date.now();
  let usedModel = model;
  let message: Anthropic.Message;
  try {
    message = await create(model);
  } catch (e) {
    if (fallbackModel && e instanceof Anthropic.APIError && e.status === 529) {
      usedModel = fallbackModel;
      message = await create(fallbackModel);
    } else {
      throw e;
    }
  }

  const text = message.content
    .filter((b) => b.type === 'text')
    .map((b) => ('text' in b ? b.text : ''))
    .join('');

  return {
    text,
    model: usedModel,
    ms: Date.now() - start,
    truncated: message.stop_reason === 'max_tokens',
    outputTokens: message.usage?.output_tokens ?? null,
  };
}
