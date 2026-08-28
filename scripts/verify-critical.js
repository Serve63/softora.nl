#!/usr/bin/env node
const { spawnSync } = require('child_process');
const {
  extractRunGateCliOptions,
  recordAutomationRunGateFromCli,
} = require('./seo-machine-automation-state');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const steps = [
  ['run', 'check:guardrails'],
  ['run', 'check:repo-hygiene'],
  ['run', 'check:public-data'],
  ['run', 'check:deps'],
  ['run', 'check:quality-lock'],
  ['run', 'test:contracts'],
  ['run', 'test:smoke'],
  ['run', 'test:postgres:mailbox-locks'],
  ['run', 'test:postgres:mailbox-uid-protocol-gate'],
  ['run', 'test:postgres:mailbox-uid-generation-v2'],
  ['run', 'check:secrets'],
];
const gateOptions = extractRunGateCliOptions(process.argv.slice(2));
if (gateOptions.remaining.length) throw new Error(`Onbekende argumenten: ${gateOptions.remaining.join(' ')}`);

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
const runGate = recordAutomationRunGateFromCli({
  gateOptions,
  gate: 'verify_critical',
  details: {
    status: 'ready',
    steps: steps.map((args) => `npm ${args.join(' ')}`),
  },
});
if (runGate) console.log(`[verify-critical] run-gate=${runGate.resultDigest}`);
