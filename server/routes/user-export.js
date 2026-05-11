/**
 * User data export — GET /api/user/data-export and /api/user/data-export.csv
 *
 * Allows authenticated users to download their own data:
 * search history, price alerts, watchlist, notifications.
 *
 * Uses the `export` quota counter (Creator plan: 400/month).
 * Free and Pro plans with export quota 0 receive 403 upgrade_required.
 */
import { Router } from 'express';
import { format } from 'date-fns';
import { canExportData, getUpgradeContext } from '../lib/plan-access.js';
import { buildExportAuditEvent, createExportRateLimiter, requireExportPagination, requireExportReason } from '../lib/export-security.js';
import { getSaasPool } from '../lib/saas-db.js';
import { hashValueForLogs } from '../lib/log-redaction.js';

export function buildUserExportRouter({ authGuard, requireSessionAuth, quotaGuard, withDb, readDb, fetchCurrentUser, appendImmutableAudit }) {
  const router = Router();
  const exportRateLimiter = createExportRateLimiter({ windowMs: 60_000, max: 8 });
  const gdprExportWindowMs = 24 * 60 * 60 * 1000;
  const gdprExportLastSeen = new Map();

  function gdprExportRateLimiter(req, res, next) {
    const actor = normalizeUserId(req) || String(req.ip || 'anonymous');
    const now = Date.now();
    const lastSeenAt = Number(gdprExportLastSeen.get(actor) || 0);
    const retryAt = lastSeenAt + gdprExportWindowMs;
    if (lastSeenAt && now < retryAt) {
      return res.status(429).json({
        error: 'gdpr_export_rate_limited',
        retry_after: new Date(retryAt).toISOString()
      });
    }
    gdprExportLastSeen.set(actor, now);
    return next();
  }

  function toIso(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }

  function redactUserAgent(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    return hashValueForLogs(raw, { label: 'ua', length: 24 }) || null;
  }

  function stripeReference(value, label) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    return `${label}_${hashValueForLogs(raw, { label: `gdpr_${label}`, length: 24 })}`;
  }

  function mapBillingReference(row) {
    return {
      plan_id: row.plan_id || row.planId || null,
      status: row.status || null,
      stripe_customer_ref: stripeReference(row.stripe_customer_id || row.stripeCustomerId, 'cus'),
      stripe_subscription_ref: stripeReference(row.stripe_subscription_id || row.stripeSubscriptionId, 'sub'),
      current_period_start: toIso(row.current_period_start || row.currentPeriodStart),
      current_period_end: toIso(row.current_period_end || row.currentPeriodEnd),
      cancel_at_period_end: Boolean(row.cancel_at_period_end || row.cancelAtPeriodEnd),
      extra_credits: Number(row.extra_credits || row.extraCredits || 0),
      created_at: toIso(row.created_at || row.createdAt),
      updated_at: toIso(row.updated_at || row.updatedAt),
      reference_policy: 'stripe identifiers minimized with stable salted references'
    };
  }

  function mapSubscriptionState(row) {
    return {
      plan_id: row.plan_id || row.planId || null,
      status: row.status || null,
      current_period_start: toIso(row.current_period_start || row.currentPeriodStart),
      current_period_end: toIso(row.current_period_end || row.currentPeriodEnd),
      cancel_at_period_end: Boolean(row.cancel_at_period_end || row.cancelAtPeriodEnd)
    };
  }

  function normalizeUserId(req) {
    return String(req.user?.sub || req.user?.id || '').trim();
  }

  function setDefaultGdprReason(req, _res, next) {
    const headerReason = String(req.headers['x-export-reason'] || '').replace(/[\r\n\t]/g, ' ').trim();
    req.exportReason = headerReason || 'compliance:self_service_gdpr_export';
    return next();
  }

  async function safePgQuery(sql, params) {
    const pool = getSaasPool();
    if (!pool) return [];
    try {
      const result = await pool.query(sql, params);
      return result.rows || [];
    } catch (error) {
      if (['42P01', '42703'].includes(error?.code)) return [];
      throw error;
    }
  }

  async function writeExportAudit(req, { formatType, status }) {
    if (typeof appendImmutableAudit !== 'function') return;
    await appendImmutableAudit(
      buildExportAuditEvent(req, {
        action: 'export',
        targetType: `user_data_export_${formatType}`,
        targetId: String(req.user?.sub || req.user?.id || 'unknown'),
        outcome: status === 'success' ? 'success' : status === 'blocked_plan' ? 'blocked' : 'failed'
      })
    ).catch(() => {});
  }

  function mapAccountUser(user, fallbackUserId) {
    if (!user) return { id: fallbackUserId };
    return {
      id: user.id || fallbackUserId,
      email: user.email || null,
      name: user.name || null,
      plan_type: user.planType || user.plan_type || user.planId || user.plan_id || null,
      plan_status: user.planStatus || user.plan_status || null,
      is_premium: Boolean(user.isPremium ?? user.is_premium ?? false),
      email_verified: Boolean(user.emailVerified ?? user.email_verified ?? false),
      auth_channel: user.authChannel || user.auth_channel || null,
      onboarding_done: Boolean(user.onboardingDone ?? user.onboarding_done ?? false),
      created_at: toIso(user.createdAt || user.created_at),
      updated_at: toIso(user.updatedAt || user.updated_at),
      last_login_at: toIso(user.lastLoginAt || user.last_login_at)
    };
  }

  async function loadPgGdprSections(userId) {
    const [
      users,
      userConsents,
      subscriptions,
      apiKeys,
      usageEvents,
      authEvents,
      searchEvents,
      emailDelivery,
      priceAlerts,
      discoverySubscriptions
    ] = await Promise.all([
      safePgQuery(
        `SELECT id, email, name, plan_id, plan_type, plan_status, is_premium, email_verified,
                auth_channel, onboarding_done, created_at, updated_at, last_login_at
         FROM users WHERE id = $1`,
        [userId]
      ),
      safePgQuery(
        `SELECT categories, version, consented_at, ip_hash, user_agent_hash, updated_at
         FROM user_consents WHERE user_id = $1`,
        [userId]
      ),
      safePgQuery(
        `SELECT plan_id, status, stripe_subscription_id, stripe_customer_id,
                current_period_start, current_period_end, cancel_at_period_end,
                extra_credits, created_at, updated_at
         FROM user_subscriptions WHERE user_id = $1`,
        [userId]
      ),
      safePgQuery(
        `SELECT id, name, key_prefix, scopes, last_used_at, revoked_at, expires_at, created_at
         FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`,
        [userId]
      ),
      safePgQuery(
        `SELECT id, endpoint, credits_used, metadata, created_at
         FROM usage_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1000`,
        [userId]
      ),
      safePgQuery(
        `SELECT id, at, type, success, ip_hash, user_agent, detail
         FROM auth_events WHERE user_id = $1 ORDER BY at DESC LIMIT 500`,
        [userId]
      ),
      safePgQuery(
        `SELECT id, channel, origin, region, date_from, date_to, created_at
         FROM search_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1000`,
        [userId]
      ),
      safePgQuery(
        `SELECT id, subject, status, provider_message_id, created_at
         FROM email_delivery_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500`,
        [userId]
      ),
      safePgQuery(
        `SELECT id, mode, status, target_price, currency, trip_type_preference, connection_type,
                max_stops, travel_time, min_comfort_score, cabin_class, travellers, stay_days,
                days_from_now, last_checked_at, last_triggered_at, created_at, updated_at
         FROM price_alerts WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 500`,
        [userId]
      ),
      safePgQuery(
        `SELECT id, origin_iata, budget_eur, mood, region, date_from, date_to,
                enabled, created_at, updated_at
         FROM discovery_alert_subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500`,
        [userId]
      )
    ]);

    return {
      account: users[0] ? mapAccountUser(users[0], userId) : null,
      consents: userConsents.map((row) => ({
        categories: row.categories || {},
        version: row.version || null,
        consented_at: toIso(row.consented_at),
        updated_at: toIso(row.updated_at),
        ip_hash: row.ip_hash || null,
        user_agent_hash: row.user_agent_hash || null
      })),
      billing_refs: subscriptions.map(mapBillingReference),
      subscription_state: subscriptions.map(mapSubscriptionState),
      api_keys: apiKeys.map((row) => ({
        id: row.id,
        name: row.name || null,
        key_prefix: row.key_prefix || null,
        scopes: row.scopes || [],
        last_used_at: toIso(row.last_used_at),
        revoked_at: toIso(row.revoked_at),
        expires_at: toIso(row.expires_at),
        created_at: toIso(row.created_at)
      })),
      usage_events: usageEvents.map((row) => ({
        id: row.id,
        endpoint: row.endpoint || null,
        credits_used: Number(row.credits_used || 0),
        metadata: row.metadata || null,
        created_at: toIso(row.created_at)
      })),
      auth_events: authEvents.map((row) => ({
        id: row.id,
        at: toIso(row.at),
        type: row.type || null,
        success: Boolean(row.success),
        ip_hash: row.ip_hash || null,
        user_agent_hash: redactUserAgent(row.user_agent),
        detail: row.detail || null
      })),
      search_history: searchEvents.map((row) => ({
        id: row.id,
        at: toIso(row.created_at),
        origin: row.origin || '',
        region: row.region || '',
        date_from: row.date_from || '',
        date_to: row.date_to || '',
        channel: row.channel || ''
      })),
      email: {
        delivery_log: emailDelivery.map((row) => ({
          id: row.id,
          subject: row.subject || null,
          status: row.status || null,
          provider_message_id: row.provider_message_id || null,
          created_at: toIso(row.created_at)
        }))
      },
      price_alerts: priceAlerts.map((row) => ({
        id: row.id,
        mode: row.mode || null,
        status: row.status || null,
        target_price: row.target_price ?? null,
        currency: row.currency || null,
        trip_type_preference: row.trip_type_preference || null,
        connection_type: row.connection_type || null,
        max_stops: row.max_stops ?? null,
        travel_time: row.travel_time || null,
        min_comfort_score: row.min_comfort_score ?? null,
        cabin_class: row.cabin_class || null,
        travellers: row.travellers ?? null,
        stay_days: row.stay_days ?? null,
        days_from_now: row.days_from_now ?? null,
        last_checked_at: toIso(row.last_checked_at),
        last_triggered_at: toIso(row.last_triggered_at),
        created_at: toIso(row.created_at),
        updated_at: toIso(row.updated_at)
      })),
      alert_subscriptions: discoverySubscriptions.map((row) => ({
        id: row.id,
        origin_iata: row.origin_iata || null,
        budget_eur: row.budget_eur ?? null,
        mood: row.mood || null,
        region: row.region || null,
        date_from: row.date_from || null,
        date_to: row.date_to || null,
        enabled: Boolean(row.enabled),
        created_at: toIso(row.created_at),
        updated_at: toIso(row.updated_at)
      }))
    };
  }

  async function buildGdprExportSnapshot(userId) {
    const db = await readDb();
    const user = (db.users || []).find((entry) => entry.id === userId) || null;
    const pgSections = await loadPgGdprSections(userId);
    const userSubscriptionEntries = (db.userSubscriptions || [])
      .filter((entry) => entry.userId === userId || entry.user_id === userId)
    const billingRefs = userSubscriptionEntries.map(mapBillingReference);
    const subscriptionState = userSubscriptionEntries.map(mapSubscriptionState);

    return {
      exported_at: new Date().toISOString(),
      export_type: 'gdpr_access',
      user_id: userId,
      account: pgSections.account || mapAccountUser(user, userId),
      email: {
        preferences: user?.emailPreferences || user?.email_preferences || null,
        delivery_log: [
          ...pgSections.email.delivery_log,
          ...(db.emailDeliveryLog || [])
            .filter((entry) => entry.userId === userId || entry.user_id === userId)
            .slice(-500)
            .map((entry) => ({
              id: entry.id || null,
              subject: entry.subject || null,
              status: entry.status || null,
              provider_message_id: entry.providerMessageId || entry.provider_message_id || null,
              created_at: toIso(entry.createdAt || entry.created_at)
            }))
        ]
      },
      consents: [
        ...pgSections.consents,
        ...(db.userConsents || [])
          .filter((entry) => entry.userId === userId || entry.user_id === userId)
          .map((entry) => ({
            categories: entry.categories || {},
            version: entry.version || null,
            consented_at: toIso(entry.consentedAt || entry.consented_at),
            updated_at: toIso(entry.updatedAt || entry.updated_at),
            ip_hash: entry.ipHash || entry.ip_hash || null,
            user_agent_hash: entry.userAgentHash || entry.user_agent_hash || null
          }))
      ],
      billing_refs: pgSections.billing_refs.length ? pgSections.billing_refs : billingRefs,
      subscription_state: pgSections.subscription_state.length ? pgSections.subscription_state : subscriptionState,
      auth_events: [
        ...pgSections.auth_events,
        ...(db.authEvents || [])
          .filter((entry) => entry.userId === userId || entry.user_id === userId)
          .slice(-500)
          .map((entry) => ({
            id: entry.id || null,
            at: toIso(entry.at || entry.createdAt || entry.created_at),
            type: entry.type || null,
            success: Boolean(entry.success),
            ip_hash: entry.ipHash || entry.ip_hash || null,
            user_agent_hash: redactUserAgent(entry.userAgent || entry.user_agent),
            detail: entry.detail || null
          }))
      ],
      search_history: [
        ...pgSections.search_history,
        ...(db.searches || [])
          .filter((s) => s.userId === userId)
          .map((s) => ({
            id: s.id,
            at: s.at,
            origin: s.payload?.origin || '',
            destination: s.payload?.destination || '',
            date_from: s.payload?.dateFrom || '',
            date_to: s.payload?.dateTo || '',
            cabin_class: s.payload?.cabinClass || ''
          }))
      ],
      watchlist: (db.watchlists || [])
        .filter((entry) => entry.userId === userId || entry.user_id === userId)
        .map((entry) => ({
          id: entry.id,
          origin: entry.origin || '',
          destination: entry.destination || '',
          created_at: toIso(entry.createdAt || entry.created_at)
        })),
      price_alerts: [
        ...pgSections.price_alerts,
        ...(db.priceAlerts || [])
          .filter((entry) => (entry.userId === userId || entry.user_id === userId) && !entry.deletedAt)
          .map((entry) => ({
            id: entry.id,
            origin: entry.origin || '',
            destination: entry.destinationIata || entry.destination || '',
            target_price: entry.targetPrice ?? entry.target_price ?? '',
            created_at: toIso(entry.createdAt || entry.created_at),
            enabled: Boolean(entry.enabled)
          }))
      ],
      alert_subscriptions: [
        ...pgSections.alert_subscriptions,
        ...(db.alertSubscriptions || [])
          .filter((entry) => entry.userId === userId || entry.user_id === userId)
          .map((entry) => ({
            id: entry.id,
            origin: entry.origin || entry.originIata || '',
            destination: entry.destinationIata || entry.destination || '',
            enabled: Boolean(entry.enabled),
            created_at: toIso(entry.createdAt || entry.created_at)
          }))
      ],
      notifications: (db.notifications || [])
        .filter((entry) => entry.userId === userId || entry.user_id === userId)
        .slice(-500)
        .map((entry) => ({
          id: entry.id,
          type: entry.type || '',
          message: entry.message || '',
          read: Boolean(entry.readAt || entry.read_at),
          created_at: toIso(entry.createdAt || entry.created_at)
        })),
      api_keys: pgSections.api_keys,
      usage_events: pgSections.usage_events
    };
  }

  /**
   * Build the user's exportable data snapshot.
   * Returns a plain JS object — ready for JSON or CSV serialisation.
   */
  async function buildUserExportSnapshot(userId) {
    const db = await readDb();

    const searches = (db.searches || [])
      .filter((s) => s.userId === userId)
      .map((s) => ({
        id: s.id,
        at: s.at,
        origin: s.payload?.origin || '',
        destination: s.payload?.destination || '',
        date_from: s.payload?.dateFrom || '',
        date_to: s.payload?.dateTo || '',
        cabin_class: s.payload?.cabinClass || ''
      }));

    const priceAlerts = (db.priceAlerts || [])
      .filter((a) => a.userId === userId && !a.deletedAt)
      .map((a) => ({
        id: a.id,
        origin: a.origin || '',
        destination: a.destinationIata || '',
        target_price: a.targetPrice ?? '',
        created_at: a.createdAt || '',
        enabled: Boolean(a.enabled)
      }));

    const watchlist = (db.watchlists || [])
      .filter((w) => w.userId === userId)
      .map((w) => ({
        id: w.id,
        origin: w.origin || '',
        destination: w.destination || '',
        created_at: w.createdAt || ''
      }));

    const notifications = (db.notifications || [])
      .filter((n) => n.userId === userId)
      .slice(-200)
      .map((n) => ({
        id: n.id,
        type: n.type || '',
        message: n.message || '',
        read: Boolean(n.readAt),
        created_at: n.createdAt || ''
      }));

    return {
      exported_at: new Date().toISOString(),
      user_id: userId,
      search_history: searches,
      price_alerts: priceAlerts,
      watchlist,
      notifications
    };
  }

  /**
   * Serialize a snapshot to CSV (one section per data type,
   * separated by blank lines).
   */
  function snapshotToCsv(snapshot) {
    function rowsToCsv(headers, rows) {
      const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const head = headers.join(',');
      const body = rows.map((r) => headers.map((h) => escape(r[h])).join(',')).join('\n');
      return `${head}\n${body}`;
    }

    const sections = [];

    sections.push(`# exported_at: ${snapshot.exported_at}`);
    sections.push(`# user_id: ${snapshot.user_id}`);
    sections.push('');

    sections.push('## search_history');
    sections.push(
      rowsToCsv(['id', 'at', 'origin', 'destination', 'date_from', 'date_to', 'cabin_class'], snapshot.search_history)
    );
    sections.push('');

    sections.push('## price_alerts');
    sections.push(
      rowsToCsv(['id', 'origin', 'destination', 'target_price', 'created_at', 'enabled'], snapshot.price_alerts)
    );
    sections.push('');

    sections.push('## watchlist');
    sections.push(rowsToCsv(['id', 'origin', 'destination', 'created_at'], snapshot.watchlist));
    sections.push('');

    sections.push('## notifications');
    sections.push(rowsToCsv(['id', 'type', 'message', 'read', 'created_at'], snapshot.notifications));

    return sections.join('\n');
  }

  async function requireExportAccess(req, res, next) {
    if (typeof fetchCurrentUser !== 'function') return next();
    const user = await fetchCurrentUser(req.user?.sub || req.user?.id);
    if (!user) return res.status(401).json({ error: 'user_not_found', request_id: req.id || null });
    if (!canExportData(user)) {
      await writeExportAudit(req, { formatType: 'n/a', status: 'blocked_plan' });
      return res.status(402).json({
        error: 'premium_required',
        message: 'Data export is available on the Elite plan.',
        upgrade_context: getUpgradeContext(user, 'export'),
        request_id: req.id || null
      });
    }
    return next();
  }

  // JSON export — no API key required, session auth + plan gate + export quota
  router.get(
    '/user/data-export',
    authGuard,
    requireSessionAuth,
    requireExportReason({ enforcePrefix: true }),
    requireExportPagination,
    exportRateLimiter,
    requireExportAccess,
    quotaGuard({ counter: 'export', amount: 1 }),
    async (req, res) => {
      const snapshot = await buildUserExportSnapshot(req.user.sub);
      const safeLimit = req.exportPagination?.limit || 200;
      snapshot.search_history = snapshot.search_history.slice(0, safeLimit);
      snapshot.price_alerts = snapshot.price_alerts.slice(0, safeLimit);
      snapshot.watchlist = snapshot.watchlist.slice(0, safeLimit);
      snapshot.notifications = snapshot.notifications.slice(0, safeLimit);
      await writeExportAudit(req, { formatType: 'json', status: 'success' });
      return res.json(snapshot);
    }
  );

  // CSV export — same guards
  router.get(
    '/user/data-export.csv',
    authGuard,
    requireSessionAuth,
    requireExportReason({ enforcePrefix: true }),
    requireExportPagination,
    exportRateLimiter,
    requireExportAccess,
    quotaGuard({ counter: 'export', amount: 1 }),
    async (req, res) => {
      const snapshot = await buildUserExportSnapshot(req.user.sub);
      const safeLimit = req.exportPagination?.limit || 200;
      snapshot.search_history = snapshot.search_history.slice(0, safeLimit);
      snapshot.price_alerts = snapshot.price_alerts.slice(0, safeLimit);
      snapshot.watchlist = snapshot.watchlist.slice(0, safeLimit);
      snapshot.notifications = snapshot.notifications.slice(0, safeLimit);
      const csv = snapshotToCsv(snapshot);
      const filename = `flight-suite-export-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      await writeExportAudit(req, { formatType: 'csv', status: 'success' });
      return res.status(200).send(csv);
    }
  );

  // GDPR access export — available to every authenticated user, independent of paid-plan export quota.
  router.get(
    '/user/gdpr-export',
    authGuard,
    requireSessionAuth,
    setDefaultGdprReason,
    gdprExportRateLimiter,
    async (req, res) => {
      const userId = normalizeUserId(req);
      if (!userId) {
        await writeExportAudit(req, { formatType: 'gdpr_json', status: 'failed' });
        return res.status(401).json({ error: 'user_not_found', request_id: req.id || null });
      }

      try {
        const snapshot = await buildGdprExportSnapshot(userId);
        await writeExportAudit(req, { formatType: 'gdpr_json', status: 'success' });
        return res.json(snapshot);
      } catch (error) {
        await writeExportAudit(req, { formatType: 'gdpr_json', status: 'failed' });
        throw error;
      }
    }
  );

  return router;
}
