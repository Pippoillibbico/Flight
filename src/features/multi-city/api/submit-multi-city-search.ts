import type { MultiCityRetryPolicy, MultiCitySearchPayload } from '../types/index.ts';
import { DEFAULT_MULTI_CITY_RETRY_POLICY, executeWithRetry } from '../domain/retry-policy.ts';

interface MultiCityApiClient {
  search: (payload: MultiCitySearchPayload, token?: string) => Promise<unknown>;
}

export async function submitMultiCitySearchWithRetry(
  apiClient: MultiCityApiClient,
  payload: MultiCitySearchPayload,
  token?: string,
  policy: MultiCityRetryPolicy = DEFAULT_MULTI_CITY_RETRY_POLICY
): Promise<unknown> {
  return executeWithRetry(() => apiClient.search(payload, token), policy);
}
