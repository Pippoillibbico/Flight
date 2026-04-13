import type { UserPlan } from '../../monetization/types/index.ts';
import type { AiModel } from '../types/ai-model.ts';
import type { AiTaskType } from '../types/ai-task-type.ts';

function modelByPlan(planType: UserPlan): AiModel {
  if (planType === 'elite') return 'premium';
  if (planType === 'pro') return 'balanced';
  return 'mini';
}

export function selectModelForTask(taskType: AiTaskType, planType: UserPlan): AiModel {
  if (taskType === 'classification' || taskType === 'extraction') return 'mini';

  if (taskType === 'summarization' || taskType === 'ranking') {
    return planType === 'free' ? 'mini' : 'balanced';
  }

  if (taskType === 'itinerary_generation') {
    return modelByPlan(planType);
  }

  if (taskType === 'premium_analysis') {
    return planType === 'elite' ? 'premium' : 'balanced';
  }

  return modelByPlan(planType);
}
