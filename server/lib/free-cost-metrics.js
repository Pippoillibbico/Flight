const freeCostMetrics = {
  ai_calls_by_plan: {},
  provider_calls_by_plan: {},
  free_cache_hit: 0,
  free_cache_miss: 0,
  free_cache_hit_rate: { hits: 0, misses: 0, rate: 0 },
  free_provider_call_blocked: 0,
  free_ai_blocked: 0,
  free_upgrade_prompt_shown: 0,
  free_upgrade_clicked: 0
};

function bumpMap(map, key) {
  const safeKey = String(key || 'unknown').trim().toLowerCase() || 'unknown';
  map[safeKey] = Number(map[safeKey] || 0) + 1;
}

function refreshCacheRate() {
  const hits = Number(freeCostMetrics.free_cache_hit_rate.hits || 0);
  const misses = Number(freeCostMetrics.free_cache_hit_rate.misses || 0);
  const total = hits + misses;
  freeCostMetrics.free_cache_hit_rate.rate = total > 0 ? Math.round((hits / total) * 10000) / 10000 : 0;
}

export function recordAiCallByPlan(planType) {
  bumpMap(freeCostMetrics.ai_calls_by_plan, planType);
}

export function recordProviderCallByPlan(planType) {
  bumpMap(freeCostMetrics.provider_calls_by_plan, planType);
}

export function recordFreeCacheHit(hit) {
  if (hit) {
    freeCostMetrics.free_cache_hit += 1;
    freeCostMetrics.free_cache_hit_rate.hits += 1;
  } else {
    freeCostMetrics.free_cache_miss += 1;
    freeCostMetrics.free_cache_hit_rate.misses += 1;
  }
  refreshCacheRate();
}

export function recordFreeProviderCallBlocked() {
  freeCostMetrics.free_provider_call_blocked += 1;
}

export function recordFreeAiBlocked() {
  freeCostMetrics.free_ai_blocked += 1;
}

export function recordUpgradePromptShown() {
  freeCostMetrics.free_upgrade_prompt_shown += 1;
}

export function recordUpgradeClicked() {
  freeCostMetrics.free_upgrade_clicked += 1;
}

export function getFreeCostMetrics() {
  return JSON.parse(JSON.stringify(freeCostMetrics));
}

export function resetFreeCostMetrics() {
  freeCostMetrics.ai_calls_by_plan = {};
  freeCostMetrics.provider_calls_by_plan = {};
  freeCostMetrics.free_cache_hit = 0;
  freeCostMetrics.free_cache_miss = 0;
  freeCostMetrics.free_cache_hit_rate = { hits: 0, misses: 0, rate: 0 };
  freeCostMetrics.free_provider_call_blocked = 0;
  freeCostMetrics.free_ai_blocked = 0;
  freeCostMetrics.free_upgrade_prompt_shown = 0;
  freeCostMetrics.free_upgrade_clicked = 0;
}
