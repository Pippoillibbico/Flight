import type { UserPlan } from '../../monetization/types/index.ts';
import type { AiProvider } from '../types/ai-provider.ts';
import type { AiTaskType } from '../types/ai-task-type.ts';

export function selectProviderForTask(taskType: AiTaskType, planType: UserPlan): AiProvider {
  if (taskType === 'premium_analysis') {
    return planType === 'elite' ? 'anthropic' : 'openai';
  }
  if (taskType === 'itinerary_generation') {
    return planType === 'elite' ? 'anthropic' : 'openai';
  }
  if (taskType === 'ranking' || taskType === 'summarization') return 'openai';
  if (taskType === 'classification' || taskType === 'extraction') return 'openai';
  return 'mock';
}
