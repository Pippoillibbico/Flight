/**
 * VAPID Web Push sender.
 *
 * Sends browser push notifications directly via the W3C Push API using
 * the application's VAPID key pair.  No third-party relay needed.
 *
 * Required env vars:
 *   VAPID_PUBLIC_KEY  — URL-safe base64 uncompressed EC public key (65 bytes → 87 chars)
 *   VAPID_PRIVATE_KEY — URL-safe base64 EC private key (32 bytes → 43 chars)
 *   VAPID_SUBJECT     — mailto: or https: contact URI sent to push services
 */
import webpush from 'web-push';
import { logger as rootLogger } from './logger.js';

const VAPID_PUBLIC_KEY  = String(process.env.VAPID_PUBLIC_KEY  || '').trim();
const VAPID_PRIVATE_KEY = String(process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT     = String(process.env.VAPID_SUBJECT     || 'mailto:noreply@flightsuite.app').trim();

let _initialized = false;

function ensureInitialized() {
  if (_initialized) return;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return; // unconfigured — caller checks
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  _initialized = true;
}

export function isVapidConfigured() {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

export function getVapidPublicKey() {
  return VAPID_PUBLIC_KEY || null;
}

/**
 * Send a push notification to a single browser subscription.
 *
 * @param {object} subscription  — PushSubscription JSON from browser (endpoint + keys)
 * @param {object} payload       — { title, body, data? }
 * @returns {{ sent: boolean, reason: string|null, statusCode?: number }}
 */
export async function sendVapidPush(subscription, payload, { logger = rootLogger } = {}) {
  if (!isVapidConfigured()) {
    return { sent: false, reason: 'vapid_not_configured' };
  }
  ensureInitialized();

  const body = JSON.stringify({
    title: String(payload.title || 'Flight Suite'),
    body:  String(payload.body  || payload.message || ''),
    data:  payload.data || payload.metadata || {}
  });

  try {
    await webpush.sendNotification(subscription, body, { TTL: 86400 });
    return { sent: true, reason: null };
  } catch (error) {
    const statusCode = error?.statusCode ?? null;
    // 404/410 → subscription expired/unregistered — caller should remove it
    const expired = statusCode === 404 || statusCode === 410;
    logger.warn({ statusCode, endpoint: subscription?.endpoint, expired }, 'vapid_push_failed');
    return { sent: false, reason: expired ? 'subscription_expired' : 'push_failed', statusCode, expired };
  }
}
