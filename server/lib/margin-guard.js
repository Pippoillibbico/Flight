/**
 * margin-guard.js
 *
 * Economic protection layer applied after pricing-engine.
 * Ensures we do not sell offers below minimum target margin.
 */

import { logger } from './logger.js';
import { logEconomicEvent } from './economic-logger.js';

function readFiniteNumber(rawValue, fallback) {
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readRate(rawValue, fallback) {
  const parsed = readFiniteNumber(rawValue, fallback);
  // Accept both decimal (0.029) and percentage (2.9) formats.
  return parsed > 1 ? parsed / 100 : parsed;
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function round4(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

function envAlias(...keys) {
  for (const key of keys) {
    if (!key) continue;
    const value = process.env[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return undefined;
}

function isGuardEnabled() {
  const raw = String(process.env.MARGIN_GUARD_ENABLED ?? 'true').trim().toLowerCase();
  return raw !== 'false' && raw !== '0';
}

function resolveAction() {
  const raw = String(process.env.MARGIN_GUARD_ACTION ?? 'recalculate').trim().toLowerCase();
  if (raw === 'exclude') return 'exclude';
  if (raw === 'non_monetizable' || raw === 'mark_non_monetizable' || raw === 'mark') return 'non_monetizable';
  return 'recalculate';
}

const MIN_NET_MARGIN_EUR = Math.max(
  0,
  readFiniteNumber(envAlias('MARGIN_MIN_NET_EUR', 'MINIMUM_NET_MARGIN'), 3.0)
);

const MIN_NET_MARGIN_RATE = Math.max(
  0,
  Math.min(0.5, readRate(envAlias('MARGIN_MIN_NET_RATE'), 0.03))
);

const DUFFEL_COST_BUFFER_RATE = Math.max(
  0,
  Math.min(0.25, readRate(envAlias('MARGIN_DUFFEL_COST_BUFFER_RATE', 'ESTIMATED_DUFFEL_COST_BUFFER'), 0.005))
);

const STRIPE_FEE_RATE = Math.max(
  0,
  Math.min(0.5, readRate(envAlias('MARGIN_STRIPE_FEE_RATE', 'ESTIMATED_STRIPE_FEE_PERCENT'), 0.029))
);

const STRIPE_FEE_FIXED_EUR = Math.max(
  0,
  readFiniteNumber(envAlias('MARGIN_STRIPE_FEE_FIXED_EUR', 'ESTIMATED_STRIPE_FIXED_FEE'), 0.3)
);

const AI_COST_PER_TRANSACTION_EUR = Math.max(
  0,
  readFiniteNumber(envAlias('MARGIN_AI_COST_PER_TRANSACTION_EUR', 'ESTIMATED_AI_COST_PER_TRANSACTION'), 0.1)
);

const MAX_VIABLE_PRICE_MULTIPLIER = Math.max(
  1,
  readFiniteNumber(envAlias('MARGIN_MAX_VIABLE_PRICE_MULTIPLIER'), 2.5)
);

/**
 * Compute full economics for one offer.
 * @param {number} providerCost
 * @param {number} displayPrice
 */
export function computeEconomics(providerCost, displayPrice) {
  const safeProviderCost = Number(providerCost);
  const safeDisplayPrice = Number(displayPrice);

  const validProviderCost = Number.isFinite(safeProviderCost) && safeProviderCost > 0 ? safeProviderCost : 0;
  const validDisplayPrice = Number.isFinite(safeDisplayPrice) && safeDisplayPrice > 0 ? safeDisplayPrice : 0;

  const duffelBufferEur = validProviderCost * DUFFEL_COST_BUFFER_RATE;
  const adjustedProviderCost = validProviderCost + duffelBufferEur;

  const stripeFeeEur = validDisplayPrice * STRIPE_FEE_RATE + STRIPE_FEE_FIXED_EUR;
  const aiCostEur = AI_COST_PER_TRANSACTION_EUR;

  const totalCostEur = adjustedProviderCost + stripeFeeEur + aiCostEur;
  const revenueEur = validDisplayPrice;
  const grossMarginEur = revenueEur - adjustedProviderCost;
  const netMarginEur = revenueEur - totalCostEur;

  const grossMarginRate = revenueEur > 0 ? grossMarginEur / revenueEur : 0;
  const netMarginRate = revenueEur > 0 ? netMarginEur / revenueEur : 0;

  const passesNetMarginEur = netMarginEur >= MIN_NET_MARGIN_EUR;
  const passesNetMarginRate = netMarginRate >= MIN_NET_MARGIN_RATE;

  return {
    revenueEur: round2(revenueEur),
    providerCost: round2(validProviderCost),
    adjustedProviderCost: round2(adjustedProviderCost),
    duffelBufferEur: round2(duffelBufferEur),
    stripeFeeEur: round2(stripeFeeEur),
    aiCostEur: round2(aiCostEur),
    totalCostEur: round2(totalCostEur),
    grossMarginEur: round2(grossMarginEur),
    grossMarginRate: round4(grossMarginRate),
    netMarginEur: round2(netMarginEur),
    netMarginRate: round4(netMarginRate),
    passesNetMarginEur,
    passesNetMarginRate
  };
}

/**
 * Compute minimum viable display price satisfying both absolute and rate floors.
 * @param {number} providerCost
 */
export function computeMinimumViablePrice(providerCost) {
  const cost = Math.max(0, Number(providerCost) || 0);
  const adjustedCost = cost * (1 + DUFFEL_COST_BUFFER_RATE);
  const fixedCosts = STRIPE_FEE_FIXED_EUR + AI_COST_PER_TRANSACTION_EUR;

  const denominatorAbsolute = 1 - STRIPE_FEE_RATE;
  const denominatorRate = 1 - STRIPE_FEE_RATE - MIN_NET_MARGIN_RATE;

  const minFromAbsolute = denominatorAbsolute > 0
    ? (adjustedCost + fixedCosts + MIN_NET_MARGIN_EUR) / denominatorAbsolute
    : Number.POSITIVE_INFINITY;

  const minFromRate = denominatorRate > 0
    ? (adjustedCost + fixedCosts) / denominatorRate
    : Number.POSITIVE_INFINITY;

  const rawMin = Math.max(minFromAbsolute, minFromRate);
  if (!Number.isFinite(rawMin)) return Number.POSITIVE_INFINITY;

  // Round up to ensure constraints remain true after rounding.
  return Math.ceil(rawMin * 100) / 100;
}

function sanitizeContext(ctx) {
  const safe = ctx && typeof ctx === 'object' ? ctx : {};
  const userId = safe.userId ? String(safe.userId) : '';
  const redactedUser = userId ? `${userId.slice(0, 8)}...` : null;
  return {
    ...safe,
    ...(redactedUser ? { user_id_hash: redactedUser } : {}),
    userId: undefined
  };
}

/**
 * @typedef {'pass'|'recalculate'|'exclude'|'non_monetizable'} GuardAction
 */

/**
 * @param {object} offer
 * @param {object} [context]
 */
export function guardOffer(offer, context = {}) {
  if (!isGuardEnabled()) {
    return {
      action: 'pass',
      offer,
      economics: null,
      reason: null,
      rulesTriggered: [],
      guardEnabled: false
    };
  }

  const displayPrice = Number(offer?.totalPrice);
  const providerCost = Number(offer?._providerCost ?? offer?.totalPrice);
  const currency = String(offer?.currency || 'EUR').toUpperCase();

  if (!Number.isFinite(displayPrice) || displayPrice <= 0 || !Number.isFinite(providerCost) || providerCost <= 0) {
    logger.warn(
      {
        offer_id: offer?.liveOfferId,
        origin: offer?.originIata,
        dest: offer?.destinationIata,
        currency,
        display_price: displayPrice,
        provider_cost: providerCost,
        ...sanitizeContext(context)
      },
      'margin_guard_invalid_price_excluded'
    );
    return {
      action: 'exclude',
      offer: null,
      economics: null,
      reason: 'invalid_price',
      rulesTriggered: ['invalid_price'],
      guardEnabled: true
    };
  }

  const economics = computeEconomics(providerCost, displayPrice);
  const rulesTriggered = [];
  if (!economics.passesNetMarginEur) rulesTriggered.push('net_margin_below_absolute_floor');
  if (!economics.passesNetMarginRate) rulesTriggered.push('net_margin_below_rate_floor');

  if (rulesTriggered.length === 0) {
    // Log successful, profitable offer generation
    logEconomicEvent('offer_priced', {
      offer_id: offer?.liveOfferId,
      origin: offer?.originIata,
      destination: offer?.destinationIata,
      display_price: economics.revenueEur,
      provider_cost: economics.providerCost,
      net_margin_eur: economics.netMarginEur,
      net_margin_rate: economics.netMarginRate,
      gross_margin_eur: economics.grossMarginEur,
      economics_breakdown: { ...economics }
    });

    return {
      action: 'pass',
      offer,
      economics,
      reason: null,
      rulesTriggered: [],
      guardEnabled: true
    };
  }

  const configuredAction = resolveAction();

  logger.warn(
    {
      offer_id: offer?.liveOfferId,
      origin: offer?.originIata,
      dest: offer?.destinationIata,
      currency,
      display_price: displayPrice,
      provider_cost: providerCost,
      net_margin_eur: economics.netMarginEur,
      net_margin_rate: economics.netMarginRate,
      min_net_margin_eur: MIN_NET_MARGIN_EUR,
      min_net_margin_rate: MIN_NET_MARGIN_RATE,
      rules_triggered: rulesTriggered,
      configured_action: configuredAction,
      ...sanitizeContext(context)
    },
    'margin_guard_below_minimum'
  );

  if (configuredAction === 'exclude') {
    logEconomicEvent('offer_excluded', {
      user_id: context?.userId || null,
      origin: offer?.originIata || null,
      destination: offer?.destinationIata || null,
      trip_type: offer?.tripType || null,
      revenue_eur: economics.revenueEur,
      provider_cost_eur: economics.providerCost,
      stripe_fee_eur: economics.stripeFeeEur,
      ai_cost_eur: economics.aiCostEur,
      gross_margin_eur: economics.grossMarginEur,
      net_margin_eur: economics.netMarginEur,
      gross_margin_rate: economics.grossMarginRate,
      net_margin_rate: economics.netMarginRate,
      guard_action: 'exclude',
      guard_rules: rulesTriggered,
      offer_count: 1,
      bookable_count: 0,
      excluded_count: 1,
      extra: {
        offer_id: offer?.liveOfferId || null,
        configured_action: configuredAction
      }
    });

    logger.info(
      {
        offer_id: offer?.liveOfferId,
        dest: offer?.destinationIata,
        reason: rulesTriggered[0] ?? 'below_minimum_margin',
        rules_triggered: rulesTriggered,
        ...sanitizeContext(context)
      },
      'margin_guard_offer_excluded'
    );
    return {
      action: 'exclude',
      offer: null,
      economics,
      reason: rulesTriggered[0] ?? 'below_minimum_margin',
      rulesTriggered,
      guardEnabled: true
    };
  }

  if (configuredAction === 'non_monetizable') {
    const flaggedOffer = {
      ...offer,
      _guardNonMonetizable: true,
      _guardReason: rulesTriggered[0] ?? 'below_minimum_margin'
    };

    logEconomicEvent('offer_marked_non_monetizable', {
      user_id: context?.userId || null,
      origin: offer?.originIata || null,
      destination: offer?.destinationIata || null,
      trip_type: offer?.tripType || null,
      revenue_eur: economics.revenueEur,
      provider_cost_eur: economics.providerCost,
      stripe_fee_eur: economics.stripeFeeEur,
      ai_cost_eur: economics.aiCostEur,
      gross_margin_eur: economics.grossMarginEur,
      net_margin_eur: economics.netMarginEur,
      gross_margin_rate: economics.grossMarginRate,
      net_margin_rate: economics.netMarginRate,
      guard_action: 'non_monetizable',
      guard_rules: rulesTriggered,
      offer_count: 1,
      bookable_count: 0,
      excluded_count: 1,
      extra: {
        offer_id: offer?.liveOfferId || null,
        configured_action: configuredAction
      }
    });

    logger.info(
      {
        offer_id: offer?.liveOfferId,
        dest: offer?.destinationIata,
        reason: flaggedOffer._guardReason,
        rules_triggered: rulesTriggered,
        ...sanitizeContext(context)
      },
      'margin_guard_offer_marked_non_monetizable'
    );

    return {
      action: 'non_monetizable',
      offer: flaggedOffer,
      economics,
      reason: rulesTriggered[0] ?? 'below_minimum_margin',
      rulesTriggered,
      guardEnabled: true
    };
  }

  const minViablePrice = computeMinimumViablePrice(providerCost);
  const hardCeiling = providerCost * MAX_VIABLE_PRICE_MULTIPLIER;

  if (!Number.isFinite(minViablePrice) || minViablePrice > hardCeiling) {
    logger.warn(
      {
        offer_id: offer?.liveOfferId,
        dest: offer?.destinationIata,
        provider_cost: providerCost,
        min_viable_price: minViablePrice,
        hard_ceiling: hardCeiling,
        rules_triggered: rulesTriggered,
        ...sanitizeContext(context)
      },
      'margin_guard_recalculate_ceiling_exceeded_excluded'
    );
    return {
      action: 'exclude',
      offer: null,
      economics,
      reason: 'recalculate_ceiling_exceeded',
      rulesTriggered: [...rulesTriggered, 'recalculate_ceiling_exceeded'],
      guardEnabled: true
    };
  }

  const recalculatedEconomics = computeEconomics(providerCost, minViablePrice);
  const recalculatedOffer = {
    ...offer,
    totalPrice: minViablePrice,
    _marginApplied: round2(minViablePrice - providerCost),
    _marginRate: providerCost > 0 ? round4((minViablePrice - providerCost) / providerCost) : 0,
    _guardRecalculated: true,
    _originalDisplayPrice: displayPrice
  };

  logger.info(
    {
      offer_id: offer?.liveOfferId,
      dest: offer?.destinationIata,
      original_price: displayPrice,
      recalculated_price: minViablePrice,
      provider_cost: providerCost,
      new_net_margin_eur: recalculatedEconomics.netMarginEur,
      rules_triggered: rulesTriggered,
      ...sanitizeContext(context)
    },
    'margin_guard_price_recalculated'
  );

  logEconomicEvent('offer_repriced', {
    user_id: context?.userId || null,
    origin: offer?.originIata || null,
    destination: offer?.destinationIata || null,
    trip_type: offer?.tripType || null,
    revenue_eur: recalculatedEconomics.revenueEur,
    provider_cost_eur: recalculatedEconomics.providerCost,
    stripe_fee_eur: recalculatedEconomics.stripeFeeEur,
    ai_cost_eur: recalculatedEconomics.aiCostEur,
    gross_margin_eur: recalculatedEconomics.grossMarginEur,
    net_margin_eur: recalculatedEconomics.netMarginEur,
    gross_margin_rate: recalculatedEconomics.grossMarginRate,
    net_margin_rate: recalculatedEconomics.netMarginRate,
    guard_action: 'recalculate',
    guard_rules: rulesTriggered,
    offer_count: 1,
    bookable_count: 1,
    excluded_count: 0,
    extra: {
      offer_id: offer?.liveOfferId || null,
      original_display_price: displayPrice,
      recalculated_display_price: minViablePrice
    }
  });

  return {
    action: 'recalculate',
    offer: recalculatedOffer,
    economics: recalculatedEconomics,
    reason: rulesTriggered[0] ?? 'below_minimum_margin',
    rulesTriggered,
    guardEnabled: true
  };
}

/**
 * Apply guard to a map of offers.
 * @param {Record<string, object>} pricedOffersByDest
 * @param {object} [context]
 */
export function guardOfferMap(pricedOffersByDest, context = {}) {
  const source = pricedOffersByDest && typeof pricedOffersByDest === 'object' ? pricedOffersByDest : {};
  const filtered = {};
  const stats = {
    total: 0,
    passed: 0,
    recalculated: 0,
    nonMonetizable: 0,
    excluded: 0
  };

  for (const [dest, offer] of Object.entries(source)) {
    stats.total += 1;
    const result = guardOffer(offer, { ...context, destinationIata: dest });

    if (result.action === 'exclude') {
      stats.excluded += 1;
      filtered[dest] = null;
      continue;
    }
    if (result.action === 'non_monetizable') {
      stats.nonMonetizable += 1;
      filtered[dest] = result.offer;
      continue;
    }
    if (result.action === 'recalculate') {
      stats.recalculated += 1;
      filtered[dest] = result.offer;
      continue;
    }

    stats.passed += 1;
    filtered[dest] = result.offer;
  }

  if (stats.excluded > 0 || stats.recalculated > 0 || stats.nonMonetizable > 0) {
    logger.info(
      {
        ...stats,
        ...sanitizeContext(context)
      },
      'margin_guard_bulk_summary'
    );
  }

  return { filtered, stats };
}

export const MARGIN_GUARD_CONFIG = {
  MIN_NET_MARGIN_EUR,
  MIN_NET_MARGIN_RATE,
  DUFFEL_COST_BUFFER_RATE,
  STRIPE_FEE_RATE,
  STRIPE_FEE_FIXED_EUR,
  AI_COST_PER_TRANSACTION_EUR,
  MAX_VIABLE_PRICE_MULTIPLIER
};
