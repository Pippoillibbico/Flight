/**
 * QuotaWarningBanner
 *
 * Shows a dismissible top-of-page banner when any monthly counter
 * reaches or exceeds the warning threshold (default 80%).
 *
 * Props:
 *   quota       — object from GET /api/billing/quota (or null)
 *   planId      — 'free' | 'pro' | 'elite'
 *   onUpgrade   — callback to open the upgrade modal
 *   threshold   — percentage at which the warning triggers (default 80)
 */

const COUNTER_LABELS = {
  search:       'Searches',
  decision:     'AI Decisions',
  alerts:       'Alerts',
  notifications: 'Notifications',
  export:       'Exports'
};

function pct(used, limit) {
  if (!limit || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function QuotaWarningBanner({ quota, planId, onUpgrade, threshold = 80 }) {
  if (!quota?.counters) return null;

  // Find the counter closest to (or over) the threshold
  const critical = Object.entries(quota.counters)
    .map(([key, info]) => ({ key, info, ratio: pct(info?.used, info?.limit) }))
    .filter(({ ratio }) => ratio >= threshold)
    .sort((a, b) => b.ratio - a.ratio)[0];

  if (!critical) return null;

  const { key, info, ratio } = critical;
  const label = COUNTER_LABELS[key] || key;
  const isFull = ratio >= 100;
  const isFree = planId === 'free' || planId == null;

  return (
    <div
      className={`quota-warn-banner${isFull ? ' quota-warn-banner--full' : ''}`}
      role="alert"
      data-testid="quota-warning-banner"
    >
      <span className="quota-warn-icon" aria-hidden="true">{isFull ? '⛔' : '⚠'}</span>
      <span className="quota-warn-text">
        {isFull
          ? `${label} limit reached (${info.used}/${info.limit}). You won't receive new ${label.toLowerCase()} until next month.`
          : `${label} at ${ratio}% (${info.used}/${info.limit}). You're close to your monthly limit.`}
      </span>
      {isFree && onUpgrade ? (
        <button
          type="button"
          className="quota-warn-cta"
          onClick={() => onUpgrade('pro', `quota_warning_${key}`)}
          data-testid="quota-warning-upgrade-btn"
        >
          Upgrade for more
        </button>
      ) : null}
    </div>
  );
}

export default QuotaWarningBanner;
