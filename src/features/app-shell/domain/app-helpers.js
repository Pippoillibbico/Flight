export function asOptionalPositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed);
}

export function asOptionalBoundedInt(value, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  if (parsed < min || parsed > max) return undefined;
  return Math.round(parsed);
}

export function dealLabelText(t, value) {
  if (value === 'great_deal') return t('dealLabelGreatDeal');
  if (value === 'good_value') return t('dealLabelGoodValue');
  if (value === 'overpriced') return t('dealLabelOverpriced');
  return t('dealLabelFairPrice');
}

export function radarStateText(t, value) {
  if (value === 'radar_hot') return t('radarStateHot');
  if (value === 'radar_watch') return t('radarStateWatch');
  return t('radarStateNone');
}

export function toGeneratorInputFromSearchFlight(flight, searchForm) {
  const id = String(flight?.id || '').trim();
  if (!id) return null;
  return {
    id,
    sourceType: 'search_result',
    origin: String(flight?.origin || searchForm.origin || '').toUpperCase(),
    destination: String(flight?.destination || flight?.destinationIata || '').trim(),
    destinationIata: String(flight?.destinationIata || '').toUpperCase(),
    price: Number(flight?.price),
    currency: 'EUR',
    dateFrom: String(flight?.dateFrom || searchForm.dateFrom || ''),
    dateTo: String(flight?.dateTo || searchForm.dateTo || ''),
    durationHours: Number.isFinite(Number(flight?.durationHours)) ? Number(flight.durationHours) : null,
    stopCount: Number.isFinite(Number(flight?.stopCount)) ? Number(flight.stopCount) : null,
    comfortScore: Number.isFinite(Number(flight?.comfortScore)) ? Number(flight.comfortScore) : null,
    travelScore: Number.isFinite(Number(flight?.travelScore)) ? Number(flight.travelScore) : null,
    dealLabel: typeof flight?.dealLabel === 'string' ? flight.dealLabel : undefined,
    dealPriority: Number.isFinite(Number(flight?.dealPriority)) ? Number(flight.dealPriority) : null,
    radarState: typeof flight?.radarState === 'string' ? flight.radarState : undefined,
    radarPriority: Number.isFinite(Number(flight?.radarPriority)) ? Number(flight.radarPriority) : null,
    viewItineraryId: id
  };
}

export function toGeneratorInputFromOpportunity(item, searchForm) {
  const id = String(item?.id || '').trim();
  if (!id) return null;
  const scoreFromOpportunity = Number(item?.travelScore ?? item?.final_score ?? item?.raw_score);
  return {
    id,
    sourceType: 'opportunity_feed',
    origin: String(item?.origin_airport || searchForm.origin || '').toUpperCase(),
    destination: String(item?.destination_city || item?.destination_airport || '').trim(),
    destinationIata: String(item?.destination_airport || '').toUpperCase(),
    price: Number(item?.price),
    currency: String(item?.currency || 'EUR').trim() || 'EUR',
    dateFrom: String(item?.depart_date || ''),
    dateTo: String(item?.return_date || ''),
    durationHours: Number.isFinite(Number(item?.duration_hours)) ? Number(item.duration_hours) : null,
    stopCount: Number.isFinite(Number(item?.stops)) ? Number(item.stops) : null,
    comfortScore: Number.isFinite(Number(item?.comfort_score ?? item?.comfortScore)) ? Number(item?.comfort_score ?? item?.comfortScore) : null,
    travelScore: Number.isFinite(scoreFromOpportunity) ? scoreFromOpportunity : null,
    dealLabel: typeof item?.dealLabel === 'string' ? item.dealLabel : undefined,
    dealPriority: Number.isFinite(Number(item?.dealPriority)) ? Number(item.dealPriority) : null,
    radarState: typeof item?.radarState === 'string' ? item.radarState : undefined,
    radarPriority: Number.isFinite(Number(item?.radarPriority)) ? Number(item.radarPriority) : null,
    viewItineraryId: id
  };
}

export function buildItineraryGenerationInputs({ searchResult, opportunityFeed, searchForm }) {
  const fromSearch = Array.isArray(searchResult?.flights)
    ? searchResult.flights.map((flight) => toGeneratorInputFromSearchFlight(flight, searchForm)).filter(Boolean)
    : [];
  if (fromSearch.length > 0) return fromSearch;
  const fromFeed = Array.isArray(opportunityFeed)
    ? opportunityFeed.map((item) => toGeneratorInputFromOpportunity(item, searchForm)).filter(Boolean)
    : [];
  return fromFeed;
}

export function buildItineraryGenerationPreferences({ searchForm, searchSortBy, searchMode }) {
  const parsedBudget = Number(searchForm.maxBudget);
  const maxBudget = Number.isFinite(parsedBudget) && parsedBudget > 0 ? Math.round(parsedBudget) : null;
  const parsedStops = Number(searchForm.maxStops);
  const maxStops = Number.isFinite(parsedStops) && parsedStops >= 0 ? Math.round(parsedStops) : null;
  const parsedComfort = Number(searchForm.minComfortScore);
  const minComfortScore = Number.isFinite(parsedComfort) && parsedComfort >= 1 && parsedComfort <= 100 ? Math.round(parsedComfort) : null;
  const budgetSensitivity = searchForm.cheapOnly ? 'high' : maxBudget ? 'balanced' : 'low';
  const valuePreference = searchSortBy === 'deal' || searchSortBy === 'radar' ? 'value_focus' : 'balanced';
  const comfortPreference = minComfortScore !== null && minComfortScore >= 75 ? 'high' : minComfortScore !== null ? 'balanced' : 'flexible';
  return {
    origin: String(searchForm.origin || '').trim().toUpperCase() || undefined,
    maxStops,
    maxBudget,
    minComfortScore,
    budgetSensitivity,
    valuePreference,
    comfortPreference,
    multiCityEnabled: searchMode === 'multi_city',
    limit: 6
  };
}

export function formatGeneratedSummary(language, count) {
  const value = Math.max(0, Math.round(Number(count) || 0));
  if (String(language || '').toLowerCase() === 'it') return `Trovate ${value} opportunita reali.`;
  return `Found ${value} real opportunities.`;
}

export function buildGatewayItineraryItems(candidates) {
  return Array.from(candidates || []).map((candidate, index) => {
    const rankingScore = Number.isFinite(Number(candidate?.rankingScore))
      ? Math.round(Number(candidate.rankingScore))
      : Math.max(0, 100 - index * 2);
    return {
      id: String(candidate?.candidateId || candidate?.viewItineraryId || candidate?.id || `generated-${index + 1}`),
      viewItineraryId: String(candidate?.viewItineraryId || candidate?.candidateId || candidate?.id || `generated-${index + 1}`),
      origin: String(candidate?.origin || '').trim(),
      destination: String(candidate?.destination || '').trim(),
      destinationIata: String(candidate?.destinationIata || '').trim(),
      price: Number(candidate?.price || 0),
      currency: String(candidate?.currency || 'EUR').trim() || 'EUR',
      dateFrom: String(candidate?.dateFrom || '').trim(),
      dateTo: String(candidate?.dateTo || '').trim(),
      stops: Number.isFinite(Number(candidate?.stopCount)) ? Number(candidate.stopCount) : null,
      rankingScore,
      explanation: String(candidate?.explanation || '').trim()
    };
  });
}

export function formatEur(value) {
  return Number(value || 0).toFixed(2);
}

export function formatPricingDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

export function parseCsvText(value, mapper = (x) => x) {
  return String(value || '')
    .split(',')
    .map((item) => mapper(String(item || '').trim()))
    .filter(Boolean);
}

export function toRadarDraft(item) {
  if (!item) {
    return {
      originAirports: '',
      favoriteDestinations: '',
      favoriteCountries: '',
      budgetCeiling: '',
      preferredTravelMonths: ''
    };
  }
  return {
    originAirports: Array.isArray(item.originAirports) ? item.originAirports.join(', ') : '',
    favoriteDestinations: Array.isArray(item.favoriteDestinations) ? item.favoriteDestinations.join(', ') : '',
    favoriteCountries: Array.isArray(item.favoriteCountries) ? item.favoriteCountries.join(', ') : '',
    budgetCeiling: Number.isFinite(Number(item.budgetCeiling)) ? String(item.budgetCeiling) : '',
    preferredTravelMonths: Array.isArray(item.preferredTravelMonths) ? item.preferredTravelMonths.join(', ') : ''
  };
}

export function slugifyFollowValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

export function monthsToSeasonSlugs(months) {
  const out = new Set();
  const list = Array.isArray(months) ? months : [];
  if (list.some((m) => [12, 1, 2].includes(Number(m)))) out.add('winter');
  if (list.some((m) => [3, 4, 5].includes(Number(m)))) out.add('spring');
  if (list.some((m) => [6, 7, 8].includes(Number(m)))) out.add('summer');
  if (list.some((m) => [9, 10, 11].includes(Number(m)))) out.add('autumn');
  return Array.from(out);
}
