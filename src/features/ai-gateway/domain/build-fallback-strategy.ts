import type { AiModel } from '../types/ai-model.ts';
import type { AiProvider, AiProviderAvailability } from '../types/ai-provider.ts';
import type { AiTaskType } from '../types/ai-task-type.ts';

export interface FallbackTarget {
  provider: AiProvider;
  model: AiModel;
}

function providerFallbackOrder(primaryProvider: AiProvider): AiProvider[] {
  if (primaryProvider === 'openai') return ['anthropic', 'mock'];
  if (primaryProvider === 'anthropic') return ['openai', 'mock'];
  return ['openai', 'anthropic'];
}

function downgradeModel(model: AiModel): AiModel[] {
  if (model === 'premium') return ['balanced', 'mini'];
  if (model === 'balanced') return ['mini'];
  return [];
}

export function buildFallbackStrategy({
  taskType,
  primaryProvider,
  primaryModel,
  availability
}: {
  taskType: AiTaskType;
  primaryProvider: AiProvider;
  primaryModel: AiModel;
  availability: AiProviderAvailability;
}): FallbackTarget[] {
  const fallbackTargets: FallbackTarget[] = [];

  for (const model of downgradeModel(primaryModel)) {
    fallbackTargets.push({ provider: primaryProvider, model });
  }

  const providerOrder = providerFallbackOrder(primaryProvider);
  for (const provider of providerOrder) {
    if (!availability[provider]) continue;
    fallbackTargets.push({ provider, model: primaryModel });
    for (const model of downgradeModel(primaryModel)) {
      fallbackTargets.push({ provider, model });
    }
  }

  if (taskType === 'premium_analysis' && availability.mock) {
    fallbackTargets.push({ provider: 'mock', model: 'balanced' });
  }

  return fallbackTargets;
}
