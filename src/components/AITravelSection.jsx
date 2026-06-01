import { z } from 'zod';
import { validateProps } from '../utils/validateProps';
import { localizeCityName } from '../utils/localizePlace';
import UpgradePrompt from './UpgradePrompt';

const AITravelSectionPropsSchema = z
  .object({
    t: z.function().optional(),
    language: z.string().optional().default('it'),
    prompt: z.string(),
    setPrompt: z.function(),
    loading: z.boolean(),
    result: z.any().nullable(),
    error: z.string(),
    onRun: z.function(),
    onView: z.function(),
    planType: z.enum(['free', 'pro', 'elite']).optional().default('free'),
    canUseAiTravel: z.boolean().default(false),
    onUpgradePro: z.function(),
    onUpgradeElite: z.function()
  })
  .passthrough();

function AITravelSection(props) {
  const { t, language, prompt, setPrompt, loading, result, error, onRun, onView, planType, canUseAiTravel, onUpgradePro, onUpgradeElite } = validateProps(
    AITravelSectionPropsSchema,
    props,
    'AITravelSection'
  );
  const tt = (key, fallback) => (typeof t === 'function' ? t(key) : fallback) || fallback;
  const items = Array.isArray(result?.items) ? result.items : [];
  const readId = (item) => String(item?.id || item?.candidateId || '').trim();
  const readOrigin = (item) => String(item?.origin || item?.origin_airport || '').trim().toUpperCase();
  const readDestination = (item) => localizeCityName(String(item?.destination || item?.destination_city || '').trim(), language);
  const readDestinationIata = (item) => String(item?.destinationIata || item?.destination_airport || '').trim().toUpperCase();
  const readPrice = (item) => {
    const value = Number(item?.price);
    return Number.isFinite(value) ? value : 0;
  };
  const readCurrency = (item) => String(item?.currency || 'EUR').trim() || 'EUR';
  const readDateFrom = (item) => String(item?.dateFrom || item?.depart_date || '').trim();
  const readDateTo = (item) => String(item?.dateTo || item?.return_date || '').trim();
  const readStops = (item) => {
    const parsed = Number(item?.stops);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const readStopLabel = (item) => {
    const stops = readStops(item);
    if (stops === null) return '';
    if (stops === 0) return tt('opportunityFeedDirect', 'Direct');
    return `${stops} ${tt(stops === 1 ? 'searchResultStopSingular' : 'searchResultStopPlural', stops === 1 ? 'stop' : 'stops')}`;
  };
  const readRankingScore = (item) => Number(item?.rankingScore);
  const readExplanation = (item) => String(item?.explanation || '').trim();
  const readViewId = (item) => String(item?.viewItineraryId || item?.id || '').trim();
  const truncatedByPlan = Boolean(result?.truncatedByPlan);
  const totalItems = Number(result?.totalItems || items.length);
  const visibleItemsCount = items.length;
  const shouldShowLimitedPrompt = planType === 'free' && truncatedByPlan && totalItems > visibleItemsCount;
  const isFreePlan = planType === 'free';

  return (
    <section className="panel ai-travel-panel" data-testid="ai-travel-panel">
      <div className="ai-travel-header">
        <div className="panel-head">
          <h2>{isFreePlan ? tt('aiTravelFreeTitle', 'Public cached trip ideas') : tt('aiTravelPageTitle', 'Find your next trip with AI')}</h2>
        </div>
        <p className="muted">
          {isFreePlan
            ? tt('aiTravelFreeSubtitle', 'Free uses public cached opportunities, basic route insights, and price trend previews.')
            : tt('aiTravelPageSubtitle', 'Describe what you are looking for and let the system find real opportunities already in the feed.')}
        </p>
      </div>

      <section className="ai-travel-input-card">
        <label>
          {tt('aiTravelPromptLabel', 'Describe your trip')}
          <textarea
            className="ai-intake-box"
            data-testid="ai-travel-prompt-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={tt('aiTravelPromptPlaceholder', 'I want to leave with 400 EUR in November.')}
          />
        </label>
        <p className="muted">
          {isFreePlan
            ? tt('aiTravelFreeNoAiNote', 'No AI runs on Free. Upgrade for live scans, AI tools, and route alerts when delivery is enabled.')
            : tt('aiTravelPageHelper', 'AI interprets your request and filters real opportunities only, without inventing flights or prices.')}
        </p>
        {isFreePlan ? (
          <p className="muted ai-travel-plan-note" data-testid="ai-travel-plan-note">
            {tt('aiTravelFreePlanNote', 'Free shows public cached opportunities. Upgrade for live scans, AI tools, and route alerts when delivery is enabled.')}
          </p>
        ) : null}
        <div className="item-actions ai-travel-actions">
          <button type="button" data-testid="ai-travel-run" onClick={isFreePlan ? onUpgradePro : onRun} disabled={loading || (!canUseAiTravel && !isFreePlan)}>
            {loading ? tt('aiTravelRunLoading', 'Analyzing...') : isFreePlan ? tt('aiTravelFreeUpgradeCta', 'Upgrade for live scans and AI tools') : tt('aiTravelRunCta', 'Ask AI')}
          </button>
        </div>
      </section>

      {!canUseAiTravel && !isFreePlan ? (
        <p className="error">{tt('aiTravelEliteOnly', 'AI Travel is available on Pro and Elite plans.')}</p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      {result?.summary ? (
        <article className="ai-travel-summary-card" data-testid="ai-travel-summary-card">
          <p className="ai-travel-summary-label">{tt('aiTravelSummaryLabel', 'Summary')}</p>
          <p className="ai-travel-summary-copy muted" data-testid="ai-travel-summary">{result.summary}</p>
        </article>
      ) : null}

      <section className="ai-travel-results-section" data-testid="ai-travel-results-section">
        {shouldShowLimitedPrompt ? (
          <UpgradePrompt
            title={tt('aiTravelLimitedTitle', 'See more AI-generated itineraries')}
            message={tt('aiTravelLimitedMessage', 'Showing {visible} of {total} suggestions. Upgrade to unlock full AI generation and priority deal visibility.').replace('{visible}', visibleItemsCount).replace('{total}', totalItems)}
            primaryLabel={tt('opportunityFeedUpgradePrimaryCta', 'Upgrade to PRO')}
            secondaryLabel={tt('opportunityFeedUpgradeSecondaryCta', 'Discover ELITE')}
            t={t}
            onUpgradePro={onUpgradePro}
            onUpgradeElite={onUpgradeElite}
          />
        ) : null}
        {items.length > 0 ? (
          <div className="panel-head">
            <h3>{tt('aiTravelSuggestedItinerariesTitle', 'Suggested itineraries')}</h3>
          </div>
        ) : null}
        <div className="list-stack ai-travel-candidate-list">
          {items.map((item) => (
            <article
              key={readId(item) || readViewId(item)}
              className="watch-item ai-travel-candidate-card"
              data-testid={`generated-candidate-${readId(item) || readViewId(item)}`}
            >
              <div className="ai-travel-candidate-main">
                <div className="ai-travel-candidate-head">
                  <strong className="ai-travel-candidate-route">
                    {readOrigin(item)} {'->'} {readDestination(item)} ({readDestinationIata(item)})
                  </strong>
                  <span className="ai-travel-candidate-price">
                    {Math.round(readPrice(item))} {readCurrency(item)}
                  </span>
                </div>
                <div className="ai-travel-candidate-meta-row">
                  <p className="ai-travel-candidate-meta">
                    {readDateFrom(item)}
                    {readDateTo(item) ? ` - ${readDateTo(item)}` : ''}
                  </p>
                  {readStopLabel(item) ? <p className="ai-travel-candidate-meta">{readStopLabel(item)}</p> : null}
                </div>
                {Number.isFinite(readRankingScore(item)) ? (
                  <p className="ai-travel-candidate-rank" data-testid={`generated-ranking-${readId(item)}`}>
                    {tt('aiTravelRankLabel', 'Rank')} {readRankingScore(item)}
                  </p>
                ) : null}
                {readExplanation(item) ? (
                  <div className="ai-travel-candidate-explanation-box">
                    <p className="ai-travel-candidate-explanation" data-testid={`generated-explanation-${readId(item)}`}>
                      {readExplanation(item)}
                    </p>
                  </div>
                ) : null}
              </div>
              <button type="button" className="ghost ai-travel-candidate-cta" onClick={() => onView(readViewId(item))} disabled={!readViewId(item)}>
                {tt('opportunityFeedViewItineraryCta', 'View itinerary')}
              </button>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

export default AITravelSection;
