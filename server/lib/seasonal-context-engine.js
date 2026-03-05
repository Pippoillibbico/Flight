import { ROUTES } from '../data/local-flight-data.js';

/**
 * @typedef {Object} SeasonalContextInput
 * @property {string} destinationIata
 * @property {number} month
 */

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function findRoute(destinationIata) {
  const code = String(destinationIata || '').trim().toUpperCase();
  return ROUTES.find((route) => String(route.destinationIata || '').toUpperCase() === code) || null;
}

/**
 * Builds non-AI seasonal/climate/crowding labels for decision UX.
 * @param {SeasonalContextInput} input
 */
export function buildSeasonalContext(input) {
  const month = clamp(Number(input?.month || 1), 1, 12);
  const route = findRoute(input?.destinationIata);
  const seasonality = route?.seasonality || { highSeasonMonths: [7, 8], shoulderMonths: [4, 5, 9, 10] };
  const climateProfile = String(route?.decisionMetadata?.climateProfile || 'mixed');
  const overtourism = Number(route?.decisionMetadata?.overtourismIndex || 50);
  const high = new Set(seasonality.highSeasonMonths || []);
  const shoulder = new Set(seasonality.shoulderMonths || []);

  const seasonBand = high.has(month) ? 'high' : shoulder.has(month) ? 'shoulder' : 'low';
  const crowdingScore = clamp(Math.round(overtourism + (seasonBand === 'high' ? 14 : seasonBand === 'shoulder' ? 4 : -8)), 1, 100);

  let label = 'spalla: equilibrio';
  if (seasonBand === 'high') label = 'alta stagione, prezzi alti';
  else if (seasonBand === 'low' && (climateProfile === 'warm' || climateProfile === 'mild')) label = 'fuori stagione ma clima ok';

  const climateLabel = climateProfile === 'warm' ? 'warm' : climateProfile === 'cold' ? 'cold' : 'mild';
  const riskNote = crowdingScore >= 75 ? 'area affollata nel periodo' : seasonBand === 'high' ? 'finestra con domanda alta' : 'finestra relativamente stabile';

  return {
    seasonBand,
    seasonLabel: label,
    climateLabel,
    crowdingScore,
    riskNote
  };
}
