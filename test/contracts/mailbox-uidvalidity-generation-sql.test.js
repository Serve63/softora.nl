const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('pgsql-parser');

const root = path.resolve(__dirname, '../..');
const migrationPath = path.join(
  root,
  'supabase/migrations/20260810101500_add_mailbox_uidvalidity_generations.sql'
);
const schemaPath = path.join(root, 'supabase/data-ops-schema.sql');
const probePath = path.join(root, 'supabase/mailbox-uidvalidity-generation-probe.sql');
const identityAdoptionMigrationPath = path.join(
  root,
  'supabase/migrations/20260810130000_allow_mailbox_uid_generation_adoption.sql'
);
const atomicCommitFixMigrationPath = path.join(
  root,
  'supabase/migrations/20260810173000_fix_mailbox_uidvalidity_atomic_commit.sql'
);

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function block(source) {
  const match = source.match(
    /-- mailbox-uidvalidity-generation:start[\s\S]*?-- mailbox-uidvalidity-generation:end/
  );
  assert.ok(match, 'UIDVALIDITY schema block ontbreekt');
  return match[0];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function identityAdoptionBlock(source) {
  const match = source.match(
    /-- mailbox-uidvalidity-identity-adoption:start[\s\S]*?-- mailbox-uidvalidity-identity-adoption:end/
  );
  assert.ok(match, 'UIDVALIDITY identity-adoptieblok ontbreekt');
  return match[0];
}

test('UIDVALIDITY-migratie en data-ops-schema bevatten exact hetzelfde generatiecontract', () => {
  assert.equal(block(read(schemaPath)), block(read(migrationPath)));
});

test('identity-trigger staat uitsluitend de eenmalige legacy-generatieadoptie toe', () => {
  const migration = identityAdoptionBlock(read(identityAdoptionMigrationPath));
  assert.equal(identityAdoptionBlock(read(schemaPath)), migration);
  assert.match(migration, /old\.uid_validity is null/);
  assert.match(migration, /new\.uid_validity between 1 and 4294967295/);
  assert.match(migration, /old\.message_key = v_account_email[\s\S]*old\.uid::text/);
  assert.match(migration, /new\.message_key = v_account_email[\s\S]*\|uv:[\s\S]*new\.uid_validity/);
  assert.match(migration, /old\.uid_validity is distinct from new\.uid_validity/);
  assert.match(migration, /if not v_generation_adoption then[\s\S]*raise exception/);
});

test('UIDVALIDITY-schema vervangt UID-only identiteit door een begrensde generatie-identiteit', () => {
  const sql = block(read(migrationPath));
  assert.match(sql, /add column if not exists uid_validity bigint/i);
  assert.match(sql, /add column if not exists generation_superseded_at timestamptz/i);
  assert.match(sql, /add column if not exists uid_validity_reset_at timestamptz/i);
  assert.match(sql, /drop constraint if exists softora_mailbox_messages_account_email_folder_uid_key/i);
  assert.match(
    sql,
    /unique index if not exists softora_mailbox_messages_generation_uid_key[\s\S]*account_email, folder, uid_validity, uid/i
  );
  assert.match(sql, /uid_validity between 1 and 4294967295/i);
});

test('generatievoorbereiding adopteert legacy state maar supersedeert een echte reset', () => {
  const sql = block(read(migrationPath));
  assert.match(sql, /softora_apply_mailbox_uid_validity/i);
  assert.match(sql, /legacy\.uid_validity is null[\s\S]*message_key = v_account_email \|\| '\|'/i);
  assert.match(sql, /while preserving[\s\S]*read and user-tombstone state/i);
  assert.match(sql, /generation_superseded_at = coalesce/i);
  assert.match(sql, /last_uid = 0[\s\S]*message_count = 0[\s\S]*last_synced_at = null/i);
  assert.match(sql, /v_previous is not null and v_previous is distinct from p_uid_validity/i);
  assert.match(sql, /uid_validity_reset_at = coalesce/i);
});

test('rolling-deploy trigger coerceert alleen voor reset legacy writes en faalt daarna gesloten', () => {
  const sql = block(read(migrationPath));
  const triggerFunction = sql.match(
    /create or replace function public\.softora_coerce_mailbox_uid_generation\(\)[\s\S]*?\n\$\$;/i
  )?.[0] || '';
  assert.match(triggerFunction, /select sync_state\.uid_validity, sync_state\.uid_validity_reset_at/i);
  assert.match(triggerFunction, /if new\.uid_validity is null/i);
  assert.match(triggerFunction, /if v_reset_at is not null[\s\S]*MAILBOX_UIDVALIDITY_REQUIRED/i);
  assert.match(triggerFunction, /MAILBOX_UIDVALIDITY_STALE_GENERATION/i);
  assert.match(triggerFunction, /new\.message_key := v_account_email \|\| '\|'/i);
  assert.doesNotMatch(triggerFunction, /pg_advisory|for update/i);
  assert.match(
    sql,
    /create trigger softora_mailbox_messages_coerce_uid_generation[\s\S]*before insert on public\.softora_mailbox_messages[\s\S]*for each row/i
  );
});

test('directe voorbereiding en atomische campaign commit bewijzen de exacte actieve synclease', () => {
  const sql = block(read(migrationPath));
  const advisoryAt = sql.indexOf('pg_advisory_xact_lock(824031, 3)');
  const campaignLockAt = sql.indexOf("where scope = 'campaign' for update", advisoryAt);
  const syncLockAt = sql.indexOf('sync_state.lock_token = v_lock_token', campaignLockAt);
  assert.ok(advisoryAt >= 0 && campaignLockAt > advisoryAt && syncLockAt > campaignLockAt);
  const atomicSql = sql.slice(sql.indexOf(
    'create or replace function public.softora_commit_mailbox_campaign_messages'
  ));
  const atomicAdvisoryAt = atomicSql.indexOf('pg_advisory_xact_lock(824031, 3)');
  const atomicCampaignAt = atomicSql.indexOf("where scope = 'campaign' for update");
  const atomicMutationAt = atomicSql.indexOf('selected_mutation.mutation_id = p_mutation_id for update');
  const atomicSyncAt = atomicSql.indexOf('where sync_state.sync_key = v_mutation.account_email');
  assert.ok(
    atomicAdvisoryAt >= 0
      && atomicCampaignAt > atomicAdvisoryAt
      && atomicMutationAt > atomicCampaignAt
      && atomicSyncAt > atomicMutationAt
  );
  assert.match(atomicSql, /lock ordering must[\s\S]*never depend on caller-controlled result metadata/i);
  assert.match(sql, /sync_state\.lock_expires_at > clock_timestamp\(\)/i);
  assert.match(sql, /MAILBOX_UIDVALIDITY_LEASE_INVALID/i);
  assert.match(sql, /softora_apply_mailbox_uid_validity\([\s\S]*p_lock_token text/i);
  assert.match(sql, /p_result->>'syncLockToken'/i);
  assert.match(sql, /p_result->>'uidValidity'/i);
  assert.match(sql, /MAILBOX_UIDVALIDITY_ROW_MISMATCH/i);
  assert.match(
    atomicSql,
    /warm pre-UIDVALIDITY runtime is safe to coerce[\s\S]*v_sync\.uid_validity_reset_at is not null[\s\S]*MAILBOX_UIDVALIDITY_REQUIRED/i
  );
  assert.match(sql, /jsonb_array_length\(p_rows\) > 2000/i);
  assert.match(sql, /result = \(coalesce\(p_result, '\{\}'::jsonb\) - 'syncLockToken'\)/i);
});

test('atomische UID-validatie houdt JSON-extractie buiten tekstconcatenatie', () => {
  const migration = read(atomicCommitFixMigrationPath);
  const generationSql = block(read(migrationPath));
  const schemaSql = block(read(schemaPath));
  const safeExtraction = /\|\| v_uid_validity::text \|\| '\|' \|\| \(candidate\.row_data->>'uid'\)/i;
  const unsafeExtraction = /\|\| v_uid_validity::text \|\| '\|' \|\| candidate\.row_data->>'uid'/i;
  for (const sql of [migration, generationSql, schemaSql]) {
    assert.match(sql, safeExtraction);
    assert.doesNotMatch(sql, unsafeExtraction);
  }
});

test('atomische UIDVALIDITY-hotfix parseert volledig als PostgreSQL', async () => {
  const parsed = await parse(read(atomicCommitFixMigrationPath));
  assert.ok(Array.isArray(parsed.stmts));
  assert.equal(parsed.stmts.length, 17);
});

test('UID-generatieadoptie laat alle duurzame lineage-sleutels atomisch meeschuiven', () => {
  const migration = read(atomicCommitFixMigrationPath);
  for (const constraint of [
    'softora_mailbox_message_lineage_edges_child_message_key_fkey',
    'softora_mailbox_campaign_lineage_roots_message_key_fkey',
    'softora_mailbox_campaign_lineage_discoveries_message_key_fkey',
    'softora_mailbox_campaign_lineage_discover_root_message_key_fkey',
    'softora_mailbox_campaign_lineage_members_message_key_fkey',
    'softora_mailbox_campaign_lineage_member_parent_message_key_fkey',
    'softora_mailbox_campaign_lineage_members_root_message_key_fkey',
  ]) {
    assert.match(
      migration,
      new RegExp(`${constraint}[\\s\\S]*?on update cascade on delete cascade`, 'i')
    );
  }
  assert.match(
    migration,
    /softora_mailbox_campaign_lineage_member_parent_message_key_fkey[\s\S]*?deferrable initially deferred/i
  );
});

test('UIDVALIDITY RPCs zijn service-role-only en de probe dekt adoptie, reset en state-isolatie', () => {
  const sql = block(read(migrationPath));
  const probe = read(probePath);
  for (const signature of [
    'softora_coerce_mailbox_uid_generation()',
    'softora_apply_mailbox_uid_validity(text, text, bigint, text)',
    'softora_prepare_mailbox_uid_validity(text, text, bigint)',
  ]) {
    const escapedSignature = escapeRegExp(signature);
    assert.match(sql, new RegExp(`revoke all on function public\\.${escapedSignature}[\\s\\S]*from public, anon, authenticated, service_role`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function public\\.${escapedSignature}[\\s\\S]*to service_role`, 'i'));
  }
  assert.match(probe, /UIDVALIDITY_PROBE_LEGACY_ADOPTION_FAILED/);
  assert.match(probe, /UIDVALIDITY_PROBE_LINEAGE_SETUP_FAILED/);
  assert.match(probe, /UIDVALIDITY_PROBE_LINEAGE_NOT_CASCADED/);
  assert.match(probe, /UIDVALIDITY_PROBE_ROLLING_WRITER_DUPLICATED_STATE/);
  assert.match(probe, /UIDVALIDITY_PROBE_RESET_NOT_DETECTED/);
  assert.match(probe, /UIDVALIDITY_PROBE_POST_RESET_LEGACY_WRITE_ACCEPTED/);
  assert.match(probe, /UIDVALIDITY_PROBE_POST_RESET_LEGACY_WRITE_PERSISTED/);
  assert.match(probe, /UIDVALIDITY_PROBE_STATE_LEAKED_ACROSS_RESET/);
  assert.match(probe, /UIDVALIDITY_PROBE_WRONG_LEASE_MUTATED_STATE/);
  assert.match(probe, /rollback;/i);
});
