function roundPriceForDisplay(value) {
  const base = Math.max(4.99, Number(value || 0));
  const rounded = Math.ceil(base);
  return Number((rounded - 0.01).toFixed(2));
}

function parseAllowedAiPlans(rawValue) {
  return new Set(
    String(rawValue || 'elite,creator')
      .split(',')
      .map((entry) => String(entry || '').trim().toLowerCase())
      .filter(Boolean)
      .map((entry) => (entry === 'creator' ? 'elite' : entry))
  );
}

function estimatePlanApiCostEur({ tokenCosts, planTokenUsage, planKey, aiUsageGrowthFactor }) {
  const plan = planTokenUsage[planKey];
  if (!plan) return 0;
  const openaiShare = Math.max(0, Math.min(1, plan.openaiShare));
  const claudeShare = 1 - openaiShare;
  const usageGrowth = Math.max(1, Number.isFinite(aiUsageGrowthFactor) ? aiUsageGrowthFactor : 1);
  const inputM = (plan.monthlyInputTokens * usageGrowth) / 1_000_000;
  const outputM = (plan.monthlyOutputTokens * usageGrowth) / 1_000_000;
  const openaiCost = inputM * tokenCosts.openai.inputPer1M + outputM * tokenCosts.openai.outputPer1M;
  const claudeCost = inputM * tokenCosts.claude.inputPer1M + outputM * tokenCosts.claude.outputPer1M;
  return openaiCost * openaiShare + claudeCost * claudeShare;
}

async function fetchAiTokenCosts({ aiCostFeedUrl, defaultAiTokenCosts, fetchImpl }) {
  const safeDefaults = {
    openai: {
      inputPer1M: Number(defaultAiTokenCosts.openai.inputPer1M),
      outputPer1M: Number(defaultAiTokenCosts.openai.outputPer1M)
    },
    claude: {
      inputPer1M: Number(defaultAiTokenCosts.claude.inputPer1M),
      outputPer1M: Number(defaultAiTokenCosts.claude.outputPer1M)
    },
    source: 'env-default',
    checkedAt: new Date().toISOString()
  };

  if (!aiCostFeedUrl) return safeDefaults;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetchImpl(aiCostFeedUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return safeDefaults;
      const openaiInput = Number(payload?.openai?.inputPer1M);
      const openaiOutput = Number(payload?.openai?.outputPer1M);
      const claudeInput = Number(payload?.claude?.inputPer1M);
      const claudeOutput = Number(payload?.claude?.outputPer1M);
      if (![openaiInput, openaiOutput, claudeInput, claudeOutput].every((v) => Number.isFinite(v) && v > 0)) {
        return safeDefaults;
      }
      return {
        openai: { inputPer1M: openaiInput, outputPer1M: openaiOutput },
        claude: { inputPer1M: claudeInput, outputPer1M: claudeOutput },
        source: 'remote-feed',
        checkedAt: new Date().toISOString()
      };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return safeDefaults;
  }
}

function buildRecommendedPricing({
  tokenCosts,
  planTokenUsage,
  aiTargetMargin,
  aiPlatformOverheadEur,
  aiSafetyBufferEur,
  aiUsageGrowthFactor
}) {
  const proCost = estimatePlanApiCostEur({
    tokenCosts,
    planTokenUsage,
    planKey: 'pro',
    aiUsageGrowthFactor
  });
  const creatorCost = estimatePlanApiCostEur({
    tokenCosts,
    planTokenUsage,
    planKey: 'creator',
    aiUsageGrowthFactor
  });

  const marginDivisor = Math.max(0.05, 1 - Math.max(0.25, Math.min(0.9, aiTargetMargin)));
  const proRaw = (proCost + aiPlatformOverheadEur + aiSafetyBufferEur) / marginDivisor;
  const creatorRaw = (creatorCost + aiPlatformOverheadEur * 1.8 + aiSafetyBufferEur * 1.4) / marginDivisor;

  return {
    free: { monthlyEur: 0 },
    pro: { monthlyEur: roundPriceForDisplay(proRaw) },
    creator: { monthlyEur: roundPriceForDisplay(Math.max(creatorRaw, proRaw + 8)) }
  };
}

export function createSubscriptionPricingMonitor({
  withDb,
  appendImmutableAudit,
  nanoid,
  env = process.env,
  fetchImpl = fetch
}) {
  const defaultAiTokenCosts = {
    openai: {
      inputPer1M: Number(env.OPENAI_INPUT_COST_PER_1M || 0.15),
      outputPer1M: Number(env.OPENAI_OUTPUT_COST_PER_1M || 0.6)
    },
    claude: {
      inputPer1M: Number(env.ANTHROPIC_INPUT_COST_PER_1M || 3),
      outputPer1M: Number(env.ANTHROPIC_OUTPUT_COST_PER_1M || 15)
    }
  };
  const allowedAiPlans = parseAllowedAiPlans(env.AI_ALLOWED_PLAN_TYPES);
  const proAiIncluded = allowedAiPlans.has('pro');
  const creatorAiIncluded = allowedAiPlans.has('elite') || allowedAiPlans.has('creator');

  const planTokenUsage = {
    // Keep pricing monitor aligned with actual AI entitlement policy.
    // If a plan is not AI-enabled by policy, its AI token cost model is zeroed.
    pro: {
      monthlyInputTokens: proAiIncluded ? 2200000 : 0,
      monthlyOutputTokens: proAiIncluded ? 480000 : 0,
      openaiShare: 0.72
    },
    creator: {
      monthlyInputTokens: creatorAiIncluded ? 6200000 : 0,
      monthlyOutputTokens: creatorAiIncluded ? 1600000 : 0,
      openaiShare: 0.62
    }
  };
  const aiCostFeedUrl = String(env.AI_COST_FEED_URL || '').trim();
  const aiTargetMargin = Number(env.AI_TARGET_MARGIN || 0.72);
  const aiUsageGrowthFactor = Number(env.AI_USAGE_GROWTH_FACTOR || 1.15);
  const aiPlatformOverheadEur = Number(env.AI_PLATFORM_OVERHEAD_EUR || 2.2);
  const aiSafetyBufferEur = Number(env.AI_SAFETY_BUFFER_EUR || 1.4);

  return async function monitorAndUpdateSubscriptionPricing({ reason = 'cron' } = {}) {
    const tokenCosts = await fetchAiTokenCosts({
      aiCostFeedUrl,
      defaultAiTokenCosts,
      fetchImpl
    });
    const recommended = buildRecommendedPricing({
      tokenCosts,
      planTokenUsage,
      aiTargetMargin,
      aiPlatformOverheadEur,
      aiSafetyBufferEur,
      aiUsageGrowthFactor
    });
    let updated = false;
    let snapshot = null;

    await withDb(async (db) => {
      const current = db.subscriptionPricing || {
        free: { monthlyEur: 0 },
        pro: { monthlyEur: 12.99 },
        creator: { monthlyEur: 29.99 }
      };
      const currentPro = Number(current?.pro?.monthlyEur || recommended.pro.monthlyEur);
      const currentCreator = Number(current?.creator?.monthlyEur || recommended.creator.monthlyEur);
      const nextPro = Number(recommended.pro.monthlyEur);
      const nextCreator = Number(recommended.creator.monthlyEur);

      const proShouldIncrease = nextPro > currentPro + 0.009;
      const creatorShouldIncrease = nextCreator > currentCreator + 0.009;
      const proShouldDecrease = currentPro - nextPro >= 0.5;
      const creatorShouldDecrease = currentCreator - nextCreator >= 0.5;
      updated = proShouldIncrease || creatorShouldIncrease || proShouldDecrease || creatorShouldDecrease;

      db.subscriptionPricing = {
        free: { monthlyEur: 0 },
        pro: { monthlyEur: proShouldIncrease || proShouldDecrease ? nextPro : currentPro },
        creator: {
          monthlyEur: creatorShouldIncrease || creatorShouldDecrease ? nextCreator : currentCreator
        },
        updatedAt: updated ? new Date().toISOString() : current.updatedAt || null,
        lastCostCheckAt: new Date().toISOString(),
        marginTarget: aiTargetMargin,
        usageGrowthFactor: aiUsageGrowthFactor
      };

      db.aiCostSnapshots = db.aiCostSnapshots || [];
      snapshot = {
        id: nanoid(10),
        at: new Date().toISOString(),
        reason,
        source: tokenCosts.source,
        tokenCosts: {
          openai: tokenCosts.openai,
          claude: tokenCosts.claude
        },
        usageGrowthFactor: aiUsageGrowthFactor,
        recommended,
        applied: db.subscriptionPricing
      };
      db.aiCostSnapshots.push(snapshot);
      db.aiCostSnapshots = db.aiCostSnapshots.slice(-500);
      return db;
    });

    appendImmutableAudit({
      category: 'ai_pricing_check',
      type: updated ? 'pricing_updated' : 'pricing_checked',
      success: true,
      detail: `reason=${reason}; pro=${recommended.pro.monthlyEur}; creator=${recommended.creator.monthlyEur}; source=${tokenCosts.source}; usageGrowth=${aiUsageGrowthFactor}`
    }).catch(() => {});

    return {
      ok: true,
      updated,
      snapshot
    };
  };
}
