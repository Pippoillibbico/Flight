import type { AiModel } from '../types/ai-model.ts';
import type { AiProvider } from '../types/ai-provider.ts';
import type { AiTaskType } from '../types/ai-task-type.ts';

const BASE_COST_BY_MODEL: Record<AiModel, number> = {
  mini: 0.0025,
  balanced: 0.0075,
  premium: 0.018
};

const PROVIDER_MULTIPLIER: Record<AiProvider, number> = {
  openai: 1,
  anthropic: 1.08,
  mock: 0
};

const TASK_COMPLEXITY_MULTIPLIER: Record<AiTaskType, number> = {
  classification: 0.7,
  extraction: 0.8,
  summarization: 1,
  ranking: 1.05,
  itinerary_generation: 1.2,
  premium_analysis: 1.35
};

export function estimateAiCost({
  provider,
  model,
  taskType,
  outputTokens
}: {
  provider: AiProvider;
  model: AiModel;
  taskType: AiTaskType;
  outputTokens: number;
}): number {
  const tokenCount = Math.max(1, Math.round(Number(outputTokens) || 1));
  const tokenFactor = Math.min(4, tokenCount / 500);
  const base = BASE_COST_BY_MODEL[model];
  const providerFactor = PROVIDER_MULTIPLIER[provider];
  const taskFactor = TASK_COMPLEXITY_MULTIPLIER[taskType];
  const cost = base * providerFactor * taskFactor * tokenFactor;
  return Math.max(0, Number(cost.toFixed(6)));
}
