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
  assert.match(policy, /nieuwe URL's en refreshes apart/i);
  assert.match(policy, /minimaal 1 nieuwe URL in `data_degraded`[\s\S]*`indexation_recovery`[\s\S]*`quality_recovery`[\s\S]*`performance_recovery`[\s\S]*3 in `growth`[\s\S]*5 in `scale`/i);
  assert.match(policy, /`newUrls`[\s\S]*`substantialRefreshes`[\s\S]*`otherGrowthActions`/i);
  assert.match(policy, /Alleen `newUrls` verlaagt de nieuwe-URL-achterstand/i);
  assert.match(policy, /`indexation_recovery`/i);
  assert.match(policy, /`quality_recovery`/i);
  assert.match(policy, /`performance_recovery`/i);
  assert.match(policy, /minimaal 15 unieke, gescoorde en publicatieklare kandidaatbriefs/i);
  assert.match(policy, /Dagelijkse fallback-ladder/i);
  assert.match(policy, /bronvaste nieuws- of marktupdate/i);
  assert.match(policy, /100\.000 organische klikken per 28 dagen uiterlijk 31 december 2026/i);
  assert.match(policy, /blijft na het halen of verstrijken van die datum actief totdat Servé haar expliciet pauzeert/i);
  assert.match(policy, /70% verdedigen\/uitbouwen van bewezen clusters[\s\S]*20% aangrenzende commerciële experimenten[\s\S]*10% technische/i);
  assert.match(policy, /`npm run seo:automation-state -- audit` bewijst dat exact één canonieke ACTIVE heartbeat bestaat/i);
  assert.match(policy, /`SEO_MACHINE_PROMPT_VERSION=5`/i);
  assert.match(qualityGates, /deadlinebestendige `growthHorizon`/i);
  assert.ok(
    qualityGates.indexOf('`performance_recovery`, `quality_recovery`') >= 0,
    'meetbare performance recovery hoort voor generieke quality recovery te staan'
  );
  assert.match(policy, /Backlinks en off-site linkbuilding vallen volledig buiten deze automation/i);
  assert.match(policy, /docs\/growth\/seo-machine-backlog\.json/i);
  assert.match(policy, /Exitcode `2` is `GROWTH_ACTION_REQUIRED`/i);
  assert.match(qualityGates, /Iedere succesvolle run levert een publieke verbetering/i);
  assert.equal(packageJson.scripts['seo:backlog:check'], 'node scripts/check-seo-machine-backlog.js');
  assert.equal(packageJson.scripts['seo:publications:report'], 'node scripts/seo-machine-publication-report.js');
  assert.equal(packageJson.scripts['seo:indexation:report'], 'node scripts/seo-machine-indexation-report.js');
  assert.equal(packageJson.scripts['seo:visuals:check'], 'node scripts/check-seo-machine-visuals.js');
  assert.equal(packageJson.scripts['seo:keywords:check'], 'node scripts/check-seo-machine-keywords.js');
  assert.equal(packageJson.scripts['seo:selection:check'], 'node scripts/check-seo-machine-selection.js');
  assert.equal(packageJson.scripts['seo:live-route:check'], 'node scripts/check-seo-machine-live-route.js');
  assert.equal(packageJson.scripts['seo:automation-state'], 'node scripts/seo-machine-automation-state.js');
  assert.equal(packageJson.scripts['seo:cadence:check'], 'node scripts/check-seo-machine-cadence.js');
});

test('SEO machine quality gates keep daily publishing claim-safe and visual-complete', () => {
  const policy = readRepoFile('docs/growth/seo-machine-policy.md');
  const qualityGates = readRepoFile('docs/seo-machine-quality-gates.md');

  assert.match(policy, /operationele P0[\s\S]*claim- of expertiseprobleem[\s\S]*cannibalisatie/i);
  assert.match(policy, /Publiceer geen synoniempagina, dunne city-swap/i);
  assert.match(qualityGates, /exact twee nuttige eigen Softora-visuals/i);
  assert.match(qualityGates, /Geen stockfoto's/i);
  assert.match(qualityGates, /zes recentste blogs/i);
  assert.match(qualityGates, /overeenkomst van `0\.85` of hoger blokkeert/i);
  assert.match(qualityGates, /16:9/i);
  assert.match(qualityGates, /geen Google-rankingfactor/i);
  assert.match(qualityGates, /Doe geen backlink-outreach/i);
});

test('SEO machine keeps Ubersuggest advisory and requires natural keyword evidence', () => {
  const policy = readRepoFile('docs/growth/seo-machine-policy.md');
  const qualityGates = readRepoFile('docs/seo-machine-quality-gates.md');

  assert.match(policy, /Iedere nieuwe URL en iedere substantiële contentrefresh[\s\S]*`keywordEvidence`-brief/i);
  assert.match(policy, /Ubersuggest is uitsluitend een read-only hulpmiddel[\s\S]*nooit een publicatie-, afwijzings-, score-, URL-, titel- of tekstbesluit/i);
  assert.match(policy, /`locId: 2528`[\s\S]*`language: Dutch`/i);
  assert.match(policy, /`0` zoekvolume[\s\S]*mag een kandidaat nooit zelfstandig blokkeren/i);
  assert.match(policy, /geen keyworddichtheid, verplichte exact-matchtelling/i);
  assert.match(qualityGates, /`0` geschat volume is `no_measurable_provider_volume`, niet `no_demand`/i);
  assert.match(qualityGates, /`used`, `covered_semantically` of `rejected`/i);
  assert.match(qualityGates, /`keyword_metrics`, `generate_article`[\s\S]*betaalde fallback blijven verboden/i);
  assert.match(qualityGates, /seo:keywords:check` blokkeert/i);
});

test('SEO machine enforces same-run selection, recovery and publication receipts', () => {
  const policy = readRepoFile('docs/growth/seo-machine-policy.md');
  const qualityGates = readRepoFile('docs/seo-machine-quality-gates.md');

  assert.match(policy, /`npm run seo:selection:check` vergelijkt[\s\S]*exacte top drie/i);
  assert.match(policy, /`recover-run` sluit[\s\S]*expliciet/i);
  assert.match(policy, /`finish-run published` accepteert alleen dezelfde invocation/i);
  assert.match(policy, /`cadence`[\s\S]*`selection`[\s\S]*`keywords`[\s\S]*`visuals`[\s\S]*`verify_critical`[\s\S]*`live_production`[\s\S]*`live_route`/i);
  assert.match(policy, /`--record-run-gate --run-thread <task-id> --run-invocation-at <invocation-at>`/i);
  assert.match(policy, /`repair-thread-binding` behoudt[\s\S]*bestaande teller/i);
  assert.match(policy, /`record-tool-smoke` bewaart per verplichte tool[\s\S]*`ok`\/`ok_empty`/i);
  assert.match(policy, /`npm run seo:live-route:check` controleert na productiepariteit/i);
  assert.match(qualityGates, /`recent_material_change`[\s\S]*`lastChangedAt`[\s\S]*`recheckAt`/i);
  assert.match(qualityGates, /mcp__ubersuggest__keyword_suggestions[\s\S]*mcp__ubersuggest__serp_analysis/i);
  assert.match(qualityGates, /Alleen toolnamen, vrije tekst of `validate_site` zijn geen dataproef/i);
  assert.match(qualityGates, /dezelfde finale Git-tree[\s\S]*dezelfde live commit/i);
});
