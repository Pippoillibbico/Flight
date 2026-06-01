import { expandCityCode, getBridgeAirports } from './bridge-airports.js';

function readLimit(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function getTriangulationLimits(overrides = {}) {
  return {
    maxBridges: Math.max(1, Number(overrides.maxBridges) || readLimit('TRIANGULATION_MAX_BRIDGES', 20)),
    maxCombinations: Math.max(1, Number(overrides.maxCombinations) || readLimit('TRIANGULATION_MAX_COMBINATIONS', 80)),
    maxDates: Math.max(1, Number(overrides.maxDates) || readLimit('TRIANGULATION_MAX_DATES', 10)),
    maxResults: Math.max(1, Number(overrides.maxResults) || readLimit('TRIANGULATION_MAX_RESULTS', 10))
  };
}

export function generateDateWindows(period, { maxDates = 10 } = {}) {
  if (!period) return [];
  if (period.type === 'date_range') {
    const from = new Date(`${period.from}T00:00:00Z`);
    const to = new Date(`${period.to}T00:00:00Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return [];
    const days = [];
    for (let cursor = from; cursor <= to && days.length < maxDates; cursor = new Date(cursor.getTime() + 3 * 86400000)) {
      days.push(cursor.toISOString().slice(0, 10));
    }
    return days;
  }
  const [year, month] = String(period.month || '').split('-').map(Number);
  if (!year || !month) return [];
  const anchors = [6, 10, 14, 18, 22, 26, 28, 3, 12, 20];
  return anchors
    .map((day) => new Date(Date.UTC(year, month - 1, day)))
    .filter((date) => date.getUTCMonth() === month - 1)
    .slice(0, maxDates)
    .map((date) => date.toISOString().slice(0, 10));
}

export function generateTriangulationCandidates(input, options = {}) {
  const limits = getTriangulationLimits(options);
  const origins = expandCityCode(input.origin);
  const destinations = expandCityCode(input.destination);
  const bridges = getBridgeAirports({ origin: input.origin, destination: input.destination, max: limits.maxBridges });
  const dates = generateDateWindows(input.period, { maxDates: limits.maxDates });
  const candidates = [];

  for (const origin of origins) {
    for (const destination of destinations) {
      for (const bridge of bridges) {
        for (const date of dates) {
          if (candidates.length >= limits.maxCombinations) {
            return { candidates, meta: { ...limits, datesConsidered: dates.length, bridgesConsidered: bridges.length, limited: true } };
          }
          candidates.push({
            id: `tri_${origin}_${bridge.iata}_${destination}_${date.slice(0, 7)}`,
            origin,
            destination,
            bridges: [bridge],
            date,
            route: [origin, bridge.iata, destination]
          });
        }
      }
    }
  }

  return { candidates, meta: { ...limits, datesConsidered: dates.length, bridgesConsidered: bridges.length, limited: false } };
}
