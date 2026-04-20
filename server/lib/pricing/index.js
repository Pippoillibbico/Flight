/**
 * Pricing layer facade.
 * Includes pricing engine + margin guard utilities.
 */

export {
  applyPricingToOffer,
  computeFlightDisplayPrice,
  sanitizeOfferForClient,
  PRICING_CONSTANTS
} from '../pricing-engine.js';

export {
  computeEconomics,
  computeMinimumViablePrice,
  guardOffer,
  guardOfferMap,
  MARGIN_GUARD_CONFIG
} from '../margin-guard.js';
