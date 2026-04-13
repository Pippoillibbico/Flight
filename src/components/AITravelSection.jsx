import { z } from 'zod';
import { validateProps } from '../utils/validateProps';
import UpgradePrompt from './UpgradePrompt';

const AITravelSectionPropsSchema = z
  .object({
    prompt: z.string(),
    setPrompt: z.function(),
    loading: z.boolean(),
    result: z.any().nullable(),
    error: z.string(),
    onRun: z.function(),
    onView: z.function(),
    canUseAiTravel: z.boolean().default(false),
    onUpgradePro: z.function(),
    onUpgradeElite: z.function()
  })
  .passthrough();

function AITravelSection(props) {
  const { prompt, setPrompt, loading, result, error, onRun, onView, canUseAiTravel, onUpgradePro, onUpgradeElite } = validateProps(
    AITravelSectionPropsSchema,
    props,
    'AITravelSection'
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Trova il prossimo viaggio con l'AI</h2>
      </div>
      <p className="muted">Descrivi cosa cerchi e lascia che il sistema trovi opportunita reali gia presenti nel feed.</p>
      <label>
        Descrivi il viaggio
        <textarea
          className="ai-intake-box"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Voglio partire con 400\u20AC a novembre."
        />
      </label>
      <p className="muted">L'AI interpreta la richiesta e filtra opportunita reali, senza inventare voli o prezzi.</p>
      <div className="item-actions">
        <button type="button" onClick={onRun} disabled={loading || !canUseAiTravel}>
          {loading ? 'Analisi in corso...' : "Chiedi all'AI"}
        </button>
      </div>
      {!canUseAiTravel ? (
        <UpgradePrompt
          title="AI Travel disponibile su ELITE"
          message="Passa a ELITE per usare il travel planner AI e alert immediati."
          onUpgradePro={onUpgradePro}
          onUpgradeElite={onUpgradeElite}
        />
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      {result?.summary ? <p className="muted">{result.summary}</p> : null}
      <div className="list-stack">
        {Array.isArray(result?.items) &&
          result.items.map((item) => (
            <article key={item.id} className="watch-item">
              <div>
                <strong>
                  {item.origin_airport} {'->'} {item.destination_city} ({item.destination_airport})
                </strong>
                <p>
                  {Math.round(item.price)} {item.currency} | {item.depart_date}
                </p>
              </div>
              <button type="button" className="ghost" onClick={() => onView(item.id)}>
                Vedi itinerario
              </button>
            </article>
          ))}
      </div>
    </section>
  );
}

export default AITravelSection;
