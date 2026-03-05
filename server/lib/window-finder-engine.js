import { addDays, format } from 'date-fns';
import { searchFlights } from './flight-engine.js';
import { detectPriceAnomaly } from './anomaly-detector.js';
import { buildSeasonalContext } from './seasonal-context-engine.js';
import { predictPriceDirection } from './price-predictor.js';

/**
 * @typedef {Object} WindowFinderInput
 * @property {string} origin
 * @property {string} dateFrom
 * @property {string} dateTo
 * @property {number} stayDays
 * @property {string=} destinationQuery
 * @property {string=} region
 * @property {number=} maxBudget
 * @property {number=} travellers
 * @property {string=} cabinClass
 * @property {number=} topN
 */

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Finds cheapest windows and deal context over a date horizon.
 * @param {WindowFinderInput} input
 */
export function findCheapestWindows(input) {
  const origin = String(input?.origin || '').toUpperCase();
  const from = new Date(`${String(input?.dateFrom)}T00:00:00.000Z`);
  const to = new Date(`${String(input?.dateTo)}T00:00:00.000Z`);
  const stayDays = clamp(Number(input?.stayDays || 5), 2, 30);
  const travellers = clamp(Number(input?.travellers || 1), 1, 9);
  const cabinClass = String(input?.cabinClass || 'economy');
  const topN = clamp(Number(input?.topN || 20), 1, 50);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return { windows: [], meta: { count: 0 } };

  const windows = [];
  for (let day = new Date(from); day <= to; day = addDays(day, 1)) {
    const dateFrom = format(day, 'yyyy-MM-dd');
    const dateTo = format(addDays(day, stayDays), 'yyyy-MM-dd');
    const result = searchFlights({
      origin,
      region: input?.region || 'all',
      destinationQuery: input?.destinationQuery || '',
      country: undefined,
      dateFrom,
      dateTo,
      cheapOnly: false,
      maxBudget: input?.maxBudget,
      connectionType: 'all',
      maxStops: 2,
      travelTime: 'all',
      minComfortScore: undefined,
      travellers,
      cabinClass
    });

    for (const flight of result.flights.slice(0, 2)) {
      const month = Number(String(dateFrom).slice(5, 7));
      const anomaly = detectPriceAnomaly({
        price: flight.price,
        baselineP50: flight.avg2024,
        baselineP25: flight.avg2024 * 0.85,
        baselineP75: flight.highSeasonAvg,
        stopCount: flight.stopCount,
        isNightFlight: flight.isNightFlight,
        comfortScore: flight.comfortScore
      });
      const season = buildSeasonalContext({ destinationIata: flight.destinationIata, month });
      const predictor = predictPriceDirection({
        departureDate: dateFrom,
        baselineP25: flight.avg2024 * 0.85,
        baselineP50: flight.avg2024,
        baselineP75: flight.highSeasonAvg,
        currentPrice: flight.price
      });
      windows.push({
        id: `${flight.id}-w-${dateFrom}`,
        origin: flight.origin,
        destination: flight.destination,
        destinationIata: flight.destinationIata,
        dateFrom,
        dateTo,
        price: flight.price,
        comfortScore: flight.comfortScore,
        stopCount: flight.stopCount,
        isNightFlight: flight.isNightFlight,
        stopLabel: flight.stopLabel,
        departureTimeLabel: flight.departureTimeLabel,
        savingVs2024: flight.savingVs2024,
        anomaly,
        season,
        predictor,
        link: flight.link
      });
    }
  }

  windows.sort((a, b) => a.price - b.price || b.anomaly.dealDelta - a.anomaly.dealDelta);
  return {
    meta: { count: windows.length, topN },
    windows: windows.slice(0, topN)
  };
}
