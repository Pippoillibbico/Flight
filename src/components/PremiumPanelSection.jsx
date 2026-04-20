function PremiumPanelSection({
  t,
  premiumBillingCycle,
  setPremiumBillingCycle,
  isAnnualBilling,
  premiumPackages
}) {
  return (
    <div className="ph-shell">
      <section className="ph-panel" data-testid="premium-panel">
        <div className="ph-panel-glow" aria-hidden="true" />
        <div className="ph-head">
          <p className="ph-eyebrow">Premium Access</p>
          <h2 className="ph-title">{t('premiumPageTitle')}</h2>
          <p className="ph-subtitle">{t('premiumPageSubtitle')}</p>
          <div className="ph-cycle-wrap" data-testid="premium-billing-controls">
            <div className={`ph-cycle-pill ph-cycle-pill--${premiumBillingCycle}`} role="radiogroup" aria-label="Billing cycle">
              <button
                type="button"
                role="radio"
                aria-checked={premiumBillingCycle === 'monthly'}
                data-testid="premium-billing-monthly"
                className={`ph-cycle-btn${premiumBillingCycle === 'monthly' ? ' ph-cycle-btn--on' : ''}`}
                onClick={() => setPremiumBillingCycle('monthly')}
              >
                <span>Monthly</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={premiumBillingCycle === 'annual'}
                data-testid="premium-billing-annual"
                className={`ph-cycle-btn${premiumBillingCycle === 'annual' ? ' ph-cycle-btn--on' : ''}`}
                onClick={() => setPremiumBillingCycle('annual')}
              >
                <span>Annual</span>
                <span className="ph-cycle-save-chip">30% off</span>
              </button>
              <span className="ph-cycle-pill-active" aria-hidden="true" />
            </div>
            <span className={`ph-off-badge${isAnnualBilling ? ' ph-off-badge--active' : ''}`}>
              {isAnnualBilling ? 'Annual pricing active - save up to 30%' : 'Switch to annual and save up to 30%'}
            </span>
          </div>
        </div>

        <div className="ph-grid">
          {premiumPackages.map((plan) => (
            <article
              key={plan.id}
              className={`ph-card ph-card--${plan.id}${plan.id === 'pro' ? ' ph-card--featured' : ''}`}
              data-testid={plan.cardTestId}
            >
              <div className="ph-card-top">
                {plan.id === 'pro' ? (
                  <p className="ph-top-label ph-top-label--featured">Recommended</p>
                ) : plan.id === 'elite' ? (
                  <p className="ph-top-label ph-top-label--elite">Best value</p>
                ) : (
                  <p className="ph-top-label ph-top-label--free">Get started</p>
                )}
                <p className="ph-top-caption">{plan.badgeDetail}</p>
              </div>

              <div className="ph-card-inner">
                <div className="ph-name-row">
                  <h3 className="ph-plan-name">{plan.planName}</h3>
                  <span className="ph-plan-badge">{plan.badge}</span>
                  {isAnnualBilling && plan.discountTag ? <span className="ph-disc">{plan.discountTag}</span> : null}
                </div>
                <p className="ph-plan-desc">{plan.subtitle}</p>

                <div className="ph-price-block">
                  <div className="ph-price-row">
                    {plan.legacyPrice ? <span className="ph-old-price">{plan.legacyPrice}</span> : null}
                    <span className="ph-price">{plan.price}</span>
                    <span className="ph-per">{plan.priceSuffix}</span>
                  </div>
                  <p className="ph-billing-note">{plan.billingNote}</p>
                  <p className="ph-billing-sub-note">{plan.billingSubNote}</p>
                </div>

                <div className="ph-val-box">
                  <p className="ph-val-headline">{plan.valueTitle}</p>
                  <ul className="ph-val-list">
                    {plan.valueItems.map((item) => (
                      <li key={`${plan.id}-v-${item}`}>{item}</li>
                    ))}
                  </ul>
                  <ul className="ph-meter-stops" aria-hidden="true">
                    {plan.meterStops.map((step, idx) => (
                      <li key={`${plan.id}-m-${step}`} className={idx === 0 ? 'ph-meter-stop--active' : ''}>{step}</li>
                    ))}
                  </ul>
                </div>

                <ul className="ph-feats">
                  {plan.included.map((feat) => (
                    <li key={`${plan.id}-i-${feat}`} className="ph-feat ph-feat--yes">
                      <span className="ph-feat-icon">+</span>{feat}
                    </li>
                  ))}
                  {plan.missing.map((feat) => (
                    <li key={`${plan.id}-x-${feat}`} className="ph-feat ph-feat--no">
                      <span className="ph-feat-icon">-</span>{feat}
                    </li>
                  ))}
                </ul>

                <div className="ph-card-actions">
                  <button
                    type="button"
                    className={`ph-cta ph-cta--${plan.id}`}
                    onClick={plan.onClick}
                    data-testid={plan.ctaTestId}
                  >
                    <span>{plan.ctaLabel}</span>
                    <span className="ph-cta-arrow" aria-hidden="true">{'->'}</span>
                  </button>
                  <p className="ph-save-line">{plan.saveNote}</p>
                </div>
              </div>
            </article>
          ))}
        </div>

        <p className="ph-trust">
          {t('premiumTrustNote') || 'No payment is charged in this step. You can switch or cancel anytime.'}
        </p>
      </section>
    </div>
  );
}

export default PremiumPanelSection;
