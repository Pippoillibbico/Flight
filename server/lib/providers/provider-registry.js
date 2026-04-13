import { DuffelProvider } from './duffel-provider.js';
import { AmadeusProvider } from './amadeus-provider.js';
import { parseFlag } from '../env-flags.js';
import { logger } from '../logger.js';

const providerWarnState = new Map();

function parseIntSafe(value, fallback) {
  const out = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(out) ? out : fallback;
}

function logWarnThrottled(key, payload, message, intervalMs) {
  const nowTs = Date.now();
  const lastTs = Number(providerWarnState.get(key) || 0);
  if (nowTs - lastTs < intervalMs) return;
  providerWarnState.set(key, nowTs);
  logger.warn(payload, message);
}

function withTimeout(promise, timeoutMs, { providerName = 'provider' } = {}) {
  const safeTimeoutMs = Math.max(200, Number(timeoutMs) || 12000);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`provider_timeout:${providerName}`));
    }, safeTimeoutMs);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function toDateValue(value) {
  const out = value ? new Date(value) : null;
  if (!out || Number.isNaN(out.getTime())) return null;
  return out;
}

function validateOfferQuality(offer) {
  const originIata = String(offer?.originIata || '').trim().toUpperCase();
  const destinationIata = String(offer?.destinationIata || '').trim().toUpperCase();
  const departureDate = String(offer?.departureDate || '').trim();
  const returnDate = offer?.returnDate ? String(offer.returnDate).trim() : null;
  const tripType = String(offer?.tripType || '').trim().toLowerCase();
  const totalPrice = Number(offer?.totalPrice);
  const currency = String(offer?.currency || '').trim().toUpperCase();
  const stops = Number(offer?.metadata?.stops ?? offer?.metadata?.totalStops);
  const durationMinutes = Number(offer?.metadata?.durationMinutes ?? offer?.metadata?.totalDurationMinutes);

  if (!/^[A-Z]{3}$/.test(originIata) || !/^[A-Z]{3}$/.test(destinationIata)) return { ok: false, reason: 'invalid_iata' };
  if (originIata === destinationIata) return { ok: false, reason: 'same_origin_destination' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(departureDate)) return { ok: false, reason: 'invalid_departure_date' };
  if (!Number.isFinite(totalPrice) || totalPrice <= 0) return { ok: false, reason: 'invalid_price' };
  if (totalPrice < 10 || totalPrice > 20000) return { ok: false, reason: 'outlier_price' };
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, reason: 'invalid_currency' };

  if (tripType === 'round_trip') {
    if (!returnDate || !/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) return { ok: false, reason: 'round_trip_missing_return' };
    const from = toDateValue(departureDate);
    const to = toDateValue(returnDate);
    if (!from || !to || to <= from) return { ok: false, reason: 'round_trip_invalid_dates' };
  }

  if (tripType === 'one_way' && returnDate) return { ok: false, reason: 'one_way_has_return' };
  if (Number.isFinite(stops) && stops > 3) return { ok: false, reason: 'too_many_stops' };
  if (Number.isFinite(durationMinutes) && (durationMinutes < 30 || durationMinutes > 48 * 60)) return { ok: false, reason: 'unrealistic_duration' };

  return { ok: true };
}

function buildProviderError(code, detail = {}) {
  const error = new Error(String(code || 'provider_error'));
  error.code = String(code || 'provider_error');
  if (detail && typeof detail === 'object') {
    Object.assign(error, detail);
  }
  return error;
}

export function createProviderRegistry(options = {}) {
  const circuitFailureThreshold = Math.max(1, parseIntSafe(process.env.PROVIDER_CIRCUIT_FAILURE_THRESHOLD, 3));
  const circuitOpenMs = Math.max(1000, parseIntSafe(process.env.PROVIDER_CIRCUIT_OPEN_MS, 30000));
  const providerSearchTimeoutMs = Math.max(
    200,
    parseIntSafe(process.env.PROVIDER_SEARCH_TIMEOUT_MS, parseIntSafe(process.env.PROVIDER_REQUEST_TIMEOUT_MS, 12000))
  );
  const isProd = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const allowStubProviders = parseFlag(process.env.ALLOW_STUB_PROVIDERS, false);
  const circuitSkipLogIntervalMs = Math.max(1_000, parseIntSafe(process.env.PROVIDER_CIRCUIT_SKIP_LOG_INTERVAL_MS, 60_000));
  const providerConfigWarnIntervalMs = Math.max(
    30_000,
    parseIntSafe(process.env.PROVIDER_CONFIG_WARNING_INTERVAL_MS, 10 * 60_000)
  );

  const providers = Array.isArray(options?.providers) && options.providers.length > 0
    ? options.providers
    : [
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

  const runtimeByProvider = new Map(
    providers.map((provider) => [
      provider.name,
      {
        failures: 0,
        successes: 0,
        totalSearches: 0,
        rejectedOffers: 0,
        openedUntil: 0
      }
    ])
  );
  const lastCircuitSkipLogAtByProvider = new Map();

  const enabled = providers.filter((provider) => provider.isEnabled());
  for (const provider of enabled) {
    if (!provider.isConfigured()) {
      logWarnThrottled(
        `provider_enabled_but_not_configured:${provider.name}`,
        { provider: provider.name },
        'provider_enabled_but_not_configured',
        providerConfigWarnIntervalMs
      );
    }
    if (isProd && typeof provider.isStub === 'function' && provider.isStub() && !allowStubProviders) {
      logWarnThrottled(
        `provider_stub_disabled_in_production:${provider.name}`,
        { provider: provider.name },
        'provider_stub_disabled_in_production',
        providerConfigWarnIntervalMs
      );
    }
  }

  function getRuntime(providerName) {
    if (!runtimeByProvider.has(providerName)) {
      runtimeByProvider.set(providerName, { failures: 0, successes: 0, totalSearches: 0, rejectedOffers: 0, openedUntil: 0 });
    }
    return runtimeByProvider.get(providerName);
  }

  function isCircuitOpen(providerName) {
    const state = getRuntime(providerName);
    return Number(state.openedUntil || 0) > Date.now();
  }

  function openCircuit(providerName) {
    const state = getRuntime(providerName);
    state.openedUntil = Date.now() + circuitOpenMs;
  }

  function runtimeSnapshot(provider) {
    const state = getRuntime(provider.name);
    return {
      name: provider.name,
      enabled: provider.isEnabled(),
      configured: provider.isConfigured(),
      stub: typeof provider.isStub === 'function' ? provider.isStub() : false,
      circuitOpen: isCircuitOpen(provider.name),
      circuitFailureThreshold,
      circuitOpenMs,
      providerSearchTimeoutMs,
      failures: Number(state.failures || 0),
      successes: Number(state.successes || 0),
      totalSearches: Number(state.totalSearches || 0),
      rejectedOffers: Number(state.rejectedOffers || 0),
      openedUntil: Number(state.openedUntil || 0) || null
    };
  }

  return {
    listProviders() {
      return providers.map(runtimeSnapshot);
    },
    runtimeStats() {
      return providers.map(runtimeSnapshot);
    },
    async searchOffers(params) {
      const configured = enabled
        .filter((provider) => provider.isConfigured())
        .filter((provider) => {
          const stub = typeof provider.isStub === 'function' ? provider.isStub() : false;
          if (isProd && stub && !allowStubProviders) return false;
          return true;
        });
      const available = configured.filter((provider) => !isCircuitOpen(provider.name));
      const skipped = configured.filter((provider) => isCircuitOpen(provider.name));
      const nowTs = Date.now();
      for (const provider of skipped) {
        const lastLoggedAt = Number(lastCircuitSkipLogAtByProvider.get(provider.name) || 0);
        if (nowTs - lastLoggedAt >= circuitSkipLogIntervalMs) {
          logger.warn({ provider: provider.name }, 'provider_search_skipped_circuit_open');
          lastCircuitSkipLogAtByProvider.set(provider.name, nowTs);
        }
      }

      if (configured.length > 0 && available.length === 0) {
        throw buildProviderError('provider_circuit_open_all', {
          configuredProviders: configured.map((provider) => provider.name),
          skippedProviders: skipped.map((provider) => provider.name)
        });
      }

      const settled = await Promise.allSettled(
        available.map(async (provider) => ({
          provider: provider.name,
          rows: await withTimeout(provider.searchOffers(params), providerSearchTimeoutMs, {
            providerName: provider.name
          })
        }))
      );
      const out = [];
      const rejectedByReason = {};
      let rejectedProviders = 0;
      let fulfilledProviders = 0;

      for (let i = 0; i < settled.length; i += 1) {
        const item = settled[i];
        const providerName = available[i]?.name || 'provider';
        const state = getRuntime(providerName);
        state.totalSearches += 1;

        if (item.status === 'rejected') {
          rejectedProviders += 1;
          state.failures += 1;
          if (state.failures >= circuitFailureThreshold) openCircuit(providerName);
          logger.warn({ provider: providerName, err: item.reason?.message || String(item.reason) }, 'provider_search_failed');
          continue;
        }

        fulfilledProviders += 1;
        state.failures = 0;
        state.successes += 1;
        const rows = Array.isArray(item.value.rows) ? item.value.rows : [];
        let accepted = 0;
        let rejected = 0;
        for (const row of rows) {
          const verdict = validateOfferQuality(row);
          if (!verdict.ok) {
            rejectedByReason[verdict.reason] = Number(rejectedByReason[verdict.reason] || 0) + 1;
            rejected += 1;
            continue;
          }
          out.push(row);
          accepted += 1;
        }
        state.rejectedOffers += rejected;
        logger.info(
          { provider: providerName, total: rows.length, accepted, rejected },
          'provider_search_completed'
        );
      }

      if (Object.keys(rejectedByReason).length > 0) {
        logger.info({ rejectedByReason }, 'provider_search_filtered_invalid_offers');
      }

      if (available.length > 0 && fulfilledProviders === 0 && rejectedProviders === available.length) {
        throw buildProviderError('provider_search_all_failed', {
          attemptedProviders: available.map((provider) => provider.name)
        });
      }
      return out;
    }
  };
}
