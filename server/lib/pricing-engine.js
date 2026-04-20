/**
 * pricing-engine.js
 *
 * Converts raw provider costs (Duffel) into final display prices that include:
 * - margin floor
 * - dynamic contextual margin
 * - Stripe fee estimate
 * - AI and platform overhead
 *
 * IMPORTANT:
 * - frontend must only use displayPrice/totalPrice
 * - raw provider cost is kept only in internal fields (_providerCost, _marginApplied, ...)
 */

function readFiniteNumber(rawValue, fallback) {
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const BASE_MARGIN_RATE = Math.max(0, Math.min(0.5, readFiniteNumber(process.env.PRICING_BASE_MARGIN_RATE, 0.08)));
const MIN_ABSOLUTE_MARGIN_EUR = Math.max(0, readFiniteNumber(process.env.PRICING_MIN_ABSOLUTE_MARGIN_EUR, 4.5));
const MAX_ABSOLUTE_MARGIN_EUR = Math.max(0, readFiniteNumber(process.env.PRICING_MAX_ABSOLUTE_MARGIN_EUR, 80));

const STRIPE_FEE_RATE = Math.max(0, readFiniteNumber(process.env.PRICING_STRIPE_FEE_RATE, 0.029));
const STRIPE_FEE_FIXED_EUR = Math.max(0, readFiniteNumber(process.env.PRICING_STRIPE_FEE_FIXED_EUR, 0.3));

const AI_COST_PER_REQUEST_EUR = Math.max(0, readFiniteNumber(process.env.PRICING_AI_COST_PER_REQUEST_EUR, 0.1));
const PLATFORM_OVERHEAD_EUR = Math.max(0, readFiniteNumber(process.env.PRICING_PLATFORM_OVERHEAD_EUR, 0.05));

const LAST_MINUTE_DAYS = Math.max(1, readFiniteNumber(process.env.PRICING_LAST_MINUTE_DAYS, 7));

const DYNAMIC_RATE_PREMIUM_USER = readFiniteNumber(process.env.PRICING_DYNAMIC_RATE_PREMIUM_USER, 0.03);
const DYNAMIC_RATE_LAST_MINUTE = readFiniteNumber(process.env.PRICING_DYNAMIC_RATE_LAST_MINUTE, 0.02);
const DYNAMIC_RATE_POPULAR_ROUTE = readFiniteNumber(process.env.PRICING_DYNAMIC_RATE_POPULAR_ROUTE, 0.01);
const DYNAMIC_RATE_SMART_DEAL = readFiniteNumber(process.env.PRICING_DYNAMIC_RATE_SMART_DEAL, -0.01);
const DYNAMIC_RATE_PREMIUM_DEAL = readFiniteNumber(process.env.PRICING_DYNAMIC_RATE_PREMIUM_DEAL, 0.01);
const DYNAMIC_RATE_DEVICE_MOBILE = readFiniteNumber(process.env.PRICING_DYNAMIC_RATE_DEVICE_MOBILE, -0.004);
const DYNAMIC_RATE_RETURNING_USER = readFiniteNumber(process.env.PRICING_DYNAMIC_RATE_RETURNING_USER, -0.003);
const DYNAMIC_RATE_LOW_PRICE = readFiniteNumber(process.env.PRICING_DYNAMIC_RATE_LOW_PRICE, 0.025);
const DYNAMIC_RATE_HIGH_PRICE = readFiniteNumber(process.env.PRICING_DYNAMIC_RATE_HIGH_PRICE, -0.008);

const LOW_PRICE_THRESHOLD_EUR = Math.max(0, readFiniteNumber(process.env.PRICING_LOW_PRICE_THRESHOLD_EUR, 80));
const HIGH_PRICE_THRESHOLD_EUR = Math.max(
  LOW_PRICE_THRESHOLD_EUR,
  readFiniteNumber(process.env.PRICING_HIGH_PRICE_THRESHOLD_EUR, 950)
);

const MAX_DYNAMIC_RATE_ADDER = Math.max(0, readFiniteNumber(process.env.PRICING_MAX_DYNAMIC_RATE_ADDER, 0.35));
const MIN_DYNAMIC_RATE_ADDER = Math.min(0, readFiniteNumber(process.env.PRICING_MIN_DYNAMIC_RATE_ADDER, -0.08));

function isPricingEnabled() {
  const value = String(process.env.PRICING_ENABLED ?? 'true').trim().toLowerCase();
  return value !== 'false' && value !== '0';
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeCurrency(value) {
  const code = String(value || 'EUR').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : 'EUR';
}

/**
 * @typedef {Object} PricingContext
 * @property {'free'|'pro'|'creator'|'elite'} [userTier]
 * @property {'mobile'|'desktop'} [deviceType]
 * @property {boolean} [isReturningUser]
 * @property {boolean} [isLastMinute]
 * @property {boolean} [isPopularRoute]
 * @property {boolean} [isSmartDeal]
 * @property {boolean} [isPremiumDeal]
 * @property {string|null} [departureDate]
 */

/**
 * @param {PricingContext} context
 * @param {number} providerCost
 */
function computeDynamicRate(context = {}, providerCost = 0) {
  let adder = 0;

  const tier = String(context.userTier || 'free').toLowerCase();
  if (tier === 'pro' || tier === 'creator' || tier === 'elite') {
    adder += DYNAMIC_RATE_PREMIUM_USER;
  }

  let isLastMinute = Boolean(context.isLastMinute);
  if (!isLastMinute && context.departureDate) {
    const daysUntilDeparture = (new Date(context.departureDate).getTime() - Date.now()) / 86_400_000;
    isLastMinute = Number.isFinite(daysUntilDeparture) && daysUntilDeparture >= 0 && daysUntilDeparture <= LAST_MINUTE_DAYS;
  }
  if (isLastMinute) adder += DYNAMIC_RATE_LAST_MINUTE;

  if (Boolean(context.isPopularRoute)) adder += DYNAMIC_RATE_POPULAR_ROUTE;
  if (Boolean(context.isSmartDeal)) adder += DYNAMIC_RATE_SMART_DEAL;
  if (Boolean(context.isPremiumDeal)) adder += DYNAMIC_RATE_PREMIUM_DEAL;

  const deviceType = String(context.deviceType || 'desktop').toLowerCase();
  if (deviceType === 'mobile') adder += DYNAMIC_RATE_DEVICE_MOBILE;

  if (Boolean(context.isReturningUser)) adder += DYNAMIC_RATE_RETURNING_USER;

  if (providerCost > 0 && providerCost <= LOW_PRICE_THRESHOLD_EUR) adder += DYNAMIC_RATE_LOW_PRICE;
  if (providerCost >= HIGH_PRICE_THRESHOLD_EUR) adder += DYNAMIC_RATE_HIGH_PRICE;

  return clamp(adder, MIN_DYNAMIC_RATE_ADDER, MAX_DYNAMIC_RATE_ADDER);
}

/**
 * @param {number} providerCost
 * @param {string} [currency]
 * @param {PricingContext} [context]
 */
export function computeFlightDisplayPrice(providerCost, currency = 'EUR', context = {}) {
  const cost = Number(providerCost);
  const safeCurrency = normalizeCurrency(currency);

  if (!Number.isFinite(cost) || cost <= 0) {
    return {
      displayPrice: cost,
      providerCost: cost,
      currency: safeCurrency,
      marginApplied: 0,
      marginRate: 0,
      pricingEnabled: false,
      breakdown: {
        baseMarginEur: 0,
        dynamicRateAdder: 0,
        stripeFeeEur: 0,
        aiCostEur: 0,
        platformOverheadEur: 0,
        minFloorApplied: false,
        maxCapApplied: false
      }
    };
  }

  if (!isPricingEnabled()) {
    return {
      displayPrice: cost,
      providerCost: cost,
      currency: safeCurrency,
      marginApplied: 0,
      marginRate: 0,
      pricingEnabled: false,
      breakdown: {
        baseMarginEur: 0,
        dynamicRateAdder: 0,
        stripeFeeEur: 0,
        aiCostEur: 0,
        platformOverheadEur: 0,
        minFloorApplied: false,
        maxCapApplied: false
      }
    };
  }

  const dynamicRateAdder = computeDynamicRate(context, cost);
  const totalRate = clamp(BASE_MARGIN_RATE + dynamicRateAdder, 0, 0.75);

  const baseMarginEur = cost * totalRate;
  const stripeFeeEur = cost * STRIPE_FEE_RATE + STRIPE_FEE_FIXED_EUR;
  const aiCostEur = AI_COST_PER_REQUEST_EUR;
  const platformOverheadEur = PLATFORM_OVERHEAD_EUR;

  let totalMargin = baseMarginEur + stripeFeeEur + aiCostEur + platformOverheadEur;

  let minFloorApplied = false;
  if (totalMargin < MIN_ABSOLUTE_MARGIN_EUR) {
    totalMargin = MIN_ABSOLUTE_MARGIN_EUR;
    minFloorApplied = true;
  }

  let maxCapApplied = false;
  if (MAX_ABSOLUTE_MARGIN_EUR > 0 && totalMargin > MAX_ABSOLUTE_MARGIN_EUR) {
    totalMargin = MAX_ABSOLUTE_MARGIN_EUR;
    maxCapApplied = true;
  }

  const displayPrice = Math.round((cost + totalMargin) * 100) / 100;
  const marginApplied = Math.round((displayPrice - cost) * 100) / 100;
  const marginRate = cost > 0 ? marginApplied / cost : 0;

  return {
    displayPrice,
    providerCost: cost,
    currency: safeCurrency,
    marginApplied,
    marginRate,
    pricingEnabled: true,
    breakdown: {
      baseMarginEur: Math.round(baseMarginEur * 100) / 100,
      dynamicRateAdder,
      stripeFeeEur: Math.round(stripeFeeEur * 100) / 100,
      aiCostEur,
      platformOverheadEur,
      minFloorApplied,
      maxCapApplied
    }
  };
}

/**
 * @typedef {Object<string, unknown> & { totalPrice?: number, currency?: string }} PricingOffer
 */

/**
 * @param {PricingOffer} offer
 * @param {PricingContext} [context]
 */
export function applyPricingToOffer(offer, context = {}) {
  const raw = Number(offer?.totalPrice);
  const currency = normalizeCurrency(offer?.currency);

  const result = computeFlightDisplayPrice(raw, currency, context);

  return {
    ...offer,
    totalPrice: result.displayPrice,
    _providerCost: result.providerCost,
    _marginApplied: result.marginApplied,
    _marginRate: result.marginRate,
    _pricingEnabled: result.pricingEnabled
  };
}

/**
 * @param {object | null | undefined} pricedOffer
 */
export function sanitizeOfferForClient(pricedOffer) {
  if (!pricedOffer || typeof pricedOffer !== 'object') return pricedOffer;

  const {
    _providerCost: _a,
    _marginApplied: _b,
    _marginRate: _c,
    _pricingEnabled: _d,
    _guardAction: _e,
    _guardRecalculated: _f,
    _guardExcluded: _g,
    _guardReason: _h,
    _originalDisplayPrice: _i,
    ...safe
  } = pricedOffer;
  return safe;
}

export const PRICING_CONSTANTS = {
  BASE_MARGIN_RATE,
  MIN_ABSOLUTE_MARGIN_EUR,
  MAX_ABSOLUTE_MARGIN_EUR,
  STRIPE_FEE_RATE,
  STRIPE_FEE_FIXED_EUR,
  AI_COST_PER_REQUEST_EUR,
  PLATFORM_OVERHEAD_EUR,
  LAST_MINUTE_DAYS,
  LOW_PRICE_THRESHOLD_EUR,
  HIGH_PRICE_THRESHOLD_EUR
};
