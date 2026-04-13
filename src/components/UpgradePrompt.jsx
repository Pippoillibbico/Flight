import { z } from 'zod';
import { validateProps } from '../utils/validateProps';

const UpgradePromptPropsSchema = z
  .object({
    title: z.string().default('Want to see all opportunities?'),
    message: z.string().default('Unlock all opportunities with PRO'),
    proSummary: z.string().default('Broader premium access, full radar coverage, and richer value visibility.'),
    eliteSummary: z.string().default('Priority access, premium intelligence layer, and early feature entry.'),
    primaryLabel: z.string().default('Upgrade to PRO'),
    secondaryLabel: z.string().default('Discover ELITE'),
    onUpgradePro: z.function(),
    onUpgradeElite: z.function()
  })
  .passthrough();

const PRO_FEATURES = [
  'Full opportunity feed - no limits',
  'Price radar on all routes',
  'Instant price-drop alerts',
  'Advanced filters & sorting'
];

const ELITE_FEATURES = [
  'Everything in PRO',
  'AI trip planner (JustGo)',
  'Priority intelligence layer',
  'Early access to new features'
];

function CheckIcon() {
  return (
    <svg className="upgrade-check-icon" width="13" height="13" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function UpgradePrompt(props) {
  const { title, message, proSummary, eliteSummary, primaryLabel, secondaryLabel, onUpgradePro, onUpgradeElite } = validateProps(
    UpgradePromptPropsSchema,
    props,
    'UpgradePrompt'
  );

  return (
    <article className="upgrade-prompt" data-testid="upgrade-prompt">
      <div className="upgrade-prompt-header">
        <h4 className="upgrade-prompt-title">{title}</h4>
        <p className="upgrade-prompt-message muted">{message}</p>
      </div>

      <div className="upgrade-prompt-plan-grid">
        <article className="upgrade-prompt-plan upgrade-prompt-plan-pro" data-testid="upgrade-prompt-plan-pro">
          <div className="upgrade-prompt-plan-head">
            <p className="upgrade-prompt-plan-tag">PRO</p>
            <span className="upgrade-prompt-plan-badge">Most popular</span>
          </div>
          <p className="upgrade-prompt-plan-copy">{proSummary}</p>
          <ul className="upgrade-prompt-features" aria-label="PRO plan features">
            {PRO_FEATURES.map((f) => (
              <li key={f} className="upgrade-prompt-feature-item">
                <CheckIcon />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="upgrade-prompt-cta-pro"
            onClick={onUpgradePro}
            data-testid="upgrade-cta-pro"
          >
            {primaryLabel}
          </button>
        </article>

        <article className="upgrade-prompt-plan upgrade-prompt-plan-elite" data-testid="upgrade-prompt-plan-elite">
          <div className="upgrade-prompt-plan-head">
            <p className="upgrade-prompt-plan-tag upgrade-prompt-plan-tag--elite">ELITE</p>
          </div>
          <p className="upgrade-prompt-plan-copy">{eliteSummary}</p>
          <ul className="upgrade-prompt-features" aria-label="ELITE plan features">
            {ELITE_FEATURES.map((f) => (
              <li key={f} className="upgrade-prompt-feature-item upgrade-prompt-feature-item--elite">
                <CheckIcon />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="upgrade-prompt-cta-elite ghost"
            onClick={onUpgradeElite}
            data-testid="upgrade-cta-elite"
          >
            {secondaryLabel}
          </button>
        </article>
      </div>

      <p className="upgrade-prompt-trust">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        No payment charged in this step - cancel anytime.
      </p>
    </article>
  );
}

export default UpgradePrompt;

