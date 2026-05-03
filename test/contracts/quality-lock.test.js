const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  PREMIUM_SIDEBAR_THEME_VERSION,
  listQualityLockViolations,
} = require('../../scripts/check-quality-lock');

const repoRoot = path.resolve(__dirname, '../..');

function makeReadFile(fileMap) {
  return (filePath) => fileMap[filePath] || '';
}

test('quality lock keeps the current repository baseline green', () => {
  assert.doesNotThrow(() => {
    const violations = listQualityLockViolations();
    assert.deepEqual(violations, []);
  });
});

test('quality lock blocks CI bypasses and static test weakening', () => {
  const trackedFiles = [
    'AGENTS.md',
    '.github/pull_request_template.md',
    '.github/workflows/verify-critical.yml',
    '.github/workflows/agent-guardrails.yml',
    '.github/workflows/repo-hygiene.yml',
    'docs/quality-protocol.md',
    'docs/operations-checklist.md',
    'docs/repo-map.md',
    'package.json',
    'scripts/check-agent-guardrails.js',
    'scripts/check-quality-lock.js',
    'scripts/check-repo-hygiene.sh',
    'scripts/deploy-production-safe.js',
    'scripts/guard-production-deploy-source.js',
    'scripts/check-live-production-version.js',
    'scripts/verify-critical.js',
    'test/contracts/production-live-version-guard.test.js',
    'test/contracts/production-deploy-guard.test.js',
    'test/contracts/example.test.js',
    'premium-personeel-dashboard.html',
  ];
  const fileMap = {
    'package.json': JSON.stringify({
      scripts: {
        'check:guardrails': 'node scripts/check-agent-guardrails.js',
        'check:repo-hygiene': 'bash scripts/check-repo-hygiene.sh',
        'check:quality-lock': 'node scripts/check-quality-lock.js',
        'check:production-deploy-source': 'node scripts/guard-production-deploy-source.js',
        'check:live-production-version': 'node scripts/check-live-production-version.js',
        'deploy:production': 'node scripts/deploy-production-safe.js',
        'verify:critical': 'node scripts/verify-critical.js',
      },
    }),
    'scripts/deploy-production-safe.js': [
      'assertSafeProductionDeploySource()',
      "projectName: 'softora-nl'",
      "projectId: 'prj_RkOUrkRTAdkGNE3gxVlhAvS9TQgl'",
      'check:live-production-version',
    ].join('\n'),
    'scripts/check-live-production-version.js': [
      'vercel',
      'ls',
      'origin/main',
      'githubCommitSha',
      'gitCommitSha',
    ].join('\n'),
    'scripts/guard-production-deploy-source.js': [
      'if (mainRef.status === 0 && headRef.status === 0 && mainRef.stdout !== headRef.stdout) {}',
      'exact origin/main',
    ].join('\n'),
    'scripts/verify-critical.js': [
      "['run', 'check:guardrails'],",
      "['run', 'check:repo-hygiene'],",
      "['run', 'check:quality-lock'],",
      "['run', 'test:contracts'],",
      "['run', 'test:smoke'],",
      "['run', 'check:secrets'],",
    ].join('\n'),
    '.github/workflows/verify-critical.yml': [
      'steps:',
      '  - run: npm run verify:critical || true',
      '    continue-on-error: true',
      '    env:',
      '      ALLOW_UNTESTED_CHANGES: 1',
    ].join('\n'),
    '.github/workflows/agent-guardrails.yml': 'run: npm run check:guardrails',
    '.github/workflows/repo-hygiene.yml': 'run: bash scripts/check-repo-hygiene.sh',
    'test/contracts/example.test.js': 'test' + '.only("focus", () => {});',
    'premium-personeel-dashboard.html': [
      `<link rel="stylesheet" href="assets/personnel-theme.css?v=${PREMIUM_SIDEBAR_THEME_VERSION}">`,
      `<script src="assets/personnel-theme.js?v=${PREMIUM_SIDEBAR_THEME_VERSION}" defer></script>`,
    ].join('\n'),
    '.github/pull_request_template.md': [
      'npm run verify:critical',
      'npm run check:guardrails',
      'rollback',
    ].join('\n'),
  };

  const violations = listQualityLockViolations({
    trackedFiles,
    readFile: makeReadFile(fileMap),
  });

  assert.match(violations.join('\n'), /continue-on-error/i);
  assert.match(violations.join('\n'), /guardrail-bypass env var/i);
  assert.match(violations.join('\n'), /omzeilen/i);
  assert.match(violations.join('\n'), /test-verzwakking/i);
});

test('quality lock keeps premium sidebar theme asset versions in sync', () => {
  const trackedFiles = [
    'AGENTS.md',
    '.github/pull_request_template.md',
    '.github/workflows/verify-critical.yml',
    '.github/workflows/agent-guardrails.yml',
    '.github/workflows/repo-hygiene.yml',
    'docs/quality-protocol.md',
    'docs/operations-checklist.md',
    'docs/repo-map.md',
    'package.json',
    'scripts/check-agent-guardrails.js',
    'scripts/check-quality-lock.js',
    'scripts/check-repo-hygiene.sh',
    'scripts/deploy-production-safe.js',
    'scripts/guard-production-deploy-source.js',
    'scripts/check-live-production-version.js',
    'scripts/verify-critical.js',
    'test/contracts/production-live-version-guard.test.js',
    'test/contracts/production-deploy-guard.test.js',
    'premium-personeel-dashboard.html',
  ];
  const fileMap = {
    'package.json': JSON.stringify({
      scripts: {
        'check:guardrails': 'node scripts/check-agent-guardrails.js',
        'check:repo-hygiene': 'bash scripts/check-repo-hygiene.sh',
        'check:quality-lock': 'node scripts/check-quality-lock.js',
        'check:production-deploy-source': 'node scripts/guard-production-deploy-source.js',
        'check:live-production-version': 'node scripts/check-live-production-version.js',
        'deploy:production': 'node scripts/deploy-production-safe.js',
        'verify:critical': 'node scripts/verify-critical.js',
      },
    }),
    'scripts/deploy-production-safe.js': [
      'assertSafeProductionDeploySource()',
      "projectName: 'softora-nl'",
      "projectId: 'prj_RkOUrkRTAdkGNE3gxVlhAvS9TQgl'",
      'check:live-production-version',
    ].join('\n'),
    'scripts/check-live-production-version.js': [
      'vercel',
      'ls',
      'origin/main',
      'githubCommitSha',
      'gitCommitSha',
    ].join('\n'),
    'scripts/guard-production-deploy-source.js': [
      'if (mainRef.status === 0 && headRef.status === 0 && mainRef.stdout !== headRef.stdout) {}',
      'exact origin/main',
    ].join('\n'),
    'scripts/verify-critical.js': [
      "['run', 'check:guardrails'],",
      "['run', 'check:repo-hygiene'],",
      "['run', 'check:quality-lock'],",
      "['run', 'test:contracts'],",
      "['run', 'test:smoke'],",
      "['run', 'check:secrets'],",
    ].join('\n'),
    '.github/workflows/verify-critical.yml': 'run: npm run verify:critical',
    '.github/workflows/agent-guardrails.yml': 'run: npm run check:guardrails',
    '.github/workflows/repo-hygiene.yml': 'run: bash scripts/check-repo-hygiene.sh',
    'premium-personeel-dashboard.html': [
      '<link rel="stylesheet" href="assets/personnel-theme.css?v=old">',
      '<script src="assets/personnel-theme.js?v=different" defer></script>',
    ].join('\n'),
    '.github/pull_request_template.md': [
      'npm run verify:critical',
      'npm run check:guardrails',
      'rollback',
    ].join('\n'),
  };

  const violations = listQualityLockViolations({
    trackedFiles,
    readFile: makeReadFile(fileMap),
  });

  assert.match(violations.join('\n'), /verschillende CSS\/JS personnel-theme versies/i);
  assert.match(violations.join('\n'), /verwacht 20260502a/i);
});

test('quality lock remains part of verify critical and the PR checklist', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const verifyCriticalSource = fs.readFileSync(path.join(repoRoot, 'scripts/verify-critical.js'), 'utf8');
  const pullRequestTemplate = fs.readFileSync(
    path.join(repoRoot, '.github/pull_request_template.md'),
    'utf8'
  );

  assert.equal(packageJson.scripts['check:quality-lock'], 'node scripts/check-quality-lock.js');
  assert.equal(
    packageJson.scripts['check:production-deploy-source'],
    'node scripts/guard-production-deploy-source.js'
  );
  assert.equal(
    packageJson.scripts['check:live-production-version'],
    'node scripts/check-live-production-version.js'
  );
  assert.equal(packageJson.scripts['deploy:production'], 'node scripts/deploy-production-safe.js');
  assert.match(verifyCriticalSource, /\['run', 'check:quality-lock'\]/);
  assert.match(pullRequestTemplate, /npm run verify:critical/);
  assert.match(pullRequestTemplate, /npm run check:guardrails/);
  assert.match(pullRequestTemplate, /rollback/i);
});
