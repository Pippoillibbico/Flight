import { createIngestionJob, updateIngestionJob } from '../lib/deal-engine-store.js';
import { logger } from '../lib/logger.js';
import { runDealsContentEngineOnce } from '../lib/deals-content-engine.js';

function compactResult(result = {}) {
  const sections = result?.sections && typeof result.sections === 'object' ? result.sections : {};
  return {
    skipped: Boolean(result?.skipped),
    reason: result?.reason || null,
    source: result?.source || 'detected_deals',
    generatedAt: result?.generatedAt || null,
    timezone: result?.timezone || null,
    totalSourceDeals: Number(result?.totalSourceDeals || 0),
    todayDeals: Number(result?.todayDeals || 0),
    sectionCounts: {
      top5CheapFlightsToday: Array.isArray(sections.top5CheapFlightsToday) ? sections.top5CheapFlightsToday.length : 0,
      destinationsUnder300: Array.isArray(sections.destinationsUnder300) ? sections.destinationsUnder300.length : 0,
      weekendLowCost: Array.isArray(sections.weekendLowCost) ? sections.weekendLowCost.length : 0,
      crazyFlightsToday: Array.isArray(sections.crazyFlightsToday) ? sections.crazyFlightsToday.length : 0
    },
    delivery: result?.delivery || null
  };
}

function deliverySuccessCount(delivery = {}) {
  return (
    Number(delivery?.push?.sent || 0) +
    Number(delivery?.newsletter?.sent || 0) +
    Number(delivery?.social?.sent || 0) +
    Number(delivery?.inApp?.sent || 0)
  );
}

function deliveryFailureCount(delivery = {}) {
  return (
    Number(delivery?.push?.failed || 0) +
    Number(delivery?.newsletter?.failed || 0) +
    Number(delivery?.social?.failed || 0) +
    Number(delivery?.inApp?.failed || 0)
  );
}

export async function runDealsContentWorkerOnce(options = {}) {
  const job = await createIngestionJob({
    jobType: 'deals_content_generation',
    source: 'internal',
    status: 'running',
    metadata: {
      deliver: options.deliver !== false
    }
  });

  await updateIngestionJob({
    jobId: job.id,
    startedAt: new Date().toISOString(),
    status: 'running'
  });

  try {
    const result = await runDealsContentEngineOnce(options);
    const compact = compactResult(result);
    const insertedCount = deliverySuccessCount(result.delivery);
    const failedCount = deliveryFailureCount(result.delivery);

    await updateIngestionJob({
      jobId: job.id,
      status: 'success',
      finishedAt: new Date().toISOString(),
      processedCount: Number(result.totalSourceDeals || 0),
      insertedCount,
      dedupedCount: 0,
      failedCount,
      metadata: compact
    });
    logger.info({ ...compact, insertedCount, failedCount }, 'deals_content_worker_completed');
    return result;
  } catch (error) {
    await updateIngestionJob({
      jobId: job.id,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      failedCount: 1,
      errorSummary: error?.message || String(error)
    });
    logger.error({ err: error }, 'deals_content_worker_failed');
    throw error;
  }
}
