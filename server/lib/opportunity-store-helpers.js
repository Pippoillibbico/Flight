import { createHash } from 'node:crypto';

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

export function toFiniteInt(value, fallback = 0, min = 0, max = 100000) {
  const out = Math.round(Number(value));
  if (!Number.isFinite(out)) return fallback;
  return Math.max(min, Math.min(max, out));
}

export function clampMinutes(value, fallback, minValue = 1, maxValue = 24 * 60) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minValue, Math.min(maxValue, Math.trunc(parsed)));
}

export function toIso(value = new Date()) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function shortHash(value) {
  return createHash('sha1')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 16);
}

export function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

export function isIataCode(value) {
  return /^[A-Z]{3}$/.test(String(value || '').trim().toUpperCase());
}

export function isYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

export function toYmd(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return value.toISOString().slice(0, 10);
  }
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const leadingIso = text.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
  if (leadingIso) return leadingIso[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

export function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function parseJsonSafe(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    return JSON.parse(String(value || '{}'));
  } catch {
    return fallback;
  }
}

function compactRunMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const clone = { ...value };
  if (clone.stats && typeof clone.stats === 'object' && !Array.isArray(clone.stats)) {
    const stats = { ...clone.stats };
    if (Array.isArray(stats.recentRuns)) {
      stats.recentRuns = stats.recentRuns.slice(0, 5).map((run) => ({
        id: run?.id || null,
        status: run?.status || null,
        started_at: run?.started_at || null,
        finished_at: run?.finished_at || null,
        processed_count: Number(run?.processed_count || 0),
        published_count: Number(run?.published_count || 0),
        deduped_count: Number(run?.deduped_count || 0),
        enriched_count: Number(run?.enriched_count || 0),
        enrich_failed_count: Number(run?.enrich_failed_count || 0)
      }));
    }
    clone.stats = stats;
  }
  return clone;
}

export function stringifyJsonSafe(value) {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {}
  try {
    return JSON.stringify(compactRunMetadata(value));
  } catch {}
  try {
    return JSON.stringify({ truncated: true, reason: 'serialization_failed' });
  } catch {
    return '{"truncated":true}';
  }
}

export function budgetBucketFromPrice(value) {
  const price = toNumber(value, 0);
  if (price <= 200) return 'under_200';
  if (price <= 400) return 'under_400';
  if (price <= 600) return 'under_600';
  return 'over_600';
}

export function matchesBudgetBucket(item, bucket) {
  const normalized = normalizeText(bucket).replace(/\s+/g, '_');
  const price = toNumber(item?.price, 0);
  if (!normalized) return true;
  if (normalized === 'under_200') return price <= 200;
  if (normalized === 'under_400') return price <= 400;
  if (normalized === 'under_600') return price <= 600;
  if (normalized === 'over_600') return price > 600;
  return normalized === budgetBucketFromPrice(price);
}

export function estimateStops(route) {
  const distribution = route?.comfortMetadata?.stopCountDistribution || {};
  const candidates = [
    { stops: 0, score: toNumber(distribution[0], 0) },
    { stops: 1, score: toNumber(distribution[1], 0) },
    { stops: 2, score: toNumber(distribution[2], 0) }
  ].sort((a, b) => b.score - a.score);
  return candidates[0]?.stops ?? 1;
}

export function computeTripLength(departDate, returnDate) {
  const depart = new Date(departDate);
  const ret = new Date(returnDate);
  if (Number.isNaN(depart.getTime()) || Number.isNaN(ret.getTime()) || ret <= depart) return null;
  const days = Math.round((ret.getTime() - depart.getTime()) / (24 * 3600 * 1000));
  return clamp(days, 1, 60);
}

export function normalizeTripType(value, returnDate) {
  const raw = normalizeText(value);
  if (raw === 'one_way' || raw === 'round_trip') return raw;
  return returnDate ? 'round_trip' : 'one_way';
}

export function toNullableInt(value) {
  const out = Math.floor(toNumber(value, Number.NaN));
  return Number.isFinite(out) ? out : null;
}

export function toNullableScore(value) {
  const out = toNumber(value, Number.NaN);
  if (!Number.isFinite(out)) return null;
  return clamp(Math.round(out * 100) / 100, 0, 100);
}

export function parseBaggageIncluded(value) {
  if (value === true || value === false) return value;
  const text = normalizeText(value);
  if (!text) return null;
  if (['1', 'true', 'yes', 'included', 'incl', 'si', 's\u00ec'].includes(text)) return true;
  if (['0', 'false', 'no', 'excluded', 'none'].includes(text)) return false;
  return null;
}

export function estimateInputTokensFromText(value, minTokens = 0) {
  const text = String(value || '');
  const estimated = Math.ceil(text.length / 4);
  return Math.max(1, Math.max(Number(minTokens) || 0, estimated));
}

export function resolveOpportunityAiModel(provider) {
  if (provider === 'openai') {
    return String(process.env.OPENAI_MODEL_OPPORTUNITY || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  }
  return String(process.env.ANTHROPIC_MODEL_OPPORTUNITY || process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022').trim();
}

export function buildAiCopy(row) {
  const level =
    row.opportunity_level === 'Rare opportunity'
      ? 'Opportunit\u00e0 rara'
      : row.opportunity_level === 'Exceptional price'
      ? 'Prezzo eccezionale'
      : row.opportunity_level === 'Great deal'
      ? 'Ottimo affare'
      : "Da tenere d'occhio";

  const period = row.return_date ? `${row.depart_date} - ${row.return_date}` : `partenza ${row.depart_date}`;

  const aiTitle = `${level}: ${row.origin_airport} -> ${row.destination_city} a ${Math.round(row.price)} ${row.currency}`;
  const aiDescription = `Questa opportunit\u00e0 combina prezzo competitivo, rotta ${row.stops === 0 ? 'diretta' : `con ${row.stops} scalo`} e finestra viaggio ${period}.`;
  const notificationText = `${level}: ${row.origin_airport} -> ${row.destination_airport} da ${Math.round(row.price)} ${row.currency}.`;
  const whyItMatters = `Score ${row.final_score}/100 con prezzo ${Math.round(row.price)} ${row.currency} e qualit\u00e0 itinerario verificata.`;

  return {
    aiTitle: aiTitle.slice(0, 180),
    aiDescription: aiDescription.slice(0, 280),
    notificationText: notificationText.slice(0, 180),
    whyItMatters: whyItMatters.slice(0, 220)
  };
}
