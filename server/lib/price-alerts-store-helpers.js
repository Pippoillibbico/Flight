import { parseBoolean } from './env-flags.js';

function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function normalizeIata(value, label) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error(`Invalid ${label}. Expected IATA code.`);
  return normalized;
}

function normalizeDate(value, label) {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error(`Invalid ${label}. Expected YYYY-MM-DD.`);
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ${label}.`);
  return normalized;
}

function normalizeCurrency(value) {
  const normalized = String(value || 'EUR').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error('Invalid currency. Expected ISO code.');
  return normalized;
}

function normalizeChannels(channels = null) {
  const source = channels && typeof channels === 'object' && !Array.isArray(channels) ? channels : {};
  const normalized = {
    push: source.push !== false,
    email: source.email !== false,
    in_app: source.in_app === true || source.inApp === true || (source.in_app == null && source.inApp == null),
    inApp: undefined
  };
  delete normalized.inApp;
  if (!normalized.push && !normalized.email && !normalized.in_app) {
    throw new Error('Invalid channels. At least one channel must be enabled.');
  }
  return normalized;
}

function parseChannels(raw) {
  if (!raw) return { push: true, email: true, in_app: true };
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const push = raw.push !== false;
    const email = raw.email !== false;
    const inApp = raw.in_app === true || raw.inApp === true || (raw.in_app == null && raw.inApp == null);
    return { push, email, in_app: inApp };
  }
  try {
    return parseChannels(JSON.parse(String(raw)));
  } catch {
    return { push: true, email: true, in_app: true };
  }
}

function assertDateWindow(dateFrom, dateTo) {
  if (dateTo < dateFrom) throw new Error('Invalid date range. dateTo must be >= dateFrom.');
}

function mapAlertRow(row) {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    user_id: String(row.user_id || ''),
    origin_iata: normalizeIata(row.origin_iata, 'origin_iata'),
    destination_iata: normalizeIata(row.destination_iata, 'destination_iata'),
    date_from: String(row.date_from || '').slice(0, 10),
    date_to: String(row.date_to || '').slice(0, 10),
    max_price: Math.round(toNumber(row.max_price, 0) * 100) / 100,
    currency: normalizeCurrency(row.currency || 'EUR'),
    channels: parseChannels(row.channels_json),
    enabled: parseBoolean(row.enabled, true),
    last_checked_at: row.last_checked_at ? new Date(row.last_checked_at).toISOString() : null,
    last_triggered_at: row.last_triggered_at ? new Date(row.last_triggered_at).toISOString() : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

function mapMatchRow(row) {
  return {
    alert_id: String(row.alert_id || ''),
    user_id: String(row.user_id || ''),
    channels: parseChannels(row.channels_json),
    max_price: toNumber(row.max_price, 0),
    alert_currency: normalizeCurrency(row.alert_currency || 'EUR'),
    deal_key: String(row.deal_key || ''),
    detected_deal_id: toNumber(row.detected_deal_id, 0),
    route_id: toNumber(row.route_id, 0),
    flight_quote_id: toNumber(row.flight_quote_id, 0),
    deal_price: toNumber(row.deal_price, 0),
    final_score: toNumber(row.final_score, 0),
    savings_pct: toNumber(row.savings_pct, 0),
    origin_iata: normalizeIata(row.origin_iata, 'origin_iata'),
    destination_iata: normalizeIata(row.destination_iata, 'destination_iata'),
    departure_date: String(row.departure_date || '').slice(0, 10),
    return_date: row.return_date ? String(row.return_date).slice(0, 10) : null,
    trip_type: String(row.trip_type || 'round_trip'),
    stops: row.stops == null ? null : toNumber(row.stops, 0),
    provider: String(row.provider || '').trim() || null,
    currency: normalizeCurrency(row.currency || 'EUR'),
    source_observed_at: row.source_observed_at ? new Date(row.source_observed_at).toISOString() : null,
    published_at: row.published_at ? new Date(row.published_at).toISOString() : null
  };
}

export {
  assertDateWindow,
  mapAlertRow,
  mapMatchRow,
  normalizeChannels,
  normalizeCurrency,
  normalizeDate,
  normalizeIata,
  parseChannels,
  parseBoolean,
  toNumber
};
