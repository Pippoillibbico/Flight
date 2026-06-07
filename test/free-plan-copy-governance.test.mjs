import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FREE_COPY_FILES = [
  'src/features/app-shell/domain/premium-packages.js',
  'src/features/app-shell/domain/landing-content.js',
  'src/features/upgrade-flow/domain/get-upgrade-plan-content.ts',
  'src/components/TriangulationSection.jsx',
  'src/components/LandingSection.jsx',
  'src/i18n/lang/en.js',
  'src/i18n/lang/it.js'
];

test('Free plan pricing copy does not promise paid live capabilities', async () => {
  const forbidden = [
    /AI inclusa nel Free/i,
    /ricerca voli live gratuita/i,
    /triangolazioni illimitate/i,
    /prezzi aggiornati in tempo reale[^.]*Free/i,
    /alert live inclusi/i,
    /monitoraggio continuo gratuito/i,
    /Free[^.\n]*(live AI|AI live|live provider|provider live|live triangulation|triangolazione live|live monitoring|monitoraggio live)[^.:\n]*(included|inclusa|incluso|gratuit)/i
  ];

  for (const file of FREE_COPY_FILES) {
    const source = await readFile(file, 'utf8');
    for (const pattern of forbidden) {
      assert.equal(pattern.test(source), false, `${file} matches forbidden Free copy pattern ${pattern}`);
    }
  }
});

test('Free plan copy clearly positions paid live capabilities as a Premium upgrade', async () => {
  const landing = await readFile('src/features/app-shell/domain/landing-content.js', 'utf8');
  assert.match(landing, /Travel ideas and opportunities worth exploring/);
  assert.match(landing, /Route and destination previews/);
  assert.match(landing, /AI and live fare checks available with Premium/);
});
