#!/usr/bin/env node
const { spawnSync } = require('child_process');
const { assertSafeProductionDeploySource } = require('./guard-production-deploy-source');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

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
run('Vercel productieomgeving ophalen', npxCmd, ['vercel', 'pull', '--yes', '--environment=production']);
run('Vercel productie-build', npxCmd, ['vercel', 'build', '--prod']);
run('Vercel productie-deploy', npxCmd, ['vercel', 'deploy', '--prebuilt', '--prod', '--yes']);
