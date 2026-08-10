begin;

do $$
declare
  v_account text := 'uidvalidity-probe@softora.internal';
  v_folder text := 'inbox';
  v_sync_key text := v_account || '|' || v_folder;
  v_claim record;
  v_prepare record;
  v_old_read_at timestamptz := '2026-08-09T20:00:00Z';
begin
  delete from public.softora_mailbox_messages where account_email = v_account;
  delete from public.softora_mailbox_sync_state where sync_key = v_sync_key;

  select * into strict v_claim
  from public.softora_claim_mailbox_sync_lock(
    v_sync_key, v_account, v_folder, 'uidvalidity-probe-lock', 120, false
  );
  if not v_claim.acquired or v_claim.claimed_lock_token <> 'uidvalidity-probe-lock' then
    raise exception 'UIDVALIDITY_PROBE_CLAIM_FAILED';
  end if;

  insert into public.softora_mailbox_messages (
    message_key, account_email, folder, uid, provider_id, message_id,
    subject, date, unread, payload
  ) values (
    v_account || '|sent|1', v_account, 'sent', 1, 'sent:1',
    '<uidvalidity-probe-root@softora.internal>',
    'Kleine vraag over jullie website', clock_timestamp(), false,
    '{"direction":"sent","originalCampaignOutbound":true}'::jsonb
  );

  insert into public.softora_mailbox_messages (
    message_key, account_email, folder, uid, provider_id, message_id,
    in_reply_to, references_text, subject, date, unread, softora_read_at,
    deleted_at, payload
  ) values
    (v_sync_key || '|42', v_account, v_folder, 42, 'inbox:42',
      '<uidvalidity-probe-reply@softora.internal>',
      '<uidvalidity-probe-root@softora.internal>',
      '<uidvalidity-probe-root@softora.internal>',
      'Re: Kleine vraag over jullie website', clock_timestamp(), false,
      v_old_read_at, null, '{"direction":"received"}'::jsonb),
    (v_sync_key || '|43', v_account, v_folder, 43, 'inbox:43',
      '<uidvalidity-probe-hidden@softora.internal>', null, null,
      'Legacy verborgen bericht', clock_timestamp(), false, null,
      clock_timestamp(), '{}'::jsonb);

  if not exists (
    select 1 from public.softora_mailbox_message_lineage_edges
    where child_message_key = v_sync_key || '|42'
  ) or not exists (
    select 1 from public.softora_mailbox_campaign_lineage_members
    where message_key = v_sync_key || '|42'
      and parent_message_key = v_account || '|sent|1'
  ) then
    raise exception 'UIDVALIDITY_PROBE_LINEAGE_SETUP_FAILED';
  end if;

  select * into strict v_prepare
  from public.softora_prepare_mailbox_uid_validity(
    v_sync_key, 'uidvalidity-probe-lock', 111
  );
  if not v_prepare.applied or v_prepare.lock_lost
    or v_prepare.current_uid_validity <> 111
    or not v_prepare.adopted_legacy
    or v_prepare.reset_detected then
    raise exception 'UIDVALIDITY_PROBE_LEGACY_ADOPTION_FAILED';
  end if;
  if not exists (
    select 1 from public.softora_mailbox_messages
    where message_key = v_sync_key || '|uv:111|42'
      and uid_validity = 111
      and softora_read_at = v_old_read_at
      and unread = false
      and deleted_at is null
  ) or not exists (
    select 1 from public.softora_mailbox_messages
    where message_key = v_sync_key || '|uv:111|43'
      and uid_validity = 111
      and deleted_at is not null
      and generation_superseded_at is null
  ) then
    raise exception 'UIDVALIDITY_PROBE_LEGACY_STATE_NOT_PRESERVED';
  end if;
  if exists (
    select 1 from public.softora_mailbox_message_lineage_edges
    where child_message_key = v_sync_key || '|42'
  ) or exists (
    select 1 from public.softora_mailbox_campaign_lineage_members
    where message_key = v_sync_key || '|42'
  ) or not exists (
    select 1 from public.softora_mailbox_message_lineage_edges
    where child_message_key = v_sync_key || '|uv:111|42'
  ) or not exists (
    select 1 from public.softora_mailbox_campaign_lineage_members
    where message_key = v_sync_key || '|uv:111|42'
      and parent_message_key = v_account || '|sent|1'
  ) or not exists (
    select 1 from public.softora_mailbox_campaign_lineage_discoveries
    where message_key = v_sync_key || '|uv:111|42'
  ) then
    raise exception 'UIDVALIDITY_PROBE_LINEAGE_NOT_CASCADED';
  end if;

  -- A still-warm old runtime may insert the legacy key after first adoption.
  -- The row trigger must coerce both a new UID and a conflict with an existing
  -- current-generation UID without creating a second visible row.
  insert into public.softora_mailbox_messages (
    message_key, account_email, folder, uid, provider_id, subject, date, unread
  ) values (
    v_sync_key || '|44', v_account, v_folder, 44, 'inbox:44',
    'Legacy writer, nieuwe UID', clock_timestamp(), true
  ) on conflict (message_key) do update set
    subject = excluded.subject,
    unread = excluded.unread,
    updated_at = clock_timestamp();
  insert into public.softora_mailbox_messages (
    message_key, account_email, folder, uid, provider_id, subject, date, unread
  ) values (
    v_sync_key || '|42', v_account, v_folder, 42, 'inbox:42',
    'Legacy writer, bestaande UID', clock_timestamp(), true
  ) on conflict (message_key) do update set
    subject = excluded.subject,
    unread = excluded.unread,
    updated_at = clock_timestamp();
  insert into public.softora_mailbox_messages (
    message_key, account_email, folder, uid, provider_id, subject, date, unread
  ) values (
    v_sync_key || '|43', v_account, v_folder, 43, 'inbox:43',
    'Legacy writer, bestaande tombstone', clock_timestamp(), true
  ) on conflict (message_key) do update set
    subject = excluded.subject,
    unread = excluded.unread,
    updated_at = clock_timestamp();
  if not exists (
    select 1 from public.softora_mailbox_messages
    where message_key = v_sync_key || '|uv:111|44' and uid_validity = 111
      and generation_superseded_at is null
  ) or (
    select count(*) from public.softora_mailbox_messages
    where account_email = v_account and folder = v_folder and uid = 42
      and generation_superseded_at is null
  ) <> 1 or exists (
    select 1 from public.softora_mailbox_messages
    where account_email = v_account and folder = v_folder
      and uid_validity is null and generation_superseded_at is null
  ) or not exists (
    select 1 from public.softora_mailbox_messages
    where message_key = v_sync_key || '|uv:111|42'
      and softora_read_at = v_old_read_at and unread = false
  ) or not exists (
    select 1 from public.softora_mailbox_messages
    where message_key = v_sync_key || '|uv:111|43' and deleted_at is not null
  ) then
    raise exception 'UIDVALIDITY_PROBE_ROLLING_WRITER_DUPLICATED_STATE';
  end if;

  update public.softora_mailbox_sync_state
  set last_synced_at = clock_timestamp(), last_uid = 44, message_count = 3
  where sync_key = v_sync_key;
  select * into strict v_prepare
  from public.softora_prepare_mailbox_uid_validity(
    v_sync_key, 'uidvalidity-probe-lock', 222
  );
  if not v_prepare.applied or not v_prepare.reset_detected
    or v_prepare.previous_uid_validity <> 111
    or v_prepare.current_uid_validity <> 222
    or v_prepare.superseded_count <> 3 then
    raise exception 'UIDVALIDITY_PROBE_RESET_NOT_DETECTED';
  end if;
  if exists (
    select 1 from public.softora_mailbox_messages
    where account_email = v_account and folder = v_folder
      and generation_superseded_at is null
  ) or not exists (
    select 1 from public.softora_mailbox_sync_state
    where sync_key = v_sync_key and uid_validity = 222
      and uid_validity_reset_at is not null
      and last_synced_at is null and last_uid = 0 and message_count = 0
  ) then
    raise exception 'UIDVALIDITY_PROBE_OLD_GENERATION_NOT_RETIRED';
  end if;

  begin
    insert into public.softora_mailbox_messages (
      message_key, account_email, folder, uid, provider_id, subject, date, unread
    ) values (
      v_sync_key || '|45', v_account, v_folder, 45, 'inbox:45',
      'Ambigue oude writer na reset', clock_timestamp(), true
    );
    raise exception 'UIDVALIDITY_PROBE_POST_RESET_LEGACY_WRITE_ACCEPTED';
  exception
    when sqlstate '55000' then
      if sqlerrm <> 'MAILBOX_UIDVALIDITY_REQUIRED' then
        raise;
      end if;
  end;
  if exists (
    select 1 from public.softora_mailbox_messages
    where account_email = v_account and folder = v_folder and uid = 45
  ) then
    raise exception 'UIDVALIDITY_PROBE_POST_RESET_LEGACY_WRITE_PERSISTED';
  end if;

  insert into public.softora_mailbox_messages (
    message_key, account_email, folder, uid, uid_validity, provider_id,
    subject, date, unread
  ) values (
    v_sync_key || '|uv:222|42', v_account, v_folder, 42, 222,
    'inbox:42', 'Nieuw bericht met hergebruikte UID', clock_timestamp(), true
  );
  if not exists (
    select 1 from public.softora_mailbox_messages
    where message_key = v_sync_key || '|uv:222|42'
      and uid_validity = 222
      and softora_read_at is null
      and deleted_at is null
      and generation_superseded_at is null
      and unread = true
  ) then
    raise exception 'UIDVALIDITY_PROBE_STATE_LEAKED_ACROSS_RESET';
  end if;

  select * into strict v_prepare
  from public.softora_prepare_mailbox_uid_validity(
    v_sync_key, 'wrong-lock-token', 333
  );
  if v_prepare.applied or not v_prepare.lock_lost or exists (
    select 1 from public.softora_mailbox_sync_state
    where sync_key = v_sync_key and uid_validity <> 222
  ) then
    raise exception 'UIDVALIDITY_PROBE_WRONG_LEASE_MUTATED_STATE';
  end if;
end;
$$;

rollback;
