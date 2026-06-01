import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { readInitialLanguage } from '../src/features/app-shell/hooks/useAppLocalization.js';
import de from '../src/i18n/lang/de.js';
import en from '../src/i18n/lang/en.js';
import es from '../src/i18n/lang/es.js';
import fr from '../src/i18n/lang/fr.js';
import it from '../src/i18n/lang/it.js';
import pt from '../src/i18n/lang/pt.js';
import { CONSENT_STORAGE_KEY, LANGUAGE_STORAGE_KEY } from '../src/utils/storageKeys.js';

function createStorage(seed = {}) {
  const entries = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return entries.has(String(key)) ? entries.get(String(key)) : null;
    },
    setItem(key, value) {
      entries.set(String(key), String(value));
    },
    removeItem(key) {
      entries.delete(String(key));
    }
  };
}

function withWindowStorage(seed, callback) {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: createStorage(seed) }
  });
  try {
    return callback();
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow
      });
    }
  }
}

const consentGranted = JSON.stringify({
  functional: true,
  analytics: false,
  version: 2,
  ts: 1
});

const languagePacks = { en, it, de, fr, es, pt };

test('initial language honors stored Italian when functional consent is present', () => {
  const language = withWindowStorage(
    {
      [CONSENT_STORAGE_KEY]: consentGranted,
      [LANGUAGE_STORAGE_KEY]: 'it'
    },
    () => readInitialLanguage()
  );

  assert.equal(language, 'it');
});

test('initial language honors stored English when functional consent is present', () => {
  const language = withWindowStorage(
    {
      [CONSENT_STORAGE_KEY]: consentGranted,
      [LANGUAGE_STORAGE_KEY]: 'en'
    },
    () => readInitialLanguage()
  );

  assert.equal(language, 'en');
});

test('initial language falls back to English when functional consent is missing', () => {
  const language = withWindowStorage(
    {
      [LANGUAGE_STORAGE_KEY]: 'it'
    },
    () => readInitialLanguage()
  );

  assert.equal(language, 'en');
});

test('OpportunityFeedSection schema accepts cached dataSource from backend capabilities', async () => {
  const source = await readFile('src/components/OpportunityFeedSection.jsx', 'utf8');

  assert.match(source, /z\.enum\(\['live', 'synthetic', 'internal', 'cached'\]\)/);
  assert.match(source, /dataSource/);
});

test('ExploreDiscoverySection schema accepts cached dataSource from backend capabilities', async () => {
  const source = await readFile('src/components/ExploreDiscoverySection.jsx', 'utf8');
  const exploreMainSource = await readFile('src/features/app-shell/ui/ExploreMainSection.jsx', 'utf8');

  assert.match(source, /z\.enum\(\['live', 'synthetic', 'internal', 'cached'\]\)/);
  assert.match(exploreMainSource, /dataSource=\{systemCapabilities\?\.data_source \|\| 'synthetic'\}/);
});

const GUARDED_COPY_FILES = [
  'src/App.jsx',
  'src/components/OpportunityFeedSection.jsx',
  'src/components/ExploreDiscoverySection.jsx',
  'src/features/app-shell/hooks/operations/ai-travel-operations.js',
  'src/features/app-shell/hooks/useUpgradeFlowController.js',
  'src/features/monetization/domain/get-upgrade-trigger-content.ts',
  'src/i18n/lang/en.js',
  'src/i18n/lang/it.js'
];

test('Blocco 2 guard files do not contain mojibake markers', async () => {
  const mojibakePatterns = [/�/, /ï¿½/, /Ã./, /Â./, /â€/, /â€™/];

  for (const file of GUARDED_COPY_FILES) {
    const source = await readFile(file, 'utf8');
    for (const pattern of mojibakePatterns) {
      assert.equal(pattern.test(source), false, `${file} contains mojibake marker ${pattern}`);
    }
  }
});

test('AI Travel free-plan operation does not reintroduce direct user-facing fallback copy', async () => {
  const source = await readFile('src/features/app-shell/hooks/operations/ai-travel-operations.js', 'utf8');
  assert.equal(
    /Free includes public cached deals and basic route insights/i.test(source),
    false,
    'Free AI Travel message must come from i18n, not from a hardcoded fallback.'
  );
  assert.match(source, /t\('aiTravelFreeNoAiNote'\)/);
});

test('upgrade checkout errors are localized instead of hardcoded in the controller path', async () => {
  const source = await readFile('src/features/app-shell/hooks/useUpgradeFlowController.js', 'utf8');

  assert.match(source, /t\('upgradeFlowCheckoutUnavailable'\)/);
  assert.match(source, /t\('upgradeFlowCheckoutStartFailed'\)/);
});

test('upgrade modal value note is localized in every language pack', async () => {
  const source = await readFile('src/features/app-shell/ui/AccountAndUpgradeOverlays.jsx', 'utf8');

  assert.match(source, /t\('upgradeFlowValueNote'\)/);
  for (const [language, pack] of Object.entries(languagePacks)) {
    assert.equal(
      typeof pack.messages?.upgradeFlowValueNote,
      'string',
      `${language} is missing upgradeFlowValueNote`
    );
  }
});

test('shared upgrade prompt copy is localized and receives translator at every call site', async () => {
  const requiredKeys = [
    'upgradePromptMostPopular',
    'upgradePromptProSummary',
    'upgradePromptEliteSummary',
    'upgradePromptProFeaturesAria',
    'upgradePromptEliteFeaturesAria',
    'upgradePromptProFeature1',
    'upgradePromptProFeature2',
    'upgradePromptProFeature3',
    'upgradePromptProFeature4',
    'upgradePromptEliteFeature1',
    'upgradePromptEliteFeature2',
    'upgradePromptEliteFeature3',
    'upgradePromptEliteFeature4',
    'upgradePromptTrustLine'
  ];
  const callSites = [
    'src/components/OpportunityFeedSection.jsx',
    'src/components/OpportunityDetailSection.jsx',
    'src/components/RadarSection.jsx',
    'src/components/AITravelSection.jsx',
    'src/components/TriangulationSection.jsx'
  ];

  for (const [language, pack] of Object.entries(languagePacks)) {
    for (const key of requiredKeys) {
      assert.equal(typeof pack.messages?.[key], 'string', `${language} is missing ${key}`);
    }
  }

  for (const file of callSites) {
    const source = await readFile(file, 'utf8');
    assert.match(source, /<UpgradePrompt[\s\S]*?\bt=\{t\}/, `${file} must pass t to UpgradePrompt`);
  }
});

test('secondary language hero and triangulation labels do not fall back to English', () => {
  const secondaryLanguagePacks = { de, fr, es, pt };
  const englishMessages = en.messages || {};
  const keys = [
    'appHeroSubLive',
    'appDataSourceLiveNote',
    'triangulationFreePreviewBadge',
    'upgradePromptProSummary',
    'upgradePromptEliteSummary'
  ];

  for (const [language, pack] of Object.entries(secondaryLanguagePacks)) {
    for (const key of keys) {
      assert.equal(typeof pack.messages?.[key], 'string', `${language} is missing ${key}`);
      assert.notEqual(pack.messages[key], englishMessages[key], `${language} reuses English ${key}`);
    }
    assert.equal(
      pack.messages?.landingAiProofCurrencyValue?.includes('?'),
      false,
      `${language} currency proof contains a broken separator`
    );
  }
});

test('triangulation Free preview copy is localized in every language pack', () => {
  const requiredKeys = [
    'triangulationRiskLow',
    'triangulationRiskLowMedium',
    'triangulationRiskMedium',
    'triangulationRiskHigh',
    'triangulationPreviewStaticNote'
  ];

  for (const [language, pack] of Object.entries(languagePacks)) {
    for (const key of requiredKeys) {
      assert.equal(typeof pack.messages?.[key], 'string', `${language} is missing ${key}`);
    }
  }
});

test('monetization fallback copy stays single-language and uncorrupted', async () => {
  const source = await readFile('src/features/monetization/domain/get-upgrade-trigger-content.ts', 'utf8');
  const forbiddenItalianFragments = [
    /Stai vedendo/i,
    /Questo prezzo/i,
    /Verifica disponibil/i
  ];

  for (const pattern of forbiddenItalianFragments) {
    assert.equal(pattern.test(source), false, `monetization fallback contains mixed-language fragment ${pattern}`);
  }
});

test('visible app-shell fallback keys exist in every language pack', async () => {
  const sourceFiles = [
    'src/components/AITravelSection.jsx',
    'src/components/TriangulationSection.jsx',
    'src/components/OpportunityFeedSection.jsx',
    'src/components/OpportunityDetailSection.jsx',
    'src/components/ExploreDiscoverySection.jsx',
    'src/components/RadarSection.jsx',
    'src/components/PremiumPanelSection.jsx',
    'src/features/app-shell/domain/premium-packages.js',
    'src/App.jsx'
  ];
  const keyPattern = /(?:tt|label|translate)\(\s*['"]([^'"]+)['"]/g;
  const keys = new Set();

  for (const file of sourceFiles) {
    const source = await readFile(file, 'utf8');
    let match;
    while ((match = keyPattern.exec(source)) !== null) {
      keys.add(match[1]);
    }
  }

  for (const [language, pack] of Object.entries(languagePacks)) {
    const missing = Array.from(keys).filter(
      (key) => !(key in (pack.messages || {})) && !(key in (pack.extra || {})) && !(key in (pack.tooltips || {}))
    );
    assert.deepEqual(missing, [], `${language} is missing visible i18n keys: ${missing.join(', ')}`);
  }
});

test('Opportunity feed hot-state copy is localized, not hardcoded in JSX', async () => {
  const source = await readFile('src/components/OpportunityFeedSection.jsx', 'utf8');

  assert.match(source, /opportunityFeedHotStateLive/);
  assert.match(source, /opportunityFeedHotStateSynthetic/);
  assert.equal(source.includes("{isLiveData ? 'Live opportunities detected' : 'High-signal opportunities detected'}"), false);
});
