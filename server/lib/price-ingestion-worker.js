import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { appendImmutableAudit } from './audit-log.js';
import { getCacheClient } from './free-cache.js';
import { evaluateObservationForAlerts } from './alert-intelligence.js';
import { buildSyntheticObservationFromCsvRow, storeObservation } from './price-history-store.js';
import { logger } from './logger.js';

/**
 * @typedef {Object} IngestionQueueItem
 * @property {string} origin
 * @property {string} destination
 * @property {string} date
 * @property {number} price
 * @property {string=} timestamp
 * @property {string=} airline
 * @property {string=} source
 * @property {string=} currency
 * @property {string=} returnDate
 * @property {string=} cabinClass
 * @property {string=} tripType
 * @property {Record<string, any>=} metadata
 */

const queueItemSchema = z.object({
  origin: z.string().trim().length(3),
  destination: z.string().trim().length(3),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  price: z.number().positive(),
  timestamp: z.string().datetime().optional(),
  airline: z.string().trim().min(1).max(120).default('internal_dataset'),
  source: z.string().trim().min(2).max(120).default('api_ingest'),
  currency: z.string().trim().length(3).default('EUR'),
  returnDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  cabinClass: z.string().trim().min(2).max(40).default('economy'),
  tripType: z.string().trim().min(2).max(40).default('round_trip'),
  metadata: z.record(z.string(), z.any()).optional()
});

const DEFAULT_DEQUEUE_RETRIES = 3;
const DEFAULT_DEQUEUE_BACKOFF_MS = 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientRedisError(error) {
  const message = String(error?.message || '').toLowerCase();
  if (!message) return false;
  return (
    message.includes('stream isn\'t writeable') ||
    message.includes('connect') ||
    message.includes('connection') ||
    message.includes('econnrefused') ||
    message.includes('socket closed') ||
    message.includes('ready check failed')
  );
}

async function dequeueWithRetry(cache, key, retries = DEFAULT_DEQUEUE_RETRIES) {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      return await cache.rpop(key);
    } catch (error) {
      if (!isTransientRedisError(error) || attempt === retries) {
        throw error;
      }
      const backoffMs = DEFAULT_DEQUEUE_BACKOFF_MS * (attempt + 1);
      logger.warn(
        { err: error, key, attempt: attempt + 1, backoffMs },
        'price_ingestion_dequeue_retry'
      );
      await sleep(backoffMs);
      attempt += 1;
    }
  }
  return null;
}

function parseCsvLine(line) {
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((v) => v.trim());
}

async function ingestCsvFile(path) {
  const raw = await readFile(path, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (lines.length < 2) return { inserted: 0, deduped: 0, processed: 0 };
  const headers = parseCsvLine(lines[0]);
  let inserted = 0;
  let deduped = 0;
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const row = {};
    for (let i = 0; i < headers.length; i += 1) row[headers[i]] = cols[i] ?? '';
    const obs = buildSyntheticObservationFromCsvRow(row);
    const result = await storeObservation(obs);
    if (result.inserted) inserted += 1;
    else deduped += 1;
  }
  return { inserted, deduped, processed: lines.length - 1 };
}

async function processQueueItem(item) {
  const parsed = queueItemSchema.parse(item);
  const stored = await storeObservation(parsed);
  if (stored.inserted) {
    await evaluateObservationForAlerts({
      origin: parsed.origin.toUpperCase(),
      destination: parsed.destination.toUpperCase(),
      date: parsed.date,
      price: parsed.price,
      fingerprint: stored.fingerprint,
      observedAt: parsed.timestamp || new Date().toISOString()
    }).catch((error) => {
      logger.warn({ err: error }, 'alert_evaluation_failed_after_ingest');
    });
  }
  return stored;
}

export async function runPriceIngestionWorkerOnce({ maxJobs = 500, csvPath = null } = {}) {
  const cache = getCacheClient();
  let processed = 0;
  let inserted = 0;
  let deduped = 0;
  let failed = 0;

  if (csvPath) {
    try {
      const csv = await ingestCsvFile(csvPath);
      processed += csv.processed;
      inserted += csv.inserted;
      deduped += csv.deduped;
    } catch (error) {
      failed += 1;
      logger.error({ err: error, csvPath }, 'price_ingestion_csv_failed');
    }
  }

  while (processed < maxJobs) {
    let raw = null;
    try {
      raw = await dequeueWithRetry(cache, 'price:intelligence:ingest');
    } catch (error) {
      failed += 1;
      logger.error({ err: error }, 'price_ingestion_dequeue_failed');
      break;
    }
    if (!raw) break;
    processed += 1;
    try {
      const item = JSON.parse(raw);
      const out = await processQueueItem(item);
      if (out.inserted) inserted += 1;
      else deduped += 1;
    } catch (error) {
      failed += 1;
      logger.error({ err: error }, 'price_ingestion_queue_item_failed');
    }
  }

  appendImmutableAudit({
    category: 'price_ingestion_worker',
    type: 'run',
    success: failed === 0,
    detail: `processed=${processed}; inserted=${inserted}; deduped=${deduped}; failed=${failed}`
  }).catch(() => {});

  return { processed, inserted, deduped, failed };
}

/**
 * Pushes one normalized observation into local ingestion queue.
 * @param {IngestionQueueItem} item
 */
export async function enqueuePriceObservation(item) {
  const cache = getCacheClient();
  const parsed = queueItemSchema.parse(item);
  await cache.lpush('price:intelligence:ingest', JSON.stringify(parsed));
  return { queued: true };
}
