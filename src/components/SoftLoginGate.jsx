import { z } from 'zod';
import { validateProps } from '../utils/validateProps';

const SoftLoginGatePropsSchema = z
  .object({
    title: z.string().default('Vuoi vedere tutte le opportunita?'),
    description: z
      .string()
      .default('Crea un account gratuito per sbloccare il feed completo e attivare il tuo radar.'),
    ctaLabel: z.string().default('Crea account gratis'),
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
