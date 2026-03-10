import { z } from 'zod';
import { validateProps } from '../utils/validateProps';
import UpgradePrompt from './UpgradePrompt';

const AITravelSectionPropsSchema = z
  .object({
    t: z.function().optional(),
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
  const { t, prompt, setPrompt, loading, result, error, onRun, onView, canUseAiTravel, onUpgradePro, onUpgradeElite } = validateProps(
    AITravelSectionPropsSchema,
    props,
    'AITravelSection'
  );
  const tt = (key, fallback) => (typeof t === 'function' ? t(key) : fallback) || fallback;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{tt('aiTravelPageTitle', "Find your next trip with AI")}</h2>
      </div>
      <p className="muted">{tt('aiTravelPageSubtitle', 'Describe what you are looking for and let the system find real opportunities already in the feed.')}</p>
      <label>
        {tt('aiTravelPromptLabel', 'Describe your trip')}
        <textarea
          className="ai-intake-box"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={tt('aiTravelPromptPlaceholder', 'I want to leave with 400 EUR in November.')}
        />
      </label>
      <p className="muted">{tt('aiTravelPageHelper', 'AI interprets your request and filters real opportunities only, without inventing flights or prices.')}</p>
      <div className="item-actions">
        <button type="button" onClick={onRun} disabled={loading || !canUseAiTravel}>
          {loading ? tt('aiTravelRunLoading', 'Analyzing...') : tt('aiTravelRunCta', 'Ask AI')}
        </button>
      </div>
      {!canUseAiTravel ? (
        <UpgradePrompt
          title={tt('aiTravelUpgradeTitle', 'AI Travel available on ELITE')}
          message={tt('aiTravelUpgradeMessage', 'Upgrade to ELITE to use AI travel planner and instant alerts.')}
          primaryLabel={tt('opportunityFeedUpgradePrimaryCta', 'Upgrade to PRO')}
          secondaryLabel={tt('opportunityFeedUpgradeSecondaryCta', 'Discover ELITE')}
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
                {tt('opportunityFeedViewItineraryCta', 'View itinerary')}
              </button>
            </article>
          ))}
      </div>
    </section>
  );
}

export default AITravelSection;
