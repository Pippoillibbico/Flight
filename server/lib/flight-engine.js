import { differenceInCalendarDays, getDay, parseISO } from 'date-fns';
import { DESTINATIONS } from '../data/flights-data.js';

const MOOD_WEIGHTS = {
  relax: { price: 0.2, climate: 0.26, crowding: 0.2, trend: 0.1, pace: 0.12, comfort: 0.12 },
  natura: { price: 0.18, climate: 0.25, crowding: 0.22, trend: 0.1, pace: 0.1, comfort: 0.15 },
  party: { price: 0.28, climate: 0.14, crowding: 0.06, trend: 0.16, pace: 0.14, comfort: 0.22 },
  cultura: { price: 0.24, climate: 0.18, crowding: 0.14, trend: 0.12, pace: 0.12, comfort: 0.2 },
  avventura: { price: 0.2, climate: 0.2, crowding: 0.14, trend: 0.14, pace: 0.14, comfort: 0.18 }
};

const DESTINATION_DATA = {
  LIS: { dailyCost: 72, baseCrowding: 56, overTourism: 41, seasonality: 78, trendBias: -0.04, climateTemp: 22, climateRain: 22 },
  ATH: { dailyCost: 69, baseCrowding: 67, overTourism: 62, seasonality: 76, trendBias: 0.08, climateTemp: 25, climateRain: 12 },
  VLC: { dailyCost: 66, baseCrowding: 62, overTourism: 47, seasonality: 79, trendBias: -0.02, climateTemp: 24, climateRain: 17 },
  MLA: { dailyCost: 75, baseCrowding: 61, overTourism: 53, seasonality: 77, trendBias: 0.03, climateTemp: 26, climateRain: 11 },
  PRG: { dailyCost: 58, baseCrowding: 49, overTourism: 33, seasonality: 72, trendBias: -0.01, climateTemp: 19, climateRain: 28 }
};

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function destinationMatchesQuery(destination, query) {
  if (!query) return true;
  const needle = normalizeText(query);
  if (!needle) return true;

  const haystack = [
    destination.city,
    destination.iata,
    destination.country,
    destination.area,
    ...(destination.keywords || [])
  ]
    .map((part) => normalizeText(part))
    .join(' ');

  return haystack.includes(needle);
}

function destinationMatchesCountry(destination, country) {
  if (!country) return true;
  const needle = normalizeText(country);
  const haystack = normalizeText(destination.country);
  return haystack.includes(needle) || needle.includes(haystack);
}

function seededPrice(basePrice, fromCode, toCode, travelDate, returnDate, travellers, cabinClass) {
  const str = `${fromCode}-${toCode}-${travelDate}-${returnDate}-${cabinClass}`;
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) hash = (hash * 31 + str.charCodeAt(i)) % 9973;
  const variation = (hash % 140) - 70;
  const cabinFactor = cabinClass === 'business' ? 2.1 : cabinClass === 'premium' ? 1.5 : 1;
  return Math.max(40, Math.round((basePrice + variation) * travellers * cabinFactor));
}

function seededInt(seed, modulo) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 104729;
  return hash % modulo;
}

function buildRouteVariants(destination, origin, dateFrom, dateTo, travellers, cabinClass) {
  const seed = `${origin}-${destination.iata}-${dateFrom}-${dateTo}-${cabinClass}`;
  const baseDuration = Math.max(2, Math.round(destination.basePrice / 90));
  const oneStopDelta = seededInt(`${seed}-one`, 80) - 40;
  const twoStopDelta = seededInt(`${seed}-two`, 120) - 60;

  const directBase = Math.max(40, destination.basePrice + 35);
  const oneStopBase = Math.max(40, destination.basePrice + oneStopDelta);
  const twoStopBase = Math.max(40, destination.basePrice - 25 + twoStopDelta);

  return [
    { stopCount: 0, base: directBase, durationHours: baseDuration + 1, routeType: 'direct' },
    { stopCount: 1, base: oneStopBase, durationHours: baseDuration + 3, routeType: 'one_stop' },
    { stopCount: 2, base: twoStopBase, durationHours: baseDuration + 6, routeType: 'multi_stop' }
  ].map((variant) => ({
    ...variant,
    price: seededPrice(variant.base, origin, destination.iata, dateFrom, dateTo, travellers, cabinClass),
    durationHours: Math.round(variant.durationHours * 10) / 10
  }));
}

function formatStops(stopCount) {
  if (stopCount === 0) return 'Direct';
  if (stopCount === 1) return '1 stop';
  return `${stopCount} stops`;
}

function computeComfortScore({ stopCount, durationHours, price, avg2024 }) {
  const stopPenalty = stopCount * 24;
  const durationPenalty = Math.max(0, durationHours - 3) * 4.5;
  const priceBonus = avg2024 > 0 ? ((avg2024 - price) / avg2024) * 30 : 0;
  const score = 100 - stopPenalty - durationPenalty + priceBonus;
  return Math.max(1, Math.min(100, Math.round(score)));
}

function formatHour(hour) {
  const safe = ((hour % 24) + 24) % 24;
  return `${String(safe).padStart(2, '0')}:00`;
}

export function buildBookingLink({ origin, destinationIata, dateFrom, dateTo, travellers, cabinClass }) {
  const base = String(process.env.BOOKING_BASE_URL || 'https://booking.travel-decision-engine.com/search');
  const url = new URL(base);
  url.searchParams.set('origin', origin);
  url.searchParams.set('destination', destinationIata);
  url.searchParams.set('dateFrom', dateFrom);
  url.searchParams.set('dateTo', dateTo);
  url.searchParams.set('travellers', String(travellers));
  url.searchParams.set('cabin', cabinClass);
  return url.toString();
}

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function climateFitScore(preference, tempC, rainProb) {
  const fit =
    preference === 'warm'
      ? 100 - Math.abs(tempC - 27) * 7
      : preference === 'cold'
      ? 100 - Math.abs(tempC - 8) * 7
      : preference === 'mild'
      ? 100 - Math.abs(tempC - 21) * 7
      : 82;
  return clamp(fit * 0.72 + (100 - rainProb) * 0.28);
}

function trendScore(trendBias) {
  return clamp(62 - trendBias * 100);
}

function paceScore(pace, crowding) {
  if (pace === 'slow') return clamp(100 - crowding * 0.85);
  if (pace === 'fast') return clamp(60 + (100 - crowding) * 0.25);
  return clamp(72 + (100 - crowding) * 0.12);
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
  travellers,
  cabinClass
}) {
  const fromDate = parseISO(dateFrom);
  const toDate = parseISO(dateTo);
  const stayDays = differenceInCalendarDays(toDate, fromDate);

  const isEuropeWeekendRule =
    getDay(fromDate) === 5 && getDay(toDate) === 1 && fromDate.getFullYear() <= 2030 && toDate.getFullYear() <= 2030;

  const isAsiaLongStayRule = region === 'asia' && stayDays >= 20;

  let list = DESTINATIONS.filter((d) => region === 'all' || d.region === region);
  list = list.filter((d) => destinationMatchesCountry(d, country));
  list = list.filter((d) => destinationMatchesQuery(d, destinationQuery));

  if (isEuropeWeekendRule) {
    list = list.filter((d) => d.region === 'eu');
  }

  if (isAsiaLongStayRule) {
    list = list.filter((d) => d.region === 'asia');
  }

  let flights = list.flatMap((d) => {
    const avg2024 = Math.round(d.avg2024 * travellers);
    const highSeasonAvg = Math.round(d.highSeasonAvg * travellers);
    const bookingLink = buildBookingLink({
      origin,
      destinationIata: d.iata,
      dateFrom,
      dateTo,
      travellers,
      cabinClass
    });

    return buildRouteVariants(d, origin, dateFrom, dateTo, travellers, cabinClass).map((variant) => {
      const cheaperThan2024 = variant.price < avg2024;
      const cheaperThanHighSeason = variant.price < highSeasonAvg;
      const departureHour = seededInt(`${origin}-${d.iata}-${dateFrom}-${variant.stopCount}-dep`, 24);
      const arrivalHour = Math.round((departureHour + variant.durationHours) % 24);
      const isNightFlight = departureHour >= 22 || departureHour <= 5;
      const comfortScore = computeComfortScore({
        stopCount: variant.stopCount,
        durationHours: variant.durationHours,
        price: variant.price,
        avg2024
      });
      return {
        id: `${origin}-${d.iata}-${dateFrom}-${dateTo}-${travellers}-${cabinClass}-${variant.stopCount}`,
        origin,
        destination: d.city,
        destinationIata: d.iata,
        region: d.region,
        area: d.area,
        climate: d.climate,
        price: variant.price,
        avg2024,
        highSeasonAvg,
        cheaperThan2024,
        cheaperThanHighSeason,
        savingVs2024: avg2024 - variant.price,
        stopCount: variant.stopCount,
        stopLabel: formatStops(variant.stopCount),
        isDirect: variant.stopCount === 0,
        durationHours: variant.durationHours,
        departureHour,
        arrivalHour,
        departureTimeLabel: formatHour(departureHour),
        arrivalTimeLabel: formatHour(arrivalHour),
        isNightFlight,
        comfortScore,
        routeType: variant.routeType,
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

  if (Number.isFinite(maxStops)) {
    flights = flights.filter((f) => f.stopCount <= maxStops);
  }

  if (travelTime === 'day') {
    flights = flights.filter((f) => !f.isNightFlight);
  } else if (travelTime === 'night') {
    flights = flights.filter((f) => f.isNightFlight);
  }

  if (Number.isFinite(minComfortScore)) {
    flights = flights.filter((f) => f.comfortScore >= minComfortScore);
  }

  if (cheapOnly) {
    flights = flights.filter((f) => f.cheaperThan2024 && f.cheaperThanHighSeason);
  }

  if (Number.isFinite(maxBudget) && maxBudget > 0) {
    flights = flights.filter((f) => f.price <= maxBudget);
  }

  flights.sort((a, b) => b.savingVs2024 - a.savingVs2024);

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
      stayDays,
      isEuropeWeekendRule,
      isAsiaLongStayRule,
      count: flights.length
    },
    alerts,
    flights
  };
}

export function decideTrips({
  origin,
  region = 'all',
  country,
  dateFrom,
  dateTo,
  tripLengthDays,
  budgetMax,
  travellers = 1,
  cabinClass = 'economy',
  mood = 'relax',
  climatePreference = 'indifferent',
  pace = 'normal',
  avoidOvertourism = false,
  packageCount = 3
}) {
  const safeMood = String(mood || 'relax').toLowerCase();
  const safePreference = String(climatePreference || 'indifferent').toLowerCase();
  const safePace = String(pace || 'normal').toLowerCase();
  const weights = MOOD_WEIGHTS[safeMood] || MOOD_WEIGHTS.relax;

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

  const groupedByDestination = new Map();
  for (const flight of baseSearch.flights || []) {
    const prev = groupedByDestination.get(flight.destinationIata);
    if (!prev || flight.price < prev.price) groupedByDestination.set(flight.destinationIata, flight);
  }

  const safePackageCount = packageCount === 4 ? 4 : 3;

  const candidates = Array.from(groupedByDestination.values())
    .map((flight) => {
      const extra = DESTINATION_DATA[flight.destinationIata] || {
        dailyCost: 70,
        baseCrowding: 55,
        overTourism: 45,
        seasonality: 74,
        trendBias: 0,
        climateTemp: 22,
        climateRain: 20
      };

      const hotelEstimate = Math.round((extra.dailyCost * 0.95 + 18) * tripLengthDays);
      const dailyCost = Math.round(extra.dailyCost * travellers);
      const buffer = Math.round((flight.price + hotelEstimate + dailyCost * tripLengthDays) * 0.1);
      const totalCost = flight.price + hotelEstimate + dailyCost * tripLengthDays + buffer;

      const priceNorm = clamp(100 - (totalCost / Math.max(1, budgetMax)) * 100);
      const climateNorm = climateFitScore(safePreference, extra.climateTemp, extra.climateRain);
      const crowdingNorm = clamp(100 - extra.baseCrowding);
      const trendNorm = trendScore(extra.trendBias);
      const paceNorm = paceScore(safePace, extra.baseCrowding);
      const comfortNorm = clamp(flight.comfortScore);

      let score =
        priceNorm * weights.price +
        climateNorm * weights.climate +
        crowdingNorm * weights.crowding +
        trendNorm * weights.trend +
        paceNorm * weights.pace +
        comfortNorm * weights.comfort;

      if (avoidOvertourism && extra.overTourism > 65) score -= 10;
      if (totalCost > budgetMax) score -= 8;
      if (priceNorm > 70 && climateNorm > 74 && crowdingNorm > 58) score += 5;

      score = clamp(Math.round(score * 10) / 10);

      const reasons = [
        { text: 'Costo totale competitivo sul tuo budget.', value: priceNorm },
        { text: 'Clima favorevole nel periodo selezionato.', value: climateNorm },
        { text: 'Affollamento gestibile per il tipo di viaggio.', value: crowdingNorm },
        { text: 'Trend prezzo stabile o in miglioramento.', value: trendNorm },
        { text: 'Esperienza di viaggio coerente con il ritmo scelto.', value: paceNorm }
      ]
        .sort((a, b) => b.value - a.value)
        .slice(0, 3)
        .map((x) => x.text);

      return {
        ...flight,
        travelScore: score,
        trendScore: trendNorm,
        climateInPeriod: {
          avgTempC: extra.climateTemp,
          rainProb: extra.climateRain,
          comfort: climateNorm > 75 ? 'high' : climateNorm > 55 ? 'medium' : 'low'
        },
        crowding: {
          index: extra.baseCrowding,
          overTourism: extra.overTourism,
          seasonality: extra.seasonality
        },
        costBreakdown: {
          flight: flight.price,
          hotelEstimate,
          dailyCost: dailyCost * tripLengthDays,
          buffer,
          total: totalCost
        },
        reasons
      };
    })
    .filter((item) => item.costBreakdown.total <= budgetMax * 1.15)
    .sort((a, b) => b.travelScore - a.travelScore || a.costBreakdown.total - b.costBreakdown.total)
    .slice(0, safePackageCount);

  return {
    meta: {
      count: candidates.length,
      origin,
      budgetMax,
      tripLengthDays,
      packageCount: safePackageCount
    },
    recommendations: candidates
  };
}

export function getDestinationSuggestions({ query, region = 'all', country, limit = 8 }) {
  const q = normalizeText(query);
  if (!q || q.length < 2) return [];

  const seen = new Set();
  const out = [];

  for (const d of DESTINATIONS) {
    if (region !== 'all' && d.region !== region) continue;
    if (!destinationMatchesCountry(d, country)) continue;
    if (!destinationMatchesQuery(d, q)) continue;

    const candidates = [
      { type: 'city', value: d.city, label: `${d.city} (${d.country})` },
      { type: 'country', value: d.country, label: `${d.country}` },
      { type: 'iata', value: d.iata, label: `${d.iata} (${d.city})` }
    ];

    for (const c of candidates) {
      const key = `${c.type}:${normalizeText(c.value)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
      if (out.length >= limit) return out;
    }
  }

  return out;
}
