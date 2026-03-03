export const ORIGINS = [
  { code: 'MXP', label: 'Milano Malpensa (MXP)' },
  { code: 'FCO', label: 'Roma Fiumicino (FCO)' },
  { code: 'BLQ', label: 'Bologna (BLQ)' },
  { code: 'VCE', label: 'Venezia (VCE)' },
  { code: 'NAP', label: 'Napoli (NAP)' }
];

export const DESTINATIONS = [
  {
    city: 'Tokyo',
    iata: 'TYO',
    region: 'asia',
    area: 'japan',
    country: 'Japan',
    keywords: ['japan', 'giappone', 'tokyo'],
    basePrice: 610,
    avg2024: 710,
    highSeasonAvg: 830,
    climate: 'good climate window'
  },
  {
    city: 'Osaka',
    iata: 'OSA',
    region: 'asia',
    area: 'japan',
    country: 'Japan',
    keywords: ['japan', 'giappone', 'osaka'],
    basePrice: 590,
    avg2024: 690,
    highSeasonAvg: 810,
    climate: 'good climate window'
  },
  {
    city: 'Sapporo',
    iata: 'SPK',
    region: 'asia',
    area: 'japan',
    country: 'Japan',
    keywords: ['japan', 'giappone', 'sapporo', 'hokkaido'],
    basePrice: 650,
    avg2024: 740,
    highSeasonAvg: 860,
    climate: 'cold winter, clear summer'
  },
  {
    city: 'Bangkok',
    iata: 'BKK',
    region: 'asia',
    area: 'sea',
    country: 'Thailand',
    keywords: ['thailand', 'thailandia', 'bangkok', 'sud-est asiatico', 'southeast asia'],
    basePrice: 500,
    avg2024: 560,
    highSeasonAvg: 690,
    climate: 'possible seasonal rain'
  },
  {
    city: 'Phuket',
    iata: 'HKT',
    region: 'asia',
    area: 'sea',
    country: 'Thailand',
    keywords: ['thailand', 'thailandia', 'phuket', 'sud-est asiatico', 'southeast asia'],
    basePrice: 530,
    avg2024: 590,
    highSeasonAvg: 710,
    climate: 'possible seasonal rain'
  },
  {
    city: 'Singapore',
    iata: 'SIN',
    region: 'asia',
    area: 'sea',
    country: 'Singapore',
    keywords: ['singapore', 'sud-est asiatico', 'southeast asia'],
    basePrice: 560,
    avg2024: 620,
    highSeasonAvg: 740,
    climate: 'humid tropical weather'
  },

  {
    city: 'Barcelona',
    iata: 'BCN',
    region: 'eu',
    area: 'eu',
    country: 'Spain',
    keywords: ['spain', 'spagna', 'barcelona', 'barcellona'],
    basePrice: 95,
    avg2024: 120,
    highSeasonAvg: 155,
    climate: 'stable weather'
  },
  {
    city: 'Paris',
    iata: 'PAR',
    region: 'eu',
    area: 'eu',
    country: 'France',
    keywords: ['france', 'francia', 'paris', 'parigi'],
    basePrice: 110,
    avg2024: 140,
    highSeasonAvg: 170,
    climate: 'stable weather'
  },
  {
    city: 'Athens',
    iata: 'ATH',
    region: 'eu',
    area: 'eu',
    country: 'Greece',
    keywords: ['greece', 'grecia', 'athens', 'atene'],
    basePrice: 100,
    avg2024: 130,
    highSeasonAvg: 160,
    climate: 'stable weather'
  },
  {
    city: 'Lisbon',
    iata: 'LIS',
    region: 'eu',
    area: 'eu',
    country: 'Portugal',
    keywords: ['portugal', 'portogallo', 'lisbon', 'lisbona'],
    basePrice: 120,
    avg2024: 145,
    highSeasonAvg: 180,
    climate: 'stable weather'
  },

  {
    city: 'New York',
    iata: 'NYC',
    region: 'america',
    area: 'na',
    country: 'United States',
    keywords: ['usa', 'stati uniti', 'new york', 'america'],
    basePrice: 470,
    avg2024: 560,
    highSeasonAvg: 640,
    climate: 'mixed Atlantic weather'
  },
  {
    city: 'Los Angeles',
    iata: 'LAX',
    region: 'america',
    area: 'na',
    country: 'United States',
    keywords: ['usa', 'stati uniti', 'los angeles', 'america'],
    basePrice: 520,
    avg2024: 610,
    highSeasonAvg: 700,
    climate: 'generally dry weather'
  },
  {
    city: 'Toronto',
    iata: 'YYZ',
    region: 'america',
    area: 'na',
    country: 'Canada',
    keywords: ['canada', 'toronto', 'america'],
    basePrice: 450,
    avg2024: 525,
    highSeasonAvg: 610,
    climate: 'cold winters, mild summers'
  },
  {
    city: 'Sao Paulo',
    iata: 'SAO',
    region: 'america',
    area: 'sa',
    country: 'Brazil',
    keywords: ['brazil', 'brasile', 'sao paulo', 'america latina'],
    basePrice: 540,
    avg2024: 620,
    highSeasonAvg: 730,
    climate: 'humid subtropical weather'
  },
  {
    city: 'Santiago',
    iata: 'SCL',
    region: 'america',
    area: 'sa',
    country: 'Chile',
    keywords: ['chile', 'santiago', 'america latina'],
    basePrice: 560,
    avg2024: 650,
    highSeasonAvg: 760,
    climate: 'dry summer pattern'
  },

  {
    city: 'Sydney',
    iata: 'SYD',
    region: 'oceania',
    area: 'oceania',
    country: 'Australia',
    keywords: ['australia', 'sydney', 'oceania'],
    basePrice: 740,
    avg2024: 860,
    highSeasonAvg: 980,
    climate: 'temperate coastal climate'
  },
  {
    city: 'Melbourne',
    iata: 'MEL',
    region: 'oceania',
    area: 'oceania',
    country: 'Australia',
    keywords: ['australia', 'melbourne', 'oceania'],
    basePrice: 720,
    avg2024: 840,
    highSeasonAvg: 960,
    climate: 'variable oceanic climate'
  },
  {
    city: 'Auckland',
    iata: 'AKL',
    region: 'oceania',
    area: 'oceania',
    country: 'New Zealand',
    keywords: ['new zealand', 'nuova zelanda', 'auckland', 'oceania'],
    basePrice: 760,
    avg2024: 890,
    highSeasonAvg: 1020,
    climate: 'mild maritime climate'
  }
];
