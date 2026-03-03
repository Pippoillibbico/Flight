import { getCacheClient } from '../lib/free-cache.js';
import { appendImmutableAudit } from '../lib/audit-log.js';

export async function runFreeAlertWorkerOnce({ maxJobs = 100 } = {}) {
  const cache = getCacheClient();
  let processed = 0;

  while (processed < maxJobs) {
    const jobRaw = await cache.rpop('free:queue:alerts:evaluate');
    if (!jobRaw) break;
    processed += 1;
    try {
      const job = JSON.parse(jobRaw);
      appendImmutableAudit({
        category: 'free_alert_worker',
        type: 'evaluate_alert',
        success: true,
        detail: `alertId=${job.alertId}; userId=${job.userId}`
      }).catch(() => {});
    } catch (error) {
      appendImmutableAudit({
        category: 'free_alert_worker',
        type: 'evaluate_alert_failed',
        success: false,
        detail: error?.message || String(error)
      }).catch(() => {});
    }
  }

  return { processed };
}

