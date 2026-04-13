import { normalizeUserPlan } from '../../monetization/domain/plan-entitlements.ts';
import type { AiBudgetPolicyByPlan, AiGatewayUsageState, BudgetGuardContext } from '../types/ai-budget-policy.ts';
import type { AiGatewayBlockReason } from '../types/ai-response.ts';

export const DEFAULT_AI_BUDGET_POLICY_BY_PLAN: AiBudgetPolicyByPlan = {
  free: {
    maxRequestsPerSession: 8,
    maxEstimatedCostPerSession: 0.12,
    maxOutputTokensPerRequest: 500,
    maxTaskExecutionsPerPlan: {
      itinerary_generation: 6,
      premium_analysis: 0
    }
  },
  pro: {
    maxRequestsPerSession: 24,
    maxEstimatedCostPerSession: 0.85,
    maxOutputTokensPerRequest: 1300,
    maxTaskExecutionsPerPlan: {
      itinerary_generation: 20,
      premium_analysis: 8
    }
  },
  elite: {
    maxRequestsPerSession: 60,
    maxEstimatedCostPerSession: 2.8,
    maxOutputTokensPerRequest: 2600,
    maxTaskExecutionsPerPlan: {
      itinerary_generation: 50,
      premium_analysis: 40
    }
  }
};

export interface BudgetGuardResult {
  blocked: boolean;
  blockReason?: AiGatewayBlockReason;
  maxAllowedOutputTokens: number;
}

export function createEmptyAiUsageState(): AiGatewayUsageState {
  return {
    requestCount: 0,
    estimatedCostTotal: 0,
    taskExecutionCount: {
      classification: 0,
      ranking: 0,
      itinerary_generation: 0,
      summarization: 0,
      extraction: 0,
      premium_analysis: 0
    }
  };
}

export function applyBudgetGuard(
  usageState: AiGatewayUsageState,
  context: BudgetGuardContext,
  policyByPlan: AiBudgetPolicyByPlan = DEFAULT_AI_BUDGET_POLICY_BY_PLAN
): BudgetGuardResult {
  const normalizedPlan = normalizeUserPlan(context.planType);
  const policy = policyByPlan[normalizedPlan];
  const requestedTokens = Math.max(1, Math.round(Number(context.requestedOutputTokens) || 1));
  const maxAllowedOutputTokens = Math.min(requestedTokens, policy.maxOutputTokensPerRequest);
  if (requestedTokens > policy.maxOutputTokensPerRequest) {
    return {
      blocked: true,
      blockReason: 'max_output_tokens_per_request',
      maxAllowedOutputTokens
    };
  }

  if (usageState.requestCount >= policy.maxRequestsPerSession) {
    return {
      blocked: true,
      blockReason: 'max_requests_per_session',
      maxAllowedOutputTokens
    };
  }

  const nextCostTotal = Number((usageState.estimatedCostTotal + Number(context.estimatedCost || 0)).toFixed(6));
  if (nextCostTotal > policy.maxEstimatedCostPerSession) {
    return {
      blocked: true,
      blockReason: 'max_estimated_cost_per_session',
      maxAllowedOutputTokens
    };
  }

  const maxTaskExecutions = policy.maxTaskExecutionsPerPlan[context.taskType];
  if (Number.isFinite(Number(maxTaskExecutions))) {
    const safeLimit = Math.max(0, Math.round(Number(maxTaskExecutions)));
    const currentTaskCount = Math.max(0, Math.round(Number(usageState.taskExecutionCount[context.taskType]) || 0));
    if (currentTaskCount >= safeLimit) {
      return {
        blocked: true,
        blockReason: 'max_task_executions_per_plan',
        maxAllowedOutputTokens
      };
    }
  }

  return {
    blocked: false,
    maxAllowedOutputTokens
  };
}

export function updateUsageStateAfterSuccess(
  usageState: AiGatewayUsageState,
  context: { taskType: BudgetGuardContext['taskType']; estimatedCost: number }
): AiGatewayUsageState {
  const taskType = context.taskType;
  const nextTaskCount = Math.max(0, Math.round(Number(usageState.taskExecutionCount[taskType]) || 0)) + 1;
  return {
    requestCount: usageState.requestCount + 1,
    estimatedCostTotal: Number((usageState.estimatedCostTotal + Number(context.estimatedCost || 0)).toFixed(6)),
    taskExecutionCount: {
      ...usageState.taskExecutionCount,
      [taskType]: nextTaskCount
    }
  };
}
