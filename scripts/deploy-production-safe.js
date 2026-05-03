#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { assertSafeProductionDeploySource } = require('./guard-production-deploy-source');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const EXPECTED_VERCEL_PROJECT = Object.freeze({
  projectId: 'prj_RkOUrkRTAdkGNE3gxVlhAvS9TQgl',
  orgId: 'team_LFd5fMyc9TMAoLasBzDgdhuT',
  projectName: 'softora-nl',
});
const vercelProjectPath = path.join(process.cwd(), '.vercel', 'project.json');

function readVercelProjectLink() {
  try {
    return JSON.parse(fs.readFileSync(vercelProjectPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function isExpectedVercelProjectLink(link) {
  return Boolean(
    link &&
    link.projectId === EXPECTED_VERCEL_PROJECT.projectId &&
    link.orgId === EXPECTED_VERCEL_PROJECT.orgId &&
    link.projectName === EXPECTED_VERCEL_PROJECT.projectName
  );
}

function ensureExpectedVercelProjectLink() {
  if (isExpectedVercelProjectLink(readVercelProjectLink())) return;
  fs.mkdirSync(path.dirname(vercelProjectPath), { recursive: true });
  fs.writeFileSync(vercelProjectPath, `${JSON.stringify(EXPECTED_VERCEL_PROJECT, null, 2)}\n`);
  console.log(`[production-deploy] Vercel projectlink gezet naar ${EXPECTED_VERCEL_PROJECT.projectName}.`);
}

function assertExpectedVercelProjectLink() {
  if (isExpectedVercelProjectLink(readVercelProjectLink())) return;
  console.error(`[production-deploy] Verkeerde Vercel projectlink; verwacht ${EXPECTED_VERCEL_PROJECT.projectName}.`);
  process.exit(1);
}

function run(label, command, args) {
  console.log(`\n[production-deploy] ${label}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

try {
  assertSafeProductionDeploySource();
  console.log('[production-deploy] Bron is veilig: schoon, gepusht en bovenop origin/main.');
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}

run('kritieke checks', npmCmd, ['run', 'verify:critical']);
ensureExpectedVercelProjectLink();
run('Vercel productieomgeving ophalen', npxCmd, ['vercel', 'pull', '--yes', '--environment=production']);
assertExpectedVercelProjectLink();
run('Vercel productie-build', npxCmd, ['vercel', 'build', '--prod']);
run('Vercel productie-deploy', npxCmd, ['vercel', 'deploy', '--prebuilt', '--prod', '--yes']);
