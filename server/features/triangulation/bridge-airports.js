export const CITY_AIRPORTS = Object.freeze({
  ROM: ['FCO', 'CIA'],
  BKK: ['BKK', 'DMK'],
  MIL: ['MXP', 'BGY', 'LIN'],
  IST: ['IST', 'SAW']
});

export const BRIDGE_AIRPORTS = Object.freeze([
  { iata: 'BUD', city: 'Budapest', country: 'Hungary', region: 'europe', tags: ['low_cost', 'europe_bridge'], riskProfile: 'medium', goodFor: ['asia', 'middle_east'], minLayoverHoursSeparateTickets: 5 },
  { iata: 'ATH', city: 'Athens', country: 'Greece', region: 'europe', tags: ['europe_bridge', 'south_europe'], riskProfile: 'medium', goodFor: ['asia', 'middle_east'], minLayoverHoursSeparateTickets: 5 },
  { iata: 'VIE', city: 'Vienna', country: 'Austria', region: 'europe', tags: ['legacy_hub', 'europe_bridge'], riskProfile: 'low_medium', goodFor: ['asia'], minLayoverHoursSeparateTickets: 5 },
  { iata: 'MXP', city: 'Milan', country: 'Italy', region: 'europe', tags: ['large_airport', 'low_cost'], riskProfile: 'low_medium', goodFor: ['asia', 'middle_east'], minLayoverHoursSeparateTickets: 5 },
  { iata: 'BGY', city: 'Bergamo', country: 'Italy', region: 'europe', tags: ['low_cost'], riskProfile: 'medium', goodFor: ['europe_bridge'], minLayoverHoursSeparateTickets: 5 },
  { iata: 'FCO', city: 'Rome', country: 'Italy', region: 'europe', tags: ['large_airport'], riskProfile: 'low_medium', goodFor: ['asia', 'middle_east'], minLayoverHoursSeparateTickets: 5 },
  { iata: 'CIA', city: 'Rome', country: 'Italy', region: 'europe', tags: ['low_cost'], riskProfile: 'medium', goodFor: ['europe_bridge'], minLayoverHoursSeparateTickets: 5 },
  { iata: 'BCN', city: 'Barcelona', country: 'Spain', region: 'europe', tags: ['large_airport', 'low_cost'], riskProfile: 'medium', goodFor: ['asia', 'middle_east'], minLayoverHoursSeparateTickets: 5 },
  { iata: 'MAD', city: 'Madrid', country: 'Spain', region: 'europe', tags: ['large_airport'], riskProfile: 'low_medium', goodFor: ['asia', 'americas'], minLayoverHoursSeparateTickets: 5 },
  { iata: 'BER', city: 'Berlin', country: 'Germany', region: 'europe', tags: ['large_airport', 'low_cost'], riskProfile: 'medium', goodFor: ['asia'], minLayoverHoursSeparateTickets: 5 },
  { iata: 'WAW', city: 'Warsaw', country: 'Poland', region: 'europe', tags: ['legacy_hub'], riskProfile: 'low_medium', goodFor: ['asia'], minLayoverHoursSeparateTickets: 5 },
  { iata: 'PRG', city: 'Prague', country: 'Czechia', region: 'europe', tags: ['low_cost', 'europe_bridge'], riskProfile: 'medium', goodFor: ['asia'], minLayoverHoursSeparateTickets: 5 },
  { iata: 'SOF', city: 'Sofia', country: 'Bulgaria', region: 'europe', tags: ['low_cost'], riskProfile: 'medium', goodFor: ['middle_east'], minLayoverHoursSeparateTickets: 5 },
  { iata: 'OTP', city: 'Bucharest', country: 'Romania', region: 'europe', tags: ['low_cost'], riskProfile: 'medium', goodFor: ['middle_east'], minLayoverHoursSeparateTickets: 5 },
  { iata: 'IST', city: 'Istanbul', country: 'Turkey', region: 'middle_east', tags: ['mega_hub'], riskProfile: 'low_medium', goodFor: ['asia', 'middle_east'], minLayoverHoursSeparateTickets: 6 },
  { iata: 'SAW', city: 'Istanbul', country: 'Turkey', region: 'middle_east', tags: ['low_cost', 'secondary_airport'], riskProfile: 'medium', goodFor: ['asia', 'middle_east'], minLayoverHoursSeparateTickets: 6 },
  { iata: 'AUH', city: 'Abu Dhabi', country: 'United Arab Emirates', region: 'middle_east', tags: ['gulf_hub'], riskProfile: 'low_medium', goodFor: ['asia'], minLayoverHoursSeparateTickets: 6 },
  { iata: 'DXB', city: 'Dubai', country: 'United Arab Emirates', region: 'middle_east', tags: ['mega_hub'], riskProfile: 'low_medium', goodFor: ['asia'], minLayoverHoursSeparateTickets: 6 },
  { iata: 'SHJ', city: 'Sharjah', country: 'United Arab Emirates', region: 'middle_east', tags: ['low_cost', 'secondary_airport'], riskProfile: 'medium', goodFor: ['asia'], minLayoverHoursSeparateTickets: 6 },
  { iata: 'DOH', city: 'Doha', country: 'Qatar', region: 'middle_east', tags: ['gulf_hub'], riskProfile: 'low_medium', goodFor: ['asia'], minLayoverHoursSeparateTickets: 6 },
  { iata: 'JED', city: 'Jeddah', country: 'Saudi Arabia', region: 'middle_east', tags: ['gulf_bridge'], riskProfile: 'medium', goodFor: ['asia'], minLayoverHoursSeparateTickets: 6 },
  { iata: 'RUH', city: 'Riyadh', country: 'Saudi Arabia', region: 'middle_east', tags: ['gulf_bridge'], riskProfile: 'medium', goodFor: ['asia'], minLayoverHoursSeparateTickets: 6 },
  { iata: 'MCT', city: 'Muscat', country: 'Oman', region: 'middle_east', tags: ['gulf_bridge'], riskProfile: 'low_medium', goodFor: ['asia'], minLayoverHoursSeparateTickets: 6 },
  { iata: 'KUL', city: 'Kuala Lumpur', country: 'Malaysia', region: 'asia', tags: ['asia_hub', 'low_cost'], riskProfile: 'low_medium', goodFor: ['south_east_asia'], minLayoverHoursSeparateTickets: 6 },
  { iata: 'SIN', city: 'Singapore', country: 'Singapore', region: 'asia', tags: ['mega_hub'], riskProfile: 'low', goodFor: ['south_east_asia'], minLayoverHoursSeparateTickets: 6 },
  { iata: 'SGN', city: 'Ho Chi Minh City', country: 'Vietnam', region: 'asia', tags: ['asia_bridge'], riskProfile: 'medium', goodFor: ['south_east_asia'], minLayoverHoursSeparateTickets: 6 },
  { iata: 'HAN', city: 'Hanoi', country: 'Vietnam', region: 'asia', tags: ['asia_bridge'], riskProfile: 'medium', goodFor: ['south_east_asia'], minLayoverHoursSeparateTickets: 6 },
  { iata: 'HKT', city: 'Phuket', country: 'Thailand', region: 'asia', tags: ['leisure_hub'], riskProfile: 'medium', goodFor: ['thailand'], minLayoverHoursSeparateTickets: 6 },
  { iata: 'DMK', city: 'Bangkok', country: 'Thailand', region: 'asia', tags: ['low_cost', 'secondary_airport'], riskProfile: 'medium', goodFor: ['thailand'], minLayoverHoursSeparateTickets: 6 },
  { iata: 'BKK', city: 'Bangkok', country: 'Thailand', region: 'asia', tags: ['mega_hub'], riskProfile: 'low_medium', goodFor: ['thailand', 'south_east_asia'], minLayoverHoursSeparateTickets: 6 },
  { iata: 'CGK', city: 'Jakarta', country: 'Indonesia', region: 'asia', tags: ['asia_hub'], riskProfile: 'medium', goodFor: ['south_east_asia'], minLayoverHoursSeparateTickets: 6 }
]);

export function expandCityCode(iata) {
  const code = String(iata || '').trim().toUpperCase();
  return CITY_AIRPORTS[code] || [code];
}

export function getBridgeAirports({ origin, destination, max = 20 } = {}) {
  const blocked = new Set([...expandCityCode(origin), ...expandCityCode(destination)]);
  return BRIDGE_AIRPORTS.filter((airport) => !blocked.has(airport.iata)).slice(0, Math.max(1, Number(max) || 20));
}
