import { z } from 'zod';
import { validateProps } from '../utils/validateProps';

const SoftLoginGatePropsSchema = z
  .object({
    title: z.string().default('Want to see all opportunities?'),
    description: z
      .string()
      .default('Create a free account to unlock the full feed and activate your radar.'),
    ctaLabel: z.string().default('Create free account'),
    onCreateAccount: z.function()
  })
  .passthrough();

function SoftLoginGate(props) {
  const { title, description, ctaLabel, onCreateAccount } = validateProps(
    SoftLoginGatePropsSchema,
    props,
    'SoftLoginGate'
  );

  return (
    <article className="opportunity-soft-gate soft-login-gate">
      <p className="section-access-gate-eyebrow">Unlock full feed</p>
      <h4>{title}</h4>
      <p className="muted">{description}</p>
      <p className="section-access-gate-note">Fast signup, no payment required for free plan.</p>
      <div className="item-actions">
        <button type="button" onClick={onCreateAccount} data-testid="soft-login-gate-cta">
          {ctaLabel}
        </button>
      </div>
    </article>
  );
}

export default SoftLoginGate;
