import en from './lang/en.js';

export const LANGUAGE_OPTIONS = [
  {
    "value": "en",
    "label": "English"
  },
  {
    "value": "it",
    "label": "Italiano"
  },
  {
    "value": "de",
    "label": "Deutsch"
  },
  {
    "value": "fr",
    "label": "Français"
  },
  {
    "value": "es",
    "label": "Español"
  },
  {
    "value": "pt",
    "label": "Português"
  }
];
export const LANGS = LANGUAGE_OPTIONS.map((item) => item.value);
export const DEFAULT_LANGUAGE = 'en';
export const DEFAULT_LANGUAGE_PACK = en;

const loaders = {
  en: async () => en,
  it: () => import('./lang/it.js').then((m) => m.default),
  de: () => import('./lang/de.js').then((m) => m.default),
  fr: () => import('./lang/fr.js').then((m) => m.default),
  es: () => import('./lang/es.js').then((m) => m.default),
  pt: () => import('./lang/pt.js').then((m) => m.default)
};

const cache = new Map([['en', en]]);

export async function loadLanguagePack(language) {
  const normalized = LANGS.includes(language) ? language : DEFAULT_LANGUAGE;
  if (cache.has(normalized)) return cache.get(normalized);
  const loader = loaders[normalized] || loaders.en;
  const pack = await loader();
  cache.set(normalized, pack || en);
  return pack || en;
}
