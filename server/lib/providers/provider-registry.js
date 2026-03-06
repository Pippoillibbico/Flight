import { DuffelProvider } from './duffel-provider.js';
import { AmadeusProvider } from './amadeus-provider.js';
import { logger } from '../logger.js';

function parseFlag(value, fallback = false) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(text);
}

export function createProviderRegistry() {
  const providers = [
    new DuffelProvider({
      enabled: parseFlag(process.env.ENABLE_PROVIDER_DUFFEL, false),
      apiKey: process.env.DUFFEL_API_KEY
    }),
    new AmadeusProvider({
      enabled: parseFlag(process.env.ENABLE_PROVIDER_AMADEUS, false),
      clientId: process.env.AMADEUS_CLIENT_ID,
      clientSecret: process.env.AMADEUS_CLIENT_SECRET
    })
  ];

  const enabled = providers.filter((provider) => provider.isEnabled());
  for (const provider of enabled) {
    if (!provider.isConfigured()) {
      logger.warn({ provider: provider.name }, 'provider_enabled_but_not_configured');
    }
  }

  return {
    listProviders() {
      return providers.map((provider) => ({
        name: provider.name,
        enabled: provider.isEnabled(),
        configured: provider.isConfigured()
      }));
    },
    async searchOffers(params) {
      const out = [];
      for (const provider of enabled) {
        if (!provider.isConfigured()) continue;
        try {
          const rows = await provider.searchOffers(params);
          if (Array.isArray(rows) && rows.length) out.push(...rows);
        } catch (error) {
          logger.warn({ provider: provider.name, err: error?.message || String(error) }, 'provider_search_failed');
        }
      }
      return out;
    }
  };
}
