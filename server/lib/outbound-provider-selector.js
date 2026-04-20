const COMMISSION_MODELS = Object.freeze({
  travelpayouts: { type: 'cpa_pct', rate: 0.018, minEur: 0.4, maxEur: 35 },
  kiwi: { type: 'cpa_pct', rate: 0.02, minEur: 0.5, maxEur: 40 },
  skyscanner: { type: 'cpc_eur', flatEur: 0.45 },
  tde_booking: { type: 'none' },
  duffel_link: { type: 'none' }
});

function estimateCommission(provider, price) {
  const model = COMMISSION_MODELS[provider] || COMMISSION_MODELS.tde_booking;
  if (model.type === 'cpa_pct') {
    const raw = Number(price || 0) * model.rate;
    return Math.round(Math.min(model.maxEur, Math.max(model.minEur, raw)) * 100) / 100;
  }
  if (model.type === 'cpc_eur') return model.flatEur;
  return 0;
}

function asNonEmptyString(value) {
  const text = String(value || '').trim();
  return text || null;
}

function isHttpUrl(value) {
  const urlText = asNonEmptyString(value);
  if (!urlText) return false;
  try {
    const parsed = new URL(urlText);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function readDuffelLinkFromDeal(deal) {
  const candidates = [
    deal?.duffel_booking_url,
    deal?.duffel_booking_link,
    deal?.booking_url_provider,
    deal?.metadata?.duffel_booking_url,
    deal?.metadata?.duffel_booking_link,
    deal?.metadata?.duffel_offer_url
  ];
  for (const candidate of candidates) {
    if (isHttpUrl(candidate)) return String(candidate);
  }
  return null;
}

export function selectOutboundProvider({ deal, forceProvider = null, affiliateConfig }) {
  if (forceProvider) {
    const forced = String(forceProvider).trim().toLowerCase();
    return {
      provider: forced,
      directUrl: null,
      estimatedCommission: estimateCommission(forced, deal?.price || 0)
    };
  }

  const duffelLink = readDuffelLinkFromDeal(deal);
  if (duffelLink) {
    return {
      provider: 'duffel_link',
      directUrl: duffelLink,
      estimatedCommission: 0
    };
  }

  if (affiliateConfig?.travelpayoutsConfigured) {
    return {
      provider: 'travelpayouts',
      directUrl: null,
      estimatedCommission: estimateCommission('travelpayouts', deal?.price || 0)
    };
  }

  if (affiliateConfig?.kiwiConfigured) {
    return {
      provider: 'kiwi',
      directUrl: null,
      estimatedCommission: estimateCommission('kiwi', deal?.price || 0)
    };
  }

  if (affiliateConfig?.skyscannerConfigured) {
    return {
      provider: 'skyscanner',
      directUrl: null,
      estimatedCommission: estimateCommission('skyscanner', deal?.price || 0)
    };
  }

  return {
    provider: 'tde_booking',
    directUrl: null,
    estimatedCommission: 0
  };
}
