const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260821174844_mailbox_uid_generation_epoch_v2.sql'
);
const migration = fs.readFileSync(migrationPath, 'utf8');
const schema = fs.readFileSync(path.join(repoRoot, 'supabase/data-ops-schema.sql'), 'utf8');

function functionSql(name) {
  const start = migration.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} ontbreekt`);
  const end = migration.indexOf('\n$function$;', start);
  assert.ok(end > start, `${name} heeft geen functie-einde`);
  return migration.slice(start, end + '\n$function$;'.length);
}

test('herstelde live UIDVALIDITY-migraties zijn byte-exact', () => {
  const expected = new Map([
    ['20260810125534_add_mailbox_uidvalidity_generations.sql', '35cc0835cdf8c8fa5fdadeab34c537bd'],
    ['20260810132307_allow_mailbox_uid_generation_adoption.sql', '6360c646d63d8d8f89285bcb957563b8'],
    ['20260810172231_fix_mailbox_uidvalidity_atomic_commit.sql', 'fdce5ab62a8d39920b9183d6d80debc6'],
  ]);
  for (const [filename, digest] of expected) {
    const contents = fs.readFileSync(path.join(repoRoot, 'supabase/migrations', filename));
    assert.equal(crypto.createHash('md5').update(contents).digest('hex'), digest);
  }
});

test('data-ops bootstrap spiegelt de volledige v2-eindstaat exact', () => {
  const marker = '-- mailbox-uid-generation-epoch-v2:start';
  assert.equal(schema.slice(schema.indexOf(marker)), migration);
});

test('UUID generation-control maakt A-B-A mogelijk zonder UIDVALIDITY-identiteit', () => {
  assert.match(migration, /create table if not exists public\.softora_mailbox_uid_generations/);
  assert.match(migration, /generation_id uuid primary key/);
  assert.match(migration, /status in \('staging', 'active', 'superseded', 'abandoned'\)/);
  assert.match(migration, /one_active_idx[\s\S]*?where status = 'active'/);
  assert.match(migration, /one_staging_idx[\s\S]*?where status = 'staging'/);
  assert.match(migration, /uid_generation_id uuid/);
  assert.match(migration, /active_uid_generation_id uuid/);
  assert.match(migration, /pending_uid_generation_id uuid/);
  assert.match(migration, /drop index if exists public\.softora_mailbox_messages_generation_uid_key/);
  assert.match(migration, /unique index[\s\S]*?\(uid_generation_id, uid\)/);
  assert.doesNotMatch(migration, /unique[^;]*\(sync_key, uid_validity\)/i);
  assert.match(migration, /\|gen:'[\s\S]*?generation_id::text/);
});

test('prepare, baseline, commit en fail hebben het vaste runtimecontract', () => {
  const baselineSql = functionSql('softora_confirm_mailbox_uid_baseline_v2');
  assert.match(migration, /softora_confirm_mailbox_uid_baseline_v2\(\s*p_sync_key text,\s*p_lock_token text,\s*p_generation_id uuid,\s*p_uid_validity bigint,\s*p_evidence jsonb/s);
  assert.match(baselineSql, /resume_after_uid bigint/);
  const baselineReturns = baselineSql.match(/return query select[\s\S]*?;/g) || [];
  assert.ok(baselineReturns.length >= 8);
  for (const returnSql of baselineReturns) {
    assert.match(
      returnSql,
      /,\s*0::bigint,\s*(?:0|v_adopted|coalesce\(v_generation\.snapshot_message_count, 0\))\s*;$/
    );
  }
  assert.match(migration, /softora_prepare_mailbox_uid_generation_v2\(\s*p_sync_key text,\s*p_lock_token text,\s*p_uid_validity bigint,\s*p_uid_next bigint,\s*p_selection_policy text,\s*p_selection_targets jsonb/s);
  assert.match(migration, /softora_commit_mailbox_sync_pass_v2\(\s*p_sync_key text,\s*p_lock_token text,\s*p_commit_id text,\s*p_generation_id uuid,\s*p_uid_validity bigint,\s*p_selection_policy text,\s*p_target_reference_ids jsonb,\s*p_target_uid_manifest jsonb,\s*p_rows jsonb,\s*p_scanned_from_uid bigint,\s*p_scanned_through_uid bigint,\s*p_scan_complete boolean,\s*p_message_count integer,\s*p_last_uid bigint/s);
  assert.match(migration, /softora_fail_mailbox_sync_v2\(\s*p_sync_key text,\s*p_lock_token text,\s*p_commit_id text,\s*p_error text/s);
  assert.match(functionSql('softora_prepare_mailbox_uid_generation_v2'), /p_selection_policy not in \('staged-rebuild-v2', 'targeted-sparse-v2'\)/);
});

test('migratie schakelt alleen na een lege drain atomisch van draining naar v2', () => {
  const preflightStart = migration.indexOf('do $uid_protocol_preflight$');
  const schemaStart = migration.indexOf('create table if not exists public.softora_mailbox_uid_generations');
  const activateStart = migration.indexOf('do $uid_protocol_activate$');
  assert.ok(preflightStart >= 0 && preflightStart < schemaStart);
  assert.ok(activateStart > migration.indexOf('softora_fail_mailbox_sync_v2'));

  const preflight = migration.slice(preflightStart, schemaStart);
  const activation = migration.slice(activateStart);
  for (const sql of [preflight, activation]) {
    assert.match(sql, /pg_advisory_xact_lock\(824031, 3\)/);
    assert.match(sql, /softora_mailbox_campaign_consistency[\s\S]*?for update/);
    assert.match(sql, /uid_generation_protocol[\s\S]*?'draining'/);
    assert.match(sql, /uid_generation_drain_ready_at[\s\S]*?clock_timestamp\(\)/);
    assert.match(sql, /softora_mailbox_sync_state[\s\S]*?status = 'syncing'/);
    assert.match(sql, /pg_catalog\.pg_locks/);
    assert.match(sql, /waiting_lock\.granted is false/);
    assert.match(sql, /waiting_lock\.pid <> pg_catalog\.pg_backend_pid\(\)/);
    assert.match(sql, /softora_mailbox_uid_generation_commits/);
    assert.match(sql, /pg_catalog\.pg_stat_activity/);
    assert.match(sql, /activity\.query[\s\S]*?ilike '%softora_mailbox%'/);
  }
  assert.match(activation, /set_config\(\s*'softora\.mailbox_uid_protocol_transition', '1', true/);
  assert.match(activation, /set uid_generation_protocol = 'v2'/);
  assert.ok(activation.indexOf('MAILBOX_UID_PROTOCOL_WAITING_WRITERS') < activation.indexOf("uid_generation_protocol = 'v2'"));
});

test('state-changing RPCs zijn lease-fenced en volgen dezelfde lockvolgorde', () => {
  for (const name of [
    'softora_prepare_mailbox_uid_generation_v2',
    'softora_confirm_mailbox_uid_baseline_v2',
    'softora_commit_mailbox_sync_pass_v2',
    'softora_fail_mailbox_sync_v2',
  ]) {
    const sql = functionSql(name);
    assert.match(sql, /status <> 'syncing'/);
    assert.match(sql, /lock_token is distinct from v_lock_token/);
    assert.match(sql, /lock_expires_at <= pg_catalog\.clock_timestamp\(\)/);
    assert.match(sql, /pg_advisory_xact_lock\(824031, 3\)/);
    assert.ok(sql.indexOf('pg_advisory_xact_lock(824031, 3)') < sql.indexOf('softora_mailbox_campaign_consistency'));
  }
  const commitSql = functionSql('softora_commit_mailbox_sync_pass_v2');
  const lockPath = commitSql.slice(commitSql.indexOf('perform pg_catalog.pg_advisory_xact_lock'));
  assert.ok(lockPath.indexOf('softora_mailbox_campaign_consistency') < lockPath.indexOf('insert into public.softora_mailbox_uid_generation_commits'));
  assert.ok(lockPath.indexOf('insert into public.softora_mailbox_uid_generation_commits') < lockPath.indexOf('from public.softora_mailbox_sync_state'));
  assert.ok(lockPath.indexOf('from public.softora_mailbox_sync_state') < lockPath.indexOf('from public.softora_mailbox_uid_generations'));
});

test('staging blijft onzichtbaar en activation/cursor/finalisatie staan in één RPC', () => {
  const sql = functionSql('softora_commit_mailbox_sync_pass_v2');
  assert.match(sql, /insert into public\.softora_mailbox_uid_generation_staging/);
  assert.match(sql, /if not p_scan_complete then[\s\S]*?status = 'idle'/);
  assert.match(sql, /insert into public\.softora_mailbox_messages/);
  assert.match(sql, /status = 'superseded'/);
  assert.match(sql, /set status = 'active'/);
  assert.match(sql, /active_uid_generation_id = p_generation_id/);
  assert.match(sql, /lock_token = null, lock_expires_at = null/);
  assert.match(sql, /snapshot_message_count = v_staged_count/);
  assert.doesNotMatch(sql, /v_staged_count <> p_message_count/);
});

test('All Mail accepteert uitsluitend geankerde sparse targets en bewaart de bestaande cursor', () => {
  const prepareSql = functionSql('softora_prepare_mailbox_uid_generation_v2');
  const commitSql = functionSql('softora_commit_mailbox_sync_pass_v2');
  for (const sql of [prepareSql, commitSql]) {
    assert.match(sql, /v_sync\.folder = 'allmail'[\s\S]*?p_selection_policy <> 'targeted-sparse-v2'[\s\S]*?MAILBOX_UID_ALLMAIL_SELECTION_POLICY_REQUIRED/);
    assert.match(sql, /softora_mailbox_target_references_are_anchored/);
  }
  assert.match(commitSql, /softora_mailbox_row_matches_target_references/);
  assert.match(commitSql, /p_target_uid_manifest/);
  assert.doesNotMatch(commitSql, /p_selection_policy = 'targeted-sparse-v2'[\s\S]*?last_uid = 0/);
  assert.match(commitSql, /last_uid = case when p_selection_policy = 'targeted-sparse-v2'[\s\S]*?then state\.last_uid else p_last_uid end/);
  assert.match(commitSql, /p_selection_policy = 'targeted-sparse-v2'[\s\S]*?coalesce\(v_sync\.last_uid, 0\)/);
  assert.match(migration, /anchor\.account_email = pg_catalog\.lower\(pg_catalog\.btrim\(p_account_email\)\)/);
  assert.match(migration, /anchor\.folder = any \(array\['inbox', 'sent', 'coldmail'\]/);
});

test('NULL baseline is exact, idempotent en retireert verborgen legacykopieën', () => {
  const sql = functionSql('softora_confirm_mailbox_uid_baseline_v2');
  assert.match(sql, /message\.uid_validity is null/);
  assert.match(sql, /message\.uid_generation_id is null/);
  assert.match(sql, /message\.generation_superseded_at is null/);
  assert.match(sql, /message\.deleted_at is null/);
  assert.match(sql, /full join evidence using \(uid\)/);
  assert.match(sql, /legacy\.message_id is distinct from evidence\.message_id/);
  assert.match(sql, /hidden_legacy[\s\S]*?generation_superseded_at = coalesce/);
  assert.match(sql, /v_generation\.status = 'active'[\s\S]*?return query select true/);
  assert.match(sql, /uid_validity = p_uid_validity,[\s\S]*?last_uid = 0/);
  assert.match(sql, /return query select true, false, p_generation_id, p_uid_validity,[\s\S]*?0::bigint, v_adopted/);
});

test('onvolledige/dubbele replays falen dicht en fail bewaart cursor/generation', () => {
  const commitSql = functionSql('softora_commit_mailbox_sync_pass_v2');
  const failSql = functionSql('softora_fail_mailbox_sync_v2');
  assert.match(commitSql, /payload_digest/);
  assert.match(commitSql, /MAILBOX_UID_GENERATION_REPLAY_MISMATCH/);
  assert.match(commitSql, /status = 'completed'[\s\S]*?return query select true, true/);
  assert.match(failSql, /MAILBOX_UID_GENERATION_REPLAY_MISMATCH/);
  const failUpdate = failSql.slice(failSql.indexOf('update public.softora_mailbox_sync_state'));
  assert.doesNotMatch(failUpdate, /last_uid\s*=/);
  assert.doesNotMatch(failUpdate, /active_uid_generation_id\s*=/);
  assert.doesNotMatch(failUpdate, /pending_uid_generation_id\s*=/);
});

test('oude IMAP writes en v1 statewissels zijn na migratie fail-closed', () => {
  const coerce = functionSql('softora_coerce_mailbox_uid_generation');
  const guard = functionSql('softora_guard_mailbox_uid_generation_v2_state');
  assert.match(coerce, /v_sync\.sync_key is not null[\s\S]*?MAILBOX_UID_GENERATION_REQUIRED/);
  assert.match(coerce, /mailbox_uid_generation_v2_transition/);
  assert.match(coerce, /MAILBOX_UID_GENERATION_STALE/);
  assert.match(guard, /old\.uid_validity is distinct from new\.uid_validity/);
  assert.match(guard, /old\.active_uid_generation_id is distinct from new\.active_uid_generation_id/);
  assert.match(guard, /MAILBOX_UID_GENERATION_V2_TRANSITION_REQUIRED/);
});

test('nieuwe tabellen hebben RLS en alleen service_role krijgt RPC execute', () => {
  for (const table of [
    'softora_mailbox_uid_generations',
    'softora_mailbox_uid_generation_staging',
    'softora_mailbox_uid_generation_commits',
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all privileges on table public\\.${table}[\\s\\S]*?from public, anon, authenticated, service_role`));
  }
  for (const name of [
    'softora_prepare_mailbox_uid_generation_v2',
    'softora_confirm_mailbox_uid_baseline_v2',
    'softora_commit_mailbox_sync_pass_v2',
    'softora_fail_mailbox_sync_v2',
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${name}[\\s\\S]*?from public, anon, authenticated, service_role`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}[\\s\\S]*?to service_role`));
  }
});

test('beide generation-FKs op sync-state hebben gerichte partial indexes', () => {
  assert.match(migration, /softora_mailbox_sync_state_active_uid_generation_idx[\s\S]*?\(active_uid_generation_id\)[\s\S]*?where active_uid_generation_id is not null/);
  assert.match(migration, /softora_mailbox_sync_state_pending_uid_generation_idx[\s\S]*?\(pending_uid_generation_id\)[\s\S]*?where pending_uid_generation_id is not null/);
});

test('bestaande mailboxselectie- en cosmetische filters worden niet hergedefinieerd', () => {
  assert.doesNotMatch(migration, /create or replace function public\.softora_is_campaign_mailbox_message/);
  assert.doesNotMatch(migration, /softora_filter_mailbox_outreach_contacts/);
  assert.doesNotMatch(migration, /premium-mailbox|quoted|signature|autoreply/i);
});
