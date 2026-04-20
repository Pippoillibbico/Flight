import { sanitizeFollowMetadata } from './follow-metadata.js';
import { matchesBudgetBucket, normalizeText, parseJsonSafe, slugify } from './opportunity-store-helpers.js';

const MONTH_HINTS = [
  { pattern: /\b(gennaio|january)\b/i, month: 1 },
  { pattern: /\b(febbraio|february)\b/i, month: 2 },
  { pattern: /\b(marzo|march)\b/i, month: 3 },
  { pattern: /\b(aprile|april)\b/i, month: 4 },
  { pattern: /\b(maggio|may)\b/i, month: 5 },
  { pattern: /\b(giugno|june)\b/i, month: 6 },
  { pattern: /\b(luglio|july)\b/i, month: 7 },
  { pattern: /\b(agosto|august)\b/i, month: 8 },
  { pattern: /\b(settembre|september)\b/i, month: 9 },
  { pattern: /\b(ottobre|october)\b/i, month: 10 },
  { pattern: /\b(novembre|november)\b/i, month: 11 },
  { pattern: /\b(dicembre|december)\b/i, month: 12 }
];

export function applyOpportunityFilters(items, { country = '', region = '', cluster = '', budgetBucket = '', entity = '' } = {}) {
  const safeCountry = normalizeText(country);
  const safeRegion = normalizeText(region);
  const safeCluster = normalizeText(cluster);
  const safeEntity = normalizeText(entity);

  return items.filter((item) => {
    if (safeCountry && normalizeText(item.destination_country) !== safeCountry) return false;
    if (safeRegion && normalizeText(item.destination_region) !== safeRegion) return false;
    if (safeCluster && normalizeText(item.destination_cluster_slug) !== safeCluster) return false;
    if (budgetBucket && !matchesBudgetBucket(item, budgetBucket)) return false;
    if (safeEntity) {
      const entityPool = new Set([
        normalizeText(item.destination_city),
        normalizeText(item.destination_country),
        normalizeText(item.destination_region),
        normalizeText(item.destination_cluster_slug),
        normalizeText(item.destination_airport),
        normalizeText(item.origin_airport),
        slugify(item.destination_city),
        slugify(item.destination_country)
      ]);
      if (!entityPool.has(safeEntity)) return false;
    }
    return true;
  });
}

export function mapUserFollowRow(row) {
  if (!row) return null;
  const metadata = sanitizeFollowMetadata(parseJsonSafe(row.metadata_json, {}));
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    follow_type: String(row.follow_type || 'radar'),
    created_at: row.created_at ? String(row.created_at) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
    entity: {
      entity_type: String(row.entity_type || 'destination_cluster'),
      slug: String(row.slug || ''),
      display_name: String(row.display_name || row.slug || ''),
      metadata
    }
  };
}

export function parsePromptFilters(prompt, now = new Date()) {
  const raw = String(prompt || '').trim();
  const filters = {
    budget: null,
    originAirport: '',
    destinationKeyword: '',
    travelMonth: ''
  };
  const budgetMatch = raw.match(/(\d{2,5})\s*(eur|euro|€)/i) || raw.match(/budget[^0-9]*(\d{2,5})/i);
  if (budgetMatch) filters.budget = Number(budgetMatch[1]);

  const iataMatches = raw.match(/\b[A-Z]{3}\b/g) || [];
  if (iataMatches.length > 0) filters.originAirport = String(iataMatches[0]).toUpperCase();

  for (const hint of MONTH_HINTS) {
    if (hint.pattern.test(raw)) {
      const year = now.getUTCFullYear();
      filters.travelMonth = `${year}-${String(hint.month).padStart(2, '0')}`;
      break;
    }
  }

  const fromMatch = raw.match(/(?:for|per|to|verso)\s+([A-Za-zÀ-ÿ'\-\s]{3,30})/i);
  if (fromMatch) filters.destinationKeyword = String(fromMatch[1]).trim();
  return filters;
}
