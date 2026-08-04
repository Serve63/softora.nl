const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createPasswordRegisterOwnerPolicy } = require('../../server/security/password-register-access');
const {
  PASSWORD_REGISTER_ENCRYPTED_KEY,
  validatePasswordRegisterEnvelope,
  validatePasswordRegisterValues,
} = require('../../server/schemas/password-register-vault');

const repoRoot = path.resolve(__dirname, '../..');

function createVaultEnvelope(version = 2, overrides = {}) {
  return JSON.stringify({
    version,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: version === 1 ? 210000 : 600000,
    salt: Buffer.alloc(16, 1).toString('base64'),
    iv: Buffer.alloc(12, 2).toString('base64'),
    ciphertext: Buffer.alloc(32, 3).toString('base64'),
    ...overrides,
  });
}

test('password register owner policy fails closed and accepts only configured identities', () => {
  assert.equal(createPasswordRegisterOwnerPolicy({}).getAccessDecision({ userId: 'usr_primary' }).statusCode, 503);
  const byId = createPasswordRegisterOwnerPolicy({
    PREMIUM_PASSWORD_REGISTER_OWNER_USER_IDS: 'usr_primary',
  });
  assert.equal(byId.getAccessDecision({ userId: 'usr_primary' }).ok, true);
  assert.equal(byId.getAccessDecision({ userId: 'usr_secondary' }).statusCode, 403);
  const byEmail = createPasswordRegisterOwnerPolicy({
    PREMIUM_PASSWORD_REGISTER_OWNER_EMAILS: 'owner@example.test',
  });
  assert.equal(byEmail.getAccessDecision({ email: 'OWNER@example.test' }).ok, true);
  assert.equal(byEmail.getAccessDecision({ email: 'admin@example.test' }).statusCode, 403);
});

test('password register allows legacy reads but only exact current encrypted writes', () => {
  const legacy = createVaultEnvelope(1);
  const current = createVaultEnvelope(2);
  assert.equal(validatePasswordRegisterEnvelope(legacy).ok, true);
  assert.equal(validatePasswordRegisterEnvelope(current).ok, true);
  assert.equal(validatePasswordRegisterValues(
    { [PASSWORD_REGISTER_ENCRYPTED_KEY]: legacy },
    { requireEncrypted: true, requireCurrentVersion: true }
  ).ok, false);
  assert.equal(validatePasswordRegisterValues(
    { [PASSWORD_REGISTER_ENCRYPTED_KEY]: current },
    { requireEncrypted: true, requireCurrentVersion: true }
  ).ok, true);
  assert.equal(validatePasswordRegisterValues({ entries_json: '[{"password":"secret"}]' }).ok, false);
  assert.equal(validatePasswordRegisterValues({
    [PASSWORD_REGISTER_ENCRYPTED_KEY]: current,
    arbitrary: 'blocked',
  }).ok, false);
  assert.equal(validatePasswordRegisterEnvelope(
    createVaultEnvelope(2, { salt: Buffer.alloc(15).toString('base64') })
  ).ok, false);
  assert.equal(validatePasswordRegisterEnvelope(createVaultEnvelope(2, { iterations: 210000 })).ok, false);
  assert.equal(validatePasswordRegisterEnvelope(createVaultEnvelope(2, { algorithm: 'AES-CBC' })).ok, false);
});

test('runtime-state schema and migration force RLS with service-role-only table privileges', () => {
  const schema = fs.readFileSync(path.join(repoRoot, 'supabase/runtime-state-schema.sql'), 'utf8');
  const migration = fs.readFileSync(
    path.join(repoRoot, 'supabase/migrations/20260804153217_harden_runtime_state_rls.sql'),
    'utf8'
  );
  for (const sql of [schema, migration]) {
    assert.match(sql, /alter table public\.softora_runtime_state enable row level security;/i);
    assert.match(sql, /alter table public\.softora_runtime_state force row level security;/i);
    assert.match(sql, /add column if not exists revision bigint not null default 0;/i);
    assert.match(sql, /constraint softora_runtime_state_revision_nonnegative[\s\S]*check \(revision >= 0\)/i);
    assert.match(sql, /validate constraint softora_runtime_state_revision_nonnegative;/i);
    assert.match(sql, /revoke all privileges on table public\.softora_runtime_state from public, anon, authenticated, service_role;/i);
    assert.match(sql, /grant select, insert, update, delete on table public\.softora_runtime_state to service_role;/i);
    assert.match(sql, /create policy softora_runtime_state_service_role_all[\s\S]*to service_role/i);
    assert.doesNotMatch(sql, /\bto\s+(anon|authenticated)\b/i);
  }
  assert.match(migration, /drop policy if exists softora_runtime_state_service_role_all/i);
  assert.doesNotMatch(migration, /from pg_policies|existing_policy|execute format/i);
});
