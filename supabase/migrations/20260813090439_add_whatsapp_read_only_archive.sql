create table if not exists public.softora_whatsapp_webhook_events (
  event_key text primary key,
  encrypted_payload text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lock_token text,
  lock_expires_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  constraint softora_whatsapp_webhook_events_status_check
    check (status in ('pending', 'processing', 'retry', 'completed'))
);

create index if not exists softora_whatsapp_webhook_events_queue_idx
  on public.softora_whatsapp_webhook_events (status, next_attempt_at, received_at);

create table if not exists public.softora_whatsapp_messages (
  message_key text primary key,
  conversation_key text not null,
  contact_search_keys text[] not null default '{}',
  content_search_keys text[] not null default '{}',
  contact_name_encrypted text,
  contact_phone_encrypted text not null,
  content_encrypted text not null,
  direction text not null,
  message_type text not null,
  source_field text not null,
  history_status text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  edited_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint softora_whatsapp_messages_direction_check
    check (direction in ('inbound', 'outbound'))
);

create index if not exists softora_whatsapp_messages_conversation_time_idx
  on public.softora_whatsapp_messages (conversation_key, occurred_at desc);
create index if not exists softora_whatsapp_messages_occurred_at_idx
  on public.softora_whatsapp_messages (occurred_at desc);
create index if not exists softora_whatsapp_messages_contact_search_idx
  on public.softora_whatsapp_messages using gin (contact_search_keys);
create index if not exists softora_whatsapp_messages_content_search_idx
  on public.softora_whatsapp_messages using gin (content_search_keys);

create table if not exists public.softora_whatsapp_contacts (
  conversation_key text primary key,
  search_keys text[] not null default '{}',
  name_encrypted text,
  phone_encrypted text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists softora_whatsapp_contacts_search_idx
  on public.softora_whatsapp_contacts using gin (search_keys);

create table if not exists public.softora_whatsapp_sync_state (
  owner_key text primary key,
  phone_number_key text,
  display_phone_encrypted text,
  history_phase integer,
  history_progress integer,
  history_declined boolean not null default false,
  last_webhook_at timestamptz,
  last_message_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint softora_whatsapp_sync_state_progress_check
    check (history_progress is null or history_progress between 0 and 100),
  constraint softora_whatsapp_sync_state_phase_check
    check (history_phase is null or history_phase between 0 and 2)
);

alter table public.softora_whatsapp_webhook_events enable row level security;
alter table public.softora_whatsapp_messages enable row level security;
alter table public.softora_whatsapp_contacts enable row level security;
alter table public.softora_whatsapp_sync_state enable row level security;

revoke all on table public.softora_whatsapp_webhook_events from public, anon, authenticated;
revoke all on table public.softora_whatsapp_messages from public, anon, authenticated;
revoke all on table public.softora_whatsapp_contacts from public, anon, authenticated;
revoke all on table public.softora_whatsapp_sync_state from public, anon, authenticated;

grant select, insert, update, delete on table public.softora_whatsapp_webhook_events to service_role;
grant select, insert, update, delete on table public.softora_whatsapp_messages to service_role;
grant select, insert, update, delete on table public.softora_whatsapp_contacts to service_role;
grant select, insert, update, delete on table public.softora_whatsapp_sync_state to service_role;

create or replace function public.softora_claim_whatsapp_webhook_events(
  p_limit integer,
  p_lock_token text,
  p_lock_seconds integer default 300
)
returns setof public.softora_whatsapp_webhook_events
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(10, coalesce(p_limit, 2)));
  v_lock_token text := btrim(coalesce(p_lock_token, ''));
  v_now timestamptz := clock_timestamp();
begin
  if v_lock_token = '' or char_length(v_lock_token) > 200 then
    raise exception using errcode = '22023', message = 'WHATSAPP_WEBHOOK_LOCK_INVALID';
  end if;

  return query
  with candidates as (
    select event.event_key
    from public.softora_whatsapp_webhook_events as event
    where event.next_attempt_at <= v_now
      and (
        event.status in ('pending', 'retry')
        or (event.status = 'processing' and event.lock_expires_at <= v_now)
      )
    order by event.received_at asc
    for update skip locked
    limit v_limit
  )
  update public.softora_whatsapp_webhook_events as event
  set status = 'processing',
      attempts = event.attempts + 1,
      lock_token = v_lock_token,
      lock_expires_at = v_now + make_interval(
        secs => greatest(60, least(900, coalesce(p_lock_seconds, 300)))
      ),
      last_error = null
  from candidates
  where event.event_key = candidates.event_key
  returning event.*;
end;
$$;

create or replace function public.softora_upsert_whatsapp_messages(p_messages jsonb)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if p_messages is null or jsonb_typeof(p_messages) <> 'array'
    or jsonb_array_length(p_messages) > 500 then
    raise exception using errcode = '22023', message = 'WHATSAPP_MESSAGE_BATCH_INVALID';
  end if;

  insert into public.softora_whatsapp_messages as stored (
    message_key,
    conversation_key,
    contact_search_keys,
    content_search_keys,
    contact_name_encrypted,
    contact_phone_encrypted,
    content_encrypted,
    direction,
    message_type,
    source_field,
    history_status,
    occurred_at,
    received_at,
    edited_at,
    revoked_at,
    updated_at
  )
  select
    message_key,
    conversation_key,
    coalesce(contact_search_keys, '{}'),
    coalesce(content_search_keys, '{}'),
    contact_name_encrypted,
    contact_phone_encrypted,
    content_encrypted,
    direction,
    message_type,
    source_field,
    history_status,
    occurred_at,
    coalesce(received_at, clock_timestamp()),
    edited_at,
    revoked_at,
    clock_timestamp()
  from jsonb_to_recordset(p_messages) as incoming (
    message_key text,
    conversation_key text,
    contact_search_keys text[],
    content_search_keys text[],
    contact_name_encrypted text,
    contact_phone_encrypted text,
    content_encrypted text,
    direction text,
    message_type text,
    source_field text,
    history_status text,
    occurred_at timestamptz,
    received_at timestamptz,
    edited_at timestamptz,
    revoked_at timestamptz
  )
  on conflict (message_key) do update
  set conversation_key = excluded.conversation_key,
      contact_search_keys = case
        when cardinality(excluded.contact_search_keys) > 0 then excluded.contact_search_keys
        else stored.contact_search_keys
      end,
      content_search_keys = case
        when excluded.revoked_at is not null then '{}'
        when stored.revoked_at is not null then stored.content_search_keys
        when stored.edited_at is not null and excluded.edited_at is null then stored.content_search_keys
        else excluded.content_search_keys
      end,
      contact_name_encrypted = coalesce(
        nullif(excluded.contact_name_encrypted, ''),
        stored.contact_name_encrypted
      ),
      contact_phone_encrypted = excluded.contact_phone_encrypted,
      content_encrypted = case
        when excluded.revoked_at is not null then excluded.content_encrypted
        when stored.revoked_at is not null then stored.content_encrypted
        when stored.edited_at is not null and excluded.edited_at is null then stored.content_encrypted
        else excluded.content_encrypted
      end,
      direction = case
        when excluded.edited_at is not null or excluded.revoked_at is not null then stored.direction
        else excluded.direction
      end,
      message_type = case
        when excluded.revoked_at is not null then 'revoked'
        when stored.revoked_at is not null then stored.message_type
        when stored.edited_at is not null and excluded.edited_at is null then stored.message_type
        else excluded.message_type
      end,
      source_field = excluded.source_field,
      history_status = coalesce(excluded.history_status, stored.history_status),
      occurred_at = least(stored.occurred_at, excluded.occurred_at),
      edited_at = coalesce(excluded.edited_at, stored.edited_at),
      revoked_at = coalesce(excluded.revoked_at, stored.revoked_at),
      updated_at = clock_timestamp();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.softora_upsert_whatsapp_contacts(p_contacts jsonb)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if p_contacts is null or jsonb_typeof(p_contacts) <> 'array'
    or jsonb_array_length(p_contacts) > 500 then
    raise exception using errcode = '22023', message = 'WHATSAPP_CONTACT_BATCH_INVALID';
  end if;

  insert into public.softora_whatsapp_contacts as stored (
    conversation_key,
    search_keys,
    name_encrypted,
    phone_encrypted,
    first_seen_at,
    last_seen_at,
    updated_at
  )
  select
    conversation_key,
    coalesce(search_keys, '{}'),
    name_encrypted,
    phone_encrypted,
    coalesce(last_seen_at, clock_timestamp()),
    coalesce(last_seen_at, clock_timestamp()),
    clock_timestamp()
  from jsonb_to_recordset(p_contacts) as incoming (
    conversation_key text,
    search_keys text[],
    name_encrypted text,
    phone_encrypted text,
    last_seen_at timestamptz
  )
  on conflict (conversation_key) do update
  set search_keys = (
        select array_agg(distinct search_key)
        from unnest(stored.search_keys || excluded.search_keys) as search_key
      ),
      name_encrypted = coalesce(nullif(excluded.name_encrypted, ''), stored.name_encrypted),
      phone_encrypted = excluded.phone_encrypted,
      last_seen_at = greatest(stored.last_seen_at, excluded.last_seen_at),
      updated_at = clock_timestamp();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.softora_claim_whatsapp_webhook_events(integer, text, integer)
  from public, anon, authenticated;
revoke all on function public.softora_upsert_whatsapp_messages(jsonb)
  from public, anon, authenticated;
revoke all on function public.softora_upsert_whatsapp_contacts(jsonb)
  from public, anon, authenticated;
grant execute on function public.softora_claim_whatsapp_webhook_events(integer, text, integer)
  to service_role;
grant execute on function public.softora_upsert_whatsapp_messages(jsonb)
  to service_role;
grant execute on function public.softora_upsert_whatsapp_contacts(jsonb)
  to service_role;
