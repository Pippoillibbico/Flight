import { createAiCache } from './ai-cache.js';
import { estimateCostEur } from './ai-cache.js';
import { claimAiBudget } from './ai-cost-guard.js';
import { logger } from './logger.js';

function readFlag(value, fallback = false) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (['true', '1', 'yes'].includes(text)) return true;
  if (['false', '0', 'no'].includes(text)) return false;
  return fallback;
}

function toFiniteInt(value, fallback = 0, min = 0, max = 10_000) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizePlanForAi(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'creator') return 'elite';
  return raw;
}

function normalizePromptForCache(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function estimateInputTokensFromText(value, minTokens) {
  const text = String(value || '');
  const estimated = Math.ceil(text.length / 4);
  return Math.max(1, Math.max(Number(minTokens) || 0, estimated));
}

function normalizeIata(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeProviderChoice(value, openaiKey, claudeKey) {
  const provider = String(value || 'auto').trim().toLowerCase();
  if (provider === 'none') return 'none';
  if (provider === 'chatgpt' && openaiKey) return 'chatgpt';
  if (provider === 'claude' && claudeKey) return 'claude';
  if (provider === 'chatgpt') return 'none';
  if (provider === 'claude') return 'none';
  if (openaiKey) return 'chatgpt';
  if (claudeKey) return 'claude';
  return 'none';
}

function resolveModelForRoute(provider, featureKey, env) {
  if (provider === 'chatgpt') {
    if (featureKey === 'intent') return String(env.OPENAI_MODEL_INTENT || env.OPENAI_MODEL || 'gpt-4o-mini').trim();
    if (featureKey === 'decision') return String(env.OPENAI_MODEL_DECISION || env.OPENAI_MODEL || 'gpt-4o-mini').trim();
    return String(env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  }
  if (provider === 'claude') {
    if (featureKey === 'intent') return String(env.ANTHROPIC_MODEL_INTENT || env.ANTHROPIC_MODEL || 'claude-3-5-haiku-20241022').trim();
    if (featureKey === 'decision') return String(env.ANTHROPIC_MODEL_DECISION || env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022').trim();
    return String(env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022').trim();
  }
  return '';
}

function getAllowedAiPlans(env) {
  const raw = String(env.AI_ALLOWED_PLAN_TYPES || 'elite,creator').trim();
  const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const set = new Set(
    raw
      .split(',')
      .map((entry) => normalizePlanForAi(entry))
      .filter(Boolean)
  );
  if (isProduction) set.delete('free');
  if (set.size === 0) {
    set.add('elite');
  }
  return set;
}

function resolveAiPolicy({ env, userPlan, featureKey }) {
  const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const routeEnabled =
    featureKey === 'intent'
      ? readFlag(env.AI_ROUTE_INTENT_ENABLED, true)
      : readFlag(env.AI_ROUTE_DECISION_ENABLED, true);
  if (!routeEnabled) return { allowed: false, reason: 'route_disabled' };

  const normalizedPlan = normalizePlanForAi(userPlan);
  // Unknown plan: safer to block than to allow. An empty/null plan should never
  // reach this point in a correctly-authenticated request — treat it as denied.
  if (!normalizedPlan) return { allowed: false, reason: 'plan_unknown' };
  // Hard-block: free plan never runs AI regardless of any flag or env config.
  if (normalizedPlan === 'free') return { allowed: false, reason: 'plan_blocked:free' };

  // Production hardening: free-user AI bypass is never accepted in production,
  // even if AI_ALLOW_FREE_USERS is mistakenly set.
  const allowFreeUsers = !isProduction && readFlag(env.AI_ALLOW_FREE_USERS, false);
  if (allowFreeUsers) return { allowed: true, reason: null };

  const allowedPlans = getAllowedAiPlans(env);
  if (allowedPlans.has(normalizedPlan)) return { allowed: true, reason: null };
  return { allowed: false, reason: `plan_blocked:${normalizedPlan}` };
}

function compactDecisionRequestForCache(requestPayload) {
  return {
    origin: normalizeIata(requestPayload?.origin),
    region: String(requestPayload?.region || '').trim().toLowerCase() || 'all',
    country: String(requestPayload?.country || '').trim().toLowerCase() || '',
    dateFrom: String(requestPayload?.dateFrom || '').slice(0, 10),
    dateTo: String(requestPayload?.dateTo || '').slice(0, 10),
    budgetMax: toFiniteInt(requestPayload?.budgetMax, 0, 0, 100_000) || null,
    tripLengthDays: toFiniteInt(requestPayload?.tripLengthDays, 0, 0, 60) || null,
    travellers: toFiniteInt(requestPayload?.travellers, 1, 1, 9),
    cabinClass: String(requestPayload?.cabinClass || '').trim().toLowerCase() || 'economy',
    mood: String(requestPayload?.mood || '').trim().toLowerCase() || '',
    climatePreference: String(requestPayload?.climatePreference || '').trim().toLowerCase() || '',
    pace: String(requestPayload?.pace || '').trim().toLowerCase() || '',
    avoidOvertourism: Boolean(requestPayload?.avoidOvertourism)
  };
}

function compactDecisionRecommendationsForCache(decisionResult) {
  const list = Array.isArray(decisionResult?.recommendations) ? decisionResult.recommendations : [];
  return list
    .slice(0, 8)
    .map((item) => ({
      iata: normalizeIata(item?.destinationIata),
      score: Math.round(Number(item?.travelScore || 0) * 10) / 10,
      total: Math.round(Number(item?.costBreakdown?.total || 0)),
      climate: String(item?.climateInPeriod || '').trim().toLowerCase(),
      crowding: String(item?.crowding || '').trim().toLowerCase()
    }))
    .filter((item) => /^[A-Z]{3}$/.test(item.iata))
    .sort((a, b) => a.iata.localeCompare(b.iata));
}

function buildIntentSignalCount(preferences = {}) {
  let score = 0;
  if (preferences.origin) score += 1;
  if (Number.isFinite(Number(preferences.budgetMax))) score += 1;
  if (Number.isFinite(Number(preferences.tripLengthDays))) score += 1;
  if (preferences.region) score += 1;
  if (preferences.avoidOvertourism) score += 1;
  if (preferences.mood && preferences.mood !== 'relax') score += 1;
  if (preferences.climatePreference && preferences.climatePreference !== 'indifferent') score += 1;
  if (preferences.pace && preferences.pace !== 'normal') score += 1;
  return score;
}

function shouldSkipIntentAi(heuristic, prompt, env) {
  if (!readFlag(env.AI_INTENT_HEURISTIC_CONFIDENCE_SKIP_ENABLED, true)) return false;
  const minSignals = toFiniteInt(env.AI_INTENT_HEURISTIC_MIN_SIGNALS, 3, 1, 10);
  const maxPromptLength = toFiniteInt(env.AI_INTENT_HEURISTIC_MAX_PROMPT_LENGTH, 280, 40, 2000);
  const promptLen = String(prompt || '').trim().length;
  if (promptLen === 0 || promptLen > maxPromptLength) return false;
  return buildIntentSignalCount(heuristic?.preferences || {}) >= minSignals;
}

export function createAiIntentService({
  origins,
  extractJsonObject,
  parseDecisionAiPayload,
  parseIntentAiPayload,
  fetchImpl = fetch,
  env = process.env,
  cacheClient = null
}) {
  const enrichTtl = Math.max(60, Number(env.AI_ENRICHMENT_CACHE_TTL_SECONDS ?? 7200));
  const intentTtl = Math.max(60, Number(env.AI_INTENT_CACHE_TTL_SECONDS ?? 86400));
  const aiCache = createAiCache({ cacheClient, defaultTtlSeconds: enrichTtl });

  async function enrichDecisionWithAi({
    aiProvider = 'auto',
    requestPayload,
    decisionResult,
    userPlan = '',
    userId = '',
    routeKey = 'decision.just_go'
  }) {
    const openaiKey = String(env.OPENAI_API_KEY || '').trim();
    const claudeKey = String(env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY || '').trim();
    const selected = normalizeProviderChoice(aiProvider, openaiKey, claudeKey);
    if (selected === 'none') return { provider: 'none', enhanced: false };

    const policy = resolveAiPolicy({ env, userPlan, featureKey: 'decision' });
    if (!policy.allowed) {
      return { provider: 'policy', enhanced: false, reason: policy.reason };
    }

    const recommendations = Array.isArray(decisionResult?.recommendations) ? decisionResult.recommendations : [];
    if (recommendations.length === 0) return { provider: selected, enhanced: false };

    const compact = compactDecisionRecommendationsForCache(decisionResult);
    if (compact.length === 0) return { provider: selected, enhanced: false };

    const systemPrompt =
      'You are a travel decision co-pilot. Return strict JSON only: {"items":[{"destinationIata":"XXX","whyNow":"...","riskNote":"..."}]}';
    const userPrompt = JSON.stringify({
      request: requestPayload,
      recommendations: compact
    });
    const maxPromptChars = toFiniteInt(env.AI_MAX_PROMPT_CHARS_DECISION, 3600, 200, 20000);
    if (userPrompt.length > maxPromptChars) {
      return { provider: 'policy', enhanced: false, reason: 'prompt_too_long' };
    }
    const selectedModel = resolveModelForRoute(selected, 'decision', env);
    const estimatedInputTokens = estimateInputTokensFromText(
      `${systemPrompt}\n${userPrompt}`,
      toFiniteInt(env.AI_EST_INPUT_TOKENS_DECISION, 420, 60, 20000)
    );
    const estimatedOutputTokens = toFiniteInt(env.AI_EST_OUTPUT_TOKENS_DECISION, 180, 32, 6000);
    const estimatedCost = estimateCostEur(
      { input_tokens: estimatedInputTokens, output_tokens: estimatedOutputTokens },
      selectedModel
    );
    const budgetClaim = await claimAiBudget({
      cacheClient,
      env,
      userId,
      route: routeKey,
      estimatedTokens: estimatedInputTokens + estimatedOutputTokens,
      estimatedCostEur: estimatedCost,
      planType: userPlan
    });
    if (!budgetClaim.allowed) {
      logger.warn({ routeKey, reason: budgetClaim.reason, userId: String(userId || '') }, 'ai_decision_budget_blocked');
    }

    const cacheInput = {
      provider: selected,
      model: selectedModel,
      route: routeKey,
      systemPrompt,
      request: compactDecisionRequestForCache(requestPayload),
      recommendations: compact
    };

    try {
      const aiItems = await aiCache.withCache(
        'decision_enrich',
        cacheInput,
        async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 9000);
          let aiJson = null;
          let usage = null;
          let model = null;
          try {
            if (selected === 'chatgpt' && openaiKey) {
              model = selectedModel;
              const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
                body: JSON.stringify({
                  model,
                  temperature: 0.2,
                  response_format: { type: 'json_object' },
                  messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                  ]
                }),
                signal: controller.signal
              });
              if (!response.ok) return { value: null, usage: null, model };
              const payload = await response.json().catch(() => ({}));
              usage = payload?.usage || null;
              aiJson = extractJsonObject(payload?.choices?.[0]?.message?.content || '');
            } else if (selected === 'claude' && claudeKey) {
              model = selectedModel;
              const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': claudeKey,
                  'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                  model,
                  max_tokens: 400,
                  temperature: 0.2,
                  system: systemPrompt,
                  messages: [{ role: 'user', content: userPrompt }]
                }),
                signal: controller.signal
              });
              if (!response.ok) return { value: null, usage: null, model };
              const payload = await response.json().catch(() => ({}));
              usage = payload?.usage || null;
              const content = Array.isArray(payload?.content) ? payload.content.map((x) => x?.text || '').join('\n') : '';
              aiJson = extractJsonObject(content);
            }
          } finally {
            clearTimeout(timer);
          }
          const items = parseDecisionAiPayload(aiJson);
          return { value: items.length ? items : null, usage, model };
        },
        {
          ttlSeconds: enrichTtl,
          provider: selected,
          route: routeKey,
          semantic: true,
          allowLiveCall: budgetClaim.allowed && !readFlag(env.AI_DECISION_CACHE_ONLY_MODE, false)
        }
      );

      if (!Array.isArray(aiItems) || aiItems.length === 0) return { provider: selected, enhanced: false };

      const byIata = new Map(aiItems.map((item) => [normalizeIata(item.destinationIata), item]));
      for (const rec of recommendations) {
        const aiItem = byIata.get(normalizeIata(rec?.destinationIata));
        if (!aiItem) continue;
        rec.aiWhyNow = aiItem.whyNow;
        rec.aiRiskNote = aiItem.riskNote;
      }
      return { provider: selected, enhanced: true };
    } catch (error) {
      logger.warn({ err: error?.message || String(error), routeKey }, 'ai_decision_enrichment_failed');
      return { provider: selected, enhanced: false };
    }
  }

  function parseIntentHeuristics(prompt, packageCount) {
    const raw = String(prompt || '').trim();
    const text = raw.toLowerCase();
    const preferences = {
      mood: 'relax',
      climatePreference: 'indifferent',
      pace: 'normal',
      avoidOvertourism: false,
      packageCount: packageCount === 4 ? 4 : 3
    };

    const budgetMatch = raw.match(/(\d{2,5})\s*(\u20ac|eur|euro)/i) || raw.match(/budget[^0-9]*(\d{2,5})/i);
    if (budgetMatch) preferences.budgetMax = Number(budgetMatch[1]);

    const daysMatch = raw.match(/(\d{1,2})\s*(giorni|giorno|days|day|notti|notte|nights|night)/i);
    if (daysMatch) preferences.tripLengthDays = Math.max(2, Math.min(21, Number(daysMatch[1])));

    const iataMatch = raw.match(/\b[A-Z]{3}\b/g);
    if (Array.isArray(iataMatch) && iataMatch.length > 0) {
      const known = new Set((origins || []).map((origin) => String(origin.code || '').toUpperCase()));
      const picked = iataMatch.map((code) => code.toUpperCase()).find((code) => known.has(code));
      if (picked) preferences.origin = picked;
    }

    if (text.includes('party') || text.includes('vita notturna') || text.includes('nightlife')) preferences.mood = 'party';
    else if (text.includes('natura') || text.includes('trek') || text.includes('hiking')) preferences.mood = 'natura';
    else if (text.includes('cultura') || text.includes('musei') || text.includes('museum')) preferences.mood = 'cultura';
    else if (text.includes('avventura') || text.includes('adventure')) preferences.mood = 'avventura';

    if (text.includes('caldo') || text.includes('warm') || text.includes('hot')) preferences.climatePreference = 'warm';
    else if (text.includes('freddo') || text.includes('cold')) preferences.climatePreference = 'cold';
    else if (text.includes('temperato') || text.includes('mild')) preferences.climatePreference = 'mild';

    if (text.includes('slow') || text.includes('rilassato') || text.includes('lento')) preferences.pace = 'slow';
    else if (text.includes('fast') || text.includes('veloce') || text.includes('ritmo alto')) preferences.pace = 'fast';

    if (text.includes('overtourism') || text.includes('no affollamento') || text.includes('poco affollat')) {
      preferences.avoidOvertourism = true;
    }

    if (text.includes('europa') || text.includes('europe')) preferences.region = 'eu';
    else if (text.includes('asia')) preferences.region = 'asia';
    else if (text.includes('america')) preferences.region = 'america';
    else if (text.includes('oceania')) preferences.region = 'oceania';

    const summaryParts = [];
    if (preferences.budgetMax) summaryParts.push(`budget ${preferences.budgetMax} EUR`);
    if (preferences.tripLengthDays) summaryParts.push(`${preferences.tripLengthDays} giorni`);
    summaryParts.push(`mood ${preferences.mood}`);
    summaryParts.push(`clima ${preferences.climatePreference}`);
    if (preferences.origin) summaryParts.push(`partenza ${preferences.origin}`);
    summaryParts.push(`${preferences.packageCount} pacchetti`);
    if (preferences.avoidOvertourism) summaryParts.push('filtro no overtourism');

    return {
      provider: 'heuristic',
      enhanced: false,
      preferences,
      summary: `Preferenze rilevate: ${summaryParts.join(', ')}.`
    };
  }

  async function parseIntentWithAi({
    prompt,
    aiProvider = 'auto',
    packageCount = 3,
    userPlan = '',
    userId = '',
    routeKey = 'decision.intake'
  }) {
    const heuristic = parseIntentHeuristics(prompt, packageCount);
    const openaiKey = String(env.OPENAI_API_KEY || '').trim();
    const claudeKey = String(env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY || '').trim();
    const selected = normalizeProviderChoice(aiProvider, openaiKey, claudeKey);
    if (selected === 'none') return heuristic;

    const policy = resolveAiPolicy({ env, userPlan, featureKey: 'intent' });
    if (!policy.allowed) return { ...heuristic, provider: 'policy', reason: policy.reason };
    if (shouldSkipIntentAi(heuristic, prompt, env)) return heuristic;

    const systemPrompt =
      'Extract travel intent as strict JSON only: {"preferences":{"origin":"IATA?","budgetMax":number?,"tripLengthDays":number?,"mood":"relax|natura|party|cultura|avventura","climatePreference":"warm|mild|cold|indifferent","pace":"slow|normal|fast","avoidOvertourism":boolean,"region":"all|eu|asia|america|oceania","packageCount":3|4},"summary":"..."}';
    const maxPromptChars = toFiniteInt(env.AI_MAX_PROMPT_CHARS_INTENT, 1200, 120, 10000);
    const safePrompt = String(prompt || '').trim();
    if (safePrompt.length > maxPromptChars) {
      return { ...heuristic, provider: 'policy', reason: 'prompt_too_long' };
    }
    const selectedModel = resolveModelForRoute(selected, 'intent', env);
    const estimatedInputTokens = estimateInputTokensFromText(
      `${systemPrompt}\n${safePrompt}`,
      toFiniteInt(env.AI_EST_INPUT_TOKENS_INTENT, 220, 40, 12000)
    );
    const estimatedOutputTokens = toFiniteInt(env.AI_EST_OUTPUT_TOKENS_INTENT, 120, 20, 4000);
    const estimatedCost = estimateCostEur(
      { input_tokens: estimatedInputTokens, output_tokens: estimatedOutputTokens },
      selectedModel
    );
    const budgetClaim = await claimAiBudget({
      cacheClient,
      env,
      userId,
      route: routeKey,
      estimatedTokens: estimatedInputTokens + estimatedOutputTokens,
      estimatedCostEur: estimatedCost,
      planType: userPlan
    });
    if (!budgetClaim.allowed) {
      logger.warn({ routeKey, reason: budgetClaim.reason, userId: String(userId || '') }, 'ai_intent_budget_blocked');
    }

    const cacheInput = {
      provider: selected,
      model: selectedModel,
      route: routeKey,
      systemPrompt,
      prompt: normalizePromptForCache(prompt)
    };

    try {
      const parsedIntent = await aiCache.withCache(
        'intent_parse',
        cacheInput,
        async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 9000);
          let aiJson = null;
          let usage = null;
          let model = null;
          try {
            if (selected === 'chatgpt' && openaiKey) {
              model = selectedModel;
              const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
                body: JSON.stringify({
                  model,
                  temperature: 0.1,
                  response_format: { type: 'json_object' },
                  messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: safePrompt }
                  ]
                }),
                signal: controller.signal
              });
              if (!response.ok) return { value: null, usage: null, model };
              const payload = await response.json().catch(() => ({}));
              usage = payload?.usage || null;
              aiJson = extractJsonObject(payload?.choices?.[0]?.message?.content || '');
            } else if (selected === 'claude' && claudeKey) {
              model = selectedModel;
              const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': claudeKey,
                  'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                  model,
                  max_tokens: 300,
                  temperature: 0.1,
                  system: systemPrompt,
                  messages: [{ role: 'user', content: safePrompt }]
                }),
                signal: controller.signal
              });
              if (!response.ok) return { value: null, usage: null, model };
              const payload = await response.json().catch(() => ({}));
              usage = payload?.usage || null;
              const content = Array.isArray(payload?.content) ? payload.content.map((x) => x?.text || '').join('\n') : '';
              aiJson = extractJsonObject(content);
            }
          } finally {
            clearTimeout(timer);
          }
          return { value: parseIntentAiPayload(aiJson), usage, model };
        },
        {
          ttlSeconds: intentTtl,
          provider: selected,
          route: routeKey,
          semantic: true,
          allowLiveCall: budgetClaim.allowed && !readFlag(env.AI_INTENT_CACHE_ONLY_MODE, false)
        }
      );

      if (!parsedIntent) return heuristic;
      const prefs = parsedIntent.preferences || {};
      const merged = {
        ...heuristic.preferences,
        ...prefs,
        packageCount: prefs?.packageCount === 4 ? 4 : heuristic.preferences.packageCount
      };
      return {
        provider: selected,
        enhanced: true,
        preferences: merged,
        summary: parsedIntent.summary || heuristic.summary
      };
    } catch (error) {
      logger.warn({ err: error?.message || String(error), routeKey }, 'ai_intent_parse_failed');
      return heuristic;
    }
  }

  return {
    enrichDecisionWithAi,
    parseIntentWithAi
  };
}
