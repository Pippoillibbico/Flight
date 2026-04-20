import { addDays, format } from 'date-fns';

export const DEFAULT_SEARCH_DATE_FROM = format(addDays(new Date(), 14), 'yyyy-MM-dd');
export const DEFAULT_SEARCH_DATE_TO = format(addDays(new Date(), 18), 'yyyy-MM-dd');

export function createDefaultSearchForm() {
  return {
    origin: 'MXP',
    tripType: 'round_trip',
    periodPreset: 'custom',
    region: 'all',
    connectionType: 'all',
    maxStops: '2',
    travelTime: 'all',
    minComfortScore: '',
    country: '',
    destinationQuery: '',
    dateFrom: DEFAULT_SEARCH_DATE_FROM,
    dateTo: DEFAULT_SEARCH_DATE_TO,
    cheapOnly: true,
    maxBudget: '',
    travellers: 1,
    cabinClass: 'economy',
    mood: 'relax',
    climatePreference: 'indifferent',
    pace: 'normal',
    avoidOvertourism: false,
    packageCount: 3,
    aiProvider: 'none'
  };
}

export const DEFAULT_SEARCH_FORM = createDefaultSearchForm();

export const MOOD_OPTIONS = ['relax', 'natura', 'party', 'cultura', 'avventura'];
export const CLIMATE_PREF_OPTIONS = ['warm', 'mild', 'cold', 'indifferent'];

export const QUICK_INTAKE_PROMPTS_I18N = {
  en: [
    'I have 400 EUR, flying from FCO, warm weather, 4 days, slow pace.',
    'From MXP with 550 EUR, I want nature and low crowding for 5 days.',
    'Party weekend from BGY with 300 EUR, quick trip.',
    '7 days culture trip from FCO with 700 EUR budget and mild weather.'
  ],
  it: [
    'Ho 400 euro, parto da FCO, voglio caldo, 4 giorni, ritmo slow.',
    'Parto da MXP con 550 euro, voglio natura e poca folla per 5 giorni.',
    'Weekend party da 300 euro da BGY, viaggio veloce.',
    '7 giorni cultura da FCO con budget 700 euro, clima temperato.'
  ]
};
