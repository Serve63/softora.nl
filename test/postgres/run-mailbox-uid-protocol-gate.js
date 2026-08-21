const crypto = require('node:crypto');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const adminUrlValue = String(process.env.MAILBOX_POSTGRES_ADMIN_URL || '').trim();
if (!adminUrlValue) {
  throw new Error('MAILBOX_POSTGRES_ADMIN_URL ontbreekt; geef een lokale PostgreSQL-admin-URL op.');
}
const adminUrl = new URL(adminUrlValue);
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
if (!['postgres:', 'postgresql:'].includes(adminUrl.protocol) || !localHosts.has(adminUrl.hostname)) {
  throw new Error('Weiger tijdelijke UID-protocoltestdatabase op een niet-lokale PostgreSQL-host.');
}

const databaseName = `softora_mailbox_uid_protocol_test_${process.pid}_${crypto.randomBytes(5).toString('hex')}`;
const quotedDatabase = `"${databaseName.replaceAll('"', '""')}"`;
const testUrl = new URL(adminUrl);
testUrl.pathname = `/${databaseName}`;
const testFile = path.resolve(__dirname, 'mailbox-uid-protocol-gate.postgres.test.js');
const admin = new Client({ connectionString: adminUrl.toString() });
let created = false;

async function runTest() {
  await admin.connect();
  await admin.query(`create database ${quotedDatabase}`);
  created = true;
  process.stdout.write(`Tijdelijke UID-protocoltestdatabase aangemaakt: ${databaseName}\n`);
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', testFile], {
      stdio: 'inherit',
      env: {
        ...process.env,
        MAILBOX_POSTGRES_TEST_URL: testUrl.toString(),
        MAILBOX_POSTGRES_TEST_ALLOW_DESTRUCTIVE: '1',
      },
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(signal ? 1 : Number(code) || 0));
  });
  if (exitCode !== 0) process.exitCode = exitCode;
}

runTest().catch((error) => {
  process.exitCode = 1;
  process.stderr.write(`${error?.stack || error}\n`);
}).finally(async () => {
  if (created) {
    await admin.query(
      'select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity where datname=$1 and pid<>pg_catalog.pg_backend_pid()',
      [databaseName]
    ).catch(() => null);
    await admin.query(`drop database if exists ${quotedDatabase}`).catch((error) => {
      process.exitCode = 1;
      process.stderr.write(`Tijdelijke database kon niet worden verwijderd: ${error?.message || error}\n`);
    });
    process.stdout.write(`Tijdelijke UID-protocoltestdatabase verwijderd: ${databaseName}\n`);
  }
  await admin.end().catch(() => null);
});
