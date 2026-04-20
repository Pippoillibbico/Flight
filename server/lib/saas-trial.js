const PREMIUM_TRIAL_DAYS = Math.max(0, Number(process.env.PREMIUM_TRIAL_DAYS ?? 0));

export async function grantPremiumTrialForUser({ userId, pool, withDb }) {
  if (PREMIUM_TRIAL_DAYS <= 0) return null;

  const trialEndsAt = new Date(Date.now() + PREMIUM_TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  if (pool) {
    await pool
      .query(`UPDATE users SET plan_type = 'pro', is_premium = true, trial_ends_at = $1 WHERE id = $2`, [trialEndsAt, userId])
      .catch(() => {});
    return { trialEndsAt, planType: 'pro' };
  }

  await withDb(async (db) => {
    const user = (db.users || []).find((candidate) => candidate.id === userId);
    if (user) {
      user.planType = 'pro';
      user.isPremium = true;
      user.trialEndsAt = trialEndsAt;
    }
    return db;
  }).catch(() => {});

  return { trialEndsAt, planType: 'pro' };
}

export async function checkAndExpireTrialForUser({ userId, pool, withDb }) {
  if (pool) {
    const result = await pool
      .query(
        `UPDATE users
         SET plan_type = 'free', is_premium = false
         WHERE id = $1
           AND trial_ends_at IS NOT NULL
           AND trial_ends_at < NOW()
           AND plan_type = 'pro'
           AND NOT EXISTS (
             SELECT 1 FROM user_subscriptions
             WHERE user_id = $1 AND plan_id != 'free' AND status = 'active'
           )
         RETURNING id`,
        [userId]
      )
      .catch(() => ({ rows: [] }));
    return result.rows.length > 0;
  }

  let downgraded = false;
  await withDb(async (db) => {
    const user = (db.users || []).find((candidate) => candidate.id === userId);
    if (!user) return db;
    const trialEndsAt = user.trialEndsAt ? new Date(user.trialEndsAt) : null;
    if (!trialEndsAt || trialEndsAt > new Date()) return db;
    if (user.planType !== 'pro') return db;

    // Only downgrade if the user has no active paid subscription.
    const hasPaid = (db.userSubscriptions || []).some(
      (subscription) => subscription.userId === userId && subscription.planId !== 'free' && subscription.status === 'active' && !subscription.trialEndsAt
    );
    if (hasPaid) return db;

    user.planType = 'free';
    user.isPremium = false;
    downgraded = true;
    return db;
  }).catch(() => {});
  return downgraded;
}

export function isInTrial(user) {
  if (!user?.trialEndsAt) return false;
  return new Date(user.trialEndsAt) > new Date();
}

export function trialDaysRemaining(user) {
  if (!isInTrial(user)) return 0;
  const ms = new Date(user.trialEndsAt) - new Date();
  return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

