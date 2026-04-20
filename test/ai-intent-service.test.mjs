import assert from 'node:assert/strict';
import test from 'node:test';

import { createAiIntentService } from '../server/lib/ai-intent-service.js';
import { extractJsonObject, parseDecisionAiPayload, parseIntentAiPayload } from '../server/lib/ai-output-guards.js';

function createJsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    }
  };
}

test('parseIntentWithAi skips provider call when heuristic confidence is high', async () => {
  let fetchCalls = 0;
  const service = createAiIntentService({
    origins: [{ code: 'MXP' }],
    extractJsonObject,
    parseDecisionAiPayload,
    parseIntentAiPayload,
    fetchImpl: async () => {
      fetchCalls += 1;
      return createJsonResponse({});
    },
    env: {
      OPENAI_API_KEY: 'sk_test_1234567890',
      OPENAI_MODEL: 'gpt-4o-mini',
      AI_ALLOW_FREE_USERS: 'true',
      AI_BUDGET_FAIL_OPEN: 'true',
      AI_ROUTE_INTENT_ENABLED: 'true',
      AI_INTENT_HEURISTIC_CONFIDENCE_SKIP_ENABLED: 'true',
      AI_INTENT_HEURISTIC_MIN_SIGNALS: '3'
    }
  });

  const out = await service.parseIntentWithAi({
    prompt: 'budget 1200 eur MXP 7 giorni asia caldo slow senza overtourism',
    aiProvider: 'chatgpt',
    packageCount: 3,
    userPlan: 'free'
  });

  assert.equal(fetchCalls, 0);
  assert.equal(out.provider, 'heuristic');
  assert.equal(out.enhanced, false);
});

test('parseIntentWithAi uses semantic cache for near-identical prompts', async () => {
  let fetchCalls = 0;
  const service = createAiIntentService({
    origins: [{ code: 'FCO' }],
    extractJsonObject,
    parseDecisionAiPayload,
    parseIntentAiPayload,
    fetchImpl: async () => {
      fetchCalls += 1;
      return createJsonResponse({
        choices: [
          {
            message: {
              content:
                '{"preferences":{"origin":"FCO","budgetMax":900,"tripLengthDays":6,"mood":"relax","climatePreference":"warm","pace":"normal","avoidOvertourism":false,"region":"eu","packageCount":3},"summary":"Parsed"}'
            }
          }
        ],
        usage: { prompt_tokens: 120, completion_tokens: 35 }
      });
    },
    env: {
      OPENAI_API_KEY: 'sk_test_1234567890',
      OPENAI_MODEL: 'gpt-4o-mini',
      AI_ALLOW_FREE_USERS: 'true',
      AI_BUDGET_FAIL_OPEN: 'true',
      AI_ROUTE_INTENT_ENABLED: 'true',
      AI_INTENT_HEURISTIC_CONFIDENCE_SKIP_ENABLED: 'false',
      AI_INTENT_CACHE_TTL_SECONDS: '3600'
    }
  });

  const first = await service.parseIntentWithAi({
    prompt: 'FCO budget 900 eur 6 days in europe',
    aiProvider: 'chatgpt',
    userPlan: 'elite'
  });
  const second = await service.parseIntentWithAi({
    prompt: '  fco   budget 900 EUR   6 days in EUROPE ',
    aiProvider: 'chatgpt',
    userPlan: 'elite'
  });

  assert.equal(fetchCalls, 1);
  assert.equal(first.enhanced, true);
  assert.equal(second.enhanced, true);
  assert.equal(second.preferences.origin, 'FCO');
});

test('enrichDecisionWithAi blocks non-allowed plans by policy', async () => {
  let fetchCalls = 0;
  const service = createAiIntentService({
    origins: [{ code: 'FCO' }],
    extractJsonObject,
    parseDecisionAiPayload,
    parseIntentAiPayload,
    fetchImpl: async () => {
      fetchCalls += 1;
      return createJsonResponse({});
    },
    env: {
      OPENAI_API_KEY: 'sk_test_1234567890',
      OPENAI_MODEL: 'gpt-4o-mini',
      AI_ALLOW_FREE_USERS: 'false',
      AI_ALLOWED_PLAN_TYPES: 'elite,creator',
      AI_ROUTE_DECISION_ENABLED: 'true'
    }
  });

  const decisionResult = {
    recommendations: [
      {
        destination: 'Barcelona',
        destinationIata: 'BCN',
        travelScore: 88.2,
        climateInPeriod: 'warm',
        crowding: 'medium',
        costBreakdown: { total: 320 }
      }
    ]
  };

  const out = await service.enrichDecisionWithAi({
    aiProvider: 'chatgpt',
    userPlan: 'free',
    routeKey: 'decision.just_go',
    requestPayload: { origin: 'FCO', dateFrom: '2026-06-15' },
    decisionResult
  });

  assert.equal(fetchCalls, 0);
  assert.equal(out.enhanced, false);
  assert.equal(out.provider, 'policy');
});

test('enrichDecisionWithAi does not allow free users in production even when AI_ALLOW_FREE_USERS=true', async () => {
  let fetchCalls = 0;
  const service = createAiIntentService({
    origins: [{ code: 'FCO' }],
    extractJsonObject,
    parseDecisionAiPayload,
    parseIntentAiPayload,
    fetchImpl: async () => {
      fetchCalls += 1;
      return createJsonResponse({});
    },
    env: {
      NODE_ENV: 'production',
      OPENAI_API_KEY: 'sk_live_1234567890',
      OPENAI_MODEL: 'gpt-4o-mini',
      AI_ALLOW_FREE_USERS: 'true',
      AI_ALLOWED_PLAN_TYPES: 'free,elite,creator',
      AI_ROUTE_DECISION_ENABLED: 'true'
    }
  });

  const out = await service.enrichDecisionWithAi({
    aiProvider: 'chatgpt',
    userPlan: 'free',
    routeKey: 'decision.just_go',
    requestPayload: { origin: 'FCO', dateFrom: '2026-06-15' },
    decisionResult: {
      recommendations: [
        {
          destination: 'Barcelona',
          destinationIata: 'BCN',
          travelScore: 88.2,
          climateInPeriod: 'warm',
          crowding: 'medium',
          costBreakdown: { total: 320 }
        }
      ]
    }
  });

  assert.equal(fetchCalls, 0);
  assert.equal(out.enhanced, false);
  assert.equal(out.provider, 'policy');
});
