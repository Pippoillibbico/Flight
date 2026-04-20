export function deterministicSeed(value) {
  const text = String(value || '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) % 2147483647;
  }
  return Math.abs(hash);
}

export function buildActivitySignal(value, labels) {
  const seed = deterministicSeed(value);
  const variant = seed % 3;
  if (variant === 0) return labels ? labels.activitySignalStrong : 'High opportunity signal';
  if (variant === 1) return labels ? labels.activitySignalRecent : 'Recently surfaced in radar';
  return labels ? labels.activitySignalVolatility : 'Price volatility detected';
}

export function formatPrice(value, currency = 'EUR') {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '-';
  return String(currency).toUpperCase() === 'EUR' ? `${Math.round(amount)} �` : `${Math.round(amount)} ${currency}`;
}

export function formatPeriod(item, locale, labels) {
  const formatter = new Intl.DateTimeFormat(locale, { month: 'short' });
  if (item?.depart_date && item?.return_date) {
    const depart = new Date(item.depart_date);
    const ret = new Date(item.return_date);
    if (!Number.isNaN(depart.getTime()) && !Number.isNaN(ret.getTime())) {
      const departMonth = formatter.format(depart).replace('.', '');
      const returnMonth = formatter.format(ret).replace('.', '');
      return `${departMonth} - ${returnMonth}`;
    }
    return `${item.depart_date} - ${item.return_date}`;
  }
  if (item?.depart_date) return `${labels.departurePrefix} ${item.depart_date}`;
  return labels.flexibleDates;
}

export function formatTripType(item, labels) {
  const type = String(item?.trip_type || '').trim().toLowerCase();
  if (type === 'one_way') return labels.oneWay;
  return labels.roundTrip;
}

export function formatBaggage(item, labels) {
  if (item?.baggage_included === true) return labels.baggageIncluded;
  if (item?.baggage_included === false) return labels.baggageExcluded;
  return labels.baggageUnknown;
}

export function formatAirlineLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'unknown';
  if (raw === 'seed_demo_partner') return 'Partner demo';
  if (raw === 'unknown') return 'unknown';
  if (!raw.includes('_')) return raw;
  return raw
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function levelBadge(level, labels) {
  if (level === 'Rare opportunity') return labels.rareBadge;
  if (level === 'Exceptional price') return labels.exceptionalBadge;
  if (level === 'Good deal' || level === 'Great deal') return labels.greatBadge;
  return labels.interestingBadge;
}

export function sanitizeBadgeText(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const cleaned = raw
    .replace(/Ã°Å¸[^ ]*\s*/g, '')
    .replace(/Ã¢[^ ]*\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || raw;
}

export function localizeOpportunityDescription(item, language, labels) {
  const raw = String(item?.ai_description || '')
    .replace(/\bopportunita\b/gi, 'opportunit�')
    .trim();
  if (!raw) return '';
  const isEnglish = String(language || 'it').toLowerCase().startsWith('en');
  if (!isEnglish) return raw;

  const lower = raw.toLowerCase();
  const looksItalianDescription =
    lower.includes('questa opportunit') ||
    lower.includes('prezzo competitivo') ||
    lower.includes('rotta') ||
    lower.includes('finestra viaggio') ||
    lower.includes('diretta') ||
    lower.includes('scalo');
  if (!looksItalianDescription) return raw;

  const stopCount = Number(item?.stops || 0);
  const routePart = stopCount === 0 ? 'a direct route' : `a route with ${stopCount} stop${stopCount === 1 ? '' : 's'}`;
  const period = item?.depart_date && item?.return_date ? `${item.depart_date} - ${item.return_date}` : labels.flexibleDates;
  return `This opportunity combines a competitive price, ${routePart}, and travel window ${period}.`;
}

export function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function extractSavingValue(item) {
  const candidates = [
    item?.savingVs2024,
    item?.saving_vs_2024,
    item?.savingVsAverage,
    item?.saving_vs_average,
    item?.savingAmount
  ];
  for (const candidate of candidates) {
    const numeric = toFiniteNumber(candidate);
    if (numeric !== null) return numeric;
  }
  const price = toFiniteNumber(item?.price);
  const avg = toFiniteNumber(item?.avg2024);
  if (price === null || avg === null) return null;
  return avg - price;
}

export function getRadarState(item) {
  return String(item?.radarState || item?.radar_state || '').trim().toLowerCase();
}

export function levelPriority(item) {
  const level = String(item?.opportunity_level || item?.short_badge_text || '')
    .trim()
    .toLowerCase();
  if (level.includes('exceptional')) return 3;
  if (level.includes('rare')) return 2;
  if (level.includes('great') || level.includes('good deal') || level.includes('hot')) return 1;
  return 0;
}

export function pickTopDeal(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const ranked = items
    .map((item, index) => ({
      item,
      index,
      radarPriority: getRadarState(item) === 'radar_hot' ? 1 : 0,
      levelScore: levelPriority(item),
      savingValue: toFiniteNumber(extractSavingValue(item)) ?? Number.NEGATIVE_INFINITY,
      price: toFiniteNumber(item?.price) ?? Number.POSITIVE_INFINITY
    }))
    .sort((left, right) => {
      if (right.radarPriority !== left.radarPriority) return right.radarPriority - left.radarPriority;
      if (right.levelScore !== left.levelScore) return right.levelScore - left.levelScore;
      if (right.savingValue !== left.savingValue) return right.savingValue - left.savingValue;
      if (left.price !== right.price) return left.price - right.price;
      return left.index - right.index;
    });
  return ranked[0]?.item || null;
}

export function clusterSignal(cluster) {
  const opportunitiesCount = toFiniteNumber(cluster?.opportunities_count);
  if (cluster?.is_hot === true) return 'Hot';
  if (opportunitiesCount !== null && opportunitiesCount >= 4) return 'Hot';
  if (cluster?.is_new === true && opportunitiesCount !== null && opportunitiesCount <= 2) return 'New';
  return '';
}

export function topDealBadge(item, labels) {
  if (getRadarState(item) === 'radar_hot') return labels.topDealHot;
  return sanitizeBadgeText(item?.short_badge_text) || levelBadge(item?.opportunity_level, labels);
}
