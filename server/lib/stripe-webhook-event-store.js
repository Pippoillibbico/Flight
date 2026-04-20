import { withDb } from './db.js';
import { getSaasPool } from './saas-db.js';

const WEBHOOK_EVENT_HISTORY_LIMIT = Math.max(1000, Number(process.env.STRIPE_WEBHOOK_EVENT_HISTORY_LIMIT || 10000));

function nowIso() {
  return new Date().toISOString();
}

function normalizeEventId(value) {
  return String(value || '').trim();
}

function normalizeEventType(value) {
  const normalized = String(value || '').trim();
  return normalized || 'unknown';
}

function normalizeStatus(value, fallback = 'processing') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'processing') return 'processing';
  if (normalized === 'processed') return 'processed';
  if (normalized === 'failed') return 'failed';
  return fallback;
}

/**
 * Claim a Stripe webhook event id for processing.
 *
 * Returns:
 * - { claimed: true, deduped: false } when caller can process the event.
 * - { claimed: false, deduped: true } when event is already processing/processed.
 */
export async function claimStripeWebhookEvent({ id, type }) {
  const eventId = normalizeEventId(id);
  if (!eventId) return { claimed: false, deduped: false, reason: 'missing_event_id' };
  const eventType = normalizeEventType(type);

  const pool = getSaasPool();
  if (pool) {
    const inserted = await pool.query(
      `INSERT INTO stripe_webhook_events (event_id, event_type, status, created_at, updated_at)
       VALUES ($1, $2, 'processing', NOW(), NOW())
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [eventId, eventType]
    );
    if (inserted.rowCount > 0) {
      return { claimed: true, deduped: false, reason: 'inserted' };
    }

    const existing = await pool.query(`SELECT status FROM stripe_webhook_events WHERE event_id = $1`, [eventId]);
    const currentStatus = normalizeStatus(existing.rows[0]?.status, 'processing');

    if (currentStatus === 'failed') {
      const recycled = await pool.query(
        `UPDATE stripe_webhook_events
         SET status = 'processing', event_type = $2, updated_at = NOW(), last_error = NULL
         WHERE event_id = $1 AND status = 'failed'
         RETURNING event_id`,
        [eventId, eventType]
      );
      if (recycled.rowCount > 0) {
        return { claimed: true, deduped: false, reason: 'recycled_failed_event' };
      }
    }

    return { claimed: false, deduped: true, reason: `already_${currentStatus}` };
  }

  let result = { claimed: false, deduped: false, reason: 'unknown' };
  await withDb((db) => {
    db.stripeWebhookEvents = db.stripeWebhookEvents || [];
    const existing = db.stripeWebhookEvents.find((item) => item.id === eventId);

    if (!existing) {
      db.stripeWebhookEvents.push({
        id: eventId,
        type: eventType,
        status: 'processing',
        createdAt: nowIso(),
        updatedAt: nowIso()
      });
      db.stripeWebhookEvents = db.stripeWebhookEvents.slice(-WEBHOOK_EVENT_HISTORY_LIMIT);
      result = { claimed: true, deduped: false, reason: 'inserted' };
      return db;
    }

    const currentStatus = normalizeStatus(existing.status, 'processing');
    if (currentStatus === 'failed') {
      existing.status = 'processing';
      existing.type = eventType;
      existing.lastError = null;
      existing.updatedAt = nowIso();
      result = { claimed: true, deduped: false, reason: 'recycled_failed_event' };
      return db;
    }

    result = { claimed: false, deduped: true, reason: `already_${currentStatus}` };
    return db;
  });

  return result;
}

/**
 * Mark Stripe webhook event processing result.
 */
export async function finalizeStripeWebhookEvent({ id, status, errorMessage = null }) {
  const eventId = normalizeEventId(id);
  if (!eventId) return;
  const nextStatus = normalizeStatus(status, 'failed');
  const safeErrorMessage = String(errorMessage || '').trim() || null;

  const pool = getSaasPool();
  if (pool) {
    await pool.query(
      `UPDATE stripe_webhook_events
       SET status = $2,
           updated_at = NOW(),
           processed_at = CASE WHEN $2 = 'processed' THEN NOW() ELSE processed_at END,
           last_error = CASE WHEN $2 = 'failed' THEN $3 ELSE NULL END
       WHERE event_id = $1`,
      [eventId, nextStatus, safeErrorMessage]
    );
    return;
  }

  await withDb((db) => {
    db.stripeWebhookEvents = db.stripeWebhookEvents || [];
    for (const entry of db.stripeWebhookEvents) {
      if (entry.id !== eventId) continue;
      entry.status = nextStatus;
      entry.updatedAt = nowIso();
      if (nextStatus === 'processed') {
        entry.processedAt = entry.updatedAt;
        entry.lastError = null;
      } else if (nextStatus === 'failed') {
        entry.lastError = safeErrorMessage;
      }
      break;
    }
    return db;
  });
}
