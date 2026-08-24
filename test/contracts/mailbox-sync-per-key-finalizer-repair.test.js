const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.resolve(
  __dirname,
  '../../supabase/migrations/20260824120423_mailbox_sync_per_key_finalizer_repair.sql'
), 'utf8');
const uidV2Migration = fs.readFileSync(path.resolve(
  __dirname,
  '../../supabase/migrations/20260821202054_mailbox_uid_generation_epoch_v2.sql'
), 'utf8');
const atomicMessageCommitMigration = fs.readFileSync(path.resolve(
  __dirname,
  '../../supabase/migrations/20260810032742_mailbox_campaign_atomic_message_commit.sql'
), 'utf8');
const acceptedTimelineMigration = fs.readFileSync(path.resolve(
  __dirname,
  '../../supabase/migrations/20260824120230_mailbox_contact_timeline_send_provenance.sql'
), 'utf8');

test('UID-v2-mutaties gebruiken een per-sync-key fence en behouden de globale capaciteitspoort', () => {
  assert.match(migration, /pg_advisory_xact_lock\(\s*824032,\s*pg_catalog\.hashtext\(v_sync_key\)/);
  assert.match(migration, /softora_lock_mailbox_sync_key_v2\(v_sync_key\)/);
  assert.match(migration, /p_account_email[\s\S]*\|[\s\S]*p_folder/);
  assert.match(migration, /softora_lock_mailbox_sync_capacity[\s\S]*pg_advisory_xact_lock\(824031, 3\)/);
  assert.match(migration, /softora_claim_mailbox_sync_lock[\s\S]*where consistency\.scope = 'campaign';/);
  assert.doesNotMatch(migration, /statement_timeout|lock_timeout|MAILBOX_SUPABASE_RPC_TIMEOUT/);
});

test('visibility, v2-sync en directe writers delen één vaste deadlockvrije lockvolgorde', () => {
  assert.match(
    migration,
    /softora_lock_mailbox_visibility_shared_v2\(\)[\s\S]*pg_advisory_xact_lock_shared\(824033, 1\)/
  );
  assert.match(
    migration,
    /softora_lock_mailbox_visibility_exclusive\(\)[\s\S]*pg_advisory_xact_lock\(824033, 1\)/
  );

  const syncFence = migration.match(
    /create or replace function public\.softora_lock_mailbox_sync_key_v2\([\s\S]*?\n\$function\$;/
  );
  assert.ok(syncFence);
  assert.ok(
    syncFence[0].indexOf('softora_lock_mailbox_visibility_shared_v2()')
      < syncFence[0].indexOf('pg_catalog.hashtext(v_sync_key)'),
    'de gedeelde visibility-fence moet vóór de per-key fence worden genomen'
  );

  const directWriterFence = migration.match(
    /create or replace function public\.softora_lock_mailbox_campaign_consistency_before_write\(\)[\s\S]*?\n\$function\$;/
  );
  assert.ok(directWriterFence);
  assert.ok(
    directWriterFence[0].indexOf('softora_lock_mailbox_visibility_exclusive()')
      < directWriterFence[0].indexOf('softora_mailbox_campaign_consistency'),
    'directe writers moeten exclusief fencen vóór de campaign-row'
  );
  assert.match(
    atomicMessageCommitMigration,
    /before insert or update or delete or truncate on public\.softora_mailbox_messages[\s\S]*execute function public\.softora_lock_mailbox_campaign_consistency_before_write\(\)/
  );
  assert.match(
    acceptedTimelineMigration,
    /before insert or update or delete[\s\S]*on public\.softora_mailbox_send_provenance[\s\S]*for each row[\s\S]*execute function public\.softora_lock_mailbox_send_provenance_visible_change\(\)/
  );
  assert.match(
    acceptedTimelineMigration,
    /before truncate on public\.softora_mailbox_send_provenance[\s\S]*for each statement[\s\S]*execute function public\.softora_lock_mailbox_campaign_consistency_before_write\(\)/
  );
  const provenanceFence = migration.match(
    /create or replace function public\.softora_lock_mailbox_send_provenance_visible_change\(\)[\s\S]*?\n\$function\$;/
  );
  assert.ok(provenanceFence);
  assert.match(provenanceFence[0], /old\.status = 'accepted'[\s\S]*new\.status = 'accepted'/);
  assert.ok(
    provenanceFence[0].indexOf('softora_lock_mailbox_visibility_exclusive()')
      < provenanceFence[0].indexOf('softora_mailbox_campaign_consistency'),
    'alleen accepted-visible provenance moet exclusief fencen vóór de campaign-row'
  );

  for (const signature of [
    'public.softora_set_mailbox_message_visibility(text,text,bigint,text,boolean)',
    'public.softora_set_mailbox_contact_visibility(text[],text,text,text,bigint,text,integer,boolean)',
  ]) {
    assert.match(migration, new RegExp(
      signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        + '[\\s\\S]*?softora_lock_mailbox_visibility_exclusive\\(\\);'
        + '[\\s\\S]*?insert into public\\.softora_mailbox_campaign_consistency'
    ));
  }

  for (const signature of [
    'public.softora_apply_mailbox_uid_validity(text,text,bigint,text)',
    'public.softora_commit_mailbox_campaign_messages(uuid,text,jsonb,jsonb)',
  ]) {
    assert.match(migration, new RegExp(
      signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        + '[\\s\\S]*?softora_lock_mailbox_visibility_exclusive\\(\\);'
        + '[\\s\\S]*?pg_advisory_xact_lock\\(824031, 3\\)'
    ));
  }

  assert.doesNotMatch(
    syncFence[0],
    /pg_advisory_xact_lock\(824031, 3\)|for update/
  );
});

test('lineage-refresh blijft bestaan en alleen de exacte shape-CHECK wordt deferred', () => {
  assert.match(migration, /tgname = 'softora_refresh_mailbox_message_lineage'/);
  assert.doesNotMatch(
    migration,
    /drop trigger(?: if exists)? softora_refresh_mailbox_message_lineage/i
  );
  assert.equal((migration.match(/drop constraint /g) || []).length, 1);
  assert.match(
    migration,
    /drop constraint softora_mailbox_campaign_lineage_members_check;/
  );
  assert.match(
    migration,
    /create constraint trigger softora_mailbox_campaign_lineage_member_shape_deferred[\s\S]*deferrable initially deferred/
  );
  assert.match(migration, /from public\.softora_mailbox_campaign_lineage_members as member/);
});

test('normale staged rebuilds worden generiek en targeted-sparse-beveiliging blijft intact', () => {
  assert.match(migration, /remove non-campaign staged-rebuild rejection/);
  assert.match(migration, /Only the[\s\S]*sparse All Mail policy is campaign-specific/);
  assert.doesNotMatch(
    migration,
    /remove non-campaign targeted-sparse|disable targeted-sparse/i
  );
  assert.match(migration, /p_selection_policy = 'targeted-sparse-v2'/);
  assert.match(uidV2Migration, /softora_mailbox_row_matches_target_references/);
  assert.match(uidV2Migration, /MAILBOX_UID_TARGET_REFERENCES_UNANCHORED/);
});
