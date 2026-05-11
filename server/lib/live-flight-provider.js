import { getProviderReadiness } from './readiness.js';

export function isLiveFlightProviderEnabled(env = process.env) {
  return getProviderReadiness(env).liveProviderConfigured;
}

export function assertLiveFlightProviderInProduction(env = process.env) {
  const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  if (!isProduction) return;
  if (!isLiveFlightProviderEnabled(env)) {
    throw new Error('[FATAL] A live flight provider must be enabled in production');
  }
}
