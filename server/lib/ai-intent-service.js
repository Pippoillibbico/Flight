export function createAiIntentService({
  origins,
  extractJsonObject,
  parseDecisionAiPayload,
  parseIntentAiPayload,
  fetchImpl = fetch,
  env = process.env
}) {
  async function enrichDecisionWithAi({ aiProvider = 'auto', requestPayload, decisionResult }) {
    const provider = String(aiProvider || 'auto').toLowerCase();
    if (provider === 'none') return { provider: 'none', enhanced: false };

    const openaiKey = String(env.OPENAI_API_KEY || '').trim();
    const claudeKey = String(env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY || '').trim();

    const selected =
      provider === 'chatgpt'
        ? 'chatgpt'
        : provider === 'claude'
          ? 'claude'
          : openaiKey
            ? 'chatgpt'
            : claudeKey
              ? 'claude'
              : 'none';

    if (selected === 'none') return { provider: 'none', enhanced: false };

    const compact = (decisionResult.recommendations || []).map((item) => ({
      destination: item.destination,
      iata: item.destinationIata,
      score: item.travelScore,
      total: item.costBreakdown?.total,
      climate: item.climateInPeriod,
      crowding: item.crowding
    }));

    const systemPrompt =
      'You are a travel decision co-pilot. Return strict JSON only: {"items":[{"destinationIata":"XXX","whyNow":"...","riskNote":"..."}]}';
    const userPrompt = JSON.stringify({
      request: requestPayload,
      recommendations: compact
    });

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      let aiJson = null;
      try {
        if (selected === 'chatgpt' && openaiKey) {
          const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${openaiKey}`
            },
            body: JSON.stringify({
              model: env.OPENAI_MODEL || 'gpt-4.1-mini',
              temperature: 0.2,
              response_format: { type: 'json_object' },
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
              ]
            }),
            signal: controller.signal
          });
          if (!response.ok) return { provider: selected, enhanced: false };
          const payload = await response.json().catch(() => ({}));
          const content = payload?.choices?.[0]?.message?.content || '';
          aiJson = extractJsonObject(content);
        } else if (selected === 'claude' && claudeKey) {
          const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': claudeKey,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
              model: env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
              max_tokens: 400,
              temperature: 0.2,
              system: systemPrompt,
              messages: [{ role: 'user', content: userPrompt }]
            }),
            signal: controller.signal
          });
          if (!response.ok) return { provider: selected, enhanced: false };
          const payload = await response.json().catch(() => ({}));
          const content = Array.isArray(payload?.content) ? payload.content.map((x) => x?.text || '').join('\n') : '';
          aiJson = extractJsonObject(content);
        }
      } finally {
        clearTimeout(timer);
      }
      const items = parseDecisionAiPayload(aiJson);
      if (!items.length) return { provider: selected, enhanced: false };

      const byIata = new Map(items.map((x) => [x.destinationIata, x]));
      for (const rec of decisionResult.recommendations || []) {
        const aiItem = byIata.get(String(rec.destinationIata || '').toUpperCase());
        if (!aiItem) continue;
        rec.aiWhyNow = aiItem.whyNow;
        rec.aiRiskNote = aiItem.riskNote;
      }
      return { provider: selected, enhanced: true };
    } catch {
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

    const budgetMatch = raw.match(/(\d{2,5})\s*(€|eur|euro)/i) || raw.match(/budget[^0-9]*(\d{2,5})/i);
    if (budgetMatch) preferences.budgetMax = Number(budgetMatch[1]);

    const daysMatch = raw.match(/(\d{1,2})\s*(giorni|giorno|days|day|notti|notte|nights|night)/i);
    if (daysMatch) preferences.tripLengthDays = Math.max(2, Math.min(21, Number(daysMatch[1])));

    const iataMatch = raw.match(/\b[A-Z]{3}\b/g);
    if (Array.isArray(iataMatch) && iataMatch.length > 0) {
      const known = new Set((origins || []).map((o) => String(o.code || '').toUpperCase()));
      const picked = iataMatch.map((x) => x.toUpperCase()).find((x) => known.has(x));
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

  async function parseIntentWithAi({ prompt, aiProvider = 'auto', packageCount = 3 }) {
    const heuristic = parseIntentHeuristics(prompt, packageCount);
    const provider = String(aiProvider || 'auto').toLowerCase();
    if (provider === 'none') return heuristic;

    const openaiKey = String(env.OPENAI_API_KEY || '').trim();
    const claudeKey = String(env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY || '').trim();
    const selected =
      provider === 'chatgpt'
        ? 'chatgpt'
        : provider === 'claude'
          ? 'claude'
          : openaiKey
            ? 'chatgpt'
            : claudeKey
              ? 'claude'
              : 'none';
    if (selected === 'none') return heuristic;

    const systemPrompt =
      'Extract travel intent as strict JSON only: {"preferences":{"origin":"IATA?","budgetMax":number?,"tripLengthDays":number?,"mood":"relax|natura|party|cultura|avventura","climatePreference":"warm|mild|cold|indifferent","pace":"slow|normal|fast","avoidOvertourism":boolean,"region":"all|eu|asia|america|oceania","packageCount":3|4},"summary":"..."}';

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      let aiJson = null;
      try {
        if (selected === 'chatgpt' && openaiKey) {
          const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${openaiKey}`
            },
            body: JSON.stringify({
              model: env.OPENAI_MODEL || 'gpt-4.1-mini',
              temperature: 0.1,
              response_format: { type: 'json_object' },
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: String(prompt || '') }
              ]
            }),
            signal: controller.signal
          });
          if (!response.ok) return heuristic;
          const payload = await response.json().catch(() => ({}));
          aiJson = extractJsonObject(payload?.choices?.[0]?.message?.content || '');
        } else if (selected === 'claude' && claudeKey) {
          const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': claudeKey,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
              model: env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
              max_tokens: 300,
              temperature: 0.1,
              system: systemPrompt,
              messages: [{ role: 'user', content: String(prompt || '') }]
            }),
            signal: controller.signal
          });
          if (!response.ok) return heuristic;
          const payload = await response.json().catch(() => ({}));
          const content = Array.isArray(payload?.content) ? payload.content.map((x) => x?.text || '').join('\n') : '';
          aiJson = extractJsonObject(content);
        }
      } finally {
        clearTimeout(timer);
      }
      const parsedIntent = parseIntentAiPayload(aiJson);
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
    } catch {
      return heuristic;
    }
  }

  return {
    enrichDecisionWithAi,
    parseIntentWithAi
  };
}
