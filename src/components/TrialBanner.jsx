import React, { useEffect, useState } from 'react';

/**
 * TrialBanner — shown to users who are currently on a premium trial.
 *
 * Props:
 *   trialDaysRemaining  {number}   Days left in the trial (>= 1).
 *   trialEndsAt         {string}   ISO date string when the trial ends.
 *   onUpgrade           {function} Opens the upgrade / checkout flow.
 */
export default function TrialBanner({ trialDaysRemaining = 0, trialEndsAt = null, onUpgrade }) {
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

  return (
    <div className={`trial-banner${urgent ? ' trial-banner--urgent' : ''}`} role="status">
      <span className="trial-banner-icon">{urgent ? '⏳' : '✨'}</span>
      <span className="trial-banner-text">
        {urgent
          ? `Trial ends in ${trialDaysRemaining} day${trialDaysRemaining === 1 ? '' : 's'}${endsDate ? ` (${endsDate})` : ''} — upgrade to keep Pro access.`
          : `You're on a free Pro trial — ${trialDaysRemaining} day${trialDaysRemaining === 1 ? '' : 's'} remaining.`}
      </span>
      {typeof onUpgrade === 'function' && (
        <button className="trial-banner-cta" onClick={() => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('flight_upgrade_event', {
            detail: { eventType: 'trial_upgrade_clicked', planType: 'pro', source: 'trial_banner' }
          }));
        }
        onUpgrade('pro', 'trial_banner');
      }}>
          Upgrade now
        </button>
      )}
      <button
        className="trial-banner-dismiss"
        aria-label="Dismiss trial banner"
        onClick={() => setDismissed(true)}
      >
        &times;
      </button>
    </div>
  );
}
