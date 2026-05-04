import { parseFlag } from './env-flags.js';

function hasValue(value, minLength = 8) {
  return String(value || '').trim().length >= minLength;
}

export function isLiveFlightProviderEnabled(env = process.env) {
  const duffelReady = parseFlag(env.ENABLE_PROVIDER_DUFFEL, false) && hasValue(env.DUFFEL_API_KEY, 8);
  return duffelReady;
}

export function assertLiveFlightProviderInProduction(env = process.env) {
  const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  if (!isProduction) return;
  if (!isLiveFlightProviderEnabled(env)) {
    throw new Error('[FATAL] A live flight provider must be enabled in production');
  }
}
