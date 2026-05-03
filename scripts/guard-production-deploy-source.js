#!/usr/bin/env node
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: Number.isInteger(result.status) ? result.status : 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

function listProductionDeploySourceViolations(options = {}) {
  const cwd = options.cwd || repoRoot;
  const git = options.git || ((args) => runGit(args, { cwd }));
  const violations = [];

  const repoCheck = git(['rev-parse', '--is-inside-work-tree']);
  if (repoCheck.status !== 0 || repoCheck.stdout !== 'true') {
    return ['[production-deploy] Geen git werkmap gevonden; productie-deploy geblokkeerd.'];
  }

  const status = git(['status', '--porcelain']);
  if (status.status !== 0) {
    violations.push('[production-deploy] Kon git status niet lezen; productie-deploy geblokkeerd.');
  } else if (status.stdout) {
    violations.push('[production-deploy] Werkmap is niet schoon. Commit/push eerst of gebruik een schone worktree.');
  }

  const fetch = git(['fetch', 'origin', 'main', '--quiet']);
  if (fetch.status !== 0) {
    violations.push('[production-deploy] Kon origin/main niet verversen; productie-deploy geblokkeerd.');
  }

  const mainRef = git(['rev-parse', '--verify', 'origin/main']);
  if (mainRef.status !== 0) {
    violations.push('[production-deploy] origin/main bestaat lokaal niet; productie-deploy geblokkeerd.');
  }

  const headRef = git(['rev-parse', '--verify', 'HEAD']);
  if (headRef.status !== 0) {
    violations.push('[production-deploy] HEAD bestaat niet; productie-deploy geblokkeerd.');
  }

  if (mainRef.status === 0 && headRef.status === 0 && mainRef.stdout !== headRef.stdout) {
    violations.push(
      '[production-deploy] Productie mag alleen vanaf exact origin/main worden gedeployed. Merge eerst via PR naar main en deploy daarna opnieuw vanuit origin/main.'
    );
  }

  return violations;
}

function assertSafeProductionDeploySource(options = {}) {
  const violations = listProductionDeploySourceViolations(options);
  if (violations.length > 0) {
    const message = violations.join('\n');
    const error = new Error(message);
    error.violations = violations;
    throw error;
  }
}

function runCli() {
  try {
    assertSafeProductionDeploySource();
    console.log('[production-deploy] Bron is veilig: schoon en exact gelijk aan origin/main.');
  } catch (error) {
    console.error(error.message || String(error));
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  assertSafeProductionDeploySource,
  listProductionDeploySourceViolations,
  runGit,
};
