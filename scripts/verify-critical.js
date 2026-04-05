#!/usr/bin/env node
const { spawnSync } = require('child_process');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const steps = [
  ['run', 'test:contracts'],
  ['run', 'test:smoke'],
  ['run', 'check:secrets'],
];

for (const args of steps) {
  const label = `npm ${args.join(' ')}`;
  console.log(`\n[verify-critical] ${label}`);
  const result = spawnSync(npmCmd, args, {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log('\n[verify-critical] Kritieke checks zijn geslaagd.');
