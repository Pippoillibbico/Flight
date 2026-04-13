import type { AiAdapterRequest } from '../types/ai-request.ts';
import type { AiProviderAdapter } from '../types/ai-adapter.ts';
import type { AiProviderResult } from '../types/ai-response.ts';

export interface AnthropicAdapterOptions {
  runner?: (request: AiAdapterRequest) => Promise<AiProviderResult>;
}

export function createAnthropicAdapter(options: AnthropicAdapterOptions = {}): AiProviderAdapter {
  return {
    provider: 'anthropic',
    async run(request: AiAdapterRequest): Promise<AiProviderResult> {
      if (typeof options.runner === 'function') {
        return options.runner(request);
      }
      return {
        ok: false,
        data: null,
        errorCode: 'anthropic_not_configured',
        errorMessage: 'Anthropic adapter is not configured in this environment.'
      };
    }
  };
}
