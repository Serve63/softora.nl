-- Durable, server-derived metadata lets an accepted idempotent replay render
-- manual attachments without touching temporary Storage again. NULL remains
-- the explicit legacy/unknown state; [] proves that no manual attachment was
-- present for sends reserved after this migration.
-- mailbox-send-attachment-metadata:start

alter table public.softora_mailbox_send_provenance
  add column if not exists attachments_metadata jsonb,
  add column if not exists request_payload_fingerprint text;

alter table public.softora_mailbox_send_provenance
  drop constraint if exists softora_mailbox_send_provenance_request_payload_format_check;
alter table public.softora_mailbox_send_provenance
  add constraint softora_mailbox_send_provenance_request_payload_format_check
  check (
    request_payload_fingerprint is null
    or request_payload_fingerprint ~ '^[0-9a-f]{64}$'
  );

create or replace function public.softora_mailbox_attachments_metadata_is_valid(
  p_value jsonb
)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $function$
declare
  v_item jsonb;
  v_key_count integer;
  v_size numeric;
  v_total numeric := 0;
begin
  if pg_catalog.jsonb_typeof(p_value) <> 'array'
    or pg_catalog.jsonb_array_length(p_value) > 5 then
    return false;
  end if;

  for v_item in
    select item.value
    from pg_catalog.jsonb_array_elements(p_value) as item(value)
  loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object' then
      return false;
    end if;
    select pg_catalog.count(*)::integer
    into v_key_count
    from pg_catalog.jsonb_object_keys(v_item);

    if v_key_count <> 3
      or pg_catalog.jsonb_typeof(v_item->'filename') <> 'string'
      or pg_catalog.char_length(pg_catalog.btrim(v_item->>'filename')) not between 1 and 120
      or (v_item->>'filename') <> pg_catalog.btrim(v_item->>'filename')
      or (v_item->>'filename') ~ '[[:cntrl:]/\\]'
      or pg_catalog.jsonb_typeof(v_item->'contentType') <> 'string'
      or pg_catalog.char_length(pg_catalog.btrim(v_item->>'contentType')) not between 3 and 255
      or (v_item->>'contentType') <> pg_catalog.lower(pg_catalog.btrim(v_item->>'contentType'))
      or pg_catalog.position('/' in (v_item->>'contentType')) <= 1
      or pg_catalog.jsonb_typeof(v_item->'size') <> 'number' then
      return false;
    end if;

    v_size := (v_item->>'size')::numeric;
    if v_size <> pg_catalog.trunc(v_size)
      or v_size < 1
      or v_size > 4194304 then
      return false;
    end if;
    v_total := v_total + v_size;
  end loop;

  return v_total <= 5242880;
end;
$function$;

alter table public.softora_mailbox_send_provenance
  drop constraint if exists softora_mailbox_send_provenance_attachments_metadata_check;
alter table public.softora_mailbox_send_provenance
  add constraint softora_mailbox_send_provenance_attachments_metadata_check
  check (
    attachments_metadata is null
    or public.softora_mailbox_attachments_metadata_is_valid(attachments_metadata)
  );

-- Attachment evidence changes the rendered accepted fallback and therefore
-- participates in the same campaign-content fence as the existing fields.
create or replace function public.softora_track_mailbox_send_provenance_change()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_old_visible jsonb := null;
  v_new_visible jsonb := null;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'accepted'
    and old.accepted_at is not null
    and public.softora_normalize_mailbox_message_id(old.sent_message_id) is not null then
    v_old_visible := pg_catalog.jsonb_build_array(
      pg_catalog.lower(pg_catalog.btrim(old.account_email)),
      pg_catalog.lower(pg_catalog.btrim(old.recipient_email)),
      public.softora_normalize_mailbox_message_id(old.sent_message_id),
      old.accepted_at, old.sender_name, old.subject, old.body_text,
      old.cc_text, old.bcc_text, old.provider, old.provider_message_id,
      old.provider_thread_id, old.conversation_id, old.reply_target_message_id,
      old.references_text, old.mode, old.owner, old.attachments_metadata
    );
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.status = 'accepted'
    and new.accepted_at is not null
    and public.softora_normalize_mailbox_message_id(new.sent_message_id) is not null then
    v_new_visible := pg_catalog.jsonb_build_array(
      pg_catalog.lower(pg_catalog.btrim(new.account_email)),
      pg_catalog.lower(pg_catalog.btrim(new.recipient_email)),
      public.softora_normalize_mailbox_message_id(new.sent_message_id),
      new.accepted_at, new.sender_name, new.subject, new.body_text,
      new.cc_text, new.bcc_text, new.provider, new.provider_message_id,
      new.provider_thread_id, new.conversation_id, new.reply_target_message_id,
      new.references_text, new.mode, new.owner, new.attachments_metadata
    );
  end if;
  if v_old_visible is distinct from v_new_visible then
    update public.softora_mailbox_campaign_consistency as consistency
    set content_version = consistency.content_version + 1,
        updated_at = pg_catalog.clock_timestamp()
    where consistency.scope = 'campaign';
    if not found then
      raise exception using errcode = '55000',
        message = 'MAILBOX_CAMPAIGN_FENCE_MISSING';
    end if;
  end if;
  return null;
end;
$function$;

drop trigger if exists softora_track_mailbox_send_provenance_change
  on public.softora_mailbox_send_provenance;
create trigger softora_track_mailbox_send_provenance_change
after insert or update or delete
on public.softora_mailbox_send_provenance
for each row
execute function public.softora_track_mailbox_send_provenance_change();

revoke all on function public.softora_mailbox_attachments_metadata_is_valid(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.softora_mailbox_attachments_metadata_is_valid(jsonb)
  to service_role;
revoke all on function public.softora_track_mailbox_send_provenance_change()
  from public, anon, authenticated;
grant execute on function public.softora_track_mailbox_send_provenance_change()
  to service_role;

notify pgrst, 'reload schema';

-- mailbox-send-attachment-metadata:end
