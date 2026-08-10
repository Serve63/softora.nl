'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('pgsql-parser');
const {
  CAMPAIGN_INCOMING_FOLDERS,
} = require('../../server/services/mailbox-campaign-replies');

const repoRoot = path.join(__dirname, '../..');
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260810152657_mailbox_campaign_lineage_index.sql'
);
const schemaPath = path.join(repoRoot, 'supabase/data-ops-schema.sql');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n?/g, '\n');
}

test('mailbox lineage migration parses with the real PostgreSQL parser', async () => {
  const parsed = await parse(read(migrationPath));
  assert.ok(Array.isArray(parsed.stmts));
  assert.ok(parsed.stmts.length > 40, 'volledige migratie moet als losse statements parsen');
});

test('mailbox lineage SQL materializes unlimited exact ancestry with a durable discovery watermark', () => {
  const sql = read(migrationPath);
  assert.match(sql, /create table if not exists public\.softora_mailbox_campaign_lineage_roots/);
  assert.match(sql, /create table if not exists public\.softora_mailbox_message_lineage_edges/);
  assert.match(sql, /create table if not exists public\.softora_mailbox_campaign_lineage_discoveries/);
  assert.match(sql, /create table if not exists public\.softora_mailbox_campaign_lineage_members/);
  assert.match(sql, /first_discovered_at timestamptz not null/);
  assert.match(sql, /lineage_discovered_at timestamptz not null/);
  assert.match(sql, /softora_mailbox_campaign_lineage_root_id_idx/);
  assert.match(sql, /softora_mailbox_lineage_parent_lookup_idx/);
  assert.match(sql, /softora_mailbox_campaign_lineage_message_date_idx/);
  assert.match(sql, /softora_mailbox_campaign_lineage_latest_idx/);
  assert.match(sql, /create trigger softora_refresh_mailbox_message_lineage/);
  assert.match(sql, /softora_rebuild_mailbox_campaign_lineage\([\s\S]*p_backfill boolean default false/);
  assert.match(sql, /when p_backfill then coalesce\(messages\.created_at, clock_timestamp\(\)\)[\s\S]*else clock_timestamp\(\)/);
  assert.match(sql, /on conflict \(message_key, root_message_key\) do update set[\s\S]*last_confirmed_at/);
  assert.match(sql, /with recursive impacted_members as \([\s\S]*child\.parent_message_key = impacted_members\.message_key/);
  assert.match(sql, /perform public\.softora_rebuild_mailbox_campaign_lineage\([\s\S]*false/);
  assert.match(sql, /not child\.message_key = any \(lineage\.visited_keys\)/);
  assert.match(sql, /select count\(\*\)[\s\S]*child_edges\.child_message_key = child\.message_key[\s\S]*= 1/);
  assert.match(sql, /public\.softora_normalize_mailbox_message_id\(exact_parent\.message_id\) = edge\.parent_message_id/);
});

test('lineage read unions bounded message-date and discovery feeds before exact parent closure', () => {
  const sql = read(migrationPath);
  assert.match(sql, /message_date_ranked as \(/);
  assert.match(sql, /order by members\.message_date desc, members\.message_key desc/);
  assert.match(sql, /discovery_ranked as \(/);
  assert.match(sql, /order by members\.lineage_discovered_at desc, members\.message_key desc/);
  assert.match(sql, /limit v_reply_limit \+ 1/g);
  assert.match(sql, /candidate_sources as \([\s\S]*message-date[\s\S]*lineage-discovered/);
  assert.match(sql, /ancestor_walk as \([\s\S]*parent\.message_key = ancestor_walk\.parent_message_key/);
  assert.match(sql, /ancestor_walk\.hops < v_max_depth/);
  assert.match(sql, /descendant_walk as \([\s\S]*child\.parent_message_key = descendant_walk\.message_key/);
  assert.match(sql, /descendant_walk\.hops < v_max_depth/);
  assert.match(sql, /'descendant'::text/);
  assert.match(sql, /lineage_has_more/);
  assert.match(sql, /select count\(\*\) from selected_context\) > v_max_context/);
  assert.match(sql, /selection_source = 'root-context'\) desc/);
  assert.match(sql, /limit v_max_context/);
  assert.match(sql, /set_config\('statement_timeout'/);
  assert.doesNotMatch(sql, /from lineage\s+limit v_max_context/i);
});

test('durable lineage incoming folders cover every canonical campaign inbox folder', () => {
  const sql = read(migrationPath);
  const incomingClause = sql.match(
    /when lower\(btrim\(coalesce\(p_folder, ''\)\)\) in \(([^)]+)\)/
  );
  assert.ok(incomingClause, 'lineage member mist een expliciete incoming-folderclassificatie');
  const durableFolders = Array.from(
    incomingClause[1].matchAll(/'([^']+)'/g),
    (match) => match[1]
  );
  for (const folder of CAMPAIGN_INCOMING_FOLDERS) {
    assert.ok(durableFolders.includes(folder), `duurzame lineage mist canonical folder ${folder}`);
  }
  assert.match(
    sql,
    /when lower\(btrim\(coalesce\(p_folder, ''\)\)\) = 'instantly'[\s\S]*then false/,
    'Instantly zonder expliciete received-richting mag niet als incoming gelden'
  );
  assert.doesNotMatch(
    incomingClause[0],
    /recipients_text|toDisplay|deliveredTo|p_account_email/,
    'canonical folderownership plus externe afzender moet alias- en BCC-delivery behouden'
  );
});

test('mailbox lineage cutover locks writes and installs triggers before backfill', () => {
  const sql = read(migrationPath);
  const lockAt = sql.indexOf('lock table public.softora_mailbox_messages in share row exclusive mode;');
  const evidenceTriggerAt = sql.indexOf('create trigger softora_preserve_mailbox_automated_reply_evidence');
  const lineageTriggerAt = sql.indexOf('create trigger softora_refresh_mailbox_message_lineage');
  const backfillAt = sql.indexOf('-- mailbox-campaign-lineage-backfill:start');
  assert.ok(lockAt > 0);
  assert.ok(evidenceTriggerAt > lockAt);
  assert.ok(lineageTriggerAt > evidenceTriggerAt);
  assert.ok(backfillAt > lineageTriggerAt);
});

test('mailbox lineage tables and functions are service-role only', () => {
  const sql = read(migrationPath);
  assert.match(sql, /security invoker/g);
  assert.match(sql, /enable row level security/g);
  for (const table of [
    'softora_mailbox_message_lineage_edges',
    'softora_mailbox_campaign_lineage_roots',
    'softora_mailbox_campaign_lineage_discoveries',
    'softora_mailbox_campaign_lineage_members',
  ]) {
    assert.match(sql, new RegExp(`revoke all on table public\\.${table}\\s+from public, anon, authenticated`));
    assert.match(sql, new RegExp(`grant select, insert, update, delete\\s+on table public\\.${table} to service_role`));
  }
  assert.doesNotMatch(sql, /grant[^;]*truncate/i);
});

test('fresh data-ops bootstrap contains byte-equivalent additive mailbox lineage SQL', () => {
  const migration = read(migrationPath).split('\n').slice(5).join('\n').trim();
  const schema = read(schemaPath);
  const block = schema.match(
    /-- mailbox-campaign-lineage:start\n([\s\S]*?)\n-- mailbox-campaign-lineage:end/
  );
  assert.ok(block, 'data-ops-schema mist mailbox-campaign-lineage blok');
  assert.equal(block[1].trim(), migration);
});

test('mailbox lineage release order is migration first and rollback is application first', () => {
  const sql = read(migrationPath);
  assert.match(sql, /Deploy order \(fail closed\): apply this migration/);
  assert.match(sql, /Rollback order: roll application code back first/);
  assert.ok(
    path.basename(migrationPath).startsWith('20260810152657_'),
    'lineage migration moet na de bestaande mailbox- en send-outcome-migraties draaien'
  );
});
