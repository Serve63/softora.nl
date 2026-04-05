#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const backupsDir = path.join(repoRoot, 'backups');
const serverModule = require(path.join(repoRoot, 'server.js'));

if (typeof serverModule.buildRuntimeBackupForOps !== 'function') {
  console.error('Runtime backup helper niet gevonden in server.js.');
  process.exit(1);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputArg = String(process.argv[2] || '').trim();
const outputFile = outputArg
  ? path.resolve(repoRoot, outputArg)
  : path.join(backupsDir, `runtime-backup-${timestamp}.json`);

fs.mkdirSync(path.dirname(outputFile), { recursive: true });

const payload = serverModule.buildRuntimeBackupForOps({
  metadata: {
    source: 'local-backup-script',
    cwd: repoRoot,
  },
});

fs.writeFileSync(outputFile, JSON.stringify(payload, null, 2));
console.log(`Runtime-backup opgeslagen naar ${path.relative(repoRoot, outputFile) || outputFile}`);
