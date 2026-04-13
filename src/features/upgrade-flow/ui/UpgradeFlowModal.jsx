import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { validateProps } from '../../../utils/validateProps';

const UpgradePlanContentSchema = z.object({
  planType: z.enum(['pro', 'elite']),
  badgeLabel: z.string(),
  title: z.string(),
  description: z.string(),
  benefits: z.array(z.string()),
  primaryCtaLabel: z.string(),
  submittedTitle: z.string(),
  submittedMessage: z.string()
});

const UpgradeFlowModalPropsSchema = z
  .object({
    isOpen: z.boolean(),
    step: z.enum(['details', 'submitted']),
    content: UpgradePlanContentSchema.nullable(),
    currentPlanType: z.enum(['free', 'pro', 'elite']).optional().default('free'),
    comparisonRows: z
      .array(
        z.object({
          feature: z.string(),
          free: z.string(),
          pro: z.string(),
          elite: z.string()
        })
      )
      .optional()
      .default([]),
    closeLabel: z.string().default('Close'),
    comparePlansLabel: z.string().default('Compare Plans'),
    goToPremiumLabel: z.string().default('Go To Premium Plans'),
    valueNoteLabel: z.string().default('Unlock radar alerts, priority deals, and advanced filters'),
    trustLineLabel: z.string().default('No payment is processed here. Billing configuration is required to activate server-side quota upgrades.'),
    onClose: z.function(),
    onPrimaryAction: z.function(),
    onOpenPremiumSection: z.function()
  })
  .passthrough();

function UpgradeFlowModal(props) {
  const { isOpen, step, content, currentPlanType, comparisonRows, closeLabel, comparePlansLabel, goToPremiumLabel, valueNoteLabel, trustLineLabel, onClose, onPrimaryAction, onOpenPremiumSection } = validateProps(
    UpgradeFlowModalPropsSchema,
    props,
    'UpgradeFlowModal'
  );
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement;
    const focusable = dialogRef.current?.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable && focusable.length > 0) focusable[0].focus();
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const all = Array.from(dialogRef.current.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
      if (all.length === 0) return;
      const first = all[0];
      const last = all[all.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen || !content) return null;

  return (
    <div className="account-drawer-backdrop" onClick={onClose}>
      <aside
        ref={dialogRef}
        className="account-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={content.title}
        data-testid={`upgrade-flow-modal-${content.planType}`}
        onClick={(event) => event.stopPropagation()}
      >
        <section className="panel account-panel onboarding-panel upgrade-flow-panel" data-testid="upgrade-flow-modal">
          <div className="panel-head">
            <div>
              <p className="upgrade-flow-eyebrow">Plan spotlight</p>
              <p className="premium-plan-tag" data-testid="upgrade-flow-plan-tag">{content.badgeLabel}</p>
              <h2 data-testid="upgrade-flow-title">{content.title}</h2>
            </div>
            <button className="ghost" type="button" onClick={onClose} data-testid="upgrade-flow-close">
              {closeLabel}
            </button>
          </div>

          {step === 'details' ? (
            <>
              <p className="muted" data-testid="upgrade-flow-description">{content.description}</p>
              <p className="upgrade-flow-value-note" data-testid="upgrade-flow-value-note">
                {valueNoteLabel}
              </p>
              <ul className="premium-feature-list upgrade-flow-benefits">
                {content.benefits.map((benefit, index) => (
                  <li key={`${content.planType}-benefit-${index}`} data-testid={`upgrade-flow-benefit-${index}`}>
                    {benefit}
                  </li>
                ))}
              </ul>
              {comparisonRows.length > 0 ? (
                <section className="upgrade-flow-plan-compare" data-testid="upgrade-flow-plan-compare">
                  <p className="upgrade-flow-compare-title">FREE vs PRO vs ELITE</p>
                  <div className="upgrade-flow-compare-grid" role="table" aria-label="Plan comparison">
                    <div className="upgrade-flow-compare-head" role="row">
                      <span role="columnheader">Feature</span>
                      <span role="columnheader">FREE</span>
                      <span role="columnheader">PRO</span>
                      <span role="columnheader">ELITE</span>
                    </div>
                    {comparisonRows.map((row) => (
                      <div key={row.feature} className="upgrade-flow-compare-row" role="row">
                        <span role="cell">{row.feature}</span>
                        <span role="cell">{row.free}</span>
                        <span role="cell">{row.pro}</span>
                        <span role="cell">{row.elite}</span>
                      </div>
                    ))}
                  </div>
                  <p className="upgrade-flow-current-plan" data-testid="upgrade-flow-current-plan">
                    Current plan: {String(currentPlanType || 'free').toUpperCase()}
                  </p>
                </section>
              ) : null}
              <p className="upgrade-flow-trust-line">{trustLineLabel}</p>
              <div className="item-actions">
                <button type="button" onClick={onPrimaryAction} data-testid="upgrade-flow-primary">
                  {content.primaryCtaLabel}
                </button>
                <button className="ghost" type="button" onClick={onOpenPremiumSection} data-testid="upgrade-flow-secondary">
                  {comparePlansLabel}
                </button>
              </div>
            </>
          ) : (
            <>
              <h3 data-testid="upgrade-flow-success-title">{content.submittedTitle}</h3>
              <p className="muted" data-testid="upgrade-flow-success-message">{content.submittedMessage}</p>
              <div className="item-actions" data-testid="upgrade-flow-success">
                <button type="button" onClick={onOpenPremiumSection} data-testid="upgrade-flow-success-primary">
                  {goToPremiumLabel}
                </button>
                <button className="ghost" type="button" onClick={onClose} data-testid="upgrade-flow-success-close">
                  {closeLabel}
                </button>
              </div>
            </>
          )}
        </section>
      </aside>
    </div>
  );
}

export default UpgradeFlowModal;
