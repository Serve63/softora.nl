const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const REPO_ROOT = path.resolve(__dirname, '../..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('SEO machine policy requires one automation with a daily public growth output', () => {
  const policy = readRepoFile('docs/growth/seo-machine-policy.md');
  const qualityGates = readRepoFile('docs/seo-machine-quality-gates.md');
  const packageJson = JSON.parse(readRepoFile('package.json'));

  assert.match(policy, /ene bestaande `softora-seo-actiemachine`/i);
  assert.match(policy, /per succesvolle run precies een publieke SEO-groeiverbetering/i);
  assert.match(policy, /Onderhoud aan een oude PR[\s\S]*tellen niet als publieke groeilevering/i);
  assert.match(policy, /cooldown geldt alleen voor dezelfde URL/i);
  assert.match(policy, /5 tot 7 sterke publieke contentleveringen per week/i);
  assert.match(policy, /minimaal 15 unieke, gescoorde en publicatieklare kandidaatbriefs/i);
  assert.match(policy, /Dagelijkse fallback-ladder/i);
  assert.match(policy, /bronvaste nieuws- of marktupdate/i);
  assert.match(policy, /100\.000 organische klikken per 28 dagen uiterlijk 31 december 2026/i);
  assert.match(policy, /Backlinks en off-site linkbuilding vallen volledig buiten deze automation/i);
  assert.match(policy, /docs\/growth\/seo-machine-backlog\.json/i);
  assert.match(policy, /Exitcode `2` is `CONTENT_REQUIRED`/i);
  assert.match(qualityGates, /publieke SEO-groeiverbetering per succesvolle dagelijkse run/i);
  assert.equal(packageJson.scripts['seo:backlog:check'], 'node scripts/check-seo-machine-backlog.js');
  assert.equal(packageJson.scripts['seo:publications:report'], 'node scripts/seo-machine-publication-report.js');
  assert.equal(packageJson.scripts['seo:cadence:check'], 'node scripts/check-seo-machine-cadence.js');
});

test('SEO machine quality gates keep daily publishing claim-safe and visual-complete', () => {
  const policy = readRepoFile('docs/growth/seo-machine-policy.md');
  const qualityGates = readRepoFile('docs/seo-machine-quality-gates.md');

  assert.match(policy, /operationele P0[\s\S]*claim- of expertiseprobleem[\s\S]*cannibalisatie/i);
  assert.match(policy, /Publiceer geen synoniempagina, dunne city-swap/i);
  assert.match(qualityGates, /exact twee eigen, nuttige Softora-visuals/i);
  assert.match(qualityGates, /Geen stockfoto's/i);
  assert.match(qualityGates, /Doe geen backlink-outreach/i);
});
