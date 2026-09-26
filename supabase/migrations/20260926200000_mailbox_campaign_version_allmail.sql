-- The campaign reply list scans Gmail All Mail next to inbox/sent/coldmail and
-- the per-key v2 finalizer already maps allmail to inbox before bumping the
-- campaign content_version. The statement trigger did not, so read, dismiss,
-- star or delete changes on allmail rows left the version unchanged. The API
-- reuses a built list while that version is unchanged, so every visible
-- campaign change must bump it. Only the allmail folder mapping is new.
create or replace function public.softora_track_mailbox_campaign_message_change()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_affects_campaign boolean := false;
begin
  if coalesce(pg_catalog.current_setting(
    'softora.mailbox_sync_per_key_v2', true
  ), '') = '1' then
    return null;
  end if;
  if coalesce(current_setting('softora.mailbox_campaign_version_bumped', true), '') = '1' then
    return null;
  elsif tg_op = 'TRUNCATE' then
    v_affects_campaign := true;
  elsif tg_op = 'INSERT' then
    select exists (
      select 1 from softora_mailbox_campaign_new_rows as new_row
      where public.softora_is_campaign_mailbox_message(
        new_row.account_email,
        case when lower(btrim(coalesce(new_row.folder, ''))) = 'allmail' then 'inbox' else new_row.folder end,
        new_row.payload
      )
    ) into v_affects_campaign;
  elsif tg_op = 'DELETE' then
    select exists (
      select 1 from softora_mailbox_campaign_old_rows as old_row
      where public.softora_is_campaign_mailbox_message(
        old_row.account_email,
        case when lower(btrim(coalesce(old_row.folder, ''))) = 'allmail' then 'inbox' else old_row.folder end,
        old_row.payload
      )
    ) into v_affects_campaign;
  else
    select exists (
      select 1
      from softora_mailbox_campaign_old_rows as old_row
      full join softora_mailbox_campaign_new_rows as new_row
        on new_row.message_key = old_row.message_key
      where (
        public.softora_is_campaign_mailbox_message(
          old_row.account_email,
          case when lower(btrim(coalesce(old_row.folder, ''))) = 'allmail' then 'inbox' else old_row.folder end,
          old_row.payload
        ) or public.softora_is_campaign_mailbox_message(
          new_row.account_email,
          case when lower(btrim(coalesce(new_row.folder, ''))) = 'allmail' then 'inbox' else new_row.folder end,
          new_row.payload
        )
      ) and row(
        old_row.message_key, old_row.account_email, old_row.folder, old_row.uid,
        old_row.provider_id, old_row.message_id, old_row.in_reply_to, old_row.references_text,
        old_row.sender_name, old_row.sender_email, old_row.recipients_text, old_row.subject,
        old_row.preview, old_row.body_text, old_row.body_truncated, old_row.has_body,
        old_row.date, old_row.internal_date, old_row.unread, old_row.softora_read_at,
        old_row.starred, old_row.reply_dismissed_at, old_row.payload, old_row.deleted_at
      ) is distinct from row(
        new_row.message_key, new_row.account_email, new_row.folder, new_row.uid,
        new_row.provider_id, new_row.message_id, new_row.in_reply_to, new_row.references_text,
        new_row.sender_name, new_row.sender_email, new_row.recipients_text, new_row.subject,
        new_row.preview, new_row.body_text, new_row.body_truncated, new_row.has_body,
        new_row.date, new_row.internal_date, new_row.unread, new_row.softora_read_at,
        new_row.starred, new_row.reply_dismissed_at, new_row.payload, new_row.deleted_at
      )
    ) into v_affects_campaign;
  end if;

  if v_affects_campaign then
    perform set_config('softora.mailbox_campaign_version_bumped', '1', true);
    insert into public.softora_mailbox_campaign_consistency (
      scope, content_version, created_at, updated_at
    ) values ('campaign', 1, clock_timestamp(), clock_timestamp())
    on conflict (scope) do update set
      content_version = public.softora_mailbox_campaign_consistency.content_version + 1,
      updated_at = clock_timestamp();
  end if;
  return null;
end;
$function$;
