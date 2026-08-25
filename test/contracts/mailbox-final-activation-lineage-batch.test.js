const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const migration = fs.readFileSync(path.join(
  repoRoot,
  'supabase/migrations/20260824224810_optimize_mailbox_final_activation_lineage.sql'
), 'utf8');
const scaleMigration = fs.readFileSync(path.join(
  repoRoot,
  'supabase/migrations/20260825001646_scale_mailbox_final_activation.sql'
), 'utf8');
const schema = fs.readFileSync(path.join(repoRoot, 'supabase/data-ops-schema.sql'), 'utf8');
const postgresTest = fs.readFileSync(path.join(
  repoRoot,
  'test/postgres/mailbox-uid-generation-v2.postgres.test.js'
), 'utf8');

const startMarker = '-- mailbox-final-activation-lineage-batch:start';
const endMarker = '-- mailbox-final-activation-lineage-batch:end';
const scaleStartMarker = '-- mailbox-final-activation-scale:start';
const scaleEndMarker = '-- mailbox-final-activation-scale:end';
const postgresScaleStartMarker = '// mailbox-final-activation-scale-regression:start';
const postgresScaleEndMarker = '// mailbox-final-activation-scale-regression:end';

function markedBlockBetween(source, blockStartMarker, blockEndMarker) {
  const lines = source.split('\n');
  const start = lines.indexOf(blockStartMarker);
  const end = lines.indexOf(blockEndMarker, start);
  assert.ok(start >= 0, 'final-activation-lineage startmarker ontbreekt');
  assert.ok(end > start, 'final-activation-lineage eindmarker ontbreekt');
  assert.equal(lines.indexOf(blockStartMarker, start + 1), -1, 'startmarker staat dubbel');
  assert.equal(lines.indexOf(blockEndMarker, end + 1), -1, 'eindmarker staat dubbel');
  return lines.slice(start, end + 1).join('\n');
}

function markedBlock(source) {
  return markedBlockBetween(source, startMarker, endMarker);
}

function functionSql(source, name) {
  const start = source.lastIndexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} ontbreekt`);
  const end = source.indexOf('\n$function$;', start);
  assert.ok(end > start, `${name} heeft geen functie-einde`);
  return source.slice(start, end + '\n$function$;'.length);
}

function replacementFragments(source) {
  return [...source.matchAll(/\$new\$([\s\S]*?)\$new\$/g)].map((match) => match[1]);
}

function replacementFragmentContaining(source, pattern, label) {
  const matches = replacementFragments(source).filter((fragment) => pattern.test(fragment));
  assert.equal(matches.length, 1, `${label} moet exact één $new$-fragment hebben`);
  return matches[0];
}

test('data-ops bootstrap spiegelt de finale activatie-optimalisatie byte-exact', () => {
  assert.equal(markedBlock(schema), markedBlock(migration));
  assert.match(migration, /notify pgrst, 'reload schema';/);
});

test('activatiescope bevat exact sync, account, folder en beide generaties', () => {
  const matcher = functionSql(
    migration,
    'softora_mailbox_lineage_activation_row_matches_v2'
  );
  assert.match(matcher, /v_scope_key_count <> 5/);
  for (const key of [
    'syncKey',
    'accountEmail',
    'folder',
    'oldGenerationId',
    'newGenerationId',
  ]) {
    assert.match(matcher, new RegExp(`'${key}'`), `${key} ontbreekt in de scope`);
  }
  assert.match(matcher, /v_sync_key is distinct from \(v_account_email \|\| '\|' \|\| v_folder\)/);
  assert.match(matcher, /v_new_generation_id::uuid/);
  assert.match(matcher, /v_old_generation_is_null/);
  assert.match(matcher, /MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID/);
  assert.match(matcher, /MAILBOX_LINEAGE_ACTIVATION_ROW_SCOPE_MISMATCH/);
  assert.match(matcher, /MAILBOX_LINEAGE_ACTIVATION_ROW_OPERATION_INVALID/);
});

test('matcher accepteert uitsluitend insert, new-generation upsert en exacte retirement', () => {
  const matcher = functionSql(
    migration,
    'softora_mailbox_lineage_activation_row_matches_v2'
  );
  assert.match(
    matcher,
    /v_operation = 'INSERT'[\s\S]*p_new_generation_id is distinct from v_new_generation_uuid[\s\S]*p_new_superseded_at is not null/
  );
  assert.match(
    matcher,
    /v_operation = 'UPDATE'[\s\S]*p_old_generation_id is not distinct from v_new_generation_uuid[\s\S]*p_new_generation_id is not distinct from v_new_generation_uuid/
  );
  assert.match(
    matcher,
    /p_old_superseded_at is null[\s\S]*p_new_superseded_at is not null[\s\S]*v_old_generation_is_null[\s\S]*p_old_generation_id is null/
  );
  assert.match(matcher, /\) is not true then/);
  assert.doesNotMatch(matcher, /v_operation = 'DELETE'/);
});

test('batchflag is alleen geldig binnen beide bestaande UID-v2-fences', () => {
  const matcher = functionSql(
    migration,
    'softora_mailbox_lineage_activation_row_matches_v2'
  );
  assert.match(matcher, /softora\.mailbox_sync_per_key_v2/);
  assert.match(matcher, /softora\.mailbox_uid_generation_v2_transition/);
  assert.match(matcher, /is distinct from '1'/);
});

test('finalizer verzamelt één scope, wist de flag en herbouwt één gecombineerde impact', () => {
  assert.match(migration, /v_retired_message_keys text\[\] := '\{\}'::text\[\]/);
  assert.match(migration, /array_agg\(old_message\.message_key order by old_message\.message_key\)/);
  assert.match(migration, /'syncKey', v_sync\.sync_key/);
  assert.match(migration, /'accountEmail', v_sync\.account_email/);
  assert.match(migration, /'folder', v_sync\.folder/);
  assert.match(migration, /'oldGenerationId', v_sync\.active_uid_generation_id/);
  assert.match(migration, /'newGenerationId', p_generation_id/);

  const clearIndex = migration.lastIndexOf(
    "'softora.mailbox_lineage_batch_activation_v2', '', true"
  );
  const staleCleanupIndex = migration.lastIndexOf(
    'update public.softora_mailbox_messages as stale_message'
  );
  const rebuildIndex = migration.lastIndexOf(
    'perform public.softora_refresh_mailbox_activation_lineage_v2('
  );
  assert.ok(clearIndex > 0, 'transactionele batchflag wordt niet expliciet gewist');
  assert.ok(
    staleCleanupIndex > clearIndex,
    'eventuele stale generatie moet na de exacte batchscope regulier worden opgeschoond'
  );
  assert.ok(
    rebuildIndex > staleCleanupIndex,
    'set-based rebuild moet ook de uitzonderlijke stale cleanup meenemen'
  );
  assert.match(
    migration,
    /stale_message\.uid_generation_id is distinct from p_generation_id[\s\S]*stale_message\.generation_superseded_at is null/
  );
  assert.equal(
    (migration.match(/perform public\.softora_refresh_mailbox_activation_lineage_v2\(/g) || []).length,
    1
  );
});

test('set-based helper bewaakt roots, edges, members, discoveries en retired keys', () => {
  const helper = functionSql(
    migration,
    'softora_refresh_mailbox_activation_lineage_v2'
  );
  for (const relation of [
    'softora_mailbox_message_lineage_edges',
    'softora_mailbox_campaign_lineage_roots',
    'softora_mailbox_campaign_lineage_members',
    'softora_mailbox_campaign_lineage_discoveries',
  ]) {
    assert.match(helper, new RegExp(`public\\.${relation}`), `${relation} ontbreekt`);
  }
  assert.match(helper, /softora_rebuild_mailbox_campaign_lineage/);
  assert.match(helper, /generation_superseded_at is not null/);
  assert.match(helper, /message\.deleted_at is not null/);
  assert.match(
    helper,
    /discovery\.active[\s\S]*not exists \([\s\S]*current_member\.message_key = discovery\.message_key[\s\S]*current_member\.root_message_key = discovery\.root_message_key/
  );
  assert.doesNotMatch(
    helper,
    /select message\.message_key\s+from public\.softora_mailbox_messages as message\s+where message\.account_email = v_account_email\s+and public\.softora_normalize_mailbox_message_id\(message\.message_id\)\s+= any \(v_message_ids\)/
  );
  assert.match(helper, /MAILBOX_FINAL_ACTIVATION_LINEAGE_POSTCONDITION_FAILED/);
  assert.match(helper, /MAILBOX_FINAL_ACTIVATION_LINEAGE_RETIRED_SCOPE_INVALID/);
});

test('optimalisatie schakelt geen bestaande mailboxtrigger of veiligheidsfence uit', () => {
  assert.doesNotMatch(migration, /disable trigger/i);
  assert.doesNotMatch(migration, /drop trigger/i);
  assert.doesNotMatch(migration, /statement_timeout|lock_timeout/i);
  assert.doesNotMatch(migration, /softora\.mailbox_campaign_version_bumped[^\n]*''/i);
  assert.match(migration, /softora_replace_final_activation_fragment/);
  assert.match(migration, /MAILBOX_FINAL_ACTIVATION_LINEAGE_PATCH_DRIFT/);
});

test('nieuwe helpers zijn security-invoker en uitsluitend service-role uitvoerbaar', () => {
  for (const name of [
    'softora_mailbox_lineage_activation_row_matches_v2',
    'softora_refresh_mailbox_activation_lineage_v2',
  ]) {
    const sql = functionSql(migration, name);
    assert.match(sql, /security invoker/);
    assert.match(sql, /set search_path = ''/);
  }
  assert.doesNotMatch(migration, /security definer/i);
  assert.equal((migration.match(/from public, anon, authenticated, service_role/g) || []).length, 2);
  assert.equal((migration.match(/to service_role;/g) || []).length, 2);
});

test('echte PostgreSQL-test dekt activatie, schaal, replay, rollback en fail-closed scope', () => {
  assert.match(postgresTest, /20260824224810_optimize_mailbox_final_activation_lineage\.sql/);
  assert.match(postgresTest, /softora_mailbox_message_lineage_edges/);
  assert.match(postgresTest, /softora_mailbox_campaign_lineage_discoveries/);
  assert.match(postgresTest, /legacy NULL-generation/);
  assert.match(postgresTest, /300/);
  assert.match(postgresTest, /750/);
  assert.match(postgresTest, /8s/);
  assert.match(postgresTest, /rollback/);
  assert.match(postgresTest, /replay/i);
  assert.match(postgresTest, /wrong generation must reject/);
  assert.match(postgresTest, /NULL generation must reject/);
  assert.match(postgresTest, /active[\s\S]*root_message_key/);
  assert.match(postgresTest, /MAILBOX_LINEAGE_ACTIVATION_ROW_SCOPE_MISMATCH/);
  assert.equal(
    (postgresTest.match(/'--single-transaction'/g) || []).length,
    2,
    'zowel lokale psql als docker-psql moet één atomaire migratietransactie gebruiken'
  );
});

test('data-ops bootstrap spiegelt de schaalfix byte-exact onder een eigen marker', () => {
  assert.equal(
    markedBlockBetween(schema, scaleStartMarker, scaleEndMarker),
    markedBlockBetween(scaleMigration, scaleStartMarker, scaleEndMarker)
  );
  assert.match(scaleMigration, /notify pgrst, 'reload schema';/);
});

test('prior-state- en canonical-indexen matchen hun exacte querypredicaten', () => {
  const block = markedBlockBetween(scaleMigration, scaleStartMarker, scaleEndMarker);
  const priorIndexSql = block.match(
    /create index if not exists softora_mailbox_messages_prior_state_active_idx[\s\S]*?;/i
  )?.[0] || '';
  assert.notEqual(priorIndexSql, '', 'prior-state-indexdefinitie ontbreekt');
  assert.match(
    priorIndexSql,
    /create index if not exists softora_mailbox_messages_prior_state_active_idx\s+on public\.softora_mailbox_messages\s*\(\s*account_email,\s*folder,\s*public\.softora_normalize_mailbox_message_id\(message_id\),\s*updated_at desc,\s*message_key\s*\)/i
  );
  assert.match(
    priorIndexSql,
    /include\s*\(\s*uid_generation_id,\s*softora_read_at,\s*state_revision,\s*state_mutation_key,\s*state_mutation_at,\s*starred,\s*reply_dismissed_at,\s*deleted_at\s*\)/i
  );
  assert.match(
    priorIndexSql,
    /where\s+generation_superseded_at is null\s+and public\.softora_normalize_mailbox_message_id\(message_id\) is not null/i
  );
  assert.doesNotMatch(priorIndexSql, /deleted_at is null/i);

  const canonicalIndexSql = block.match(
    /drop index if exists public\.softora_mailbox_message_id_exact_lookup_idx;\s*(create index softora_mailbox_message_id_exact_lookup_idx[\s\S]*?;)/i
  )?.[1] || '';
  assert.notEqual(canonicalIndexSql, '', 'canonical Message-ID-index ontbreekt');
  assert.match(
    canonicalIndexSql,
    /create index softora_mailbox_message_id_exact_lookup_idx\s+on public\.softora_mailbox_messages\s*\(\s*account_email,\s*public\.softora_normalize_mailbox_message_id\(message_id\)\s*\)/i
  );
  assert.match(
    canonicalIndexSql,
    /where\s+deleted_at is null\s+and public\.softora_normalize_mailbox_message_id\(message_id\) is not null/i
  );
  assert.doesNotMatch(canonicalIndexSql, /generation_superseded_at is null/i);
  assert.match(
    block,
    /drop index if exists public\.softora_mailbox_message_id_exact_lookup_idx;/i
  );
  assert.match(block, /MAILBOX_FINAL_ACTIVATION_SCALE_CANONICAL_INDEX_DRIFT/);
  assert.match(
    block,
    /MAILBOX_FINAL_ACTIVATION_SCALE_CANONICAL_INDEX_POSTCONDITION_FAILED/
  );
});

test('finalizer materialiseert staged en prior state set-based zonder nieuwe laterale lookup', () => {
  const replacement = replacementFragmentContaining(
    scaleMigration,
    /prior_state as materialized/i,
    'set-based prior-statevervanging'
  );
  assert.match(replacement, /staged_rows as materialized/i);
  assert.match(replacement, /prior_state as materialized/i);
  assert.match(replacement, /public\.softora_normalize_mailbox_message_id/i);
  assert.match(replacement, /old_message\.deleted_at/i);
  assert.match(replacement, /prior\.deleted_at/i);
  assert.match(replacement, /left join prior_state as prior/i);
  assert.doesNotMatch(replacement, /left join lateral/i);
  assert.equal(
    (scaleMigration.match(/left join lateral/gi) || []).length,
    1,
    'alleen het drift-veilige $old$-fragment mag de oude laterale lookup bevatten'
  );
});

test('lineage-resolver wordt eenmaal MATERIALIZED en door beide upserts hergebruikt', () => {
  const replacement = functionSql(
    scaleMigration,
    'softora_rebuild_mailbox_campaign_lineage'
  );
  assert.equal(
    (replacement.match(/public\.softora_resolve_mailbox_campaign_lineage\(/g) || []).length,
    1
  );
  assert.match(replacement, /resolved_lineage as materialized/i);
  assert.match(
    replacement,
    /insert into public\.softora_mailbox_campaign_lineage_discoveries/i
  );
  assert.match(
    replacement,
    /insert into public\.softora_mailbox_campaign_lineage_members/i
  );
});

test('batchscope blijft actief door stale cleanup en wordt pas daarna veilig gewist', () => {
  const replacement = replacementFragments(scaleMigration).join('\n');
  const scopeIndex = replacement.indexOf("'oldGenerationIds', v_retired_generation_ids");
  const staleCleanupIndex = replacement.indexOf(
    'update public.softora_mailbox_messages as old_message'
  );
  const clearIndex = replacement.indexOf(
    "'softora.mailbox_lineage_batch_activation_v2', '', true"
  );
  const rebuildIndex = replacement.indexOf(
    'perform public.softora_refresh_mailbox_activation_lineage_v2('
  );
  assert.ok(scopeIndex >= 0, 'batchscope wordt niet gezet');
  assert.ok(staleCleanupIndex > scopeIndex, 'stale cleanup valt niet binnen de batchscope');
  assert.ok(clearIndex > staleCleanupIndex, 'batchscope wordt vóór stale cleanup gewist');
  assert.ok(rebuildIndex > clearIndex, 'lineage rebuild moet na het veilig wissen volgen');
  assert.match(
    replacement.slice(staleCleanupIndex, clearIndex),
    /old_message\.uid_generation_id is distinct from p_generation_id[\s\S]*?old_message\.generation_superseded_at is null/i
  );
  assert.match(replacement, /v_retired_message_keys/);
  assert.equal(
    (replacement.match(/perform public\.softora_refresh_mailbox_activation_lineage_v2\(/g) || []).length,
    1
  );
});

test('schaalfix verruimt geen timeout, triggerpad of databasebevoegdheid', () => {
  const block = markedBlockBetween(scaleMigration, scaleStartMarker, scaleEndMarker);
  assert.doesNotMatch(
    block,
    /\bset(?:\s+local)?\s+(?:statement_timeout|lock_timeout)\b|\bset_config\s*\(\s*'(?:statement_timeout|lock_timeout)'|\balter\s+role\b[^;]*\bset\s+(?:statement_timeout|lock_timeout)\b/i
  );
  assert.doesNotMatch(block, /disable trigger|drop trigger|session_replication_role/i);
  assert.doesNotMatch(block, /security definer/i);
  assert.doesNotMatch(block, /grant execute[^;]*to (?:public|anon|authenticated)/i);
  assert.doesNotMatch(
    block,
    /create or replace function public\.softora_(?:sync_mailbox_outbound_recipient_guards|record_mailbox_outbound_recipient_guards)\b/i
  );
  assert.match(block, /softora_replace_final_activation_scale_fragment/);
  assert.match(block, /MAILBOX_FINAL_ACTIVATION_SCALE_PATCH_DRIFT/);
});

test('gerichte PostgreSQL-regressie dekt Sent 800, outbound guards, rollback en replay', () => {
  const block = markedBlockBetween(
    postgresTest,
    postgresScaleStartMarker,
    postgresScaleEndMarker
  );
  assert.match(block, /20260825001646_scale_mailbox_final_activation\.sql/);
  assert.match(block, /\bsent\b/i);
  assert.match(block, /\b800\b/);
  assert.match(block, /set local statement_timeout='8s'/i);
  assert.match(block, /softora_sync_mailbox_outbound_recipient_guards/i);
  assert.match(block, /softora_outbound_recipient_guards/i);
  assert.match(block, /pg_get_functiondef/i);
  assert.match(block, /left join lateral/i);
  assert.match(block, /rollback/i);
  assert.match(block, /replay/i);
});
