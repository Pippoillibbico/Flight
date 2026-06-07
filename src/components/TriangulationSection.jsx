import { useState } from 'react';
import { z } from 'zod';
import { api } from '../api';
import { validateProps } from '../utils/validateProps';
import { resolveAirportCityName } from '../utils/localizePlace';
import UpgradePrompt from './UpgradePrompt';

const TriangulationSectionPropsSchema = z
  .object({
    token: z.string().optional(),
    planType: z.enum(['free', 'pro', 'elite']).optional().default('free'),
    t: z.function().optional().default((key) => key),
    language: z.string().optional().default('it'),
    onUpgradePro: z.function(),
    onUpgradeElite: z.function()
  })
  .passthrough();

function TriangulationSection(props) {
  const { token, planType, t, language, onUpgradePro, onUpgradeElite } = validateProps(TriangulationSectionPropsSchema, props, 'TriangulationSection');
  const label = (key, fallback) => {
    const value = t(key);
    return value && value !== key ? value : fallback;
  };
  const readRiskLabel = (risk) => {
    const normalized = String(risk || 'medium').trim().toLowerCase();
    const riskLabels = {
      low: label('triangulationRiskLow', 'Low'),
      low_medium: label('triangulationRiskLowMedium', 'Low-medium'),
      medium: label('triangulationRiskMedium', 'Medium'),
      high: label('triangulationRiskHigh', 'High')
    };
    return riskLabels[normalized] || riskLabels.medium;
  };
  const readPreviewRouteLabel = (item) => {
    const route = String(item?.route || '').trim();
    const cities = route.split('-').map((code) => resolveAirportCityName(code, language)).filter(Boolean);
    return cities.length >= 2 ? cities.join(' -> ') : String(item?.label || route).trim();
  };

  const [prompt, setPrompt] = useState(() => label('triangulationDefaultPrompt', 'Find a cheap self-transfer route from Rome to Bangkok in June.'));
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState('');
  const isFreePlan = planType === 'free';
  const preview = Array.isArray(payload?.preview) ? payload.preview : [];
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const promptExamples = [
    label('triangulationExampleRomeBangkok', 'Find a cheap self-transfer route from Rome to Bangkok in June.'),
    label('triangulationExampleSoutheastAsia', 'I want to reach Southeast Asia from Rome in the next 3 months, even through bridge cities.'),
    label('triangulationExampleThailandMilan', 'Find the cheapest way to reach Thailand from Milan, even with separate tickets.')
  ];

  async function runTriangulation() {
    setLoading(true);
    setError('');
    setPayload(null);
    try {
      const intake = await api.triangulationIntake(token, {
        prompt,
        aiProvider: 'auto',
        baggage: 'personal_item',
        riskTolerance: 'medium'
      });
      if (intake?.parsed && !intake?.upgradeRequired) {
        const search = await api.triangulationSearch(token, intake.parsed);
        setPayload({ ...search, parsed: intake.parsed });
      } else {
        setPayload(intake);
      }
    } catch {
      setError(label('triangulationUnavailable', 'Triangulation is not available right now.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="ai-travel-input-card triangulation-panel" data-testid="triangulation-panel">
      <div className="ai-travel-header">
        <div className="panel-head">
          <h3>{label('triangulationTitle', 'AI Flight Hacker')}</h3>
          <span className={`triangulation-badge ${isFreePlan ? 'is-preview' : 'is-live'}`}>
            {isFreePlan ? label('triangulationFreePreviewBadge', 'Free preview') : label('triangulationLiveBadge', 'Live Pro')}
          </span>
        </div>
        <p className="muted">
          {label('triangulationSubtitle', 'Find alternative routes and smart self-transfer ideas to reach your destination for less.')}
        </p>
        <p className="muted ai-travel-plan-note">
          {isFreePlan
            ? label('triangulationFreePlanNote', 'Free preview based on frequent routes and price history. Updated checks are available with PRO.')
            : label('triangulationPaidPlanNote', 'Compare smarter routes with updated prices and clearer trade-offs.')}
        </p>
        <div className="triangulation-how-it-works" aria-label={label('triangulationHowItWorksAria', 'How AI Flight Hacker works')}>
          <span>{label('triangulationStepUnderstand', '1. Understands the request')}</span>
          <span>{label('triangulationStepBridge', '2. Generates bridge cities')}</span>
          <span>{label('triangulationStepScore', '3. Scores price, risk, and comfort')}</span>
        </div>
      </div>
      <label>
        {label('triangulationPromptLabel', 'Natural language request')}
        <textarea
          className="ai-intake-box"
          data-testid="triangulation-prompt-input"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={label('triangulationPromptPlaceholder', 'Find the cheapest way to reach Thailand from Rome, even with separate tickets.')}
        />
      </label>
      <div className="triangulation-prompt-examples" aria-label={label('triangulationExamplesAria', 'Quick examples')}>
        {promptExamples.map((example) => (
          <button key={example} type="button" className="ghost" onClick={() => setPrompt(example)}>
            {example}
          </button>
        ))}
      </div>
      <div className="item-actions ai-travel-actions">
        <button type="button" data-testid="triangulation-run" onClick={runTriangulation} disabled={loading || prompt.trim().length < 8}>
          {loading ? label('triangulationLoading', 'Searching routes...') : label('triangulationRunCta', 'Find triangulation')}
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {payload?.upgradeRequired ? (
        <UpgradePrompt
          title={label('triangulationUpgradeTitle', 'Live triangulation is available with Pro')}
          message={label('triangulationUpgradeMessage', 'Upgrade to compare updated prices and unlock smarter route alternatives.')}
          primaryLabel={label('opportunityFeedUpgradePrimaryCta', 'Upgrade to PRO')}
          secondaryLabel={label('opportunityFeedUpgradeSecondaryCta', 'Discover ELITE')}
          t={t}
          onUpgradePro={onUpgradePro}
          onUpgradeElite={onUpgradeElite}
        />
      ) : null}
      {preview.length > 0 ? (
        <div className="list-stack triangulation-result-list" data-testid="triangulation-preview-list">
          {preview.map((item) => (
            <article key={item.route} className="watch-item triangulation-result-card">
              <div>
                <strong>{readPreviewRouteLabel(item)}</strong>
                <p className="muted">{label('triangulationPreviewStaticNote', 'Indicative strategy based on frequent routes and price history. Check the updated fare before booking.')}</p>
              </div>
              <span className="triangulation-pill">{readRiskLabel(item.risk)}</span>
            </article>
          ))}
        </div>
      ) : null}
      {results.length > 0 ? (
        <div className="list-stack triangulation-result-list" data-testid="triangulation-results-list">
          {results.map((item) => (
            <article key={item.id || item.route} className="watch-item triangulation-result-card">
              <div className="triangulation-result-main">
                <div className="ai-travel-candidate-head">
                  <strong>{String(item.route || '').replaceAll('-', ' -> ')}</strong>
                  <span className="ai-travel-candidate-price">{Math.round(Number(item.totalPrice || 0))} EUR</span>
                </div>
                <div className="ai-travel-candidate-meta-row">
                  <p className="ai-travel-candidate-meta">{label('triangulationSavingLabel', 'Saving')} {Math.round(Number(item.savingVsBaseline || 0))} EUR</p>
                  <p className="ai-travel-candidate-meta">{label('triangulationScoreLabel', 'Score')} {Math.round(Number(item.score || 0))}/100</p>
                  <p className="ai-travel-candidate-meta">{label('triangulationRiskLabel', 'Risk')} {readRiskLabel(item.risk)}</p>
                </div>
                {item.aiSummary ? <p className="muted">{item.aiSummary}</p> : null}
                {Array.isArray(item.warnings) && item.warnings.length ? <p className="muted">{item.warnings[0]}</p> : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default TriangulationSection;
