import type { MultiCityRetryPolicy } from '../types/index.ts';

export const DEFAULT_MULTI_CITY_RETRY_POLICY: MultiCityRetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 300
};

export function computeRetryDelayMs(attempt: number, initialDelayMs: number): number {
  if (attempt <= 1) return initialDelayMs;
  return initialDelayMs * 3 ** (attempt - 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isRetryableError(error: unknown): boolean {
  const status = Number((error as { status?: number })?.status);
  const code = String((error as { code?: string })?.code || '').toLowerCase();
  if ([429, 502, 503, 504].includes(status)) return true;
  return code === 'request_timeout' || code === 'request_failed';
}

export async function executeWithRetry<T>(
  action: () => Promise<T>,
  policy: MultiCityRetryPolicy = DEFAULT_MULTI_CITY_RETRY_POLICY,
  wait: (ms: number) => Promise<void> = sleep
): Promise<T> {
  const maxAttempts = Math.max(1, Number(policy.maxAttempts) || 1);
  const initialDelayMs = Math.max(0, Number(policy.initialDelayMs) || 0);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      const retryable = isRetryableError(error);
      if (!retryable || attempt >= maxAttempts) break;
      const waitMs = computeRetryDelayMs(attempt, initialDelayMs);
      if (waitMs > 0) await wait(waitMs);
    }
  }

  throw lastError;
}
