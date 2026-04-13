import type { UserPlan } from '../../monetization/types/index.ts';
import type { AiTaskType } from './ai-task-type.ts';

export interface AiBudgetPolicy {
  maxRequestsPerSession: number;
  maxEstimatedCostPerSession: number;
  maxOutputTokensPerRequest: number;
  maxTaskExecutionsPerPlan: Partial<Record<AiTaskType, number>>;
}

export interface AiBudgetPolicyByPlan {
  free: AiBudgetPolicy;
  pro: AiBudgetPolicy;
  elite: AiBudgetPolicy;
}

export interface AiGatewayUsageState {
  requestCount: number;
  estimatedCostTotal: number;
  taskExecutionCount: Record<AiTaskType, number>;
}

export interface BudgetGuardContext {
  planType: UserPlan;
  taskType: AiTaskType;
  requestedOutputTokens: number;
  estimatedCost: number;
}
