const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPersistencePatch,
  parseEnvFile,
} = require('../../scripts/local-email-verification-worker');

test('worker bewaart een geldige controle precies 24 uur', () => {
  const now = new Date('2026-07-16T12:00:00.000Z');
  const patch = buildPersistencePatch({
    status: 'valid',
    reason: 'mailbox_confirmed',
    smtpCode: 250,
    smtpResponse: '250 recipient ok',
    mxHost: 'mx.example.com',
    catchAll: false,
  }, { attempt_count: 2 }, now);

  assert.equal(patch.status, 'valid');
  assert.equal(patch.valid_until, '2026-07-17T12:00:00.000Z');
  assert.equal(patch.retry_after, null);
  assert.equal(patch.attempt_count, 3);
});

test('worker houdt catch-all dicht en plant pas na 30 dagen een hercontrole', () => {
  const now = new Date('2026-07-16T12:00:00.000Z');
  const patch = buildPersistencePatch({
    status: 'unknown',
    reason: 'domain_accepts_all_recipients',
    catchAll: true,
  }, { attempt_count: 0 }, now);

  assert.equal(patch.status, 'unknown');
  assert.equal(patch.valid_until, null);
  assert.equal(patch.retry_after, '2026-08-15T12:00:00.000Z');
});

test('env-parser leest lokale sleutels zonder ze te loggen of extern op te slaan', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'softora-mailbox-env-'));
  const file = path.join(directory, '.env');
  fs.writeFileSync(file, 'SUPABASE_URL="https://example.supabase.co"\nSUPABASE_SERVICE_ROLE_KEY=secret # lokaal\n');
  try {
    assert.deepEqual(parseEnvFile(file), {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'secret',
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
