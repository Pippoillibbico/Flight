import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyBudgetGuard,
  createAiGateway,
  createAnthropicAdapter,
  createEmptyAiUsageState,
  createMockAiAdapter,
  createOpenAiAdapter,
  DEFAULT_AI_BUDGET_POLICY_BY_PLAN,
  estimateAiCost,
  selectModelForTask,
  selectProviderForTask,
  validateStructuredOutput
} from '../../src/features/ai-gateway/index.ts';

function validItineraryOutput() {
  return {
    summary: 'Found 1 real opportunities.',
    items: [
      {
        id: 'gen-1',
        viewItineraryId: 'opp-1',
        origin: 'FCO',
        destination: 'Tokyo',
        destinationIata: 'TYO',
        price: 320,
        currency: 'EUR',
        dateFrom: '2026-11-11',
        dateTo: '2026-11-18',
        stops: 1,
        rankingScore: 88,
        explanation: 'High score and strong saving'
      }
    ],
    totalItems: 1,
    truncatedByPlan: false
  };
}

test('provider and model routing are plan-aware and deterministic', () => {
  assert.equal(selectProviderForTask('classification', 'free'), 'openai');
  assert.equal(selectProviderForTask('itinerary_generation', 'free'), 'openai');
  assert.equal(selectProviderForTask('itinerary_generation', 'elite'), 'anthropic');
  assert.equal(selectProviderForTask('premium_analysis', 'elite'), 'anthropic');

  assert.equal(selectModelForTask('itinerary_generation', 'free'), 'mini');
  assert.equal(selectModelForTask('itinerary_generation', 'pro'), 'balanced');
  assert.equal(selectModelForTask('itinerary_generation', 'elite'), 'premium');
});

test('estimateAiCost is monotonic by model and tokens', () => {
  const mini = estimateAiCost({
    provider: 'openai',
    model: 'mini',
    taskType: 'itinerary_generation',
    outputTokens: 400
  });
  const premium = estimateAiCost({
    provider: 'openai',
    model: 'premium',
    taskType: 'itinerary_generation',
    outputTokens: 400
  });
  const premiumBigger = estimateAiCost({
    provider: 'openai',
    model: 'premium',
    taskType: 'itinerary_generation',
    outputTokens: 1200
  });
  assert.ok(premium > mini);
  assert.ok(premiumBigger > premium);
});

test('applyBudgetGuard blocks token overflow and task limits', () => {
  const usage = createEmptyAiUsageState();
  usage.taskExecutionCount.itinerary_generation = 6;
  const tokenBlocked = applyBudgetGuard(usage, {
    planType: 'free',
    taskType: 'itinerary_generation',
    requestedOutputTokens: 900,
    estimatedCost: 0.01
  });
  assert.equal(tokenBlocked.blocked, true);
  assert.equal(tokenBlocked.blockReason, 'max_output_tokens_per_request');

  const taskBlocked = applyBudgetGuard(usage, {
    planType: 'free',
    taskType: 'itinerary_generation',
    requestedOutputTokens: 400,
    estimatedCost: 0.01
  });
  assert.equal(taskBlocked.blocked, true);
  assert.equal(taskBlocked.blockReason, 'max_task_executions_per_plan');
});

test('gateway uses fallback adapter when primary provider fails', async () => {
  const gateway = createAiGateway({
    adapters: {
      openai: createOpenAiAdapter({
        async runner() {
          return { ok: false, data: null, errorCode: 'primary_down', errorMessage: 'Primary provider unavailable' };
        }
      }),
      anthropic: createAnthropicAdapter({
        async runner() {
          return { ok: true, data: validItineraryOutput() };
        }
      }),
      mock: createMockAiAdapter()
    },
    providerAvailability: {
      openai: true,
      anthropic: true,
      mock: true
    }
  });

  const result = await gateway.execute({
    taskType: 'itinerary_generation',
    planType: 'pro',
    input: { prompt: 'Find value routes' },
    maxOutputTokens: 450,
    schemaKey: 'itinerary_generation'
  });

  assert.equal(result.ok, true);
  assert.equal(result.telemetry.provider, 'anthropic');
  assert.equal(result.telemetry.usedFallback, true);
  assert.equal(result.error, null);
});

test('gateway returns controlled blocked result when plan budget is exhausted', async () => {
  const gateway = createAiGateway({
    adapters: {
      mock: createMockAiAdapter({
        handlers: {
          itinerary_generation: async () => ({ ok: true, data: validItineraryOutput() })
        }
      })
    },
    providerAvailability: {
      openai: false,
      anthropic: false,
      mock: true
    },
    budgetPolicyByPlan: {
      ...DEFAULT_AI_BUDGET_POLICY_BY_PLAN,
      free: {
        ...DEFAULT_AI_BUDGET_POLICY_BY_PLAN.free,
        maxTaskExecutionsPerPlan: {
          itinerary_generation: 1
        }
      }
    }
  });

  const first = await gateway.execute({
    taskType: 'itinerary_generation',
    planType: 'free',
    input: { prompt: 'first' },
    maxOutputTokens: 350,
    schemaKey: 'itinerary_generation'
  });
  assert.equal(first.ok, true);

  const second = await gateway.execute({
    taskType: 'itinerary_generation',
    planType: 'free',
    input: { prompt: 'second' },
    maxOutputTokens: 350,
    schemaKey: 'itinerary_generation'
  });
  assert.equal(second.ok, false);
  assert.equal(second.error?.code, 'blocked_by_policy');
  assert.equal(second.telemetry.blockedByPolicy, true);
  assert.equal(second.telemetry.blockReason, 'max_task_executions_per_plan');
});

test('structured output validation rejects malformed itinerary payload', () => {
  const valid = validateStructuredOutput('itinerary_generation', validItineraryOutput());
  assert.equal(valid.valid, true);

  const malformed = validateStructuredOutput('itinerary_generation', {
    summary: 'bad',
    items: [{ id: 'x' }]
  });
  assert.equal(malformed.valid, false);
  assert.equal(malformed.data, null);
});

test('structured output validation rejects invalid itinerary formats and bounds', () => {
  const malformed = validateStructuredOutput('itinerary_generation', {
    summary: 'x'.repeat(400),
    items: [
      {
        id: 'gen-1',
        viewItineraryId: 'opp-1',
        origin: 'ROME',
        destination: 'Tokyo',
        destinationIata: 'NRT',
        price: -1,
        currency: 'EURO',
        dateFrom: '2026/11/11',
        dateTo: '2026-11-18',
        stops: 8,
        rankingScore: 140,
        explanation: 'ok'
      }
    ],
    totalItems: 1,
    truncatedByPlan: false
  });
  assert.equal(malformed.valid, false);
  assert.equal(malformed.data, null);
});

test('gateway returns structured_output_invalid when every adapter returns malformed payload', async () => {
  const malformedData = {
    summary: '',
    items: [{ id: 'x' }],
    totalItems: 1,
    truncatedByPlan: false
  };
  const gateway = createAiGateway({
    adapters: {
      openai: createOpenAiAdapter({
        async runner() {
          return { ok: true, data: malformedData };
        }
      }),
      anthropic: createAnthropicAdapter({
        async runner() {
          return { ok: true, data: malformedData };
        }
      })
    },
    providerAvailability: {
      openai: true,
      anthropic: true,
      mock: false
    }
  });

  const result = await gateway.execute({
    taskType: 'itinerary_generation',
    planType: 'elite',
    input: { prompt: 'malformed' },
    maxOutputTokens: 700,
    schemaKey: 'itinerary_generation'
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'structured_output_invalid');
});

test('gateway minimizes itinerary-generation adapter input by removing free-text prompt and unknown fields', async () => {
  let capturedInput: unknown = null;
  const gateway = createAiGateway({
    adapters: {
      mock: createMockAiAdapter({
        handlers: {
          itinerary_generation: async (request) => {
            capturedInput = request.input;
            return { ok: true, data: validItineraryOutput() };
          }
        }
      })
    },
    providerAvailability: {
      openai: false,
      anthropic: false,
      mock: true
    }
  });

  const result = await gateway.execute({
    taskType: 'itinerary_generation',
    planType: 'pro',
    input: {
      prompt: 'my@email.test wants a secret route',
      generationInputs: [
        {
          id: 'cand-1',
          origin: 'fco',
          destination: 'Tokyo',
          destinationIata: 'nrt',
          price: 420,
          currency: 'eur',
          dateFrom: '2026-11-01',
          dateTo: '2026-11-10',
          stopCount: 1,
          travelScore: 81,
          unknownSensitiveField: 'should_not_pass'
        }
      ],
      preferences: {
        origin: 'fco',
        maxStops: 1,
        maxBudget: 900,
        secretPromptEcho: 'drop-me'
      }
    },
    maxOutputTokens: 700,
    schemaKey: 'itinerary_generation'
  });

  assert.equal(result.ok, true);
  const normalizedInput = capturedInput as {
    prompt?: unknown;
    generationInputs?: Array<Record<string, unknown>>;
    preferences?: Record<string, unknown>;
  } | null;
  assert.ok(normalizedInput && typeof normalizedInput === 'object');
  assert.equal(normalizedInput?.prompt, undefined);
  assert.equal(normalizedInput?.generationInputs?.[0]?.origin, 'FCO');
  assert.equal(normalizedInput?.generationInputs?.[0]?.destinationIata, 'NRT');
  assert.equal(normalizedInput?.generationInputs?.[0]?.unknownSensitiveField, undefined);
  assert.equal(normalizedInput?.preferences?.origin, 'FCO');
  assert.equal(normalizedInput?.preferences?.secretPromptEcho, undefined);
});

test('gateway redacts sensitive provider failure details before returning errors', async () => {
  const gateway = createAiGateway({
    adapters: {
      openai: createOpenAiAdapter({
        async runner() {
          return {
            ok: false,
            data: null,
            errorCode: 'provider_failed',
            errorMessage: 'Bearer sk-1234567890abcdef contact me@example.com for retry'
          };
        }
      }),
      anthropic: createAnthropicAdapter({
        async runner() {
          return {
            ok: false,
            data: null,
            errorCode: 'provider_failed',
            errorMessage: 'Secondary provider unavailable'
          };
        }
      })
    },
    providerAvailability: {
      openai: true,
      anthropic: true,
      mock: false
    }
  });

  const result = await gateway.execute({
    taskType: 'itinerary_generation',
    planType: 'pro',
    input: { prompt: 'Find trips' },
    maxOutputTokens: 600,
    schemaKey: 'itinerary_generation'
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'provider_failed');
  assert.equal(String(result.error?.message || '').includes('sk-1234567890abcdef'), false);
  assert.equal(String(result.error?.message || '').includes('me@example.com'), false);
});
