import { askClaude } from './claude.js';
import { askHcx, HcxError } from './hcx.js';

// 벤더 선택은 여기 하나만. CLOVA_STUDIO_API_KEY가 있으면 HyperCLOVA X, 없으면 Claude.
// 호출부는 프롬프트를 만들고 텍스트를 해석할 뿐 어느 모델인지 모른다.

export type LlmProvider = 'hcx' | 'claude';

export interface LlmOptions {
  provider?: LlmProvider;
  maxTokens?: number;
  temperature?: number;
  system?: string;
  jsonSchema?: Record<string, unknown>;
}

export interface LlmResult {
  text: string;
  provider: LlmProvider;
  model: string;
  ms: number;
  truncated: boolean;
  outputTokens: number | null;
}

export interface LlmDeps {
  hcx: typeof askHcx;
  claude: typeof askClaude;
}

export function defaultProvider(): LlmProvider {
  return process.env.CLOVA_STUDIO_API_KEY ? 'hcx' : 'claude';
}

export async function askLlm(
  prompt: string,
  opts: LlmOptions = {},
  deps: LlmDeps = { hcx: askHcx, claude: askClaude },
): Promise<LlmResult> {
  const provider = opts.provider ?? defaultProvider();

  if (provider === 'claude') {
    const r = await deps.claude(prompt, { maxTokens: opts.maxTokens });
    return { ...r, provider };
  }

  const hcxOpts = { maxTokens: opts.maxTokens, temperature: opts.temperature, system: opts.system };
  try {
    const r = await deps.hcx(prompt, { ...hcxOpts, jsonSchema: opts.jsonSchema });
    return { ...r, provider };
  } catch (e) {
    // 스키마를 거부(4xx)하면 프롬프트의 "JSON만" 지시에 맡기고 한 번 더
    if (opts.jsonSchema && e instanceof HcxError && e.status >= 400 && e.status < 500) {
      console.warn('[llm] HCX responseFormat 거부, 스키마 없이 재시도:', e.body.slice(0, 200));
      const r = await deps.hcx(prompt, hcxOpts);
      return { ...r, provider };
    }
    throw e;
  }
}
