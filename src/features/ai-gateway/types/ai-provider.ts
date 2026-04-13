export type AiProvider = 'openai' | 'anthropic' | 'mock';

export interface AiProviderAvailability {
  openai: boolean;
  anthropic: boolean;
  mock: boolean;
}
