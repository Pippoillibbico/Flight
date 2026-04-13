import { Router } from 'express';

function parseFlag(value, fallback = false) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(text);
}

function dayKeyText(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

async function incrBy(cache, key, amount) {
  let out = 0;
  for (let i = 0; i < amount; i += 1) {
    out = Number(await cache.incr(key));
  }
  return out;
}

export function buildSearchRouter({
  ORIGINS,
  REGION_ENUM,
  CABIN_ENUM,
  CONNECTION_ENUM,
  TRAVEL_TIME_ENUM,
  DESTINATIONS,
  COUNTRIES,
  getDestinationSuggestions,
  searchFlights,
  decideTrips,
  ensureAiPremiumAccess,
  enrichDecisionWithAi,
  parseIntentWithAi,
  searchSchema,
  justGoSchema,
  decisionIntakeSchema,
  authGuard,
  csrfGuard,
  requireApiScope,
  quotaGuard,
  withDb,
  insertSearchEvent,
  nanoid,
  sendMachineError,
  captureUserPriceObservation = async () => {},
  searchProviderOffers = async () => [],
  cacheClient = null
}) {
  const router = Router();
  const providerValidationLimit = Math.max(1, Math.min(10, Number(process.env.SEARCH_PROVIDER_VALIDATION_LIMIT || 5)));
  const providerValidationEnabled = parseFlag(process.env.SEARCH_PROVIDER_VALIDATION_ENABLED, true);
  const providerGlobalDailyBudget = Math.max(0, Number(process.env.SEARCH_PROVIDER_GLOBAL_DAILY_BUDGET || 0));
  const providerUserDailyBudget = Math.max(0, Number(process.env.SEARCH_PROVIDER_USER_DAILY_BUDGET || 0));
  const providerGlobalPerMinuteBudget = Math.max(0, Number(process.env.SEARCH_PROVIDER_GLOBAL_PER_MINUTE_BUDGET || 0));
  const providerShieldGracefulDegrade = parseFlag(process.env.SEARCH_PROVIDER_COST_SHIELD_ENABLED, true);
  const persistSearchHistory = parseFlag(
    process.env.SEARCH_HISTORY_PERSIST_ENABLED,
    !String(process.env.DATABASE_URL || '').trim()
  );

  async function claimProviderValidationBudget({ userId = '', plannedCalls = 0 }) {
    const amount = Math.max(0, Number(plannedCalls) || 0);
    if (!amount) return { allowed: true, degradedReason: null };
    if (!cacheClient || typeof cacheClient.incr !== 'function') return { allowed: true, degradedReason: null };

    const now = Date.now();
    const minuteBucket = Math.floor(now / 60_000);
    const dayBucket = dayKeyText(new Date(now));
    const safeUserId = String(userId || '').trim() || 'anonymous';

    const globalDayKey = `search:provider:budget:global:day:${dayBucket}`;
    const userDayKey = `search:provider:budget:user:${safeUserId}:day:${dayBucket}`;
    const globalMinuteKey = `search:provider:budget:global:minute:${minuteBucket}`;

    const [globalUsedDay, userUsedDay, globalUsedMinute] = await Promise.all([
      incrBy(cacheClient, globalDayKey, amount),
      incrBy(cacheClient, userDayKey, amount),
      incrBy(cacheClient, globalMinuteKey, amount)
    ]);

    if (typeof cacheClient.expire === 'function') {
      await Promise.allSettled([
        cacheClient.expire(globalDayKey, 24 * 60 * 60 + 120),
        cacheClient.expire(userDayKey, 24 * 60 * 60 + 120),
        cacheClient.expire(globalMinuteKey, 120)
      ]);
    }

    if (providerGlobalDailyBudget > 0 && globalUsedDay > providerGlobalDailyBudget) {
      return { allowed: false, degradedReason: 'provider_budget_global_daily_exceeded' };
    }
    if (providerUserDailyBudget > 0 && userUsedDay > providerUserDailyBudget) {
      return { allowed: false, degradedReason: 'provider_budget_user_daily_exceeded' };
    }
    if (providerGlobalPerMinuteBudget > 0 && globalUsedMinute > providerGlobalPerMinuteBudget) {
      return { allowed: false, degradedReason: 'provider_budget_global_minute_exceeded' };
    }
    return { allowed: true, degradedReason: null };
  }

  async function collectProviderValidatedOffers(searchInput, syntheticFlights, { userId = '' } = {}) {
    const flights = Array.isArray(syntheticFlights) ? syntheticFlights : [];
    if (!providerValidationEnabled) {
      return { enabled: false, items: [], byDestinationMinPrice: {}, degradedReason: 'provider_validation_disabled' };
    }
    if (flights.length === 0) return { enabled: false, items: [], byDestinationMinPrice: {}, degradedReason: null };
    const candidates = [];
    const seen = new Set();
    for (const flight of flights) {
      const destinationIata = String(flight?.destinationIata || '').toUpperCase();
      if (!/^[A-Z]{3}$/.test(destinationIata)) continue;
      if (seen.has(destinationIata)) continue;
      seen.add(destinationIata);
      candidates.push(destinationIata);
      if (candidates.length >= providerValidationLimit) break;
    }
    if (candidates.length === 0) return { enabled: false, items: [], byDestinationMinPrice: {}, degradedReason: null };

    const budgetClaim = await claimProviderValidationBudget({ userId, plannedCalls: candidates.length });
    if (!budgetClaim.allowed && providerShieldGracefulDegrade) {
      return {
        enabled: false,
        items: [],
        byDestinationMinPrice: {},
        degradedReason: budgetClaim.degradedReason || 'provider_budget_exceeded'
      };
    }

    const settled = await Promise.allSettled(
      candidates.map((destinationIata) =>
        searchProviderOffers({
          originIata: String(searchInput.origin || '').toUpperCase(),
          destinationIata,
          departureDate: searchInput.dateFrom,
          returnDate: searchInput.dateTo || null,
          adults: Number(searchInput.travellers || 1),
          cabinClass: String(searchInput.cabinClass || 'economy').toLowerCase()
        })
      )
    );

    const validItems = [];
    for (const row of settled) {
      if (row.status !== 'fulfilled' || !Array.isArray(row.value)) continue;
      for (const offer of row.value) {
        const destinationIata = String(offer?.destinationIata || '').toUpperCase();
        const totalPrice = Number(offer?.totalPrice);
        if (!/^[A-Z]{3}$/.test(destinationIata)) continue;
        if (!Number.isFinite(totalPrice) || totalPrice <= 0) continue;
        validItems.push({
          originIata: String(offer?.originIata || searchInput.origin || '').toUpperCase(),
          destinationIata,
          totalPrice,
          currency: String(offer?.currency || 'EUR').toUpperCase(),
          provider: String(offer?.provider || 'provider').toLowerCase(),
          tripType: String(offer?.tripType || (searchInput.dateTo ? 'round_trip' : 'one_way')).toLowerCase()
        });
      }
    }
    validItems.sort((a, b) => a.totalPrice - b.totalPrice);
    const byDestinationMinPrice = {};
    for (const item of validItems) {
      if (!Object.hasOwn(byDestinationMinPrice, item.destinationIata)) byDestinationMinPrice[item.destinationIata] = item.totalPrice;
    }
    return {
      enabled: true,
      items: validItems.slice(0, 120),
      byDestinationMinPrice,
      degradedReason: null
    };
  }

  router.get('/config', (_req, res) => {
    const countriesByRegion = {};
    for (const region of REGION_ENUM.filter((r) => r !== 'all')) {
      countriesByRegion[region] = [...new Set(DESTINATIONS.filter((d) => d.region === region).map((d) => d.country))].sort();
    }
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.json({
      origins: ORIGINS,
      regions: REGION_ENUM,
      cabins: CABIN_ENUM,
      connectionTypes: CONNECTION_ENUM,
      travelTimes: TRAVEL_TIME_ENUM,
      countriesByRegion
    });
  });

  router.get('/suggestions', (req, res) => {
    const query = String(req.query.q || '');
    const region = String(req.query.region || 'all');
    const country = req.query.country ? String(req.query.country) : undefined;
    const limit = Number(req.query.limit || 8);

    const safeRegion = REGION_ENUM.includes(region) ? region : 'all';
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 20) : 8;

    const items = getDestinationSuggestions({
      query,
      region: safeRegion,
      country,
      limit: safeLimit
    });
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json({ items });
  });

  router.get('/countries', (req, res) => {
    const query = String(req.query.q || '')
      .toLowerCase()
      .trim();
    const limit = Number(req.query.limit || 12);
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 12;

    const scored = COUNTRIES.map((country) => {
      if (!query) return { country, score: 0 };

      const name = country.name.toLowerCase();
      const official = country.officialName.toLowerCase();
      const code = country.cca2.toLowerCase();

      let score = 999;
      if (name === query || code === query) score = 0;
      else if (name.startsWith(query)) score = 1;
      else if (name.includes(query)) score = 2;
      else if (official.includes(query)) score = 3;

      return { country, score };
    })
      .filter((x) => x.score < 999)
      .sort((a, b) => a.score - b.score || a.country.name.localeCompare(b.country.name));

    const items = scored
      .map((x) => x.country)
      .slice(0, safeLimit)
      .map((country) => ({
        name: country.name,
        label: country.region ? `${country.name} (${country.region})` : country.name,
        region: country.region,
        cca2: country.cca2
      }));

    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.json({ items });
  });

  router.post('/search', authGuard, csrfGuard, requireApiScope('search'), quotaGuard({ counter: 'search', amount: 1 }), async (req, res) => {
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload.' });

    const result = searchFlights(parsed.data);
    const providerValidated = await collectProviderValidatedOffers(parsed.data, result.flights, { userId: req.user?.sub || req.user?.id || '' });
    const enhancedFlights = (Array.isArray(result.flights) ? result.flights : []).map((flight) => {
      const destinationIata = String(flight?.destinationIata || '').toUpperCase();
      const validatedMinPrice = Number(providerValidated.byDestinationMinPrice[destinationIata]);
      const providerValidatedPrice = Number.isFinite(validatedMinPrice) ? validatedMinPrice : null;
      return {
        ...flight,
        tripType: parsed.data.dateTo ? 'round_trip' : 'one_way',
        isBookable: false,
        inventorySource: 'synthetic_local_model',
        providerValidated: Number.isFinite(providerValidatedPrice),
        providerValidatedMinPrice: providerValidatedPrice
      };
    });
    const enhancedResult = {
      ...result,
      flights: enhancedFlights,
      inventory: {
        synthetic: {
          count: enhancedFlights.length,
          source: 'local_model'
        },
        providerValidated: {
          enabled: providerValidated.enabled,
          count: providerValidated.items.length,
          items: providerValidated.items,
          degradedReason: providerValidated.degradedReason || null
        }
      },
      meta: {
        ...(result.meta || {}),
        searchMode: 'synthetic_local_model',
        bookability: 'simulated_with_optional_provider_validation'
      }
    };

    if (persistSearchHistory) {
      withDb(async (db) => {
        db.searches.push({
          id: nanoid(8),
          at: new Date().toISOString(),
          userId: req.user.sub,
          payload: parsed.data,
          meta: enhancedResult.meta
        });
        db.searches = db.searches.slice(-1000);
        return db;
      }).catch(() => {});
    }
    await insertSearchEvent({
      userId: req.user.sub,
      channel: String(req.user.authChannel || 'direct'),
      origin: parsed.data.origin,
      region: parsed.data.region,
      dateFrom: parsed.data.dateFrom,
      dateTo: parsed.data.dateTo || parsed.data.dateFrom
    });
    const concreteFlights = Array.isArray(enhancedResult.flights) ? enhancedResult.flights.slice(0, 20) : [];
    Promise.allSettled(
      concreteFlights.map((flight) =>
        captureUserPriceObservation({
          originIata: String(flight.origin || parsed.data.origin).toUpperCase(),
          destinationIata: String(flight.destinationIata || '').toUpperCase(),
          departureDate: parsed.data.dateFrom,
          returnDate: parsed.data.dateTo || null,
          currency: 'EUR',
          totalPrice: Number(flight.price),
          provider: String(flight.provider || 'user_search'),
          cabinClass: parsed.data.cabinClass,
          tripType: parsed.data.dateTo ? 'round_trip' : 'one_way',
          source: 'user_search',
          metadata: {
            channel: 'search',
            searchId: result?.meta?.searchId || null
          }
        })
      )
    ).catch(() => {});

    return res.json(enhancedResult);
  });

  router.post('/decision/just-go', authGuard, csrfGuard, requireApiScope('search'), quotaGuard({ counter: 'decision', amount: 1 }), async (req, res) => {
    const parsed = justGoSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload.' });

    const payload = parsed.data;
    const aiAccess = await ensureAiPremiumAccess(req, payload.aiProvider || 'none');
    if (!aiAccess.allowed) return sendMachineError(req, res, aiAccess.status, aiAccess.error);
    const result = decideTrips({
      origin: payload.origin,
      region: payload.region || 'all',
      country: payload.country,
      dateFrom: payload.dateFrom,
      dateTo: payload.dateTo,
      tripLengthDays: payload.tripLengthDays,
      budgetMax: payload.budgetMax,
      travellers: payload.travellers,
      cabinClass: payload.cabinClass,
      mood: payload.mood,
      climatePreference: payload.climatePreference,
      pace: payload.pace,
      avoidOvertourism: Boolean(payload.avoidOvertourism),
      packageCount: payload.packageCount === 4 ? 4 : 3
    });

    const ai = await enrichDecisionWithAi({
      aiProvider: payload.aiProvider || 'none',
      requestPayload: payload,
      decisionResult: result
    });

    if (persistSearchHistory) {
      withDb(async (db) => {
        db.searches.push({
          id: nanoid(8),
          at: new Date().toISOString(),
          userId: req.user.sub,
          payload: { ...payload, mode: 'just_go' },
          meta: result.meta
        });
        db.searches = db.searches.slice(-1000);
        return db;
      }).catch(() => {});
    }

    await insertSearchEvent({
      userId: req.user.sub,
      channel: String(req.user.authChannel || 'direct'),
      origin: payload.origin,
      region: payload.region || 'all',
      dateFrom: payload.dateFrom,
      dateTo: payload.dateTo
    });

    return res.json({
      ...result,
      ai
    });
  });

  router.post('/decision/intake', authGuard, csrfGuard, requireApiScope('search'), quotaGuard({ counter: 'decision', amount: 1 }), async (req, res) => {
    const parsed = decisionIntakeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload.' });

    const payload = parsed.data;
    const aiAccess = await ensureAiPremiumAccess(req, payload.aiProvider || 'none');
    if (!aiAccess.allowed) return sendMachineError(req, res, aiAccess.status, aiAccess.error);
    const result = await parseIntentWithAi({
      prompt: payload.prompt,
      aiProvider: payload.aiProvider || 'none',
      packageCount: payload.packageCount === 4 ? 4 : 3
    });

    return res.json(result);
  });

  router.get('/search/history', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res) => {
    let items = [];
    await withDb(async (db) => {
      items = db.searches
        .filter((s) => s.userId === req.user.sub)
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, 20);
      return null;
    });
    return res.json({ items });
  });

  router.get('/security/activity', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res) => {
    let items = [];
    await withDb(async (db) => {
      items = db.authEvents
        .filter((event) => event.userId === req.user.sub || event.email === req.user.email)
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, 40);
      return null;
    });
    return res.json({ items });
  });

  return router;
}
