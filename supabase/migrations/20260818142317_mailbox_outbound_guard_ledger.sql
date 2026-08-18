-- mailbox-outbound-guard-ledger:start
-- The central recipient guard is the only pre-send duplicate authority. Keep it
-- complete from durable mailbox evidence so the sender never needs to scan the
-- large mailbox history directly before SMTP.

create or replace function public.softora_mailbox_outbound_recipient_emails(
  p_recipients_text text,
  p_payload jsonb
)
returns table (recipient_email text)
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select distinct pg_catalog.lower(matches[1]) as recipient_email
  from pg_catalog.regexp_matches(
    pg_catalog.lower(pg_catalog.concat_ws(
      ' ',
      p_recipients_text,
      coalesce(p_payload, '{}'::jsonb)->>'to',
      coalesce(p_payload, '{}'::jsonb)->>'toDisplay',
      coalesce(p_payload, '{}'::jsonb)->>'cc',
      coalesce(p_payload, '{}'::jsonb)->>'bcc',
      coalesce(p_payload, '{}'::jsonb)->>'recipients'
    )),
    '([a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+[.][a-z]{2,})',
    'g'
  ) as matches
  where pg_catalog.char_length(matches[1]) <= 320;
$function$;

create or replace function public.softora_outbound_guard_domain_key(p_domain text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select pg_catalog.left(
    pg_catalog.btrim(pg_catalog.regexp_replace(
      pg_catalog.lower(pg_catalog.btrim(coalesce(p_domain, ''))),
      '[^a-z0-9]+',
      '-',
      'g'
    ), '-'),
    180
  );
$function$;

create or replace function public.softora_outbound_guard_is_personal_domain(p_domain text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select pg_catalog.lower(pg_catalog.rtrim(pg_catalog.btrim(coalesce(p_domain, '')), '.'))
    = any(array[
      'gmail.com',
      'googlemail.com',
      'outlook.com',
      'hotmail.com',
      'live.com',
      'icloud.com',
      'me.com',
      'msn.com',
      'yahoo.com',
      'proton.me',
      'protonmail.com'
    ]::text[]);
$function$;

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
  if v_folder <> all(array['sent', 'coldmail', 'instantly']::text[]) then
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

create or replace function public.softora_sync_mailbox_outbound_recipient_guards()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' then
    if row(
      new.message_key,
      new.account_email,
      new.folder,
      new.sender_email,
      new.recipients_text,
      new.payload,
      new.date,
      new.internal_date
    ) is not distinct from row(
      old.message_key,
      old.account_email,
      old.folder,
      old.sender_email,
      old.recipients_text,
      old.payload,
      old.date,
      old.internal_date
    ) then
      return new;
    end if;
  end if;

  perform public.softora_record_mailbox_outbound_recipient_guards(
    new.message_key,
    new.account_email,
    new.folder,
    new.sender_email,
    new.recipients_text,
    new.payload,
    new.date,
    new.internal_date
  );
  return new;
end;
$function$;

-- Backfill every durable outbound mailbox recipient before publishing the
-- readiness marker. DISTINCT ON prevents one upsert statement from touching a
-- shared business-domain guard more than once.
with outbound_messages as (
  select
    messages.message_key,
    pg_catalog.lower(pg_catalog.btrim(messages.account_email)) as account_email,
    pg_catalog.lower(pg_catalog.btrim(messages.folder)) as folder,
    pg_catalog.lower(pg_catalog.btrim(coalesce(
      nullif(pg_catalog.btrim(messages.sender_email), ''),
      messages.account_email
    ))) as sender_email,
    pg_catalog.lower(pg_catalog.btrim(coalesce(messages.payload->>'providerAccountEmail', ''))) as provider_account_email,
    messages.recipients_text,
    messages.payload,
    coalesce(messages.date, messages.internal_date, messages.created_at) as evidence_at
  from public.softora_mailbox_messages as messages
  where pg_catalog.lower(pg_catalog.btrim(messages.folder))
    = any(array['sent', 'coldmail', 'instantly']::text[])
),
recipients as (
  select
    outbound_messages.*,
    candidate.recipient_email,
    pg_catalog.split_part(candidate.recipient_email, '@', 2) as raw_domain,
    public.softora_outbound_guard_domain_key(
      pg_catalog.split_part(candidate.recipient_email, '@', 2)
    ) as domain_key
  from outbound_messages
  cross join lateral public.softora_mailbox_outbound_recipient_emails(
    outbound_messages.recipients_text,
    outbound_messages.payload
  ) as candidate
  where candidate.recipient_email <> all(array[
    outbound_messages.account_email,
    outbound_messages.sender_email,
    outbound_messages.provider_account_email
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
    recipients.*,
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
  select
    recipients.*,
    domain_key as recipient_domain,
    'domain'::text as key_type,
    domain_key as key_value,
    'domain:' || domain_key as guard_key
  from recipients
  where domain_key <> ''
    and not public.softora_outbound_guard_is_personal_domain(raw_domain)
),
key_rows as (
  select * from email_keys
  union all
  select * from domain_keys
),
latest_key_rows as (
  select distinct on (guard_key) *
  from key_rows
  order by guard_key, evidence_at desc, message_key desc
)
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
  latest_key_rows.guard_key,
  latest_key_rows.key_type,
  latest_key_rows.key_value,
  'mailbox-ledger-' || pg_catalog.substr(
    pg_catalog.md5(latest_key_rows.message_key || ':' || latest_key_rows.recipient_email),
    1,
    20
  ),
  case when latest_key_rows.folder = 'instantly' then 'instantly' else 'softora' end,
  'coldmail',
  latest_key_rows.sender_email,
  latest_key_rows.recipient_email,
  latest_key_rows.recipient_domain,
  'sent',
  'mailbox-outbound-ledger',
  'database-migration',
  true,
  pg_catalog.jsonb_build_object(
    'messageKey', latest_key_rows.message_key,
    'folder', latest_key_rows.folder,
    'evidenceAt', latest_key_rows.evidence_at,
    'evidenceSource', 'softora_mailbox_messages'
  ),
  null,
  latest_key_rows.evidence_at,
  pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp()
from latest_key_rows
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
where existing_guard.permanent = false;

drop trigger if exists softora_sync_mailbox_outbound_recipient_guards
  on public.softora_mailbox_messages;
create trigger softora_sync_mailbox_outbound_recipient_guards
after insert or update of
  message_key,
  account_email,
  folder,
  sender_email,
  recipients_text,
  payload,
  date,
  internal_date
on public.softora_mailbox_messages
for each row execute function public.softora_sync_mailbox_outbound_recipient_guards();

insert into public.softora_outbound_recipient_guards (
  guard_key,
  key_type,
  key_value,
  reservation_id,
  provider,
  channel,
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
values (
  'system:mailbox-outbound-ledger-v1',
  'system',
  'mailbox-outbound-ledger-v1',
  'mailbox-outbound-ledger-v1',
  'softora',
  'outbound-guard-ledger',
  'ready',
  'mailbox-outbound-ledger-migration',
  'database-migration',
  true,
  pg_catalog.jsonb_build_object(
    'version', 1,
    'backfillCompletedAt', pg_catalog.clock_timestamp(),
    'trigger', 'softora_sync_mailbox_outbound_recipient_guards'
  ),
  null,
  pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp()
)
on conflict (guard_key) do update
set
  status = 'ready',
  permanent = true,
  expires_at = null,
  payload = excluded.payload,
  last_seen_at = excluded.last_seen_at,
  updated_at = excluded.updated_at;

revoke all on function public.softora_mailbox_outbound_recipient_emails(text, jsonb)
  from public, anon, authenticated;
revoke all on function public.softora_outbound_guard_domain_key(text)
  from public, anon, authenticated;
revoke all on function public.softora_outbound_guard_is_personal_domain(text)
  from public, anon, authenticated;
revoke all on function public.softora_record_mailbox_outbound_recipient_guards(text, text, text, text, text, jsonb, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function public.softora_sync_mailbox_outbound_recipient_guards()
  from public, anon, authenticated;

grant execute on function public.softora_mailbox_outbound_recipient_emails(text, jsonb)
  to service_role;
grant execute on function public.softora_outbound_guard_domain_key(text)
  to service_role;
grant execute on function public.softora_outbound_guard_is_personal_domain(text)
  to service_role;
grant execute on function public.softora_record_mailbox_outbound_recipient_guards(text, text, text, text, text, jsonb, timestamptz, timestamptz)
  to service_role;
grant execute on function public.softora_sync_mailbox_outbound_recipient_guards()
  to service_role;
-- mailbox-outbound-guard-ledger:end
