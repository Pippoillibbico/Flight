import { estimateCostEur } from './ai-cache.js';
import { claimAiBudget } from './ai-cost-guard.js';
import { extractJsonObject, resolveOpportunityEnrichmentPayload } from './ai-output-guards.js';
import { parseFlag } from './env-flags.js';
import { estimateInputTokensFromText, resolveOpportunityAiModel, toFiniteInt } from './opportunity-store-helpers.js';

export function createOpportunityAiEnricher({
  aiCache,
  cacheClient,
  cacheTtlSeconds,
  cacheOnlyMode,
  logger
}) {
  return async function enrichWithProviderIfEnabled(row, fallback) {
    const aiEnabled = parseFlag(process.env.OPPORTUNITY_AI_ENRICHMENT_ENABLED, false);
    if (!aiEnabled) return fallback;

    const openaiKey = String(process.env.OPENAI_API_KEY || '').trim();
    const claudeKey = String(process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '').trim();
    const provider =
      String(process.env.OPPORTUNITY_AI_PROVIDER || '').trim().toLowerCase() === 'claude'
        ? 'claude'
        : openaiKey
        ? 'openai'
        : claudeKey
        ? 'claude'
        : 'none';
    if (provider === 'none') return fallback;
    const routeKey = 'opportunity.enrichment';
    const selectedModel = resolveOpportunityAiModel(provider);

    const systemPrompt =
      'You are a travel opportunity enrichment engine. Return strict JSON only: {"ai_title":"","ai_description":"","notification_text":"","why_it_matters":"","short_badge_text":""}. Never invent facts or urgency.';
    const inputPayload = {
      origin_city: row.origin_city,
      origin_airport: row.origin_airport,
      destination_city: row.destination_city,
      destination_airport: row.destination_airport,
      price: row.price,
      currency: row.currency,
      depart_date: row.depart_date,
      return_date: row.return_date,
      trip_length_days: row.trip_length_days,
      stops: row.stops,
      airline: row.airline,
      raw_score: row.raw_score,
      final_score: row.final_score,
      opportunity_level: row.opportunity_level,
      baseline_price: row.baseline_price,
      savings_percent_if_available: row.savings_percent_if_available
    };
    const serializedInputPayload = JSON.stringify(inputPayload);

    const maxPromptChars = toFiniteInt(process.env.OPPORTUNITY_AI_MAX_PROMPT_CHARS, 2800, 180, 24000);
    if (serializedInputPayload.length > maxPromptChars) {
      logger.warn(
        {
          route: routeKey,
          promptLength: serializedInputPayload.length,
          maxPromptChars
        },
        'opportunity_ai_enrichment_prompt_too_long'
      );
      return fallback;
    }

    try {
      const estimatedInputTokens = estimateInputTokensFromText(
        `${systemPrompt}\n${serializedInputPayload}`,
        toFiniteInt(process.env.OPPORTUNITY_AI_EST_INPUT_TOKENS, 360, 60, 20000)
      );
      const estimatedOutputTokens = toFiniteInt(process.env.OPPORTUNITY_AI_EST_OUTPUT_TOKENS, 180, 32, 6000);
      const estimatedCost = estimateCostEur(
        { input_tokens: estimatedInputTokens, output_tokens: estimatedOutputTokens },
        selectedModel
      );
      const budgetClaim = await claimAiBudget({
        cacheClient,
        env: process.env,
        userId: 'system:opportunity_pipeline',
        route: routeKey,
        estimatedTokens: estimatedInputTokens + estimatedOutputTokens,
        estimatedCostEur: estimatedCost
      });
      if (!budgetClaim.allowed) {
        logger.warn(
          {
            route: routeKey,
            reason: budgetClaim.reason
          },
          'opportunity_ai_enrichment_budget_blocked'
        );
      }
      const allowLiveCall = budgetClaim.allowed && !cacheOnlyMode;
      const maxOutputTokens = toFiniteInt(process.env.OPPORTUNITY_AI_MAX_OUTPUT_TOKENS, 350, 80, 2000);

      const cacheInput = {
        provider,
        route: routeKey,
        systemPrompt,
        model: selectedModel,
        payload: {
          origin_airport: String(inputPayload.origin_airport || '').trim().toUpperCase(),
          destination_airport: String(inputPayload.destination_airport || '').trim().toUpperCase(),
          destination_city: String(inputPayload.destination_city || '').trim().toLowerCase(),
          currency: String(inputPayload.currency || 'EUR').trim().toUpperCase(),
          depart_date: String(inputPayload.depart_date || '').slice(0, 10),
          return_date: String(inputPayload.return_date || '').slice(0, 10),
          trip_length_days: Number(inputPayload.trip_length_days || 0),
          price: Math.round(Number(inputPayload.price || 0)),
          baseline_price: Math.round(Number(inputPayload.baseline_price || 0)),
          savings_percent_if_available: Math.round(Number(inputPayload.savings_percent_if_available || 0) * 10) / 10,
          stops: Number(inputPayload.stops || 0),
          airline: String(inputPayload.airline || '').trim().toLowerCase(),
          opportunity_level: String(inputPayload.opportunity_level || '').trim().toLowerCase(),
          final_score: Math.round(Number(inputPayload.final_score || 0) * 10) / 10
        }
      };

      const enrichedCopy = await aiCache.withCache(
        'opportunity_enrichment_copy',
        cacheInput,
        async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 9000);
          let json = null;
          let usage = null;
          let model = null;
          try {
            if (provider === 'openai' && openaiKey) {
              model = selectedModel;
              const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${openaiKey}`
                },
                body: JSON.stringify({
                  model,
                  temperature: 0.2,
                  response_format: { type: 'json_object' },
                  messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: serializedInputPayload }
                  ]
                }),
                signal: controller.signal
              });
              if (!response.ok) {
                logger.warn({ provider, status: response.status }, 'opportunity_ai_enrichment_provider_non_ok');
                return { value: null, usage: null, model };
              }
              const payload = await response.json().catch(() => ({}));
              usage = payload?.usage || null;
              json = extractJsonObject(payload?.choices?.[0]?.message?.content || '');
            } else if (provider === 'claude' && claudeKey) {
              model = selectedModel;
              const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': claudeKey,
                  'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                  model,
                  max_tokens: maxOutputTokens,
                  temperature: 0.2,
                  system: systemPrompt,
                  messages: [{ role: 'user', content: serializedInputPayload }]
                }),
                signal: controller.signal
              });
              if (!response.ok) {
                logger.warn({ provider, status: response.status }, 'opportunity_ai_enrichment_provider_non_ok');
                return { value: null, usage: null, model };
              }
              const payload = await response.json().catch(() => ({}));
              usage = payload?.usage || null;
              const content = Array.isArray(payload?.content) ? payload.content.map((item) => item?.text || '').join('\n') : '';
              json = extractJsonObject(content);
            }
          } finally {
            clearTimeout(timer);
          }
          return {
            value: resolveOpportunityEnrichmentPayload(json, fallback, row.opportunity_level || ''),
            usage,
            model
          };
        },
        {
          ttlSeconds: cacheTtlSeconds,
          provider,
          route: routeKey,
          semantic: true,
          allowLiveCall
        }
      );

      return enrichedCopy || fallback;
    } catch (error) {
      logger.warn({ err: error?.message || String(error) }, 'opportunity_ai_enrichment_failed');
      return fallback;
    }
  };
}

