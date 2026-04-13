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
    <article className="opportunity-soft-gate">
      <h4>{title}</h4>
      <p className="muted">{description}</p>
      <div className="item-actions">
        <button type="button" onClick={onCreateAccount}>
          {ctaLabel}
        </button>
      </div>
    </article>
  );
}

export default SoftLoginGate;
