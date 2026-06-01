import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import de from '../src/i18n/lang/de.js';
import en from '../src/i18n/lang/en.js';
import es from '../src/i18n/lang/es.js';
import fr from '../src/i18n/lang/fr.js';
import it from '../src/i18n/lang/it.js';
import pt from '../src/i18n/lang/pt.js';

const REQUIRED_LANDING_KEYS = [
  'landingTrustFree',
  'landingTrustNoCard',
  'landingTrustCancel',
  'landingFeatureAiTitle',
  'landingFeatureAiDesc',
  'landingAiHackerTitle',
  'landingAiHackerSubtitle',
  'landingAiHackerPrimaryCta',
  'landingAiHackerSecondaryCta',
  'landingAiHackerBullet1',
  'landingAiHackerBullet2',
  'landingAiHackerBullet3',
  'landingAiHackerExamplePrompt',
  'landingAiProofPromptLabel',
  'landingAiProofPromptValue',
  'landingAiProofCurrencyLabel',
  'landingAiProofCurrencyValue',
  'landingAiProofDecisionLabel',
  'landingAiProofDecisionValue',
  'landingAiRouteLabLabel',
  'landingAiRouteOriginCity',
  'landingAiRouteSavingsLabel',
  'landingAiRouteRiskLabel',
  'landingAiRouteRiskValue',
  'landingAiRouteWarning'
];

const PACKS = { de, en, es, fr, it, pt };

test('landing i18n packs define every visible AI/home key', () => {
  for (const [lang, pack] of Object.entries(PACKS)) {
    for (const key of REQUIRED_LANDING_KEYS) {
      assert.equal(typeof pack.messages[key], 'string', `${lang}.${key} must be translated`);
      assert.notEqual(pack.messages[key].trim(), '', `${lang}.${key} must not be empty`);
    }
  }
});

test('English landing copy does not contain Italian prompt/copy fragments', () => {
  const englishLanding = Object.entries(en.messages)
    .filter(([key]) => key.startsWith('landing'))
    .map(([, value]) => String(value))
    .join('\n');

  const forbiddenItalian = [
    /\bTrovami\b/i,
    /\bRoma -> Thailandia\b/i,
    /\btriangolazione\b/i,
    /\bRisparmio\b/i,
    /\bRischio\b/i,
    /\bMedio\b/i,
    /\bBiglietti separati\b/i,
    /\bConfronta i piani\b/i,
    /\bProva AI Flight Hacker\b/i
  ];

  for (const pattern of forbiddenItalian) {
    assert.equal(pattern.test(englishLanding), false, `English landing copy contains ${pattern}`);
  }
});

test('LandingSection does not hardcode localized landing copy', async () => {
  const source = await readFile('src/components/LandingSection.jsx', 'utf8');
  const forbidden = [
    /Trovami una triangolazione/i,
    /Scrivi cosa vuoi fare/i,
    /Prova AI Flight Hacker/i,
    /Confronta i piani/i,
    /Laboratorio rotte/i,
    /Biglietti separati/i,
    /Free to start/i,
    /No credit card required/i,
    /Cancel anytime/i
  ];

  for (const pattern of forbidden) {
    assert.equal(pattern.test(source), false, `LandingSection contains hardcoded localized copy ${pattern}`);
  }
});
