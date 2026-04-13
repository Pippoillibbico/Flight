import { createEmptyAiUsageState, DEFAULT_AI_BUDGET_POLICY_BY_PLAN } from './apply-budget-guard.ts';
import { routeAiRequest } from './route-ai-request.ts';
import type { AiBudgetPolicyByPlan, AiGatewayUsageState } from '../types/ai-budget-policy.ts';
import type { AiAdapterRegistry } from '../types/ai-adapter.ts';
import type { AiGatewayRequest } from '../types/ai-request.ts';
import type { AiGatewayResult } from '../types/ai-response.ts';
import type { AiProviderAvailability } from '../types/ai-provider.ts';

export interface AiGateway {
  execute(request: AiGatewayRequest): Promise<AiGatewayResult>;
  getUsageState(): AiGatewayUsageState;
  resetUsageState(): void;
}

export interface CreateAiGatewayOptions {
  adapters: AiAdapterRegistry;
  providerAvailability?: Partial<AiProviderAvailability>;
  budgetPolicyByPlan?: AiBudgetPolicyByPlan;
  now?: () => string;
}

export function createAiGateway(options: CreateAiGatewayOptions): AiGateway {
  const availability: AiProviderAvailability = {
    openai: options.providerAvailability?.openai ?? true,
    anthropic: options.providerAvailability?.anthropic ?? true,
    mock: options.providerAvailability?.mock ?? true
  };
  const policy = options.budgetPolicyByPlan || DEFAULT_AI_BUDGET_POLICY_BY_PLAN;
  let usageState: AiGatewayUsageState = createEmptyAiUsageState();

  return {
    async execute(request: AiGatewayRequest): Promise<AiGatewayResult> {
      const routed = await routeAiRequest({
        request,
        adapters: options.adapters,
        usageState,
        providerAvailability: availability,
        budgetPolicyByPlan: policy,
        now: options.now
      });
      usageState = routed.usageState;
      return routed.result;
    },
    getUsageState(): AiGatewayUsageState {
      return usageState;
    },
    resetUsageState(): void {
      usageState = createEmptyAiUsageState();
    }
  };
}
