-- mailbox-outbound-direction-evidence:start
-- Folder labels can contain replies. Require the sending identity as well.
create or replace function public.softora_mailbox_message_is_outbound(
  p_account_email text, p_folder text, p_sender_email text, p_payload jsonb
) returns boolean
language sql immutable parallel safe security invoker set search_path = ''
as $function$
  select pg_catalog.lower(pg_catalog.btrim(coalesce(p_folder, ''))) = any(array['sent','coldmail','instantly']::text[])
    and pg_catalog.btrim(coalesce(p_sender_email, '')) <> ''
    and pg_catalog.lower(pg_catalog.btrim(p_sender_email)) = any(array[
      pg_catalog.lower(pg_catalog.btrim(coalesce(p_account_email, ''))),
      pg_catalog.lower(pg_catalog.btrim(coalesce(p_payload->>'providerAccountEmail', '')))
    ]::text[]);
$function$;
revoke all on function public.softora_mailbox_message_is_outbound(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.softora_mailbox_message_is_outbound(text, text, text, jsonb) to service_role;

create or replace function public.softora_record_mailbox_outbound_recipient_guards(
  p_message_key text,
  p_account_email text,
  p_folder text,
  p_sender_email text,
  p_recipients_text text,
  p_payload jsonb,
  p_message_date timestamptz,
  p_internal_date timestamptz
)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_folder text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_folder, '')));
  v_account_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_account_email, '')));
  v_sender_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(
    nullif(pg_catalog.btrim(p_sender_email), ''),
    p_account_email,
    ''
  )));
  v_provider_account_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_payload->>'providerAccountEmail', '')));
  v_evidence_at timestamptz := coalesce(p_message_date, p_internal_date, pg_catalog.clock_timestamp());
  v_written integer := 0;
begin
  if not public.softora_mailbox_message_is_outbound(p_account_email, p_folder, p_sender_email, p_payload) then
    return 0;
  end if;

  with recipients as (
    select
      candidate.recipient_email,
      pg_catalog.split_part(candidate.recipient_email, '@', 2) as raw_domain,
      public.softora_outbound_guard_domain_key(
        pg_catalog.split_part(candidate.recipient_email, '@', 2)
      ) as domain_key
    from public.softora_mailbox_outbound_recipient_emails(p_recipients_text, p_payload) as candidate
    where candidate.recipient_email <> all(array[
      v_account_email,
      v_sender_email,
      v_provider_account_email
    ]::text[])
      and pg_catalog.split_part(candidate.recipient_email, '@', 2) <> 'softora.nl'
      and not exists (
        select 1
        from public.softora_mailbox_sync_state as sync_state
        where pg_catalog.lower(pg_catalog.btrim(sync_state.account_email)) = candidate.recipient_email
      )
  ),
  email_keys as (
    select
      recipient_email,
      case
        when public.softora_outbound_guard_is_personal_domain(raw_domain) then ''
        else domain_key
      end as recipient_domain,
      'email'::text as key_type,
      recipient_email as key_value,
      'email:' || recipient_email as guard_key
    from recipients
  ),
  domain_keys as (
    select distinct on (domain_key)
      recipient_email,
      domain_key as recipient_domain,
      'domain'::text as key_type,
      domain_key as key_value,
      'domain:' || domain_key as guard_key
    from recipients
    where domain_key <> ''
      and not public.softora_outbound_guard_is_personal_domain(raw_domain)
    order by domain_key, recipient_email
  ),
  key_rows as (
    select * from email_keys
    union all
    select * from domain_keys
  ),
  upserted as (
    insert into public.softora_outbound_recipient_guards as existing_guard (
      guard_key,
      key_type,
      key_value,
      reservation_id,
      provider,
      channel,
      sender_email,
      recipient_email,
      recipient_domain,
      status,
      source,
      actor,
      permanent,
      payload,
      expires_at,
      last_seen_at,
      created_at,
      updated_at
    )
    select
      key_rows.guard_key,
      key_rows.key_type,
      key_rows.key_value,
      'mailbox-ledger-' || pg_catalog.substr(
        pg_catalog.md5(coalesce(p_message_key, '') || ':' || key_rows.recipient_email),
        1,
        20
      ),
      case when v_folder = 'instantly' then 'instantly' else 'softora' end,
      'coldmail',
      v_sender_email,
      key_rows.recipient_email,
      key_rows.recipient_domain,
      'sent',
      'mailbox-outbound-ledger',
      'database-trigger',
      true,
      pg_catalog.jsonb_build_object(
        'messageKey', coalesce(p_message_key, ''),
        'folder', v_folder,
        'direction', 'outbound',
        'accountEmail', v_account_email,
        'providerAccountEmail', v_provider_account_email,
        'evidenceAt', v_evidence_at,
        'evidenceSource', 'softora_mailbox_messages'
      ),
      null,
      v_evidence_at,
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp()
    from key_rows
    on conflict (guard_key) do update
    set
      status = 'sent',
      permanent = true,
      expires_at = null,
      sender_email = coalesce(nullif(existing_guard.sender_email, ''), excluded.sender_email),
      recipient_email = coalesce(nullif(existing_guard.recipient_email, ''), excluded.recipient_email),
      recipient_domain = coalesce(nullif(existing_guard.recipient_domain, ''), excluded.recipient_domain),
      provider = coalesce(nullif(existing_guard.provider, ''), excluded.provider),
      channel = coalesce(nullif(existing_guard.channel, ''), excluded.channel),
      source = case
        when coalesce(existing_guard.source, '') in ('', 'unknown') then excluded.source
        else existing_guard.source
      end,
      actor = coalesce(nullif(existing_guard.actor, ''), excluded.actor),
      payload = case
        when existing_guard.payload = '{}'::jsonb then excluded.payload
        else existing_guard.payload
      end,
      last_seen_at = greatest(existing_guard.last_seen_at, excluded.last_seen_at),
      updated_at = pg_catalog.clock_timestamp()
    where existing_guard.permanent = false
    returning 1
  )
  select pg_catalog.count(*)::integer into v_written from upserted;

  return v_written;
end;
$function$;

-- Annotate only rows whose original mailbox evidence proves a different sender.
-- Keep every permanent guard and reservation: no recipient becomes mail-ready again.
update public.softora_outbound_recipient_guards as g
set payload = g.payload || pg_catalog.jsonb_build_object(
  'sentStatsExcluded', true,
  'sentStatsExclusionReason', 'incoming-mailbox-message',
  'sentStatsCorrectedAt', pg_catalog.clock_timestamp()
), updated_at = pg_catalog.clock_timestamp()
from public.softora_mailbox_messages as m
where g.source = 'mailbox-outbound-ledger'
  and g.provider = 'softora'
  and g.payload->>'messageKey' = m.message_key
  and g.permanent = true
  and g.status = 'sent'
  and pg_catalog.btrim(coalesce(m.sender_email, '')) <> ''
  and not public.softora_mailbox_message_is_outbound(
    m.account_email, coalesce(g.payload->>'folder', m.folder), m.sender_email, m.payload)
  and coalesce(g.payload->>'sentStatsExcluded', 'false') <> 'true';
-- mailbox-outbound-direction-evidence:end
