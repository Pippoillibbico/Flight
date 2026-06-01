import React, { useEffect, useState } from 'react';

/**
 * TrialBanner - shown to users who are currently on a premium trial.
 *
 * Props:
 *   trialDaysRemaining  {number}   Days left in the trial (>= 1).
 *   trialEndsAt         {string}   ISO date string when the trial ends.
 *   onUpgrade           {function} Opens the upgrade / checkout flow.
 */
export default function TrialBanner({ trialDaysRemaining = 0, trialEndsAt = null, onUpgrade, t = (key) => key }) {
  const [dismissed, setDismissed] = useState(false);

  // Emit trial_banner_shown once when the banner first appears.
  useEffect(() => {
    if (dismissed || !trialDaysRemaining) return;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('flight_upgrade_event', {
        detail: { eventType: 'trial_banner_shown', planType: 'pro', source: 'trial_banner' }
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (dismissed || !trialDaysRemaining) return null;

  const urgent = trialDaysRemaining <= 2;
  const endsDate = trialEndsAt ? new Date(trialEndsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;
  const dayWord = trialDaysRemaining === 1 ? t('trialBannerDaySingular') : t('trialBannerDayPlural');
  const trialText = urgent
    ? t('trialBannerUrgent')
      .replace('{count}', trialDaysRemaining)
      .replace('{dayWord}', dayWord)
      .replace('{date}', endsDate ? ` (${endsDate})` : '')
    : t('trialBannerActive')
      .replace('{count}', trialDaysRemaining)
      .replace('{dayWord}', dayWord);

  return (
    <div className={`trial-banner${urgent ? ' trial-banner--urgent' : ''}`} role="status">
      <span className="trial-banner-icon" aria-hidden="true">{urgent ? '!' : '*'}</span>
      <span className="trial-banner-text">{trialText}</span>
      {typeof onUpgrade === 'function' && (
        <button className="trial-banner-cta" onClick={() => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('flight_upgrade_event', {
              detail: { eventType: 'trial_upgrade_clicked', planType: 'pro', source: 'trial_banner' }
            }));
          }
          onUpgrade('pro', 'trial_banner');
        }}>
          {t('trialBannerUpgradeCta')}
        </button>
      )}
      <button
        className="trial-banner-dismiss"
        aria-label={t('trialBannerDismiss')}
        onClick={() => setDismissed(true)}
      >
        &times;
      </button>
    </div>
  );
}
