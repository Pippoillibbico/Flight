import { parseBoolean } from './env-flags.js';

export function getDetectedDealsRuntimeConfig(runtimeOptions = {}, options = {}) {
  return {
    lookbackHours: Math.max(
      1,
      Math.min(720, Number(runtimeOptions.lookbackHours ?? options.lookbackHours ?? process.env.DETECTED_DEALS_LOOKBACK_HOURS ?? 72))
    ),
    signalLookbackDays: Math.max(
      1,
      Math.min(
        180,
        Number(runtimeOptions.signalLookbackDays ?? options.signalLookbackDays ?? process.env.DETECTED_DEALS_SIGNAL_LOOKBACK_DAYS ?? 30)
      )
    ),
    maxCandidates: Math.max(
      50,
      Math.min(5000, Number(runtimeOptions.maxCandidates ?? options.maxCandidates ?? process.env.DETECTED_DEALS_MAX_CANDIDATES ?? 1000))
    ),
    maxPublishedPerRun: Math.max(
      10,
      Math.min(
        1000,
        Number(runtimeOptions.maxPublishedPerRun ?? options.maxPublishedPerRun ?? process.env.DETECTED_DEALS_MAX_PUBLISHED_PER_RUN ?? 1000)
      )
    ),
    expiryHours: Math.max(
      12,
      Math.min(720, Number(runtimeOptions.expiryHours ?? options.expiryHours ?? process.env.DETECTED_DEALS_EXPIRY_HOURS ?? 120))
    ),
    minDiscountPct: Math.max(
      0.1,
      Math.min(70, Number(runtimeOptions.minDiscountPct ?? options.minDiscountPct ?? process.env.DETECTED_DEALS_MIN_DISCOUNT_PCT ?? 5))
    ),
    nearMinRatio: Math.max(
      1.0,
      Math.min(2.0, Number(runtimeOptions.nearMinRatio ?? options.nearMinRatio ?? process.env.DETECTED_DEALS_NEAR_MIN_RATIO ?? 1.12))
    ),
    rapidDropRatio: Math.max(
      0.5,
      Math.min(0.99, Number(runtimeOptions.rapidDropRatio ?? options.rapidDropRatio ?? process.env.DETECTED_DEALS_RAPID_DROP_RATIO ?? 0.93))
    ),
    rapidDropMinPct: Math.max(
      0.1,
      Math.min(80, Number(runtimeOptions.rapidDropMinPct ?? options.rapidDropMinPct ?? process.env.DETECTED_DEALS_RAPID_DROP_MIN_PCT ?? 6))
    ),
    minScore: Math.max(0, Math.min(100, Number(runtimeOptions.minScore ?? options.minScore ?? process.env.DETECTED_DEALS_MIN_SCORE ?? 55))),
    publishScore: Math.max(
      0,
      Math.min(100, Number(runtimeOptions.publishScore ?? options.publishScore ?? process.env.DETECTED_DEALS_PUBLISH_SCORE ?? 68))
    ),
    publishFallbackEnabled: parseBoolean(
      runtimeOptions.publishFallbackEnabled ?? options.publishFallbackEnabled ?? process.env.DETECTED_DEALS_PUBLISH_FALLBACK_ENABLED,
      true
    ),
    publishFallbackDelta: Math.max(
      1,
      Math.min(
        25,
        Number(runtimeOptions.publishFallbackDelta ?? options.publishFallbackDelta ?? process.env.DETECTED_DEALS_PUBLISH_FALLBACK_DELTA ?? 5)
      )
    ),
    publishFallbackMaxPerRun: Math.max(
      1,
      Math.min(
        200,
        Number(
          runtimeOptions.publishFallbackMaxPerRun ??
            options.publishFallbackMaxPerRun ??
            process.env.DETECTED_DEALS_PUBLISH_FALLBACK_MAX_PER_RUN ??
            20
        )
      )
    ),
    retentionDays: Math.max(
      7,
      Math.min(365, Number(runtimeOptions.retentionDays ?? options.retentionDays ?? process.env.DETECTED_DEALS_RETENTION_DAYS ?? 45))
    )
  };
}

