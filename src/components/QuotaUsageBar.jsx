function pct(used, limit) {
  if (!limit || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function barClass(ratio) {
  if (ratio >= 90) return 'qub-bar--critical';
  if (ratio >= 70) return 'qub-bar--warning';
  return 'qub-bar--ok';
}

function QuotaUsageBar({ quota, planId, onUpgrade, compact = false, t: tProp }) {
  const tFn = typeof tProp === 'function' ? tProp : (key, fallback) => fallback || key;

  const COUNTER_LABELS = {
    search: tFn('quotaCounterSearch', 'Searches'),
    decision: tFn('quotaCounterDecision', 'AI Decisions'),
    alerts: tFn('quotaCounterAlerts', 'Alerts')
  };

  if (!quota || !quota.counters) return null;

  const isFree = planId === 'free';
  const shown = ['search', 'decision', 'alerts'];

  if (compact) {
    const search = quota.counters.search || {};
    const ratio = pct(search.used, search.limit);
    return (
      <div className="qub-compact" title={`${search.used} / ${search.limit} ${tFn('quotaSearchesUsedHint', 'searches used this month')}`}>
        <div className="qub-compact-inner">
          <div
            className={`qub-compact-fill ${barClass(ratio)}`}
            style={{ width: `${ratio}%` }}
            aria-valuenow={ratio}
            aria-valuemin={0}
            aria-valuemax={100}
            role="progressbar"
          />
        </div>
        <span className="qub-compact-label">{search.used}/{search.limit} {tFn('quotaSearchesLabel', 'searches')}</span>
        {isFree && ratio >= 70 && onUpgrade ? (
          <button type="button" className="qub-upgrade-chip" onClick={() => onUpgrade('pro', 'quota_bar')}>
            {tFn('quotaUpgradeCta', 'Upgrade')}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="qub-panel">
      <div className="qub-header">
        <span className="qub-title">{tFn('quotaUsageTitle', 'Usage this month')}</span>
        {quota.periodKey ? <span className="qub-period">{quota.periodKey}</span> : null}
      </div>

      <ul className="qub-list" aria-label={tFn('quotaUsageTitle', 'Monthly quota usage')}>
        {shown.map((counter) => {
          const info = quota.counters[counter];
          if (!info) return null;
          const ratio = pct(info.used, info.limit);
          const label = COUNTER_LABELS[counter] || counter;
          return (
            <li key={counter} className="qub-item">
              <div className="qub-item-top">
                <span className="qub-item-name">{label}</span>
                <span className="qub-item-count">
                  <strong>{info.used}</strong>
                  <span className="qub-item-sep">/</span>
                  {info.limit}
                </span>
              </div>
              <div className="qub-track" role="progressbar" aria-valuenow={ratio} aria-valuemin={0} aria-valuemax={100} aria-label={`${label}: ${ratio}%`}>
                <div className={`qub-fill ${barClass(ratio)}`} style={{ width: `${ratio}%` }} />
              </div>
            </li>
          );
        })}
      </ul>

      {isFree && onUpgrade ? (
        <div className="qub-footer">
          <p className="qub-footer-hint">{tFn('quotaUpgradeHint', 'Upgrade for higher limits and AI features.')}</p>
          <button type="button" className="qub-cta" onClick={() => onUpgrade('pro', 'quota_bar')}>
            {tFn('quotaViewPlans', 'View plans')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default QuotaUsageBar;
