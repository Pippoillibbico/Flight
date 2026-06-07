import { searchFlights as searchFlightsFromEngine } from './flight-engine.js';

const STRATEGIC_AIRPORTS = ['MXP', 'BGY', 'VIE', 'BUD', 'BCN'];
const MIN_SAVING_ABS_EUR = 60;
const MIN_SAVING_PCT = 12;
const MAX_ALTERNATIVES = 3;
const CACHE_TTL_MS = 10 * 60 * 1000;

const cachedAlternativesStore = new Map();

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeIata(value) {
  return String(value || '').trim().toUpperCase().slice(0, 3);
}

function normalizePlan(planLike) {
  const normalized = String(planLike || '').trim().toLowerCase();
  if (!normalized) return 'free';
  if (normalized === 'creator' || normalized === 'elite') return 'creator';
  if (normalized === 'pro') return 'pro';
  return 'free';
}

function resolvePlanFromUser(user) {
  if (!user || typeof user !== 'object') return 'free';
  return normalizePlan(user.planType || user.plan || user.plan_id || user.tier);
}

function maxAlternativesByPlan(user) {
  if (!user) return 1;
  const plan = resolvePlanFromUser(user);
  if (plan === 'free') return 2;
  return 3;
}

function maxAlternativesByPlanId(planId) {
  if (!String(planId || '').trim()) return 1;
  const plan = normalizePlan(planId);
  if (plan === 'free') return 2;
  if (plan === 'pro' || plan === 'creator') return 3;
  return 1;
}

function shouldKeepAlternative(savingAbs, savingPct) {
  if (savingAbs < 20) return false;
  return savingAbs >= MIN_SAVING_ABS_EUR || savingPct >= MIN_SAVING_PCT;
}

function cacheKey({ origin, destination, departureDate, returnDate }) {
  return [
    normalizeIata(origin),
    normalizeIata(destination),
    String(departureDate || '').slice(0, 10),
    String(returnDate || '').slice(0, 10)
  ].join('|');
}

function computeSyntheticAirportAdjustment(airport) {
  const code = normalizeIata(airport);
  // Deterministic, stable pseudo-adjustment for cached/precomputed mode.
  const checksum = code.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return 35 + (checksum % 190); // 35..224
}

function buildSyntheticAlternatives({ origin, destination, departureDate, returnDate, basePrice }) {
  const normalizedOrigin = normalizeIata(origin);
  const price = toNumber(basePrice);
  if (!normalizedOrigin || !normalizeIata(destination) || price === null) return [];

  const candidates = STRATEGIC_AIRPORTS
    .filter((iata) => iata !== normalizedOrigin)
    .map((airport) => {
      const adjustment = computeSyntheticAirportAdjustment(airport);
      const altPrice = Math.max(49, Math.round(price - adjustment));
      const savingAbs = Math.max(0, Math.round((price - altPrice) * 100) / 100);
      const savingPct = price > 0 ? Math.max(0, (savingAbs / price) * 100) : 0;
      return {
        originIata: airport,
        destinationIata: normalizeIata(destination),
        origin: airport,
        destination: normalizeIata(destination),
        departureDate: String(departureDate || '').slice(0, 10) || null,
        returnDate: String(returnDate || '').slice(0, 10) || null,
        price: altPrice,
        savingAbs: Math.round(savingAbs),
        savingPct: Math.round(savingPct * 10) / 10,
        qualityScore: 0,
        label: savingAbs >= 180 ? 'Best saving' : 'Smart departure'
      };
    })
    .filter((item) => shouldKeepAlternative(item.savingAbs, item.savingPct))
    .sort((a, b) => b.savingAbs - a.savingAbs || (b.qualityScore || 0) - (a.qualityScore || 0))
    .slice(0, MAX_ALTERNATIVES);

  return candidates;
}

function readCachedAlternatives(key) {
  const existing = cachedAlternativesStore.get(key);
  if (!existing) return null;
  if (Date.now() - existing.at > CACHE_TTL_MS) {
    cachedAlternativesStore.delete(key);
    return null;
  }
  return existing.items;
}

function writeCachedAlternatives(key, items) {
  cachedAlternativesStore.set(key, {
    at: Date.now(),
    items: Array.isArray(items) ? items : []
  });
}

async function resolveLiveAlternatives({
  origin,
  destination,
  departureDate,
  returnDate,
  basePrice,
  travellers,
  cabinClass,
  liveSearchFn
}) {
  if (typeof liveSearchFn !== 'function') return [];

  const normalizedOrigin = normalizeIata(origin);
  const normalizedDestination = normalizeIata(destination);
  const price = toNumber(basePrice);
  if (!normalizedOrigin || !normalizedDestination || price === null) return [];

  const airports = STRATEGIC_AIRPORTS.filter((iata) => iata !== normalizedOrigin);
  const results = [];

  for (const airport of airports) {
    try {
      const resolved = await liveSearchFn({
        origin: airport,
        destination: normalizedDestination,
        departureDate,
        returnDate,
        travellers,
        cabinClass
      });
      const altPrice = toNumber(resolved?.price);
      if (altPrice === null) continue;
      const savingAbs = Math.max(0, Math.round((price - altPrice) * 100) / 100);
      const savingPct = price > 0 ? Math.max(0, (savingAbs / price) * 100) : 0;
      if (!shouldKeepAlternative(savingAbs, savingPct)) continue;
      results.push({
        originIata: airport,
        destinationIata: normalizedDestination,
        origin: airport,
        destination: normalizedDestination,
        departureDate: String(departureDate || '').slice(0, 10) || null,
        returnDate: String(returnDate || '').slice(0, 10) || null,
        price: Math.round(altPrice),
        savingAbs: Math.round(savingAbs),
        savingPct: Math.round(savingPct * 10) / 10,
        qualityScore: toNumber(resolved?.qualityScore) || 0,
        label: savingAbs >= 180 ? 'Best saving' : 'Smart departure'
      });
    } catch {
      // Never block response due to smart-departure enrichment.
    }
  }

  return results
    .sort((a, b) => b.savingAbs - a.savingAbs || (b.qualityScore || 0) - (a.qualityScore || 0))
    .slice(0, MAX_ALTERNATIVES);
}

function buildSmartDeparturePayload({ origin, basePrice, alternatives }) {
  const primaryOrigin = normalizeIata(origin);
  const best = alternatives[0] || null;
  const summary = best ? `Partendo da ${best.originIata} risparmi circa ${Math.round(best.savingAbs)}€.` : null;
  return {
    enabled: true,
    primaryOffer: {
      originIata: primaryOrigin,
      price: Math.round(Number(basePrice) || 0)
    },
    alternatives,
    bestAlternative: best,
    summaryMessage: summary,
    // Backward-compat aliases used by current UI wiring.
    best,
    summary
  };
}

function buildLocalizedSummary(best, locale) {
  if (!best) return null;
  if (String(locale || '').toLowerCase().startsWith('it')) {
    return `Partendo da ${best.originIata} risparmi circa ${Math.round(best.savingAbs)}€.`;
  }
  return `Starting from ${best.originIata} saves about €${Math.round(best.savingAbs)}.`;
}

function buildEngineLiveSearchFn(searchInput) {
  return ({ origin, destination, departureDate, returnDate, travellers, cabinClass }) => {
    const result = searchFlightsFromEngine({
      ...(searchInput || {}),
      origin,
      region: searchInput?.region || 'all',
      destinationQuery: destination,
      dateFrom: departureDate || searchInput?.dateFrom,
      dateTo: returnDate || searchInput?.dateTo,
      cheapOnly: false,
      maxBudget: undefined,
      travellers: travellers || searchInput?.travellers || 1,
      cabinClass: cabinClass || searchInput?.cabinClass || 'economy'
    });
    const best = (result?.flights || []).find((flight) => normalizeIata(flight?.destinationIata) === normalizeIata(destination));
    if (!best) return null;
    return {
      price: best.price,
      qualityScore: best.comfortScore || best.score || 0,
      bookingLink: best.bookingLink || best.link || null
    };
  };
}

export async function getSmartDeparture({
  origin,
  destination,
  departureDate,
  returnDate = null,
  basePrice,
  travellers = 1,
  cabinClass = 'economy',
  user = null,
  liveSearchFn = null,
  userPlan = null,
  locale = 'it',
  primaryFlight = null,
  searchInput = null
}) {
  const resolvedOrigin = origin || primaryFlight?.origin || searchInput?.origin;
  const resolvedDestination =
    destination ||
    primaryFlight?.destinationIata ||
    searchInput?.destinationIata ||
    searchInput?.destinationQuery;
  const resolvedDepartureDate = departureDate || searchInput?.dateFrom || primaryFlight?.departureDate;
  const resolvedReturnDate = returnDate || searchInput?.dateTo || primaryFlight?.returnDate || null;
  const resolvedBasePrice = basePrice ?? primaryFlight?.price;
  const normalizedOrigin = normalizeIata(resolvedOrigin);
  const normalizedDestination = normalizeIata(resolvedDestination);
  const price = toNumber(resolvedBasePrice);

  if (!normalizedOrigin || !normalizedDestination || price === null) {
    return {
      enabled: false,
      primaryOffer: null,
      alternatives: [],
      bestAlternative: null,
      summaryMessage: null,
      best: null,
      summary: null
    };
  }

  const plan = user ? resolvePlanFromUser(user) : normalizePlan(userPlan);
  const maxByPlan = user ? maxAlternativesByPlan(user) : maxAlternativesByPlanId(userPlan);
  const key = cacheKey({
    origin: normalizedOrigin,
    destination: normalizedDestination,
    departureDate: resolvedDepartureDate,
    returnDate: resolvedReturnDate
  });
  const cached = readCachedAlternatives(key);

  // Free safety gate: anonymous/free must use cached/precomputed mode only.
  if (!user || plan === 'free') {
    const fromCache = Array.isArray(cached)
      ? cached
      : buildSyntheticAlternatives({
          origin: normalizedOrigin,
          destination: normalizedDestination,
          departureDate: resolvedDepartureDate,
          returnDate: resolvedReturnDate,
          basePrice: price
        });
    if (!cached) writeCachedAlternatives(key, fromCache);
    const alternatives = fromCache.slice(0, maxByPlan);
    const payload = buildSmartDeparturePayload({ origin: normalizedOrigin, basePrice: price, alternatives });
    const summary = buildLocalizedSummary(payload.bestAlternative, locale);
    return { ...payload, summaryMessage: summary, summary };
  }

  // Pro/Creator: can use live search when available, with safe fallback to cache/synthetic.
  const resolvedLiveSearchFn = liveSearchFn || (searchInput ? buildEngineLiveSearchFn(searchInput) : null);
  const liveAlternatives = await resolveLiveAlternatives({
    origin: normalizedOrigin,
    destination: normalizedDestination,
    departureDate: resolvedDepartureDate,
    returnDate: resolvedReturnDate,
    basePrice: price,
    travellers,
    cabinClass,
    liveSearchFn: resolvedLiveSearchFn
  });

  const resolved = liveAlternatives.length > 0
    ? liveAlternatives
    : Array.isArray(cached)
      ? cached
      : buildSyntheticAlternatives({
          origin: normalizedOrigin,
          destination: normalizedDestination,
          departureDate: resolvedDepartureDate,
          returnDate: resolvedReturnDate,
          basePrice: price
        });

  if (!cached && resolved.length > 0) writeCachedAlternatives(key, resolved);
  const alternatives = resolved.slice(0, maxByPlan);
  const payload = buildSmartDeparturePayload({ origin: normalizedOrigin, basePrice: price, alternatives });
  const summary = buildLocalizedSummary(payload.bestAlternative, locale);
  return { ...payload, summaryMessage: summary, summary };
}

export { STRATEGIC_AIRPORTS, MIN_SAVING_ABS_EUR, MIN_SAVING_PCT, MAX_ALTERNATIVES };
