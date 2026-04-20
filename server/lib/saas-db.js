import { randomBytes } from 'node:crypto';
import { readDb, withDb } from './db.js';
import {
  COUNTER_NAMES,
  PLANS,
  buildDefaultApiKeyQuota,
  countersWithIncrement,
  getCounter,
  hashKey,
  mapPlanRowToModel,
  mapRemaining,
  monthKey,
  monthResetIso,
  normalizeCounterCost,
  normalizePlanId,
  nowIso,
  planCounterLimit,
  randomId,
  sanitizeScopes
} from './saas-db-helpers.js';
import { checkAndExpireTrialForUser, grantPremiumTrialForUser, isInTrial, trialDaysRemaining } from './saas-trial.js';

export { PLANS } from './saas-db-helpers.js';
export { isInTrial, trialDaysRemaining } from './saas-trial.js';

let _pgPool = null;
export function setSaasPool(pool) {
  _pgPool = pool;
}
export function getSaasPool() {
  return _pgPool;
}

function pg() {
  return _pgPool;
}


async function loadApiKeyById(userId, keyId) {
  if (pg()) {
    const res = await pg().query(
      `SELECT id, user_id, name, key_prefix, scopes, quota_limits, last_used_at, revoked_at, expires_at, created_at
       FROM api_keys
       WHERE id = $1 AND user_id = $2`,
      [keyId, userId]
    );
    return res.rows[0] || null;
  }
  const db = await readDb();
  return (db.apiKeys || []).find((k) => k.id === keyId && k.userId === userId) || null;
}

async function getCounterRowPg(client, actorType, actorId, userId, periodKey) {
  const upsert = await client.query(
    `INSERT INTO usage_counters (actor_type, actor_id, user_id, period_key, counters, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '{}'::jsonb, NOW(), NOW())
     ON CONFLICT (actor_type, actor_id, period_key)
     DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [actorType, actorId, userId, periodKey]
  );
  const row = upsert.rows[0];
  const locked = await client.query(`SELECT * FROM usage_counters WHERE id = $1 FOR UPDATE`, [row.id]);
  return locked.rows[0];
}

async function getCounterRowJson(actorType, actorId, userId, periodKey) {
  const db = await readDb();
  return (db.usageCounters || []).find(
    (c) => c.actorType === actorType && c.actorId === actorId && c.periodKey === periodKey && c.userId === userId
  );
}

export async function getOrCreateSubscription(userId) {
  if (pg()) {
    const existing = await pg().query(
      `SELECT us.*, p.monthly_credits, p.price_monthly_eur, p.features
       FROM user_subscriptions us
       JOIN plans p ON p.id = us.plan_id
       WHERE us.user_id = $1`,
      [userId]
    );
    if (existing.rows[0]) return mapPlanRowToModel(existing.rows[0].plan_id, existing.rows[0]);

    await pg().query(
      `INSERT INTO user_subscriptions (user_id, plan_id)
       VALUES ($1, 'free')
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );
    const refetch = await pg().query(
      `SELECT us.*, p.monthly_credits, p.price_monthly_eur, p.features
       FROM user_subscriptions us
       JOIN plans p ON p.id = us.plan_id
       WHERE us.user_id = $1`,
      [userId]
    );
    return mapPlanRowToModel(refetch.rows[0]?.plan_id || 'free', refetch.rows[0] || { user_id: userId, plan_id: 'free' });
  }

  let result = null;
  await withDb((state) => {
    const found = (state.userSubscriptions || []).find((s) => s.userId === userId);
    if (found) {
      result = mapPlanRowToModel(found.planId, found);
      return state;
    }
    const created = {
      id: randomId(),
      userId,
      planId: 'free',
      status: 'active',
      extraCredits: 0,
      currentPeriodStart: nowIso(),
      currentPeriodEnd: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: nowIso()
    };
    result = mapPlanRowToModel('free', created);
    return { ...state, userSubscriptions: [...(state.userSubscriptions || []), created] };
  });
  return result;
}

export async function upsertSubscriptionFromStripe({
  userId,
  stripeSubscriptionId,
  stripeCustomerId,
  planId,
  status,
  currentPeriodStart,
  currentPeriodEnd,
  cancelAtPeriodEnd
}) {
  const normalizedPlan = normalizePlanId(planId);
  if (pg()) {
    await pg().query(
      `INSERT INTO user_subscriptions
         (user_id, plan_id, status, stripe_subscription_id, stripe_customer_id,
          current_period_start, current_period_end, cancel_at_period_end, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET
         plan_id = EXCLUDED.plan_id,
         status = EXCLUDED.status,
         stripe_subscription_id = EXCLUDED.stripe_subscription_id,
         stripe_customer_id = EXCLUDED.stripe_customer_id,
         current_period_start = EXCLUDED.current_period_start,
         current_period_end = EXCLUDED.current_period_end,
         cancel_at_period_end = EXCLUDED.cancel_at_period_end,
         updated_at = NOW()`,
      [userId, normalizedPlan, status, stripeSubscriptionId, stripeCustomerId, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd]
    );
    return;
  }

  await withDb((state) => {
    const subs = state.userSubscriptions || [];
    const idx = subs.findIndex((s) => s.userId === userId);
    const nextSub = {
      ...(idx >= 0 ? subs[idx] : { id: randomId(), createdAt: nowIso() }),
      userId,
      planId: normalizedPlan,
      status,
      stripeSubscriptionId,
      stripeCustomerId,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd,
      updatedAt: nowIso()
    };
    const nextSubs = idx >= 0 ? subs.map((s, i) => (i === idx ? nextSub : s)) : [...subs, nextSub];
    return { ...state, userSubscriptions: nextSubs };
  });
}

export async function checkAndIncrementQuota(userId, cost, { endpoint = 'unknown', apiKeyId = null, metadata = null } = {}) {
  const { counter, amount } = normalizeCounterCost(cost);
  const periodKey = monthKey();
  const actorType = apiKeyId ? 'api_key' : 'user';
  const actorId = apiKeyId || userId;

  if (!COUNTER_NAMES.includes(counter)) {
    return {
      allowed: false,
      counter,
      used: 0,
      limit: 0,
      remaining: 0,
      resetAt: monthResetIso(periodKey),
      actorType,
      periodKey
    };
  }

  let limit = 0;
  if (actorType === 'api_key') {
    const keyInfo = await loadApiKeyById(userId, apiKeyId);
    if (!keyInfo || keyInfo.revoked_at || keyInfo.revokedAt) {
      return {
        allowed: false,
        counter,
        used: 0,
        limit: 0,
        remaining: 0,
        resetAt: monthResetIso(periodKey),
        actorType,
        periodKey
      };
    }
    const keyLimits = keyInfo.quota_limits ?? keyInfo.quotaLimits ?? {};
    limit = Number(keyLimits[counter] ?? 0);
  } else {
    const sub = await getOrCreateSubscription(userId);
    limit = planCounterLimit(sub.planId, counter);
  }

  if (limit <= 0) {
    return {
      allowed: false,
      counter,
      used: 0,
      limit: 0,
      remaining: 0,
      resetAt: monthResetIso(periodKey),
      actorType,
      periodKey
    };
  }

  if (pg()) {
    const client = await pg().connect();
    try {
      await client.query('BEGIN');
      const row = await getCounterRowPg(client, actorType, actorId, userId, periodKey);
      const counters = row.counters || {};
      const used = getCounter(counters, counter);

      if (used + amount > limit) {
        await client.query('ROLLBACK');
        return {
          allowed: false,
          counter,
          used,
          limit,
          remaining: Math.max(0, limit - used),
          resetAt: monthResetIso(periodKey),
          actorType,
          periodKey
        };
      }

      const nextCounters = countersWithIncrement(counters, counter, amount);
      await client.query(
        `UPDATE usage_counters
         SET counters = $1::jsonb, updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(nextCounters), row.id]
      );

      await client.query(
        `INSERT INTO usage_events (user_id, api_key_id, endpoint, credits_used, counter, actor_type, actor_id, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [userId, apiKeyId, endpoint, amount, counter, actorType, actorId, metadata ? JSON.stringify(metadata) : null]
      );
      await client.query('COMMIT');
      const nextUsed = getCounter(nextCounters, counter);
      return {
        allowed: true,
        counter,
        used: nextUsed,
        limit,
        remaining: Math.max(0, limit - nextUsed),
        resetAt: monthResetIso(periodKey),
        actorType,
        periodKey
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  let result = null;
  await withDb((state) => {
    const list = state.usageCounters || [];
    const found = list.find(
      (item) => item.actorType === actorType && item.actorId === actorId && item.userId === userId && item.periodKey === periodKey
    );
    const row = found || {
      id: randomId(),
      actorType,
      actorId,
      userId,
      periodKey,
      counters: {},
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    const used = getCounter(row.counters, counter);
    if (used + amount > limit) {
      result = {
        allowed: false,
        counter,
        used,
        limit,
        remaining: Math.max(0, limit - used),
        resetAt: monthResetIso(periodKey),
        actorType,
        periodKey
      };
      return null;
    }

    const nextRow = {
      ...row,
      counters: countersWithIncrement(row.counters, counter, amount),
      updatedAt: nowIso()
    };
    const nextList = found ? list.map((item) => (item.id === found.id ? nextRow : item)) : [...list, nextRow];
    const usageEvent = {
      id: randomId(),
      userId,
      apiKeyId,
      endpoint,
      creditsUsed: amount,
      counter,
      actorType,
      actorId,
      metadata,
      createdAt: nowIso()
    };
    const nextUsed = getCounter(nextRow.counters, counter);
    result = {
      allowed: true,
      counter,
      used: nextUsed,
      limit,
      remaining: Math.max(0, limit - nextUsed),
      resetAt: monthResetIso(periodKey),
      actorType,
      periodKey
    };
    return {
      ...state,
      usageCounters: nextList,
      usageEvents: [...(state.usageEvents || []), usageEvent]
    };
  });
  return result;
}

/**
 * Read-only quota status — returns current usage for all counters without
 * incrementing any counter.  Safe to call from GET endpoints.
 */
export async function getQuotaStatus(userId) {
  const periodKey = monthKey();
  const sub = await getOrCreateSubscription(userId);
  const plan = PLANS[normalizePlanId(sub.planId)];

  let counters = {};
  if (pg()) {
    const res = await pg().query(
      `SELECT counters FROM usage_counters
       WHERE actor_type = 'user' AND actor_id = $1 AND period_key = $2
       LIMIT 1`,
      [userId, periodKey]
    );
    counters = res.rows[0]?.counters || {};
  } else {
    const row = await getCounterRowJson('user', userId, userId, periodKey);
    counters = row?.counters || {};
  }

  const limits = plan.quotas || {};
  const status = {};
  for (const counter of COUNTER_NAMES) {
    const limit = Number(limits[counter] ?? 0);
    const used  = Number(counters[counter]  ?? 0);
    status[counter] = {
      used,
      limit,
      remaining: Math.max(0, limit - used),
      resetAt: monthResetIso(periodKey)
    };
  }

  return {
    planId: sub.planId,
    periodKey,
    counters: status
  };
}

export async function issueApiKey(userId, { name = 'Default key', scopes = ['read'], quotaLimits = null, maxKeys = null } = {}) {
  const sub = await getOrCreateSubscription(userId);
  const plan = PLANS[normalizePlanId(sub.planId)];
  if (plan.apiKeysMax <= 0) {
    const err = new Error('API keys are not available on the free plan.');
    err.status = 403;
    err.code = 'upgrade_required';
    throw err;
  }

  const raw = `fsk_live_${randomBytes(24).toString('hex')}`;
  const hash = hashKey(raw);
  const prefix = `${raw.slice(0, 14)}...`;
  const sanitizedScopes = sanitizeScopes(scopes);
  const limits = quotaLimits && typeof quotaLimits === 'object' ? quotaLimits : buildDefaultApiKeyQuota(plan.id);

  if (pg()) {
    const client = await pg().connect();
    try {
      await client.query('BEGIN');
      if (maxKeys !== null) {
        // Advisory lock serializes all issueApiKey calls for the same user.
        // FOR UPDATE on existing rows cannot prevent phantom inserts when the
        // table is empty, so we use pg_advisory_xact_lock instead.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId]);
        const countRes = await client.query(
          `SELECT COUNT(*) AS cnt FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId]
        );
        if (Number(countRes.rows[0].cnt) >= maxKeys) {
          await client.query('ROLLBACK');
          const err = new Error(`Maximum of ${maxKeys} active API keys for current plan.`);
          err.status = 422;
          err.code = 'key_limit_reached';
          throw err;
        }
      }
      const res = await client.query(
        `INSERT INTO api_keys (user_id, name, key_prefix, key_hash, scopes, quota_limits, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         RETURNING id, user_id, name, key_prefix, scopes, quota_limits, last_used_at, revoked_at, expires_at, created_at`,
        [userId, name, prefix, hash, sanitizedScopes, JSON.stringify(limits)]
      );
      await client.query('COMMIT');
      return { ...res.rows[0], rawKey: raw };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  let record = null;
  let limitError = null;
  await withDb((state) => {
    if (maxKeys !== null) {
      const activeCount = (state.apiKeys || []).filter((k) => k.userId === userId && !k.revokedAt).length;
      if (activeCount >= maxKeys) {
        limitError = true;
        return state;
      }
    }
    record = {
      id: randomId(),
      userId,
      name,
      keyPrefix: prefix,
      keyHash: hash,
      scopes: sanitizedScopes,
      quotaLimits: limits,
      lastUsedAt: null,
      revokedAt: null,
      expiresAt: null,
      createdAt: nowIso()
    };
    return { ...state, apiKeys: [...(state.apiKeys || []), record] };
  });

  if (limitError) {
    const err = new Error(`Maximum of ${maxKeys} active API keys for current plan.`);
    err.status = 422;
    err.code = 'key_limit_reached';
    throw err;
  }

  return {
    id: record.id,
    user_id: userId,
    name,
    key_prefix: prefix,
    scopes: record.scopes,
    quota_limits: record.quotaLimits,
    created_at: record.createdAt,
    rawKey: raw
  };
}

export async function verifyApiKey(rawKey) {
  const hash = hashKey(rawKey);
  if (pg()) {
    const res = await pg().query(
      `SELECT id, user_id, scopes, quota_limits
       FROM api_keys
       WHERE key_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`,
      [hash]
    );
    const row = res.rows[0];
    if (!row) return null;
    pg().query(`UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, [row.id]).catch(() => {});
    return { userId: row.user_id, keyId: row.id, scopes: row.scopes || [], quotaLimits: row.quota_limits || {} };
  }

  const db = await readDb();
  const key = (db.apiKeys || []).find((item) => (item.keyHash === hash || item.hash === hash) && !item.revokedAt);
  if (!key) return null;
  withDb((state) => ({
    ...state,
    apiKeys: (state.apiKeys || []).map((item) => (item.id === key.id ? { ...item, lastUsedAt: nowIso() } : item))
  })).catch(() => {});
  return { userId: key.userId, keyId: key.id, scopes: key.scopes || [], quotaLimits: key.quotaLimits || {} };
}

export async function getUserApiKeys(userId) {
  if (pg()) {
    const res = await pg().query(
      `SELECT id, name, key_prefix, scopes, quota_limits, last_used_at, revoked_at, expires_at, created_at
       FROM api_keys
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    return res.rows;
  }
  const db = await readDb();
  return (db.apiKeys || [])
    .filter((item) => item.userId === userId)
    .map((item) => ({
      id: item.id,
      name: item.name,
      key_prefix: item.keyPrefix || item.prefix,
      scopes: item.scopes || [],
      quota_limits: item.quotaLimits || {},
      last_used_at: item.lastUsedAt || null,
      revoked_at: item.revokedAt || null,
      expires_at: item.expiresAt || null,
      created_at: item.createdAt
    }))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function revokeApiKey(userId, keyId) {
  if (pg()) {
    const res = await pg().query(
      `UPDATE api_keys
       SET revoked_at = NOW()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
       RETURNING id`,
      [keyId, userId]
    );
    return res.rows.length > 0;
  }
  let revoked = false;
  await withDb((state) => {
    const keys = (state.apiKeys || []).map((item) => {
      if (item.id === keyId && item.userId === userId && !item.revokedAt) {
        revoked = true;
        return { ...item, revokedAt: nowIso() };
      }
      return item;
    });
    return { ...state, apiKeys: keys };
  });
  return revoked;
}

export async function rotateApiKey(userId, keyId) {
  if (pg()) {
    // PG path: load, revoke, issue in a transaction so no concurrent rotation
    // can use the same keyId.
    const client = await pg().connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT id, name, scopes, quota_limits, revoked_at
         FROM api_keys WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [keyId, userId]
      );
      const current = existing.rows[0] || null;
      if (!current || current.revoked_at) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query(
        `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [keyId, userId]
      );
      const raw = `fsk_live_${randomBytes(24).toString('hex')}`;
      const hash = hashKey(raw);
      const prefix = `${raw.slice(0, 14)}...`;
      const sanitizedScopes = sanitizeScopes(current.scopes || ['read']);
      const limits = current.quota_limits ?? buildDefaultApiKeyQuota(normalizePlanId('free'));
      const inserted = await client.query(
        `INSERT INTO api_keys (user_id, name, key_prefix, key_hash, scopes, quota_limits, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         RETURNING id, user_id, name, key_prefix, scopes, quota_limits, last_used_at, revoked_at, expires_at, created_at`,
        [userId, current.name, prefix, hash, sanitizedScopes, JSON.stringify(limits)]
      );
      await client.query('COMMIT');
      return { ...inserted.rows[0], rawKey: raw };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // JSON path: revoke + insert atomically inside a single withDb call.
  let result = null;
  await withDb((state) => {
    const current = (state.apiKeys || []).find((k) => k.id === keyId && k.userId === userId) || null;
    if (!current || current.revokedAt) return state;

    const raw = `fsk_live_${randomBytes(24).toString('hex')}`;
    const hash = hashKey(raw);
    const prefix = `${raw.slice(0, 14)}...`;
    const sanitizedScopes = sanitizeScopes(current.scopes || ['read']);
    const limits = current.quotaLimits ?? null;
    const newRecord = {
      id: randomId(),
      userId,
      name: current.name,
      keyPrefix: prefix,
      keyHash: hash,
      scopes: sanitizedScopes,
      quotaLimits: limits,
      lastUsedAt: null,
      revokedAt: null,
      expiresAt: null,
      createdAt: nowIso()
    };
    result = {
      id: newRecord.id,
      user_id: userId,
      name: newRecord.name,
      key_prefix: prefix,
      scopes: newRecord.scopes,
      quota_limits: newRecord.quotaLimits,
      created_at: newRecord.createdAt,
      rawKey: raw
    };
    const nextKeys = (state.apiKeys || []).map((k) =>
      k.id === keyId && k.userId === userId && !k.revokedAt ? { ...k, revokedAt: nowIso() } : k
    );
    nextKeys.push(newRecord);
    return { ...state, apiKeys: nextKeys };
  });
  return result;
}

export async function getUserUsageHistory(userId, limit = 100) {
  if (pg()) {
    const res = await pg().query(
      `SELECT id, endpoint, counter, credits_used, actor_type, actor_id, metadata, created_at
       FROM usage_events
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return res.rows;
  }
  const db = await readDb();
  return (db.usageEvents || [])
    .filter((item) => item.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      endpoint: item.endpoint,
      counter: item.counter || 'search',
      credits_used: Number(item.creditsUsed || 0),
      actor_type: item.actorType || 'user',
      actor_id: item.actorId || item.userId,
      metadata: item.metadata || null,
      created_at: item.createdAt
    }));
}

async function collectCountersForActor({ actorType, actorId, userId, periodKey }) {
  if (pg()) {
    const res = await pg().query(
      `SELECT counters
       FROM usage_counters
       WHERE actor_type = $1 AND actor_id = $2 AND user_id = $3 AND period_key = $4`,
      [actorType, actorId, userId, periodKey]
    );
    return res.rows[0]?.counters || {};
  }
  const row = await getCounterRowJson(actorType, actorId, userId, periodKey);
  return row?.counters || {};
}

export async function getUsageSnapshot(userId, { apiKeyId = null } = {}) {
  const sub = await getOrCreateSubscription(userId);
  const plan = PLANS[normalizePlanId(sub.planId)];
  const key = monthKey();
  const userCounters = await collectCountersForActor({ actorType: 'user', actorId: userId, userId, periodKey: key });

  let apiKeySection = null;
  if (apiKeyId) {
    const apiKey = await loadApiKeyById(userId, apiKeyId);
    if (apiKey) {
      const apiCounters = await collectCountersForActor({ actorType: 'api_key', actorId: apiKeyId, userId, periodKey: key });
      const apiLimits = apiKey.quota_limits ?? apiKey.quotaLimits ?? {};
      apiKeySection = {
        id: apiKey.id,
        name: apiKey.name,
        scopes: apiKey.scopes || [],
        limits: apiLimits,
        used: apiCounters,
        remaining: mapRemaining(apiLimits, apiCounters)
      };
    }
  }

  return {
    plan: {
      id: plan.id,
      name: plan.name,
      aiEnabled: plan.aiEnabled,
      features: plan.features
    },
    period: {
      key,
      reset_at: monthResetIso(key)
    },
    user: {
      id: userId,
      limits: plan.quotas,
      used: userCounters,
      remaining: mapRemaining(plan.quotas, userCounters)
    },
    apiKey: apiKeySection
  };
}

export async function getUsageSummary(userId) {
  const snapshot = await getUsageSnapshot(userId);
  const searchUsed = Number(snapshot.user.used.search || 0);
  const searchTotal = Number(snapshot.user.limits.search || 0);
  return {
    plan: snapshot.plan.name,
    planId: snapshot.plan.id,
    creditsUsed: searchUsed,
    creditsTotal: searchTotal,
    creditsRemaining: Math.max(0, searchTotal - searchUsed),
    resetAt: snapshot.period.reset_at,
    subscriptionStatus: 'active',
    counters: snapshot.user.used,
    limits: snapshot.user.limits,
    remaining: snapshot.user.remaining
  };
}

export async function getPricingConfig() {
  const db = await readDb();
  const stored = db.subscriptionPricing || {};
  const free = Number(process.env.PRICING_FREE_EUR ?? stored.free?.monthlyEur ?? PLANS.free.priceEur);
  const pro = Number(process.env.PRICING_PRO_EUR ?? stored.pro?.monthlyEur ?? PLANS.pro.priceEur);
  const creator = Number(process.env.PRICING_CREATOR_EUR ?? stored.creator?.monthlyEur ?? PLANS.creator.priceEur);
  return {
    pricing: {
      free: { monthlyEur: free },
      pro: { monthlyEur: pro },
      creator: { monthlyEur: creator },
      updatedAt: stored.updatedAt || null,
      lastCostCheckAt: stored.lastCostCheckAt || null
    },
    notes: {
      free_ai: 'AI not included in free plan. Free plan never calls paid AI providers.',
      scope: 'Prices may be loaded from env overrides or local DB fallback.'
    }
  };
}

// ── Premium trial helpers ─────────────────────────────────────────────────────

/**
 * Grant a time-limited Pro trial to a newly registered user.
 * Updates the user row in-place (SQLite / in-memory DB path).
 * Returns { trialEndsAt, planType } or null when trial is disabled.
 */
export async function grantPremiumTrial(userId) {
  return grantPremiumTrialForUser({
    userId,
    pool: pg(),
    withDb
  });
}

export async function getDailySearchUsageSnapshot({ sinceIso = null } = {}) {
  const since = String(sinceIso || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  if (pg()) {
    const res = await pg().query(
      `SELECT
         COUNT(*)::int AS total_events,
         COUNT(DISTINCT user_id)::int AS unique_users,
         COUNT(DISTINCT (metadata->>'session_id_hash'))::int AS unique_sessions,
         COALESCE(SUM(credits_used), 0)::int AS total_credits
       FROM usage_events
       WHERE counter = 'search'
         AND created_at >= $1::timestamptz`,
      [since]
    );
    return {
      sinceIso: since,
      totalSearchEvents: Number(res.rows[0]?.total_events || 0),
      uniqueUsers: Number(res.rows[0]?.unique_users || 0),
      uniqueSessions: Number(res.rows[0]?.unique_sessions || 0),
      totalSearchCredits: Number(res.rows[0]?.total_credits || 0)
    };
  }

  const db = await readDb();
  const events = Array.isArray(db?.usageEvents) ? db.usageEvents : [];
  const sinceMs = new Date(since).getTime();
  const rows = events.filter((item) => {
    if (String(item?.counter || '') !== 'search') return false;
    const atMs = new Date(String(item?.createdAt || 0)).getTime();
    return Number.isFinite(atMs) && atMs >= sinceMs;
  });
  const users = new Set();
  const sessions = new Set();
  let credits = 0;
  for (const row of rows) {
    if (row?.userId) users.add(String(row.userId));
    const sessionHash = row?.metadata?.session_id_hash;
    if (sessionHash) sessions.add(String(sessionHash));
    credits += Number(row?.creditsUsed || 0);
  }
  return {
    sinceIso: since,
    totalSearchEvents: rows.length,
    uniqueUsers: users.size,
    uniqueSessions: sessions.size,
    totalSearchCredits: credits
  };
}

/**
 * Check if a user's trial has expired and downgrade them to free if so.
 * Should be called at login time (non-blocking — failure is ignored).
 * Returns true if a downgrade was applied.
 */
export async function checkAndExpireTrial(userId) {
  return checkAndExpireTrialForUser({
    userId,
    pool: pg(),
    withDb
  });
}

