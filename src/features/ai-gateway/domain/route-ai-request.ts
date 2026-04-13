import { normalizeUserPlan } from '../../monetization/domain/plan-entitlements.ts';
import { applyBudgetGuard, DEFAULT_AI_BUDGET_POLICY_BY_PLAN, updateUsageStateAfterSuccess } from './apply-budget-guard.ts';
import { buildFallbackStrategy } from './build-fallback-strategy.ts';
import { estimateAiCost } from './estimate-ai-cost.ts';
import { minimizeAiInputForTask } from './minimize-ai-input.ts';
import { selectModelForTask } from './select-model-for-task.ts';
import { selectProviderForTask } from './select-provider-for-task.ts';
import { validateStructuredOutput } from './validate-structured-output.ts';
import type { AiBudgetPolicyByPlan, AiGatewayUsageState } from '../types/ai-budget-policy.ts';
import type { AiAdapterRegistry } from '../types/ai-adapter.ts';
import type { AiGatewayRequest } from '../types/ai-request.ts';
import type { AiGatewayErrorCode, AiGatewayResult } from '../types/ai-response.ts';
import type { AiModel } from '../types/ai-model.ts';
import type { AiProvider, AiProviderAvailability } from '../types/ai-provider.ts';

interface RoutingCandidate {
  provider: AiProvider;
  model: AiModel;
}

interface RouteAiRequestParams {
  request: AiGatewayRequest;
  adapters: AiAdapterRegistry;
  usageState: AiGatewayUsageState;
  providerAvailability: AiProviderAvailability;
  budgetPolicyByPlan?: AiBudgetPolicyByPlan;
  now?: () => string;
}

const PROVIDER_ERROR_MAX_LENGTH = 180;

function buildRequestId(requestId: string | undefined, now: () => string): string {
  const normalized = String(requestId || '').trim();
  if (normalized) return normalized;
  return `ai_req_${now().replace(/[^0-9TZ]/g, '')}`;
}

function dedupeCandidates(candidates: RoutingCandidate[]): RoutingCandidate[] {
  const seen = new Set<string>();
  const unique: RoutingCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.provider}:${candidate.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

function resolveRequestedOutputTokens(
  requestMaxOutputTokens: number | undefined,
  planType: ReturnType<typeof normalizeUserPlan>,
  policyByPlan: AiBudgetPolicyByPlan
): number {
  const fallback = policyByPlan[planType].maxOutputTokensPerRequest;
  const parsed = Math.round(Number(requestMaxOutputTokens));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function sanitizeProviderFailureMessage(value: unknown): string {
  const normalized = String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[<>\u2028\u2029]/g, '')
    .trim();
  if (!normalized) return 'Provider failed.';
  const redacted = normalized
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/\b(sk-[A-Za-z0-9_-]{10,})\b/g, '[REDACTED_TOKEN]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]{10,}\b/gi, '$1[REDACTED]');
  return redacted.slice(0, PROVIDER_ERROR_MAX_LENGTH);
}

export async function routeAiRequest(params: RouteAiRequestParams): Promise<{
  result: AiGatewayResult;
  usageState: AiGatewayUsageState;
}> {
  const {
    request,
    adapters,
    usageState,
    providerAvailability,
    budgetPolicyByPlan = DEFAULT_AI_BUDGET_POLICY_BY_PLAN,
    now = () => new Date().toISOString()
  } = params;
  const planType = normalizeUserPlan(request.planType);
  const primaryProvider = request.preferredProvider || selectProviderForTask(request.taskType, planType);
  const primaryModel = request.preferredModel || selectModelForTask(request.taskType, planType);
  const requestedOutputTokens = resolveRequestedOutputTokens(request.maxOutputTokens, planType, budgetPolicyByPlan);
  const requestId = buildRequestId(request.requestId, now);

  const fallbacks = buildFallbackStrategy({
    taskType: request.taskType,
    primaryProvider,
    primaryModel,
    availability: providerAvailability
  });
  const candidates = dedupeCandidates([{ provider: primaryProvider, model: primaryModel }, ...fallbacks]);

  let fallbackUsed = false;
  let blockedReasonForAllCandidates: AiGatewayResult['telemetry']['blockReason'] | undefined;
  let blockedCount = 0;
  let lastFailureMessage = '';
  let lastFailureCode: AiGatewayErrorCode = 'provider_failed';

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!candidate) continue;
    const estimatedCost = estimateAiCost({
      provider: candidate.provider,
      model: candidate.model,
      taskType: request.taskType,
      outputTokens: requestedOutputTokens
    });
    const budgetGuard = applyBudgetGuard(
      usageState,
      {
        planType,
        taskType: request.taskType,
        requestedOutputTokens,
        estimatedCost
      },
      budgetPolicyByPlan
    );

    if (budgetGuard.blocked) {
      blockedCount += 1;
      blockedReasonForAllCandidates = budgetGuard.blockReason;
      // If output/request/task hard limit is hit, fallback cannot help.
      if (
        budgetGuard.blockReason === 'max_output_tokens_per_request' ||
        budgetGuard.blockReason === 'max_requests_per_session' ||
        budgetGuard.blockReason === 'max_task_executions_per_plan'
      ) {
        return {
          result: {
            ok: false,
            data: null,
            error: {
              code: 'blocked_by_policy',
              message: `AI request blocked by policy: ${budgetGuard.blockReason}.`,
              blockReason: budgetGuard.blockReason
            },
            telemetry: {
              provider: candidate.provider,
              model: candidate.model,
              taskType: request.taskType,
              usedFallback: index > 0,
              estimatedCost,
              blockedByPolicy: true,
              blockReason: budgetGuard.blockReason
            }
          },
          usageState
        };
      }
      fallbackUsed = index > 0;
      continue;
    }

    const adapter = adapters[candidate.provider];
    if (!adapter || !providerAvailability[candidate.provider]) {
      fallbackUsed = index > 0;
      lastFailureCode = 'adapter_not_available';
      lastFailureMessage = `Adapter unavailable for provider ${candidate.provider}.`;
      continue;
    }

    const providerResult = await adapter.run({
      taskType: request.taskType,
      planType,
      model: candidate.model,
      provider: candidate.provider,
      input: minimizeAiInputForTask(request.taskType, request.input),
      maxOutputTokens: requestedOutputTokens,
      requestId
    });
    if (!providerResult.ok) {
      fallbackUsed = index > 0;
      lastFailureCode = 'provider_failed';
      lastFailureMessage = sanitizeProviderFailureMessage(providerResult.errorMessage || providerResult.errorCode || 'Provider failed.');
      continue;
    }

    const validation = validateStructuredOutput(request.taskType, providerResult.data);
    if (!validation.valid) {
      fallbackUsed = index > 0;
      lastFailureCode = 'structured_output_invalid';
      lastFailureMessage = sanitizeProviderFailureMessage(validation.errorMessage || 'Structured output validation failed.');
      continue;
    }

    const nextUsageState = updateUsageStateAfterSuccess(usageState, {
      taskType: request.taskType,
      estimatedCost
    });
    return {
      result: {
        ok: true,
        data: validation.data,
        error: null,
        telemetry: {
          provider: candidate.provider,
          model: candidate.model,
          taskType: request.taskType,
          usedFallback: index > 0,
          estimatedCost,
          blockedByPolicy: false
        }
      },
      usageState: nextUsageState
    };
  }

  if (blockedCount > 0 && blockedCount === candidates.length) {
    return {
      result: {
        ok: false,
        data: null,
        error: {
          code: 'blocked_by_policy',
          message: `AI request blocked by policy: ${blockedReasonForAllCandidates || 'policy_guard'}.`,
          blockReason: blockedReasonForAllCandidates
        },
        telemetry: {
          provider: primaryProvider,
          model: primaryModel,
          taskType: request.taskType,
          usedFallback: fallbackUsed,
          estimatedCost: estimateAiCost({
            provider: primaryProvider,
            model: primaryModel,
            taskType: request.taskType,
            outputTokens: requestedOutputTokens
          }),
          blockedByPolicy: true,
          blockReason: blockedReasonForAllCandidates
        }
      },
      usageState
    };
  }

  return {
    result: {
      ok: false,
      data: null,
      error: {
        code: lastFailureCode,
        message: lastFailureMessage || 'All AI providers failed for this request.'
      },
      telemetry: {
        provider: primaryProvider,
        model: primaryModel,
        taskType: request.taskType,
        usedFallback: fallbackUsed,
        estimatedCost: estimateAiCost({
          provider: primaryProvider,
          model: primaryModel,
          taskType: request.taskType,
          outputTokens: requestedOutputTokens
        }),
        blockedByPolicy: false
      }
    },
    usageState
  };
}
