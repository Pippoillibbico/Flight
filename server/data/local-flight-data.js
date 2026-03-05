export const ORIGINS = [
  { code: 'MXP', label: 'Milano Malpensa (MXP)' },
  { code: 'FCO', label: 'Roma Fiumicino (FCO)' },
  { code: 'BLQ', label: 'Bologna (BLQ)' },
  { code: 'VCE', label: 'Venezia (VCE)' },
  { code: 'NAP', label: 'Napoli (NAP)' }
];

function bands(base, swing = 0.16) {
  const out = {};
  for (let month = 1; month <= 12; month += 1) {
    const seasonal =
      month === 7 || month === 8
        ? 1.22
        : month === 12 || month === 1
        ? 1.12
        : month === 4 || month === 5 || month === 9 || month === 10
        ? 0.96
        : 1;
    const avgPrice = Math.round(base * seasonal);
    out[String(month)] = {
      avgPrice,
      low: Math.max(40, Math.round(avgPrice * (1 - swing))),
      high: Math.max(45, Math.round(avgPrice * (1 + swing)))
    };
  }
  return out;
}

export const ROUTES = [
  {
    origin: 'MXP',
    destinationIata: 'BCN',
    destinationName: 'Barcelona',
    country: 'Spain',
    region: 'eu',
    keywords: ['barcelona', 'spain', 'spagna', 'mediterranean'],
    seasonalPriceBands: bands(130),
    seasonality: { highSeasonMonths: [6, 7, 8], shoulderMonths: [4, 5, 9, 10] },
    comfortMetadata: {
      stopCountDistribution: { 0: 0.64, 1: 0.3, 2: 0.06 },
      nightFlightProbability: 0.18,
      typicalDepartureWindow: { startHour: 6, endHour: 21 }
    },
    decisionMetadata: { climateProfile: 'warm', paceProfile: 'fast', overtourismIndex: 73, area: 'eu' }
  },
  {
    origin: 'MXP',
    destinationIata: 'ATH',
    destinationName: 'Athens',
    country: 'Greece',
    region: 'eu',
    keywords: ['athens', 'greece', 'grecia'],
    seasonalPriceBands: bands(145),
    seasonality: { highSeasonMonths: [6, 7, 8], shoulderMonths: [4, 5, 9, 10] },
    comfortMetadata: {
      stopCountDistribution: { 0: 0.54, 1: 0.36, 2: 0.1 },
      nightFlightProbability: 0.24,
      typicalDepartureWindow: { startHour: 6, endHour: 22 }
    },
    decisionMetadata: { climateProfile: 'warm', paceProfile: 'normal', overtourismIndex: 66, area: 'eu' }
  },
  {
    origin: 'MXP',
    destinationIata: 'LIS',
    destinationName: 'Lisbon',
    country: 'Portugal',
    region: 'eu',
    keywords: ['lisbon', 'lisbona', 'portugal', 'portogallo'],
    seasonalPriceBands: bands(150),
    seasonality: { highSeasonMonths: [6, 7, 8], shoulderMonths: [3, 4, 5, 9, 10] },
    comfortMetadata: {
      stopCountDistribution: { 0: 0.44, 1: 0.42, 2: 0.14 },
      nightFlightProbability: 0.2,
      typicalDepartureWindow: { startHour: 7, endHour: 21 }
    },
    decisionMetadata: { climateProfile: 'mild', paceProfile: 'normal', overtourismIndex: 58, area: 'eu' }
  },
  {
    origin: 'FCO',
    destinationIata: 'PAR',
    destinationName: 'Paris',
    country: 'France',
    region: 'eu',
    keywords: ['paris', 'parigi', 'france', 'francia'],
    seasonalPriceBands: bands(160),
    seasonality: { highSeasonMonths: [5, 6, 7, 9, 12], shoulderMonths: [3, 4, 10, 11] },
    comfortMetadata: {
      stopCountDistribution: { 0: 0.71, 1: 0.24, 2: 0.05 },
      nightFlightProbability: 0.16,
      typicalDepartureWindow: { startHour: 6, endHour: 20 }
    },
    decisionMetadata: { climateProfile: 'mild', paceProfile: 'fast', overtourismIndex: 78, area: 'eu' }
  },
  {
    origin: 'FCO',
    destinationIata: 'PRG',
    destinationName: 'Prague',
    country: 'Czech Republic',
    region: 'eu',
    keywords: ['prague', 'praga', 'czech'],
    seasonalPriceBands: bands(145),
    seasonality: { highSeasonMonths: [5, 6, 9, 12], shoulderMonths: [3, 4, 7, 10, 11] },
    comfortMetadata: {
      stopCountDistribution: { 0: 0.58, 1: 0.34, 2: 0.08 },
      nightFlightProbability: 0.14,
      typicalDepartureWindow: { startHour: 6, endHour: 21 }
    },
    decisionMetadata: { climateProfile: 'cold', paceProfile: 'slow', overtourismIndex: 49, area: 'eu' }
  },
  {
    origin: 'FCO',
    destinationIata: 'TYO',
    destinationName: 'Tokyo',
    country: 'Japan',
    region: 'asia',
    keywords: ['tokyo', 'japan', 'giappone'],
    seasonalPriceBands: bands(740, 0.22),
    seasonality: { highSeasonMonths: [3, 4, 10, 11], shoulderMonths: [2, 5, 6, 9] },
    comfortMetadata: {
      stopCountDistribution: { 0: 0.16, 1: 0.54, 2: 0.3 },
      nightFlightProbability: 0.41,
      typicalDepartureWindow: { startHour: 10, endHour: 23 }
    },
    decisionMetadata: { climateProfile: 'mixed', paceProfile: 'fast', overtourismIndex: 63, area: 'japan' }
  },
  {
    origin: 'BLQ',
    destinationIata: 'MAD',
    destinationName: 'Madrid',
    country: 'Spain',
    region: 'eu',
    keywords: ['madrid', 'spain', 'spagna'],
    seasonalPriceBands: bands(152),
    seasonality: { highSeasonMonths: [5, 6, 9, 10], shoulderMonths: [3, 4, 7, 8, 11] },
    comfortMetadata: {
      stopCountDistribution: { 0: 0.47, 1: 0.41, 2: 0.12 },
      nightFlightProbability: 0.22,
      typicalDepartureWindow: { startHour: 7, endHour: 22 }
    },
    decisionMetadata: { climateProfile: 'warm', paceProfile: 'fast', overtourismIndex: 57, area: 'eu' }
  },
  {
    origin: 'BLQ',
    destinationIata: 'BER',
    destinationName: 'Berlin',
    country: 'Germany',
    region: 'eu',
    keywords: ['berlin', 'germany', 'germania'],
    seasonalPriceBands: bands(148),
    seasonality: { highSeasonMonths: [5, 6, 9], shoulderMonths: [4, 7, 8, 10, 11] },
    comfortMetadata: {
      stopCountDistribution: { 0: 0.52, 1: 0.38, 2: 0.1 },
      nightFlightProbability: 0.13,
      typicalDepartureWindow: { startHour: 6, endHour: 20 }
    },
    decisionMetadata: { climateProfile: 'cold', paceProfile: 'normal', overtourismIndex: 44, area: 'eu' }
  },
  {
    origin: 'BLQ',
    destinationIata: 'BKK',
    destinationName: 'Bangkok',
    country: 'Thailand',
    region: 'asia',
    keywords: ['bangkok', 'thailand', 'thailandia', 'sea'],
    seasonalPriceBands: bands(620, 0.2),
    seasonality: { highSeasonMonths: [1, 2, 7, 8, 12], shoulderMonths: [3, 4, 5, 10, 11] },
    comfortMetadata: {
      stopCountDistribution: { 0: 0.08, 1: 0.56, 2: 0.36 },
      nightFlightProbability: 0.48,
      typicalDepartureWindow: { startHour: 9, endHour: 23 }
    },
    decisionMetadata: { climateProfile: 'warm', paceProfile: 'fast', overtourismIndex: 69, area: 'sea' }
  },
  {
    origin: 'VCE',
    destinationIata: 'LON',
    destinationName: 'London',
    country: 'United Kingdom',
    region: 'eu',
    keywords: ['london', 'uk', 'england'],
    seasonalPriceBands: bands(170),
    seasonality: { highSeasonMonths: [5, 6, 7, 12], shoulderMonths: [3, 4, 8, 9, 10] },
    comfortMetadata: {
      stopCountDistribution: { 0: 0.69, 1: 0.25, 2: 0.06 },
      nightFlightProbability: 0.17,
      typicalDepartureWindow: { startHour: 6, endHour: 21 }
    },
    decisionMetadata: { climateProfile: 'mild', paceProfile: 'fast', overtourismIndex: 75, area: 'eu' }
  },
  {
    origin: 'VCE',
    destinationIata: 'NYC',
    destinationName: 'New York',
    country: 'United States',
    region: 'america',
    keywords: ['new york', 'usa', 'united states'],
    seasonalPriceBands: bands(680, 0.23),
    seasonality: { highSeasonMonths: [4, 6, 7, 10, 12], shoulderMonths: [3, 5, 9, 11] },
    comfortMetadata: {
      stopCountDistribution: { 0: 0.26, 1: 0.52, 2: 0.22 },
      nightFlightProbability: 0.37,
      typicalDepartureWindow: { startHour: 8, endHour: 22 }
    },
    decisionMetadata: { climateProfile: 'mixed', paceProfile: 'fast', overtourismIndex: 81, area: 'na' }
  },
  {
    origin: 'VCE',
    destinationIata: 'YYZ',
    destinationName: 'Toronto',
    country: 'Canada',
    region: 'america',
    keywords: ['toronto', 'canada'],
    seasonalPriceBands: bands(640, 0.2),
    seasonality: { highSeasonMonths: [6, 7, 8], shoulderMonths: [4, 5, 9, 10] },
    comfortMetadata: {
      stopCountDistribution: { 0: 0.18, 1: 0.58, 2: 0.24 },
      nightFlightProbability: 0.34,
      typicalDepartureWindow: { startHour: 8, endHour: 23 }
    },
    decisionMetadata: { climateProfile: 'cold', paceProfile: 'normal', overtourismIndex: 42, area: 'na' }
  },
  {
    origin: 'NAP',
    destinationIata: 'LIS',
    destinationName: 'Lisbon',
    country: 'Portugal',
    region: 'eu',
    keywords: ['lisbon', 'portugal', 'portogallo'],
    seasonalPriceBands: bands(155),
    seasonality: { highSeasonMonths: [6, 7, 8], shoulderMonths: [4, 5, 9, 10] },
    comfortMetadata: {
      stopCountDistribution: { 0: 0.33, 1: 0.5, 2: 0.17 },
      nightFlightProbability: 0.24,
      typicalDepartureWindow: { startHour: 7, endHour: 22 }
    },
    decisionMetadata: { climateProfile: 'mild', paceProfile: 'normal', overtourismIndex: 58, area: 'eu' }
  },
  {
    origin: 'NAP',
    destinationIata: 'HKT',
    destinationName: 'Phuket',
    country: 'Thailand',
    region: 'asia',
    keywords: ['phuket', 'thailand', 'thailandia', 'sea'],
    seasonalPriceBands: bands(690, 0.2),
    seasonality: { highSeasonMonths: [1, 2, 7, 8, 12], shoulderMonths: [3, 4, 10, 11] },
    comfortMetadata: {
      stopCountDistribution: { 0: 0.05, 1: 0.5, 2: 0.45 },
      nightFlightProbability: 0.53,
      typicalDepartureWindow: { startHour: 9, endHour: 23 }
    },
    decisionMetadata: { climateProfile: 'warm', paceProfile: 'slow', overtourismIndex: 71, area: 'sea' }
  },
  {
    origin: 'NAP',
    destinationIata: 'AKL',
    destinationName: 'Auckland',
    country: 'New Zealand',
    region: 'oceania',
    keywords: ['auckland', 'new zealand', 'nuova zelanda'],
    seasonalPriceBands: bands(920, 0.24),
    seasonality: { highSeasonMonths: [1, 2, 12], shoulderMonths: [3, 4, 10, 11] },
    comfortMetadata: {
      stopCountDistribution: { 0: 0.02, 1: 0.38, 2: 0.6 },
      nightFlightProbability: 0.58,
      typicalDepartureWindow: { startHour: 10, endHour: 23 }
    },
    decisionMetadata: { climateProfile: 'mild', paceProfile: 'slow', overtourismIndex: 24, area: 'oceania' }
  }
];
