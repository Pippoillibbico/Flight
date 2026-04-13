import type { AiProvider } from './ai-provider.ts';
import type { AiAdapterRequest } from './ai-request.ts';
import type { AiProviderResult } from './ai-response.ts';

export interface AiProviderAdapter {
  provider: AiProvider;
  run(request: AiAdapterRequest): Promise<AiProviderResult>;
}

export type AiAdapterRegistry = Partial<Record<AiProvider, AiProviderAdapter>>;
