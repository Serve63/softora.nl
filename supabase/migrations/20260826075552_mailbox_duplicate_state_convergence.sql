-- A provider can expose one RFC message through Inbox and All Mail with
-- different physical UIDs. Keep the exact requested identity fail-closed, then
-- converge only the durable UI state across active copies of that same message
-- in the same account.

-- Take the cross-domain fence before any trigger DDL obtains a table lock.
-- Otherwise an already-running per-key sync could hold shared visibility while
-- waiting for this migration's table lock, as the migration waits in reverse.
do $lock_duplicate_state_migration$
declare
  v_state_definition text;
begin
  if pg_catalog.to_regprocedure('public.softora_lock_mailbox_visibility_exclusive()') is null
    or pg_catalog.to_regprocedure('public.softora_lock_mailbox_sync_key_v2(text)') is null
    or pg_catalog.to_regprocedure('public.softora_bump_mailbox_campaign_version_v2(text,text,boolean)') is null then
    raise exception using errcode = '55000',
      message = 'MAILBOX_DUPLICATE_STATE_FENCE_MISSING';
  end if;
  v_state_definition := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.softora_apply_mailbox_state_mutation(text,text,bigint,text,text,bigint,boolean,boolean)'
  ));
  if v_state_definition is null
    or v_state_definition not like '%softora_lock_mailbox_sync_key_v2%'
    or v_state_definition not like '%softora_bump_mailbox_campaign_version_v2%'
    or v_state_definition like '%pg_advisory_xact_lock(824031, 3)%' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_DUPLICATE_STATE_BASE_MUTATION_UNSAFE';
  end if;
  perform 1
  from pg_catalog.pg_trigger as trigger
  where trigger.tgrelid = 'public.softora_mailbox_messages'::pg_catalog.regclass
    and trigger.tgname = 'softora_mailbox_messages_inherit_logical_tombstone'
    and trigger.tgenabled = 'O'
    and not trigger.tgisinternal;
  if not found then
    raise exception using errcode = '55000',
      message = 'MAILBOX_DUPLICATE_STATE_TOMBSTONE_TRIGGER_MISSING';
  end if;
  perform 1
  from pg_catalog.pg_trigger as trigger
  where trigger.tgrelid = 'public.softora_mailbox_messages'::pg_catalog.regclass
    and trigger.tgname = 'softora_mailbox_messages_preserve_read_state'
    and trigger.tgenabled = 'O'
    and not trigger.tgisinternal;
  if not found then
    raise exception using errcode = '55000',
      message = 'MAILBOX_DUPLICATE_STATE_READ_TRIGGER_MISSING';
  end if;
  perform public.softora_lock_mailbox_visibility_exclusive();
  perform 1
  from public.softora_mailbox_campaign_consistency
  where scope = 'campaign'
  for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'MAILBOX_CAMPAIGN_FENCE_MISSING';
  end if;
end;
$lock_duplicate_state_migration$;

-- The ordinary read-state trigger deliberately keeps an already-read row
-- monotone when a provider refresh writes the same revision. Duplicate-state
-- convergence is the one narrower case where an equal revision with another
-- mutation key must be able to copy either read or unread state. Scope that
-- exception to the exact logical identity selected by the wrapper, for this
-- transaction only; direct writers and ordinary syncs never receive it.
create or replace function public.softora_preserve_mailbox_read_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_convergence_scope text := pg_catalog.current_setting(
    'softora.mailbox_duplicate_state_convergence', true
  );
begin
  if new.state_revision > old.state_revision
    or (
      new.state_revision = old.state_revision
      and new.state_mutation_key is not null
      and new.state_mutation_key is distinct from old.state_mutation_key
      and v_convergence_scope <> ''
      and v_convergence_scope = (
        pg_catalog.lower(pg_catalog.btrim(coalesce(old.account_email, '')))
          || '|' || public.softora_normalize_mailbox_message_id(old.message_id)
      )
      and v_convergence_scope = (
        pg_catalog.lower(pg_catalog.btrim(coalesce(new.account_email, '')))
          || '|' || public.softora_normalize_mailbox_message_id(new.message_id)
      )
    ) then
    if new.unread then
      new.softora_read_at := null;
    elsif new.softora_read_at is null then
      new.softora_read_at := pg_catalog.clock_timestamp();
    end if;
  elsif old.softora_read_at is not null then
    new.softora_read_at := old.softora_read_at;
    new.unread := false;
  elsif new.softora_read_at is not null then
    new.unread := false;
  end if;
  return new;
end;
$function$;

create or replace function public.softora_apply_mailbox_state_mutation_v2(
  p_account_email text,
  p_folder text,
  p_uid bigint,
  p_provider_id text,
  p_expected_message_key text,
  p_expected_message_id text,
  p_mutation_key text,
  p_revision bigint,
  p_unread boolean default false,
  p_dismiss_reply boolean default false
)
returns table (
  message_key text,
  applied boolean,
  replayed boolean,
  superseded boolean,
  current_revision bigint,
  current_mutation_key text,
  unread boolean,
  softora_read_at timestamptz,
  reply_dismissed_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_row public.softora_mailbox_messages%rowtype;
  v_group_state public.softora_mailbox_messages%rowtype;
  v_mutation record;
  v_changed_count integer := 0;
  v_account_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_account_email, '')));
  v_folder text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_folder, '')));
  v_expected_message_key text := pg_catalog.btrim(coalesce(p_expected_message_key, ''));
  v_expected_message_id text := public.softora_normalize_mailbox_message_id(p_expected_message_id);
  v_previous_convergence_scope text := pg_catalog.current_setting(
    'softora.mailbox_duplicate_state_convergence', true
  );
  v_convergence_scope text := v_account_email || '|' || coalesce(v_expected_message_id, '');
begin
  if pg_catalog.char_length(pg_catalog.btrim(coalesce(p_account_email, ''))) < 3
    or pg_catalog.char_length(pg_catalog.btrim(coalesce(p_folder, ''))) < 1
    or pg_catalog.char_length(v_expected_message_key) < 1
    or pg_catalog.char_length(v_expected_message_key) > 2000
    or (
      pg_catalog.char_length(pg_catalog.btrim(coalesce(p_expected_message_id, ''))) > 0
      and v_expected_message_id is null
    )
    or pg_catalog.char_length(pg_catalog.btrim(coalesce(p_mutation_key, ''))) <> 64
    or pg_catalog.btrim(coalesce(p_mutation_key, '')) !~ '^[a-f0-9]{64}$'
    or coalesce(p_revision, 0) < 1
    or (
      coalesce(p_uid, 0) < 1
      and pg_catalog.char_length(pg_catalog.btrim(coalesce(p_provider_id, ''))) < 1
    ) then
    raise exception using errcode = '22023',
      message = 'Ongeldige generatievaste mailbox-state-mutatie';
  end if;

  -- Keep the existing production order intact: shared visibility, concrete
  -- sync key, then the logical RFC identity. This lets independent accounts
  -- overlap and prevents a direct writer (exclusive visibility -> campaign)
  -- from deadlocking with this state mutation.
  perform public.softora_lock_mailbox_sync_key_v2(
    v_account_email || '|' || v_folder
  );
  if v_expected_message_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext(v_account_email),
      pg_catalog.hashtext(v_expected_message_id)
    );
  end if;
  perform 1
  from public.softora_mailbox_campaign_consistency
  where scope = 'campaign';
  if not found then
    raise exception using errcode = '55000',
      message = 'MAILBOX_CAMPAIGN_FENCE_MISSING';
  end if;

  select message.*
  into v_row
  from public.softora_mailbox_messages as message
  where message.message_key = v_expected_message_key
    and pg_catalog.lower(pg_catalog.btrim(message.account_email)) = v_account_email
    and pg_catalog.lower(pg_catalog.btrim(message.folder)) = v_folder
    and message.generation_superseded_at is null
    and message.deleted_at is null
  limit 1
  for update;

  if not found
    or (
      coalesce(p_uid, 0) > 0
      and v_row.uid is distinct from p_uid
    )
    or (
      coalesce(p_uid, 0) < 1
      and v_row.provider_id is distinct from pg_catalog.btrim(p_provider_id)
    )
    or (
      v_expected_message_id is not null
      and public.softora_normalize_mailbox_message_id(v_row.message_id)
        is distinct from v_expected_message_id
    ) then
    raise exception using errcode = 'P0001',
      message = 'MAILBOX_STATE_MESSAGE_IDENTITY_MISMATCH';
  end if;

  -- A logical message can already have a newer durable mutation on another
  -- physical folder copy. Decide replay/supersession on the whole exact RFC
  -- group before touching the requested row; physical UID order is not state
  -- order. The logical advisory lock above serializes every folder copy.
  if v_expected_message_id is not null then
    select sibling.*
    into v_group_state
    from public.softora_mailbox_messages as sibling
    where pg_catalog.lower(pg_catalog.btrim(sibling.account_email)) = v_account_email
      and sibling.deleted_at is null
      and sibling.generation_superseded_at is null
      and public.softora_normalize_mailbox_message_id(sibling.message_id)
        = v_expected_message_id
    order by
      sibling.state_revision desc,
      case when sibling.state_revision > 0 then sibling.state_mutation_at end desc nulls last,
      (sibling.reply_dismissed_at is not null) desc,
      (sibling.softora_read_at is not null) desc,
      sibling.updated_at desc,
      sibling.message_key desc
    limit 1
    for share;

    if found and (
      v_group_state.state_revision > p_revision
      or (
        v_group_state.state_revision = p_revision
        and v_group_state.state_mutation_key
          is distinct from pg_catalog.btrim(p_mutation_key)
      )
    ) then
      perform pg_catalog.set_config(
        'softora.mailbox_duplicate_state_convergence', v_convergence_scope, true
      );
      update public.softora_mailbox_messages as sibling
      set unread = v_group_state.unread,
          softora_read_at = v_group_state.softora_read_at,
          reply_dismissed_at = v_group_state.reply_dismissed_at,
          state_revision = v_group_state.state_revision,
          state_mutation_key = v_group_state.state_mutation_key,
          state_mutation_at = v_group_state.state_mutation_at,
          updated_at = greatest(sibling.updated_at, v_group_state.updated_at)
      where pg_catalog.lower(pg_catalog.btrim(sibling.account_email)) = v_account_email
        and sibling.deleted_at is null
        and sibling.generation_superseded_at is null
        and public.softora_normalize_mailbox_message_id(sibling.message_id)
          = v_expected_message_id
        and sibling.state_revision <= v_group_state.state_revision
        and (
          sibling.unread is distinct from v_group_state.unread
          or sibling.softora_read_at is distinct from v_group_state.softora_read_at
          or sibling.reply_dismissed_at is distinct from v_group_state.reply_dismissed_at
          or sibling.state_revision is distinct from v_group_state.state_revision
          or sibling.state_mutation_key is distinct from v_group_state.state_mutation_key
          or sibling.state_mutation_at is distinct from v_group_state.state_mutation_at
        );
      get diagnostics v_changed_count = row_count;
      perform pg_catalog.set_config(
        'softora.mailbox_duplicate_state_convergence',
        coalesce(v_previous_convergence_scope, ''), true
      );
      perform public.softora_bump_mailbox_campaign_version_v2(
        v_account_email, v_folder, v_changed_count > 0
      );
      return query select
        v_expected_message_key::text,
        false,
        false,
        true,
        v_group_state.state_revision::bigint,
        v_group_state.state_mutation_key::text,
        v_group_state.unread::boolean,
        v_group_state.softora_read_at::timestamptz,
        v_group_state.reply_dismissed_at::timestamptz;
      return;
    end if;

    if found
      and v_group_state.state_revision = p_revision
      and v_group_state.state_mutation_key = pg_catalog.btrim(p_mutation_key) then
      perform pg_catalog.set_config(
        'softora.mailbox_duplicate_state_convergence', v_convergence_scope, true
      );
      update public.softora_mailbox_messages as sibling
      set unread = v_group_state.unread,
          softora_read_at = v_group_state.softora_read_at,
          reply_dismissed_at = v_group_state.reply_dismissed_at,
          state_revision = v_group_state.state_revision,
          state_mutation_key = v_group_state.state_mutation_key,
          state_mutation_at = v_group_state.state_mutation_at,
          updated_at = greatest(sibling.updated_at, v_group_state.updated_at)
      where pg_catalog.lower(pg_catalog.btrim(sibling.account_email)) = v_account_email
        and sibling.deleted_at is null
        and sibling.generation_superseded_at is null
        and public.softora_normalize_mailbox_message_id(sibling.message_id)
          = v_expected_message_id
        and sibling.state_revision <= v_group_state.state_revision
        and (
          sibling.unread is distinct from v_group_state.unread
          or sibling.softora_read_at is distinct from v_group_state.softora_read_at
          or sibling.reply_dismissed_at is distinct from v_group_state.reply_dismissed_at
          or sibling.state_revision is distinct from v_group_state.state_revision
          or sibling.state_mutation_key is distinct from v_group_state.state_mutation_key
          or sibling.state_mutation_at is distinct from v_group_state.state_mutation_at
        );
      get diagnostics v_changed_count = row_count;
      perform pg_catalog.set_config(
        'softora.mailbox_duplicate_state_convergence',
        coalesce(v_previous_convergence_scope, ''), true
      );
      perform public.softora_bump_mailbox_campaign_version_v2(
        v_account_email, v_folder, v_changed_count > 0
      );
      return query select
        v_expected_message_key::text,
        false,
        true,
        false,
        v_group_state.state_revision::bigint,
        v_group_state.state_mutation_key::text,
        v_group_state.unread::boolean,
        v_group_state.softora_read_at::timestamptz,
        v_group_state.reply_dismissed_at::timestamptz;
      return;
    end if;
  end if;

  select mutation.*
  into v_mutation
  from public.softora_apply_mailbox_state_mutation(
    p_account_email,
    p_folder,
    p_uid,
    p_provider_id,
    p_mutation_key,
    p_revision,
    p_unread,
    p_dismiss_reply
  ) as mutation;

  if not found then
    raise exception using errcode = 'P0002',
      message = 'Mailboxbericht niet gevonden';
  end if;

  select message.*
  into v_row
  from public.softora_mailbox_messages as message
  where message.message_key = v_expected_message_key;

  if v_expected_message_id is not null then
    perform pg_catalog.set_config(
      'softora.mailbox_duplicate_state_convergence', v_convergence_scope, true
    );
    update public.softora_mailbox_messages as sibling
    set unread = v_row.unread,
        softora_read_at = v_row.softora_read_at,
        reply_dismissed_at = v_row.reply_dismissed_at,
        state_revision = v_row.state_revision,
        state_mutation_key = v_row.state_mutation_key,
        state_mutation_at = v_row.state_mutation_at,
        updated_at = greatest(sibling.updated_at, v_row.updated_at)
    where sibling.message_key <> v_row.message_key
      and pg_catalog.lower(pg_catalog.btrim(sibling.account_email))
        = pg_catalog.lower(pg_catalog.btrim(v_row.account_email))
      and sibling.deleted_at is null
      and sibling.generation_superseded_at is null
      and public.softora_normalize_mailbox_message_id(sibling.message_id)
        = v_expected_message_id
      and sibling.state_revision <= v_row.state_revision;
    perform pg_catalog.set_config(
      'softora.mailbox_duplicate_state_convergence',
      coalesce(v_previous_convergence_scope, ''), true
    );
  end if;

  return query select
    v_mutation.message_key::text,
    v_mutation.applied::boolean,
    v_mutation.replayed::boolean,
    v_mutation.superseded::boolean,
    v_mutation.current_revision::bigint,
    v_mutation.current_mutation_key::text,
    v_mutation.unread::boolean,
    v_mutation.softora_read_at::timestamptz,
    v_mutation.reply_dismissed_at::timestamptz;
end;
$function$;

revoke all on function public.softora_apply_mailbox_state_mutation_v2(
  text, text, bigint, text, text, text, text, bigint, boolean, boolean
) from public, anon, authenticated, service_role;

grant execute on function public.softora_apply_mailbox_state_mutation_v2(
  text, text, bigint, text, text, text, text, bigint, boolean, boolean
) to service_role;

comment on function public.softora_apply_mailbox_state_mutation_v2(
  text, text, bigint, text, text, text, text, bigint, boolean, boolean
) is 'Validates one exact active mailbox identity, applies its idempotent UI state and converges that state across active same-account copies with the exact RFC Message-ID.';

-- A physical copy can arrive in another provider folder after the user already
-- handled the first copy. INSERT is the safe row-trigger point for taking the
-- exact logical RFC lock after the existing direct or per-key statement fence;
-- no concrete message row is locked yet.
create or replace function public.softora_inherit_mailbox_duplicate_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_account_email text;
  v_message_id text;
  v_state public.softora_mailbox_messages%rowtype;
  v_new_has_durable_state boolean;
begin
  if new.deleted_at is not null or new.generation_superseded_at is not null then
    return new;
  end if;
  v_account_email := pg_catalog.lower(pg_catalog.btrim(coalesce(new.account_email, '')));
  v_message_id := public.softora_normalize_mailbox_message_id(new.message_id);
  if v_account_email = '' or v_message_id is null then
    return new;
  end if;

  -- Every INSERT already entered through either the direct-write statement
  -- fence (exclusive visibility -> campaign) or the UID-v2 per-key fence
  -- (shared visibility -> sync key). Serialize only this exact cross-folder
  -- identity here; the existing tombstone trigger then reacquires it safely.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_account_email),
    pg_catalog.hashtext(v_message_id)
  );

  select sibling.*
  into v_state
  from public.softora_mailbox_messages as sibling
  where sibling.message_key is distinct from new.message_key
    and pg_catalog.lower(pg_catalog.btrim(sibling.account_email)) = v_account_email
    and sibling.deleted_at is null
    and sibling.generation_superseded_at is null
    and public.softora_normalize_mailbox_message_id(sibling.message_id)
      = v_message_id
    and (
      sibling.state_revision > 0
      or sibling.softora_read_at is not null
      or sibling.reply_dismissed_at is not null
    )
  order by
    sibling.state_revision desc,
    case when sibling.state_revision > 0 then sibling.state_mutation_at end desc nulls last,
    (sibling.reply_dismissed_at is not null) desc,
    (sibling.softora_read_at is not null) desc,
    sibling.updated_at desc,
    sibling.message_key desc
  limit 1
  for share;
  if not found then
    return new;
  end if;

  v_new_has_durable_state := coalesce(new.state_revision, 0) > 0
    or new.softora_read_at is not null
    or new.reply_dismissed_at is not null;
  if v_state.state_revision > coalesce(new.state_revision, 0)
    or not v_new_has_durable_state then
    new.unread := v_state.unread;
    new.softora_read_at := v_state.softora_read_at;
    new.reply_dismissed_at := v_state.reply_dismissed_at;
    new.state_revision := v_state.state_revision;
    new.state_mutation_key := v_state.state_mutation_key;
    new.state_mutation_at := v_state.state_mutation_at;
  end if;
  return new;
end;
$function$;

revoke all on function public.softora_inherit_mailbox_duplicate_state()
  from public, anon, authenticated, service_role;
grant execute on function public.softora_inherit_mailbox_duplicate_state()
  to service_role;

drop trigger if exists softora_mailbox_messages_inherit_duplicate_state
  on public.softora_mailbox_messages;
drop trigger if exists softora_mailbox_messages_inherit_state_from_duplicate
  on public.softora_mailbox_messages;
create trigger softora_mailbox_messages_inherit_state_from_duplicate
before insert on public.softora_mailbox_messages
for each row execute function public.softora_inherit_mailbox_duplicate_state();

-- Repair existing Inbox/All Mail copies once. The highest durable revision wins;
-- legacy rows without a revision prefer a reply dismissal, then a read marker.
-- The migration-wide exclusive visibility fence makes it safe to suspend the
-- monotone per-row read trigger while this group-level canonical repair can
-- intentionally restore either read or unread state at an equal revision.
alter table public.softora_mailbox_messages
  disable trigger softora_mailbox_messages_preserve_read_state;

do $repair_duplicate_mailbox_state$
begin
  -- Bulk repair is an exclusive visibility mutation. Take that fence before
  -- the campaign row, matching every existing direct writer and excluding
  -- per-key sync/state work for the short one-time repair transaction.
  perform public.softora_lock_mailbox_visibility_exclusive();
  perform 1
  from public.softora_mailbox_campaign_consistency
  where scope = 'campaign'
  for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'MAILBOX_CAMPAIGN_FENCE_MISSING';
  end if;

  with ranked as materialized (
    select
      message.*,
      public.softora_normalize_mailbox_message_id(message.message_id) as normalized_message_id,
      pg_catalog.row_number() over (
        partition by
          pg_catalog.lower(pg_catalog.btrim(message.account_email)),
          public.softora_normalize_mailbox_message_id(message.message_id)
        order by
          message.state_revision desc,
          case when message.state_revision > 0 then message.state_mutation_at end desc nulls last,
          (message.reply_dismissed_at is not null) desc,
          (message.softora_read_at is not null) desc,
          message.updated_at desc,
          message.message_key desc
      ) as state_rank,
      pg_catalog.count(*) over (
        partition by
          pg_catalog.lower(pg_catalog.btrim(message.account_email)),
          public.softora_normalize_mailbox_message_id(message.message_id)
      ) as copy_count,
      pg_catalog.bool_or(
        message.state_revision > 0
        or message.softora_read_at is not null
        or message.reply_dismissed_at is not null
      ) over (
        partition by
          pg_catalog.lower(pg_catalog.btrim(message.account_email)),
          public.softora_normalize_mailbox_message_id(message.message_id)
      ) as has_durable_state
    from public.softora_mailbox_messages as message
    where message.deleted_at is null
      and message.generation_superseded_at is null
      and public.softora_normalize_mailbox_message_id(message.message_id) is not null
  ), canonical as materialized (
    select *
    from ranked
    where state_rank = 1
      and copy_count > 1
      and has_durable_state
  )
  update public.softora_mailbox_messages as message
  set unread = canonical.unread,
      softora_read_at = canonical.softora_read_at,
      reply_dismissed_at = canonical.reply_dismissed_at,
      state_revision = canonical.state_revision,
      state_mutation_key = canonical.state_mutation_key,
      state_mutation_at = canonical.state_mutation_at,
      updated_at = greatest(message.updated_at, canonical.updated_at)
  from canonical
  where message.message_key <> canonical.message_key
    and pg_catalog.lower(pg_catalog.btrim(message.account_email))
      = pg_catalog.lower(pg_catalog.btrim(canonical.account_email))
    and message.deleted_at is null
    and message.generation_superseded_at is null
    and public.softora_normalize_mailbox_message_id(message.message_id)
      = canonical.normalized_message_id
    and (
      message.unread is distinct from canonical.unread
      or message.softora_read_at is distinct from canonical.softora_read_at
      or message.reply_dismissed_at is distinct from canonical.reply_dismissed_at
      or message.state_revision is distinct from canonical.state_revision
      or message.state_mutation_key is distinct from canonical.state_mutation_key
      or message.state_mutation_at is distinct from canonical.state_mutation_at
    );
end;
$repair_duplicate_mailbox_state$;

alter table public.softora_mailbox_messages
  enable trigger softora_mailbox_messages_preserve_read_state;
