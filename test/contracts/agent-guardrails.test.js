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
  isApprovedBrowserStoragePath,
  isBackendProductionPath,
  isFrontendProductionPath,
  isHighRiskPath,
  isApprovedPremiumAuthUsersWriteFile,
  isPremiumAuthUsersWriteScanPath,
  isProtectedFrontendShellPath,
  isProtectedQualityGatePath,
  listAddedPremiumAuthUsersWriteRisks,
  listAddedBrowserStorageApis,
  listAddedTestWeakeningPatterns,
} = require('../../scripts/lib/agent-guardrails-core');
const { listExistingRepoFiles } = require('../../scripts/check-quality-lock');

const repoRoot = path.resolve(__dirname, '../..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('quality lock ignores deleted index entries but keeps existing and untracked files', () => {
  const existingFiles = new Set([
    'scripts/check-quality-lock.js',
    'test/contracts/new-mail-runtime.test.js',
  ]);

  assert.deepEqual(
    listExistingRepoFiles(
      [
        'test/contracts/deleted-mail-hotfix.test.js',
        './scripts/check-quality-lock.js',
        'test/contracts/new-mail-runtime.test.js',
        'scripts/check-quality-lock.js',
      ],
      (filePath) => existingFiles.has(filePath)
    ),
    ['scripts/check-quality-lock.js', 'test/contracts/new-mail-runtime.test.js']
  );
});

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

test('websitevideo tooling blijft lokaal en expliciet startbaar', () => {
  const packageJson = JSON.parse(readRepoFile('package.json'));
  assert.equal(packageJson.scripts['worker:website-video'], 'node scripts/company-website-video-worker.js');
  assert.equal(packageJson.scripts['worker:website-video:once'], 'node scripts/company-website-video-worker.js --once');
  assert.equal(packageJson.scripts['test:e2e:website-video'], 'node --test test/e2e/company-website-video.e2e.test.js');
  assert.ok(packageJson.dependencies.playwright);
  assert.ok(packageJson.dependencies['ffmpeg-static']);
  assert.ok(packageJson.dependencies['ffprobe-static']);
});

test('protected package metadata houdt de echte lokale mailbox-Postgrespoort vast', () => {
  const packageJson = JSON.parse(readRepoFile('package.json'));
  const runner = readRepoFile('test/postgres/run-mailbox-postgres-locks.js');
  const uidProtocolRunner = readRepoFile('test/postgres/run-mailbox-uid-protocol-gate.js');
  const uidGenerationRunner = readRepoFile('test/postgres/run-mailbox-uid-generation-v2.js');
  const postgresTest = readRepoFile('test/postgres/mailbox-campaign-lock-order.postgres.test.js');
  const uidProtocolTest = readRepoFile('test/postgres/mailbox-uid-protocol-gate.postgres.test.js');
  const uidGenerationTest = readRepoFile('test/postgres/mailbox-uid-generation-v2.postgres.test.js');
  assert.equal(packageJson.scripts['test:mailbox-postgres-locks'],
    'node test/postgres/run-mailbox-postgres-locks.js');
  assert.equal(packageJson.scripts['test:mailbox-postgres-uid-protocol-gate'],
    'node test/postgres/run-mailbox-uid-protocol-gate.js');
  assert.equal(packageJson.scripts['test:postgres:mailbox-uid-generation-v2'],
    'node --test test/postgres/mailbox-uid-generation-v2.postgres.test.js');
  assert.equal(packageJson.scripts['test:mailbox-postgres-uid-generation-v2'],
    'node test/postgres/run-mailbox-uid-generation-v2.js');
  assert.equal(packageJson.devDependencies.pg, '8.23.0');
  assert.match(runner, /MAILBOX_POSTGRES_ADMIN_URL/);
  assert.match(runner, /localHosts/);
  assert.match(runner, /create database/);
  assert.match(runner, /drop database if exists/);
  assert.match(uidProtocolRunner, /MAILBOX_POSTGRES_ADMIN_URL/);
  assert.match(uidProtocolRunner, /localHosts/);
  assert.match(uidProtocolRunner, /create database/);
  assert.match(uidProtocolRunner, /drop database if exists/);
  assert.match(uidGenerationRunner, /MAILBOX_POSTGRES_ADMIN_URL/);
  assert.match(uidGenerationRunner, /localHosts/);
  assert.match(uidGenerationRunner, /create database/);
  assert.match(uidGenerationRunner, /drop database if exists/);
  assert.match(postgresTest, /20260810012150_mailbox_send_provider_outcome_state\.sql/);
  assert.match(postgresTest, /provenance_service_truncate/);
  assert.match(uidProtocolTest, /softora_mailbox_\(\?:uid_protocol\|lock\)_test/);
  assert.match(uidGenerationTest, /softora_mailbox_\(\?:uid_generation\|lock\)_test/);
});

test('mailbox PostgreSQL-verificatie blijft dev-only en exact reproduceerbaar', () => {
  const packageJson = JSON.parse(readRepoFile('package.json'));
  assert.equal(packageJson.devDependencies['@electric-sql/pglite'], '0.5.4');
  assert.equal(packageJson.devDependencies['pgsql-parser'], '18.2.6');
  assert.equal(packageJson.dependencies['@electric-sql/pglite'], undefined);
  assert.equal(packageJson.dependencies['pgsql-parser'], undefined);
});

test('mailbox spellingscontrole blijft lokaal en activeert geen betaalde provider', () => {
  const packageJson = JSON.parse(readRepoFile('package.json'));
  const spellingServiceSource = readRepoFile('server/services/mailbox-spelling.js');
  const mailboxRoutesSource = readRepoFile('server/routes/mailbox.js');

  assert.equal(packageJson.dependencies.nspell, '^2.1.5');
  assert.equal(packageJson.dependencies['dictionary-nl'], '^2.0.0');
  assert.match(spellingServiceSource, /import\('nspell'\)/);
  assert.match(spellingServiceSource, /import\('dictionary-nl'\)/);
  assert.doesNotMatch(spellingServiceSource, /openai|chat\.completions|fetch\s*\(|axios|https\.request/i);
  assert.match(
    mailboxRoutesSource,
    /app\.post\('\/api\/mailbox\/spelling', requireAdmin, \(req, res\) =>/
  );
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

test('agent guardrails allow browser storage only in approved local-state helpers', () => {
  assert.equal(isApprovedBrowserStoragePath('assets/premium-browser-storage.js'), true);
  assert.equal(isApprovedBrowserStoragePath('assets/premium-page-bootstrap-session.js'), true);
  assert.equal(isApprovedBrowserStoragePath('assets/personnel-theme.js'), true);
  assert.equal(isApprovedBrowserStoragePath('assets/premium-sidebar-profile-prefill.js'), true);
  assert.equal(isApprovedBrowserStoragePath('assets/sportschool-logboek.js'), true);
  assert.equal(isApprovedBrowserStoragePath('assets/premium-mailbox-campaign-inbox.js'), false);
  assert.equal(isApprovedBrowserStoragePath('assets/premium-mailbox-state-outbox.js'), false);
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

test('agent guardrails prevent oversized backend modules from growing further', () => {
  const violations = buildGuardrailViolations({
    changedFiles: ['server/services/coldmail-campaign.js', 'test/contracts/example.test.js'],
    addedFiles: [],
    changedTests: ['test/contracts/example.test.js'],
    highRiskFiles: [],
    behaviorFiles: ['server/services/coldmail-campaign.js'],
    oversizedBackendGrowthViolations: [
      'server/services/coldmail-campaign.js (9620 regels; netto +9; limiet 1200 regels en max +0)',
    ],
    newestBackupAgeMs: 5 * 60 * 1000,
    isCi: false,
    serverJsLineCount: 25,
    serverJsNetGrowth: 0,
  });

  assert.equal(violations.length, 1);
  assert.match(violations[0], /Grote backendmodule groeide verder/i);

  const coveredException = buildGuardrailViolations({
    changedFiles: ['server/services/coldmail-campaign.js', 'test/contracts/example.test.js'],
    addedFiles: [],
    changedTests: ['test/contracts/example.test.js'],
    highRiskFiles: [],
    behaviorFiles: ['server/services/coldmail-campaign.js'],
    oversizedBackendGrowthViolations: [
      'server/services/coldmail-campaign.js (9620 regels; netto +9; limiet 1200 regels en max +0)',
    ],
    allowOversizedBackendGrowth: true,
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
  assert.match(qualityLockSource, /PASSWORD_REGISTER_PAGE = 'premium-wachtwoordenregister\.html'/);
  assert.match(qualityLockSource, /data-password-register-csp-ready/);
  assert.match(qualityLockSource, /premium-password-register-autolock\.js/);
  assert.doesNotMatch(
    qualityLockSource,
    /assets\/premium-ui-state-client\.js/,
    'de definitieve kluisallowlist mag de generieke UI-stateclient niet opnieuw toelaten'
  );
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

  const approvedMigrationPath = 'supabase/migrations/20260813103910_atomic_premium_mfa_state.sql';
  const approvedMigration = readRepoFile(approvedMigrationPath);
  assert.equal(isApprovedPremiumAuthUsersWriteFile(approvedMigrationPath, approvedMigration), true);
  assert.equal(
    isApprovedPremiumAuthUsersWriteFile(approvedMigrationPath, `${approvedMigration}\n-- unreviewed mutation`),
    false
  );
  assert.equal(
    isApprovedPremiumAuthUsersWriteFile('supabase/migrations/20260813103911_copy.sql', approvedMigration),
    false
  );

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
  const nvmrcSource = readRepoFile('.nvmrc');
  const vercelConfig = JSON.parse(readRepoFile('vercel.json'));
  const verifyCriticalSource = readRepoFile('scripts/verify-critical.js');
  const hygieneSource = readRepoFile('scripts/check-repo-hygiene.sh');
  const publicDataSource = readRepoFile('scripts/check-public-data-exposure.js');
  const cleanSource = readRepoFile('scripts/clean-local-artifacts.sh');
  const guardrailsSource = readRepoFile('scripts/check-agent-guardrails.js');
  const deployGuardSource = readRepoFile('scripts/guard-production-deploy-source.js');
  const qualityLockSource = readRepoFile('scripts/check-quality-lock.js');
  const liveVersionSource = readRepoFile('scripts/check-live-production-version.js');
  const liveWaitSource = readRepoFile('scripts/wait-live-production-version.js');
  const safeDeploySource = readRepoFile('scripts/deploy-production-safe.js');
  const coldmailGuardBackfillSource = readRepoFile('scripts/backfill-coldmail-outbound-guards.js');
  const liveWorkflowSource = readRepoFile('.github/workflows/live-production-version.yml');
  const guardrailWorkflowSource = readRepoFile('.github/workflows/agent-guardrails.yml');
  const verifyWorkflowSource = readRepoFile('.github/workflows/verify-critical.yml');
  const repoHygieneWorkflowSource = readRepoFile('.github/workflows/repo-hygiene.yml');
  const dependabotSource = readRepoFile('.github/dependabot.yml');
  const gitignoreSource = readRepoFile('.gitignore');
  const agentsSource = readRepoFile('AGENTS.md');
  const protocolSource = readRepoFile('docs/quality-protocol.md');
  const instantlyRoutesSource = readRepoFile('server/routes/instantly.js');
  const instantlyServiceSource = readRepoFile('server/services/instantly-outreach.js');
  const coldmailServiceSource = readRepoFile('server/services/coldmail-campaign.js');
  const instantlySyncHandlerSource =
    instantlyRoutesSource.match(/async function handleSync[\s\S]*?async function handleStatus/)?.[0] || '';

  assert.equal(packageJson.scripts['check:repo-hygiene'], 'bash scripts/check-repo-hygiene.sh');
  assert.equal(packageJson.scripts['check:deps'], 'npm audit --omit=dev');
  assert.equal(packageJson.scripts['check:public-data'], 'node scripts/check-public-data-exposure.js');
  assert.equal(packageJson.scripts['check:quality-lock'], 'node scripts/check-quality-lock.js');
  assert.equal(
    packageJson.scripts['test:postgres:mailbox-locks'],
    'node --test test/postgres/mailbox-campaign-lock-order.postgres.test.js'
  );
  assert.equal(
    packageJson.scripts['test:postgres:mailbox-uid-protocol-gate'],
    'node --test test/postgres/mailbox-uid-protocol-gate.postgres.test.js'
  );
  assert.equal(
    packageJson.scripts['test:postgres:mailbox-uid-generation-v2'],
    'node --test test/postgres/mailbox-uid-generation-v2.postgres.test.js'
  );
  assert.equal(packageJson.scripts['check:production-deploy-source'], 'node scripts/guard-production-deploy-source.js');
  assert.equal(packageJson.scripts['check:live-production-version'], 'node scripts/check-live-production-version.js');
  assert.equal(packageJson.scripts['check:live-production-version:wait'], 'node scripts/wait-live-production-version.js');
  assert.equal(packageJson.scripts['seo:backlog:check'], 'node scripts/check-seo-machine-backlog.js');
  assert.equal(packageJson.scripts['seo:publications:report'], 'node scripts/seo-machine-publication-report.js');
  assert.equal(packageJson.scripts['seo:indexation:report'], 'node scripts/seo-machine-indexation-report.js');
  assert.equal(packageJson.scripts['seo:visuals:check'], 'node scripts/check-seo-machine-visuals.js');
  assert.equal(packageJson.scripts['seo:keywords:check'], 'node scripts/check-seo-machine-keywords.js');
  assert.equal(packageJson.scripts['seo:reviews:check'], 'node scripts/check-seo-machine-reviews.js');
  assert.equal(packageJson.scripts['seo:selection:check'], 'node scripts/check-seo-machine-selection.js');
  assert.equal(packageJson.scripts['seo:live-route:check'], 'node scripts/check-seo-machine-live-route.js');
  assert.equal(packageJson.scripts['seo:automation-state'], 'node scripts/seo-machine-automation-state.js');
  assert.equal(packageJson.scripts['seo:cadence:check'], 'node scripts/check-seo-machine-cadence.js');
  assert.equal(packageJson.scripts['check:coldmail-outbound-guards'], 'node scripts/backfill-coldmail-outbound-guards.js');
  assert.equal(
    packageJson.scripts['backfill:coldmail-outbound-guards'],
    'node scripts/backfill-coldmail-outbound-guards.js --apply'
  );
  assert.equal(packageJson.scripts['deploy:production'], 'node scripts/deploy-production-safe.js');
  assert.equal(packageJson.scripts['clean:local'], 'bash scripts/clean-local-artifacts.sh');
  assert.equal(packageJson.engines.node, '22.x');
  assert.equal(nvmrcSource.trim(), '22');
  assert.equal(packageJson.dependencies.nodemailer, '^9.0.1');
  assert.equal(packageJson.dependencies.mailparser, '^3.9.14');
  assert.equal(packageJson.overrides['deepmerge-ts'], '8.0.1');
  assert.equal(packageJson.overrides.qs, '6.16.0');
  assert.equal(packageJson.dependencies.htmlparser2, '^10.1.0');
  assert.equal(packageJson.dependencies.sharp, '^0.35.3');
  assert.equal(packageJson.devDependencies.pg, '8.23.0');
  assert.equal(packageJson.optionalDependencies['@img/sharp-linux-arm64'], '^0.35.3');
  assert.equal(packageJson.optionalDependencies['@img/sharp-libvips-linux-arm64'], '^1.3.2');
  assert.equal(packageJson.optionalDependencies['@img/sharp-linux-x64'], '^0.35.3');
  assert.equal(packageJson.optionalDependencies['@img/sharp-libvips-linux-x64'], '^1.3.2');
  assert.equal(
    vercelConfig.installCommand,
    'npm ci --include=optional && npm install --os=linux --cpu=arm64 --libc=glibc --include=optional --no-save sharp@0.35.3 @img/sharp-linux-arm64@0.35.3 @img/sharp-libvips-linux-arm64@1.3.2'
  );
  const standardIncludeFiles = '{*.html,assets/fonts/**,assets/premium-sidebar-profile-prefill.js,node_modules/sharp/**,node_modules/@img/sharp-linux-x64/**,node_modules/@img/sharp-libvips-linux-x64/**,node_modules/@img/sharp-linux-arm64/**,node_modules/@img/sharp-libvips-linux-arm64/**}';
  const personalSiteIncludeFiles = '{*.html,personal-sites/**,assets/fonts/**,assets/premium-sidebar-profile-prefill.js,node_modules/sharp/**,node_modules/@img/**}';
  Object.entries(vercelConfig.functions).forEach(([functionPath, functionConfig]) => {
    assert.equal(
      functionConfig.includeFiles,
      ['api/[...path].js', 'api/index.js'].includes(functionPath)
        ? personalSiteIncludeFiles
        : standardIncludeFiles
    );
  });
  assert.match(verifyCriticalSource, /\['run', 'check:repo-hygiene'\]/);
  assert.match(verifyCriticalSource, /\['run', 'check:public-data'\]/);
  assert.match(verifyCriticalSource, /\['run', 'check:deps'\]/);
  assert.match(verifyCriticalSource, /\['run', 'check:quality-lock'\]/);
  assert.match(verifyCriticalSource, /\['run', 'test:postgres:mailbox-locks'\]/);
  assert.match(verifyCriticalSource, /\['run', 'test:postgres:mailbox-uid-protocol-gate'\]/);
  assert.match(verifyCriticalSource, /\['run', 'test:postgres:mailbox-uid-generation-v2'\]/);
  assert.match(publicDataSource, /MAX_EMBEDDED_JSON_BYTES/);
  assert.match(publicDataSource, /BLOCKED_DATA_EXTENSIONS/);
  assert.match(publicDataSource, /git', \['ls-files', '-z'\]/);
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
  assert.match(guardrailsSource, /GUARDRAILS_MAX_BACKEND_FILE_LINES/);
  assert.match(guardrailsSource, /ALLOW_OVERSIZED_BACKEND_GROWTH/);
  assert.match(guardrailsSource, /function getOutboundDuplicateSafetyViolations\(\)/);
  assert.match(guardrailsSource, /body\.limit niet doorgeven aan legacy Instantly sync-routes/);
  assert.match(guardrailsSource, /Instantly \/leads\/add mag niet bereikbaar zijn zonder centrale outbound-reservering/);
  assert.match(instantlySyncHandlerSource, /syncInstantlyLeads\(\{[\s\S]*reconcileOnly:\s*true/);
  assert.doesNotMatch(instantlySyncHandlerSource, /limit:\s*body\.limit/);
  assert.match(instantlyServiceSource, /syncInstantlyLeads\(\{\s*actor:\s*'Instantly autopilot',\s*reconcileOnly:\s*true\s*\}\)/);
  assert.match(instantlyServiceSource, /reserveSupabaseOutboundRecipientsForInstantly\(sendableRows,[\s\S]*source:\s*'instantly-sync'/);
  assert.match(coldmailServiceSource, /COLDMAIL_OUTBOUND_GUARD_UNAVAILABLE/);
  assert.doesNotMatch(
    coldmailServiceSource.match(/async function reserveSupabaseOutboundRecipientForColdmail[\s\S]*?async function confirmSupabaseOutboundRecipientForColdmail/)?.[0] || '',
    /return\s+\{\s*ok:\s*false,\s*skipped:\s*true\s*\};/
  );
  assert.match(deployGuardSource, /mainRef\.stdout !== headRef\.stdout/);
  assert.match(deployGuardSource, /exact origin\/main/);
  assert.match(qualityLockSource, /curl/);
  assert.match(qualityLockSource, /deployment/);
  assert.match(liveVersionSource, /VERCEL_TOKEN/);
  assert.match(liveVersionSource, /--yes/);
  assert.match(liveVersionSource, /DEFAULT_VERCEL_SCOPE/);
  assert.match(liveVersionSource, /--scope/);
  assert.match(liveWaitSource, /assertLiveProductionVersion/);
  assert.match(liveWorkflowSource, /push:\s*[\s\S]*branches:\s*[\s\S]*main/);
  assert.match(liveWorkflowSource, /npm run check:live-production-version:wait/);
  assert.match(liveWorkflowSource, /node-version:\s*22/);
  assert.match(guardrailWorkflowSource, /node-version:\s*22/);
  assert.match(verifyWorkflowSource, /node-version:\s*22/);
  assert.match(
    verifyWorkflowSource,
    /image:\s*postgres:17\.6-alpine@sha256:[0-9a-f]{64}/
  );
  assert.match(verifyWorkflowSource, /POSTGRES_DB:\s*softora_mailbox_lock_test_ci/);
  assert.match(verifyWorkflowSource, /MAILBOX_POSTGRES_TEST_URL:/);
  assert.match(verifyWorkflowSource, /MAILBOX_POSTGRES_TEST_ALLOW_DESTRUCTIVE:\s*'1'/);
  [liveWorkflowSource, guardrailWorkflowSource, verifyWorkflowSource, repoHygieneWorkflowSource].forEach(
    (workflowSource) => assert.match(workflowSource, /uses:\s*actions\/checkout@[0-9a-f]{40}\s*#\s*v7\./)
  );
  [liveWorkflowSource, guardrailWorkflowSource, verifyWorkflowSource].forEach(
    (workflowSource) => assert.match(workflowSource, /uses:\s*actions\/setup-node@[0-9a-f]{40}\s*#\s*v7\./)
  );
  assert.match(dependabotSource, /package-ecosystem:\s*npm/);
  assert.match(dependabotSource, /package-ecosystem:\s*github-actions/);
  assert.match(dependabotSource, /interval:\s*weekly/);
  assert.match(gitignoreSource, /reports\/\*\.md/);
  assert.match(gitignoreSource, /outputs\//);
  assert.match(gitignoreSource, /research\//);
  assert.match(gitignoreSource, /\*\.csv/);
  assert.match(coldmailGuardBackfillSource, /mailbox-historical-outbound-backfill-2026-08-17/);
  assert.match(coldmailGuardBackfillSource, /isHistoricalOutboundFolder/);
  assert.match(coldmailGuardBackfillSource, /--summary-only/);
  assert.match(coldmailGuardBackfillSource, /central_outbound_guard_missing_monitor_2026_06_08/);
  assert.match(coldmailGuardBackfillSource, /--pause-on-missing/);
  assert.match(coldmailGuardBackfillSource, /softora_outbound_recipient_guards/);
  assert.match(safeDeploySource, /assertSafeProductionDeploySource\(\)/);
  assert.match(safeDeploySource, /verify:critical/);
  assert.match(safeDeploySource, /restoreKnownProductionBuildSideEffects\(\);/);
  assert.match(safeDeploySource, /installVercelSharpLinuxOutput\(\);/);
  assert.match(safeDeploySource, /assertSafeProductionDeploySource\(\);\s*run\('Vercel productie-deploy'/);
  assert.match(
    safeDeploySource,
    /'deploy',\s*'--prebuilt',\s*'--archive=tgz',\s*'--prod',\s*'--yes'/
  );
  assert.match(safeDeploySource, /@img\/sharp-linux-x64/);
  assert.match(safeDeploySource, /@img\/sharp-libvips-linux-x64/);
  assert.match(safeDeploySource, /@img\/sharp-linux-arm64/);
  assert.match(safeDeploySource, /@img\/sharp-libvips-linux-arm64/);
  assert.match(safeDeploySource, /version: '0\.35\.3'/);
  assert.match(safeDeploySource, /version: '1\.3\.2'/);
  assert.match(safeDeploySource, /check:live-production-version/);
  assert.match(agentsSource, /Productie deployen mag alleen via `npm run deploy:production`/);
  assert.match(agentsSource, /check:live-production-version/);
  assert.match(agentsSource, /Elke push\/merge naar `main`/);
  assert.match(agentsSource, /allerlaatste actuele `origin\/main`/);
  assert.match(agentsSource, /Deploy nooit vanuit een oude lokale kopie/);
  assert.match(agentsSource, /recente live wijzigingen behouden blijven/);
  assert.match(agentsSource, /Backendmodules boven 1200 regels mogen standaard niet netto groeien/);
  assert.match(agentsSource, /## Instantly-leads toevoegen/);
  assert.match(agentsSource, /POST \/api\/outreach\/provider-upload/);
  assert.match(agentsSource, /Maak nooit handmatig een losse CSV/);
  assert.match(agentsSource, /minder dan X veilig mail-ready leads klaarstaan/);
  assert.match(agentsSource, /Zet eerst genoeg mail-ready leads klaar/);
  assert.match(agentsSource, /permanente `provider=instantly` recipient guards/);
  assert.match(agentsSource, /send_guard `entries` en `recipientEntries` nooit overschrijven/);
  assert.match(agentsSource, /vlak voor CSV-aanmaak moet opnieuw live/);
  assert.match(agentsSource, /provider-sync.*geen nieuwe leads toevoegen/);
  assert.match(agentsSource, /## Outbound duplicate-veiligheid/);
  assert.match(agentsSource, /softora_outbound_recipient_guards/);
  assert.match(agentsSource, /vóór SMTP `sendMail`/);
  assert.match(agentsSource, /vóór CSV-teruggave/);
  assert.match(agentsSource, /vóór Instantly `\/leads\/add`/);
  assert.match(agentsSource, /ontvanger-email, ontvanger-domein, company key en stabiel customer id/);
  assert.match(agentsSource, /## Softora coldmail dagtempo/);
  assert.match(agentsSource, /totale dagdoel 81/);
  assert.match(agentsSource, /verzendvenster is 07:00-22:00 Europe\/Amsterdam/);
  assert.match(agentsSource, /dag-slot pacing/);
  assert.match(agentsSource, /senderMinIntervalMinutes=60/);
  assert.match(agentsSource, /senderMaxIntervalMinutes=74/);
  assert.match(agentsSource, /9 dag-slots per mailbox/);
  assert.match(protocolSource, /Productie deploys lopen alleen via `npm run deploy:production`/);
  assert.match(protocolSource, /check:live-production-version/);
  assert.match(protocolSource, /Elke push\/merge naar `main`/);
  assert.match(protocolSource, /allerlaatste actuele `origin\/main`/);
  assert.match(protocolSource, /Oude lokale kopieen/);
  assert.match(protocolSource, /Recente live wijzigingen mogen niet verdwijnen/);
  assert.match(protocolSource, /Oversized backendmodules mogen standaard niet netto groeien/);
});

test('agent guardrails helpers recognize approved and high-risk paths', () => {
  assert.equal(isAllowedNewServerPath('server/services/new-service.js'), true);
  assert.equal(isAllowedNewServerPath('server/helpers/new-helper.js'), false);
  assert.equal(isBackendProductionPath('server/services/ui-state.js'), true);
  assert.equal(isBackendProductionPath('api/_app-handler.js'), true);
  assert.equal(isBackendProductionPath('lib/premium-users-store.js'), true);
  assert.equal(isBackendProductionPath('assets/coldcalling-dashboard.js'), false);
  assert.equal(isBackendProductionPath('server.js'), false);
  assert.equal(isFrontendProductionPath('premium-ai-coldmailing.html'), true);
  assert.equal(isFrontendProductionPath('assets/coldcalling-dashboard.js'), true);
  assert.equal(isFrontendProductionPath('server/services/ui-state.js'), false);
  assert.equal(isHighRiskPath('server/services/agenda-metadata.js'), true);
  assert.equal(isHighRiskPath('server/services/server-app-runtime.js'), true);
  assert.equal(isProtectedFrontendShellPath('assets/personnel-theme.js'), true);
  assert.equal(isProtectedFrontendShellPath('assets/coldcalling-dashboard.js'), false);
  assert.equal(isProtectedQualityGatePath('scripts/check-agent-guardrails.js'), true);
  assert.equal(isProtectedQualityGatePath('scripts/check-public-data-exposure.js'), true);
  assert.equal(isProtectedQualityGatePath('scripts/check-quality-lock.js'), true);
  assert.equal(isProtectedQualityGatePath('AGENTS.md'), true);
  assert.equal(isProtectedQualityGatePath('package.json'), true);
  assert.equal(isProtectedQualityGatePath('.github/workflows/repo-hygiene.yml'), true);
  assert.equal(isProtectedQualityGatePath('.github/workflows/live-production-version.yml'), true);
  assert.equal(isProtectedQualityGatePath('docs/quality-protocol.md'), true);
  assert.equal(isProtectedQualityGatePath('docs/repo-map.md'), true);
  assert.equal(isProtectedQualityGatePath('scripts/clean-local-artifacts.sh'), true);
  assert.equal(isProtectedQualityGatePath('scripts/export-runtime-backup.js'), false);
  assert.equal(isHighRiskPath('docs/repo-map.md'), false);
});


test('SEO growth gate changes preserve source-bound review checks and same-invocation cadence validation', () => {
  const reviewScript = readRepoFile('scripts/check-seo-machine-reviews.js');
  const selectionScript = readRepoFile('scripts/check-seo-machine-selection.js');
  const reviews = readRepoFile('server/services/seo-machine-experiment-reviews.js');
  assert.match(reviewScript, /validateExperimentReviewEvidence/);
  assert.match(reviewScript, /const report = readJson\(args.report\)/);
  assert.match(reviews, /deriveExperimentReviewMetrics\(report, dueReview.paths\)/);
  assert.match(selectionScript, /active\?\.invocationAt !== gateOptions.invocationAt/);
  assert.match(selectionScript, /controlPlane = active.gates.cadence.summary/);
});

test('SEO same-task migration preserves audited start and all publication gate requirements', () => {
  const state = require('../../scripts/seo-machine-automation-state');
  const script = readRepoFile('scripts/seo-machine-automation-state.js');
  assert.equal(typeof state.keepAutomationInSameThread, 'function');
  assert.equal(state.AUTOMATION_PROMPT_VERSION, 10);
  assert.deepEqual([...state.REQUIRED_PUBLISHED_RUN_GATES], [
    'cadence', 'reviews', 'selection', 'keywords', 'visuals', 'verify_critical', 'live_production', 'live_route',
  ]);
  assert.match(script, /THREAD_POLICY_MIGRATION_REQUIRED/);
  assert.match(script, /THREAD_ROTATION_DISABLED/);
  assert.match(script, /const audit = auditAutomationInstallation\(auditOptions\)/);
  assert.match(script, /validatePublishedRunGates\(receipt, receipt\)/);
});

test('SEO portfolio retains the Softora release gate while separating local academy outcomes', () => {
  const prompt = readRepoFile('docs/growth/seo-machine-prompt.md');
  const cli = readRepoFile('scripts/seo-machine-portfolio.js');
  const manifest = JSON.parse(readRepoFile('docs/growth/seo-machine-sites.json'));
  const { REQUIRED_PROMPT_MARKERS } = require('../../server/services/seo-machine-prompt-contract');
  assert.equal(manifest.sites.length, 10);
  assert.equal(manifest.sites.filter((site) => site.mode === 'local_prelaunch').length, 9);
  for (const marker of REQUIRED_PROMPT_MARKERS) assert.match(prompt, marker.pattern, marker.label);
  assert.match(cli, /binding\.lifecycle\.lastReceipt/);
  assert.match(cli, /portfolio\.verifyArtifacts/);
  assert.match(prompt, /finish-run closes only the Softora site/);
  assert.match(prompt, /One site's blocker must not stop the remaining sites/);
});

test('SEO reading navigation cannot weaken the contact-route quality gate', () => {
  const gates = readRepoFile('server/services/seo-machine-quality-gates.js');
  assert.match(gates, /isArticleSectionNavigation\(anchor, html\)/);
  assert.match(gates, /stripHtmlTags\(heading\[1\]\) === anchor.label/);
  assert.match(gates, /lead-cta-not-whatsapp/);
  assert.match(gates, /untracked-conversion-link/);
});

test('SEO experience and attribution changes preserve publication, source and contact requirements', () => {
  const state = require('../../scripts/seo-machine-automation-state');
  const liveScript = readRepoFile('scripts/check-seo-machine-live-route.js');
  const gateScript = readRepoFile('scripts/seo-machine-automation-state.js');
  const quality = readRepoFile('server/services/seo-machine-quality-gates.js');
  assert.equal(state.RUN_GATE_VERSION, 3);
  assert.match(liveScript, /validatePageExperience\(readSelectionEvidence/);
  assert.match(liveScript, /result.summary.pageExperience = pageExperience/);
  assert.match(gateScript, /gateVersion >= 3[\s\S]*validatePageExperienceReceipt/);
  assert.match(quality, /unsupported-human-review/);
  assert.match(quality, /missing-information-gain/);
  assert.match(quality, /missing-content-sources/);
  assert.match(quality, /missing-contextual-money-link/);
  assert.match(quality, /lead-cta-not-whatsapp/);
});
