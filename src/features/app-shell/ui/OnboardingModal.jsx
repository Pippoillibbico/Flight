export default function OnboardingModal({
  isOpen,
  isAuthenticated,
  t,
  onboardingDraft,
  setOnboardingDraft,
  config,
  regionLabel,
  finishOnboarding,
  onboardingSaving,
  setShowOnboarding
}) {
  if (!isOpen || !isAuthenticated) return null;

  return (
    <div className="account-drawer-backdrop" onClick={() => setShowOnboarding(false)}>
      <aside className="account-drawer" role="dialog" aria-modal="true" aria-label={t('onboardingTitle')} onClick={(e) => e.stopPropagation()}>
        <section className="panel account-panel onboarding-panel">
          <div className="panel-head">
            <h2>{t('onboardingTitle')}</h2>
            <button className="ghost" type="button" onClick={() => setShowOnboarding(false)}>
              {t('close')}
            </button>
          </div>
          <p className="muted">{t('onboardingSub')}</p>
          <p className="api-usage-note onboarding-tip">{t('aiApiDescriptionShort')}</p>
          <label>
            {t('onboardingIntent')}
            <select value={onboardingDraft.intent} onChange={(e) => setOnboardingDraft((prev) => ({ ...prev, intent: e.target.value }))}>
              <option value="deals">{t('onboardingDeals')}</option>
              <option value="family">{t('onboardingFamily')}</option>
              <option value="business">{t('onboardingBusiness')}</option>
              <option value="weekend">{t('onboardingWeekend')}</option>
            </select>
          </label>
          <label>
            {t('onboardingBudget')}
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={onboardingDraft.budget}
              onChange={(e) => setOnboardingDraft((prev) => ({ ...prev, budget: e.target.value }))}
            />
          </label>
          <label>
            {t('onboardingRegion')}
            <select
              value={onboardingDraft.preferredRegion}
              onChange={(e) => setOnboardingDraft((prev) => ({ ...prev, preferredRegion: e.target.value }))}
            >
              {config.regions.map((r) => (
                <option key={r} value={r}>
                  {regionLabel(r)}
                </option>
              ))}
            </select>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={onboardingDraft.directOnly}
              onChange={(e) => setOnboardingDraft((prev) => ({ ...prev, directOnly: e.target.checked }))}
            />
            {t('onboardingDirect')}
          </label>
          <button type="button" onClick={finishOnboarding} disabled={onboardingSaving}>
            {onboardingSaving ? `${t('finishOnboarding')}...` : t('finishOnboarding')}
          </button>
        </section>
      </aside>
    </div>
  );
}

