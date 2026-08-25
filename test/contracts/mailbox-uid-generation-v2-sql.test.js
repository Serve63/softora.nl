const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260821202054_mailbox_uid_generation_epoch_v2.sql'
);
const migration = fs.readFileSync(migrationPath, 'utf8');
const targetOrderRepairMigration = fs.readFileSync(path.join(
  repoRoot,
  'supabase/migrations/20260824180221_fix_mailbox_uid_target_binary_order.sql'
), 'utf8');
const anchorOptimizationMigration = fs.readFileSync(path.join(
  repoRoot,
  'supabase/migrations/20260824190410_optimize_mailbox_target_anchor_validation.sql'
), 'utf8');
const targetManifestCheckpointMigration = fs.readFileSync(path.join(
  repoRoot,
  'supabase/migrations/20260824193645_checkpoint_mailbox_uid_target_manifest.sql'
), 'utf8');
const strongIdentityMutationMigration = fs.readFileSync(path.join(
  repoRoot,
  'supabase/migrations/20260825143830_mailbox_state_mutation_strong_identity.sql'
), 'utf8');
const schema = fs.readFileSync(path.join(repoRoot, 'supabase/data-ops-schema.sql'), 'utf8');

function functionSqlFrom(source, name) {
  const start = source.lastIndexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} ontbreekt`);
  const end = source.indexOf('\n$function$;', start);
  assert.ok(end > start, `${name} heeft geen functie-einde`);
  return source.slice(start, end + '\n$function$;'.length);
}

function functionSql(name) {
  return functionSqlFrom(migration, name);
}

function functionBodyFrom(source, name) {
  const sql = functionSqlFrom(source, name);
  const body = sql.match(/as \$function\$([\s\S]*?)\$function\$;/);
  assert.ok(body, `${name} heeft geen functiebody`);
  return body[1];
}

function frozenCommitPatchLiteral(name) {
  const match = targetManifestCheckpointMigration.match(new RegExp(
    `v_${name} text := \\$${name}\\$([\\s\\S]*?)\\$${name}\\$;`
  ));
  assert.ok(match, `frozen commitpatch-fragment ${name} ontbreekt`);
  return match[1];
}

function applyFrozenCommitPatch(sql) {
  let patched = sql;
  for (const suffix of ['empty', 'anchor', 'steady']) {
    const oldFragment = frozenCommitPatchLiteral(`old_${suffix}`);
    const newFragment = frozenCommitPatchLiteral(`new_${suffix}`);
    assert.equal(
      patched.split(oldFragment).length - 1,
      1,
      `oude frozen commitpatch-fragment ${suffix} moet exact eenmaal bestaan`
    );
    patched = patched.replace(oldFragment, newFragment);
  }
  return patched;
}

function effectiveCommitSql() {
  return applyFrozenCommitPatch(
    functionSql('softora_commit_mailbox_sync_pass_v2').replaceAll(
      "order by target.value #>> '{}'",
      "order by pg_catalog.convert_to(target.value #>> '{}', 'UTF8')"
    )
  );
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

test('data-ops bootstrap spiegelt de volledige v2-functie-eindstaat exact', () => {
  const marker = '-- mailbox-uid-generation-epoch-v2:start';
  const binaryOrderedBootstrap = migration.replaceAll(
    "order by target.value #>> '{}'",
    "order by pg_catalog.convert_to(target.value #>> '{}', 'UTF8')"
  );
  const repairedBootstrap = binaryOrderedBootstrap.replace(
    functionSql('softora_mailbox_target_references_are_anchored'),
    functionSqlFrom(
      anchorOptimizationMigration,
      'softora_mailbox_target_references_are_anchored'
    )
  );
  const finalFunctionSql = new Map();
  for (const source of [repairedBootstrap, targetManifestCheckpointMigration]) {
    const names = source.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g);
    for (const match of names) {
      finalFunctionSql.set(match[1], functionSqlFrom(source, match[1]));
    }
  }
  finalFunctionSql.set(
    'softora_commit_mailbox_sync_pass_v2',
    applyFrozenCommitPatch(functionSqlFrom(
      repairedBootstrap,
      'softora_commit_mailbox_sync_pass_v2'
    ))
  );
  assert.ok(finalFunctionSql.size > 10, 'v2-functieset is onverwacht klein');
  for (const [name, sql] of finalFunctionSql) {
    assert.equal(
      functionSqlFrom(schema, name),
      sql,
      `${name} wijkt af tussen bootstrap en effectieve migratie`
    );
  }
  const bootstrap = schema.slice(schema.indexOf(marker));
  assert.match(bootstrap, /selection_manifest_scanned_through_uid bigint not null default 0/);
  assert.match(bootstrap, /selection_manifest_partial_uids jsonb not null default '\[\]'::jsonb/);
  assert.match(bootstrap, /softora_mailbox_uid_generations_manifest_scan_check/);
  assert.match(bootstrap, /operation in \('commit', 'fail', 'skip', 'checkpoint', 'invalidate'\)/);
  assert.match(bootstrap, /softora_freeze_legacy_mailbox_target_manifest_trigger/);
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

test('prepare, baseline, commit, skip en fail hebben het vaste runtimecontract', () => {
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
  assert.match(migration, /softora_skip_mailbox_sync_v2\(\s*p_sync_key text,\s*p_lock_token text,\s*p_commit_id text,\s*p_reason text/s);
  assert.match(migration, /softora_fail_mailbox_sync_v2\(\s*p_sync_key text,\s*p_lock_token text,\s*p_commit_id text,\s*p_error text/s);
  assert.match(functionSql('softora_prepare_mailbox_uid_generation_v2'), /p_selection_policy not in \('staged-rebuild-v2', 'targeted-sparse-v2'\)/);
});

test('All Mail targetvolgorde is expliciet UTF-8-binair en niet database-locale-afhankelijk', () => {
  assert.match(
    targetOrderRepairMigration,
    /softora_prepare_mailbox_uid_generation_v2\(text,text,bigint,bigint,text,jsonb\)/
  );
  assert.match(
    targetOrderRepairMigration,
    /softora_commit_mailbox_sync_pass_v2\(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint\)/
  );
  assert.match(
    targetOrderRepairMigration,
    /\$old\$order by target\.value #>> '\{\}'\$old\$/
  );
  assert.equal(
    targetOrderRepairMigration.match(
      /order by pg_catalog\.convert_to\(target\.value #>> '\{\}', 'UTF8'\)/g
    )?.length,
    2
  );
  assert.match(targetOrderRepairMigration, /pg_catalog\.pg_get_functiondef\(v_oid\)/);
  assert.doesNotMatch(
    targetOrderRepairMigration,
    /create or replace function public\.softora_(?:prepare_mailbox_uid_generation_v2|commit_mailbox_sync_pass_v2)/
  );
  assert.match(targetOrderRepairMigration, /MAILBOX_UID_TARGET_ORDER_PATCH_DRIFT/);
  assert.equal(
    targetOrderRepairMigration.match(/from public, anon, authenticated/g)?.length,
    2
  );
  assert.equal(targetOrderRepairMigration.match(/to service_role/g)?.length, 2);
  assert.equal(
    schema.match(
      /order by pg_catalog\.convert_to\(target\.value #>> '\{\}', 'UTF8'\)/g
    )?.length,
    2
  );
});

test('All Mail ankervalidatie scant headers set-based en bewaart de beveiligingsgrens', () => {
  const optimized = functionSqlFrom(
    anchorOptimizationMigration,
    'softora_mailbox_target_references_are_anchored'
  );
  const expectedOldBody = anchorOptimizationMigration.match(
    /v_expected_body text := \$expected\$([\s\S]*?)\$expected\$;/
  );
  const expectedNewBodyMd5 = anchorOptimizationMigration.match(
    /v_expected_body_md5 text := '([a-f0-9]{32})'/
  );
  assert.ok(expectedOldBody, 'exacte oude functiebody ontbreekt in preflight');
  assert.ok(expectedNewBodyMd5, 'exacte nieuwe functiehash ontbreekt in postflight');
  assert.equal(
    expectedOldBody[1],
    functionBodyFrom(migration, 'softora_mailbox_target_references_are_anchored')
  );
  assert.equal(
    expectedNewBodyMd5[1],
    crypto.createHash('md5').update(
      functionBodyFrom(
        anchorOptimizationMigration,
        'softora_mailbox_target_references_are_anchored'
      )
    ).digest('hex')
  );
  assert.match(anchorOptimizationMigration, /MAILBOX_TARGET_ANCHOR_OPTIMIZATION_DRIFT/);
  assert.match(anchorOptimizationMigration, /v_body is distinct from v_expected_body/);
  assert.match(optimized, /target_references as materialized/);
  assert.match(optimized, /anchor_rows as materialized/);
  assert.match(optimized, /direct_anchor_references as materialized/);
  assert.match(optimized, /header_anchor_references as materialized/);
  assert.match(optimized, /matched_targets as materialized/);
  assert.match(optimized, /select target\.reference_id[\s\S]*?except[\s\S]*?select matched\.reference_id/);
  assert.match(optimized, /anchor\.account_email = pg_catalog\.lower\(pg_catalog\.btrim\(p_account_email\)\)/);
  assert.match(optimized, /anchor\.folder = any \(array\['inbox', 'sent', 'coldmail'\]/);
  assert.match(optimized, /anchor\.generation_superseded_at is null/);
  assert.match(optimized, /anchor\.deleted_at is null/);
  assert.match(optimized, /softora_is_campaign_mailbox_message/);
  assert.match(optimized, /softora_normalize_mailbox_message_id\(anchor\.message_id\)/);
  assert.match(optimized, /softora_normalize_mailbox_message_id\(anchor\.in_reply_to\)/);
  assert.match(optimized, /regexp_split_to_table/);
  assert.match(
    optimized,
    /join direct_anchor_references as anchor[\s\S]*?anchor\.reference_id = target\.reference_id/
  );
  assert.match(
    optimized,
    /join header_anchor_references as anchor[\s\S]*?anchor\.reference_id = target\.normalized_reference_id/
  );
  assert.doesNotMatch(
    optimized,
    /from pg_catalog\.jsonb_array_elements_text\(p_target_reference_ids\)[\s\S]*?where not exists \([\s\S]*?from public\.softora_mailbox_messages/
  );
  assert.match(
    anchorOptimizationMigration,
    /revoke all on function public\.softora_mailbox_target_references_are_anchored\([\s\S]*?from public, anon, authenticated/
  );
  assert.match(
    anchorOptimizationMigration,
    /grant execute on function public\.softora_mailbox_target_references_are_anchored\([\s\S]*?to service_role/
  );
  assert.match(
    anchorOptimizationMigration,
    /pg_catalog\.md5\(v_body\) is distinct from v_expected_body_md5/
  );
  assert.equal(
    functionSqlFrom(schema, 'softora_mailbox_target_references_are_anchored'),
    optimized
  );
});

test('targetmanifest-checkpoints zijn hervatbaar, idempotent en volledig lease-fenced', () => {
  const prepareV3Sql = functionSqlFrom(
    targetManifestCheckpointMigration,
    'softora_prepare_mailbox_uid_generation_v3'
  );
  const prepareV2CompatibilitySql = functionSqlFrom(
    targetManifestCheckpointMigration,
    'softora_prepare_mailbox_uid_generation_v2'
  );
  const checkpointSql = functionSqlFrom(
    targetManifestCheckpointMigration,
    'softora_checkpoint_mailbox_uid_target_manifest_v2'
  );
  const compatibilityTrigger = functionSqlFrom(
    targetManifestCheckpointMigration,
    'softora_freeze_legacy_mailbox_target_manifest'
  );

  assert.match(targetManifestCheckpointMigration, /add column if not exists selection_manifest_scanned_through_uid bigint/);
  assert.match(targetManifestCheckpointMigration, /add column if not exists selection_manifest_partial_uids jsonb/);
  assert.match(targetManifestCheckpointMigration, /selection_uid_manifest is not null[\s\S]*?then generation\.scan_upper_uid[\s\S]*?else 0/);
  assert.match(targetManifestCheckpointMigration, /selection_manifest_partial_uids = case[\s\S]*?coalesce\(generation\.selection_uid_manifest, '\[\]'::jsonb\)/);
  assert.match(targetManifestCheckpointMigration, /softora_mailbox_uid_generations_manifest_scan_check/);
  assert.match(targetManifestCheckpointMigration, /operation in \('commit', 'fail', 'skip', 'checkpoint', 'invalidate'\)/);

  assert.match(prepareV3Sql, /selection_manifest_scanned_through_uid bigint,[\s\S]*?target_uid_manifest jsonb,[\s\S]*?target_manifest_complete boolean/);
  assert.match(prepareV3Sql, /security invoker[\s\S]*?set search_path = ''/);
  assert.match(prepareV3Sql, /v_active\.scan_upper_uid = v_scan_upper/);
  assert.match(prepareV3Sql, /v_active\.selection_manifest_scanned_through_uid = v_scan_upper/);
  assert.match(prepareV3Sql, /v_active\.selection_uid_manifest is not null[\s\S]*?v_active\.scan_complete/);
  assert.match(prepareV3Sql, /v_pending\.scan_upper_uid <= v_scan_upper[\s\S]*?p_selection_policy = 'targeted-sparse-v2'[\s\S]*?or v_pending\.selection_targets_digest = v_target_digest[\s\S]*?v_pending\.selection_targets = p_selection_targets/);
  const pendingResume = prepareV3Sql.slice(
    prepareV3Sql.indexOf('if v_pending.generation_id is not null'),
    prepareV3Sql.indexOf('if v_pending.generation_id is not null',
      prepareV3Sql.indexOf('if v_pending.generation_id is not null') + 1)
  );
  assert.ok(
    pendingResume.indexOf("p_selection_policy = 'targeted-sparse-v2'") <
      pendingResume.indexOf('v_pending.selection_targets_digest = v_target_digest'),
    'targeted pending moet vóór target-driftvergelijking op zijn bevroren selectie hervatten'
  );
  assert.match(prepareV3Sql, /delete from public\.softora_mailbox_uid_generation_staging[\s\S]*?status = 'abandoned'/);
  assert.match(prepareV3Sql, /v_seed_cursor := v_active\.scan_upper_uid/);
  assert.match(prepareV3Sql, /v_seed_manifest := v_active\.selection_uid_manifest/);
  assert.match(prepareV3Sql, /selection_manifest_scanned_through_uid,[\s\S]*?selection_manifest_partial_uids/);
  assert.match(prepareV2CompatibilitySql, /returns table \(\s*prepared boolean,\s*lock_lost boolean,\s*mode text,\s*reset_detected boolean,\s*resumed boolean,\s*active_generation_id uuid,\s*target_generation_id uuid,\s*current_uid_validity bigint,\s*observed_uid_validity bigint,\s*scan_upper_uid bigint,\s*scanned_through_uid bigint,\s*lease_expires_at timestamptz,\s*selection_targets jsonb\s*\)/s);
  assert.match(prepareV2CompatibilitySql, /from public\.softora_prepare_mailbox_uid_generation_v3/);
  assert.match(prepareV2CompatibilitySql, /language plpgsql[\s\S]*?security invoker[\s\S]*?set search_path = ''/);
  assert.match(prepareV2CompatibilitySql, /v_prepared\.mode = 'rebuild'[\s\S]*?v_prepared\.target_manifest_complete is false/);
  assert.match(prepareV2CompatibilitySql, /selection_uid_manifest is null[\s\S]*?scanned_through_uid = 0[\s\S]*?not exists \([\s\S]*?softora_mailbox_uid_generation_staging/);
  assert.match(prepareV2CompatibilitySql, /set selection_manifest_scanned_through_uid = 0,[\s\S]*?selection_manifest_partial_uids = '\[\]'::jsonb/);
  assert.match(prepareV2CompatibilitySql, /MAILBOX_UID_LEGACY_TARGET_MANIFEST_INCOMPATIBLE/);
  assert.doesNotMatch(prepareV2CompatibilitySql, /selection_manifest_scanned_through_uid bigint/);

  assert.match(targetManifestCheckpointMigration, /softora_checkpoint_mailbox_uid_target_manifest_v2\(\s*p_sync_key text,\s*p_lock_token text,\s*p_checkpoint_id text,\s*p_generation_id uuid,\s*p_uid_validity bigint,\s*p_expected_scanned_through_uid bigint,\s*p_scanned_through_uid bigint,\s*p_found_uids jsonb,\s*p_scan_complete boolean/s);
  assert.match(checkpointSql, /returns table \(\s*checkpointed boolean,\s*lock_lost boolean,\s*replayed boolean,\s*scanned_through_uid bigint,\s*target_uid_manifest jsonb,\s*scan_complete boolean,\s*lock_released boolean/s);
  assert.match(checkpointSql, /security invoker[\s\S]*?set search_path = ''/);
  assert.match(checkpointSql, /select distinct \(found\.value #>> '\{\}'\)::bigint as uid/);
  assert.match(checkpointSql, /p_found_uids is distinct from \([\s\S]*?jsonb_agg\(valid\.uid order by valid\.uid\)/);
  assert.match(checkpointSql, /'operation', 'checkpoint',[\s\S]*?'lockToken', v_lock_token,[\s\S]*?'expectedScannedThroughUid'/);
  assert.match(checkpointSql, /v_existing\.status = 'completed'[\s\S]*?return query select true, false, true/);
  assert.match(checkpointSql, /status <> 'syncing'[\s\S]*?lock_token is distinct from v_lock_token[\s\S]*?lock_expires_at <= pg_catalog\.clock_timestamp\(\)/);
  assert.match(checkpointSql, /pg_advisory_xact_lock\(824031, 3\)/);
  assert.match(checkpointSql, /softora_mailbox_campaign_consistency[\s\S]*?scope = 'campaign' for update/);
  assert.match(checkpointSql, /insert into public\.softora_mailbox_uid_generation_commits[\s\S]*?'checkpoint'[\s\S]*?'pending'/);
  assert.match(checkpointSql, /from public\.softora_mailbox_uid_generation_commits[\s\S]*?for update/);
  assert.match(checkpointSql, /from public\.softora_mailbox_sync_state[\s\S]*?for update/);
  assert.match(checkpointSql, /order by generation\.generation_id[\s\S]*?for update/);
  assert.match(checkpointSql, /generation_id is distinct from v_sync\.pending_uid_generation_id/);
  assert.match(checkpointSql, /selection_policy <> 'targeted-sparse-v2'/);
  assert.match(checkpointSql, /selection_manifest_scanned_through_uid[\s\S]*?<> p_expected_scanned_through_uid/);
  assert.match(checkpointSql, /p_scanned_through_uid > v_generation\.scan_upper_uid/);
  assert.match(checkpointSql, /p_scan_complete is distinct from[\s\S]*?p_scanned_through_uid = v_generation\.scan_upper_uid/);
  assert.match(checkpointSql, /MAILBOX_UID_TARGET_MANIFEST_UID_OUT_OF_WINDOW/);
  assert.match(checkpointSql, /MAILBOX_UID_TARGET_MANIFEST_STORED_INVALID/);
  assert.match(checkpointSql, /union[\s\S]*?jsonb_array_elements\(p_found_uids\)/);
  assert.match(checkpointSql, /selection_manifest_scanned_through_uid = p_scanned_through_uid,[\s\S]*?selection_manifest_partial_uids = v_next_manifest,[\s\S]*?selection_uid_manifest = case when p_scan_complete/);
  assert.match(checkpointSql, /if not p_scan_complete then[\s\S]*?status = 'idle'[\s\S]*?lock_token = null/);
  assert.match(checkpointSql, /set status = 'completed', result = v_result/);

  assert.match(compatibilityTrigger, /old\.selection_uid_manifest is null[\s\S]*?new\.selection_uid_manifest is not null/);
  assert.match(compatibilityTrigger, /old\.selection_manifest_scanned_through_uid = 0[\s\S]*?old\.selection_manifest_partial_uids = '\[\]'::jsonb/);
  assert.match(compatibilityTrigger, /MAILBOX_UID_TARGET_MANIFEST_CHECKPOINT_REQUIRED/);
  assert.match(targetManifestCheckpointMigration, /before update of selection_uid_manifest[\s\S]*?softora_freeze_legacy_mailbox_target_manifest\(\)/);

  assert.match(targetManifestCheckpointMigration, /revoke all on function public\.softora_checkpoint_mailbox_uid_target_manifest_v2\([\s\S]*?from public, anon, authenticated, service_role/);
  assert.match(targetManifestCheckpointMigration, /grant execute on function public\.softora_checkpoint_mailbox_uid_target_manifest_v2\([\s\S]*?to service_role/);
});

test('verdwenen frozen UIDs invalideren alleen het manifestzaad en nooit zichtbare active inhoud', () => {
  const invalidationSql = functionSqlFrom(
    targetManifestCheckpointMigration,
    'softora_invalidate_mailbox_uid_target_manifest_v2'
  );
  assert.match(invalidationSql, /returns table \(\s*invalidated boolean,\s*lock_lost boolean,\s*replayed boolean,\s*generation_role text,\s*pending_abandoned boolean,\s*active_manifest_invalidated boolean,\s*lock_released boolean/s);
  assert.match(invalidationSql, /security invoker[\s\S]*?set search_path = ''/);
  assert.ok(
    invalidationSql.indexOf("is distinct from 'array' then") <
      invalidationSql.indexOf('jsonb_array_length(p_missing_uids) not between'),
    'scalar/null missing-Uids moeten vóór array_length fail-closed stoppen'
  );
  assert.match(invalidationSql, /p_missing_uids is distinct from \([\s\S]*?jsonb_agg\(valid\.uid order by valid\.uid\)/);
  assert.match(invalidationSql, /'operation', 'invalidate'[\s\S]*?'expectedStagedCount'[\s\S]*?'missingUids'/);
  assert.match(invalidationSql, /v_existing\.status = 'completed'[\s\S]*?return query select true, false, true/);
  const mutationPath = invalidationSql.slice(
    invalidationSql.indexOf('perform pg_catalog.pg_advisory_xact_lock')
  );
  assert.ok(mutationPath.indexOf('softora_mailbox_campaign_consistency') < mutationPath.indexOf('insert into public.softora_mailbox_uid_generation_commits'));
  assert.ok(mutationPath.indexOf('insert into public.softora_mailbox_uid_generation_commits') < mutationPath.indexOf('from public.softora_mailbox_sync_state'));
  assert.ok(mutationPath.indexOf('from public.softora_mailbox_sync_state') < mutationPath.indexOf('from public.softora_mailbox_uid_generations'));
  assert.match(invalidationSql, /insert into public\.softora_mailbox_uid_generation_commits[\s\S]*?exception\s+when foreign_key_violation then[\s\S]*?MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_CONFLICT/);
  assert.match(invalidationSql, /p_generation_id = v_sync\.pending_uid_generation_id[\s\S]*?v_generation_role := 'pending'/);
  assert.match(invalidationSql, /p_generation_id = v_sync\.active_uid_generation_id[\s\S]*?v_generation_role := 'active'/);
  assert.match(invalidationSql, /manifest\.ordinality > v_generation\.scanned_through_uid/);
  assert.match(invalidationSql, /p_expected_staged_count <> v_generation\.scanned_through_uid/);
  assert.match(invalidationSql, /delete from public\.softora_mailbox_uid_generation_staging[\s\S]*?status = 'abandoned'/);
  assert.match(invalidationSql, /selection_manifest_seed_invalidated_at = coalesce/);
  assert.match(invalidationSql, /pending_uid_generation_id = case when v_generation_role = 'pending'[\s\S]*?status = 'idle'[\s\S]*?lock_token = null/);
  assert.doesNotMatch(invalidationSql, /update public\.softora_mailbox_messages/);
  assert.doesNotMatch(invalidationSql, /content_version\s*=/);
  assert.match(targetManifestCheckpointMigration, /revoke all on function public\.softora_invalidate_mailbox_uid_target_manifest_v2\([\s\S]*?from public, anon, authenticated, service_role/);
  assert.match(targetManifestCheckpointMigration, /grant execute on function public\.softora_invalidate_mailbox_uid_target_manifest_v2\([\s\S]*?to service_role/);
});

test('frozen-target commitpatch is byte-exact, drift-fenced en accepteert lege targeted snapshots', () => {
  const commitSql = effectiveCommitSql();
  assert.match(targetManifestCheckpointMigration, /pg_get_functiondef\(v_oid\)/);
  assert.match(targetManifestCheckpointMigration, /MAILBOX_UID_FROZEN_TARGET_COMMIT_PATCH_DRIFT/);
  assert.match(targetManifestCheckpointMigration, /v_occurrences <> 1/);
  assert.match(targetManifestCheckpointMigration, /execute v_definition/);
  assert.doesNotMatch(
    targetManifestCheckpointMigration,
    /drop function[^;]*softora_commit_mailbox_sync_pass_v2/i
  );
  assert.equal(
    functionSqlFrom(schema, 'softora_commit_mailbox_sync_pass_v2'),
    commitSql
  );
  assert.doesNotMatch(commitSql, /jsonb_array_length\(p_target_reference_ids\) = 0/);
  assert.match(commitSql, /v_generation\.selection_targets is distinct from p_target_reference_ids/);
  assert.match(commitSql, /v_generation\.selection_uid_manifest is null/);
  assert.match(commitSql, /v_generation\.selection_manifest_seed_invalidated_at is not null/);
  assert.doesNotMatch(commitSql, /softora_mailbox_target_references_are_anchored/);
});

test('migratie schakelt alleen na een lege drain atomisch van draining naar v2', () => {
  const preflightStart = migration.indexOf('do $uid_protocol_preflight$');
  const schemaStart = migration.indexOf('create table if not exists public.softora_mailbox_uid_generations');
  const activateStart = migration.indexOf('do $uid_protocol_activate$');
  assert.ok(preflightStart >= 0 && preflightStart < schemaStart);
  assert.ok(activateStart > migration.indexOf('softora_fail_mailbox_sync_v2'));
  assert.ok(activateStart > migration.indexOf('softora_skip_mailbox_sync_v2'));

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
    'softora_skip_mailbox_sync_v2',
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

  const skipSql = functionSql('softora_skip_mailbox_sync_v2');
  const skipLockPath = skipSql.slice(skipSql.indexOf('perform pg_catalog.pg_advisory_xact_lock'));
  assert.ok(skipLockPath.indexOf('softora_mailbox_campaign_consistency') < skipLockPath.indexOf('from public.softora_mailbox_uid_generation_commits'));
  assert.ok(skipLockPath.indexOf('from public.softora_mailbox_uid_generation_commits') < skipLockPath.indexOf('from public.softora_mailbox_sync_state'));
  assert.ok(skipLockPath.indexOf('from public.softora_mailbox_sync_state') < skipLockPath.indexOf('from public.softora_mailbox_uid_generations'));
  assert.match(skipSql, /'operation', 'skip', 'syncKey', v_sync_key,[\s\S]*?'lockToken', v_lock_token, 'reason', v_reason/);
  assert.match(migration, /operation in \('commit', 'fail', 'skip'\)/);
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
  const prepareSql = functionSqlFrom(
    targetManifestCheckpointMigration,
    'softora_prepare_mailbox_uid_generation_v3'
  );
  const commitSql = effectiveCommitSql();
  for (const sql of [prepareSql, commitSql]) {
    assert.match(sql, /v_sync\.folder = 'allmail'[\s\S]*?p_selection_policy <> 'targeted-sparse-v2'[\s\S]*?MAILBOX_UID_ALLMAIL_SELECTION_POLICY_REQUIRED/);
  }
  assert.match(prepareSql, /softora_mailbox_target_references_are_anchored/);
  assert.doesNotMatch(commitSql, /softora_mailbox_target_references_are_anchored/);
  assert.match(commitSql, /v_generation\.selection_targets is distinct from p_target_reference_ids/);
  assert.match(commitSql, /v_generation\.selection_manifest_partial_uids[\s\S]*?= v_generation\.selection_uid_manifest/);
  assert.match(commitSql, /v_generation\.generation_id = v_sync\.pending_uid_generation_id[\s\S]*?selection_uid_manifest is null[\s\S]*?selection_manifest_partial_uids = '\[\]'::jsonb/);
  assert.match(commitSql, /v_generation\.selection_manifest_seed_invalidated_at is not null/);
  assert.match(commitSql, /jsonb_array_elements\(\s*v_generation\.selection_uid_manifest\s*\)[\s\S]*?= \(selected\.value #>> '\{\}'\)::bigint/);
  assert.doesNotMatch(
    commitSql,
    /jsonb_array_length\(p_target_reference_ids\) = 0[\s\S]*?p_last_uid <> 0/
  );
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

test('onvolledige/dubbele replays falen dicht en skip/fail bewaren cursor/generation', () => {
  const commitSql = functionSql('softora_commit_mailbox_sync_pass_v2');
  const skipSql = functionSql('softora_skip_mailbox_sync_v2');
  const failSql = functionSql('softora_fail_mailbox_sync_v2');
  assert.match(commitSql, /payload_digest/);
  assert.match(commitSql, /MAILBOX_UID_GENERATION_REPLAY_MISMATCH/);
  assert.match(commitSql, /status = 'completed'[\s\S]*?return query select true, true/);
  assert.match(failSql, /MAILBOX_UID_GENERATION_REPLAY_MISMATCH/);
  const failUpdate = failSql.slice(failSql.indexOf('update public.softora_mailbox_sync_state'));
  assert.doesNotMatch(failUpdate, /last_uid\s*=/);
  assert.doesNotMatch(failUpdate, /active_uid_generation_id\s*=/);
  assert.doesNotMatch(failUpdate, /pending_uid_generation_id\s*=/);
  assert.match(skipSql, /v_reason <> 'folder_missing'/);
  assert.match(skipSql, /MAILBOX_UID_GENERATION_REPLAY_MISMATCH/);
  assert.match(skipSql, /return query select true, true, false/);
  assert.match(skipSql, /return query select false, false, true/);
  const skipUpdate = skipSql.slice(skipSql.indexOf('update public.softora_mailbox_sync_state'));
  assert.doesNotMatch(skipUpdate, /last_uid\s*=/);
  assert.doesNotMatch(skipUpdate, /message_count\s*=/);
  assert.doesNotMatch(skipUpdate, /uid_validity\s*=/);
  assert.doesNotMatch(skipUpdate, /active_uid_generation_id\s*=/);
  assert.doesNotMatch(skipUpdate, /pending_uid_generation_id\s*=/);
  assert.match(skipUpdate, /state\.lock_token is not distinct from v_lock_token/);
});

test('state-mutatie sluit superseded generaties uit bij hergebruikte UID', () => {
  const sql = functionSql('softora_apply_mailbox_state_mutation');
  assert.match(sql, /message\.generation_superseded_at is null/);
  assert.match(sql, /message\.deleted_at is null/);
  assert.match(sql, /lower\(pg_catalog\.btrim\(message\.account_email\)\)[\s\S]*?lower\(pg_catalog\.btrim\(p_account_email\)\)/);
  assert.match(sql, /pg_advisory_xact_lock\(824031, 3\)/);
  assert.ok(sql.indexOf('pg_advisory_xact_lock(824031, 3)') < sql.indexOf('softora_mailbox_campaign_consistency'));
  assert.ok(sql.indexOf('softora_mailbox_campaign_consistency') < sql.indexOf('from public.softora_mailbox_messages'));
});

test('v2 state-mutatie bindt een hergebruikte UID aan de exacte actieve messageKey', () => {
  const sql = functionSqlFrom(
    strongIdentityMutationMigration,
    'softora_apply_mailbox_state_mutation_v2'
  );
  assert.match(sql, /where message\.message_key = v_expected_message_key/);
  assert.match(sql, /message\.generation_superseded_at is null/);
  assert.match(sql, /message\.deleted_at is null/);
  assert.match(sql, /v_row\.uid is distinct from p_uid/);
  assert.match(sql, /v_row\.provider_id is distinct from pg_catalog\.btrim\(p_provider_id\)/);
  assert.match(sql, /softora_normalize_mailbox_message_id\(v_row\.message_id\)[\s\S]*?is distinct from v_expected_message_id/);
  assert.match(sql, /message = 'MAILBOX_STATE_MESSAGE_IDENTITY_MISMATCH'/);
  assert.ok(sql.indexOf('for update') < sql.indexOf('softora_apply_mailbox_state_mutation('));
  assert.match(strongIdentityMutationMigration, /revoke all on function public\.softora_apply_mailbox_state_mutation_v2\([\s\S]*?from public, anon, authenticated, service_role/);
  assert.match(strongIdentityMutationMigration, /grant execute on function public\.softora_apply_mailbox_state_mutation_v2\([\s\S]*?to service_role/);
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
    'softora_skip_mailbox_sync_v2',
    'softora_fail_mailbox_sync_v2',
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${name}[\\s\\S]*?from public, anon, authenticated, service_role`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}[\\s\\S]*?to service_role`));
  }
  assert.match(migration, /revoke all on function public\.softora_apply_mailbox_state_mutation\([\s\S]*?from public, anon, authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.softora_apply_mailbox_state_mutation\([\s\S]*?to service_role/);
  assert.match(migration, /comment on function public\.softora_skip_mailbox_sync_v2/);
  assert.match(migration, /notify pgrst, 'reload schema';/);
});

test('beide generation-FKs op sync-state hebben gerichte partial indexes', () => {
  assert.match(migration, /softora_mailbox_sync_state_active_uid_generation_idx[\s\S]*?\(active_uid_generation_id\)[\s\S]*?where active_uid_generation_id is not null/);
  assert.match(migration, /softora_mailbox_sync_state_pending_uid_generation_idx[\s\S]*?\(pending_uid_generation_id\)[\s\S]*?where pending_uid_generation_id is not null/);
});

test('bestaande mailboxselectie- en cosmetische filters worden niet hergedefinieerd', () => {
  for (const sql of [
    migration,
    targetOrderRepairMigration,
    anchorOptimizationMigration,
    targetManifestCheckpointMigration,
    strongIdentityMutationMigration,
  ]) {
    assert.doesNotMatch(sql, /create or replace function public\.softora_is_campaign_mailbox_message/);
    assert.doesNotMatch(sql, /softora_filter_mailbox_outreach_contacts/);
    assert.doesNotMatch(sql, /premium-mailbox|quoted|autoreply|signature-(?:block|filter|cleanup)/i);
  }
});
