#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');

const steps = [
  ['run', 'check:guardrails'],
  ['run', 'check:repo-hygiene'],
  ['run', 'check:public-data'],
  ['run', 'check:deps'],
  ['run', 'check:quality-lock'],
  ['run', 'test:contracts'],
  ['run', 'test:smoke'],
  ['run', 'test:postgres:mailbox-locks'],
  ['run', 'check:secrets'],
];

function resolveNpmCommand(args) {
  if (process.platform !== 'win32') {
    return { command: 'npm', args };
  }

  const npmExecPath = String(process.env.npm_execpath || '').trim();
  if (npmExecPath) {
    return { command: process.execPath, args: [npmExecPath, ...args] };
  }

  const npmCliPath = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return { command: process.execPath, args: [npmCliPath, ...args] };
}

for (const args of steps) {
  const label = `npm ${args.join(' ')}`;
  console.log(`\n[verify-critical] ${label}`);
  const npmCommand = resolveNpmCommand(args);
  const result = spawnSync(npmCommand.command, npmCommand.args, {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    console.error(`[verify-critical] ${label} kon niet starten: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log('\n[verify-critical] Kritieke checks zijn geslaagd.');
