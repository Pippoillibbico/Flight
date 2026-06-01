import { z } from 'zod';
import { validateProps } from '../utils/validateProps';

const SectionAccessGatePropsSchema = z
  .object({
    title: z.string(),
    description: z.string(),
    ctaLabel: z.string().default('Create free account'),
    eyebrowLabel: z.string().default('Members-only access'),
    noteLabel: z.string().default('Create a free account to continue. No credit card required for this step.'),
    onCta: z.function()
  })
  .passthrough();

function SectionAccessGate(props) {
  const { title, description, ctaLabel, eyebrowLabel, noteLabel, onCta } = validateProps(
    SectionAccessGatePropsSchema,
    props,
    'SectionAccessGate'
  );

  return (
    <section className="panel opportunity-soft-gate section-access-gate">
      <p className="section-access-gate-eyebrow">{eyebrowLabel}</p>
      <h3>{title}</h3>
      <p className="muted">{description}</p>
      <p className="section-access-gate-note">{noteLabel}</p>
      <div className="item-actions">
        <button type="button" onClick={onCta} data-testid="section-access-gate-cta">
          {ctaLabel}
        </button>
      </div>
    </section>
  );
}

export default SectionAccessGate;
