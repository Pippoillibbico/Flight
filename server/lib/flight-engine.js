import { differenceInCalendarDays, getDay, parseISO } from 'date-fns';
import { ROUTES } from '../data/local-flight-data.js';
import { detectDeal } from './deal-detector.js';
import { logger } from './logger.js';
import { buildAffiliateLink } from './affiliate-links.js';

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function seededInt(seed, modulo) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 104729;
  return hash % modulo;
}

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function mean(values) {
  const list = values.filter((v) => Number.isFinite(v));
  if (list.length === 0) return 0;
  return list.reduce((sum, v) => sum + v, 0) / list.length;
}

function destinationMatchesQuery(route, query) {
  if (!query) return true;
  const needle = normalizeText(query);
  if (!needle) return true;
  const haystack = [
    route.destinationName,
    route.destinationIata,
    route.country,
    route.region,
    ...(route.keywords || [])
  ]
    .map((part) => normalizeText(part))
    .join(' ');
  return haystack.includes(needle);
}

function destinationMatchesCountry(route, country) {
  if (!country) return true;
  const needle = normalizeText(country);
  const haystack = normalizeText(route.country);
  return haystack.includes(needle) || needle.includes(haystack);
}

function formatStops(stopCount) {
  if (stopCount === 0) return 'Direct';
  if (stopCount === 1) return '1 stop';
  return `${stopCount} stops`;
}

function formatHour(hour) {
  const safe = ((hour % 24) + 24) % 24;
  return `${String(safe).padStart(2, '0')}:00`;
}

function getMonthBand(route, month) {
  const bands = route.seasonalPriceBands || {};
  return bands[String(month)] || bands['1'] || { avgPrice: 200, low: 160, high: 260 };
}

function getStopWeights(route) {
  const dist = route.comfortMetadata?.stopCountDistribution || {};
  const direct = Number(dist[0]) || 0.34;
  const oneStop = Number(dist[1]) || 0.46;
  const twoStop = Number(dist[2]) || 0.2;
  const total = Math.max(0.01, direct + oneStop + twoStop);
  return { direct: direct / total, oneStop: oneStop / total, twoStop: twoStop / total };
}

export function computeAvg2024(route) {
  const bands = route.seasonalPriceBands || {};
  const monthly = [];
  for (let month = 1; month <= 12; month += 1) {
    const avgPrice = Number(bands[String(month)]?.avgPrice);
    if (Number.isFinite(avgPrice)) monthly.push(avgPrice);
  }
  return Math.round(mean(monthly));
}

export function computeHighSeasonAvg(route) {
  const months = route.seasonality?.highSeasonMonths || [];
  const values = months.map((month) => Number(route.seasonalPriceBands?.[String(month)]?.avgPrice));
  return Math.round(mean(values.length > 0 ? values : [computeAvg2024(route)]));
}

export function computeSavingVs2024(price, avg2024) {
  return Math.round((Number(avg2024) || 0) - (Number(price) || 0));
}

export function computeComfortScore({ stopCount, isNightFlight, departureHour, route }) {
  const weights = getStopWeights(route);
  const stopComponent =
    stopCount === 0 ? 100 * weights.direct : stopCount === 1 ? 100 * weights.oneStop * 0.86 : 100 * weights.twoStop * 0.68;
  const nightBias = Number(route?.comfortMetadata?.nightFlightProbability || 0.25);
  const nightPenalty = isNightFlight ? (12 + nightBias * 16) : 0;
  const departureComfort =
    departureHour >= 6 && departureHour <= 10 ? 10 : departureHour >= 11 && departureHour <= 18 ? 6 : departureHour >= 19 && departureHour <= 22 ? 2 : -6;
  const score = stopComponent + departureComfort + 22 - nightPenalty;
  return Math.round(clamp(score, 1, 100));
}

function buildRouteVariants(route, origin, dateFrom, dateTo, travellers, cabinClass, month) {
  const band = getMonthBand(route, month);
  const base = Number(band.avgPrice || 200);
  const travellerFactor = Math.max(1, Number(travellers) || 1);
  const cabinFactor = cabinClass === 'business' ? 2.1 : cabinClass === 'premium' ? 1.45 : 1;
  const seed = `${origin}-${route.destinationIata}-${dateFrom}-${dateTo}-${travellerFactor}-${cabinClass}`;
  const weights = getStopWeights(route);

  return [0, 1, 2].map((stopCount) => {
    const distributionFactor = stopCount === 0 ? 1 + (1 - weights.direct) * 0.1 : stopCount === 1 ? 1 - weights.oneStop * 0.08 : 1 - weights.twoStop * 0.15;
    const stopFactor = stopCount === 0 ? 1.06 : stopCount === 1 ? 1 : 0.93;
    const jitter = seededInt(`${seed}-${stopCount}`, 31) - 15;
    const unitPrice = Math.max(40, Math.round(base * distributionFactor * stopFactor + jitter));
    const price = Math.round(unitPrice * travellerFactor * cabinFactor);
    const departureWindow = route.comfortMetadata?.typicalDepartureWindow || { startHour: 6, endHour: 22 };
    const span = Math.max(1, Number(departureWindow.endHour) - Number(departureWindow.startHour) + 1);
    const departureHour = Number(departureWindow.startHour) + seededInt(`${seed}-${stopCount}-dep`, span);
    const isNightByHour = departureHour >= 22 || departureHour <= 5;
    const isNightByProb = seededInt(`${seed}-${stopCount}-night`, 100) < Math.round(Number(route.comfortMetadata?.nightFlightProbability || 0.25) * 100);
    const isNightFlight = isNightByHour || isNightByProb;

    return {
      stopCount,
      stopLabel: formatStops(stopCount),
      price,
      departureHour,
      departureTimeLabel: formatHour(departureHour),
      isNightFlight
    };
  });
}

export function buildBookingLink({ origin, destinationIata, dateFrom, dateTo, travellers, cabinClass, partner }) {
  const { url } = buildAffiliateLink({ origin, destinationIata, dateFrom, dateTo, travellers, cabinClass, partner });
  return url;
}

export function searchFlights({
  origin,
  region,
  country,
  destinationQuery,
  dateFrom,
  dateTo,
  cheapOnly,
  maxBudget,
  connectionType = 'all',
  maxStops,
  travelTime = 'all',
  minComfortScore,
  travellers = 1,
  cabinClass = 'economy'
}) {
  const fromDate = parseISO(dateFrom);
  const toDate = dateTo ? parseISO(dateTo) : null;
  const isRoundTrip = Boolean(dateTo);
  const stayDays = toDate ? differenceInCalendarDays(toDate, fromDate) : 0;
  const month = fromDate.getMonth() + 1;

  const isEuropeWeekendRule =
    Boolean(toDate) && getDay(fromDate) === 5 && getDay(toDate) === 1 && fromDate.getFullYear() <= 2030 && toDate.getFullYear() <= 2030;
  const isAsiaLongStayRule = region === 'asia' && stayDays >= 20;

  const safeOrigin = String(origin || '').toUpperCase().trim();
  let list = ROUTES.filter((r) => !safeOrigin || r.origin === safeOrigin);
  list = list.filter((r) => region === 'all' || !region || r.region === region);
  list = list.filter((r) => destinationMatchesCountry(r, country));
  list = list.filter((r) => destinationMatchesQuery(r, destinationQuery));

  if (isEuropeWeekendRule) list = list.filter((r) => r.region === 'eu');
  if (isAsiaLongStayRule) list = list.filter((r) => r.region === 'asia');

  let flights = list.flatMap((route) => {
    const avg2024 = Math.round(computeAvg2024(route) * travellers);
    const highSeasonAvg = Math.round(computeHighSeasonAvg(route) * travellers);
    const bookingLink = buildBookingLink({
      origin: route.origin,
      destinationIata: route.destinationIata,
      dateFrom,
      dateTo,
      travellers,
      cabinClass
    });

    return buildRouteVariants(route, route.origin, dateFrom, dateTo, travellers, cabinClass, month).map((variant) => {
      const comfortScore = computeComfortScore({
        stopCount: variant.stopCount,
        isNightFlight: variant.isNightFlight,
        departureHour: variant.departureHour,
        route
      });
      const savingVs2024 = computeSavingVs2024(variant.price, avg2024);

      return {
        id: `${route.origin}-${route.destinationIata}-${dateFrom}-${dateTo || 'ow'}-${travellers}-${cabinClass}-${variant.stopCount}`,
        origin: route.origin,
        destination: route.destinationName,
        destinationIata: route.destinationIata,
        tripType: isRoundTrip ? 'round_trip' : 'one_way',
        isBookable: false,
        inventorySource: 'synthetic_local_model',
        region: route.region,
        area: route.decisionMetadata?.area || route.region,
        climate: route.decisionMetadata?.climateProfile || 'mixed',
        country: route.country,
        price: variant.price,
        avg2024,
        highSeasonAvg,
        cheaperThan2024: variant.price < avg2024,
        cheaperThanHighSeason: variant.price < highSeasonAvg,
        savingVs2024,
        stopCount: variant.stopCount,
        stopLabel: variant.stopLabel,
        isDirect: variant.stopCount === 0,
        departureHour: variant.departureHour,
        departureTimeLabel: variant.departureTimeLabel,
        isNightFlight: variant.isNightFlight,
        comfortScore,
        link: bookingLink,
        bookingLink
      };
    });
  });

  if (connectionType === 'direct') {
    flights = flights.filter((f) => f.stopCount === 0);
  } else if (connectionType === 'with_stops') {
    flights = flights.filter((f) => f.stopCount > 0);
  }

  if (Number.isFinite(maxStops)) flights = flights.filter((f) => f.stopCount <= maxStops);
  if (travelTime === 'day') flights = flights.filter((f) => !f.isNightFlight);
  if (travelTime === 'night') flights = flights.filter((f) => f.isNightFlight);
  if (Number.isFinite(minComfortScore)) flights = flights.filter((f) => f.comfortScore >= minComfortScore);
  if (cheapOnly) flights = flights.filter((f) => f.cheaperThan2024 && f.cheaperThanHighSeason);
  if (Number.isFinite(maxBudget) && maxBudget > 0) flights = flights.filter((f) => f.price <= maxBudget);

  flights.sort((a, b) => a.price - b.price || b.savingVs2024 - a.savingVs2024 || a.id.localeCompare(b.id));

  const alerts = flights
    .filter((f) => f.area === 'japan' || f.area === 'sea')
    .map((f) => ({
      id: `alert-${f.id}`,
      destination: f.destination,
      cheaperThan2024: f.cheaperThan2024,
      message: `${f.destination}: price ${f.cheaperThan2024 ? 'below' : 'above'} 2024 average (${f.price} vs ${f.avg2024}), ${f.climate}.`
    }));

  return {
    meta: {
      tripType: isRoundTrip ? 'round_trip' : 'one_way',
      inventorySource: 'synthetic_local_model',
      stayDays,
      isEuropeWeekendRule,
      isAsiaLongStayRule,
      count: flights.length
    },
    alerts,
    flights
  };
}

function climateScore(preference, climateProfile) {
  const pref = normalizeText(preference || 'indifferent');
  const profile = normalizeText(climateProfile || 'mixed');
  if (pref === 'indifferent') return 76;
  if (pref === 'warm') return profile === 'warm' ? 95 : profile === 'mild' || profile === 'mixed' ? 78 : 55;
  if (pref === 'cold') return profile === 'cold' ? 95 : profile === 'mild' || profile === 'mixed' ? 76 : 52;
  if (pref === 'mild') return profile === 'mild' ? 94 : profile === 'mixed' ? 82 : 64;
  return 72;
}

function paceScore(pace, paceProfile) {
  const target = normalizeText(pace || 'normal');
  const profile = normalizeText(paceProfile || 'normal');
  if (target === profile) return 92;
  if ((target === 'slow' && profile === 'normal') || (target === 'normal' && profile === 'slow')) return 75;
  if ((target === 'fast' && profile === 'normal') || (target === 'normal' && profile === 'fast')) return 78;
  return 58;
}

export function decideTrips({
  origin,
  region = 'all',
  country,
  dateFrom,
  dateTo,
  tripLengthDays,
  budget,
  budgetMax,
  travellers = 1,
  cabinClass = 'economy',
  climatePreference = 'indifferent',
  pace = 'normal',
  avoidOvertourism = false,
  packageCount = 3
}) {
  const budgetCap = Number.isFinite(Number(budget)) ? Number(budget) : Number(budgetMax);
  const safeBudget = Number.isFinite(budgetCap) && budgetCap > 0 ? budgetCap : 1200;
  const safeDays = Math.max(1, Number(tripLengthDays) || 5);
  const safePackages = packageCount === 4 ? 4 : 3;

  const baseSearch = searchFlights({
    origin,
    region,
    country,
    destinationQuery: '',
    dateFrom,
    dateTo,
    cheapOnly: false,
    maxBudget: undefined,
    connectionType: 'all',
    maxStops: 2,
    travelTime: 'all',
    minComfortScore: undefined,
    travellers,
    cabinClass
  });

  const bestByDestination = new Map();
  for (const flight of baseSearch.flights) {
    const previous = bestByDestination.get(flight.destinationIata);
    if (!previous || flight.price < previous.price) bestByDestination.set(flight.destinationIata, flight);
  }

  const recommendations = Array.from(bestByDestination.values())
    .map((flight) => {
      const route = ROUTES.find((r) => r.origin === flight.origin && r.destinationIata === flight.destinationIata);
      const decision = route?.decisionMetadata || {};
      const overtourism = Number(decision.overtourismIndex || 50);
      const estimatedDaily = 58 + Math.round((overtourism / 100) * 38);
      const groundCost = estimatedDaily * safeDays * Math.max(1, travellers);
      const totalCost = flight.price + groundCost;
      const budgetScore = clamp(100 - (totalCost / safeBudget) * 100);
      const cScore = climateScore(climatePreference, decision.climateProfile);
      const pScore = paceScore(pace, decision.paceProfile);
      const overtourismScore = clamp(100 - overtourism);
      let travelScore = budgetScore * 0.34 + cScore * 0.24 + pScore * 0.2 + overtourismScore * 0.1 + clamp(flight.comfortScore) * 0.12;
      if (avoidOvertourism && overtourism > 65) travelScore -= 14;
      if (totalCost > safeBudget) travelScore -= 10;
      travelScore = Math.round(clamp(travelScore) * 10) / 10;

      return {
        ...flight,
        travelScore,
        climateInPeriod: {
          preference: climatePreference,
          profile: decision.climateProfile || 'mixed'
        },
        crowding: {
          overTourism: overtourism
        },
        costBreakdown: {
          flight: flight.price,
          groundEstimate: groundCost,
          total: totalCost
        },
        reasons: [
          budgetScore >= 60 ? 'Compatibile con il budget impostato.' : 'Prezzo vicino al limite del budget.',
          cScore >= 75 ? 'Clima coerente con la tua preferenza.' : 'Clima meno allineato alla preferenza.',
          pScore >= 75 ? 'Ritmo del viaggio adatto al profilo selezionato.' : 'Ritmo meno adatto al profilo selezionato.'
        ]
      };
    })
    .filter((item) => item.costBreakdown.total <= safeBudget * 1.2)
    .sort((a, b) => b.travelScore - a.travelScore || a.price - b.price)
    .slice(0, safePackages);

  return {
    meta: {
      count: recommendations.length,
      origin,
      budgetMax: safeBudget,
      tripLengthDays: safeDays,
      packageCount: safePackages
    },
    recommendations
  };
}

export function getDestinationSuggestions({ query, region = 'all', country, limit = 8 }) {
  const q = normalizeText(query);
  if (!q || q.length < 2) return [];

  const seen = new Set();
  const out = [];
  for (const route of ROUTES) {
    if (region !== 'all' && route.region !== region) continue;
    if (!destinationMatchesCountry(route, country)) continue;
    if (!destinationMatchesQuery(route, q)) continue;

    const candidates = [
      { type: 'city', value: route.destinationName, label: `${route.destinationName} (${route.country})` },
      { type: 'country', value: route.country, label: route.country },
      { type: 'iata', value: route.destinationIata, label: `${route.destinationIata} (${route.destinationName})` }
    ];

    for (const candidate of candidates) {
      const key = `${candidate.type}:${normalizeText(candidate.value)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(candidate);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export async function searchFlightsWithIntelligence(input, { includeIntelligence = true, maxDeals = 24 } = {}) {
  const base = searchFlights(input);
  if (!includeIntelligence || !Array.isArray(base?.flights) || base.flights.length === 0) {
    return {
      ...base,
      intelligence: {
        enabled: false,
        processed: 0
      }
    };
  }

  const safeMaxDeals = Math.max(1, Math.min(60, Number(maxDeals) || 24));
  const rankedBySavings = [...base.flights].sort((a, b) => b.savingVs2024 - a.savingVs2024);
  const candidateIds = new Set(rankedBySavings.slice(0, safeMaxDeals).map((f) => f.id));

  const enrichedFlights = await Promise.all(
    base.flights.map(async (flight) => {
      if (!candidateIds.has(flight.id)) return { ...flight };
      try {
        const deal = await detectDeal({
          origin: flight.origin,
          destination: flight.destinationIata,
          date: input.dateFrom,
          price: flight.price
        });
        return {
          ...flight,
          intelligence: {
            deal_score: deal.deal_score,
            deal_type: deal.deal_type,
            confidence: deal.confidence,
            deviation_pct: Number(deal?.deviation?.percent || 0)
          }
        };
      } catch (error) {
        logger.warn({ err: error, flightId: flight.id }, 'search_intelligence_enrichment_failed');
        return { ...flight };
      }
    })
  );

  const dealCount = enrichedFlights.filter((f) => Number.isFinite(f?.intelligence?.deal_score)).length;
  return {
    ...base,
    flights: enrichedFlights,
    intelligence: {
      enabled: true,
      processed: dealCount
    }
  };
}

export async function decideTripsWithIntelligence(input, options = {}) {
  const base = decideTrips(input);
  if (!Array.isArray(base?.recommendations) || base.recommendations.length === 0) return base;
  const safeDate = String(input?.dateFrom || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const recommendations = await Promise.all(
    base.recommendations.map(async (item) => {
      try {
        const deal = await detectDeal({
          origin: item.origin,
          destination: item.destinationIata,
          date: safeDate,
          price: item.price
        });
        return {
          ...item,
          intelligence: {
            deal_score: deal.deal_score,
            deal_type: deal.deal_type,
            confidence: deal.confidence
          }
        };
      } catch (error) {
        logger.warn({ err: error, destinationIata: item.destinationIata }, 'trip_intelligence_enrichment_failed');
        return item;
      }
    })
  );
  return {
    ...base,
    recommendations,
    intelligence: {
      enabled: options?.includeIntelligence !== false,
      processed: recommendations.filter((r) => Number.isFinite(r?.intelligence?.deal_score)).length
    }
  };
}
