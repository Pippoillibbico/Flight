import { useCallback, useEffect, useState } from 'react';

/**
 * Loads and refreshes the current-month quota usage from GET /api/billing/quota.
 * Self-contained: does not require plumbing through useAppDataOperations.
 *
 * Returns:
 *   quota    — { planId, periodKey, counters: { search, decision, alerts, ... } } or null
 *   loading  — true while fetching
 *   refresh  — call to force a reload (e.g. after a plan change)
 */
export function useQuotaStatus({ api, token, isAuthenticated }) {
  const [quota, setQuota]   = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!isAuthenticated || !api || !token) return;
      if (!silent) setLoading(true);
      try {
        const data = await api.billingQuota(token);
        setQuota(data || null);
      } catch {
        // Non-fatal: quota bar simply won't render
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [api, token, isAuthenticated]
  );

  useEffect(() => {
    load();
  }, [load]);

  return { quota, loading, refresh: load };
}
