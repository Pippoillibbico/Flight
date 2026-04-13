import { z } from 'zod';
import { validateProps } from '../utils/validateProps';

const SectionAccessGatePropsSchema = z
  .object({
    title: z.string(),
    description: z.string(),
    ctaLabel: z.string().default('Crea account gratis'),
    onCta: z.function()
  })
  .passthrough();

function SectionAccessGate(props) {
  const { title, description, ctaLabel, onCta } = validateProps(
    SectionAccessGatePropsSchema,
    props,
    'SectionAccessGate'
  );

  return (
    <section className="panel opportunity-soft-gate">
      <h3>{title}</h3>
      <p className="muted">{description}</p>
      <div className="item-actions">
        <button type="button" onClick={onCta}>
          {ctaLabel}
        </button>
      </div>
    </section>
  );
}

export default SectionAccessGate;
