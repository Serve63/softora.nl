-- Softora structured data-ops storage.
-- Apply this in Supabase before enabling the structured tables as the leading source of truth.
-- The legacy public.softora_runtime_state table remains the compatibility fallback.

create table if not exists public.softora_customers (
  customer_id text primary key,
  identity_key text,
  company text,
  contact_name text,
  phone text,
  email text,
  website text,
  database_status text,
  lifecycle_status text,
  responsible text,
  payload jsonb not null default '{}'::jsonb,
  source text not null default 'unknown',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists softora_customers_updated_at_idx
  on public.softora_customers (updated_at desc);
create index if not exists softora_customers_deleted_at_idx
  on public.softora_customers (deleted_at);
create index if not exists softora_customers_identity_key_idx
  on public.softora_customers (identity_key);

create table if not exists public.softora_customer_identity_keys (
  key_type text not null,
  key_value text not null,
  customer_id text not null,
  source text not null default 'unknown',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (key_type, key_value)
);

create index if not exists softora_customer_identity_keys_customer_id_idx
  on public.softora_customer_identity_keys (customer_id);
create index if not exists softora_customer_identity_keys_deleted_at_idx
  on public.softora_customer_identity_keys (deleted_at);

create table if not exists public.softora_active_orders (
  order_id text primary key,
  customer_id text,
  customer_name text,
  company_name text,
  title text,
  status text,
  payload jsonb not null default '{}'::jsonb,
  source text not null default 'unknown',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists softora_active_orders_updated_at_idx
  on public.softora_active_orders (updated_at desc);
create index if not exists softora_active_orders_deleted_at_idx
  on public.softora_active_orders (deleted_at);

create table if not exists public.softora_order_runtime (
  order_id text primary key,
  status_key text,
  progress_pct numeric,
  payload jsonb not null default '{}'::jsonb,
  source text not null default 'unknown',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists softora_order_runtime_updated_at_idx
  on public.softora_order_runtime (updated_at desc);
create index if not exists softora_order_runtime_deleted_at_idx
  on public.softora_order_runtime (deleted_at);

create table if not exists public.softora_design_photos (
  customer_id text primary key,
  identity_key text,
  storage_bucket text not null default 'softora-design-photos',
  storage_path text not null,
  mime_type text not null default 'image/jpeg',
  file_name text,
  byte_size bigint,
  content_hash text,
  legacy_meta jsonb not null default '{}'::jsonb,
  source text not null default 'unknown',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists softora_design_photos_updated_at_idx
  on public.softora_design_photos (updated_at desc);
create index if not exists softora_design_photos_deleted_at_idx
  on public.softora_design_photos (deleted_at);
create index if not exists softora_design_photos_content_hash_idx
  on public.softora_design_photos (content_hash);

create table if not exists public.softora_webdesign_jobs (
  job_id text primary key,
  owner_key text not null,
  customer_id text,
  website_url text,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'error')),
  error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists softora_webdesign_jobs_owner_idx
  on public.softora_webdesign_jobs (owner_key, created_at desc);
create index if not exists softora_webdesign_jobs_customer_status_idx
  on public.softora_webdesign_jobs (owner_key, customer_id, status);

create table if not exists public.softora_company_website_videos (
  company_id text primary key,
  original_website_url text not null,
  normalized_website_url text not null,
  video_path text,
  storage_bucket text not null default 'softora-company-website-videos',
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'failed')),
  error_text text,
  lock_token text,
  lock_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists softora_company_website_videos_status_idx
  on public.softora_company_website_videos (status, updated_at);

create or replace function public.softora_queue_company_website_video(
  p_company_id text,
  p_original_website_url text,
  p_normalized_website_url text,
  p_force_retry boolean default false
)
returns setof public.softora_company_website_videos
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.softora_company_website_videos (
    company_id,
    original_website_url,
    normalized_website_url,
    status,
    updated_at
  ) values (
    p_company_id,
    p_original_website_url,
    p_normalized_website_url,
    'pending',
    now()
  )
  on conflict (company_id) do update
  set
    original_website_url = excluded.original_website_url,
    normalized_website_url = excluded.normalized_website_url,
    video_path = null,
    status = 'pending',
    error_text = null,
    lock_token = null,
    lock_expires_at = null,
    started_at = null,
    completed_at = null,
    updated_at = now()
  where
    p_force_retry
    or softora_company_website_videos.normalized_website_url <> excluded.normalized_website_url
    or softora_company_website_videos.status = 'failed';

  return query
  select * from public.softora_company_website_videos where company_id = p_company_id;
end;
$$;

create or replace function public.softora_claim_company_website_video(
  p_lock_token text,
  p_lock_timeout_seconds integer default 300
)
returns setof public.softora_company_website_videos
language plpgsql
security invoker
set search_path = public
as $$
declare
  claimed_company_id text;
begin
  select company_id
  into claimed_company_id
  from public.softora_company_website_videos
  where
    status = 'pending'
    or (status = 'processing' and lock_expires_at < now())
  order by updated_at asc
  for update skip locked
  limit 1;

  if claimed_company_id is null then
    return;
  end if;

  return query
  update public.softora_company_website_videos
  set
    status = 'processing',
    error_text = null,
    lock_token = p_lock_token,
    lock_expires_at = now() + make_interval(secs => greatest(60, least(1800, p_lock_timeout_seconds))),
    started_at = now(),
    completed_at = null,
    updated_at = now()
  where company_id = claimed_company_id
  returning *;
end;
$$;

create table if not exists public.softora_mailbox_messages (
  message_key text primary key,
  account_email text not null,
  folder text not null,
  uid bigint not null,
  provider_id text not null,
  message_id text,
  in_reply_to text,
  references_text text,
  sender_name text,
  sender_email text,
  recipients_text text,
  subject text,
  preview text,
  body_text text,
  body_truncated boolean not null default false,
  has_body boolean not null default false,
  date timestamptz not null,
  internal_date timestamptz,
  unread boolean not null default false,
  softora_read_at timestamptz,
  state_revision bigint not null default 0 check (state_revision >= 0),
  state_mutation_key text check (
    state_mutation_key is null or state_mutation_key ~ '^[a-f0-9]{64}$'
  ),
  state_mutation_at timestamptz,
  starred boolean not null default false,
  reply_dismissed_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (account_email, folder, uid)
);

create index if not exists softora_mailbox_messages_account_folder_date_idx
  on public.softora_mailbox_messages (account_email, folder, date desc);
create index if not exists softora_mailbox_messages_message_id_idx
  on public.softora_mailbox_messages (account_email, message_id);
create index if not exists softora_mailbox_messages_deleted_at_idx
  on public.softora_mailbox_messages (deleted_at);
create index if not exists softora_mailbox_messages_state_mutation_key_idx
  on public.softora_mailbox_messages (state_mutation_key)
  where state_mutation_key is not null;

create or replace function public.softora_preserve_mailbox_read_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.state_revision > old.state_revision then
    if new.unread then
      new.softora_read_at := null;
    elsif new.softora_read_at is null then
      new.softora_read_at := clock_timestamp();
    end if;
  elsif old.softora_read_at is not null then
    new.softora_read_at := old.softora_read_at;
    new.unread := false;
  elsif new.softora_read_at is not null then
    new.unread := false;
  end if;
  return new;
end;
$$;

drop trigger if exists softora_mailbox_messages_preserve_read_state
  on public.softora_mailbox_messages;
create trigger softora_mailbox_messages_preserve_read_state
before update on public.softora_mailbox_messages
for each row execute function public.softora_preserve_mailbox_read_state();

revoke execute on function public.softora_preserve_mailbox_read_state()
  from public, anon, authenticated;
grant execute on function public.softora_preserve_mailbox_read_state()
  to service_role;

create or replace function public.softora_apply_mailbox_state_mutation(
  p_account_email text,
  p_folder text,
  p_uid bigint,
  p_provider_id text,
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
as $$
declare
  v_row public.softora_mailbox_messages%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if char_length(btrim(coalesce(p_account_email, ''))) < 3
    or char_length(btrim(coalesce(p_folder, ''))) < 1
    or char_length(btrim(coalesce(p_mutation_key, ''))) <> 64
    or btrim(coalesce(p_mutation_key, '')) !~ '^[a-f0-9]{64}$'
    or coalesce(p_revision, 0) < 1
    or (coalesce(p_uid, 0) < 1 and char_length(btrim(coalesce(p_provider_id, ''))) < 1) then
    raise exception using errcode = '22023', message = 'Ongeldige mailbox-state-mutatie';
  end if;

  select m.*
  into v_row
  from public.softora_mailbox_messages as m
  where lower(btrim(m.account_email)) = lower(btrim(p_account_email))
    and lower(btrim(m.folder)) = lower(btrim(p_folder))
    and m.deleted_at is null
    and (
      (coalesce(p_uid, 0) > 0 and m.uid = p_uid)
      or (coalesce(p_uid, 0) < 1 and m.provider_id = btrim(p_provider_id))
    )
  order by m.updated_at desc, m.message_key
  limit 1
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Mailboxbericht niet gevonden';
  end if;

  if v_row.state_revision > p_revision
    or (v_row.state_revision = p_revision and v_row.state_mutation_key is distinct from btrim(p_mutation_key)) then
    return query select v_row.message_key, false, false, true,
      v_row.state_revision, v_row.state_mutation_key,
      v_row.unread, v_row.softora_read_at, v_row.reply_dismissed_at;
    return;
  end if;

  if v_row.state_revision = p_revision and v_row.state_mutation_key = btrim(p_mutation_key) then
    return query select v_row.message_key, false, true, false,
      v_row.state_revision, v_row.state_mutation_key,
      v_row.unread, v_row.softora_read_at, v_row.reply_dismissed_at;
    return;
  end if;

  update public.softora_mailbox_messages as m
  set unread = coalesce(p_unread, false),
      softora_read_at = case when coalesce(p_unread, false) then null else coalesce(m.softora_read_at, v_now) end,
      reply_dismissed_at = case
        when coalesce(p_dismiss_reply, false) then coalesce(m.reply_dismissed_at, v_now)
        when coalesce(p_unread, false) then null
        else m.reply_dismissed_at
      end,
      state_revision = p_revision,
      state_mutation_key = btrim(p_mutation_key),
      state_mutation_at = v_now,
      updated_at = v_now
  where m.message_key = v_row.message_key
  returning m.* into v_row;

  return query select v_row.message_key, true, false, false,
    v_row.state_revision, v_row.state_mutation_key,
    v_row.unread, v_row.softora_read_at, v_row.reply_dismissed_at;
end;
$$;

revoke execute on function public.softora_apply_mailbox_state_mutation(
  text, text, bigint, text, text, bigint, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.softora_apply_mailbox_state_mutation(
  text, text, bigint, text, text, bigint, boolean, boolean
) to service_role;

create table if not exists public.softora_mailbox_sync_state (
  sync_key text primary key,
  account_email text not null,
  folder text not null,
  status text not null default 'idle'
    check (status in ('idle', 'syncing', 'ok', 'error')),
  last_synced_at timestamptz,
  sync_started_at timestamptz,
  lock_token text,
  lock_expires_at timestamptz,
  last_uid bigint,
  message_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists softora_mailbox_sync_state_status_idx
  on public.softora_mailbox_sync_state (status, updated_at desc);
create index if not exists softora_mailbox_sync_state_account_folder_idx
  on public.softora_mailbox_sync_state (account_email, folder);

-- mailbox-sync-lock-hardening:start
-- Serialize every mailbox lease transition across instances. The fixed
-- transaction advisory lock makes the active-count check one global decision.
create or replace function public.softora_lock_mailbox_sync_capacity()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  -- A statement trigger runs before UPDATE has row-locked a lease. This keeps
  -- old direct writes and the new RPC on the same advisory -> row lock order.
  perform pg_advisory_xact_lock(824031, 3);
  return null;
end;
$$;

drop trigger if exists softora_mailbox_sync_capacity_lock
  on public.softora_mailbox_sync_state;
create trigger softora_mailbox_sync_capacity_lock
before insert or update or delete on public.softora_mailbox_sync_state
for each statement execute function public.softora_lock_mailbox_sync_capacity();

create or replace function public.softora_guard_mailbox_sync_lock()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_sync_key text := lower(btrim(coalesce(new.sync_key, '')));
  v_account_email text := lower(btrim(coalesce(new.account_email, '')));
  v_folder text := lower(btrim(coalesce(new.folder, '')));
  v_lock_token text := btrim(coalesce(new.lock_token, ''));
  v_active_count integer := 0;
begin
  if v_sync_key = '' or char_length(v_sync_key) > 600
    or v_account_email = '' or char_length(v_account_email) > 320
    or v_folder = '' or char_length(v_folder) > 200
    or position('|' in v_account_email) > 0
    or position('|' in v_folder) > 0
    or v_sync_key is distinct from (v_account_email || '|' || v_folder) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_SYNC_LOCK_IDENTITY_INVALID';
  end if;

  new.sync_key := v_sync_key;
  new.account_email := v_account_email;
  new.folder := v_folder;

  if new.status = 'syncing' then
    if v_lock_token = '' or char_length(v_lock_token) > 200
      or new.lock_expires_at is null
      or new.lock_expires_at <= clock_timestamp() then
      raise exception using errcode = '22023',
        message = 'MAILBOX_SYNC_LOCK_LEASE_INVALID';
    end if;
    new.lock_token := v_lock_token;

    -- Old runtime versions used direct UPSERTs. They may renew the exact same
    -- lease, but force can never replace another still-active token.
    if tg_op = 'UPDATE'
      and old.status = 'syncing'
      and nullif(btrim(old.lock_token), '') is not null
      and old.lock_expires_at > clock_timestamp()
      and btrim(old.lock_token) is distinct from v_lock_token then
      raise exception 'MAILBOX_SYNC_ACTIVE_LOCK'
        using errcode = 'P0001', detail = 'een actieve mailboxlease kan niet worden overgenomen';
    end if;

    select count(*)::integer into v_active_count
    from public.softora_mailbox_sync_state as active_sync
    where active_sync.status = 'syncing'
      and nullif(btrim(active_sync.lock_token), '') is not null
      and active_sync.lock_expires_at > clock_timestamp()
      and active_sync.sync_key <> v_sync_key;
    if v_active_count >= 3 then
      raise exception 'MAILBOX_SYNC_GLOBAL_CAP_REACHED'
        using errcode = 'P0001', detail = 'maximaal drie mailboxleases mogen tegelijk actief zijn';
    end if;
  elsif new.lock_token is not null or new.lock_expires_at is not null then
    raise exception using errcode = '22023',
      message = 'MAILBOX_SYNC_LOCK_RELEASE_INVALID';
  end if;

  return new;
end;
$$;

drop trigger if exists softora_mailbox_sync_lock_guard
  on public.softora_mailbox_sync_state;
create trigger softora_mailbox_sync_lock_guard
before insert or update of sync_key, account_email, folder, status, lock_token, lock_expires_at
on public.softora_mailbox_sync_state
for each row execute function public.softora_guard_mailbox_sync_lock();

-- New runtime versions claim through this RPC. p_force remains in the stable
-- API shape, but never bypasses an active lease or the global capacity limit.
create or replace function public.softora_claim_mailbox_sync_lock(
  p_sync_key text,
  p_account_email text,
  p_folder text,
  p_lock_token text,
  p_lock_ttl_seconds integer default 90,
  p_force boolean default false
)
returns table (
  acquired boolean,
  locked boolean,
  claimed_lock_token text,
  lock_expires_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_sync_key text := lower(btrim(coalesce(p_sync_key, '')));
  v_account_email text := lower(btrim(coalesce(p_account_email, '')));
  v_folder text := lower(btrim(coalesce(p_folder, '')));
  v_lock_token text := btrim(coalesce(p_lock_token, ''));
  v_current public.softora_mailbox_sync_state%rowtype;
  v_active_count integer := 0;
begin
  if v_sync_key = '' or char_length(v_sync_key) > 600
    or v_account_email = '' or char_length(v_account_email) > 320
    or v_folder = '' or char_length(v_folder) > 200
    or v_lock_token = '' or char_length(v_lock_token) > 200
    or position('|' in v_account_email) > 0
    or position('|' in v_folder) > 0
    or v_sync_key is distinct from (v_account_email || '|' || v_folder) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_SYNC_LOCK_IDENTITY_INVALID';
  end if;

  perform pg_advisory_xact_lock(824031, 3);
  select * into v_current
  from public.softora_mailbox_sync_state as current_sync
  where current_sync.sync_key = v_sync_key
  for update;

  if found
    and v_current.status = 'syncing'
    and nullif(btrim(v_current.lock_token), '') is not null
    and v_current.lock_expires_at > clock_timestamp() then
    if btrim(v_current.lock_token) = v_lock_token then
      return query select true, false, v_lock_token, v_current.lock_expires_at;
    else
      return query select false, true, null::text, v_current.lock_expires_at;
    end if;
    return;
  end if;

  select count(*)::integer into v_active_count
  from public.softora_mailbox_sync_state as active_sync
  where active_sync.status = 'syncing'
    and nullif(btrim(active_sync.lock_token), '') is not null
    and active_sync.lock_expires_at > clock_timestamp()
    and active_sync.sync_key <> v_sync_key;
  if v_active_count >= 3 then
    return query select false, true, null::text, null::timestamptz;
    return;
  end if;

  insert into public.softora_mailbox_sync_state as stored_sync (
    sync_key, account_email, folder, status, sync_started_at,
    lock_token, lock_expires_at, last_error, updated_at
  ) values (
    v_sync_key, v_account_email, v_folder, 'syncing', clock_timestamp(),
    v_lock_token,
    clock_timestamp() + make_interval(
      secs => greatest(10, least(300, coalesce(p_lock_ttl_seconds, 90)))
    ),
    null, clock_timestamp()
  )
  on conflict (sync_key) do update set
    account_email = excluded.account_email,
    folder = excluded.folder,
    status = excluded.status,
    sync_started_at = excluded.sync_started_at,
    lock_token = excluded.lock_token,
    lock_expires_at = excluded.lock_expires_at,
    last_error = null,
    updated_at = excluded.updated_at
  returning stored_sync.* into v_current;

  return query select true, false, v_lock_token, v_current.lock_expires_at;
end;
$$;

comment on function public.softora_claim_mailbox_sync_lock(text, text, text, text, integer, boolean)
  is 'Atomically claims one of at most three global mailbox sync leases; force never steals an active lease.';

revoke all on function public.softora_lock_mailbox_sync_capacity()
  from public, anon, authenticated;
revoke all on function public.softora_guard_mailbox_sync_lock()
  from public, anon, authenticated;
revoke all on function public.softora_claim_mailbox_sync_lock(text, text, text, text, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.softora_lock_mailbox_sync_capacity()
  to service_role;
grant execute on function public.softora_guard_mailbox_sync_lock()
  to service_role;
grant execute on function public.softora_claim_mailbox_sync_lock(text, text, text, text, integer, boolean)
  to service_role;
-- mailbox-sync-lock-hardening:end

-- mailbox-campaign-consistency:start
create table if not exists public.softora_mailbox_campaign_consistency (
  scope text primary key default 'campaign' check (scope = 'campaign'),
  content_version bigint not null default 0 check (content_version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.softora_mailbox_campaign_mutations (
  mutation_id uuid primary key,
  scope text not null default 'campaign'
    references public.softora_mailbox_campaign_consistency (scope),
  request_key text not null check (char_length(btrim(request_key)) between 1 and 200),
  mutation_kind text not null check (char_length(btrim(mutation_kind)) between 1 and 120),
  account_email text,
  folder text,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'abandoned')),
  started_content_version bigint not null check (started_content_version >= 0),
  completed_content_version bigint,
  lease_expires_at timestamptz not null,
  completed_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint softora_mailbox_campaign_mutations_scope_request_key_key
    unique (scope, request_key),
  check (
    (status = 'pending' and completed_at is null and completed_content_version is null)
    or (
      status in ('completed', 'abandoned')
      and completed_at is not null
      and completed_content_version is not null
      and completed_content_version >= started_content_version
    )
  )
);

create index if not exists softora_mailbox_campaign_mutations_pending_lease_idx
  on public.softora_mailbox_campaign_mutations (lease_expires_at, mutation_id)
  where status = 'pending';

insert into public.softora_mailbox_campaign_consistency (scope, content_version)
values ('campaign', 0)
on conflict (scope) do nothing;

create or replace function public.softora_is_campaign_mailbox_message(
  p_account_email text,
  p_folder text,
  p_payload jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select (
    lower(btrim(coalesce(p_account_email, ''))) = any (array[
      'serve@softora.nl', 'servecreusen@softora.nl', 'servec321@gmail.com',
      'serve290@gmail.com', 'servecreusen7@gmail.com', 'martijn@softora.nl',
      'martijnvandeven@softora.nl', 'martijnven123@gmail.com',
      'contact.venvisuals@gmail.com'
    ]::text[])
    and lower(btrim(coalesce(p_folder, '')))
      = any (array['inbox', 'sent', 'coldmail']::text[])
  ) or (
    lower(btrim(coalesce(p_folder, ''))) = 'instantly'
    and lower(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'providerOwner', '')))
      = any (array['serve', 'martijn']::text[])
  );
$$;

create or replace function public.softora_track_mailbox_campaign_message_change()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_affects_campaign boolean := false;
begin
  if coalesce(current_setting('softora.mailbox_campaign_version_bumped', true), '') = '1' then
    return null;
  elsif tg_op = 'TRUNCATE' then
    v_affects_campaign := true;
  elsif tg_op = 'INSERT' then
    select exists (
      select 1 from softora_mailbox_campaign_new_rows as new_row
      where public.softora_is_campaign_mailbox_message(
        new_row.account_email, new_row.folder, new_row.payload
      )
    ) into v_affects_campaign;
  elsif tg_op = 'DELETE' then
    select exists (
      select 1 from softora_mailbox_campaign_old_rows as old_row
      where public.softora_is_campaign_mailbox_message(
        old_row.account_email, old_row.folder, old_row.payload
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
          old_row.account_email, old_row.folder, old_row.payload
        ) or public.softora_is_campaign_mailbox_message(
          new_row.account_email, new_row.folder, new_row.payload
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
$$;

drop trigger if exists softora_track_mailbox_campaign_message_change
  on public.softora_mailbox_messages;
drop trigger if exists softora_track_mailbox_campaign_message_insert on public.softora_mailbox_messages;
drop trigger if exists softora_track_mailbox_campaign_message_update on public.softora_mailbox_messages;
drop trigger if exists softora_track_mailbox_campaign_message_delete on public.softora_mailbox_messages;
drop trigger if exists softora_track_mailbox_campaign_message_truncate on public.softora_mailbox_messages;
create trigger softora_track_mailbox_campaign_message_insert
after insert on public.softora_mailbox_messages
referencing new table as softora_mailbox_campaign_new_rows
for each statement execute function public.softora_track_mailbox_campaign_message_change();
create trigger softora_track_mailbox_campaign_message_update
after update on public.softora_mailbox_messages
referencing old table as softora_mailbox_campaign_old_rows
  new table as softora_mailbox_campaign_new_rows
for each statement execute function public.softora_track_mailbox_campaign_message_change();
create trigger softora_track_mailbox_campaign_message_delete
after delete on public.softora_mailbox_messages
referencing old table as softora_mailbox_campaign_old_rows
for each statement execute function public.softora_track_mailbox_campaign_message_change();
create trigger softora_track_mailbox_campaign_message_truncate
after truncate on public.softora_mailbox_messages
for each statement execute function public.softora_track_mailbox_campaign_message_change();

create or replace function public.softora_begin_mailbox_campaign_mutation(
  p_mutation_id uuid,
  p_request_key text,
  p_mutation_kind text,
  p_account_email text default null,
  p_folder text default null,
  p_lease_seconds integer default 120
)
returns table (
  mutation_id uuid, request_key text, mutation_status text,
  started_content_version bigint, completed_content_version bigint,
  current_content_version bigint, lease_expires_at timestamptz, replayed boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_state public.softora_mailbox_campaign_consistency%rowtype;
  v_mutation public.softora_mailbox_campaign_mutations%rowtype;
  v_inserted boolean := false;
  v_request_key text := btrim(coalesce(p_request_key, ''));
  v_kind text := lower(btrim(coalesce(p_mutation_kind, '')));
  v_account text := nullif(lower(btrim(coalesce(p_account_email, ''))), '');
  v_folder text := nullif(lower(btrim(coalesce(p_folder, ''))), '');
  v_lease integer := greatest(15, least(coalesce(p_lease_seconds, 120), 900));
begin
  if p_mutation_id is null or char_length(v_request_key) not between 1 and 200
    or char_length(v_kind) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'Ongeldige mailboxmutatie';
  end if;

  insert into public.softora_mailbox_campaign_consistency (scope, content_version)
  values ('campaign', 0) on conflict (scope) do nothing;
  select * into strict v_state
  from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;

  insert into public.softora_mailbox_campaign_mutations (
    mutation_id, scope, request_key, mutation_kind, account_email, folder,
    started_content_version, lease_expires_at
  ) values (
    p_mutation_id, 'campaign', v_request_key, v_kind, v_account, v_folder,
    v_state.content_version, clock_timestamp() + make_interval(secs => v_lease)
  )
  on conflict on constraint softora_mailbox_campaign_mutations_scope_request_key_key do nothing
  returning * into v_mutation;
  v_inserted := found;

  if not v_inserted then
    select * into strict v_mutation
    from public.softora_mailbox_campaign_mutations as existing_mutation
    where existing_mutation.scope = 'campaign'
      and existing_mutation.request_key = v_request_key
    for update;
    if v_mutation.mutation_kind is distinct from v_kind
      or v_mutation.account_email is distinct from v_account
      or v_mutation.folder is distinct from v_folder then
      raise exception using errcode = '22023',
        message = 'request_key hoort al bij een andere mailboxmutatie';
    end if;
  end if;

  return query select
    v_mutation.mutation_id, v_mutation.request_key, v_mutation.status,
    v_mutation.started_content_version, v_mutation.completed_content_version,
    v_state.content_version, v_mutation.lease_expires_at, not v_inserted;
end;
$$;

create or replace function public.softora_complete_mailbox_campaign_mutation(
  p_mutation_id uuid,
  p_request_key text,
  p_result jsonb default '{}'::jsonb
)
returns table (
  mutation_id uuid, mutation_status text, started_content_version bigint,
  completed_content_version bigint, current_content_version bigint, replayed boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_state public.softora_mailbox_campaign_consistency%rowtype;
  v_mutation public.softora_mailbox_campaign_mutations%rowtype;
  v_replayed boolean := false;
begin
  select * into strict v_state
  from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  select * into strict v_mutation
  from public.softora_mailbox_campaign_mutations as selected_mutation
  where selected_mutation.mutation_id = p_mutation_id for update;

  if v_mutation.request_key is distinct from btrim(coalesce(p_request_key, '')) then
    raise exception using errcode = '22023',
      message = 'mutation_id en request_key horen niet bij elkaar';
  elsif v_mutation.status = 'pending' then
    update public.softora_mailbox_campaign_mutations as pending_mutation set
      status = 'completed',
      completed_content_version = v_state.content_version,
      completed_at = clock_timestamp(),
      result = coalesce(p_result, '{}'::jsonb),
      updated_at = clock_timestamp()
    where pending_mutation.mutation_id = p_mutation_id
      and pending_mutation.status = 'pending'
    returning * into v_mutation;
  else
    v_replayed := true;
  end if;

  return query select
    v_mutation.mutation_id, v_mutation.status, v_mutation.started_content_version,
    v_mutation.completed_content_version, v_state.content_version, v_replayed;
end;
$$;

create or replace function public.softora_get_mailbox_campaign_fence(
  p_reap_expired boolean default true
)
returns table (
  content_version bigint, pending_count bigint, ready boolean,
  reaped_count bigint, checked_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_state public.softora_mailbox_campaign_consistency%rowtype;
  v_pending bigint := 0;
  v_reaped bigint := 0;
  v_checked_at timestamptz := clock_timestamp();
begin
  insert into public.softora_mailbox_campaign_consistency (scope, content_version)
  values ('campaign', 0) on conflict (scope) do nothing;
  select * into strict v_state
  from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;

  if coalesce(p_reap_expired, true) then
    with reaped as (
      update public.softora_mailbox_campaign_mutations set
        status = 'abandoned',
        completed_content_version = v_state.content_version,
        completed_at = v_checked_at,
        updated_at = v_checked_at
      where scope = 'campaign' and status = 'pending'
        and lease_expires_at <= v_checked_at
      returning 1
    ) select count(*) into v_reaped from reaped;
  end if;
  select count(*) into v_pending
  from public.softora_mailbox_campaign_mutations
  where scope = 'campaign' and status = 'pending';

  return query select
    v_state.content_version, v_pending, v_pending = 0, v_reaped, v_checked_at;
end;
$$;

alter table public.softora_mailbox_campaign_consistency enable row level security;
alter table public.softora_mailbox_campaign_mutations enable row level security;
revoke all privileges on table public.softora_mailbox_campaign_consistency
  from public, anon, authenticated, service_role;
revoke all privileges on table public.softora_mailbox_campaign_mutations
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.softora_mailbox_campaign_consistency to service_role;
grant select, insert, update on table public.softora_mailbox_campaign_mutations to service_role;

revoke all on function public.softora_is_campaign_mailbox_message(text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.softora_track_mailbox_campaign_message_change()
  from public, anon, authenticated;
revoke all on function public.softora_begin_mailbox_campaign_mutation(uuid, text, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.softora_complete_mailbox_campaign_mutation(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.softora_get_mailbox_campaign_fence(boolean)
  from public, anon, authenticated;
grant execute on function public.softora_is_campaign_mailbox_message(text, text, jsonb)
  to service_role;
grant execute on function public.softora_track_mailbox_campaign_message_change()
  to service_role;
grant execute on function public.softora_begin_mailbox_campaign_mutation(uuid, text, text, text, text, integer)
  to service_role;
grant execute on function public.softora_complete_mailbox_campaign_mutation(uuid, text, jsonb)
  to service_role;
grant execute on function public.softora_get_mailbox_campaign_fence(boolean)
  to service_role;
-- mailbox-campaign-consistency:end

-- mailbox-campaign-atomic-commit:start
-- Forward-only companion to the already deployed mailbox consistency foundation.
-- Every direct writer locks campaign state before touching message rows; the atomic RPC
-- keeps message rows, content-version and journal completion in one transaction.
create or replace function public.softora_is_campaign_mailbox_message(
  p_account_email text,
  p_folder text,
  p_payload jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select (
    lower(btrim(coalesce(p_account_email, ''))) = any (array[
      'serve@softora.nl', 'servecreusen@softora.nl', 'servec321@gmail.com',
      'serve290@gmail.com', 'servecreusen7@gmail.com', 'martijn@softora.nl',
      'martijnvandeven@softora.nl', 'martijnven123@gmail.com',
      'contact.venvisuals@gmail.com'
    ]::text[])
    and lower(btrim(coalesce(p_folder, '')))
      = any (array['inbox', 'sent', 'coldmail']::text[])
  ) or (
    lower(btrim(coalesce(p_folder, ''))) = 'instantly'
    and lower(btrim(coalesce(p_account_email, '')))
      = lower(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'providerAccountEmail', '')))
    and (
      (
        lower(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'providerOwner', ''))) = 'serve'
        and lower(btrim(coalesce(p_account_email, ''))) = any (array[
          'serve@websoftora.com', 'servecreusen@websoftora.com'
        ]::text[])
      ) or (
        lower(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'providerOwner', ''))) = 'martijn'
        and lower(btrim(coalesce(p_account_email, ''))) = any (array[
          'martijn@websoftora.com', 'martijnven@websoftora.com'
        ]::text[])
      )
    )
  );
$$;

alter table public.softora_mailbox_messages
  drop constraint if exists softora_mailbox_instantly_owner_account_check;
alter table public.softora_mailbox_messages
  add constraint softora_mailbox_instantly_owner_account_check
  check (
    lower(btrim(coalesce(folder, ''))) <> 'instantly'
    or public.softora_is_campaign_mailbox_message(account_email, folder, payload)
  ) not valid;
alter table public.softora_mailbox_messages
  validate constraint softora_mailbox_instantly_owner_account_check;

create or replace function public.softora_enforce_mailbox_message_identity_immutable()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if old.message_key is distinct from new.message_key
    or lower(btrim(old.account_email)) is distinct from lower(btrim(new.account_email))
    or lower(btrim(old.folder)) is distinct from lower(btrim(new.folder))
    or old.uid is distinct from new.uid
    or old.provider_id is distinct from new.provider_id then
    raise exception using errcode = '23505',
      message = 'Bestaande mailboxidentiteit mag niet van account of provider wisselen';
  end if;
  return new;
end;
$$;

drop trigger if exists softora_enforce_mailbox_message_identity_immutable
  on public.softora_mailbox_messages;
create trigger softora_enforce_mailbox_message_identity_immutable
before update on public.softora_mailbox_messages
for each row
execute function public.softora_enforce_mailbox_message_identity_immutable();

create or replace function public.softora_lock_mailbox_campaign_consistency_before_write()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  insert into public.softora_mailbox_campaign_consistency (scope, content_version)
  values ('campaign', 0) on conflict (scope) do nothing;
  perform 1
  from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  return null;
end;
$$;

drop trigger if exists softora_lock_mailbox_campaign_consistency_before_write
  on public.softora_mailbox_messages;
create trigger softora_lock_mailbox_campaign_consistency_before_write
before insert or update or delete or truncate on public.softora_mailbox_messages
for each statement
execute function public.softora_lock_mailbox_campaign_consistency_before_write();

create or replace function public.softora_commit_mailbox_campaign_messages(
  p_mutation_id uuid,
  p_request_key text,
  p_rows jsonb,
  p_result jsonb default '{}'::jsonb
)
returns table (
  mutation_id uuid, mutation_status text, started_content_version bigint,
  completed_content_version bigint, current_content_version bigint,
  upserted_count integer, replayed boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_state public.softora_mailbox_campaign_consistency%rowtype;
  v_mutation public.softora_mailbox_campaign_mutations%rowtype;
  v_upserted integer := 0;
begin
  if p_mutation_id is null
    or char_length(btrim(coalesce(p_request_key, ''))) not between 1 and 200
    or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception using errcode = '22023',
      message = 'Ongeldige atomische mailboxmutatie';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 2000 then
    raise exception using errcode = '22023',
      message = 'Ongeldige atomische mailboxmutatie';
  end if;

  -- Keep the same lock order as begin, complete and fence: state first, mutation second.
  select * into strict v_state
  from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  select * into strict v_mutation
  from public.softora_mailbox_campaign_mutations as selected_mutation
  where selected_mutation.mutation_id = p_mutation_id for update;

  if v_mutation.request_key is distinct from btrim(p_request_key) then
    raise exception using errcode = '22023',
      message = 'mutation_id en request_key horen niet bij elkaar';
  elsif v_mutation.status = 'completed' then
    return query select
      v_mutation.mutation_id, v_mutation.status, v_mutation.started_content_version,
      v_mutation.completed_content_version, v_state.content_version,
      case when coalesce(v_mutation.result->>'upserted', '') ~ '^\d+$'
        then least((v_mutation.result->>'upserted')::bigint, 2147483647)::integer
        else 0 end,
      true;
    return;
  elsif v_mutation.status <> 'pending' then
    raise exception using errcode = '55000',
      message = 'Mailboxmutatie is niet meer schrijfbaar';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as candidate(row_data)
    where jsonb_typeof(candidate.row_data) is distinct from 'object'
      or not public.softora_is_campaign_mailbox_message(
        candidate.row_data->>'account_email',
        candidate.row_data->>'folder',
        candidate.row_data->'payload'
      )
      or (
        v_mutation.mutation_kind = 'imap-sync'
        and (
          lower(btrim(coalesce(candidate.row_data->>'account_email', '')))
            is distinct from v_mutation.account_email
          or lower(btrim(coalesce(candidate.row_data->>'folder', '')))
            is distinct from v_mutation.folder
        )
      )
      or (
        v_mutation.mutation_kind = 'instantly-upsert'
        and (
          lower(btrim(coalesce(candidate.row_data->>'folder', ''))) <> 'instantly'
          or lower(btrim(coalesce(candidate.row_data->>'account_email', '')))
            is distinct from v_mutation.account_email
          or lower(btrim(coalesce(
            candidate.row_data->'payload'->>'providerAccountEmail', ''
          ))) is distinct from lower(btrim(coalesce(
            candidate.row_data->>'account_email', ''
          )))
        )
      )
  ) or v_mutation.mutation_kind not in ('imap-sync', 'instantly-upsert') then
    raise exception using errcode = '22023',
      message = 'Mailboxrijen horen niet bij de gereserveerde mutatie';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as candidate(row_data)
    join public.softora_mailbox_messages as existing_message
      on existing_message.message_key = candidate.row_data->>'message_key'
    where lower(btrim(existing_message.account_email))
        is distinct from lower(btrim(coalesce(candidate.row_data->>'account_email', '')))
      or lower(btrim(existing_message.folder))
        is distinct from lower(btrim(coalesce(candidate.row_data->>'folder', '')))
      or existing_message.provider_id
        is distinct from coalesce(candidate.row_data->>'provider_id', '')
  ) then
    raise exception using errcode = '23505',
      message = 'Bestaande mailboxidentiteit mag niet van account of provider wisselen';
  end if;

  insert into public.softora_mailbox_messages as stored_message (
    message_key, account_email, folder, uid, provider_id, message_id,
    in_reply_to, references_text, sender_name, sender_email, recipients_text,
    subject, preview, body_text, body_truncated, has_body, date, internal_date,
    unread, starred, payload, updated_at
  )
  select
    incoming.message_key, incoming.account_email, incoming.folder, incoming.uid,
    incoming.provider_id, incoming.message_id, incoming.in_reply_to,
    incoming.references_text, incoming.sender_name, incoming.sender_email,
    incoming.recipients_text, incoming.subject, incoming.preview, incoming.body_text,
    incoming.body_truncated, incoming.has_body, incoming.date, incoming.internal_date,
    incoming.unread, incoming.starred, incoming.payload, incoming.updated_at
  from jsonb_to_recordset(p_rows) as incoming(
    message_key text, account_email text, folder text, uid bigint, provider_id text,
    message_id text, in_reply_to text, references_text text, sender_name text,
    sender_email text, recipients_text text, subject text, preview text, body_text text,
    body_truncated boolean, has_body boolean, date timestamptz,
    internal_date timestamptz, unread boolean, starred boolean, payload jsonb,
    updated_at timestamptz
  )
  on conflict (message_key) do update set
    account_email = excluded.account_email,
    folder = excluded.folder,
    uid = excluded.uid,
    provider_id = excluded.provider_id,
    message_id = excluded.message_id,
    in_reply_to = excluded.in_reply_to,
    references_text = excluded.references_text,
    sender_name = excluded.sender_name,
    sender_email = excluded.sender_email,
    recipients_text = excluded.recipients_text,
    subject = excluded.subject,
    preview = excluded.preview,
    body_text = excluded.body_text,
    body_truncated = excluded.body_truncated,
    has_body = excluded.has_body,
    date = excluded.date,
    internal_date = excluded.internal_date,
    unread = excluded.unread,
    starred = excluded.starred,
    payload = excluded.payload,
    updated_at = excluded.updated_at;
  get diagnostics v_upserted = row_count;

  select * into strict v_state
  from public.softora_mailbox_campaign_consistency
  where scope = 'campaign';
  update public.softora_mailbox_campaign_mutations as pending_mutation set
    status = 'completed',
    completed_content_version = v_state.content_version,
    completed_at = clock_timestamp(),
    result = coalesce(p_result, '{}'::jsonb)
      || jsonb_build_object('ok', true, 'upserted', v_upserted),
    updated_at = clock_timestamp()
  where pending_mutation.mutation_id = p_mutation_id
    and pending_mutation.status = 'pending'
  returning * into strict v_mutation;

  return query select
    v_mutation.mutation_id, v_mutation.status, v_mutation.started_content_version,
    v_mutation.completed_content_version, v_state.content_version, v_upserted, false;
end;
$$;

revoke all privileges on table public.softora_mailbox_messages
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.softora_mailbox_messages
  to service_role;
revoke all on function public.softora_lock_mailbox_campaign_consistency_before_write()
  from public, anon, authenticated, service_role;
grant execute on function public.softora_lock_mailbox_campaign_consistency_before_write()
  to service_role;
revoke all on function public.softora_enforce_mailbox_message_identity_immutable()
  from public, anon, authenticated, service_role;
grant execute on function public.softora_enforce_mailbox_message_identity_immutable()
  to service_role;
revoke all on function public.softora_commit_mailbox_campaign_messages(uuid, text, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.softora_commit_mailbox_campaign_messages(uuid, text, jsonb, jsonb)
  to service_role;
-- mailbox-campaign-atomic-commit:end

create table if not exists public.softora_mailbox_send_provenance (
  intent_id text primary key,
  idempotency_key text not null unique,
  owner text not null check (owner in ('serve', 'martijn')),
  account_email text not null,
  recipient_email text not null,
  mode text not null check (mode in ('reply', 'new-message')),
  conversation_id text,
  reply_target_message_id text,
  references_text text,
  provider text not null default 'smtp',
  provider_thread_id text,
  provider_message_id text,
  sent_message_id text,
  sender_name text,
  subject text not null,
  body_text text not null default '',
  cc_text text,
  bcc_text text,
  status text not null default 'prepared'
    check (status in ('prepared', 'accepted', 'failed')),
  error_text text,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists softora_mailbox_send_provenance_account_status_idx
  on public.softora_mailbox_send_provenance (account_email, status, accepted_at desc);
create index if not exists softora_mailbox_send_provenance_conversation_idx
  on public.softora_mailbox_send_provenance (account_email, conversation_id, accepted_at desc)
  where status = 'accepted';
create index if not exists softora_mailbox_sent_thread_lookup_idx
  on public.softora_mailbox_messages (account_email, date desc)
  include (subject, recipients_text, message_id, in_reply_to, references_text, payload)
  where folder = 'sent' and deleted_at is null;

create or replace function public.softora_find_mailbox_unthreaded_sent_candidates(
  p_targets jsonb,
  p_limit integer default 1000
)
returns table (target_conversation_id text, message jsonb)
language sql
stable
set search_path = public
as $$
  with targets as (
    select
      nullif(trim(target.conversation_id), '') as conversation_id,
      lower(trim(target.account_email)) as account_email,
      lower(trim(target.counterparty_email)) as counterparty_email,
      lower(trim(target.canonical_subject)) as canonical_subject,
      target.latest_inbound_at
    from jsonb_to_recordset(coalesce(p_targets, '[]'::jsonb)) as target(
      conversation_id text,
      account_email text,
      counterparty_email text,
      canonical_subject text,
      latest_inbound_at timestamptz
    )
    where nullif(trim(target.conversation_id), '') is not null
      and nullif(trim(target.account_email), '') is not null
      and nullif(trim(target.counterparty_email), '') is not null
      and nullif(trim(target.canonical_subject), '') is not null
      and target.latest_inbound_at is not null
  ), ranked as (
    select
      targets.conversation_id as target_conversation_id,
      to_jsonb(messages) as message,
      row_number() over (
        partition by targets.conversation_id
        order by messages.date asc, messages.message_key asc
      ) as candidate_rank
    from targets
    join public.softora_mailbox_messages as messages
      on messages.account_email = targets.account_email
      and messages.folder = 'sent'
      and messages.deleted_at is null
      and messages.date > targets.latest_inbound_at
      and position(targets.counterparty_email in lower(coalesce(messages.recipients_text, ''))) > 0
      and regexp_replace(
        lower(trim(coalesce(messages.subject, ''))),
        '^\s*((re|fw|fwd)\s*:\s*)+',
        '',
        'i'
      ) = targets.canonical_subject
      and coalesce(messages.in_reply_to, '') = ''
      and coalesce(messages.references_text, '') = ''
      and coalesce(messages.payload->>'providerThreadId', '') = ''
  )
  select ranked.target_conversation_id, ranked.message
  from ranked
  where ranked.candidate_rank <= 3
  order by ranked.target_conversation_id, ranked.candidate_rank
  limit greatest(1, least(coalesce(p_limit, 1000), 3000));
$$;

create table if not exists public.softora_outbound_recipient_guards (
  guard_key text primary key,
  key_type text not null,
  key_value text not null,
  reservation_id text,
  provider text,
  channel text,
  sender_email text,
  recipient_email text,
  recipient_domain text,
  recipient_company_key text,
  recipient_id text,
  recipient_company text,
  status text not null default 'reserved',
  source text not null default 'unknown',
  actor text,
  permanent boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists softora_outbound_recipient_guards_key_idx
  on public.softora_outbound_recipient_guards (key_type, key_value);
create index if not exists softora_outbound_recipient_guards_reservation_idx
  on public.softora_outbound_recipient_guards (reservation_id);
create index if not exists softora_outbound_recipient_guards_email_idx
  on public.softora_outbound_recipient_guards (recipient_email);
create index if not exists softora_outbound_recipient_guards_domain_idx
  on public.softora_outbound_recipient_guards (recipient_domain);
create index if not exists softora_outbound_recipient_guards_updated_at_idx
  on public.softora_outbound_recipient_guards (updated_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'softora-design-photos',
  'softora-design-photos',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'softora-company-website-videos',
  'softora-company-website-videos',
  false,
  104857600,
  array['video/mp4']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.softora_customers enable row level security;
alter table public.softora_customer_identity_keys enable row level security;
alter table public.softora_active_orders enable row level security;
alter table public.softora_order_runtime enable row level security;
alter table public.softora_design_photos enable row level security;
alter table public.softora_webdesign_jobs enable row level security;
alter table public.softora_company_website_videos enable row level security;
alter table public.softora_mailbox_messages enable row level security;
alter table public.softora_mailbox_sync_state enable row level security;
alter table public.softora_mailbox_send_provenance enable row level security;
alter table public.softora_outbound_recipient_guards enable row level security;

revoke all on table public.softora_outbound_recipient_guards from public;
revoke all on table public.softora_outbound_recipient_guards from anon;
revoke all on table public.softora_outbound_recipient_guards from authenticated;

grant select, insert, update, delete on public.softora_customer_identity_keys to service_role;
grant select, insert, update, delete on public.softora_mailbox_messages to service_role;
revoke all on table public.softora_mailbox_sync_state from public, anon, authenticated;
grant select, insert, update, delete on public.softora_mailbox_sync_state to service_role;
revoke all on table public.softora_mailbox_send_provenance from public, anon, authenticated;
revoke all on function public.softora_find_mailbox_unthreaded_sent_candidates(jsonb, integer)
  from public, anon, authenticated;
grant select, insert, update on table public.softora_mailbox_send_provenance to service_role;
grant execute on function public.softora_find_mailbox_unthreaded_sent_candidates(jsonb, integer)
  to service_role;
grant select, insert, update, delete on public.softora_outbound_recipient_guards to service_role;
grant select, insert, update, delete on public.softora_company_website_videos to service_role;
grant execute on function public.softora_queue_company_website_video(text, text, text, boolean) to service_role;
grant execute on function public.softora_claim_company_website_video(text, integer) to service_role;
revoke all on function public.softora_queue_company_website_video(text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.softora_claim_company_website_video(text, integer) from public, anon, authenticated;
-- mailbox-uidvalidity-generation:start
alter table public.softora_mailbox_messages
  add column if not exists uid_validity bigint;
alter table public.softora_mailbox_messages
  add column if not exists generation_superseded_at timestamptz;
alter table public.softora_mailbox_sync_state
  add column if not exists uid_validity bigint;
alter table public.softora_mailbox_sync_state
  add column if not exists uid_validity_reset_at timestamptz;

alter table public.softora_mailbox_messages
  drop constraint if exists softora_mailbox_messages_account_email_folder_uid_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'softora_mailbox_messages_uid_validity_check'
      and conrelid = 'public.softora_mailbox_messages'::regclass
  ) then
    alter table public.softora_mailbox_messages
      add constraint softora_mailbox_messages_uid_validity_check
      check (uid_validity is null or uid_validity between 1 and 4294967295);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'softora_mailbox_sync_state_uid_validity_check'
      and conrelid = 'public.softora_mailbox_sync_state'::regclass
  ) then
    alter table public.softora_mailbox_sync_state
      add constraint softora_mailbox_sync_state_uid_validity_check
      check (uid_validity is null or uid_validity between 1 and 4294967295);
  end if;
end;
$$;

create unique index if not exists softora_mailbox_messages_generation_uid_key
  on public.softora_mailbox_messages (account_email, folder, uid_validity, uid)
  where uid_validity is not null;
create index if not exists softora_mailbox_messages_generation_superseded_idx
  on public.softora_mailbox_messages (generation_superseded_at)
  where generation_superseded_at is not null;

-- Rolling-deploy compatibility for an old runtime that still inserts the
-- legacy account|folder|uid key. Before the first real generation reset, the
-- database can safely coerce that row into the adopted generation. After a
-- reset, a generation-less row is ambiguous and must fail closed rather than
-- overwrite a reused UID in the new mailbox generation.
create or replace function public.softora_coerce_mailbox_uid_generation()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_account_email text := lower(btrim(coalesce(new.account_email, '')));
  v_folder text := lower(btrim(coalesce(new.folder, '')));
  v_current_uid_validity bigint;
  v_reset_at timestamptz;
begin
  if coalesce(new.uid, 0) <= 0 then
    return new;
  end if;
  if v_account_email = '' or char_length(v_account_email) > 320
    or v_folder = '' or char_length(v_folder) > 200
    or position('|' in v_account_email) > 0
    or position('|' in v_folder) > 0 then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UIDVALIDITY_INVALID';
  end if;

  select sync_state.uid_validity, sync_state.uid_validity_reset_at
    into v_current_uid_validity, v_reset_at
  from public.softora_mailbox_sync_state as sync_state
  where sync_state.sync_key = v_account_email || '|' || v_folder;
  if not found or v_current_uid_validity is null then
    return new;
  end if;

  if new.uid_validity is null then
    if v_reset_at is not null then
      raise exception using errcode = '55000',
        message = 'MAILBOX_UIDVALIDITY_REQUIRED';
    end if;
    new.uid_validity := v_current_uid_validity;
  elsif new.uid_validity is distinct from v_current_uid_validity then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UIDVALIDITY_STALE_GENERATION';
  end if;

  new.account_email := v_account_email;
  new.folder := v_folder;
  new.message_key := v_account_email || '|' || v_folder || '|uv:'
    || v_current_uid_validity::text || '|' || new.uid::text;
  return new;
end;
$$;

drop trigger if exists softora_mailbox_messages_coerce_uid_generation
  on public.softora_mailbox_messages;
create trigger softora_mailbox_messages_coerce_uid_generation
before insert on public.softora_mailbox_messages
for each row execute function public.softora_coerce_mailbox_uid_generation();

create or replace function public.softora_apply_mailbox_uid_validity(
  p_account_email text,
  p_folder text,
  p_uid_validity bigint,
  p_lock_token text
)
returns table (
  previous_uid_validity bigint,
  current_uid_validity bigint,
  reset_detected boolean,
  adopted_legacy boolean,
  superseded_count integer
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_account_email text := lower(btrim(coalesce(p_account_email, '')));
  v_folder text := lower(btrim(coalesce(p_folder, '')));
  v_lock_token text := btrim(coalesce(p_lock_token, ''));
  v_previous bigint;
  v_adopted integer := 0;
  v_superseded integer := 0;
  v_changed integer := 0;
begin
  if v_account_email = '' or char_length(v_account_email) > 320
    or v_folder = '' or char_length(v_folder) > 200
    or position('|' in v_account_email) > 0
    or position('|' in v_folder) > 0
    or v_lock_token = '' or char_length(v_lock_token) > 200
    or coalesce(p_uid_validity, 0) not between 1 and 4294967295 then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UIDVALIDITY_INVALID';
  end if;

  perform pg_advisory_xact_lock(824031, 3);
  insert into public.softora_mailbox_campaign_consistency (scope, content_version)
  values ('campaign', 0) on conflict (scope) do nothing;
  perform 1 from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  select sync_state.uid_validity into v_previous
  from public.softora_mailbox_sync_state as sync_state
  where sync_state.sync_key = v_account_email || '|' || v_folder
    and sync_state.account_email = v_account_email
    and sync_state.folder = v_folder
    and sync_state.status = 'syncing'
    and sync_state.lock_token = v_lock_token
    and sync_state.lock_expires_at > clock_timestamp()
  for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UIDVALIDITY_LEASE_INVALID';
  end if;

  if v_previous is not null and v_previous is distinct from p_uid_validity then
    update public.softora_mailbox_messages as old_generation set
      deleted_at = coalesce(old_generation.deleted_at, clock_timestamp()),
      generation_superseded_at = coalesce(
        old_generation.generation_superseded_at,
        clock_timestamp()
      ),
      updated_at = clock_timestamp()
    where old_generation.account_email = v_account_email
      and old_generation.folder = v_folder
      and old_generation.uid_validity is distinct from p_uid_validity
      and old_generation.generation_superseded_at is null;
    get diagnostics v_superseded = row_count;

    update public.softora_mailbox_sync_state as sync_state set
      uid_validity = p_uid_validity,
      uid_validity_reset_at = coalesce(
        sync_state.uid_validity_reset_at,
        clock_timestamp()
      ),
      last_uid = 0,
      message_count = 0,
      last_synced_at = null,
      updated_at = clock_timestamp()
    where sync_state.sync_key = v_account_email || '|' || v_folder;
  else
    -- During a rolling deploy an old runtime may still have written a legacy
    -- key. If the generation row already exists, retire the legacy duplicate;
    -- otherwise rekey it into the proven current generation while preserving
    -- its read and user-tombstone state.
    update public.softora_mailbox_messages as legacy set
      deleted_at = coalesce(legacy.deleted_at, clock_timestamp()),
      generation_superseded_at = coalesce(
        legacy.generation_superseded_at,
        clock_timestamp()
      ),
      updated_at = clock_timestamp()
    where legacy.account_email = v_account_email
      and legacy.folder = v_folder
      and legacy.uid_validity is null
      and legacy.generation_superseded_at is null
      and exists (
        select 1 from public.softora_mailbox_messages as current_generation
        where current_generation.account_email = legacy.account_email
          and current_generation.folder = legacy.folder
          and current_generation.uid = legacy.uid
          and current_generation.uid_validity = p_uid_validity
      );
    get diagnostics v_changed = row_count;
    v_superseded := v_superseded + v_changed;

    update public.softora_mailbox_messages as legacy set
      uid_validity = p_uid_validity,
      message_key = v_account_email || '|' || v_folder || '|uv:'
        || p_uid_validity::text || '|' || legacy.uid::text,
      updated_at = clock_timestamp()
    where legacy.account_email = v_account_email
      and legacy.folder = v_folder
      and legacy.uid_validity is null
      and legacy.generation_superseded_at is null;
    get diagnostics v_adopted = row_count;

    update public.softora_mailbox_sync_state as sync_state set
      uid_validity = p_uid_validity,
      updated_at = clock_timestamp()
    where sync_state.sync_key = v_account_email || '|' || v_folder;
  end if;

  return query select v_previous, p_uid_validity,
    v_previous is not null and v_previous is distinct from p_uid_validity,
    v_adopted > 0, v_superseded;
end;
$$;

create or replace function public.softora_prepare_mailbox_uid_validity(
  p_sync_key text,
  p_lock_token text,
  p_uid_validity bigint
)
returns table (
  applied boolean,
  lock_lost boolean,
  previous_uid_validity bigint,
  current_uid_validity bigint,
  reset_detected boolean,
  adopted_legacy boolean,
  superseded_count integer
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_sync_key text := lower(btrim(coalesce(p_sync_key, '')));
  v_lock_token text := btrim(coalesce(p_lock_token, ''));
  v_sync public.softora_mailbox_sync_state%rowtype;
  v_result record;
begin
  if v_sync_key = '' or char_length(v_sync_key) > 600
    or v_lock_token = '' or char_length(v_lock_token) > 200
    or coalesce(p_uid_validity, 0) not between 1 and 4294967295 then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UIDVALIDITY_INVALID';
  end if;

  perform pg_advisory_xact_lock(824031, 3);
  insert into public.softora_mailbox_campaign_consistency (scope, content_version)
  values ('campaign', 0) on conflict (scope) do nothing;
  perform 1 from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  select * into v_sync
  from public.softora_mailbox_sync_state as sync_state
  where sync_state.sync_key = v_sync_key
    and sync_state.status = 'syncing'
    and sync_state.lock_token = v_lock_token
    and sync_state.lock_expires_at > clock_timestamp()
  for update;
  if not found then
    return query select false, true, null::bigint, null::bigint,
      false, false, 0;
    return;
  end if;

  select * into strict v_result
  from public.softora_apply_mailbox_uid_validity(
    v_sync.account_email, v_sync.folder, p_uid_validity, v_lock_token
  );
  return query select true, false,
    v_result.previous_uid_validity,
    v_result.current_uid_validity,
    v_result.reset_detected,
    v_result.adopted_legacy,
    v_result.superseded_count;
end;
$$;

-- UID-aware replacement of the currently deployed atomic commit. Legacy
-- callers remain compatible until a generation has been adopted; new callers
-- prove the exact sync lease and prepare/reset the generation in this same
-- message+journal transaction, including when the provider folder is empty.
create or replace function public.softora_commit_mailbox_campaign_messages(
  p_mutation_id uuid,
  p_request_key text,
  p_rows jsonb,
  p_result jsonb default '{}'::jsonb
)
returns table (
  mutation_id uuid, mutation_status text, started_content_version bigint,
  completed_content_version bigint, current_content_version bigint,
  upserted_count integer, replayed boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_state public.softora_mailbox_campaign_consistency%rowtype;
  v_mutation public.softora_mailbox_campaign_mutations%rowtype;
  v_sync public.softora_mailbox_sync_state%rowtype;
  v_uid_result record;
  v_upserted integer := 0;
  v_uid_validity bigint := 0;
  v_sync_lock_token text := btrim(coalesce(p_result->>'syncLockToken', ''));
  v_uid_requested boolean := false;
begin
  if p_mutation_id is null
    or char_length(btrim(coalesce(p_request_key, ''))) not between 1 and 200
    or jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) > 2000 then
    raise exception using errcode = '22023',
      message = 'Ongeldige atomische mailboxmutatie';
  end if;
  v_uid_requested := coalesce(p_result, '{}'::jsonb) ? 'uidValidity'
    or exists (
      select 1 from jsonb_array_elements(p_rows) as candidate(row_data)
      where candidate.row_data ? 'uid_validity'
    );

  -- Always enter through the same global lock as lease transitions. Whether
  -- this is an IMAP mutation is durable journal state, so lock ordering must
  -- never depend on caller-controlled result metadata.
  perform pg_advisory_xact_lock(824031, 3);
  select * into strict v_state
  from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  select * into strict v_mutation
  from public.softora_mailbox_campaign_mutations as selected_mutation
  where selected_mutation.mutation_id = p_mutation_id for update;

  if v_mutation.request_key is distinct from btrim(p_request_key) then
    raise exception using errcode = '22023',
      message = 'mutation_id en request_key horen niet bij elkaar';
  elsif v_mutation.status = 'completed' then
    return query select
      v_mutation.mutation_id, v_mutation.status, v_mutation.started_content_version,
      v_mutation.completed_content_version, v_state.content_version,
      case when coalesce(v_mutation.result->>'upserted', '') ~ '^\d+$'
        then least((v_mutation.result->>'upserted')::bigint, 2147483647)::integer
        else 0 end,
      true;
    return;
  elsif v_mutation.status <> 'pending' then
    raise exception using errcode = '55000',
      message = 'Mailboxmutatie is niet meer schrijfbaar';
  end if;

  if v_mutation.mutation_kind = 'imap-sync' then
    select * into v_sync
    from public.softora_mailbox_sync_state as sync_state
    where sync_state.sync_key = v_mutation.account_email || '|' || v_mutation.folder
    for update;
    if v_uid_requested then
      if (case when coalesce(p_result->>'uidValidity', '') ~ '^\d+$'
          then (p_result->>'uidValidity')::numeric between 1 and 4294967295
          else false end) is not true
        or v_sync_lock_token = '' or char_length(v_sync_lock_token) > 200
        or not found
        or v_sync.status <> 'syncing'
        or v_sync.lock_token is distinct from v_sync_lock_token
        or v_sync.lock_expires_at <= clock_timestamp() then
        raise exception using errcode = '55000',
          message = 'MAILBOX_UIDVALIDITY_LEASE_INVALID';
      end if;
      v_uid_validity := (p_result->>'uidValidity')::bigint;
      if exists (
        select 1 from jsonb_array_elements(p_rows) as candidate(row_data)
        where (case when coalesce(candidate.row_data->>'uid_validity', '') ~ '^\d+$'
            then (candidate.row_data->>'uid_validity')::numeric = v_uid_validity::numeric
            else false end) is not true
          or (case when coalesce(candidate.row_data->>'uid', '') ~ '^\d+$'
            then (candidate.row_data->>'uid')::numeric between 1 and 9223372036854775807
            else false end) is not true
          or candidate.row_data->>'message_key' is distinct from
            v_mutation.account_email || '|' || v_mutation.folder || '|uv:'
            || v_uid_validity::text || '|' || candidate.row_data->>'uid'
      ) then
        raise exception using errcode = '22023',
          message = 'MAILBOX_UIDVALIDITY_ROW_MISMATCH';
      end if;
      select * into strict v_uid_result
      from public.softora_apply_mailbox_uid_validity(
        v_mutation.account_email, v_mutation.folder, v_uid_validity,
        v_sync_lock_token
      );
    -- A warm pre-UIDVALIDITY runtime is safe to coerce only while this folder
    -- has never experienced a real generation reset. The BEFORE INSERT row
    -- trigger rewrites those legacy keys to the adopted current generation.
    -- After the first reset, generation-less provider data is ambiguous.
    elsif not found or (
      v_sync.uid_validity is not null
      and v_sync.uid_validity_reset_at is not null
    ) then
      raise exception using errcode = '55000',
        message = 'MAILBOX_UIDVALIDITY_REQUIRED';
    end if;
  elsif jsonb_array_length(p_rows) = 0 then
    raise exception using errcode = '22023',
      message = 'Ongeldige atomische mailboxmutatie';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as candidate(row_data)
    where jsonb_typeof(candidate.row_data) is distinct from 'object'
      or not public.softora_is_campaign_mailbox_message(
        candidate.row_data->>'account_email',
        candidate.row_data->>'folder',
        candidate.row_data->'payload'
      )
      or (
        v_mutation.mutation_kind = 'imap-sync'
        and (
          lower(btrim(coalesce(candidate.row_data->>'account_email', '')))
            is distinct from v_mutation.account_email
          or lower(btrim(coalesce(candidate.row_data->>'folder', '')))
            is distinct from v_mutation.folder
        )
      )
      or (
        v_mutation.mutation_kind = 'instantly-upsert'
        and (
          lower(btrim(coalesce(candidate.row_data->>'folder', ''))) <> 'instantly'
          or lower(btrim(coalesce(candidate.row_data->>'account_email', '')))
            is distinct from v_mutation.account_email
          or lower(btrim(coalesce(
            candidate.row_data->'payload'->>'providerAccountEmail', ''
          ))) is distinct from lower(btrim(coalesce(
            candidate.row_data->>'account_email', ''
          )))
        )
      )
  ) or v_mutation.mutation_kind not in ('imap-sync', 'instantly-upsert') then
    raise exception using errcode = '22023',
      message = 'Mailboxrijen horen niet bij de gereserveerde mutatie';
  end if;

  insert into public.softora_mailbox_messages as stored_message (
    message_key, account_email, folder, uid, uid_validity, provider_id, message_id,
    in_reply_to, references_text, sender_name, sender_email, recipients_text,
    subject, preview, body_text, body_truncated, has_body, date, internal_date,
    unread, starred, payload, updated_at
  )
  select
    incoming.message_key, incoming.account_email, incoming.folder, incoming.uid,
    incoming.uid_validity, incoming.provider_id, incoming.message_id,
    incoming.in_reply_to, incoming.references_text, incoming.sender_name,
    incoming.sender_email, incoming.recipients_text, incoming.subject,
    incoming.preview, incoming.body_text, incoming.body_truncated,
    incoming.has_body, incoming.date, incoming.internal_date, incoming.unread,
    incoming.starred, incoming.payload, incoming.updated_at
  from jsonb_to_recordset(p_rows) as incoming(
    message_key text, account_email text, folder text, uid bigint,
    uid_validity bigint, provider_id text, message_id text, in_reply_to text,
    references_text text, sender_name text, sender_email text,
    recipients_text text, subject text, preview text, body_text text,
    body_truncated boolean, has_body boolean, date timestamptz,
    internal_date timestamptz, unread boolean, starred boolean, payload jsonb,
    updated_at timestamptz
  )
  on conflict (message_key) do update set
    account_email = excluded.account_email,
    folder = excluded.folder,
    uid = excluded.uid,
    uid_validity = excluded.uid_validity,
    provider_id = excluded.provider_id,
    message_id = excluded.message_id,
    in_reply_to = excluded.in_reply_to,
    references_text = excluded.references_text,
    sender_name = excluded.sender_name,
    sender_email = excluded.sender_email,
    recipients_text = excluded.recipients_text,
    subject = excluded.subject,
    preview = excluded.preview,
    body_text = excluded.body_text,
    body_truncated = excluded.body_truncated,
    has_body = excluded.has_body,
    date = excluded.date,
    internal_date = excluded.internal_date,
    unread = excluded.unread,
    starred = excluded.starred,
    payload = excluded.payload,
    updated_at = excluded.updated_at;
  get diagnostics v_upserted = row_count;

  select * into strict v_state
  from public.softora_mailbox_campaign_consistency
  where scope = 'campaign';
  update public.softora_mailbox_campaign_mutations as pending_mutation set
    status = 'completed',
    completed_content_version = v_state.content_version,
    completed_at = clock_timestamp(),
    result = (coalesce(p_result, '{}'::jsonb) - 'syncLockToken')
      || jsonb_build_object('ok', true, 'upserted', v_upserted),
    updated_at = clock_timestamp()
  where pending_mutation.mutation_id = p_mutation_id
    and pending_mutation.status = 'pending'
  returning * into strict v_mutation;

  return query select
    v_mutation.mutation_id, v_mutation.status, v_mutation.started_content_version,
    v_mutation.completed_content_version, v_state.content_version, v_upserted, false;
end;
$$;

revoke all on function public.softora_apply_mailbox_uid_validity(text, text, bigint, text)
  from public, anon, authenticated, service_role;
revoke all on function public.softora_coerce_mailbox_uid_generation()
  from public, anon, authenticated, service_role;
revoke all on function public.softora_prepare_mailbox_uid_validity(text, text, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.softora_commit_mailbox_campaign_messages(uuid, text, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.softora_apply_mailbox_uid_validity(text, text, bigint, text)
  to service_role;
grant execute on function public.softora_coerce_mailbox_uid_generation()
  to service_role;
grant execute on function public.softora_prepare_mailbox_uid_validity(text, text, bigint)
  to service_role;
grant execute on function public.softora_commit_mailbox_campaign_messages(uuid, text, jsonb, jsonb)
  to service_role;
-- mailbox-uidvalidity-generation:end

-- mailbox-uidvalidity-identity-adoption:start
create or replace function public.softora_enforce_mailbox_message_identity_immutable()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_account_email text := lower(btrim(coalesce(old.account_email, '')));
  v_folder text := lower(btrim(coalesce(old.folder, '')));
  v_generation_adoption boolean := false;
begin
  v_generation_adoption :=
    old.uid_validity is null
    and new.uid_validity between 1 and 4294967295
    and lower(btrim(new.account_email)) = v_account_email
    and lower(btrim(new.folder)) = v_folder
    and new.uid is not distinct from old.uid
    and new.provider_id is not distinct from old.provider_id
    and old.message_key = v_account_email || '|' || v_folder || '|' || old.uid::text
    and new.message_key = v_account_email || '|' || v_folder || '|uv:'
      || new.uid_validity::text || '|' || old.uid::text;

  if old.message_key is distinct from new.message_key
    or lower(btrim(old.account_email)) is distinct from lower(btrim(new.account_email))
    or lower(btrim(old.folder)) is distinct from lower(btrim(new.folder))
    or old.uid is distinct from new.uid
    or old.uid_validity is distinct from new.uid_validity
    or old.provider_id is distinct from new.provider_id then
    if not v_generation_adoption then
      raise exception using errcode = '23505',
        message = 'Bestaande mailboxidentiteit mag niet van account of provider wisselen';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.softora_enforce_mailbox_message_identity_immutable()
  from public, anon, authenticated, service_role;
grant execute on function public.softora_enforce_mailbox_message_identity_immutable()
  to service_role;
-- mailbox-uidvalidity-identity-adoption:end

-- mailbox-send-provider-outcome-state:start
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.softora_mailbox_canonical_sha256(p_parts text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        coalesce(string_agg(
          octet_length(convert_to(coalesce(part, ''), 'UTF8'))::text || ':' || coalesce(part, ''),
          '|' order by ordinal
        ), ''),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from unnest(p_parts) with ordinality as values_with_order(part, ordinal);
$$;
revoke all on function public.softora_mailbox_canonical_sha256(text[])
  from public, anon, authenticated, service_role;

alter table public.softora_mailbox_send_provenance
  add column if not exists send_identity_key text,
  add column if not exists send_scope_key text,
  add column if not exists payload_fingerprint text,
  add column if not exists attachments_fingerprint text not null default '',
  add column if not exists dispatch_state text not null default 'reserved',
  add column if not exists dispatch_started_at timestamptz,
  add column if not exists dispatch_lease_expires_at timestamptz,
  add column if not exists outbound_guard_required boolean not null default false,
  add column if not exists outbound_guard_reconcile_required boolean not null default false,
  add column if not exists sent_reconcile_required boolean not null default false,
  add column if not exists accepted_recipients jsonb not null default '[]'::jsonb,
  add column if not exists rejected_recipients jsonb not null default '[]'::jsonb,
  add column if not exists storage_degraded boolean not null default false,
  add column if not exists reconcile_required boolean not null default false;

do $$
begin
  if exists (
    select 1
    from public.softora_mailbox_send_provenance
    where status in ('prepared', 'accepted')
      and (
        lower(btrim(provider)) not in ('smtp', 'instantly') or
        (mode = 'reply' and (
          nullif(btrim(reply_target_message_id), '') is null or
          coalesce(nullif(btrim(provider_thread_id), ''), nullif(btrim(conversation_id), '')) is null
        ))
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Actieve legacy mailbox-send mist semantische provider/threadidentiteit';
  end if;
end;
$$;

with normalized as (
  select
    intent_id,
    lower(btrim(owner)) as owner_value,
    lower(btrim(account_email)) as account_value,
    lower(btrim(recipient_email)) as recipient_value,
    lower(btrim(provider)) as provider_value,
    lower(btrim(mode)) as mode_value,
    case
      when lower(btrim(mode)) = 'reply' then coalesce(
        nullif(btrim(provider_thread_id), ''), btrim(coalesce(conversation_id, ''))
      )
      else btrim(coalesce(conversation_id, ''))
    end as thread_value,
    case when lower(btrim(mode)) = 'reply'
      then btrim(coalesce(reply_target_message_id, '')) else '' end as reply_target_value
  from public.softora_mailbox_send_provenance
), semantic_scopes as (
  select
    intent_id,
    provider_value || '-' || mode_value || '-scope:' ||
      public.softora_mailbox_canonical_sha256(array[
        owner_value, account_value, recipient_value, provider_value, mode_value,
        thread_value, reply_target_value
      ]) as semantic_scope_key
  from normalized
)
update public.softora_mailbox_send_provenance as provenance
set send_scope_key = semantic_scopes.semantic_scope_key
from semantic_scopes
where provenance.intent_id = semantic_scopes.intent_id
  and (provenance.send_scope_key is null or provenance.send_scope_key like 'legacy:%');

update public.softora_mailbox_send_provenance
set payload_fingerprint = public.softora_mailbox_canonical_sha256(array[
  btrim(coalesce(subject, '')),
  replace(replace(btrim(coalesce(body_text, '')), E'\r\n', E'\n'), E'\r', E'\n'),
  lower(btrim(coalesce(cc_text, ''))),
  lower(btrim(coalesce(bcc_text, ''))),
  btrim(coalesce(attachments_fingerprint, ''))
])
where payload_fingerprint is null;

update public.softora_mailbox_send_provenance
set send_identity_key = case
  when mode = 'reply' then replace(send_scope_key, '-scope:', ':')
  else 'new-message:' || public.softora_mailbox_canonical_sha256(array[
    send_scope_key, payload_fingerprint
  ])
end
where send_identity_key is null or send_identity_key like 'legacy:%';

update public.softora_mailbox_send_provenance
set
  dispatch_state = case
    when status in ('accepted', 'failed') then 'finished'
    else 'started'
  end,
  dispatch_started_at = case
    when status in ('prepared', 'unknown')
      then coalesce(dispatch_started_at, updated_at, created_at)
    else dispatch_started_at
  end,
  dispatch_lease_expires_at = null
where dispatch_state = 'reserved' and dispatch_lease_expires_at is null;

alter table public.softora_mailbox_send_provenance
  alter column send_identity_key set not null,
  alter column send_scope_key set not null,
  alter column payload_fingerprint set not null;

alter table public.softora_mailbox_send_provenance
  drop constraint if exists softora_mailbox_send_provenance_status_check,
  drop constraint if exists softora_mailbox_send_provenance_provider_check,
  drop constraint if exists softora_mailbox_send_provenance_dispatch_state_check;
alter table public.softora_mailbox_send_provenance
  add constraint softora_mailbox_send_provenance_status_check
    check (status in ('prepared', 'accepted', 'failed', 'unknown')),
  add constraint softora_mailbox_send_provenance_provider_check
    check (provider in ('smtp', 'instantly')),
  add constraint softora_mailbox_send_provenance_dispatch_state_check
    check (dispatch_state in ('reserved', 'started', 'finished'));

alter table public.softora_mailbox_send_provenance
  drop constraint if exists softora_mailbox_send_provenance_identity_format_check,
  drop constraint if exists softora_mailbox_send_provenance_scope_format_check,
  drop constraint if exists softora_mailbox_send_provenance_payload_format_check;
alter table public.softora_mailbox_send_provenance
  add constraint softora_mailbox_send_provenance_identity_format_check
    check (send_identity_key ~ '^(smtp-reply|instantly-reply|new-message):[0-9a-f]{64}$'),
  add constraint softora_mailbox_send_provenance_scope_format_check
    check (send_scope_key ~ '^(smtp|instantly)-(reply|new-message)-scope:[0-9a-f]{64}$'),
  add constraint softora_mailbox_send_provenance_payload_format_check
    check (payload_fingerprint ~ '^[0-9a-f]{64}$');

create or replace function public.softora_enforce_mailbox_send_status_monotone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not (
    old.status = new.status or
    (old.status = 'prepared' and new.status in ('accepted', 'unknown', 'failed')) or
    (old.status = 'unknown' and new.status = 'accepted')
  ) then
    raise exception using
      errcode = '23514',
      message = 'Mailbox-sendstatus mag niet worden teruggedraaid';
  end if;
  if not (
    old.dispatch_state = new.dispatch_state or
    (old.dispatch_state = 'reserved' and new.dispatch_state in ('started', 'finished')) or
    (old.dispatch_state = 'started' and new.dispatch_state = 'finished')
  ) then
    raise exception using
      errcode = '23514',
      message = 'Mailbox-dispatchstatus mag niet worden teruggedraaid';
  end if;
  return new;
end;
$$;
revoke all on function public.softora_enforce_mailbox_send_status_monotone()
  from public, anon, authenticated, service_role;
drop trigger if exists softora_mailbox_send_status_monotone
  on public.softora_mailbox_send_provenance;
create trigger softora_mailbox_send_status_monotone
before update of status, dispatch_state on public.softora_mailbox_send_provenance
for each row execute function public.softora_enforce_mailbox_send_status_monotone();

drop index if exists public.softora_mailbox_send_provenance_active_identity_idx;
create unique index softora_mailbox_send_provenance_active_identity_idx
  on public.softora_mailbox_send_provenance (send_identity_key)
  where status in ('prepared', 'unknown', 'accepted');

create unique index if not exists softora_mailbox_send_provenance_active_scope_idx
  on public.softora_mailbox_send_provenance (send_scope_key)
  where mode = 'new-message' and status in ('prepared', 'unknown');

revoke all privileges on table public.softora_mailbox_send_provenance
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.softora_mailbox_send_provenance
  to service_role;
-- mailbox-send-provider-outcome-state:end

-- webdesign-bulk-worker-lease:start
create table if not exists public.softora_background_worker_locks (
  lock_key text primary key
    check (lock_key ~ '^[a-z0-9][a-z0-9:_-]{2,119}$'),
  lock_token text not null
    check (char_length(btrim(lock_token)) between 1 and 200),
  lock_expires_at timestamptz not null,
  acquired_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists softora_background_worker_locks_expires_idx
  on public.softora_background_worker_locks (lock_expires_at, lock_key);

alter table public.softora_background_worker_locks enable row level security;
revoke all privileges on table public.softora_background_worker_locks
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.softora_background_worker_locks
  to service_role;

create or replace function public.softora_claim_background_worker_lock(
  p_lock_key text,
  p_lock_token text,
  p_lock_ttl_seconds integer default 900
)
returns table (
  acquired boolean,
  claimed_lock_token text,
  lock_expires_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_lock_key text := lower(btrim(coalesce(p_lock_key, '')));
  v_lock_token text := btrim(coalesce(p_lock_token, ''));
  v_now timestamptz := clock_timestamp();
  v_current public.softora_background_worker_locks%rowtype;
begin
  if v_lock_key !~ '^[a-z0-9][a-z0-9:_-]{2,119}$'
    or char_length(v_lock_token) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'BACKGROUND_WORKER_LOCK_IDENTITY_INVALID';
  end if;

  insert into public.softora_background_worker_locks as stored_lock (
    lock_key, lock_token, lock_expires_at, acquired_at, updated_at
  ) values (
    v_lock_key,
    v_lock_token,
    v_now + make_interval(secs => greatest(30, least(1800, coalesce(p_lock_ttl_seconds, 900)))),
    v_now,
    v_now
  )
  on conflict (lock_key) do update set
    lock_token = excluded.lock_token,
    lock_expires_at = excluded.lock_expires_at,
    acquired_at = excluded.acquired_at,
    updated_at = excluded.updated_at
  where stored_lock.lock_expires_at <= v_now
    or stored_lock.lock_token = v_lock_token
  returning stored_lock.* into v_current;

  if found then
    return query select true, v_current.lock_token, v_current.lock_expires_at;
    return;
  end if;

  select * into v_current
  from public.softora_background_worker_locks as active_lock
  where active_lock.lock_key = v_lock_key;
  return query select false, null::text, v_current.lock_expires_at;
end;
$$;

create or replace function public.softora_release_background_worker_lock(
  p_lock_key text,
  p_lock_token text
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_deleted integer := 0;
begin
  delete from public.softora_background_worker_locks
  where lock_key = lower(btrim(coalesce(p_lock_key, '')))
    and lock_token = btrim(coalesce(p_lock_token, ''));
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

comment on table public.softora_background_worker_locks
  is 'Short token-bound leases that coalesce overlapping Softora serverless background workers.';
comment on function public.softora_claim_background_worker_lock(text, text, integer)
  is 'Atomically claims or renews a named background-worker lease; active foreign tokens are never replaced.';
comment on function public.softora_release_background_worker_lock(text, text)
  is 'Releases a background-worker lease only when the lock token still matches.';

revoke all on function public.softora_claim_background_worker_lock(text, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.softora_release_background_worker_lock(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.softora_claim_background_worker_lock(text, text, integer)
  to service_role;
grant execute on function public.softora_release_background_worker_lock(text, text)
  to service_role;
-- webdesign-bulk-worker-lease:end
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
-- mailbox-recipient-batch-lookup:start
-- Campaign history passes many contact addresses at once. Keep the lookup
-- service-role only and let one expression-GIN query replace one REST request
-- per recipient without changing account, folder, visibility or result caps.

create or replace function public.softora_list_mailbox_messages_by_recipients(
  p_account_emails text[],
  p_folder text,
  p_recipient_emails text[],
  p_limit integer default 1000
)
returns jsonb
language sql
stable
parallel safe
security invoker
set search_path = ''
as $function$
  with normalized as (
    select
      array(
        select distinct pg_catalog.lower(pg_catalog.btrim(account_email))
        from pg_catalog.unnest(coalesce(p_account_emails, array[]::text[])) as accounts(account_email)
        where nullif(pg_catalog.btrim(account_email), '') is not null
      ) as account_emails,
      pg_catalog.lower(pg_catalog.btrim(coalesce(p_folder, 'sent'))) as folder,
      array(
        select distinct pg_catalog.lower(pg_catalog.btrim(recipient_email))
        from pg_catalog.unnest(coalesce(p_recipient_emails, array[]::text[])) as recipients(recipient_email)
        where nullif(pg_catalog.btrim(recipient_email), '') is not null
      ) as recipient_emails,
      greatest(1, least(4000, coalesce(p_limit, 1000))) as row_limit
  ),
  active_keys as (
    select m.message_key, m.date
    from public.softora_mailbox_messages as m
    cross join normalized
    where m.account_email = any(normalized.account_emails)
      and m.folder = normalized.folder
      and m.deleted_at is null
      and m.generation_superseded_at is null
      and public.softora_mailbox_message_participants(
        m.sender_email,
        m.recipients_text,
        m.payload
      ) && normalized.recipient_emails
      and public.softora_mailbox_participant_emails(m.recipients_text)
        && normalized.recipient_emails
    order by m.date desc, m.message_key desc
    limit (select row_limit from normalized)
  ),
  superseded_keys as (
    select m.message_key, m.date
    from public.softora_mailbox_messages as m
    cross join normalized
    where m.account_email = any(normalized.account_emails)
      and m.folder = normalized.folder
      and m.deleted_at is null
      and m.generation_superseded_at is not null
      and public.softora_mailbox_message_participants(
        m.sender_email,
        m.recipients_text,
        m.payload
      ) && normalized.recipient_emails
      and public.softora_mailbox_participant_emails(m.recipients_text)
        && normalized.recipient_emails
    order by m.date desc, m.message_key desc
    limit (select row_limit from normalized)
  ),
  candidate_keys as (
    select active_keys.message_key, active_keys.date from active_keys
    union all
    select superseded_keys.message_key, superseded_keys.date from superseded_keys
  ),
  paged_keys as (
    select candidate_keys.message_key, candidate_keys.date
    from candidate_keys
    order by candidate_keys.date desc, candidate_keys.message_key desc
    limit (select row_limit from normalized)
  ),
  messages as (
    select
      paged_keys.date,
      paged_keys.message_key,
      pg_catalog.jsonb_build_object(
        'message_key', m.message_key,
        'account_email', m.account_email,
        'folder', m.folder,
        'uid', m.uid,
        'provider_id', m.provider_id,
        'message_id', m.message_id,
        'in_reply_to', m.in_reply_to,
        'references_text', m.references_text,
        'sender_name', m.sender_name,
        'sender_email', m.sender_email,
        'recipients_text', m.recipients_text,
        'subject', m.subject,
        'preview', m.preview,
        'date', m.date,
        'internal_date', m.internal_date,
        'unread', m.unread,
        'softora_read_at', m.softora_read_at,
        'state_revision', m.state_revision,
        'state_mutation_key', m.state_mutation_key,
        'state_mutation_at', m.state_mutation_at,
        'starred', m.starred,
        'reply_dismissed_at', m.reply_dismissed_at,
        'has_body', m.has_body,
        'body_truncated', m.body_truncated,
        'payload', m.payload
      ) as message
    from paged_keys
    join public.softora_mailbox_messages as m using (message_key)
  )
  select coalesce(
    pg_catalog.jsonb_agg(messages.message order by messages.date desc, messages.message_key desc),
    '[]'::jsonb
  )
  from messages;
$function$;

revoke all on function public.softora_list_mailbox_messages_by_recipients(text[], text, text[], integer)
  from public, anon, authenticated, service_role;

grant execute on function public.softora_list_mailbox_messages_by_recipients(text[], text, text[], integer)
  to service_role;
notify pgrst, 'reload schema';
-- mailbox-recipient-batch-lookup:end

-- mailbox-uid-generation-protocol-gate:start
-- Rolling-release gate for the UID-generation v2 cutover. The existing
-- campaign-consistency singleton is already part of every mailbox mutation's
-- lock order, so it is also the database-authoritative protocol switch.
alter table public.softora_mailbox_campaign_consistency
  add column if not exists uid_generation_protocol text not null default 'legacy';
alter table public.softora_mailbox_campaign_consistency
  add column if not exists uid_generation_protocol_changed_at timestamptz
    not null default pg_catalog.clock_timestamp();
alter table public.softora_mailbox_campaign_consistency
  add column if not exists uid_generation_drain_started_at timestamptz;
alter table public.softora_mailbox_campaign_consistency
  add column if not exists uid_generation_drain_ready_at timestamptz;

do $constraints$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'softora_mailbox_campaign_uid_protocol_check'
      and conrelid = 'public.softora_mailbox_campaign_consistency'::pg_catalog.regclass
  ) then
    alter table public.softora_mailbox_campaign_consistency
      add constraint softora_mailbox_campaign_uid_protocol_check check (
        uid_generation_protocol = any (array['legacy', 'draining', 'v2']::text[])
      );
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'softora_mailbox_campaign_uid_drain_check'
      and conrelid = 'public.softora_mailbox_campaign_consistency'::pg_catalog.regclass
  ) then
    alter table public.softora_mailbox_campaign_consistency
      add constraint softora_mailbox_campaign_uid_drain_check check (
        (
          uid_generation_protocol = 'legacy'
          and uid_generation_drain_started_at is null
          and uid_generation_drain_ready_at is null
        ) or (
          uid_generation_protocol in ('draining', 'v2')
          and uid_generation_drain_started_at is not null
          and uid_generation_drain_ready_at is not null
          and uid_generation_drain_ready_at >= uid_generation_drain_started_at
        )
      );
  end if;
end;
$constraints$;

insert into public.softora_mailbox_campaign_consistency (
  scope, content_version, uid_generation_protocol
) values ('campaign', 0, 'legacy')
on conflict (scope) do nothing;

create or replace function public.softora_guard_mailbox_uid_generation_protocol()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_transition_allowed boolean := coalesce(pg_catalog.current_setting(
    'softora.mailbox_uid_protocol_transition', true
  ), '') = '1';
begin
  if row(
    old.uid_generation_protocol,
    old.uid_generation_protocol_changed_at,
    old.uid_generation_drain_started_at,
    old.uid_generation_drain_ready_at
  ) is not distinct from row(
    new.uid_generation_protocol,
    new.uid_generation_protocol_changed_at,
    new.uid_generation_drain_started_at,
    new.uid_generation_drain_ready_at
  ) then
    return new;
  end if;
  if not v_transition_allowed then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_TRANSITION_REQUIRED';
  end if;
  if not (
    (old.uid_generation_protocol = 'legacy' and new.uid_generation_protocol = 'draining')
    or (old.uid_generation_protocol = 'draining' and new.uid_generation_protocol = 'v2')
  ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_TRANSITION_INVALID';
  end if;
  if new.uid_generation_protocol_changed_at <= old.uid_generation_protocol_changed_at then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_PROTOCOL_TIMESTAMP_INVALID';
  end if;
  return new;
end;
$function$;

drop trigger if exists softora_guard_mailbox_uid_generation_protocol
  on public.softora_mailbox_campaign_consistency;
create trigger softora_guard_mailbox_uid_generation_protocol
before update of uid_generation_protocol, uid_generation_protocol_changed_at,
  uid_generation_drain_started_at, uid_generation_drain_ready_at
on public.softora_mailbox_campaign_consistency
for each row execute function public.softora_guard_mailbox_uid_generation_protocol();

create or replace function public.softora_get_mailbox_uid_generation_protocol()
returns table (
  protocol text,
  protocol_changed_at timestamptz,
  drain_started_at timestamptz,
  drain_ready_at timestamptz,
  drain_ready boolean
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select consistency.uid_generation_protocol,
    consistency.uid_generation_protocol_changed_at,
    consistency.uid_generation_drain_started_at,
    consistency.uid_generation_drain_ready_at,
    consistency.uid_generation_protocol = 'draining'
      and consistency.uid_generation_drain_ready_at <= pg_catalog.clock_timestamp()
      and not exists (
        select 1 from public.softora_mailbox_sync_state as active_sync
        where active_sync.status = 'syncing'
          and nullif(pg_catalog.btrim(active_sync.lock_token), '') is not null
          and active_sync.lock_expires_at > pg_catalog.clock_timestamp()
      )
  from public.softora_mailbox_campaign_consistency as consistency
  where consistency.scope = 'campaign';
$function$;

create or replace function public.softora_begin_mailbox_uid_generation_v2_drain(
  p_drain_seconds integer default 180
)
returns table (
  protocol text,
  protocol_changed_at timestamptz,
  drain_started_at timestamptz,
  drain_ready_at timestamptz,
  active_lease_count integer,
  latest_lease_expiry timestamptz,
  drain_ready boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_consistency public.softora_mailbox_campaign_consistency%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_active_count integer := 0;
  v_latest_expiry timestamptz;
begin
  if coalesce(p_drain_seconds, 0) not between 180 and 900 then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_PROTOCOL_DRAIN_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  select consistency.* into strict v_consistency
  from public.softora_mailbox_campaign_consistency as consistency
  where consistency.scope = 'campaign'
  for update;

  if v_consistency.uid_generation_protocol = 'v2' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_ALREADY_V2';
  elsif v_consistency.uid_generation_protocol = 'legacy' then
    perform pg_catalog.set_config(
      'softora.mailbox_uid_protocol_transition', '1', true
    );
    update public.softora_mailbox_campaign_consistency as consistency
    set uid_generation_protocol = 'draining',
        uid_generation_protocol_changed_at = v_now,
        uid_generation_drain_started_at = v_now,
        uid_generation_drain_ready_at = v_now + pg_catalog.make_interval(
          secs => p_drain_seconds
        ),
        updated_at = v_now
    where consistency.scope = 'campaign'
    returning consistency.* into strict v_consistency;
  end if;

  select pg_catalog.count(*)::integer, pg_catalog.max(active_sync.lock_expires_at)
  into v_active_count, v_latest_expiry
  from public.softora_mailbox_sync_state as active_sync
  where active_sync.status = 'syncing'
    and nullif(pg_catalog.btrim(active_sync.lock_token), '') is not null
    and active_sync.lock_expires_at > pg_catalog.clock_timestamp();

  return query select v_consistency.uid_generation_protocol,
    v_consistency.uid_generation_protocol_changed_at,
    v_consistency.uid_generation_drain_started_at,
    v_consistency.uid_generation_drain_ready_at,
    v_active_count,
    v_latest_expiry,
    v_consistency.uid_generation_drain_ready_at <= pg_catalog.clock_timestamp()
      and v_active_count = 0;
end;
$function$;

-- Replace the stable six-argument lock RPC with one additional trailing
-- default argument. Existing runtimes still resolve their unchanged call to
-- protocol "legacy"; dual runtimes pass the database-reported protocol.
revoke all on function public.softora_claim_mailbox_sync_lock(
  text, text, text, text, integer, boolean
) from public, anon, authenticated, service_role;
drop function public.softora_claim_mailbox_sync_lock(
  text, text, text, text, integer, boolean
);

create function public.softora_claim_mailbox_sync_lock(
  p_sync_key text,
  p_account_email text,
  p_folder text,
  p_lock_token text,
  p_lock_ttl_seconds integer default 90,
  p_force boolean default false,
  p_protocol text default 'legacy'
)
returns table (
  acquired boolean,
  locked boolean,
  claimed_lock_token text,
  lock_expires_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_sync_key text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_sync_key, '')));
  v_account_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_account_email, '')));
  v_folder text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_folder, '')));
  v_lock_token text := pg_catalog.btrim(coalesce(p_lock_token, ''));
  v_protocol text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_protocol, '')));
  v_consistency public.softora_mailbox_campaign_consistency%rowtype;
  v_current public.softora_mailbox_sync_state%rowtype;
  v_active_count integer := 0;
  v_blocked_until timestamptz;
begin
  if v_sync_key = '' or pg_catalog.char_length(v_sync_key) > 600
    or v_account_email = '' or pg_catalog.char_length(v_account_email) > 320
    or v_folder = '' or pg_catalog.char_length(v_folder) > 200
    or v_lock_token = '' or pg_catalog.char_length(v_lock_token) > 200
    or position('|' in v_account_email) > 0
    or position('|' in v_folder) > 0
    or v_sync_key is distinct from (v_account_email || '|' || v_folder)
    or v_protocol not in ('legacy', 'v2') then
    raise exception using errcode = '22023',
      message = 'MAILBOX_SYNC_LOCK_IDENTITY_INVALID';
  end if;

  -- Shared order for old, dual and v2 callers: advisory -> protocol -> sync.
  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  select consistency.* into strict v_consistency
  from public.softora_mailbox_campaign_consistency as consistency
  where consistency.scope = 'campaign'
  for update;

  if v_consistency.uid_generation_protocol = 'draining'
    or v_consistency.uid_generation_protocol is distinct from v_protocol then
    v_blocked_until := greatest(
      coalesce(v_consistency.uid_generation_drain_ready_at,
        pg_catalog.clock_timestamp()),
      pg_catalog.clock_timestamp() + interval '30 seconds'
    );
    return query select false, true, null::text, v_blocked_until;
    return;
  end if;

  select current_sync.* into v_current
  from public.softora_mailbox_sync_state as current_sync
  where current_sync.sync_key = v_sync_key
  for update;

  if found
    and v_current.status = 'syncing'
    and nullif(pg_catalog.btrim(v_current.lock_token), '') is not null
    and v_current.lock_expires_at > pg_catalog.clock_timestamp() then
    if pg_catalog.btrim(v_current.lock_token) = v_lock_token then
      return query select true, false, v_lock_token, v_current.lock_expires_at;
    else
      return query select false, true, null::text, v_current.lock_expires_at;
    end if;
    return;
  end if;

  select pg_catalog.count(*)::integer into v_active_count
  from public.softora_mailbox_sync_state as active_sync
  where active_sync.status = 'syncing'
    and nullif(pg_catalog.btrim(active_sync.lock_token), '') is not null
    and active_sync.lock_expires_at > pg_catalog.clock_timestamp()
    and active_sync.sync_key <> v_sync_key;
  if v_active_count >= 3 then
    return query select false, true, null::text, null::timestamptz;
    return;
  end if;

  insert into public.softora_mailbox_sync_state as stored_sync (
    sync_key, account_email, folder, status, sync_started_at,
    lock_token, lock_expires_at, last_error, updated_at
  ) values (
    v_sync_key, v_account_email, v_folder, 'syncing', pg_catalog.clock_timestamp(),
    v_lock_token,
    pg_catalog.clock_timestamp() + pg_catalog.make_interval(
      secs => greatest(10, least(
        300, coalesce(p_lock_ttl_seconds, 90)
      ))
    ),
    null, pg_catalog.clock_timestamp()
  )
  on conflict (sync_key) do update set
    account_email = excluded.account_email,
    folder = excluded.folder,
    status = excluded.status,
    sync_started_at = excluded.sync_started_at,
    lock_token = excluded.lock_token,
    lock_expires_at = excluded.lock_expires_at,
    last_error = null,
    updated_at = excluded.updated_at
  returning stored_sync.* into v_current;

  return query select true, false, v_lock_token, v_current.lock_expires_at;
end;
$function$;

comment on function public.softora_claim_mailbox_sync_lock(
  text, text, text, text, integer, boolean, text
) is 'Claims a mailbox lease only when the caller protocol matches the database rollout protocol; omitted protocol remains legacy-compatible.';

revoke all on function public.softora_guard_mailbox_uid_generation_protocol()
  from public, anon, authenticated, service_role;
revoke all on function public.softora_get_mailbox_uid_generation_protocol()
  from public, anon, authenticated;
revoke all on function public.softora_begin_mailbox_uid_generation_v2_drain(integer)
  from public, anon, authenticated;
revoke all on function public.softora_claim_mailbox_sync_lock(
  text, text, text, text, integer, boolean, text
) from public, anon, authenticated;
grant execute on function public.softora_get_mailbox_uid_generation_protocol()
  to service_role;
grant execute on function public.softora_begin_mailbox_uid_generation_v2_drain(integer)
  to service_role;
grant execute on function public.softora_claim_mailbox_sync_lock(
  text, text, text, text, integer, boolean, text
) to service_role;
notify pgrst, 'reload schema';
-- mailbox-uid-generation-protocol-gate:end
