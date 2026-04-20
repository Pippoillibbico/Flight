import { createHash } from 'node:crypto';

export function getMode() {
  return process.env.DATABASE_URL ? 'postgres' : 'sqlite';
}

export function toIsoTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error('Invalid observed_at.');
  return date.toISOString();
}

export function normalizeIata(value, label) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error(`Invalid ${label}. Expected IATA code.`);
  return normalized;
}

export function normalizeDate(value, label) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`Invalid ${label}. Expected YYYY-MM-DD.`);
  return text;
}

export function monthFromDate(dateText) {
  return `${dateText.slice(0, 7)}-01`;
}

export function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function percentileCont(sorted, p) {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * p;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower];
  const weight = pos - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

export function buildFingerprint(payload) {
  const parts = [
    payload.originIata,
    payload.destinationIata,
    payload.departureDate,
    payload.returnDate || '',
    payload.currency,
    round2(payload.totalPrice).toFixed(2),
    payload.provider,
    payload.cabinClass,
    payload.tripType,
    payload.observedAt,
    payload.source
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

export function assertLocalIngestionPolicy({ provider, source }) {
  const p = String(provider || '').toLowerCase();
  const s = String(source || '').toLowerCase();
  const banned = /(skyscanner|google[_\s-]*flights|scrap|crawler|crawl|serp)/i;
  if (banned.test(p) || banned.test(s)) {
    throw new Error('Rejected by ingestion policy: external APIs/scraping are not allowed.');
  }

  const allowedSource = /^(manual|partner_feed|csv_import|csv_manual|api_ingest|seed_script|user_search)([_a-z0-9-]*)$/i;
  if (!allowedSource.test(s)) {
    throw new Error('Rejected by ingestion policy: source must be internal (manual/csv/partner feed).');
  }
}

export function confidenceForCount(count) {
  if (count >= 80) return { level: 'high', score: 0.95 };
  if (count >= 40) return { level: 'medium', score: 0.8 };
  if (count >= 25) return { level: 'low', score: 0.6 };
  return { level: 'very_low', score: 0.35 };
}

export function coverageLevelForCount(count) {
  const n = Number(count) || 0;
  if (n >= 80) return 'high';
  if (n >= 40) return 'medium';
  if (n >= 25) return 'low';
  return 'very_low';
}

export function monthStartText(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}
