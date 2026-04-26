const test = require('node:test');
const assert = require('node:assert/strict');
const {
  countAddedInlineScriptLines,
  buildGuardrailViolations,
  countAddedServerJsFunctions,
  countDiffLines,
  isAllowedNewServerPath,
  isFrontendProductionPath,
  isHighRiskPath,
  isProtectedFrontendShellPath,
  isProtectedQualityGatePath,
  listAddedBrowserStorageApis,
  listAddedTestWeakeningPatterns,
} = require('../../scripts/lib/agent-guardrails-core');

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

test('agent guardrails require targeted tests for protected quality gates and sidebar shell', () => {
  const violations = buildGuardrailViolations({
    changedFiles: ['assets/personnel-theme.css', 'scripts/check-agent-guardrails.js'],
    addedFiles: [],
    changedTests: ['test/contracts/example.test.js'],
    highRiskFiles: [],
    behaviorFiles: ['assets/personnel-theme.css', 'scripts/check-agent-guardrails.js'],
    protectedFrontendShellFiles: ['assets/personnel-theme.css'],
    protectedQualityGateFiles: ['scripts/check-agent-guardrails.js'],
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
      'test/contracts/premium-sidebar-shell-scope.test.js',
      'test/contracts/agent-guardrails.test.js',
    ],
    addedFiles: [],
    changedTests: [
      'test/contracts/premium-sidebar-shell-scope.test.js',
      'test/contracts/agent-guardrails.test.js',
    ],
    highRiskFiles: [],
    behaviorFiles: ['assets/personnel-theme.css', 'scripts/check-agent-guardrails.js'],
    protectedFrontendShellFiles: ['assets/personnel-theme.css'],
    protectedQualityGateFiles: ['scripts/check-agent-guardrails.js'],
    newestBackupAgeMs: 5 * 60 * 1000,
    isCi: false,
    serverJsLineCount: 7200,
    serverJsNetGrowth: 0,
  });

  assert.equal(covered.length, 0);
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
  assert.equal(isProtectedQualityGatePath('AGENTS.md'), true);
  assert.equal(isProtectedQualityGatePath('.github/workflows/repo-hygiene.yml'), true);
  assert.equal(isProtectedQualityGatePath('docs/quality-protocol.md'), true);
  assert.equal(isProtectedQualityGatePath('scripts/export-runtime-backup.js'), false);
  assert.equal(isHighRiskPath('docs/repo-map.md'), false);
});
