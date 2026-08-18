const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
  __dirname,
  '../../supabase/migrations/20260810100500_harden_mailbox_sync_global_locks.sql'
);
const schemaPath = path.resolve(__dirname, '../../supabase/data-ops-schema.sql');
const probePath = path.resolve(__dirname, '../../supabase/mailbox-sync-global-lock-probe.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
const schema = fs.readFileSync(schemaPath, 'utf8');
const probe = fs.readFileSync(probePath, 'utf8');
const postgresTest = fs.readFileSync(path.resolve(
  __dirname,
  '../postgres/mailbox-campaign-lock-order.postgres.test.js'
), 'utf8');

function hasFunctionPrivilegeStatement(source, action, signature) {
  const pattern = new RegExp(
    `${action} on function public\\.${signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\r?\\n  ` +
      (action === 'grant execute' ? 'to service_role;' : 'from public, anon, authenticated;')
  );
  return pattern.test(source);
}

function lockHardeningBlock(source) {
  const match = source.match(
    /-- mailbox-sync-lock-hardening:start[\s\S]*?-- mailbox-sync-lock-hardening:end/
  );
  assert.ok(match, 'mailbox sync lock-hardeningblok ontbreekt');
  return match[0];
}

test('deploymigratie en data-ops-schema bevatten exact dezelfde lock-hardening', () => {
  assert.equal(lockHardeningBlock(schema), lockHardeningBlock(migration));
  assert.match(migration, /create or replace function public\.softora_lock_mailbox_sync_capacity\(\)/);
  assert.match(migration, /create or replace function public\.softora_guard_mailbox_sync_lock\(\)/);
  assert.match(migration, /create or replace function public\.softora_claim_mailbox_sync_lock\(/);
  assert.match(migration, /create trigger softora_mailbox_sync_lock_guard/);
});

test('RPC en mixed-rollout trigger serialiseren dezelfde globale max-drie beslissing', () => {
  assert.equal((migration.match(/pg_advisory_xact_lock\(824031, 3\)/g) || []).length, 2);
  assert.equal((migration.match(/v_active_count >= 3/g) || []).length, 2);
  assert.match(
    migration,
    /create trigger softora_mailbox_sync_capacity_lock[\s\S]*before insert or update or delete[\s\S]*for each statement execute function public\.softora_lock_mailbox_sync_capacity\(\)/
  );
  assert.match(
    migration,
    /before insert or update of sync_key, account_email, folder, status, lock_token, lock_expires_at[\s\S]*on public\.softora_mailbox_sync_state/
  );
  assert.match(
    migration,
    /old\.lock_expires_at > clock_timestamp\(\)[\s\S]*btrim\(old\.lock_token\) is distinct from v_lock_token[\s\S]*MAILBOX_SYNC_ACTIVE_LOCK/
  );
  assert.match(
    migration,
    /active_sync\.lock_expires_at > clock_timestamp\(\)[\s\S]*active_sync\.sync_key <> v_sync_key/
  );
  assert.doesNotMatch(migration, /sync_claim_key|sync_claim_token|softora_validate_mailbox_sync_claim/);
});

test('claim-RPC valideert identiteit en laat force geen actieve lease of cap omzeilen', () => {
  assert.match(
    migration,
    /v_sync_key is distinct from \(v_account_email \|\| '\|' \|\| v_folder\)[\s\S]*MAILBOX_SYNC_LOCK_IDENTITY_INVALID/
  );
  assert.match(
    migration,
    /v_current\.lock_expires_at > clock_timestamp\(\)[\s\S]*return query select false, true, null::text, v_current\.lock_expires_at/
  );
  assert.match(
    migration,
    /if v_active_count >= 3 then[\s\S]*return query select false, true, null::text, null::timestamptz/
  );
  const functionBody = migration.match(
    /create or replace function public\.softora_claim_mailbox_sync_lock\([\s\S]*?\n\$\$;/
  )?.[0] || '';
  assert.equal((functionBody.match(/p_force/g) || []).length, 1, 'p_force mag alleen API-compatibel blijven');
});

test('lockfuncties zijn security-invoker en uitsluitend expliciet voor service_role', () => {
  assert.doesNotMatch(migration, /security definer/i);
  assert.equal((migration.match(/security invoker\s+set search_path = ''/g) || []).length, 3);
  [
    'softora_lock_mailbox_sync_capacity()',
    'softora_guard_mailbox_sync_lock()',
    'softora_claim_mailbox_sync_lock(text, text, text, text, integer, boolean)',
  ].forEach((signature) => {
    assert.ok(
      hasFunctionPrivilegeStatement(migration, 'revoke all', signature),
      `${signature} mist publieke revoke`
    );
    assert.ok(
      hasFunctionPrivilegeStatement(migration, 'grant execute', signature),
      `${signature} mist service_role grant`
    );
  });
});

test('transactionele probe dekt cap, force, oude UPSERT, reclaim en stale finish', () => {
  assert.match(probe, /^\\set ON_ERROR_STOP on/);
  assert.match(probe, /begin;[\s\S]*select pg_advisory_xact_lock\(824031, 3\);/);
  assert.match(probe, /PROBE_REQUIRES_NO_ACTIVE_MAILBOX_SYNCS/);
  assert.match(probe, /PROBE_BLANK_IDENTITY_WAS_ACCEPTED/);
  assert.match(probe, /PROBE_MISMATCHED_IDENTITY_WAS_ACCEPTED/);
  assert.match(probe, /PROBE_GLOBAL_CAP_DID_NOT_BLOCK_FOURTH/);
  assert.match(probe, /PROBE_FORCE_STOLE_ACTIVE_LEASE/);
  assert.match(probe, /on conflict \(sync_key\) do update set/);
  assert.match(probe, /PROBE_OLD_RUNTIME_STOLE_ACTIVE_LEASE/);
  assert.match(probe, /PROBE_SAME_TOKEN_FINISH_FAILED/);
  assert.match(probe, /PROBE_STALE_FINISH_CHANGED_RECLAIMED_LEASE/);
  assert.match(probe, /PROBE_REPLACEMENT_TOKEN_FINISH_FAILED/);
  assert.match(probe, /rollback;\s*$/);
});

test('CI voert de getrackte lockmigratie en transactionele probe echt op PostgreSQL uit', () => {
  assert.match(postgresTest, /create table public\.softora_mailbox_sync_state \(/);
  assert.match(postgresTest, /20260810100500_harden_mailbox_sync_global_locks\.sql/);
  assert.match(postgresTest, /mailbox-sync-global-lock-probe\.sql/);
  assert.match(
    postgresTest,
    /applyTrackedSql\([\s\S]*foundation[\s\S]*forwardMigration[\s\S]*globalLockMigration[\s\S]*globalLockProbe/
  );
});
