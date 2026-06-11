const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  listProductionDeploySourceViolations,
} = require('../../scripts/guard-production-deploy-source');

const repoRoot = path.resolve(__dirname, '../..');

function createGitStub(overrides = {}) {
  const responses = {
    'rev-parse --is-inside-work-tree': { status: 0, stdout: 'true' },
    'status --porcelain': { status: 0, stdout: '' },
    'fetch origin main --quiet': { status: 0, stdout: '' },
    'rev-parse --verify origin/main': { status: 0, stdout: 'main-sha' },
    'rev-parse --verify HEAD': { status: 0, stdout: 'main-sha' },
    ...overrides,
  };
  return (args) => responses[args.join(' ')] || { status: 1, stdout: '', stderr: 'unexpected git call' };
}

test('production deploy guard accepts only clean checkouts exactly at origin/main', () => {
  const violations = listProductionDeploySourceViolations({ git: createGitStub() });

  assert.deepEqual(violations, []);
});

test('production deploy guard blocks dirty worktrees and branch commits outside origin/main', () => {
  const violations = listProductionDeploySourceViolations({
    git: createGitStub({
      'status --porcelain': { status: 0, stdout: ' M premium-personeel-dashboard.html' },
      'rev-parse --verify HEAD': { status: 0, stdout: 'feature-sha' },
    }),
  });

  assert.match(violations.join('\n'), /Werkmap is niet schoon/);
  assert.match(violations.join('\n'), /exact origin\/main/);
});

test('production deploy guard blocks when origin/main cannot be refreshed', () => {
  const violations = listProductionDeploySourceViolations({
    git: createGitStub({
      'fetch origin main --quiet': { status: 128, stdout: '', stderr: 'network unavailable' },
    }),
  });

  assert.match(violations.join('\n'), /Kon origin\/main niet verversen/);
});

test('production deploy scripts and docs force the safe deployment path', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const agents = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
  const protocol = fs.readFileSync(path.join(repoRoot, 'docs/quality-protocol.md'), 'utf8');
  const operations = fs.readFileSync(path.join(repoRoot, 'docs/operations-checklist.md'), 'utf8');
  const deployScript = fs.readFileSync(path.join(repoRoot, 'scripts/deploy-production-safe.js'), 'utf8');

  assert.equal(packageJson.scripts['check:production-deploy-source'], 'node scripts/guard-production-deploy-source.js');
  assert.equal(packageJson.scripts['check:live-production-version'], 'node scripts/check-live-production-version.js');
  assert.equal(packageJson.scripts['deploy:production'], 'node scripts/deploy-production-safe.js');
  assert.match(agents, /Productie deployen mag alleen via `npm run deploy:production`/);
  assert.match(agents, /check:live-production-version/);
  assert.match(protocol, /Productie deploys lopen alleen via `npm run deploy:production`/);
  assert.match(protocol, /check:live-production-version/);
  assert.match(operations, /npm run check:production-deploy-source/);
  assert.match(operations, /npm run check:live-production-version/);
  assert.match(operations, /npm run deploy:production/);
  assert.match(deployScript, /assertSafeProductionDeploySource\(\)/);
  assert.match(deployScript, /projectName:\s*'softora-nl'/);
  assert.match(deployScript, /projectId:\s*'prj_RkOUrkRTAdkGNE3gxVlhAvS9TQgl'/);
  assert.match(deployScript, /ensureExpectedVercelProjectLink\(\);/);
  assert.match(deployScript, /assertExpectedVercelProjectLink\(\);/);
  assert.match(deployScript, /verify:critical/);
  assert.match(deployScript, /restoreKnownProductionBuildSideEffects\(\);/);
  assert.match(deployScript, /installVercelSharpLinuxOutput\(\);/);
  assert.match(deployScript, /assertSafeProductionDeploySource\(\);\s*run\('Vercel productie-deploy'/);
  assert.match(deployScript, /@img\/sharp-linux-x64/);
  assert.match(deployScript, /@img\/sharp-libvips-linux-x64/);
  assert.match(deployScript, /@img\/sharp-linux-arm64/);
  assert.match(deployScript, /@img\/sharp-libvips-linux-arm64/);
  assert.match(deployScript, /deploy', '--prebuilt', '--prod', '--yes'/);
  assert.match(deployScript, /check:live-production-version/);
});
