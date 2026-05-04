#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const DEFAULT_DOMAIN = 'www.softora.nl';
const DEFAULT_PROJECT = 'softora-nl';
const DEFAULT_HEALTH_PATH = '/api/health/baseline';

function run(command, args, options = {}) {
  const env = options.env || process.env;
  const npxArgs = command === 'npx' && args[0] === 'vercel' ? ['--yes', ...args] : args;
  const finalArgs =
    command === 'npx' && args[0] === 'vercel' && env.VERCEL_TOKEN && !npxArgs.includes('--token')
      ? [...npxArgs, '--token', env.VERCEL_TOKEN]
      : npxArgs;
  const result = spawnSync(command, finalArgs, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  return {
    status: Number.isInteger(result.status) ? result.status : 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

function extractJsonObject(source) {
  const text = String(source || '');
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    return JSON.parse(text.slice(first, last + 1));
  } catch (_) {
    return null;
  }
}

function normalizeDeploymentHost(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/g, '');
}

function resolveDeploymentSha(deployment) {
  const meta = deployment && deployment.meta && typeof deployment.meta === 'object' ? deployment.meta : {};
  return String(meta.githubCommitSha || meta.gitCommitSha || '').trim();
}

function resolveDeploymentRef(deployment) {
  const meta = deployment && deployment.meta && typeof deployment.meta === 'object' ? deployment.meta : {};
  return String(meta.githubCommitRef || meta.gitCommitRef || '').trim();
}

function resolveHealthDeploymentSha(payload) {
  const deployment = payload && payload.deployment && typeof payload.deployment === 'object'
    ? payload.deployment
    : {};
  return String(deployment.commitSha || deployment.sha || '').trim();
}

function resolveHealthDeploymentRef(payload) {
  const deployment = payload && payload.deployment && typeof payload.deployment === 'object'
    ? payload.deployment
    : {};
  return String(deployment.commitRef || deployment.ref || '').trim();
}

function listLiveProductionVersionViolations(options = {}) {
  const domain = options.domain || DEFAULT_DOMAIN;
  const project = options.project || DEFAULT_PROJECT;
  const runner = options.runner || run;
  const healthUrl = options.healthUrl || `https://${domain}${DEFAULT_HEALTH_PATH}`;
  const violations = [];

  const fetch = runner('git', ['fetch', 'origin', 'main', '--quiet']);
  if (fetch.status !== 0) {
    violations.push('[live-production] Kon origin/main niet verversen; live versiecheck geblokkeerd.');
  }

  const mainRef = runner('git', ['rev-parse', '--verify', 'origin/main']);
  const expectedSha = mainRef.status === 0 ? String(mainRef.stdout || '').trim() : '';
  if (!expectedSha) {
    violations.push('[live-production] origin/main commit kon niet worden bepaald.');
  }

  const health = runner('curl', [
    '--fail',
    '--silent',
    '--show-error',
    '--max-time',
    '20',
    healthUrl,
  ]);
  const healthPayload = health.status === 0 ? extractJsonObject(health.stdout) : null;
  const healthSha = resolveHealthDeploymentSha(healthPayload);
  const healthRef = resolveHealthDeploymentRef(healthPayload);
  if (healthSha) {
    if (expectedSha && healthSha !== expectedSha) {
      return {
        ok: false,
        violations: [
          `[live-production] ${domain} meldt ${healthSha}, maar origin/main is ${expectedSha}. Productie wijkt af van main.`,
        ],
        expectedSha,
        liveSha: healthSha,
        liveRef: healthRef,
        liveHost: domain,
        method: 'health',
      };
    }
    return {
      ok: violations.length === 0,
      violations,
      expectedSha,
      liveSha: healthSha,
      liveRef: healthRef,
      liveHost: domain,
      method: 'health',
    };
  }

  const inspect = runner('npx', ['vercel', 'inspect', domain, '--format=json']);
  if (inspect.status !== 0) {
    violations.push(`[live-production] Kon live deployment voor ${domain} niet inspecteren.`);
  }

  const inspectedDeployment = extractJsonObject(inspect.stdout);
  const liveHost = normalizeDeploymentHost(inspectedDeployment && inspectedDeployment.url);
  if (!liveHost) {
    violations.push(`[live-production] Kon live deployment host voor ${domain} niet bepalen.`);
  }

  const list = runner('npx', ['vercel', 'ls', project, '--format=json']);
  if (list.status !== 0) {
    violations.push(`[live-production] Kon deploymentlijst voor ${project} niet ophalen.`);
  }

  const deploymentsPayload = extractJsonObject(list.stdout);
  const deployments = Array.isArray(deploymentsPayload && deploymentsPayload.deployments)
    ? deploymentsPayload.deployments
    : [];
  const liveDeployment = deployments.find((deployment) => {
    return normalizeDeploymentHost(deployment && deployment.url) === liveHost;
  });

  if (!liveDeployment) {
    violations.push(`[live-production] Live deployment ${liveHost || domain} staat niet in de recente Vercel lijst.`);
  }

  const liveSha = resolveDeploymentSha(liveDeployment);
  const liveRef = resolveDeploymentRef(liveDeployment);
  if (!liveSha) {
    violations.push('[live-production] Live deployment heeft geen Git commit metadata; productie niet betrouwbaar genoeg.');
  } else if (expectedSha && liveSha !== expectedSha) {
    violations.push(
      `[live-production] ${domain} draait op ${liveSha}, maar origin/main is ${expectedSha}. Productie wijkt af van main.`
    );
  }

  return {
    ok: violations.length === 0,
    violations,
    expectedSha,
    liveSha,
    liveRef,
    liveHost,
    method: 'vercel',
  };
}

function assertLiveProductionVersion(options = {}) {
  const result = listLiveProductionVersionViolations(options);
  if (!result.ok) {
    const error = new Error(result.violations.join('\n'));
    error.result = result;
    throw error;
  }
  return result;
}

function runCli() {
  try {
    const result = assertLiveProductionVersion();
    const refLabel = result.liveRef ? ` (${result.liveRef})` : '';
    console.log(`[live-production] ${DEFAULT_DOMAIN} draait exact op origin/main: ${result.liveSha}${refLabel}.`);
  } catch (error) {
    console.error(error.message || String(error));
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  assertLiveProductionVersion,
  extractJsonObject,
  listLiveProductionVersionViolations,
  normalizeDeploymentHost,
  resolveDeploymentRef,
  resolveDeploymentSha,
  resolveHealthDeploymentRef,
  resolveHealthDeploymentSha,
  run,
};
