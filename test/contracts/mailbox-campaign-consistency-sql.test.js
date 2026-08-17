const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
  __dirname,
  '../../supabase/migrations/20260809213000_mailbox_campaign_consistency_foundation.sql'
);
const schemaPath = path.resolve(__dirname, '../../supabase/data-ops-schema.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
const schema = fs.readFileSync(schemaPath, 'utf8');
const {
  CAMPAIGN_MAILBOX_ACCOUNTS,
} = require('../../server/services/mailbox-campaign-replies');

function consistencyBlock(source) {
  const match = source.match(
    /-- mailbox-campaign-consistency:start[\s\S]*?-- mailbox-campaign-consistency:end/
  );
  assert.ok(match, 'mailbox campaign consistency block ontbreekt');
  return match[0];
}

function hasFunctionPrivilegeStatement(source, action, signature) {
  const pattern = new RegExp(
    `${action} on function public\\.${signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\r?\\n  ` +
      (action === 'grant execute' ? 'to service_role;' : 'from public, anon, authenticated;')
  );
  return pattern.test(source);
}

test('de deploymigratie en data-ops-schema bevatten exact dezelfde idempotente foundation', () => {
  assert.equal(consistencyBlock(schema), consistencyBlock(migration));
  assert.match(migration, /create table if not exists public\.softora_mailbox_campaign_consistency/);
  assert.match(migration, /create table if not exists public\.softora_mailbox_campaign_mutations/);
  assert.match(migration, /insert into public\.softora_mailbox_campaign_consistency[\s\S]*on conflict \(scope\) do nothing;/);
  assert.match(migration, /create index if not exists softora_mailbox_campaign_mutations_pending_lease_idx/);
});

test('content_version is database-monotoon en identieke timestamp-only upserts invalidateren niet', () => {
  assert.match(
    migration,
    /content_version = public\.softora_mailbox_campaign_consistency\.content_version \+ 1/
  );
  assert.match(
    migration,
    /row\([\s\S]*old_row\.deleted_at[\s\S]*\) is distinct from row\([\s\S]*new_row\.deleted_at/
  );
  assert.doesNotMatch(migration, /old_row\.created_at|new_row\.created_at|old_row\.updated_at|new_row\.updated_at/);
  assert.match(
    migration,
    /set_config\('softora\.mailbox_campaign_version_bumped', '1', true\)/
  );
  assert.match(
    migration,
    /after update on public\.softora_mailbox_messages[\s\S]*referencing old table[\s\S]*new table[\s\S]*for each statement/
  );
  assert.match(
    migration,
    /tg_op = 'TRUNCATE'[\s\S]*create trigger softora_track_mailbox_campaign_message_truncate[\s\S]*after truncate/
  );
});

test('de trigger dekt alle campagneaccounts plus owner-gebonden Instantly-berichten', () => {
  const accountArray = migration.match(
    /p_account_email[\s\S]*?= any \(array\[([\s\S]*?)\]::text\[\]\)/
  );
  assert.ok(accountArray, 'SQL-campagneaccountlijst ontbreekt');
  const sqlAccounts = Array.from(
    accountArray[1].matchAll(/'([^']+)'/g),
    (match) => match[1]
  );
  assert.deepEqual(
    [...sqlAccounts].sort(),
    [...CAMPAIGN_MAILBOX_ACCOUNTS].sort(),
    'SQL-trigger en runtime moeten exact dezelfde campagneaccounts volgen'
  );
  [
    "array['inbox', 'sent', 'coldmail']",
    "p_folder, ''))) = 'instantly'",
    "array['serve', 'martijn']",
  ].forEach((needle) => assert.ok(migration.includes(needle), `${needle} ontbreekt`));
});

test('pending mutations zijn durable, lease-recoverable en idempotent over instances', () => {
  assert.match(
    migration,
    /constraint softora_mailbox_campaign_mutations_scope_request_key_key\s+unique \(scope, request_key\)/
  );
  assert.match(migration, /status in \('pending', 'completed', 'abandoned'\)/);
  assert.match(
    migration,
    /on conflict on constraint softora_mailbox_campaign_mutations_scope_request_key_key do nothing/
  );
  assert.match(
    migration,
    /where existing_mutation\.scope = 'campaign'[\s\S]*existing_mutation\.request_key = v_request_key[\s\S]*for update;/
  );
  assert.doesNotMatch(migration, /where mutation_id = p_mutation_id/);
  assert.doesNotMatch(migration, /where scope = 'campaign' and request_key = v_request_key/);
  assert.match(
    migration,
    /status = 'abandoned'[\s\S]*lease_expires_at <= v_checked_at/
  );
  assert.match(migration, /v_pending = 0/);
});

test('RPCs en tabellen zijn alleen voor service_role bereikbaar', () => {
  assert.doesNotMatch(consistencyBlock(migration), /security definer/i);
  const functions = consistencyBlock(migration).match(/create or replace function/g) || [];
  const fixedSearchPaths = consistencyBlock(migration).match(/security invoker\s+set search_path = ''/g) || [];
  assert.equal(functions.length, 5);
  assert.equal(fixedSearchPaths.length, functions.length);
  assert.match(
    migration,
    /revoke all privileges on table public\.softora_mailbox_campaign_consistency[\s\S]*from public, anon, authenticated, service_role;/
  );
  assert.match(
    migration,
    /revoke all privileges on table public\.softora_mailbox_campaign_mutations[\s\S]*from public, anon, authenticated, service_role;/
  );
  assert.match(migration, /alter table public\.softora_mailbox_campaign_consistency enable row level security;/);
  assert.match(migration, /alter table public\.softora_mailbox_campaign_mutations enable row level security;/);
  assert.match(
    migration,
    /revoke all on function public\.softora_track_mailbox_campaign_message_change\(\)[\s\S]*from public, anon, authenticated;/
  );
  assert.match(
    migration,
    /grant execute on function public\.softora_track_mailbox_campaign_message_change\(\)[\s\S]*to service_role;/
  );
  [
    'softora_begin_mailbox_campaign_mutation(uuid, text, text, text, text, integer)',
    'softora_complete_mailbox_campaign_mutation(uuid, text, jsonb)',
    'softora_get_mailbox_campaign_fence(boolean)',
  ].forEach((signature) => {
    assert.ok(
      hasFunctionPrivilegeStatement(migration, 'grant execute', signature),
      `${signature} mist service_role grant`
    );
    assert.ok(
      hasFunctionPrivilegeStatement(migration, 'revoke all', signature),
      `${signature} mist publieke revoke`
    );
  });
});
