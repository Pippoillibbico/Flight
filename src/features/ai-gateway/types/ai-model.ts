export type AiModel = 'mini' | 'balanced' | 'premium';

export const MODEL_PRIORITY: Record<AiModel, number> = {
  mini: 0,
  balanced: 1,
  premium: 2
};
