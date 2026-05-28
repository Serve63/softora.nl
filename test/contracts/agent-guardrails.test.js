const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  countAddedInlineScriptLines,
  buildGuardrailViolations,
  countAddedServerJsFunctions,
  countDiffLines,
  isAllowedNewServerPath,
  isFrontendProductionPath,
  isHighRiskPath,
  isPremiumAuthUsersWriteScanPath,
  isProtectedFrontendShellPath,
  isProtectedQualityGatePath,
  listAddedPremiumAuthUsersWriteRisks,
  listAddedBrowserStorageApis,
  listAddedTestWeakeningPatterns,
} = require('../../scripts/lib/agent-guardrails-core');

const repoRoot = path.resolve(__dirname, '../..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('protocol docs point agents at structured data ops storage', () => {
  const protocol = readRepoFile('docs/quality-protocol.md');
  const repoMap = readRepoFile('docs/repo-map.md');
  const dataOps = readRepoFile('docs/data-ops-storage.md');

  assert.match(protocol, /docs\/data-ops-storage\.md/);
  assert.match(repoMap, /data-ops storage\/health\/compat/);
  assert.match(dataOps, /softora_customers/);
  assert.match(dataOps, /softora-design-photos/);
  assert.match(dataOps, /node scripts\/migrate-data-ops\.js --write/);
});

test('agent guardrails detect high-risk changes without tests and recent backup', () => {
  const violations = buildGuardrailViolations({
    changedFiles: ['server.js', 'server/services/agenda-read.js'],
    addedFiles: [],
    changedTests: [],
    highRiskFiles: ['server.js', 'server/services/agenda-read.js'],
    behaviorFiles: ['server.js', 'server/services/agenda-read.js'],
    newestBackupAgeMs: 16 * 60 * 60 * 1000,
    isCi: false,
    serverJsLineCount: 7200,
    serverJsNetGrowth: 0,
  });

  assert.equal(violations.length, 2);
  assert.match(violations[0], /Productiecode aangepast zonder testwijziging/i);
  assert.match(violations[1], /runtime-backup is 16 uur oud|runtime-backup is 16\.0 uur oud/i);
});

test('agent guardrails detect server.js growth and new helper functions', () => {
  const diffText = [
    '@@ -10,0 +11,4 @@',
    '+function newServerSideHelper() {',
    '+  return true;',
    '+}',
    '+const untouched = 1;',
  ].join('\n');

  const diffCounts = countDiffLines(diffText);
  assert.deepEqual(diffCounts, { additions: 4, deletions: 0 });
  assert.equal(countAddedServerJsFunctions(diffText), 1);

  const violations = buildGuardrailViolations({
    changedFiles: ['server.js', 'test/contracts/example.test.js'],
    addedFiles: [],
    changedTests: ['test/contracts/example.test.js'],
    highRiskFiles: ['server.js'],
    behaviorFiles: ['server.js'],
    newestBackupAgeMs: 10 * 60 * 1000,
    isCi: false,
    serverJsLineCount: 7601,
    maxServerJsLines: 7500,
    serverAppRuntimeLineCount: 1190,
    maxServerAppRuntimeLines: 1200,
    serverJsNetGrowth: 41,
    maxServerJsNetGrowth: 25,
    addedServerJsFunctions: countAddedServerJsFunctions(diffText),
  });

  assert.equal(violations.length, 3);
  assert.match(violations[0], /server\.js telt nu 7601 regels/i);
  assert.match(violations[1], /groeide netto met 41 regels/i);
  assert.match(violations[2], /Nieuwe function-declaraties in server\.js/i);
});

test('agent guardrails protect runtime composition size and required protocol docs', () => {
  const violations = buildGuardrailViolations({
    changedFiles: ['server/services/server-app-runtime.js', 'test/contracts/example.test.js'],
    addedFiles: [],
    changedTests: ['test/contracts/example.test.js'],
    highRiskFiles: ['server/services/server-app-runtime.js'],
    behaviorFiles: ['server/services/server-app-runtime.js'],
    newestBackupAgeMs: 10 * 60 * 1000,
    isCi: false,
    missingRequiredRepoFiles: ['docs/quality-protocol.md'],
    serverJsLineCount: 25,
    serverAppRuntimeLineCount: 1211,
    maxServerAppRuntimeLines: 1200,
    serverJsNetGrowth: 0,
  });

  assert.equal(violations.length, 2);
  assert.match(violations[0], /Verplichte repo-protocolfiles ontbreken/i);
  assert.match(violations[1], /server\/services\/server-app-runtime\.js telt nu 1211 regels/i);
});

test('agent guardrails block nonstandard new server files and new root js files', () => {
  const violations = buildGuardrailViolations({
    changedFiles: ['server/helpers/legacy.js', 'dashboard-helper.js', 'test/contracts/example.test.js'],
    addedFiles: ['server/helpers/legacy.js', 'dashboard-helper.js'],
    changedTests: ['test/contracts/example.test.js'],
    highRiskFiles: [],
    behaviorFiles: ['server/helpers/legacy.js'],
    newestBackupAgeMs: null,
    isCi: false,
    serverJsLineCount: 7200,
    serverJsNetGrowth: 0,
  });

  assert.equal(violations.length, 2);
  assert.match(violations[0], /Nieuwe server-files buiten toegestane architectuurmappen/i);
  assert.match(violations[1], /Nieuwe root-JS files gedetecteerd/i);
});

test('agent guardrails detect newly added browser storage in production frontend files', () => {
  const diffText = [
    '@@ -10,0 +11,3 @@',
    "+window.localStorage.setItem('x', '1');",
    "+window.sessionStorage.removeItem('y');",
    '+const untouched = 1;',
  ].join('\n');

  assert.deepEqual(listAddedBrowserStorageApis(diffText), ['localStorage', 'sessionStorage']);

  const violations = buildGuardrailViolations({
    changedFiles: ['premium-ai-coldmailing.html', 'test/contracts/example.test.js'],
    addedFiles: [],
    changedTests: ['test/contracts/example.test.js'],
    highRiskFiles: [],
    behaviorFiles: ['premium-ai-coldmailing.html'],
    browserStorageViolations: ['premium-ai-coldmailing.html (localStorage, sessionStorage)'],
    newestBackupAgeMs: 5 * 60 * 1000,
    isCi: false,
    serverJsLineCount: 7200,
    serverJsNetGrowth: 0,
  });

  assert.equal(violations.length, 1);
  assert.match(violations[0], /Nieuwe browser-opslag in productiecode gedetecteerd/i);
});

test('agent guardrails block large inline scripts in html pages', () => {
  const htmlSource = [
    '<!doctype html>',
    '<html>',
    '<body>',
    '<script>',
    'const first = 1;',
    'const second = 2;',
    'const third = 3;',
    '</script>',
    '<script src="assets/personnel-theme.js"></script>',
    '</body>',
    '</html>',
  ].join('\n');
  const diffText = [
    '@@ -4,0 +5,3 @@',
    '+const first = 1;',
    '+const second = 2;',
    '+const third = 3;',
  ].join('\n');

  assert.equal(countAddedInlineScriptLines(diffText, htmlSource), 3);

  const violations = buildGuardrailViolations({
    changedFiles: ['premium-dashboard.html', 'test/contracts/example.test.js'],
    addedFiles: [],
    changedTests: ['test/contracts/example.test.js'],
    highRiskFiles: [],
    behaviorFiles: ['premium-dashboard.html'],
    largeInlineScriptViolations: ['premium-dashboard.html (90 inline scriptregels toegevoegd; limiet 80)'],
    newestBackupAgeMs: 5 * 60 * 1000,
    isCi: false,
    serverJsLineCount: 7200,
    serverJsNetGrowth: 0,
  });

  assert.equal(violations.length, 1);
  assert.match(violations[0], /Grote inline frontend-script toevoeging/i);
});

test('agent guardrails prevent oversized frontend files from growing further', () => {
  const violations = buildGuardrailViolations({
    changedFiles: ['assets/coldcalling-dashboard.js', 'test/contracts/example.test.js'],
    addedFiles: [],
    changedTests: ['test/contracts/example.test.js'],
    highRiskFiles: [],
    behaviorFiles: ['assets/coldcalling-dashboard.js'],
    oversizedFrontendGrowthViolations: [
      'assets/coldcalling-dashboard.js (7900 regels; netto +12; limiet 1200 regels en max +0)',
    ],
    newestBackupAgeMs: 5 * 60 * 1000,
    isCi: false,
    serverJsLineCount: 25,
    serverJsNetGrowth: 0,
  });

  assert.equal(violations.length, 1);
  assert.match(violations[0], /Groot frontend-bestand groeide verder/i);

  const coveredException = buildGuardrailViolations({
    changedFiles: ['assets/coldcalling-dashboard.js', 'test/contracts/example.test.js'],
    addedFiles: [],
    changedTests: ['test/contracts/example.test.js'],
    highRiskFiles: [],
    behaviorFiles: ['assets/coldcalling-dashboard.js'],
    oversizedFrontendGrowthViolations: [
      'assets/coldcalling-dashboard.js (7900 regels; netto +12; limiet 1200 regels en max +0)',
    ],
    allowOversizedFrontendGrowth: true,
    newestBackupAgeMs: 5 * 60 * 1000,
    isCi: false,
    serverJsLineCount: 25,
    serverJsNetGrowth: 0,
  });

  assert.equal(coveredException.length, 0);
});

test('agent guardrails require targeted tests for protected quality gates and sidebar shell', () => {
  const workflowSource = readRepoFile('.github/workflows/agent-guardrails.yml');
  const qualityLockSource = readRepoFile('scripts/check-quality-lock.js');
  assert.match(qualityLockSource, /PREMIUM_SIDEBAR_THEME_VERSION = '20260519b'/);
  assert.equal(isProtectedQualityGatePath('scripts/check-quality-lock.js'), true);
  assert.match(workflowSource, /GUARDRAILS_MAX_BEHAVIOR_DIFF_LINES:\s*2500/);

  const violations = buildGuardrailViolations({
    changedFiles: ['assets/personnel-theme.css', 'scripts/check-agent-guardrails.js', 'scripts/check-quality-lock.js'],
    addedFiles: [],
    changedTests: ['test/contracts/example.test.js'],
    highRiskFiles: [],
    behaviorFiles: ['assets/personnel-theme.css', 'scripts/check-agent-guardrails.js', 'scripts/check-quality-lock.js'],
    protectedFrontendShellFiles: ['assets/personnel-theme.css'],
    protectedQualityGateFiles: ['scripts/check-agent-guardrails.js', 'scripts/check-quality-lock.js'],
    newestBackupAgeMs: 5 * 60 * 1000,
    isCi: false,
    serverJsLineCount: 7200,
    serverJsNetGrowth: 0,
  });

  assert.equal(violations.length, 2);
  assert.match(violations[0], /Premium shell\/sidebar gewijzigd zonder gerichte shell-contracttest/i);
  assert.match(violations[1], /Quality-gate bestanden gewijzigd zonder guardrail-test/i);

  const covered = buildGuardrailViolations({
    changedFiles: [
      'assets/personnel-theme.css',
      'scripts/check-agent-guardrails.js',
      'scripts/check-quality-lock.js',
      'test/contracts/premium-sidebar-shell-scope.test.js',
      'test/contracts/agent-guardrails.test.js',
    ],
    addedFiles: [],
    changedTests: [
      'test/contracts/premium-sidebar-shell-scope.test.js',
      'test/contracts/agent-guardrails.test.js',
    ],
    highRiskFiles: [],
    behaviorFiles: ['assets/personnel-theme.css', 'scripts/check-agent-guardrails.js', 'scripts/check-quality-lock.js'],
    protectedFrontendShellFiles: ['assets/personnel-theme.css'],
    protectedQualityGateFiles: ['scripts/check-agent-guardrails.js', 'scripts/check-quality-lock.js'],
    newestBackupAgeMs: 5 * 60 * 1000,
    isCi: false,
    serverJsLineCount: 7200,
    serverJsNetGrowth: 0,
  });

  assert.equal(covered.length, 0);

  const workflowCovered = buildGuardrailViolations({
    changedFiles: ['.github/workflows/agent-guardrails.yml'],
    addedFiles: [],
    changedTests: ['test/contracts/agent-guardrails.test.js'],
    highRiskFiles: [],
    behaviorFiles: ['.github/workflows/agent-guardrails.yml'],
    protectedQualityGateFiles: ['.github/workflows/agent-guardrails.yml'],
    protectedFrontendShellFiles: [],
    newestBackupAgeMs: 5 * 60 * 1000,
    isCi: false,
    serverJsLineCount: 7200,
    serverJsNetGrowth: 0,
  });

  assert.equal(workflowCovered.length, 0);
});

test('agent guardrails block test weakening and quality-baseline regressions', () => {
  const focusedTestLine = 'test' + ".only('temporary focus', () => {});";
  const skippedTestLine = 'test' + ".skip('temporary bypass', () => {});";
  const todoTestLine = '+test("todo bypass", { to' + 'do: true }, () => {});';
  const diffText = [
    '@@ -10,0 +11,4 @@',
    `+${focusedTestLine}`,
    `+${skippedTestLine}`,
    todoTestLine,
    '+const untouched = 1;',
  ].join('\n');

  assert.deepEqual(listAddedTestWeakeningPatterns(diffText), [
    'only-test',
    'skip-test',
    'todo-option',
  ]);

  const violations = buildGuardrailViolations({
    changedFiles: ['test/contracts/example.test.js'],
    addedFiles: [],
    changedTests: ['test/contracts/example.test.js'],
    highRiskFiles: [],
    behaviorFiles: [],
    testWeakeningViolations: ['test/contracts/example.test.js (only-test, skip-test, todo-option)'],
    qualityBaselineViolations: ['scripts/verify-critical.js mist npm run check:guardrails'],
    newestBackupAgeMs: 5 * 60 * 1000,
    isCi: false,
    serverJsLineCount: 7200,
    serverJsNetGrowth: 0,
  });

  assert.equal(violations.length, 2);
  assert.match(violations[0], /Quality-baseline is verzwakt/i);
  assert.match(violations[1], /Test-verzwakking gedetecteerd/i);
});

test('agent guardrails block direct premium auth users writes', () => {
  const diffText = [
    '@@ -10,0 +11,8 @@',
    "+const row = {",
    "+  state_key: 'premium_auth_users',",
    "+  payload: { users: nextUsers },",
    "+  meta: { source: 'codex_autopilot_test' },",
    '+};',
    '+await upsertSupabaseRowViaRest(row);',
    '+const unrelated = true;',
  ].join('\n');

  assert.deepEqual(listAddedPremiumAuthUsersWriteRisks(diffText), [
    'direct-write-context',
    'direct-write-target',
    'unapproved-source:codex_autopilot_test',
  ]);

  const allowedReadOnlyReference = [
    '@@ -10,0 +11,2 @@',
    "+const rowKey = 'premium_auth_users';",
    '+const onlyRead = true;',
  ].join('\n');
  assert.deepEqual(listAddedPremiumAuthUsersWriteRisks(allowedReadOnlyReference), []);
  assert.equal(isPremiumAuthUsersWriteScanPath('reports/premium-login-incident-2026-05-27.md'), false);
  assert.equal(isPremiumAuthUsersWriteScanPath('scripts/autopilot-proof.js'), true);

  const violations = buildGuardrailViolations({
    changedFiles: ['scripts/autopilot-proof.js', 'test/contracts/agent-guardrails.test.js'],
    addedFiles: [],
    changedTests: ['test/contracts/agent-guardrails.test.js'],
    highRiskFiles: [],
    behaviorFiles: ['scripts/autopilot-proof.js'],
    premiumAuthUsersWriteViolations: [
      'scripts/autopilot-proof.js (direct-write-context, direct-write-target, unapproved-source:codex_autopilot_test)',
    ],
    newestBackupAgeMs: 5 * 60 * 1000,
    isCi: false,
    serverJsLineCount: 7200,
    serverJsNetGrowth: 0,
  });

  assert.equal(violations.length, 1);
  assert.match(violations[0], /premium_auth_users-write gedetecteerd/i);
  assert.match(violations[0], /officiële premium-gebruikersroutes\/store/i);
});

test('agent guardrails block broad behavior changes in one step', () => {
  const violations = buildGuardrailViolations({
    changedFiles: ['assets/big-feature.js', 'test/contracts/example.test.js'],
    addedFiles: [],
    changedTests: ['test/contracts/example.test.js'],
    highRiskFiles: [],
    behaviorFiles: ['assets/big-feature.js'],
    behaviorDiffLineCount: 1200,
    maxBehaviorDiffLineCount: 900,
    newestBackupAgeMs: 5 * 60 * 1000,
    isCi: false,
    serverJsLineCount: 7200,
    serverJsNetGrowth: 0,
  });

  assert.equal(violations.length, 1);
  assert.match(violations[0], /Productiewijziging is te groot voor één veilige stap/i);
});

test('agent guardrails keep local cleanliness checks in the critical path', () => {
  const packageJson = JSON.parse(readRepoFile('package.json'));
  const vercelConfig = JSON.parse(readRepoFile('vercel.json'));
  const verifyCriticalSource = readRepoFile('scripts/verify-critical.js');
  const hygieneSource = readRepoFile('scripts/check-repo-hygiene.sh');
  const cleanSource = readRepoFile('scripts/clean-local-artifacts.sh');
  const guardrailsSource = readRepoFile('scripts/check-agent-guardrails.js');
  const deployGuardSource = readRepoFile('scripts/guard-production-deploy-source.js');
  const qualityLockSource = readRepoFile('scripts/check-quality-lock.js');
  const liveVersionSource = readRepoFile('scripts/check-live-production-version.js');
  const liveWaitSource = readRepoFile('scripts/wait-live-production-version.js');
  const safeDeploySource = readRepoFile('scripts/deploy-production-safe.js');
  const liveWorkflowSource = readRepoFile('.github/workflows/live-production-version.yml');
  const agentsSource = readRepoFile('AGENTS.md');
  const protocolSource = readRepoFile('docs/quality-protocol.md');

  assert.equal(packageJson.scripts['check:repo-hygiene'], 'bash scripts/check-repo-hygiene.sh');
  assert.equal(packageJson.scripts['check:quality-lock'], 'node scripts/check-quality-lock.js');
  assert.equal(packageJson.scripts['check:production-deploy-source'], 'node scripts/guard-production-deploy-source.js');
  assert.equal(packageJson.scripts['check:live-production-version'], 'node scripts/check-live-production-version.js');
  assert.equal(packageJson.scripts['check:live-production-version:wait'], 'node scripts/wait-live-production-version.js');
  assert.equal(packageJson.scripts['deploy:production'], 'node scripts/deploy-production-safe.js');
  assert.equal(packageJson.scripts['clean:local'], 'bash scripts/clean-local-artifacts.sh');
  assert.match(packageJson.dependencies.sharp, /^\^0\.34\./);
  assert.equal(packageJson.optionalDependencies['@img/sharp-linux-arm64'], '^0.34.5');
  assert.equal(packageJson.optionalDependencies['@img/sharp-libvips-linux-arm64'], '^1.2.4');
  assert.equal(
    vercelConfig.installCommand,
    'npm ci --include=optional && npm install --os=linux --cpu=arm64 --libc=glibc --include=optional --no-save sharp@0.34.5 @img/sharp-linux-arm64@0.34.5 @img/sharp-libvips-linux-arm64@1.2.4'
  );
  Object.values(vercelConfig.functions).forEach((functionConfig) => {
    assert.equal(
      functionConfig.includeFiles,
      '{*.html,assets/fonts/**,node_modules/sharp/**,node_modules/@img/sharp-linux-arm64/**,node_modules/@img/sharp-libvips-linux-arm64/**}'
    );
  });
  assert.match(verifyCriticalSource, /\['run', 'check:repo-hygiene'\]/);
  assert.match(verifyCriticalSource, /\['run', 'check:quality-lock'\]/);
  assert.match(hygieneSource, /\.vercel\/output/);
  assert.match(hygieneSource, /npm run clean:local/);
  assert.match(cleanSource, /\.vercel\/output/);
  assert.doesNotMatch(cleanSource, /rm -rf -- "\.vercel"/);
  assert.match(guardrailsSource, /function getGuardrailDiffBaseRef\(\)/);
  assert.match(guardrailsSource, /GUARDRAILS_BASE_REF/);
  assert.match(guardrailsSource, /GITHUB_BASE_REF/);
  assert.match(guardrailsSource, /origin\/main/);
  assert.match(guardrailsSource, /\['merge-base', baseRef, 'HEAD'\]/);
  assert.match(guardrailsSource, /\['diff', '--name-only', '--diff-filter=ACMR', branchDiffBase, '--'\]/);
  assert.match(guardrailsSource, /\['diff', '--unified=0', branchDiffBase, '--', filePath\]/);
  assert.match(deployGuardSource, /mainRef\.stdout !== headRef\.stdout/);
  assert.match(deployGuardSource, /exact origin\/main/);
  assert.match(qualityLockSource, /curl/);
  assert.match(qualityLockSource, /deployment/);
  assert.match(liveVersionSource, /VERCEL_TOKEN/);
  assert.match(liveVersionSource, /--yes/);
  assert.match(liveWaitSource, /assertLiveProductionVersion/);
  assert.match(liveWorkflowSource, /push:\s*[\s\S]*branches:\s*[\s\S]*main/);
  assert.match(liveWorkflowSource, /npm run check:live-production-version:wait/);
  assert.match(safeDeploySource, /assertSafeProductionDeploySource\(\)/);
  assert.match(safeDeploySource, /verify:critical/);
  assert.match(safeDeploySource, /check:live-production-version/);
  assert.match(agentsSource, /Productie deployen mag alleen via `npm run deploy:production`/);
  assert.match(agentsSource, /check:live-production-version/);
  assert.match(agentsSource, /Elke push\/merge naar `main`/);
  assert.match(agentsSource, /allerlaatste actuele `origin\/main`/);
  assert.match(agentsSource, /Deploy nooit vanuit een oude lokale kopie/);
  assert.match(agentsSource, /recente live wijzigingen behouden blijven/);
  assert.match(protocolSource, /Productie deploys lopen alleen via `npm run deploy:production`/);
  assert.match(protocolSource, /check:live-production-version/);
  assert.match(protocolSource, /Elke push\/merge naar `main`/);
  assert.match(protocolSource, /allerlaatste actuele `origin\/main`/);
  assert.match(protocolSource, /Oude lokale kopieen/);
  assert.match(protocolSource, /Recente live wijzigingen mogen niet verdwijnen/);
});

test('agent guardrails helpers recognize approved and high-risk paths', () => {
  assert.equal(isAllowedNewServerPath('server/services/new-service.js'), true);
  assert.equal(isAllowedNewServerPath('server/helpers/new-helper.js'), false);
  assert.equal(isFrontendProductionPath('premium-ai-coldmailing.html'), true);
  assert.equal(isFrontendProductionPath('assets/coldcalling-dashboard.js'), true);
  assert.equal(isFrontendProductionPath('server/services/ui-state.js'), false);
  assert.equal(isHighRiskPath('server/services/agenda-metadata.js'), true);
  assert.equal(isHighRiskPath('server/services/server-app-runtime.js'), true);
  assert.equal(isProtectedFrontendShellPath('assets/personnel-theme.js'), true);
  assert.equal(isProtectedFrontendShellPath('assets/coldcalling-dashboard.js'), false);
  assert.equal(isProtectedQualityGatePath('scripts/check-agent-guardrails.js'), true);
  assert.equal(isProtectedQualityGatePath('scripts/check-quality-lock.js'), true);
  assert.equal(isProtectedQualityGatePath('AGENTS.md'), true);
  assert.equal(isProtectedQualityGatePath('package.json'), true);
  assert.equal(isProtectedQualityGatePath('.github/workflows/repo-hygiene.yml'), true);
  assert.equal(isProtectedQualityGatePath('docs/quality-protocol.md'), true);
  assert.equal(isProtectedQualityGatePath('docs/repo-map.md'), true);
  assert.equal(isProtectedQualityGatePath('scripts/clean-local-artifacts.sh'), true);
  assert.equal(isProtectedQualityGatePath('scripts/export-runtime-backup.js'), false);
  assert.equal(isHighRiskPath('docs/repo-map.md'), false);
});
