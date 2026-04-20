export default function UpgradeInlineBanner({ title, message, ctaLabel, onCta, onDismiss }) {
  return (
    <div className="upgrade-inline-banner" role="region" aria-label={title} data-testid="upgrade-inline-banner">
      <div className="upgrade-inline-banner-body">
        <p className="upgrade-inline-banner-title" data-testid="upgrade-inline-banner-title">{title}</p>
        <p className="upgrade-inline-banner-message">{message}</p>
      </div>
      <div className="upgrade-inline-banner-actions">
        <button
          type="button"
          className="upgrade-inline-banner-cta"
          onClick={onCta}
          data-testid="upgrade-inline-banner-cta"
        >
          {ctaLabel}
        </button>
        <button
          type="button"
          className="ghost upgrade-inline-banner-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss"
          data-testid="upgrade-inline-banner-dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
