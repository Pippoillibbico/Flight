/**
 * economic-logger.js
 *
 * Centralized logger for key economic events to monitor business sustainability.
 */

import { logger } from './logger.js';
import { hashValueForLogs } from './log-redaction.js';
import { insertEconomicEvent } from './sql-db.js';

function toFiniteOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toTextOrNull(value) {
  if (value === undefined || value === null) return null;
  const out = String(value).trim();
  return out.length ? out : null;
}

function extractUserIdHash(payload = {}) {
  const fromPayload = toTextOrNull(payload.user_id_hash || payload.userIdHash);
  if (fromPayload) return fromPayload;
  const rawUserId = toTextOrNull(payload.user_id || payload.userId);
  if (!rawUserId) return null;
  return hashValueForLogs(rawUserId, { label: 'user_id', length: 16 });
}

function round4(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

export function normalizeEconomicEventForStorage(eventType, payload = {}) {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const revenueEur = toFiniteOrNull(
    safePayload.revenue_eur ??
      safePayload.revenueEur ??
      safePayload.display_price ??
      safePayload.amount_paid_eur ??
      safePayload.price_eur
  );
  const providerCostEur = toFiniteOrNull(safePayload.provider_cost_eur ?? safePayload.provider_cost ?? safePayload.providerCostEur);
  const stripeFeeEur = toFiniteOrNull(safePayload.stripe_fee_eur ?? safePayload.stripeFeeEur);
  const aiCostEur = toFiniteOrNull(safePayload.ai_cost_eur ?? safePayload.aiCostEur);
  const platformOverheadEur = toFiniteOrNull(safePayload.platform_overhead_eur ?? safePayload.platformOverheadEur);
  const explicitGrossMargin = toFiniteOrNull(safePayload.gross_margin_eur ?? safePayload.grossMarginEur);
  const explicitNetMargin = toFiniteOrNull(safePayload.net_margin_eur ?? safePayload.netMarginEur);

  const grossMarginEur =
    explicitGrossMargin ??
    (revenueEur !== null && providerCostEur !== null ? round4(revenueEur - providerCostEur) : null);
  const netMarginEur =
    explicitNetMargin ??
    (grossMarginEur !== null
      ? round4(grossMarginEur - (stripeFeeEur || 0) - (aiCostEur || 0) - (platformOverheadEur || 0))
      : null);

  const grossMarginRate =
    toFiniteOrNull(safePayload.gross_margin_rate ?? safePayload.grossMarginRate) ??
    (revenueEur && grossMarginEur !== null ? round4(grossMarginEur / revenueEur) : null);
  const netMarginRate =
    toFiniteOrNull(safePayload.net_margin_rate ?? safePayload.netMarginRate) ??
    (revenueEur && netMarginEur !== null ? round4(netMarginEur / revenueEur) : null);

  const guardRulesArray = Array.isArray(safePayload.guard_rules)
    ? safePayload.guard_rules
    : Array.isArray(safePayload.rules_triggered)
    ? safePayload.rules_triggered
    : [];

  const mapped = {
    eventType: toTextOrNull(eventType) || 'economic_event',
    userIdHash: extractUserIdHash(safePayload),
    userTier: toTextOrNull(safePayload.user_tier ?? safePayload.plan_type ?? safePayload.userTier),
    at: toTextOrNull(safePayload.at),
    origin: toTextOrNull(safePayload.origin),
    destination: toTextOrNull(safePayload.destination),
    tripType: toTextOrNull(safePayload.trip_type ?? safePayload.tripType),
    revenueEur,
    providerCostEur,
    stripeFeeEur,
    aiCostEur,
    platformOverheadEur,
    grossMarginEur,
    netMarginEur,
    grossMarginRate,
    netMarginRate,
    offerCount: toFiniteOrNull(safePayload.offer_count ?? safePayload.offerCount),
    bookableCount: toFiniteOrNull(safePayload.bookable_count ?? safePayload.bookableCount),
    excludedCount: toFiniteOrNull(safePayload.excluded_count ?? safePayload.excludedCount),
    guardAction: toTextOrNull(safePayload.guard_action ?? safePayload.action),
    guardRules: guardRulesArray.length ? guardRulesArray.join(',') : toTextOrNull(safePayload.guard_rules),
    extra: {}
  };

  const payloadExtra = safePayload.extra && typeof safePayload.extra === 'object' ? safePayload.extra : {};
  const extra = { ...safePayload, ...payloadExtra };
  const mappedKeys = [
    'user_id_hash',
    'userIdHash',
    'user_id',
    'userId',
    'user_tier',
    'userTier',
    'plan_type',
    'event_type',
    'at',
    'origin',
    'destination',
    'trip_type',
    'tripType',
    'revenue_eur',
    'revenueEur',
    'display_price',
    'amount_paid_eur',
    'price_eur',
    'provider_cost_eur',
    'provider_cost',
    'providerCostEur',
    'stripe_fee_eur',
    'stripeFeeEur',
    'ai_cost_eur',
    'aiCostEur',
    'platform_overhead_eur',
    'platformOverheadEur',
    'gross_margin_eur',
    'grossMarginEur',
    'net_margin_eur',
    'netMarginEur',
    'gross_margin_rate',
    'grossMarginRate',
    'net_margin_rate',
    'netMarginRate',
    'offer_count',
    'offerCount',
    'bookable_count',
    'bookableCount',
    'excluded_count',
    'excludedCount',
    'guard_action',
    'action',
    'guard_rules',
    'rules_triggered'
  ];
  for (const key of mappedKeys) delete extra[key];
  delete extra.extra;
  mapped.extra = extra;

  return mapped;
}

/**
 * Logs a structured economic event.
 * @param {string} eventType - A snake_case identifier for the event (e.g., 'offer_priced', 'checkout_created').
 * @param {object} payload - The data payload for the event.
 */
export function logEconomicEvent(eventType, payload = {}) {
  const normalized = normalizeEconomicEventForStorage(eventType, payload);
  const {
    userIdHash,
    userTier,
    at,
    origin,
    destination,
    tripType,
    revenueEur,
    providerCostEur,
    stripeFeeEur,
    aiCostEur,
    platformOverheadEur,
    grossMarginEur,
    netMarginEur,
    grossMarginRate,
    netMarginRate,
    offerCount,
    bookableCount,
    excludedCount,
    guardAction,
    guardRules,
    extra
  } = normalized;

  logger.info(
    {
      category: 'economic',
      event_type: normalized.eventType,
      user_id_hash: userIdHash,
      user_tier: userTier,
      at,
      origin,
      destination,
      trip_type: tripType,
      revenue_eur: revenueEur,
      provider_cost_eur: providerCostEur,
      stripe_fee_eur: stripeFeeEur,
      ai_cost_eur: aiCostEur,
      platform_overhead_eur: platformOverheadEur,
      gross_margin_eur: grossMarginEur,
      net_margin_eur: netMarginEur,
      gross_margin_rate: grossMarginRate,
      net_margin_rate: netMarginRate,
      offer_count: offerCount,
      bookable_count: bookableCount,
      excluded_count: excludedCount,
      guard_action: guardAction,
      guard_rules: guardRules,
      extra
    },
    `economic_event: ${normalized.eventType}`
  );

  Promise.resolve(insertEconomicEvent(normalized)).catch((error) => {
    logger.warn(
      { err: error, event_type: normalized.eventType },
      'economic_event_persist_failed'
    );
  });
}
