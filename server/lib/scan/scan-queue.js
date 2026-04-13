import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import { getCacheClient } from '../free-cache.js';
import { logger as rootLogger } from '../logger.js';

const DEFAULT_QUEUE_KEY = 'jobs:flight_scan:queue';
const DEFAULT_DEDUPE_TTL_SEC = Math.max(
  300,
  Number(
    process.env.FLIGHT_SCAN_QUEUE_DEDUPE_TTL_SEC ||
      process.env.FLIGHT_SCAN_WINDOW_COOLDOWN_MEDIUM_SEC ||
      14_400
  )
);
const DEFAULT_DEDUPE_TTL_HIGH_SEC = Math.max(
  300,
  Number(
    process.env.FLIGHT_SCAN_QUEUE_DEDUPE_TTL_HIGH_SEC ||
      process.env.FLIGHT_SCAN_WINDOW_COOLDOWN_HIGH_SEC ||
      1800
  )
);
const DEFAULT_DEDUPE_TTL_MEDIUM_SEC = Math.max(
  300,
  Number(
    process.env.FLIGHT_SCAN_QUEUE_DEDUPE_TTL_MEDIUM_SEC ||
      process.env.FLIGHT_SCAN_WINDOW_COOLDOWN_MEDIUM_SEC ||
      14_400
  )
);
const DEFAULT_DEDUPE_TTL_LOW_SEC = Math.max(
  300,
  Number(
    process.env.FLIGHT_SCAN_QUEUE_DEDUPE_TTL_LOW_SEC ||
      process.env.FLIGHT_SCAN_WINDOW_COOLDOWN_LOW_SEC ||
      86_400
  )
);
const DEFAULT_DEAD_LETTER_KEY = String(process.env.FLIGHT_SCAN_QUEUE_DEAD_LETTER_KEY || 'jobs:flight_scan:dead_letter').trim();
const DEFAULT_DEAD_LETTER_MAX = Math.max(50, Number(process.env.FLIGHT_SCAN_QUEUE_DEAD_LETTER_MAX || 1000));

function normalizeIata(value) {
  return String(value || '').trim().toUpperCase();
}

function toDateText(value) {
  return String(value || '').trim().slice(0, 10);
}

function safeInt(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(num)));
}

function normalizePriority(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'high' || text === 'medium' || text === 'low') return text;
  return 'medium';
}

function canonicalTask(task) {
  const originIata = normalizeIata(task?.originIata);
  const destinationIata = normalizeIata(task?.destinationIata);
  const departureDate = toDateText(task?.departureDate);
  const returnDate = task?.returnDate ? toDateText(task.returnDate) : null;
  const adults = safeInt(task?.adults, 1, 1, 9);
  const cabinClass = String(task?.cabinClass || 'economy').trim().toLowerCase();
  const attempt = safeInt(task?.attempt, 0, 0, 10);
  const maxAttempts = safeInt(task?.maxAttempts, 3, 0, 10);
  const notBeforeTs = Number.isFinite(Number(task?.notBeforeTs)) ? Number(task.notBeforeTs) : 0;

  return {
    id: String(task?.id || nanoid(12)),
    originIata,
    destinationIata,
    departureDate,
    returnDate,
    adults,
    cabinClass,
    attempt,
    maxAttempts,
    notBeforeTs,
    metadata: task?.metadata && typeof task.metadata === 'object' ? task.metadata : {},
    createdAt: task?.createdAt ? new Date(task.createdAt).toISOString() : new Date().toISOString()
  };
}

function buildTaskDedupeHash(task) {
  const stable = {
    originIata: normalizeIata(task?.originIata),
    destinationIata: normalizeIata(task?.destinationIata),
    departureDate: toDateText(task?.departureDate),
    returnDate: task?.returnDate ? toDateText(task.returnDate) : null,
    adults: safeInt(task?.adults, 1, 1, 9),
    cabinClass: String(task?.cabinClass || 'economy').trim().toLowerCase()
  };
  return createHash('sha1').update(JSON.stringify(stable)).digest('hex');
}

function routeKeyForTask(task) {
  const origin = normalizeIata(task?.originIata);
  const destination = normalizeIata(task?.destinationIata);
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) return null;
  return `${origin}-${destination}`;
}

function parseJsonSafe(raw) {
  try {
    return JSON.parse(String(raw || ''));
  } catch {
    return null;
  }
}

export function createScanQueue({
  cache = getCacheClient(),
  queueKey = DEFAULT_QUEUE_KEY,
  deadLetterKey = DEFAULT_DEAD_LETTER_KEY,
  deadLetterMax = DEFAULT_DEAD_LETTER_MAX,
  dedupeTtlSec = DEFAULT_DEDUPE_TTL_SEC,
  dedupeTtlHighSec = DEFAULT_DEDUPE_TTL_HIGH_SEC,
  dedupeTtlMediumSec = DEFAULT_DEDUPE_TTL_MEDIUM_SEC,
  dedupeTtlLowSec = DEFAULT_DEDUPE_TTL_LOW_SEC,
  logger = rootLogger
} = {}) {
  const safeQueueKey = String(queueKey || DEFAULT_QUEUE_KEY).trim() || DEFAULT_QUEUE_KEY;
  const safeDeadLetterKey = String(deadLetterKey || `${safeQueueKey}:dead_letter`).trim() || `${safeQueueKey}:dead_letter`;
  const safeDeadLetterMax = Math.max(10, Number(deadLetterMax || DEFAULT_DEAD_LETTER_MAX));
  const safeDedupeTtlSec = Math.max(30, Number(dedupeTtlSec || DEFAULT_DEDUPE_TTL_SEC));
  const safeDedupeTtlByPriority = {
    high: Math.max(30, Number(dedupeTtlHighSec || DEFAULT_DEDUPE_TTL_HIGH_SEC)),
    medium: Math.max(30, Number(dedupeTtlMediumSec || DEFAULT_DEDUPE_TTL_MEDIUM_SEC)),
    low: Math.max(30, Number(dedupeTtlLowSec || DEFAULT_DEDUPE_TTL_LOW_SEC))
  };

  function dedupeKeyForTask(task) {
    return `${safeQueueKey}:dedupe:${buildTaskDedupeHash(task)}`;
  }

  function dedupeTtlForTask(task) {
    const priority = normalizePriority(task?.metadata?.priority);
    const byPriority = Number(safeDedupeTtlByPriority[priority] || safeDedupeTtlSec);
    const windowCooldownSec = safeInt(task?.metadata?.windowCooldownSec, 0, 0, 1_209_600);
    const freshnessTtlSec = safeInt(task?.metadata?.freshnessTtlSec, 0, 0, 1_209_600);
    return Math.max(safeDedupeTtlSec, byPriority, windowCooldownSec, freshnessTtlSec);
  }

  async function enqueue(task) {
    const normalized = canonicalTask(task);
    const routeKey = routeKeyForTask(normalized);
    if (!/^[A-Z]{3}$/.test(normalized.originIata) || !/^[A-Z]{3}$/.test(normalized.destinationIata)) {
      return { enqueued: false, reason: 'invalid_route', routeKey };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized.departureDate)) {
      return { enqueued: false, reason: 'invalid_departure_date', routeKey };
    }

    const dedupeKey = dedupeKeyForTask(normalized);
    const dedupeTtlForTaskSec = dedupeTtlForTask(normalized);
    let claimed = 1;
    if (typeof cache.setnx === 'function') {
      claimed = Number(await cache.setnx(dedupeKey, String(Date.now()), dedupeTtlForTaskSec));
    }
    if (!claimed) return { enqueued: false, reason: 'duplicate', routeKey };
    try {
      await cache.lpush(safeQueueKey, JSON.stringify(normalized));
    } catch (error) {
      if (typeof cache.del === 'function') {
        try {
          await cache.del(dedupeKey);
        } catch (rollbackError) {
          logger.warn(
            {
              queueKey: safeQueueKey,
              dedupeKey,
              taskId: normalized.id,
              err: rollbackError?.message || String(rollbackError)
            },
            'flight_scan_task_enqueue_dedupe_rollback_failed'
          );
        }
      }
      logger.warn(
        {
          queueKey: safeQueueKey,
          dedupeKey,
          taskId: normalized.id,
          originIata: normalized.originIata,
          destinationIata: normalized.destinationIata,
          departureDate: normalized.departureDate,
          err: error?.message || String(error)
        },
        'flight_scan_task_enqueue_failed'
      );
      throw error;
    }
    logger.info(
      {
        queueKey: safeQueueKey,
        taskId: normalized.id,
        originIata: normalized.originIata,
        destinationIata: normalized.destinationIata,
        departureDate: normalized.departureDate,
        attempt: normalized.attempt,
        dedupeTtlSec: dedupeTtlForTaskSec
      },
      'flight_scan_task_enqueued'
    );
    return { enqueued: true, taskId: normalized.id, routeKey };
  }

  async function enqueueMany(tasks, { includeResults = false } = {}) {
    const list = Array.isArray(tasks) ? tasks : [];
    let enqueued = 0;
    let duplicates = 0;
    let rejected = 0;
    const results = includeResults ? [] : null;
    for (const item of list) {
      const fallbackRouteKey = routeKeyForTask(item);
      try {
        const result = await enqueue(item);
        if (result.enqueued) enqueued += 1;
        else if (result.reason === 'duplicate') duplicates += 1;
        else rejected += 1;
        if (includeResults) {
          results.push({
            status: result.enqueued ? 'enqueued' : result.reason === 'duplicate' ? 'duplicate' : 'rejected',
            reason: result.reason || null,
            routeKey: result.routeKey || fallbackRouteKey,
            taskId: result.taskId || null
          });
        }
      } catch (error) {
        rejected += 1;
        logger.warn(
          {
            queueKey: safeQueueKey,
            originIata: normalizeIata(item?.originIata),
            destinationIata: normalizeIata(item?.destinationIata),
            departureDate: toDateText(item?.departureDate),
            err: error?.message || String(error)
          },
          'flight_scan_task_enqueue_many_item_failed'
        );
        if (includeResults) {
          results.push({
            status: 'rejected',
            reason: 'enqueue_failed',
            routeKey: fallbackRouteKey,
            taskId: null
          });
        }
      }
    }
    const summary = { enqueued, duplicates, rejected, total: list.length };
    if (includeResults) summary.results = results;
    return summary;
  }

  async function dequeue() {
    const raw = await cache.rpop(safeQueueKey);
    if (!raw) return null;
    const parsed = parseJsonSafe(raw);
    if (!parsed || typeof parsed !== 'object') {
      logger.warn({ queueKey: safeQueueKey, raw }, 'flight_scan_task_invalid_payload_dropped');
      return null;
    }
    return canonicalTask(parsed);
  }

  async function requeue(task, { delaySec = 0 } = {}) {
    const normalized = canonicalTask(task);
    const delayMs = Math.max(0, Number(delaySec || 0) * 1000);
    normalized.notBeforeTs = delayMs > 0 ? Date.now() + delayMs : Number(normalized.notBeforeTs || 0);
    await cache.lpush(safeQueueKey, JSON.stringify(normalized));
    logger.info(
      {
        queueKey: safeQueueKey,
        taskId: normalized.id,
        attempt: normalized.attempt,
        delaySec: Math.max(0, Number(delaySec || 0))
      },
      'flight_scan_task_requeued'
    );
    return { requeued: true, taskId: normalized.id };
  }

  async function deadLetter(task, { reason = 'task_failed', error = null, scanRunId = null } = {}) {
    const normalized = canonicalTask(task);
    const payload = {
      task: normalized,
      reason: String(reason || 'task_failed'),
      error: error ? String(error?.message || error) : null,
      scanRunId: scanRunId || null,
      failedAt: new Date().toISOString()
    };
    await cache.lpush(safeDeadLetterKey, JSON.stringify(payload));
    if (typeof cache.ltrim === 'function') {
      await cache.ltrim(safeDeadLetterKey, 0, safeDeadLetterMax - 1);
    }
    logger.warn(
      {
        queueKey: safeQueueKey,
        deadLetterKey: safeDeadLetterKey,
        taskId: normalized.id,
        reason: payload.reason,
        scanRunId: payload.scanRunId
      },
      'flight_scan_task_dead_lettered'
    );
    return { deadLettered: true, taskId: normalized.id };
  }

  async function getQueueDepth() {
    if (typeof cache.llen === 'function') {
      return Math.max(0, Number(await cache.llen(safeQueueKey)) || 0);
    }
    return 0;
  }

  async function getDeadLetterDepth() {
    if (typeof cache.llen === 'function') {
      return Math.max(0, Number(await cache.llen(safeDeadLetterKey)) || 0);
    }
    return 0;
  }

  async function peekDeadLetters({ limit = 20 } = {}) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 20));
    if (typeof cache.lrange !== 'function') return [];
    const rows = await cache.lrange(safeDeadLetterKey, 0, safeLimit - 1);
    const list = Array.isArray(rows) ? rows : [];
    return list
      .map((raw) => parseJsonSafe(raw))
      .filter((item) => item && typeof item === 'object');
  }

  async function getStats() {
    const [pending, deadLettered] = await Promise.all([getQueueDepth(), getDeadLetterDepth()]);
    return {
      queueKey: safeQueueKey,
      deadLetterKey: safeDeadLetterKey,
      pending,
      deadLettered,
      dedupeTtlSec: safeDedupeTtlSec,
      dedupeTtlByPriority: safeDedupeTtlByPriority,
      deadLetterMax: safeDeadLetterMax
    };
  }

  return {
    queueKey: safeQueueKey,
    deadLetterKey: safeDeadLetterKey,
    enqueue,
    enqueueMany,
    dequeue,
    requeue,
    deadLetter,
    getQueueDepth,
    getDeadLetterDepth,
    peekDeadLetters,
    getStats,
    dedupeKeyForTask
  };
}
