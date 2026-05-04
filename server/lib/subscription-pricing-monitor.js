function resolveFixedMonthlyPrice(rawValue, fallbackValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

function resolveFixedPricing(env) {
  const eliteMonthlyEur = resolveFixedMonthlyPrice(env.PRICING_ELITE_EUR ?? env.PRICING_CREATOR_EUR, 22);
  return {
    free: { monthlyEur: 0 },
    pro: { monthlyEur: resolveFixedMonthlyPrice(env.PRICING_PRO_EUR, 12) },
    elite: { monthlyEur: eliteMonthlyEur },
    creator: { monthlyEur: eliteMonthlyEur }
  };
}

export function createSubscriptionPricingMonitor({
  withDb,
  appendImmutableAudit,
  nanoid,
  env = process.env
}) {
  return async function monitorAndUpdateSubscriptionPricing({ reason = 'cron' } = {}) {
    const fixedPricing = resolveFixedPricing(env);
    let snapshot = null;

    await withDb(async (db) => {
      const current = db.subscriptionPricing || {};
      const currentPro = Number(current?.pro?.monthlyEur);
      const currentElite = Number(current?.elite?.monthlyEur ?? current?.creator?.monthlyEur);
      const updated = currentPro !== fixedPricing.pro.monthlyEur || currentElite !== fixedPricing.elite.monthlyEur;

      db.subscriptionPricing = {
        ...fixedPricing,
        updatedAt: updated ? new Date().toISOString() : current.updatedAt || null,
        lastCostCheckAt: new Date().toISOString(),
        marginTarget: current.marginTarget ?? null,
        usageGrowthFactor: current.usageGrowthFactor ?? null
      };

      db.aiCostSnapshots = db.aiCostSnapshots || [];
      snapshot = {
        id: nanoid(10),
        at: new Date().toISOString(),
        reason,
        source: 'fixed-env-pricing',
        recommended: fixedPricing,
        applied: db.subscriptionPricing
      };
      db.aiCostSnapshots.push(snapshot);
      db.aiCostSnapshots = db.aiCostSnapshots.slice(-500);
      return db;
    });

    appendImmutableAudit({
      category: 'ai_pricing_check',
      type: 'pricing_checked',
      success: true,
      detail: `reason=${reason}; pro=${fixedPricing.pro.monthlyEur}; elite=${fixedPricing.elite.monthlyEur}; source=fixed-env-pricing`
    }).catch(() => {});

    return {
      ok: true,
      updated: false,
      snapshot
    };
  };
}
