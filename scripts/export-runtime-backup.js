#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const backupsDir = path.join(repoRoot, 'backups');
const serverModule = require(path.join(repoRoot, 'server.js'));
const {
  attachPasswordRegisterVaultBackup,
} = require(path.join(repoRoot, 'server/services/password-register-backup'));

if (typeof serverModule.buildRuntimeBackupForOps !== 'function') {
  console.error('Runtime backup helper niet gevonden in server.js.');
  process.exit(1);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputArg = String(process.argv[2] || '').trim();
const outputFile = outputArg
  ? path.resolve(repoRoot, outputArg)
  : path.join(backupsDir, `runtime-backup-${timestamp}.json`);

async function main() {
  fs.mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(backupsDir, 0o700);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true, mode: 0o700 });

  const payload = serverModule.buildRuntimeBackupForOps({
    metadata: {
      source: 'local-backup-script',
      cwd: repoRoot,
    },
  });
  await attachPasswordRegisterVaultBackup(payload, {
    supabaseUrl: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    stateTable: process.env.SUPABASE_STATE_TABLE || 'softora_runtime_state',
  });

  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW;
  const outputFd = fs.openSync(outputFile, flags, 0o600);
  try {
    fs.fchmodSync(outputFd, 0o600);
    fs.writeFileSync(outputFd, JSON.stringify(payload, null, 2));
  } finally {
    fs.closeSync(outputFd);
  }
  const vaultBackup = payload.snapshot?.protectedUiState?.premium_password_register;
  if (!vaultBackup?.included) {
    console.warn('Let op: kluisbackup niet opgenomen omdat lokale Supabase serverconfiguratie ontbreekt.');
  }
  console.log(`Runtime-backup opgeslagen naar ${path.relative(repoRoot, outputFile) || outputFile}`);
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exitCode = 1;
});
