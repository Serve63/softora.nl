-- Keep delayed browser/outbox mutations bound to the exact mailbox generation.
-- UID and provider-id remain routing hints; message_key is the authoritative
-- identity and is verified while holding the same generation/campaign fence as
-- the existing idempotent mutation.

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
  v_expected_message_key text := pg_catalog.btrim(coalesce(p_expected_message_key, ''));
  v_expected_message_id text := public.softora_normalize_mailbox_message_id(p_expected_message_id);
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

  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  perform 1
  from public.softora_mailbox_campaign_consistency
  where scope = 'campaign'
  for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'MAILBOX_CAMPAIGN_FENCE_MISSING';
  end if;

  select message.*
  into v_row
  from public.softora_mailbox_messages as message
  where message.message_key = v_expected_message_key
    and pg_catalog.lower(pg_catalog.btrim(message.account_email))
      = pg_catalog.lower(pg_catalog.btrim(p_account_email))
    and pg_catalog.lower(pg_catalog.btrim(message.folder))
      = pg_catalog.lower(pg_catalog.btrim(p_folder))
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

  return query
  select mutation.*
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
) is 'Applies idempotent mailbox UI state only after atomically matching the exact active message_key and optional RFC Message-ID.';
