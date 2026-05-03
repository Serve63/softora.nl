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
    'rev-parse --verify HEAD': { status: 0, stdout: 'head-sha' },
    'merge-base --is-ancestor origin/main HEAD': { status: 0, stdout: '' },
    'branch -r --contains HEAD': { status: 0, stdout: 'origin/codex/safe-branch' },
    ...overrides,
  };
  return (args) => responses[args.join(' ')] || { status: 1, stdout: '', stderr: 'unexpected git call' };
}

test('production deploy guard accepts only clean pushed commits that contain origin/main', () => {
  const violations = listProductionDeploySourceViolations({ git: createGitStub() });

  assert.deepEqual(violations, []);
});

test('production deploy guard blocks dirty worktrees, stale branches and unpushed commits', () => {
  const violations = listProductionDeploySourceViolations({
    git: createGitStub({
      'status --porcelain': { status: 0, stdout: ' M premium-personeel-dashboard.html' },
      'merge-base --is-ancestor origin/main HEAD': { status: 1, stdout: '' },
      'branch -r --contains HEAD': { status: 0, stdout: '' },
    }),
  });

  assert.match(violations.join('\n'), /Werkmap is niet schoon/);
  assert.match(violations.join('\n'), /bevat niet alle commits van origin\/main/);
  assert.match(violations.join('\n'), /staat nog niet op origin/);
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
  assert.equal(packageJson.scripts['deploy:production'], 'node scripts/deploy-production-safe.js');
  assert.match(agents, /Productie deployen mag alleen via `npm run deploy:production`/);
  assert.match(protocol, /Productie deploys lopen alleen via `npm run deploy:production`/);
  assert.match(operations, /npm run check:production-deploy-source/);
  assert.match(operations, /npm run deploy:production/);
  assert.match(deployScript, /assertSafeProductionDeploySource\(\)/);
  assert.match(deployScript, /projectName:\s*'softora-nl'/);
  assert.match(deployScript, /projectId:\s*'prj_RkOUrkRTAdkGNE3gxVlhAvS9TQgl'/);
  assert.match(deployScript, /ensureExpectedVercelProjectLink\(\);/);
  assert.match(deployScript, /assertExpectedVercelProjectLink\(\);/);
  assert.match(deployScript, /verify:critical/);
  assert.match(deployScript, /deploy', '--prebuilt', '--prod', '--yes'/);
});
