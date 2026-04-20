import { Router } from 'express';
import { hashValueForLogs } from '../lib/log-redaction.js';
import { parseFlag } from '../lib/env-flags.js';
import { applyPricingToOffer, computeEconomics, guardOffer, sanitizeOfferForClient } from '../lib/pricing/index.js';
import { logEconomicEvent } from '../lib/observability/index.js';
import { getPlanRuntimeLimits } from '../lib/plan-access.js';

function round4(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

function resolveDeviceTypeFromUserAgent(value) {
  const ua = String(value || '').toLowerCase();
  if (!ua) return 'desktop';
  if (/mobile|android|iphone|ipad|ipod|windows phone|blackberry/.test(ua)) return 'mobile';
  return 'desktop';
}

function isPopularRouteCandidate(flight) {
  const numericSignals = [
    Number(flight?.routePopularityScore),
    Number(flight?.popularityScore),
    Number(flight?.route_popularity_score),
    Number(flight?.popularity)
  ].filter(Number.isFinite);

  if (numericSignals.length === 0) return false;
  // Accept both [0..1] and [0..100] scales.
  return numericSignals.some((value) => value >= 0.7 || value >= 70);
}

function isSmartDealCandidate(flight) {
  const dealLabel = String(flight?.dealLabel || flight?.deal_type || '').trim().toLowerCase();
  if (dealLabel === 'great_deal' || dealLabel === 'good_value' || dealLabel === 'hidden_deal') return true;
  if (Boolean(flight?.isSmartDeal) || Boolean(flight?.smartDeal)) return true;
  const dealPriority = Number(flight?.dealPriority);
  return Number.isFinite(dealPriority) && dealPriority >= 3;
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
  getOrCreateSubscription = null,
  nanoid,
  sendMachineError,
  captureUserPriceObservation = async () => {},
  liveFlightService = null
}) {
  const router = Router();
  const persistSearchHistory = parseFlag(
    process.env.SEARCH_HISTORY_PERSIST_ENABLED,
    !String(process.env.DATABASE_URL || '').trim()
  );

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

    const searchPayload = parsed.data;
    let resolvedPlanId = String(req.user?.planType || req.user?.plan || 'free').toLowerCase();
    if (typeof getOrCreateSubscription === 'function') {
      try {
        const subscription = await getOrCreateSubscription(req.user?.sub || req.user?.id || '');
        resolvedPlanId = String(subscription?.planId || resolvedPlanId).toLowerCase();
      } catch {}
    }
    const isFreeUser = resolvedPlanId === 'free';
    const isMultiCityMode = searchPayload.mode === 'multi_city' && Array.isArray(searchPayload.segments) && searchPayload.segments.length >= 2;
    const firstSegment = isMultiCityMode ? searchPayload.segments[0] : null;
    const lastSegment = isMultiCityMode ? searchPayload.segments[searchPayload.segments.length - 1] : null;
    const searchInput = isMultiCityMode
      ? {
          ...searchPayload,
          origin: firstSegment?.origin || searchPayload.origin,
          destinationQuery: lastSegment?.destination || searchPayload.destinationQuery,
          dateFrom: firstSegment?.date || searchPayload.dateFrom,
          dateTo: lastSegment?.date || undefined
        }
      : searchPayload;

    const result = searchFlights(searchInput);
    const syntheticFlights = Array.isArray(result.flights) ? result.flights : [];

    // ── Real-first strategy ───────────────────────────────────────────────────
    // 1. Collect unique destination IATAs from the synthetic candidate list.
    // 2. Query the live provider (Duffel) in parallel for the top N destinations.
    // 3. For each destination that has a live offer, overwrite price/currency and
    //    set isBookable=true + inventorySource=provider name.
    // 4. Destinations with no live offer remain as synthetic (isBookable=false).
    //    The feed is never empty — synthetic guarantees a fallback.
    // ─────────────────────────────────────────────────────────────────────────

    let offersByDest = {};
    let searchMode = 'synthetic_local_model';
    let liveMeta = null;

    if (liveFlightService && syntheticFlights.length > 0) {
      const uniqueDestsAll = [
        ...new Set(
          syntheticFlights
            .map((f) => String(f?.destinationIata || '').toUpperCase())
            .filter((d) => /^[A-Z]{3}$/.test(d))
        )
      ];
      // Per-plan live-provider fan-out: limits and cacheOnly come from PLAN_RUNTIME_LIMITS.
      // Free → 0 destinations (live call never fired); Pro → max 3; Creator → max 4.
      // Env overrides take precedence for operator tuning without code changes.
      const planLimits = getPlanRuntimeLimits(resolvedPlanId);
      const planDestCap = Math.max(0, Math.min(
        planLimits.liveDestinations,
        Number(process.env.SEARCH_LIVE_DESTINATION_LIMIT_OVERRIDE || planLimits.liveDestinations)
      ));
      const uniqueDests = uniqueDestsAll.slice(0, planDestCap);

      // Hard skip: if the destination list is empty (free plan or cap=0), skip
      // the live call entirely so no provider or cache lookup is initiated.
      if (uniqueDests.length === 0) {
        searchMode = 'synthetic_local_model';
      } else

      // ── Provider budget shield ──────────────────────────────────────────────
      // Check cost budgets before firing live API calls. If the daily or
      // per-minute budget is exhausted, degrade gracefully to synthetic results
      // instead of generating unbounded Duffel API spend.
      try {
        const liveResult = await liveFlightService.searchLiveFlights({
          originIata: String(searchInput.origin || '').toUpperCase(),
          destinations: uniqueDests,
          departureDate: searchInput.dateFrom,
          returnDate: searchInput.dateTo || null,
          adults: Number(searchInput.travellers || 1),
          cabinClass: String(searchInput.cabinClass || 'economy').toLowerCase(),
          userId: req.user?.sub || '',
          cacheOnly: planLimits.cacheOnly
        });
        offersByDest = liveResult.offersByDest;
        liveMeta = liveResult.meta;
        if (Object.keys(offersByDest).length > 0) searchMode = 'live_duffel';
      } catch (_) {
        // Graceful degrade: live provider failed, stay on synthetic
        searchMode = 'synthetic_local_model';
      }
    }

    // ── Pricing context for dynamic margin calculation ──────────────────────
    // Resolves runtime context consumed by the pricing engine.
    const userPricingTier = String(resolvedPlanId || 'free').toLowerCase();
    const clientDeviceType = resolveDeviceTypeFromUserAgent(req.headers['user-agent']);
    let isReturningUser = false;
    try {
      await withDb(async (db) => {
        const searches = Array.isArray(db?.searches) ? db.searches : [];
        isReturningUser = searches.some((entry) => String(entry?.userId || '') === String(req.user?.sub || ''));
        return null;
      });
    } catch {
      isReturningUser = false;
    }

    // Merge live offers into synthetic flight records
    const enhancedFlights = syntheticFlights.map((flight) => {
      const destIata = String(flight?.destinationIata || '').toUpperCase();
      const liveOffer = offersByDest[destIata];

      if (liveOffer) {
        // ── Step 1: pricing engine — raw cost → monetised display price ────────
        const pricedOffer = applyPricingToOffer(liveOffer, {
          userTier: userPricingTier,
          deviceType: clientDeviceType,
          isReturningUser,
          isPopularRoute: isPopularRouteCandidate(flight),
          isSmartDeal: isSmartDealCandidate(flight),
          isPremiumDeal: Boolean(flight?.isPremiumDeal),
          departureDate: searchInput.dateFrom
        });

        // ── Step 2: margin guard — validate P&L, recalculate or exclude ────────
        // The guard is the safety net: it catches misconfigurations, edge cases,
        // or any path that bypassed the pricing engine (e.g. PRICING_ENABLED=false).
        const guardResult = guardOffer(pricedOffer, {
          userId: req.user?.sub,
          searchId: result?.meta?.searchId || null,
          originIata: String(searchInput.origin || '').toUpperCase(),
          destinationIata: destIata
        });

        if (guardResult.action === 'exclude') {
          // Offer failed the margin check and cannot be recalculated within
          // acceptable bounds — demote to synthetic (non-bookable).
          return {
            ...flight,
            tripType: searchInput.dateTo ? 'round_trip' : 'one_way',
            isBookable: false,
            inventorySource: 'excluded_below_margin',
            providerValidated: false,
            providerValidatedMinPrice: null,
            _guardExcluded: true,
            _guardReason: guardResult.reason
          };
        }

        if (guardResult.action === 'non_monetizable') {
          return {
            ...flight,
            price: Number(guardResult.offer?.totalPrice || flight.price || 0),
            currency: String(guardResult.offer?.currency || flight.currency || 'EUR').toUpperCase(),
            tripType: searchInput.dateTo ? 'round_trip' : 'one_way',
            isBookable: false,
            inventorySource: 'non_monetizable_margin_guard',
            providerValidated: false,
            providerValidatedMinPrice: null,
            _providerCost: Number(guardResult.offer?._providerCost || 0) || null,
            _guardExcluded: true,
            _guardReason: guardResult.reason || 'non_monetizable'
          };
        }

        // action === 'pass' or 'recalculate': use the (possibly adjusted) offer
        const finalOffer = guardResult.offer;

        return {
          ...flight,
          price: finalOffer.totalPrice,            // safe display price
          currency: finalOffer.currency,
          isBookable: true,
          inventorySource: finalOffer.provider,
          provider: finalOffer.provider,
          tripType: searchInput.dateTo ? 'round_trip' : 'one_way',
          providerValidated: true,
          providerValidatedMinPrice: finalOffer.totalPrice,
          liveOfferId: finalOffer.metadata?.offerId || null,
          // Internal audit — stripped before response via sanitizeOfferForClient
          _providerCost: finalOffer._providerCost,
          _marginApplied: finalOffer._marginApplied,
          _pricingEnabled: finalOffer._pricingEnabled,
          _guardAction: guardResult.action,
          _guardRecalculated: finalOffer._guardRecalculated ?? false
        };
      }

      return {
        ...flight,
        tripType: searchInput.dateTo ? 'round_trip' : 'one_way',
        isBookable: false,
        inventorySource: 'synthetic_local_model',
        providerValidated: false,
        providerValidatedMinPrice: null
      };
    });

    // Bookable (live) flights bubble to the top, then sort by price
    enhancedFlights.sort((a, b) => {
      if (a.isBookable !== b.isBookable) return a.isBookable ? -1 : 1;
      return (a.price || 0) - (b.price || 0);
    });

    const liveCount = enhancedFlights.filter((f) => f.isBookable).length;
    const syntheticCount = enhancedFlights.length - liveCount;
    const providerValidatedItems = enhancedFlights
      .filter((flight) => flight?.isBookable)
      .map((flight) => ({
        originIata: String(flight.origin || searchInput.origin || '').toUpperCase(),
        destinationIata: String(flight.destinationIata || '').toUpperCase(),
        totalPrice: Number(flight.price),
        currency: String(flight.currency || 'EUR').toUpperCase(),
        provider: String(flight.provider || 'duffel'),
        tripType: String(flight.tripType || (searchInput.dateTo ? 'round_trip' : 'one_way')).toLowerCase()
      }))
      .filter((item) => /^[A-Z]{3}$/.test(item.destinationIata) && Number.isFinite(item.totalPrice) && item.totalPrice > 0);

    const enhancedResult = {
      ...result,
      flights: enhancedFlights,
      inventory: {
        synthetic: {
          count: syntheticCount,
          source: 'local_model',
          isFallback: searchMode === 'live_duffel'
        },
        live: {
          count: liveCount,
          provider: searchMode === 'live_duffel' ? 'duffel' : null
        },
        providerValidated: {
          enabled: searchMode === 'live_duffel',
          count: liveCount,
          // Expose only monetised prices to clients (never raw provider totals).
          items: providerValidatedItems,
          degradedReason:
            liveMeta?.degradedReason ||
            (syntheticFlights.length > 0 && liveCount === 0 ? 'live_provider_degraded_using_synthetic' : null)
        }
      },
      meta: {
        ...(result.meta || {}),
        searchMode,
        bookability: searchMode === 'live_duffel'
          ? 'live_bookable_with_synthetic_fallback'
          : 'simulated_with_optional_provider_validation',
        requestMode: isMultiCityMode ? 'multi_city' : 'single',
        liveInventory: liveMeta,
        multiCitySegments: isMultiCityMode
          ? searchPayload.segments.map((segment) => ({
              origin: segment.origin,
              destination: segment.destination,
              date: segment.date
            }))
          : undefined
      }
    };

    if (persistSearchHistory) {
      withDb(async (db) => {
        db.searches.push({
          id: nanoid(8),
          at: new Date().toISOString(),
          userId: req.user.sub,
          payload: searchPayload,
          meta: enhancedResult.meta
        });
        db.searches = db.searches.slice(-1000);
        return db;
      }).catch(() => {});
    }
    insertSearchEvent({
      userId: req.user.sub,
      channel: String(req.user.authChannel || 'direct'),
      origin: searchInput.origin,
      region: searchInput.region,
      dateFrom: searchInput.dateFrom,
      dateTo: searchInput.dateTo || searchInput.dateFrom
    }).catch(() => {});
    const concreteFlights = Array.isArray(enhancedResult.flights) ? enhancedResult.flights.slice(0, 20) : [];
    Promise.allSettled(
      concreteFlights.map((flight) =>
        captureUserPriceObservation({
          originIata: String(flight.origin || searchInput.origin).toUpperCase(),
          destinationIata: String(flight.destinationIata || '').toUpperCase(),
          departureDate: searchInput.dateFrom,
          returnDate: searchInput.dateTo || null,
          // Use the actual currency from the flight offer, not a hardcoded 'EUR'
          currency: String(flight.currency || 'EUR').toUpperCase(),
          // Record the provider cost for analytics, not the marked-up display price
          totalPrice: Number(flight._providerCost ?? flight.price),
          provider: String(flight.provider || 'user_search'),
          cabinClass: searchInput.cabinClass,
          tripType: searchInput.dateTo ? 'round_trip' : 'one_way',
          source: 'user_search',
          metadata: {
            channel: 'search',
            searchId: result?.meta?.searchId || null,
            displayPrice: flight._pricingEnabled ? Number(flight.price) : null,
            marginApplied: flight._marginApplied || null
          }
        })
      )
    ).catch(() => {});

    try {
      const pricedFlights = enhancedFlights.filter((flight) => {
        const providerCost = Number(flight?._providerCost);
        const displayPrice = Number(flight?.price);
        return Number.isFinite(providerCost) && providerCost > 0 && Number.isFinite(displayPrice) && displayPrice > 0;
      });
      const economicsByFlight = pricedFlights.map((flight) => computeEconomics(Number(flight._providerCost), Number(flight.price)));
      const totals = economicsByFlight.reduce(
        (acc, row) => ({
          revenueEur: acc.revenueEur + Number(row.revenueEur || 0),
          providerCostEur: acc.providerCostEur + Number(row.providerCost || 0),
          stripeFeeEur: acc.stripeFeeEur + Number(row.stripeFeeEur || 0),
          aiCostEur: acc.aiCostEur + Number(row.aiCostEur || 0),
          grossMarginEur: acc.grossMarginEur + Number(row.grossMarginEur || 0),
          netMarginEur: acc.netMarginEur + Number(row.netMarginEur || 0)
        }),
        {
          revenueEur: 0,
          providerCostEur: 0,
          stripeFeeEur: 0,
          aiCostEur: 0,
          grossMarginEur: 0,
          netMarginEur: 0
        }
      );
      const excludedCount = enhancedFlights.filter((flight) => {
        const source = String(flight?.inventorySource || '').toLowerCase();
        if (Boolean(flight?._guardExcluded)) return true;
        return source.includes('excluded') || source.includes('non_monetizable');
      }).length;
      const revenueEur = round4(totals.revenueEur);
      const grossMarginRate = revenueEur > 0 ? round4(totals.grossMarginEur / revenueEur) : 0;
      const netMarginRate = revenueEur > 0 ? round4(totals.netMarginEur / revenueEur) : 0;

      logEconomicEvent('search_economics', {
        user_id: req.user?.sub || null,
        user_tier: userPricingTier,
        origin: String(searchInput.origin || '').toUpperCase(),
        destination: isMultiCityMode
          ? String(lastSegment?.destination || '').toUpperCase()
          : String(searchInput.destinationQuery || '').trim().toUpperCase() || null,
        trip_type: searchInput.dateTo ? 'round_trip' : 'one_way',
        revenue_eur: revenueEur,
        provider_cost_eur: round4(totals.providerCostEur),
        stripe_fee_eur: round4(totals.stripeFeeEur),
        ai_cost_eur: round4(totals.aiCostEur),
        gross_margin_eur: round4(totals.grossMarginEur),
        net_margin_eur: round4(totals.netMarginEur),
        gross_margin_rate: grossMarginRate,
        net_margin_rate: netMarginRate,
        offer_count: enhancedFlights.length,
        bookable_count: liveCount,
        excluded_count: excludedCount,
        extra: {
          search_mode: searchMode,
          search_id: result?.meta?.searchId || null,
          is_multi_city: isMultiCityMode,
          free_user_heavy_cost_signal:
            userPricingTier === 'free' &&
            (round4(totals.aiCostEur) > 0.4 || round4(totals.providerCostEur) > 800)
        }
      });
    } catch {}

    // Strip internal pricing audit fields before sending to the client.
    // The frontend must never see providerCost or marginApplied.
    const safeResult = {
      ...enhancedResult,
      flights: (enhancedResult.flights || []).map(sanitizeOfferForClient)
    };

    return res.json(safeResult);
  });

  router.post('/decision/just-go', authGuard, csrfGuard, requireApiScope('search'), quotaGuard({ counter: 'decision', amount: 1 }), async (req, res) => {
    const parsed = justGoSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload.' });

    const payload = parsed.data;
    const aiAccess = await ensureAiPremiumAccess(req, payload.aiProvider || 'none');
    if (!aiAccess.allowed) return sendMachineError(req, res, aiAccess.status, aiAccess.error, aiAccess.extra || {});
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
      userPlan: req.user?.planType || req.user?.plan || 'free',
      userId: req.user?.sub || req.user?.id || '',
      routeKey: 'decision.just_go',
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

    insertSearchEvent({
      userId: req.user.sub,
      channel: String(req.user.authChannel || 'direct'),
      origin: payload.origin,
      region: payload.region || 'all',
      dateFrom: payload.dateFrom,
      dateTo: payload.dateTo
    }).catch(() => {});

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
    if (!aiAccess.allowed) return sendMachineError(req, res, aiAccess.status, aiAccess.error, aiAccess.extra || {});
    const result = await parseIntentWithAi({
      prompt: payload.prompt,
      aiProvider: payload.aiProvider || 'none',
      packageCount: payload.packageCount === 4 ? 4 : 3,
      userPlan: req.user?.planType || req.user?.plan || 'free',
      userId: req.user?.sub || req.user?.id || '',
      routeKey: 'decision.intake'
    });

    return res.json(result);
  });

  router.get('/search/history', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res) => {
    // persist_enabled tells the client whether searches are actually being saved.
    // When SEARCH_HISTORY_PERSIST_ENABLED is falsy the store is never written,
    // so history is always empty and the UI should not surface this feature.
    if (!persistSearchHistory) {
      return res.json({ items: [], persist_enabled: false });
    }
    let items = [];
    await withDb(async (db) => {
      items = db.searches
        .filter((s) => s.userId === req.user.sub)
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, 20);
      return null;
    });
    return res.json({ items, persist_enabled: true });
  });

  router.get('/security/activity', authGuard, requireApiScope('read'), quotaGuard({ counter: 'read', amount: 1 }), async (req, res) => {
    let items = [];
    const currentEmailHash = hashValueForLogs(String(req.user?.email || '').toLowerCase(), { label: 'email', length: 24 });
    await withDb(async (db) => {
      items = db.authEvents
        .filter(
          (event) =>
            event.userId === req.user.sub ||
            (currentEmailHash && event.emailHash === currentEmailHash) ||
            event.email === req.user.email
        )
        .map((event) => ({
          ...event,
          ip: event.ipHash || event.ip || null,
          email: null
        }))
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, 40);
      return null;
    });
    return res.json({ items });
  });

  return router;
}
