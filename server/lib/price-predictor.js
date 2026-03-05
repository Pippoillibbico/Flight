import { differenceInCalendarDays, parseISO } from 'date-fns';

/**
 * @typedef {Object} PricePredictorInput
 * @property {string} departureDate
 * @property {number} baselineP25
 * @property {number} baselineP50
 * @property {number} baselineP75
 * @property {number} currentPrice
 */

function clamp(n, min = 0, max = 1) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Local heuristic predictor for drop/rise probability and confidence.
 * @param {PricePredictorInput} input
 */
export function predictPriceDirection(input) {
  const now = new Date();
  const departure = parseISO(String(input?.departureDate || now.toISOString().slice(0, 10)));
  const daysToDeparture = Math.max(0, differenceInCalendarDays(departure, now));
  const p25 = Number(input?.baselineP25 || 1);
  const p50 = Number(input?.baselineP50 || Math.max(1, p25));
  const p75 = Number(input?.baselineP75 || Math.max(p50 + 1, p25 + 1));
  const price = Number(input?.currentPrice || p50);

  const relative = (price - p50) / Math.max(1, p50);
  const spread = Math.max(1, p75 - p25) / Math.max(1, p50);

  let probabilityDrop = 0.44;
  let probabilityRise = 0.44;

  if (daysToDeparture >= 56) {
    probabilityDrop += 0.12;
    probabilityRise += 0.08;
  } else if (daysToDeparture >= 28) {
    probabilityDrop += 0.16;
    probabilityRise -= 0.04;
  } else if (daysToDeparture <= 10) {
    probabilityDrop -= 0.12;
    probabilityRise += 0.18;
  }

  if (relative > 0.1) probabilityDrop += 0.12;
  if (relative < -0.08) probabilityRise += 0.14;
  probabilityRise += spread * 0.08;
  probabilityDrop += spread * 0.04;

  probabilityDrop = clamp(probabilityDrop);
  probabilityRise = clamp(probabilityRise);
  const confidence = clamp(0.5 + Math.min(0.35, spread) + (daysToDeparture >= 21 && daysToDeparture <= 70 ? 0.08 : 0));

  return {
    probability_drop: Number(probabilityDrop.toFixed(4)),
    probability_rise: Number(probabilityRise.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
    riskNote: probabilityRise > probabilityDrop ? 'pochi posti, prezzo volatile' : 'finestra relativamente favorevole'
  };
}
