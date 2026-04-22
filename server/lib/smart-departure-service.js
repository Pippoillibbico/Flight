import { searchFlights } from './flight-engine.js';

const STRATEGIC_AIRPORTS = ['MXP', 'BGY', 'VIE', 'BUD', 'BCN'];
const MIN_ABS_SAVING_EUR = 60;
const MIN_PCT_SAVING = 12;
const DISCARD_BELOW_EUR = 20;

function safeUpper(value) {
  return String(value || '').trim().toUpperCase();
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function buildLabel(index, savingAbs) {
  if (index === 0) return 'Best saving';
  if (savingAbs >= 150) return 'High impact';
  return 'Quick win';
}

function buildSummaryMessage(best, locale = 'en') {
  if (!best) return '';
  if (locale === 'it') {
    return `Partendo da ${best.originIata} risparmi circa ${best.savingAbs}€.`;
  }
  return `Starting from ${best.originIata} saves about €${best.savingAbs}.`;
}

function resolveVisibleLimit(planId) {
  if (planId === 'free') return 2;
  if (planId === 'creator' || planId === 'pro') return 3;
  return 1;
}

export async function getSmartDeparture({
  userPlan = 'free',
  locale = 'en',
  primaryFlight,
  searchInput
}) {
  const primaryPrice = toNumber(primaryFlight?.price);
  const destinationIata = safeUpper(primaryFlight?.destinationIata || searchInput?.destinationIata || searchInput?.destinationQuery);
  const primaryOrigin = safeUpper(primaryFlight?.origin || searchInput?.origin);
  if (!primaryPrice || !destinationIata || !primaryOrigin) {
    return { enabled: false, alternatives: [], bestAlternative: null, summaryMessage: '' };
  }

  const candidateOrigins = STRATEGIC_AIRPORTS.filter((iata) => iata !== primaryOrigin);
  const baseQuery = {
    origin: primaryOrigin,
    region: searchInput?.region || 'all',
    country: searchInput?.country,
    destinationQuery: destinationIata,
    dateFrom: searchInput?.dateFrom,
    dateTo: searchInput?.dateTo,
    cheapOnly: false,
    maxBudget: undefined,
    connectionType: searchInput?.connectionType || 'all',
    maxStops: searchInput?.maxStops,
    travelTime: searchInput?.travelTime || 'all',
    minComfortScore: searchInput?.minComfortScore,
    travellers: searchInput?.travellers || 1,
    cabinClass: searchInput?.cabinClass || 'economy'
  };

  const alternatives = candidateOrigins
    .map((originIata) => {
      const result = searchFlights({ ...baseQuery, origin: originIata });
      const best = (result?.flights || []).find((flight) => safeUpper(flight.destinationIata) === destinationIata);
      if (!best) return null;
      const altPrice = toNumber(best.price);
      const savingAbs = Math.round(primaryPrice - altPrice);
      const savingPct = primaryPrice > 0 ? Math.round((savingAbs / primaryPrice) * 100) : 0;
      if (savingAbs < DISCARD_BELOW_EUR) return null;
      if (savingAbs < MIN_ABS_SAVING_EUR && savingPct < MIN_PCT_SAVING) return null;
      return {
        originIata,
        price: altPrice,
        savingAbs,
        savingPct,
        stopCount: Number.isFinite(best.stopCount) ? best.stopCount : null,
        comfortScore: Number.isFinite(best.comfortScore) ? best.comfortScore : null,
        label: 'candidate',
        bookingLink: best.bookingLink || best.link || null
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.savingAbs - a.savingAbs || b.savingPct - a.savingPct || a.price - b.price)
    .slice(0, 5)
    .map((item, index) => ({ ...item, label: buildLabel(index, item.savingAbs) }));

  const visibleLimit = resolveVisibleLimit(userPlan);
  const visibleAlternatives = alternatives.slice(0, visibleLimit);
  const bestAlternative = visibleAlternatives[0] || null;

  return {
    enabled: visibleAlternatives.length > 0,
    primaryOffer: {
      originIata: primaryOrigin,
      price: primaryPrice
    },
    alternatives: visibleAlternatives,
    bestAlternative,
    summaryMessage: buildSummaryMessage(bestAlternative, locale),
    meta: {
      candidateOrigins,
      visibleLimit,
      totalAlternatives: alternatives.length,
      thresholds: {
        minAbsSavingEur: MIN_ABS_SAVING_EUR,
        minPctSaving: MIN_PCT_SAVING
      }
    }
  };
}
