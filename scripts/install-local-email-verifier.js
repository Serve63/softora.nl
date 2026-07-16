#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LABEL = 'nl.softora.mailbox-validator';

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function runLaunchctl(args, allowFailure = false) {
  const result = spawnSync('launchctl', args, { encoding: 'utf8' });
  if (!allowFailure && result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `launchctl ${args.join(' ')} faalde.`);
  }
  return result;
}

function main() {
  if (process.platform !== 'darwin') throw new Error('Deze lokale worker-installer is alleen voor macOS.');
  const home = os.homedir();
  const sourceRoot = path.resolve(__dirname, '..');
  const runtimeRoot = path.join(home, '.softora', 'mailbox-validator');
  const runtimeScripts = path.join(runtimeRoot, 'scripts');
  const runtimeServices = path.join(runtimeRoot, 'server', 'services');
  const launchAgents = path.join(home, 'Library', 'LaunchAgents');
  const plistPath = path.join(launchAgents, `${LABEL}.plist`);
  const envFile = path.join(home, 'Desktop', 'softora.nl-main', '.env');
  const workerPath = path.join(runtimeScripts, 'local-email-verification-worker.js');
  const validatorPath = path.join(runtimeServices, 'smtp-mailbox-validator.js');

  if (!fs.existsSync(envFile)) throw new Error(`Omgevingsbestand ontbreekt: ${envFile}`);
  fs.mkdirSync(runtimeScripts, { recursive: true, mode: 0o700 });
  fs.mkdirSync(runtimeServices, { recursive: true, mode: 0o700 });
  fs.mkdirSync(launchAgents, { recursive: true });
  fs.copyFileSync(path.join(sourceRoot, 'scripts', 'local-email-verification-worker.js'), workerPath);
  fs.copyFileSync(path.join(sourceRoot, 'server', 'services', 'smtp-mailbox-validator.js'), validatorPath);
  fs.chmodSync(workerPath, 0o700);
  fs.chmodSync(validatorPath, 0o600);

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(process.execPath)}</string>
    <string>${xmlEscape(workerPath)}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xmlEscape(path.join(runtimeRoot, 'worker.log'))}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(path.join(runtimeRoot, 'worker-error.log'))}</string>
</dict>
</plist>
`;
  fs.writeFileSync(plistPath, plist, { mode: 0o600 });

  const domain = `gui/${process.getuid()}`;
  runLaunchctl(['bootout', domain, plistPath], true);
  runLaunchctl(['bootstrap', domain, plistPath]);
  runLaunchctl(['kickstart', '-k', `${domain}/${LABEL}`]);
  console.log(`[MailboxVerifier] actief via ${plistPath}`);
}

main();
