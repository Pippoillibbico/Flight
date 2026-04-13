import type { AiAdapterRequest } from '../types/ai-request.ts';
import type { AiProviderAdapter } from '../types/ai-adapter.ts';
import type { AiProviderResult } from '../types/ai-response.ts';

export interface OpenAiAdapterOptions {
  runner?: (request: AiAdapterRequest) => Promise<AiProviderResult>;
}

export function createOpenAiAdapter(options: OpenAiAdapterOptions = {}): AiProviderAdapter {
  return {
    provider: 'openai',
    async run(request: AiAdapterRequest): Promise<AiProviderResult> {
      if (typeof options.runner === 'function') {
        return options.runner(request);
      }
      return {
        ok: false,
        data: null,
        errorCode: 'openai_not_configured',
        errorMessage: 'OpenAI adapter is not configured in this environment.'
      };
    }
  };
}
