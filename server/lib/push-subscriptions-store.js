/**
 * Browser push subscription store.
 *
 * Stores PushSubscription objects (endpoint + auth/p256dh keys) per user.
 * Each user can have multiple subscriptions (different browsers/devices).
 *
 * Backed by the JSON db (pushSubscriptions array).  The subscription endpoint
 * URL uniquely identifies a device; upsert on endpoint to avoid duplicates.
 */
import { nanoid } from 'nanoid';
import { withDb } from './db.js';

const MAX_SUBSCRIPTIONS_PER_USER = 10;
const MAX_TOTAL = 50_000;

/**
 * Save or update a browser PushSubscription for a user.
 * Returns the stored record.
 */
export async function upsertPushSubscription({ userId, subscription }) {
  let record = null;
  await withDb((db) => {
    db.pushSubscriptions = db.pushSubscriptions || [];
    const existing = db.pushSubscriptions.find(
      (s) => s.userId === userId && s.endpoint === subscription.endpoint
    );
    if (existing) {
      // Refresh keys (browser can rotate them on re-subscribe)
      existing.keys = subscription.keys;
      existing.updatedAt = new Date().toISOString();
      record = existing;
    } else {
      // Enforce per-user cap: remove oldest if over limit
      const userSubs = db.pushSubscriptions.filter((s) => s.userId === userId);
      if (userSubs.length >= MAX_SUBSCRIPTIONS_PER_USER) {
        const oldest = userSubs.sort((a, b) => a.createdAt < b.createdAt ? -1 : 1)[0];
        db.pushSubscriptions = db.pushSubscriptions.filter((s) => s.id !== oldest.id);
      }
      record = {
        id: nanoid(16),
        userId,
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.pushSubscriptions.push(record);
      // Global cap
      if (db.pushSubscriptions.length > MAX_TOTAL) {
        db.pushSubscriptions = db.pushSubscriptions.slice(-MAX_TOTAL);
      }
    }
    return db;
  });
  return record;
}

/**
 * Remove a push subscription by endpoint for a user.
 */
export async function removePushSubscription({ userId, endpoint }) {
  let removed = false;
  await withDb((db) => {
    db.pushSubscriptions = db.pushSubscriptions || [];
    const before = db.pushSubscriptions.length;
    db.pushSubscriptions = db.pushSubscriptions.filter(
      (s) => !(s.userId === userId && s.endpoint === endpoint)
    );
    removed = db.pushSubscriptions.length < before;
    return db;
  });
  return removed;
}

/**
 * Remove a push subscription by id (used when the push service returns 410).
 */
export async function removePushSubscriptionById(id) {
  await withDb((db) => {
    db.pushSubscriptions = (db.pushSubscriptions || []).filter((s) => s.id !== id);
    return db;
  });
}

/**
 * List all subscriptions for a user.
 */
export async function listPushSubscriptionsForUser(userId) {
  const { readDb } = await import('./db.js');
  const db = await readDb();
  return (db.pushSubscriptions || []).filter((s) => s.userId === userId);
}

/**
 * List all subscriptions for a set of userIds (for bulk delivery).
 */
export async function listPushSubscriptionsForUsers(userIds) {
  const set = new Set(userIds);
  const { readDb } = await import('./db.js');
  const db = await readDb();
  return (db.pushSubscriptions || []).filter((s) => set.has(s.userId));
}
