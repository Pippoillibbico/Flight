import { Router } from 'express';

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
  sendMachineError
}) {
  const router = Router();

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

    await withDb(async (db) => {
      db.searches.push({
        id: nanoid(8),
        at: new Date().toISOString(),
        userId: req.user.sub,
        payload: parsed.data,
        meta: result.meta
      });
      db.searches = db.searches.slice(-1000);
      return db;
    });
    await insertSearchEvent({
      userId: req.user.sub,
      channel: String(req.user.authChannel || 'direct'),
      origin: parsed.data.origin,
      region: parsed.data.region,
      dateFrom: parsed.data.dateFrom,
      dateTo: parsed.data.dateTo
    });

    return res.json(result);
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

    await withDb(async (db) => {
      db.searches.push({
        id: nanoid(8),
        at: new Date().toISOString(),
        userId: req.user.sub,
        payload: { ...payload, mode: 'just_go' },
        meta: result.meta
      });
      db.searches = db.searches.slice(-1000);
      return db;
    });

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
