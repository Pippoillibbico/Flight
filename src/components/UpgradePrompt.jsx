import { z } from 'zod';
import { validateProps } from '../utils/validateProps';

const UpgradePromptPropsSchema = z
  .object({
    title: z.string().default('Vuoi vedere tutte le opportunita?'),
    message: z.string().default('Sblocca tutte le opportunita con PRO'),
    primaryLabel: z.string().default('Upgrade a PRO'),
    secondaryLabel: z.string().default('Scopri ELITE'),
    onUpgradePro: z.function(),
    onUpgradeElite: z.function()
  })
  .passthrough();

function UpgradePrompt(props) {
  const { title, message, primaryLabel, secondaryLabel, onUpgradePro, onUpgradeElite } = validateProps(
    UpgradePromptPropsSchema,
    props,
    'UpgradePrompt'
  );

  return (
    <article className="upgrade-prompt">
      <h4>{title}</h4>
      <p className="muted">{message}</p>
      <div className="item-actions">
        <button type="button" onClick={onUpgradePro}>
          {primaryLabel}
        </button>
        <button type="button" className="ghost" onClick={onUpgradeElite}>
          {secondaryLabel}
        </button>
      </div>
    </article>
  );
}

export default UpgradePrompt;

