-- mailbox-sync-per-key-finalizer-repair:start
--
-- The UID-v2 rollout intentionally kept the legacy global mailbox fence. In
-- production that made every account wait behind one long finalizer and the
-- eight-second client deadline could expire before an RPC entered its own
-- transaction. Keep the global fence for the short protocol/capacity claim,
-- but serialize every v2 mutation by its own sync_key afterwards.

do $preflight$
declare
  v_protocol text;
  v_signature text;
begin
  select consistency.uid_generation_protocol into v_protocol
  from public.softora_mailbox_campaign_consistency as consistency
  where consistency.scope = 'campaign';
  if not found or v_protocol is distinct from 'v2' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_SYNC_PER_KEY_REPAIR_REQUIRES_V2';
  end if;

  foreach v_signature in array array[
    'public.softora_claim_mailbox_sync_lock(text,text,text,text,integer,boolean,text)',
    'public.softora_prepare_mailbox_uid_generation_v2(text,text,bigint,bigint,text,jsonb)',
    'public.softora_confirm_mailbox_uid_baseline_v2(text,text,uuid,bigint,jsonb)',
    'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
    'public.softora_skip_mailbox_sync_v2(text,text,text,text)',
    'public.softora_fail_mailbox_sync_v2(text,text,text,text)',
    'public.softora_apply_mailbox_state_mutation(text,text,bigint,text,text,bigint,boolean,boolean)',
    'public.softora_set_mailbox_message_visibility(text,text,bigint,text,boolean)',
    'public.softora_set_mailbox_contact_visibility(text[],text,text,text,bigint,text,integer,boolean)',
    'public.softora_apply_mailbox_uid_validity(text,text,bigint,text)',
    'public.softora_commit_mailbox_campaign_messages(uuid,text,jsonb,jsonb)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception using errcode = '55000',
        message = 'MAILBOX_SYNC_PER_KEY_REPAIR_FUNCTION_MISSING',
        detail = v_signature;
    end if;
  end loop;
end;
$preflight$;

-- Shared holders are independent UID-v2 sync keys. Visibility and every
-- legacy/direct message writer take the exclusive side before touching the
-- campaign row or concrete messages. This preserves cross-account sync
-- parallelism while making the global order visibility -> per-key/campaign ->
-- message -> late version bump impossible to invert.
create or replace function public.softora_lock_mailbox_visibility_shared_v2()
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(824033, 1);
end;
$function$;

create or replace function public.softora_lock_mailbox_visibility_exclusive()
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(824033, 1);
end;
$function$;

-- Provenance reserve/start/unknown/fail writes are not visible mailbox data and
-- must never queue behind an active sync. Accepted-visible transitions take the
-- exclusive fence before the campaign row, so hide/restore stays atomic.
create or replace function public.softora_lock_mailbox_send_provenance_visible_change()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_old_visible boolean := false;
  v_new_visible boolean := false;
begin
  v_old_visible := tg_op in ('UPDATE', 'DELETE')
    and old.status = 'accepted'
    and old.accepted_at is not null
    and public.softora_normalize_mailbox_message_id(old.sent_message_id) is not null;
  v_new_visible := tg_op in ('INSERT', 'UPDATE')
    and new.status = 'accepted'
    and new.accepted_at is not null
    and public.softora_normalize_mailbox_message_id(new.sent_message_id) is not null;
  if v_old_visible or v_new_visible then
    perform public.softora_lock_mailbox_visibility_exclusive();
    insert into public.softora_mailbox_campaign_consistency (scope, content_version)
    values ('campaign', 0) on conflict (scope) do nothing;
    perform 1 from public.softora_mailbox_campaign_consistency
    where scope = 'campaign' for update;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

drop trigger if exists softora_lock_mailbox_send_provenance_consistency_before_write
  on public.softora_mailbox_send_provenance;
create trigger softora_lock_mailbox_send_provenance_consistency_before_write
before insert or update or delete
on public.softora_mailbox_send_provenance
for each row
execute function public.softora_lock_mailbox_send_provenance_visible_change();

drop trigger if exists softora_lock_mailbox_send_provenance_consistency_before_truncate
  on public.softora_mailbox_send_provenance;
create trigger softora_lock_mailbox_send_provenance_consistency_before_truncate
before truncate on public.softora_mailbox_send_provenance
for each statement
execute function public.softora_lock_mailbox_campaign_consistency_before_write();

create or replace function public.softora_lock_mailbox_sync_key_v2(
  p_sync_key text
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_sync_key text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_sync_key, '')));
  v_protocol text;
begin
  if v_sync_key = '' or pg_catalog.char_length(v_sync_key) > 600
    or position('|' in v_sync_key) < 2 then
    raise exception using errcode = '22023',
      message = 'MAILBOX_SYNC_KEY_FENCE_INVALID';
  end if;

  -- Visibility must be the first cross-domain fence. Equal sync keys then
  -- serialize behind their own key; different accounts retain shared access.
  perform public.softora_lock_mailbox_visibility_shared_v2();

  -- A hash collision can only serialize two unrelated folders; it cannot let
  -- equal keys pass each other. A separate namespace avoids the capacity lock.
  perform pg_catalog.pg_advisory_xact_lock(
    824032,
    pg_catalog.hashtext(v_sync_key)
  );

  select consistency.uid_generation_protocol into v_protocol
  from public.softora_mailbox_campaign_consistency as consistency
  where consistency.scope = 'campaign';
  if not found or v_protocol is distinct from 'v2' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_SYNC_KEY_FENCE_PROTOCOL_INVALID';
  end if;

  perform pg_catalog.set_config(
    'softora.mailbox_sync_per_key_v2', '1', true
  );
end;
$function$;

create or replace function public.softora_bump_mailbox_campaign_version_v2(
  p_account_email text,
  p_folder text,
  p_visible_changed boolean
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_account_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_account_email, '')));
  v_folder text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_folder, '')));
begin
  if coalesce(p_visible_changed, false) is not true then
    return;
  end if;
  if v_folder = 'allmail' then
    v_folder := 'inbox';
  end if;
  if not public.softora_is_campaign_mailbox_message(
    v_account_email, v_folder, '{}'::jsonb
  ) then
    return;
  end if;

  update public.softora_mailbox_campaign_consistency as consistency
  set content_version = consistency.content_version + 1,
      updated_at = pg_catalog.clock_timestamp()
  where consistency.scope = 'campaign';
  if not found then
    raise exception using errcode = '55000',
      message = 'MAILBOX_CAMPAIGN_FENCE_MISSING';
  end if;
end;
$function$;

-- The statement trigger still protects old/direct lease claims. A v2 caller
-- already owns its per-key fence, so reacquiring the global capacity fence on
-- a cursor/pointer/finalizer update would recreate the production queue.
create or replace function public.softora_lock_mailbox_sync_capacity()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  if coalesce(pg_catalog.current_setting(
    'softora.mailbox_sync_per_key_v2', true
  ), '') = '1' then
    return null;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  return null;
end;
$function$;

-- Keep direct writers on the existing campaign fence. V2 writers bump the
-- same content_version once, near transaction completion, after their visible
-- message work. This shortens the singleton row-lock to the final few writes.
create or replace function public.softora_lock_mailbox_campaign_consistency_before_write()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  if coalesce(pg_catalog.current_setting(
    'softora.mailbox_sync_per_key_v2', true
  ), '') = '1' then
    return null;
  end if;
  perform public.softora_lock_mailbox_visibility_exclusive();
  insert into public.softora_mailbox_campaign_consistency (scope, content_version)
  values ('campaign', 0) on conflict (scope) do nothing;
  perform 1 from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  return null;
end;
$function$;

-- Patch only exact, reviewed bodies. The migration aborts if production does
-- not match the tracked v2 definitions; it never guesses around schema drift.
create or replace function pg_temp.softora_replace_mailbox_function_fragment(
  p_signature text,
  p_old text,
  p_new text,
  p_label text
)
returns void
language plpgsql
volatile
set search_path = ''
as $function$
declare
  v_oid pg_catalog.oid := pg_catalog.to_regprocedure(p_signature);
  v_definition text;
  v_matches integer;
begin
  if v_oid is null or coalesce(p_old, '') = '' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_SYNC_REPAIR_PATCH_TARGET_INVALID', detail = p_label;
  end if;
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  v_matches := (
    pg_catalog.char_length(v_definition)
    - pg_catalog.char_length(pg_catalog.replace(v_definition, p_old, ''))
  ) / pg_catalog.char_length(p_old);
  if v_matches <> 1 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_SYNC_REPAIR_PATCH_DRIFT',
      detail = p_label || ': expected one fragment, found ' || v_matches::text;
  end if;
  execute pg_catalog.replace(v_definition, p_old, p_new);
end;
$function$;

-- Claims keep the global capacity decision, but the irreversible v2 protocol
-- can be read under that advisory fence without holding the singleton row
-- while waiting for one folder's sync-state row.
select pg_temp.softora_replace_mailbox_function_fragment(
  'public.softora_claim_mailbox_sync_lock(text,text,text,text,integer,boolean,text)',
  $old$  where consistency.scope = 'campaign'
  for update;$old$,
  $new$  where consistency.scope = 'campaign';$new$,
  'claim: do not hold campaign row while waiting for sync state'
);

do $patch_v2_fences$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.softora_prepare_mailbox_uid_generation_v2(text,text,bigint,bigint,text,jsonb)',
    'public.softora_confirm_mailbox_uid_baseline_v2(text,text,uuid,bigint,jsonb)',
    'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
    'public.softora_skip_mailbox_sync_v2(text,text,text,text)',
    'public.softora_fail_mailbox_sync_v2(text,text,text,text)'
  ] loop
    perform pg_temp.softora_replace_mailbox_function_fragment(
      v_signature,
      '  perform pg_catalog.pg_advisory_xact_lock(824031, 3);',
      '  perform public.softora_lock_mailbox_sync_key_v2(v_sync_key);',
      v_signature || ': global advisory to per-key fence'
    );
    perform pg_temp.softora_replace_mailbox_function_fragment(
      v_signature,
      'where scope = ''campaign'' for update;',
      'where scope = ''campaign'';',
      v_signature || ': campaign existence check without row lock'
    );
  end loop;

  perform pg_temp.softora_replace_mailbox_function_fragment(
    'public.softora_apply_mailbox_state_mutation(text,text,bigint,text,text,bigint,boolean,boolean)',
    '  perform pg_catalog.pg_advisory_xact_lock(824031, 3);',
    $replacement$  perform public.softora_lock_mailbox_sync_key_v2(
    pg_catalog.lower(pg_catalog.btrim(coalesce(p_account_email, '')))
      || '|' || pg_catalog.lower(pg_catalog.btrim(coalesce(p_folder, '')))
  );$replacement$,
    'state mutation: global advisory to derived per-key fence'
  );
  perform pg_temp.softora_replace_mailbox_function_fragment(
    'public.softora_apply_mailbox_state_mutation(text,text,bigint,text,text,bigint,boolean,boolean)',
    'where scope = ''campaign'' for update;',
    'where scope = ''campaign'';',
    'state mutation: campaign existence check without row lock'
  );
end;
$patch_v2_fences$;

-- Visibility RPCs must take the exclusive side explicitly before their early
-- campaign-row lock; their later message UPDATE trigger is too late to define
-- that order. The two remaining legacy message writers also acquire it before
-- their old global/campaign locks. Direct message writes enter through the
-- generic statement trigger; provenance uses its accepted-only row trigger.
do $patch_visibility_lock_order$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.softora_set_mailbox_message_visibility(text,text,bigint,text,boolean)',
    'public.softora_set_mailbox_contact_visibility(text[],text,text,text,bigint,text,integer,boolean)'
  ] loop
    perform pg_temp.softora_replace_mailbox_function_fragment(
      v_signature,
      $old$  insert into public.softora_mailbox_campaign_consistency (scope, content_version)
  values ('campaign', 0)
  on conflict (scope) do nothing;$old$,
      $new$  perform public.softora_lock_mailbox_visibility_exclusive();

  insert into public.softora_mailbox_campaign_consistency (scope, content_version)
  values ('campaign', 0)
  on conflict (scope) do nothing;$new$,
      v_signature || ': exclusive visibility fence before campaign row'
    );
  end loop;

  foreach v_signature in array array[
    'public.softora_apply_mailbox_uid_validity(text,text,bigint,text)',
    'public.softora_commit_mailbox_campaign_messages(uuid,text,jsonb,jsonb)'
  ] loop
    perform pg_temp.softora_replace_mailbox_function_fragment(
      v_signature,
      '  perform pg_advisory_xact_lock(824031, 3);',
      $new$  perform public.softora_lock_mailbox_visibility_exclusive();
  perform pg_advisory_xact_lock(824031, 3);$new$,
      v_signature || ': exclusive visibility fence before legacy global lock'
    );
  end loop;
end;
$patch_visibility_lock_order$;

-- Preserve the live lineage refresh trigger and all 4,306 current member rows.
-- Pure generation-key adoption already takes its fast path; the only failure
-- is the immediate root-shape CHECK observing the two ON UPDATE CASCADE steps
-- between message_key and root_message_key. Evaluate that exact same shape at
-- transaction end, after both cascades have reached their final values.

create or replace function public.softora_guard_mailbox_campaign_lineage_member_shape()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_message_key text;
  v_root_message_key text;
  v_parent_message_key text;
  v_lineage_depth integer;
begin
  select member.message_key, member.root_message_key,
    member.parent_message_key, member.lineage_depth
  into v_message_key, v_root_message_key, v_parent_message_key, v_lineage_depth
  from public.softora_mailbox_campaign_lineage_members as member
  where member.message_key = new.message_key;
  if not found then
    return null;
  end if;
  if not (
    (v_lineage_depth = 0 and v_parent_message_key is null
      and v_root_message_key = v_message_key)
    or (v_lineage_depth > 0 and v_parent_message_key is not null)
  ) then
    raise exception using errcode = '23514',
      message = 'softora_mailbox_campaign_lineage_members_shape_check';
  end if;
  return null;
end;
$function$;

do $repair_legacy_lineage_shape$
declare
  v_table pg_catalog.regclass := 'public.softora_mailbox_campaign_lineage_members'::pg_catalog.regclass;
  v_constraint_definition text;
  v_trigger_enabled "char";
  v_invalid_count bigint := 0;
begin
  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
  into v_constraint_definition
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.conrelid = v_table
    and constraint_row.contype = 'c'
    and constraint_row.conname = 'softora_mailbox_campaign_lineage_members_check';
  if not found
    or position(
      'lineage_depth = 0' in pg_catalog.lower(coalesce(v_constraint_definition, ''))
    ) = 0
    or position(
      'parent_message_key is null' in pg_catalog.lower(coalesce(v_constraint_definition, ''))
    ) = 0
    or position(
      'root_message_key = message_key' in pg_catalog.lower(coalesce(v_constraint_definition, ''))
    ) = 0
    or position(
      'lineage_depth > 0' in pg_catalog.lower(coalesce(v_constraint_definition, ''))
    ) = 0
    or position(
      'parent_message_key is not null' in pg_catalog.lower(coalesce(v_constraint_definition, ''))
    ) = 0 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_LEGACY_LINEAGE_SHAPE_CONSTRAINT_DRIFT';
  end if;

  select trigger_row.tgenabled into v_trigger_enabled
  from pg_catalog.pg_trigger as trigger_row
  where trigger_row.tgrelid = 'public.softora_mailbox_messages'::pg_catalog.regclass
    and trigger_row.tgname = 'softora_refresh_mailbox_message_lineage'
    and not trigger_row.tgisinternal;
  if not found or v_trigger_enabled = 'D' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_LEGACY_LINEAGE_REFRESH_TRIGGER_MISSING';
  end if;

  select pg_catalog.count(*) into v_invalid_count
  from public.softora_mailbox_campaign_lineage_members as member
  where not (
    (member.lineage_depth = 0 and member.parent_message_key is null
      and member.root_message_key = member.message_key)
    or (member.lineage_depth > 0 and member.parent_message_key is not null)
  );
  if v_invalid_count <> 0 then
    raise exception using errcode = '23514',
      message = 'MAILBOX_LEGACY_LINEAGE_SHAPE_INVALID',
      detail = v_invalid_count::text;
  end if;

  alter table public.softora_mailbox_campaign_lineage_members
    drop constraint softora_mailbox_campaign_lineage_members_check;
  drop trigger if exists softora_mailbox_campaign_lineage_member_shape_deferred
    on public.softora_mailbox_campaign_lineage_members;
  create constraint trigger softora_mailbox_campaign_lineage_member_shape_deferred
    after insert or update on public.softora_mailbox_campaign_lineage_members
    deferrable initially deferred for each row
    execute function public.softora_guard_mailbox_campaign_lineage_member_shape();
end;
$repair_legacy_lineage_shape$;

-- The transition flag bypasses the generic message-version trigger. Add that
-- bypass before its existing once-per-transaction guard; v2 calls the bounded
-- version helper exactly where visible state is committed.
select pg_temp.softora_replace_mailbox_function_fragment(
  'public.softora_track_mailbox_campaign_message_change()',
  $old$begin
  if coalesce(current_setting('softora.mailbox_campaign_version_bumped', true), '') = '1' then$old$,
  $new$begin
  if coalesce(pg_catalog.current_setting(
    'softora.mailbox_sync_per_key_v2', true
  ), '') = '1' then
    return null;
  end if;
  if coalesce(current_setting('softora.mailbox_campaign_version_bumped', true), '') = '1' then$new$,
  'campaign version trigger: v2 manual bump'
);

-- Baseline adoption rewrites legacy keys and retires hidden legacy rows.
select pg_temp.softora_replace_mailbox_function_fragment(
  'public.softora_confirm_mailbox_uid_baseline_v2(text,text,uuid,bigint,jsonb)',
  $old$  where state.sync_key = v_sync.sync_key;

  return query select true, false, p_generation_id, p_uid_validity,$old$,
  $new$  where state.sync_key = v_sync.sync_key;

  perform public.softora_bump_mailbox_campaign_version_v2(
    v_sync.account_email, v_sync.folder, true
  );

  return query select true, false, p_generation_id, p_uid_validity,$new$,
  'baseline: bounded campaign version bump'
);

-- A normal staged rebuild is valid for every fenced IMAP sync-state. Only the
-- sparse All Mail policy is campaign-specific and remains strictly anchored.
select pg_temp.softora_replace_mailbox_function_fragment(
  'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
  $old$      or (
        p_selection_policy = 'staged-rebuild-v2'
        and not public.softora_is_campaign_mailbox_message(
          v_sync.account_email, v_sync.folder, candidate.row_data->'payload'
        )
      )
$old$,
  '',
  'commit: remove non-campaign staged-rebuild rejection'
);

-- The targeted steady branch used to bump after the generic trigger had
-- already bumped. Suppress both old paths and perform one bounded late bump.
select pg_temp.softora_replace_mailbox_function_fragment(
  'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
  $old$      if pg_catalog.jsonb_array_length(p_rows) > 0 then
        update public.softora_mailbox_campaign_consistency as consistency
        set content_version = consistency.content_version + 1,
            updated_at = v_now
        where consistency.scope = 'campaign';
      end if;
$old$,
  '',
  'commit steady: remove early targeted campaign bump'
);

select pg_temp.softora_replace_mailbox_function_fragment(
  'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
  $old$    end if;

    v_result := pg_catalog.jsonb_build_object(
      'activated', false, 'rebuildPending', false,$old$,
  $new$    end if;

    perform public.softora_bump_mailbox_campaign_version_v2(
      v_sync.account_email,
      v_sync.folder,
      pg_catalog.jsonb_array_length(p_rows) > 0
    );

    v_result := pg_catalog.jsonb_build_object(
      'activated', false, 'rebuildPending', false,$new$,
  'commit steady: late campaign version bump'
);

select pg_temp.softora_replace_mailbox_function_fragment(
  'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
  $old$  if p_selection_policy = 'targeted-sparse-v2' then
    update public.softora_mailbox_campaign_consistency as consistency
    set content_version = consistency.content_version + 1,
        updated_at = v_now
    where consistency.scope = 'campaign';
  end if;
$old$,
  $new$  perform public.softora_bump_mailbox_campaign_version_v2(
    v_sync.account_email, v_sync.folder, true
  );
$new$,
  'commit activation: one late campaign version bump'
);

-- UI state must use the same per-key fence as generation activation, otherwise
-- a read/dismiss mutation can land on the old row after state was copied.
select pg_temp.softora_replace_mailbox_function_fragment(
  'public.softora_apply_mailbox_state_mutation(text,text,bigint,text,text,bigint,boolean,boolean)',
  $old$  returning message.* into v_row;

  return query select v_row.message_key, true, false, false,$old$,
  $new$  returning message.* into v_row;

  perform public.softora_bump_mailbox_campaign_version_v2(
    v_row.account_email, v_row.folder, true
  );

  return query select v_row.message_key, true, false, false,$new$,
  'state mutation: late campaign version bump'
);

revoke all on function public.softora_lock_mailbox_sync_key_v2(text)
  from public, anon, authenticated, service_role;
revoke all on function public.softora_lock_mailbox_visibility_shared_v2()
  from public, anon, authenticated, service_role;
revoke all on function public.softora_lock_mailbox_visibility_exclusive()
  from public, anon, authenticated, service_role;
revoke all on function public.softora_lock_mailbox_send_provenance_visible_change()
  from public, anon, authenticated, service_role;
revoke all on function public.softora_bump_mailbox_campaign_version_v2(text, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.softora_guard_mailbox_campaign_lineage_member_shape()
  from public, anon, authenticated, service_role;
grant execute on function public.softora_lock_mailbox_sync_key_v2(text)
  to service_role;
grant execute on function public.softora_lock_mailbox_visibility_shared_v2()
  to service_role;
grant execute on function public.softora_lock_mailbox_visibility_exclusive()
  to service_role;
grant execute on function public.softora_lock_mailbox_send_provenance_visible_change()
  to service_role;
grant execute on function public.softora_bump_mailbox_campaign_version_v2(text, text, boolean)
  to service_role;

comment on function public.softora_lock_mailbox_sync_key_v2(text)
  is 'Takes shared visibility access, then serializes UID-v2 mutations per canonical sync_key without consuming the global capacity/protocol fence.';
comment on function public.softora_lock_mailbox_visibility_shared_v2()
  is 'Allows independent UID-v2 sync keys to overlap while excluding hide, restore and direct message writers.';
comment on function public.softora_lock_mailbox_visibility_exclusive()
  is 'Excludes UID-v2 message finalizers before a visibility or direct message writer takes campaign/message locks.';
comment on function public.softora_lock_mailbox_send_provenance_visible_change()
  is 'Keeps prepared/provider-outcome bookkeeping outside sync fences and serializes only accepted-visible provenance with mailbox visibility.';
comment on function public.softora_bump_mailbox_campaign_version_v2(text, text, boolean)
  is 'Bumps the campaign snapshot version once near completion of a visible per-key v2 mutation.';

notify pgrst, 'reload schema';
-- mailbox-sync-per-key-finalizer-repair:end
