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
-- mailbox-uid-generation-epoch-v2:start
-- UIDVALIDITY identifies one IMAP epoch but is not itself a durable epoch ID:
-- a provider can expose A -> B -> A over time. UUID generations keep those two
-- A epochs distinct and keep a rebuilt snapshot invisible until activation.

-- The protocol-gate migration must already have put the runtime in draining
-- mode. Hold the shared advisory and campaign-consistency locks for this whole
-- migration transaction, then fail closed unless every old writer is gone.
do $uid_protocol_preflight$
declare
  v_consistency public.softora_mailbox_campaign_consistency%rowtype;
  v_relevant_relations pg_catalog.oid[] := array[
    pg_catalog.to_regclass('public.softora_mailbox_campaign_consistency')::pg_catalog.oid,
    pg_catalog.to_regclass('public.softora_mailbox_sync_state')::pg_catalog.oid,
    pg_catalog.to_regclass('public.softora_mailbox_messages')::pg_catalog.oid,
    pg_catalog.to_regclass('public.softora_mailbox_uid_generations')::pg_catalog.oid,
    pg_catalog.to_regclass('public.softora_mailbox_uid_generation_staging')::pg_catalog.oid,
    pg_catalog.to_regclass('public.softora_mailbox_uid_generation_commits')::pg_catalog.oid
  ];
begin
  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  select consistency.* into v_consistency
  from public.softora_mailbox_campaign_consistency as consistency
  where consistency.scope = 'campaign'
  for update;

  if not found then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_FENCE_MISSING';
  end if;
  if v_consistency.uid_generation_protocol is distinct from 'draining'
    or v_consistency.uid_generation_drain_started_at is null
    or v_consistency.uid_generation_drain_ready_at is null then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_DRAIN_REQUIRED';
  end if;
  if v_consistency.uid_generation_drain_ready_at > pg_catalog.clock_timestamp() then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_DRAIN_NOT_READY';
  end if;
  if exists (
    select 1
    from public.softora_mailbox_sync_state as active_sync
    where active_sync.status = 'syncing'
      and nullif(pg_catalog.btrim(active_sync.lock_token), '') is not null
      and active_sync.lock_expires_at > pg_catalog.clock_timestamp()
  ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_ACTIVE_LEASES';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_locks as waiting_lock
    left join pg_catalog.pg_stat_activity as activity
      on activity.pid = waiting_lock.pid
    where waiting_lock.granted is false
      and waiting_lock.pid <> pg_catalog.pg_backend_pid()
      and (
        (
          waiting_lock.locktype = 'advisory'
          and waiting_lock.database = (
            select database.oid
            from pg_catalog.pg_database as database
            where database.datname = pg_catalog.current_database()
          )
          and waiting_lock.classid = 824031::pg_catalog.oid
          and waiting_lock.objid = 3::pg_catalog.oid
          and waiting_lock.objsubid = 2
        )
        or waiting_lock.relation = any (v_relevant_relations)
        or coalesce(activity.query, '') ilike '%softora_mailbox%'
      )
  ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_WAITING_WRITERS';
  end if;
end;
$uid_protocol_preflight$;

create table if not exists public.softora_mailbox_uid_generations (
  generation_id uuid primary key default pg_catalog.gen_random_uuid(),
  sync_key text not null,
  account_email text not null,
  folder text not null,
  uid_validity bigint not null,
  selection_policy text not null,
  selection_targets jsonb not null default '[]'::jsonb check (
    pg_catalog.jsonb_typeof(selection_targets) = 'array'
    and pg_catalog.jsonb_array_length(selection_targets) <= 2000
  ),
  selection_targets_digest text check (
    selection_targets_digest is null or selection_targets_digest ~ '^[a-f0-9]{64}$'
  ),
  selection_uid_manifest jsonb check (
    selection_uid_manifest is null or (
      pg_catalog.jsonb_typeof(selection_uid_manifest) = 'array'
      and pg_catalog.jsonb_array_length(selection_uid_manifest) <= 2000
    )
  ),
  selection_uid_manifest_digest text check (
    selection_uid_manifest_digest is null
      or selection_uid_manifest_digest ~ '^[a-f0-9]{64}$'
  ),
  status text not null check (
    status in ('staging', 'active', 'superseded', 'abandoned')
  ),
  scan_upper_uid bigint not null default 0 check (scan_upper_uid >= 0),
  scanned_through_uid bigint not null default 0 check (scanned_through_uid >= 0),
  selection_manifest_scanned_through_uid bigint not null default 0,
  selection_manifest_partial_uids jsonb not null default '[]'::jsonb,
  selection_manifest_seed_invalidated_at timestamptz,
  scan_complete boolean not null default false,
  snapshot_message_count integer check (snapshot_message_count >= 0),
  snapshot_digest text check (
    snapshot_digest is null or snapshot_digest ~ '^[a-f0-9]{64}$'
  ),
  created_at timestamptz not null default pg_catalog.now(),
  activated_at timestamptz,
  superseded_at timestamptz,
  abandoned_at timestamptz,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint softora_mailbox_uid_generations_uid_validity_check
    check (uid_validity between 1 and 4294967295),
  constraint softora_mailbox_uid_generations_identity_check check (
    sync_key = account_email || '|' || folder
    and account_email = pg_catalog.lower(pg_catalog.btrim(account_email))
    and folder = pg_catalog.lower(pg_catalog.btrim(folder))
    and account_email <> '' and folder <> ''
    and position('|' in account_email) = 0
    and position('|' in folder) = 0
    and pg_catalog.char_length(account_email) <= 320
    and pg_catalog.char_length(folder) <= 200
  ),
  constraint softora_mailbox_uid_generations_scan_check check (
    (
      selection_policy = 'targeted-sparse-v2'
      and scanned_through_uid <= coalesce(
        pg_catalog.jsonb_array_length(selection_uid_manifest), 0
      )
      and (
        not scan_complete
        or selection_uid_manifest is not null
          and scanned_through_uid = pg_catalog.jsonb_array_length(selection_uid_manifest)
      )
    ) or (
      selection_policy <> 'targeted-sparse-v2'
      and scanned_through_uid <= scan_upper_uid
      and (not scan_complete or scanned_through_uid = scan_upper_uid)
    )
  ),
  constraint softora_mailbox_uid_generations_manifest_scan_check check (
    selection_manifest_scanned_through_uid between 0 and scan_upper_uid
    and pg_catalog.jsonb_typeof(selection_manifest_partial_uids) = 'array'
    and pg_catalog.jsonb_array_length(selection_manifest_partial_uids) <= 2000
    and (
      selection_policy = 'targeted-sparse-v2'
      or selection_manifest_scanned_through_uid = 0
        and selection_manifest_partial_uids = '[]'::jsonb
    )
    and (
      selection_uid_manifest is null
      or selection_policy = 'targeted-sparse-v2'
        and selection_manifest_scanned_through_uid = scan_upper_uid
        and selection_manifest_partial_uids = selection_uid_manifest
    )
  ),
  constraint softora_mailbox_uid_generations_status_time_check check (
    (status = 'staging' and activated_at is null and superseded_at is null and abandoned_at is null)
    or (status = 'active' and activated_at is not null and superseded_at is null and abandoned_at is null)
    or (status = 'superseded' and activated_at is not null and superseded_at is not null and abandoned_at is null)
    or (status = 'abandoned' and activated_at is null and superseded_at is null and abandoned_at is not null)
  )
);

create unique index if not exists softora_mailbox_uid_generations_one_active_idx
  on public.softora_mailbox_uid_generations (sync_key)
  where status = 'active';
create unique index if not exists softora_mailbox_uid_generations_one_staging_idx
  on public.softora_mailbox_uid_generations (sync_key)
  where status = 'staging';
create index if not exists softora_mailbox_uid_generations_history_idx
  on public.softora_mailbox_uid_generations (sync_key, created_at desc, generation_id);

create table if not exists public.softora_mailbox_uid_generation_staging (
  generation_id uuid not null
    references public.softora_mailbox_uid_generations (generation_id)
    on update restrict on delete cascade,
  uid bigint not null check (uid > 0),
  row_data jsonb not null check (pg_catalog.jsonb_typeof(row_data) = 'object'),
  row_digest text not null check (row_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (generation_id, uid)
);

create table if not exists public.softora_mailbox_uid_generation_commits (
  commit_id text primary key check (
    pg_catalog.char_length(pg_catalog.btrim(commit_id)) between 1 and 200
    and commit_id = pg_catalog.btrim(commit_id)
  ),
  operation text not null check (
    operation in ('commit', 'fail', 'skip', 'checkpoint', 'invalidate')
  ),
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  sync_key text not null,
  generation_id uuid references public.softora_mailbox_uid_generations (generation_id)
    on update restrict on delete restrict,
  uid_validity bigint check (uid_validity is null or uid_validity between 1 and 4294967295),
  status text not null default 'pending' check (status in ('pending', 'completed')),
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  completed_at timestamptz,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint softora_mailbox_uid_generation_commits_completion_check check (
    (status = 'pending' and completed_at is null)
    or (status = 'completed' and completed_at is not null)
  )
);

create index if not exists softora_mailbox_uid_generation_commits_sync_idx
  on public.softora_mailbox_uid_generation_commits (sync_key, created_at desc);

alter table public.softora_mailbox_messages
  add column if not exists uid_generation_id uuid;
alter table public.softora_mailbox_sync_state
  add column if not exists active_uid_generation_id uuid;
alter table public.softora_mailbox_sync_state
  add column if not exists pending_uid_generation_id uuid;

alter table public.softora_mailbox_messages
  drop constraint if exists softora_mailbox_messages_account_email_folder_uid_key;
drop index if exists public.softora_mailbox_messages_generation_uid_key;
create unique index if not exists softora_mailbox_messages_uid_generation_uid_key
  on public.softora_mailbox_messages (uid_generation_id, uid)
  where uid_generation_id is not null;
create index if not exists softora_mailbox_messages_active_generation_idx
  on public.softora_mailbox_messages (account_email, folder, uid_generation_id, date desc)
  where generation_superseded_at is null;
create index if not exists softora_mailbox_sync_state_active_uid_generation_idx
  on public.softora_mailbox_sync_state (active_uid_generation_id)
  where active_uid_generation_id is not null;
create index if not exists softora_mailbox_sync_state_pending_uid_generation_idx
  on public.softora_mailbox_sync_state (pending_uid_generation_id)
  where pending_uid_generation_id is not null;

do $constraints$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'softora_mailbox_messages_uid_generation_id_fkey'
      and conrelid = 'public.softora_mailbox_messages'::pg_catalog.regclass
  ) then
    alter table public.softora_mailbox_messages
      add constraint softora_mailbox_messages_uid_generation_id_fkey
      foreign key (uid_generation_id)
      references public.softora_mailbox_uid_generations (generation_id)
      on update restrict on delete restrict not valid;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'softora_mailbox_sync_state_active_uid_generation_id_fkey'
      and conrelid = 'public.softora_mailbox_sync_state'::pg_catalog.regclass
  ) then
    alter table public.softora_mailbox_sync_state
      add constraint softora_mailbox_sync_state_active_uid_generation_id_fkey
      foreign key (active_uid_generation_id)
      references public.softora_mailbox_uid_generations (generation_id)
      on update restrict on delete restrict not valid;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'softora_mailbox_sync_state_pending_uid_generation_id_fkey'
      and conrelid = 'public.softora_mailbox_sync_state'::pg_catalog.regclass
  ) then
    alter table public.softora_mailbox_sync_state
      add constraint softora_mailbox_sync_state_pending_uid_generation_id_fkey
      foreign key (pending_uid_generation_id)
      references public.softora_mailbox_uid_generations (generation_id)
      on update restrict on delete restrict not valid;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'softora_mailbox_sync_state_uid_generation_distinct_check'
      and conrelid = 'public.softora_mailbox_sync_state'::pg_catalog.regclass
  ) then
    alter table public.softora_mailbox_sync_state
      add constraint softora_mailbox_sync_state_uid_generation_distinct_check
      check (
        active_uid_generation_id is null
        or pending_uid_generation_id is null
        or active_uid_generation_id <> pending_uid_generation_id
      ) not valid;
  end if;
end;
$constraints$;

-- Permit exactly one legacy/v1 identity adoption into a UUID generation while
-- continuing to reject account, folder, UID and provider identity rewrites.
create or replace function public.softora_enforce_mailbox_message_identity_immutable()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_account_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(old.account_email, '')));
  v_folder text := pg_catalog.lower(pg_catalog.btrim(coalesce(old.folder, '')));
  v_uuid_adoption boolean := false;
begin
  v_uuid_adoption :=
    coalesce(pg_catalog.current_setting(
      'softora.mailbox_uid_generation_v2_transition', true
    ), '') = '1'
    and old.uid_generation_id is null
    and new.uid_generation_id is not null
    and new.uid_validity between 1 and 4294967295
    and pg_catalog.lower(pg_catalog.btrim(new.account_email)) = v_account_email
    and pg_catalog.lower(pg_catalog.btrim(new.folder)) = v_folder
    and new.uid is not distinct from old.uid
    and new.provider_id is not distinct from old.provider_id
    and old.message_key = any(array[
      v_account_email || '|' || v_folder || '|' || old.uid::text,
      v_account_email || '|' || v_folder || '|uv:'
        || coalesce(old.uid_validity::text, '') || '|' || old.uid::text
    ]::text[])
    and new.message_key = v_account_email || '|' || v_folder || '|gen:'
      || new.uid_generation_id::text || '|' || old.uid::text;

  if old.message_key is distinct from new.message_key
    or pg_catalog.lower(pg_catalog.btrim(old.account_email))
      is distinct from pg_catalog.lower(pg_catalog.btrim(new.account_email))
    or pg_catalog.lower(pg_catalog.btrim(old.folder))
      is distinct from pg_catalog.lower(pg_catalog.btrim(new.folder))
    or old.uid is distinct from new.uid
    or old.uid_validity is distinct from new.uid_validity
    or old.uid_generation_id is distinct from new.uid_generation_id
    or old.provider_id is distinct from new.provider_id then
    if not v_uuid_adoption then
      raise exception using errcode = '23505',
        message = 'Bestaande mailboxidentiteit mag niet van account of provider wisselen';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.softora_confirm_mailbox_uid_baseline_v2(
  p_sync_key text,
  p_lock_token text,
  p_generation_id uuid,
  p_uid_validity bigint,
  p_evidence jsonb
)
returns table (
  confirmed boolean,
  lock_lost boolean,
  active_generation_id uuid,
  current_uid_validity bigint,
  resume_after_uid bigint,
  adopted_count integer
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_sync_key text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_sync_key, '')));
  v_lock_token text := pg_catalog.btrim(coalesce(p_lock_token, ''));
  v_sync public.softora_mailbox_sync_state%rowtype;
  v_generation public.softora_mailbox_uid_generations%rowtype;
  v_evidence_count integer := 0;
  v_legacy_count integer := 0;
  v_adopted integer := 0;
  v_snapshot jsonb := '[]'::jsonb;
  v_digest text;
begin
  if v_sync_key = '' or pg_catalog.char_length(v_sync_key) > 600
    or v_lock_token = '' or pg_catalog.char_length(v_lock_token) > 200
    or p_generation_id is null
    or coalesce(p_uid_validity, 0) not between 1 and 4294967295
    or pg_catalog.jsonb_typeof(p_evidence) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_evidence) > 100000 then
    raise exception using errcode = '22023', message = 'MAILBOX_UID_BASELINE_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  perform 1 from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  if not found then
    raise exception using errcode = '55000', message = 'MAILBOX_CAMPAIGN_FENCE_MISSING';
  end if;

  select state.* into v_sync
  from public.softora_mailbox_sync_state as state
  where state.sync_key = v_sync_key
  for update;
  if not found or v_sync.status <> 'syncing'
    or v_sync.lock_token is distinct from v_lock_token
    or v_sync.lock_expires_at is null
    or v_sync.lock_expires_at <= pg_catalog.clock_timestamp() then
    return query select false, true, v_sync.active_uid_generation_id,
      v_sync.uid_validity, 0::bigint, 0;
    return;
  end if;

  select generation.* into v_generation
  from public.softora_mailbox_uid_generations as generation
  where generation.generation_id = p_generation_id
  for update;
  if not found or v_generation.sync_key is distinct from v_sync.sync_key
    or v_generation.uid_validity is distinct from p_uid_validity then
    raise exception using errcode = '55000', message = 'MAILBOX_UID_BASELINE_GENERATION_INVALID';
  end if;

  -- Lost-response replay: adoption keeps this lease alive for the following
  -- steady commit, so the same proof can be repeated without rewriting rows.
  if v_sync.active_uid_generation_id = p_generation_id
    and v_sync.pending_uid_generation_id is null
    and v_sync.uid_validity = p_uid_validity
    and v_generation.status = 'active' then
    return query select true, false, p_generation_id, p_uid_validity,
      0::bigint, coalesce(v_generation.snapshot_message_count, 0);
    return;
  end if;

  if v_sync.uid_validity is not null
    or v_sync.active_uid_generation_id is not null
    or v_sync.pending_uid_generation_id is distinct from p_generation_id
    or v_generation.status <> 'staging'
    or v_generation.selection_policy <> 'staged-rebuild-v2' then
    return query select false, false, v_sync.active_uid_generation_id,
      v_sync.uid_validity, 0::bigint, 0;
    return;
  end if;

  -- Evidence is deliberately strict: canonical Message-ID spelling, positive
  -- unique UID and one object for every currently visible legacy row.
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_evidence) as evidence(row_data)
    where pg_catalog.jsonb_typeof(evidence.row_data) is distinct from 'object'
      or (case
        when coalesce(evidence.row_data->>'uid', '') ~ '^[0-9]+$'
          then (evidence.row_data->>'uid')::numeric between 1 and 9223372036854775807
        else false
      end) is not true
      or public.softora_normalize_mailbox_message_id(
        evidence.row_data->>'messageId'
      ) is null
      or evidence.row_data->>'messageId' is distinct from
        public.softora_normalize_mailbox_message_id(evidence.row_data->>'messageId')
  ) then
    return query select false, false, null::uuid, null::bigint, 0::bigint, 0;
    return;
  end if;

  select pg_catalog.count(*)::integer,
    coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'uid', (evidence.row_data->>'uid')::bigint,
        'messageId', evidence.row_data->>'messageId'
      ) order by (evidence.row_data->>'uid')::bigint
    ), '[]'::jsonb)
  into v_evidence_count, v_snapshot
  from pg_catalog.jsonb_array_elements(p_evidence) as evidence(row_data);

  if v_evidence_count <> (
    select pg_catalog.count(distinct (evidence.row_data->>'uid')::bigint)::integer
    from pg_catalog.jsonb_array_elements(p_evidence) as evidence(row_data)
  ) then
    return query select false, false, null::uuid, null::bigint, 0::bigint, 0;
    return;
  end if;

  select pg_catalog.count(*)::integer into v_legacy_count
  from public.softora_mailbox_messages as message
  where message.account_email = v_sync.account_email
    and message.folder = v_sync.folder
    and message.uid_validity is null
    and message.uid_generation_id is null
    and message.generation_superseded_at is null
    and message.deleted_at is null;

  if exists (
    select 1 from public.softora_mailbox_messages as message
    where message.account_email = v_sync.account_email
      and message.folder = v_sync.folder
      and message.generation_superseded_at is null
      and message.deleted_at is null
      and not (
        message.uid_validity is null and message.uid_generation_id is null
      )
  ) then
    return query select false, false, null::uuid, null::bigint, 0::bigint, 0;
    return;
  end if;

  if v_legacy_count <> v_evidence_count or exists (
    with evidence as (
      select (entry.row_data->>'uid')::bigint as uid,
        entry.row_data->>'messageId' as message_id
      from pg_catalog.jsonb_array_elements(p_evidence) as entry(row_data)
    ), legacy as (
      select message.message_key, message.uid,
        public.softora_normalize_mailbox_message_id(message.message_id) as message_id
      from public.softora_mailbox_messages as message
      where message.account_email = v_sync.account_email
        and message.folder = v_sync.folder
        and message.uid_validity is null
        and message.uid_generation_id is null
        and message.generation_superseded_at is null
        and message.deleted_at is null
    )
    select 1
    from legacy full join evidence using (uid)
    where legacy.message_key is null
      or evidence.uid is null
      or legacy.message_id is null
      or legacy.message_id is distinct from evidence.message_id
  ) then
    return query select false, false, null::uuid, null::bigint, 0::bigint, 0;
    return;
  end if;

  v_digest := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_snapshot::text, 'UTF8'), 'sha256'),
    'hex'
  );

  perform pg_catalog.set_config(
    'softora.mailbox_uid_generation_v2_transition', '1', true
  );

  update public.softora_mailbox_messages as message
  set uid_validity = p_uid_validity,
      uid_generation_id = p_generation_id,
      message_key = v_sync.account_email || '|' || v_sync.folder || '|gen:'
        || p_generation_id::text || '|' || message.uid::text,
      updated_at = pg_catalog.clock_timestamp()
  where message.account_email = v_sync.account_email
    and message.folder = v_sync.folder
    and message.uid_validity is null
    and message.uid_generation_id is null
    and message.generation_superseded_at is null
    and message.deleted_at is null;
  get diagnostics v_adopted = row_count;
  if v_adopted <> v_legacy_count then
    raise exception using errcode = '40001', message = 'MAILBOX_UID_BASELINE_CHANGED';
  end if;

  -- Hidden legacy rows were intentionally excluded from baseline evidence.
  -- Retire them atomically so a later restore cannot resurrect a generation-
  -- less duplicate beside the newly active UUID generation.
  update public.softora_mailbox_messages as hidden_legacy
  set generation_superseded_at = coalesce(
        hidden_legacy.generation_superseded_at, pg_catalog.clock_timestamp()
      ),
      deleted_at = coalesce(hidden_legacy.deleted_at, pg_catalog.clock_timestamp()),
      updated_at = pg_catalog.clock_timestamp()
  where hidden_legacy.account_email = v_sync.account_email
    and hidden_legacy.folder = v_sync.folder
    and hidden_legacy.uid_validity is null
    and hidden_legacy.uid_generation_id is null
    and hidden_legacy.generation_superseded_at is null;

  update public.softora_mailbox_uid_generations as generation
  set status = 'active', scan_complete = true,
      scanned_through_uid = generation.scan_upper_uid,
      snapshot_message_count = v_adopted,
      snapshot_digest = v_digest,
      activated_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where generation.generation_id = p_generation_id;

  update public.softora_mailbox_sync_state as state
  set active_uid_generation_id = p_generation_id,
      pending_uid_generation_id = null,
      uid_validity = p_uid_validity,
      -- The legacy rows prove their own identities, not that the IMAP server
      -- contains no additional UIDs. Resume from zero so every extra server
      -- row is fetched without hiding the safely adopted visible baseline.
      last_uid = 0,
      updated_at = pg_catalog.clock_timestamp()
  where state.sync_key = v_sync.sync_key;

  return query select true, false, p_generation_id, p_uid_validity,
    0::bigint, v_adopted;
end;
$function$;

-- Every IMAP row for an existing sync-state is accepted only inside a fenced
-- v2 transition. Provider rows without any sync-state retain their legacy path.
create or replace function public.softora_coerce_mailbox_uid_generation()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_account_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(new.account_email, '')));
  v_folder text := pg_catalog.lower(pg_catalog.btrim(coalesce(new.folder, '')));
  v_sync public.softora_mailbox_sync_state%rowtype;
  v_generation public.softora_mailbox_uid_generations%rowtype;
begin
  if v_account_email = '' or pg_catalog.char_length(v_account_email) > 320
    or v_folder = '' or pg_catalog.char_length(v_folder) > 200
    or position('|' in v_account_email) > 0
    or position('|' in v_folder) > 0 then
    raise exception using errcode = '22023', message = 'MAILBOX_UIDVALIDITY_INVALID';
  end if;

  select sync_state.* into v_sync
  from public.softora_mailbox_sync_state as sync_state
  where sync_state.sync_key = v_account_email || '|' || v_folder;

  if new.uid_generation_id is not null then
    select generation.* into v_generation
    from public.softora_mailbox_uid_generations as generation
    where generation.generation_id = new.uid_generation_id;
    if coalesce(pg_catalog.current_setting(
        'softora.mailbox_uid_generation_v2_transition', true
      ), '') <> '1'
      or coalesce(new.uid, 0) <= 0
      or not found
      or v_generation.sync_key is distinct from v_account_email || '|' || v_folder
      or v_generation.uid_validity is distinct from new.uid_validity
      or v_generation.status not in ('staging', 'active')
      or v_sync.sync_key is null
      or new.uid_generation_id is distinct from v_sync.active_uid_generation_id
        and new.uid_generation_id is distinct from v_sync.pending_uid_generation_id then
      raise exception using errcode = '55000', message = 'MAILBOX_UID_GENERATION_STALE';
    end if;
    new.account_email := v_account_email;
    new.folder := v_folder;
    new.uid_validity := v_generation.uid_validity;
    new.message_key := v_account_email || '|' || v_folder || '|gen:'
      || v_generation.generation_id::text || '|' || new.uid::text;
    return new;
  end if;

  if v_sync.sync_key is not null then
    raise exception using errcode = '55000', message = 'MAILBOX_UID_GENERATION_REQUIRED';
  end if;
  return new;
end;
$function$;

-- Backfill every known UIDVALIDITY state, including empty folders, with one
-- active UUID epoch. NULL states and legacy rows intentionally stay untouched.
create or replace function public.softora_guard_mailbox_uid_generation_v2_state()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  if coalesce(pg_catalog.current_setting(
      'softora.mailbox_uid_generation_v2_transition', true
    ), '') <> '1'
    and (
      old.uid_validity is distinct from new.uid_validity
      or old.active_uid_generation_id is distinct from new.active_uid_generation_id
      or old.pending_uid_generation_id is distinct from new.pending_uid_generation_id
    ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_GENERATION_V2_TRANSITION_REQUIRED';
  end if;
  return new;
end;
$function$;

drop trigger if exists softora_guard_mailbox_uid_generation_v2_state
  on public.softora_mailbox_sync_state;
create trigger softora_guard_mailbox_uid_generation_v2_state
before update of uid_validity, active_uid_generation_id, pending_uid_generation_id
on public.softora_mailbox_sync_state
for each row execute function public.softora_guard_mailbox_uid_generation_v2_state();

select pg_catalog.set_config(
  'softora.mailbox_uid_generation_v2_transition', '1', true
);
insert into public.softora_mailbox_uid_generations (
  generation_id, sync_key, account_email, folder, uid_validity,
  selection_policy, status, scan_upper_uid, scanned_through_uid,
  scan_complete, snapshot_message_count, activated_at, updated_at
)
select
  pg_catalog.gen_random_uuid(), state.sync_key,
  pg_catalog.lower(pg_catalog.btrim(state.account_email)),
  pg_catalog.lower(pg_catalog.btrim(state.folder)), state.uid_validity,
  'backfill-v2', 'active', greatest(coalesce(state.last_uid, 0), 0),
  greatest(coalesce(state.last_uid, 0), 0), true,
  greatest(coalesce(state.message_count, 0), 0), pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp()
from public.softora_mailbox_sync_state as state
where state.uid_validity is not null
  and state.active_uid_generation_id is null
  and not exists (
    select 1 from public.softora_mailbox_uid_generations as generation
    where generation.sync_key = state.sync_key and generation.status = 'active'
  );

update public.softora_mailbox_sync_state as state
set active_uid_generation_id = generation.generation_id,
    updated_at = pg_catalog.clock_timestamp()
from public.softora_mailbox_uid_generations as generation
where state.uid_validity is not null
  and state.active_uid_generation_id is null
  and generation.sync_key = state.sync_key
  and generation.uid_validity = state.uid_validity
  and generation.status = 'active';

update public.softora_mailbox_messages as message
set uid_generation_id = state.active_uid_generation_id,
    message_key = state.account_email || '|' || state.folder || '|gen:'
      || state.active_uid_generation_id::text || '|' || message.uid::text,
    updated_at = pg_catalog.clock_timestamp()
from public.softora_mailbox_sync_state as state
where state.active_uid_generation_id is not null
  and message.account_email = state.account_email
  and message.folder = state.folder
  and message.uid_validity = state.uid_validity
  and message.uid_generation_id is null
  and message.generation_superseded_at is null;

alter table public.softora_mailbox_messages
  validate constraint softora_mailbox_messages_uid_generation_id_fkey;
alter table public.softora_mailbox_sync_state
  validate constraint softora_mailbox_sync_state_active_uid_generation_id_fkey;
alter table public.softora_mailbox_sync_state
  validate constraint softora_mailbox_sync_state_pending_uid_generation_id_fkey;
alter table public.softora_mailbox_sync_state
  validate constraint softora_mailbox_sync_state_uid_generation_distinct_check;

-- A mailbox-state mutation may target only the currently visible generation.
-- This is essential when a provider later reuses both UIDVALIDITY and UID:
-- superseded A/B rows must never win the UID/provider lookup for a new A epoch.
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
as $function$
declare
  v_row public.softora_mailbox_messages%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if pg_catalog.char_length(pg_catalog.btrim(coalesce(p_account_email, ''))) < 3
    or pg_catalog.char_length(pg_catalog.btrim(coalesce(p_folder, ''))) < 1
    or pg_catalog.char_length(pg_catalog.btrim(coalesce(p_mutation_key, ''))) <> 64
    or pg_catalog.btrim(coalesce(p_mutation_key, '')) !~ '^[a-f0-9]{64}$'
    or coalesce(p_revision, 0) < 1
    or (coalesce(p_uid, 0) < 1
      and pg_catalog.char_length(pg_catalog.btrim(coalesce(p_provider_id, ''))) < 1) then
    raise exception using errcode = '22023',
      message = 'Ongeldige mailbox-state-mutatie';
  end if;

  -- Keep the production write order campaign -> message. Generation commits
  -- use the same global fence, so a state mutation can never land on the old
  -- row after its UI state was copied into a newly activated generation.
  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  perform 1 from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'MAILBOX_CAMPAIGN_FENCE_MISSING';
  end if;

  select message.*
  into v_row
  from public.softora_mailbox_messages as message
  where pg_catalog.lower(pg_catalog.btrim(message.account_email))
      = pg_catalog.lower(pg_catalog.btrim(p_account_email))
    and pg_catalog.lower(pg_catalog.btrim(message.folder))
      = pg_catalog.lower(pg_catalog.btrim(p_folder))
    and message.generation_superseded_at is null
    and message.deleted_at is null
    and (
      (coalesce(p_uid, 0) > 0 and message.uid = p_uid)
      or (coalesce(p_uid, 0) < 1
        and message.provider_id = pg_catalog.btrim(p_provider_id))
    )
  order by message.updated_at desc, message.message_key
  limit 1
  for update;

  if not found then
    raise exception using errcode = 'P0002',
      message = 'Mailboxbericht niet gevonden';
  end if;

  if v_row.state_revision > p_revision
    or (v_row.state_revision = p_revision
      and v_row.state_mutation_key is distinct from pg_catalog.btrim(p_mutation_key)) then
    return query select v_row.message_key, false, false, true,
      v_row.state_revision, v_row.state_mutation_key,
      v_row.unread, v_row.softora_read_at, v_row.reply_dismissed_at;
    return;
  end if;

  if v_row.state_revision = p_revision
    and v_row.state_mutation_key = pg_catalog.btrim(p_mutation_key) then
    return query select v_row.message_key, false, true, false,
      v_row.state_revision, v_row.state_mutation_key,
      v_row.unread, v_row.softora_read_at, v_row.reply_dismissed_at;
    return;
  end if;

  update public.softora_mailbox_messages as message
  set unread = coalesce(p_unread, false),
      softora_read_at = case
        when coalesce(p_unread, false) then null
        else coalesce(message.softora_read_at, v_now)
      end,
      reply_dismissed_at = case
        when coalesce(p_dismiss_reply, false)
          then coalesce(message.reply_dismissed_at, v_now)
        when coalesce(p_unread, false) then null
        else message.reply_dismissed_at
      end,
      state_revision = p_revision,
      state_mutation_key = pg_catalog.btrim(p_mutation_key),
      state_mutation_at = v_now,
      updated_at = v_now
  where message.message_key = v_row.message_key
  returning message.* into v_row;

  return query select v_row.message_key, true, false, false,
    v_row.state_revision, v_row.state_mutation_key,
    v_row.unread, v_row.softora_read_at, v_row.reply_dismissed_at;
end;
$function$;

create or replace function public.softora_mailbox_header_contains_message_id(
  p_value text,
  p_target text
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select public.softora_normalize_mailbox_message_id(p_target) is not null
    and exists (
      select 1
      from pg_catalog.regexp_split_to_table(
        coalesce(p_value, ''), '[[:space:],]+'
      ) as token(value)
      where public.softora_normalize_mailbox_message_id(token.value)
        = public.softora_normalize_mailbox_message_id(p_target)
    );
$function$;

create or replace function public.softora_mailbox_row_matches_target_references(
  p_row jsonb,
  p_target_reference_ids jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(coalesce(p_row, '{}'::jsonb)) = 'object'
    and pg_catalog.jsonb_typeof(coalesce(p_target_reference_ids, 'null'::jsonb)) = 'array'
    and exists (
      select 1
      from pg_catalog.jsonb_array_elements_text(p_target_reference_ids)
        as target(reference_id)
      where public.softora_normalize_mailbox_message_id(p_row->>'message_id')
          = target.reference_id
        or public.softora_normalize_mailbox_message_id(p_row->>'in_reply_to')
          = target.reference_id
        or public.softora_mailbox_header_contains_message_id(
          p_row->>'references_text', target.reference_id
        )
    );
$function$;

create or replace function public.softora_mailbox_target_references_are_anchored(
  p_account_email text,
  p_target_reference_ids jsonb
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  with target_references as materialized (
    select target.reference_id,
      public.softora_normalize_mailbox_message_id(target.reference_id)
        as normalized_reference_id
    from pg_catalog.jsonb_array_elements_text(
      case
        when pg_catalog.jsonb_typeof(
          coalesce(p_target_reference_ids, 'null'::jsonb)
        ) = 'array' then p_target_reference_ids
        else '[]'::jsonb
      end
    ) as target(reference_id)
  ),
  anchor_rows as materialized (
    select anchor.message_id, anchor.in_reply_to, anchor.references_text
    from public.softora_mailbox_messages as anchor
    where anchor.account_email = pg_catalog.lower(pg_catalog.btrim(p_account_email))
      and anchor.folder = any (array['inbox', 'sent', 'coldmail']::text[])
      and anchor.generation_superseded_at is null
      and anchor.deleted_at is null
      and public.softora_is_campaign_mailbox_message(
        anchor.account_email, anchor.folder, anchor.payload
      )
  ),
  direct_anchor_references as materialized (
    select public.softora_normalize_mailbox_message_id(anchor.message_id)
      as reference_id
    from anchor_rows as anchor
    where public.softora_normalize_mailbox_message_id(anchor.message_id) is not null
    union
    select public.softora_normalize_mailbox_message_id(anchor.in_reply_to)
      as reference_id
    from anchor_rows as anchor
    where public.softora_normalize_mailbox_message_id(anchor.in_reply_to) is not null
  ),
  header_anchor_references as materialized (
    select public.softora_normalize_mailbox_message_id(token.value)
      as reference_id
    from anchor_rows as anchor
    cross join lateral pg_catalog.regexp_split_to_table(
      coalesce(anchor.references_text, ''), '[[:space:],]+'
    ) as token(value)
    where public.softora_normalize_mailbox_message_id(token.value) is not null
  ),
  matched_targets as materialized (
    select target.reference_id
    from target_references as target
    join direct_anchor_references as anchor
      on anchor.reference_id = target.reference_id
    union
    select target.reference_id
    from target_references as target
    join header_anchor_references as anchor
      on anchor.reference_id = target.normalized_reference_id
  )
  select pg_catalog.jsonb_typeof(
      coalesce(p_target_reference_ids, 'null'::jsonb)
    ) = 'array'
    and not exists (
      select target.reference_id
      from target_references as target
      except
      select matched.reference_id
      from matched_targets as matched
    );
$function$;

create or replace function public.softora_freeze_legacy_mailbox_target_manifest()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  if new.selection_policy = 'targeted-sparse-v2'
    and old.selection_uid_manifest is null
    and new.selection_uid_manifest is not null then
    if old.selection_manifest_scanned_through_uid = 0
      and old.selection_manifest_partial_uids = '[]'::jsonb then
      new.selection_manifest_scanned_through_uid := new.scan_upper_uid;
      new.selection_manifest_partial_uids := new.selection_uid_manifest;
    elsif new.selection_manifest_scanned_through_uid < new.scan_upper_uid then
      raise exception using errcode = '55000',
        message = 'MAILBOX_UID_TARGET_MANIFEST_CHECKPOINT_REQUIRED';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists softora_freeze_legacy_mailbox_target_manifest_trigger
  on public.softora_mailbox_uid_generations;
create trigger softora_freeze_legacy_mailbox_target_manifest_trigger
before update of selection_uid_manifest
on public.softora_mailbox_uid_generations
for each row execute function public.softora_freeze_legacy_mailbox_target_manifest();

create or replace function public.softora_prepare_mailbox_uid_generation_v3(
  p_sync_key text,
  p_lock_token text,
  p_uid_validity bigint,
  p_uid_next bigint,
  p_selection_policy text,
  p_selection_targets jsonb
)
returns table (
  prepared boolean,
  lock_lost boolean,
  mode text,
  reset_detected boolean,
  resumed boolean,
  active_generation_id uuid,
  target_generation_id uuid,
  current_uid_validity bigint,
  observed_uid_validity bigint,
  scan_upper_uid bigint,
  scanned_through_uid bigint,
  lease_expires_at timestamptz,
  selection_targets jsonb,
  selection_manifest_scanned_through_uid bigint,
  target_uid_manifest jsonb,
  target_manifest_complete boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_sync_key text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_sync_key, '')));
  v_lock_token text := pg_catalog.btrim(coalesce(p_lock_token, ''));
  v_scan_upper bigint := greatest(coalesce(p_uid_next, 0) - 1, 0);
  v_target_digest text;
  v_sync public.softora_mailbox_sync_state%rowtype;
  v_active public.softora_mailbox_uid_generations%rowtype;
  v_pending public.softora_mailbox_uid_generations%rowtype;
  v_target public.softora_mailbox_uid_generations%rowtype;
  v_seed_cursor bigint := 0;
  v_seed_manifest jsonb := '[]'::jsonb;
  v_reset boolean := false;
begin
  if v_sync_key = '' or pg_catalog.char_length(v_sync_key) > 600
    or v_lock_token = '' or pg_catalog.char_length(v_lock_token) > 200
    or coalesce(p_uid_validity, 0) not between 1 and 4294967295
    or coalesce(p_uid_next, 0) not between 1 and 9223372036854775807
    or p_selection_policy not in ('staged-rebuild-v2', 'targeted-sparse-v2')
    or pg_catalog.jsonb_typeof(coalesce(p_selection_targets, 'null'::jsonb))
      is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_selection_targets) > 2000
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_selection_targets) as target(value)
      where pg_catalog.jsonb_typeof(target.value) is distinct from 'string'
        or public.softora_normalize_mailbox_message_id(target.value #>> '{}') is null
        or target.value #>> '{}' is distinct from
          public.softora_normalize_mailbox_message_id(target.value #>> '{}')
    )
    or pg_catalog.jsonb_array_length(p_selection_targets) <> (
      select pg_catalog.count(distinct target.value #>> '{}')::integer
      from pg_catalog.jsonb_array_elements(p_selection_targets) as target(value)
    )
    or p_selection_targets is distinct from (
      select coalesce(pg_catalog.jsonb_agg(target.value #>> '{}'
        order by pg_catalog.convert_to(target.value #>> '{}', 'UTF8')), '[]'::jsonb)
      from pg_catalog.jsonb_array_elements(p_selection_targets) as target(value)
    )
    or (p_selection_policy = 'staged-rebuild-v2'
      and pg_catalog.jsonb_array_length(p_selection_targets) <> 0)
    then
    raise exception using errcode = '22023', message = 'MAILBOX_UID_GENERATION_PREPARE_INVALID';
  end if;

  v_target_digest := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(p_selection_targets::text, 'UTF8'), 'sha256'
  ), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  perform 1 from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  if not found then
    raise exception using errcode = '55000', message = 'MAILBOX_CAMPAIGN_FENCE_MISSING';
  end if;

  select state.* into v_sync
  from public.softora_mailbox_sync_state as state
  where state.sync_key = v_sync_key
  for update;
  if not found or v_sync.status <> 'syncing'
    or v_sync.lock_token is distinct from v_lock_token
    or v_sync.lock_expires_at is null
    or v_sync.lock_expires_at <= pg_catalog.clock_timestamp() then
    return query select false, true, null::text, false, false,
      v_sync.active_uid_generation_id, null::uuid, v_sync.uid_validity,
      p_uid_validity, v_scan_upper, 0::bigint, v_sync.lock_expires_at,
      p_selection_targets, 0::bigint, '[]'::jsonb, false;
    return;
  end if;

  if v_sync.folder = 'allmail'
    and p_selection_policy <> 'targeted-sparse-v2' then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_ALLMAIL_SELECTION_POLICY_REQUIRED';
  end if;

  if p_selection_policy = 'targeted-sparse-v2' and (
    v_sync.folder <> 'allmail'
    or not public.softora_is_campaign_mailbox_message(
      v_sync.account_email, 'inbox', '{}'::jsonb
    )
    or not public.softora_mailbox_target_references_are_anchored(
      v_sync.account_email, p_selection_targets
    )
  ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_REFERENCES_UNANCHORED';
  end if;

  if v_sync.active_uid_generation_id is not null then
    select generation.* into v_active
    from public.softora_mailbox_uid_generations as generation
    where generation.generation_id = v_sync.active_uid_generation_id
    for update;
    if not found or v_active.sync_key is distinct from v_sync.sync_key
      or v_active.status <> 'active'
      or v_active.uid_validity is distinct from v_sync.uid_validity then
      raise exception using errcode = '55000', message = 'MAILBOX_UID_GENERATION_ACTIVE_INCONSISTENT';
    end if;
  elsif v_sync.uid_validity is not null then
    raise exception using errcode = '55000', message = 'MAILBOX_UID_GENERATION_ACTIVE_MISSING';
  end if;

  if v_sync.pending_uid_generation_id is not null then
    select generation.* into v_pending
    from public.softora_mailbox_uid_generations as generation
    where generation.generation_id = v_sync.pending_uid_generation_id
    for update;
    if not found or v_pending.sync_key is distinct from v_sync.sync_key
      or v_pending.status <> 'staging' then
      raise exception using errcode = '55000', message = 'MAILBOX_UID_GENERATION_PENDING_INCONSISTENT';
    end if;
  end if;

  perform pg_catalog.set_config(
    'softora.mailbox_uid_generation_v2_transition', '1', true
  );

  if v_active.generation_id is not null
    and v_active.uid_validity = p_uid_validity
    and v_pending.generation_id is null
    and (
      p_selection_policy = 'staged-rebuild-v2'
        and v_scan_upper >= greatest(coalesce(v_sync.last_uid, 0), 0)
      or p_selection_policy = 'targeted-sparse-v2'
        and v_active.selection_policy = 'targeted-sparse-v2'
        and v_active.selection_targets_digest = v_target_digest
        and v_active.selection_targets = p_selection_targets
        and v_active.scan_upper_uid = v_scan_upper
        and v_active.selection_manifest_scanned_through_uid = v_scan_upper
        and v_active.selection_uid_manifest is not null
        and v_active.selection_manifest_seed_invalidated_at is null
        and v_active.scan_complete
    ) then
    return query select true, false, 'steady'::text, false, false,
      v_active.generation_id, v_active.generation_id, v_active.uid_validity,
      p_uid_validity, v_scan_upper,
      case when p_selection_policy = 'targeted-sparse-v2'
        then 0::bigint else greatest(coalesce(v_sync.last_uid, 0), 0) end,
      v_sync.lock_expires_at, p_selection_targets,
      case when p_selection_policy = 'targeted-sparse-v2'
        then v_active.selection_manifest_scanned_through_uid else 0::bigint end,
      case when p_selection_policy = 'targeted-sparse-v2'
        then v_active.selection_uid_manifest else '[]'::jsonb end,
      p_selection_policy = 'targeted-sparse-v2';
    return;
  end if;

  v_reset := v_active.generation_id is not null;
  if v_pending.generation_id is not null
    and v_pending.uid_validity = p_uid_validity
    and v_pending.selection_policy = p_selection_policy
    and v_pending.scan_upper_uid <= v_scan_upper
    and (
      p_selection_policy = 'targeted-sparse-v2'
      or v_pending.selection_targets_digest = v_target_digest
        and v_pending.selection_targets = p_selection_targets
    ) then
    v_target := v_pending;
    return query select true, false, 'rebuild'::text, v_reset, true,
      v_active.generation_id, v_target.generation_id, v_active.uid_validity,
      p_uid_validity, v_target.scan_upper_uid, v_target.scanned_through_uid,
      v_sync.lock_expires_at, v_target.selection_targets,
      case when p_selection_policy = 'targeted-sparse-v2'
        then v_target.selection_manifest_scanned_through_uid else 0::bigint end,
      case when p_selection_policy = 'targeted-sparse-v2'
        then coalesce(v_target.selection_uid_manifest,
          v_target.selection_manifest_partial_uids, '[]'::jsonb)
        else '[]'::jsonb end,
      p_selection_policy = 'targeted-sparse-v2'
        and v_target.selection_uid_manifest is not null
        and v_target.selection_manifest_scanned_through_uid = v_target.scan_upper_uid;
    return;
  end if;

  if v_pending.generation_id is not null then
    delete from public.softora_mailbox_uid_generation_staging as staged
    where staged.generation_id = v_pending.generation_id;
    update public.softora_mailbox_uid_generations as generation
    set status = 'abandoned', abandoned_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where generation.generation_id = v_pending.generation_id;
  end if;

  if p_selection_policy = 'targeted-sparse-v2'
    and v_active.generation_id is not null
    and v_active.uid_validity = p_uid_validity
    and v_active.selection_policy = 'targeted-sparse-v2'
    and v_active.selection_targets_digest = v_target_digest
    and v_active.selection_targets = p_selection_targets
    and v_active.selection_uid_manifest is not null
    and v_active.selection_manifest_scanned_through_uid = v_active.scan_upper_uid
    and v_active.selection_manifest_seed_invalidated_at is null
    and v_active.scan_upper_uid <= v_scan_upper then
    v_seed_cursor := v_active.scan_upper_uid;
    v_seed_manifest := v_active.selection_uid_manifest;
  end if;

  insert into public.softora_mailbox_uid_generations (
    generation_id, sync_key, account_email, folder, uid_validity,
    selection_policy, selection_targets, selection_targets_digest,
    selection_manifest_scanned_through_uid,
    selection_manifest_partial_uids,
    status, scan_upper_uid, scanned_through_uid,
    scan_complete, updated_at
  ) values (
    pg_catalog.gen_random_uuid(), v_sync.sync_key, v_sync.account_email,
    v_sync.folder, p_uid_validity, p_selection_policy, p_selection_targets,
    v_target_digest,
    case when p_selection_policy = 'targeted-sparse-v2'
      then v_seed_cursor else 0 end,
    case when p_selection_policy = 'targeted-sparse-v2'
      then v_seed_manifest else '[]'::jsonb end,
    'staging', v_scan_upper, 0, false, pg_catalog.clock_timestamp()
  ) returning * into v_target;

  update public.softora_mailbox_sync_state as state
  set pending_uid_generation_id = v_target.generation_id,
      updated_at = pg_catalog.clock_timestamp()
  where state.sync_key = v_sync.sync_key;

  return query select true, false, 'rebuild'::text, v_reset, false,
    v_active.generation_id, v_target.generation_id, v_active.uid_validity,
    p_uid_validity, v_target.scan_upper_uid, v_target.scanned_through_uid,
    v_sync.lock_expires_at, v_target.selection_targets,
    case when p_selection_policy = 'targeted-sparse-v2'
      then v_target.selection_manifest_scanned_through_uid else 0::bigint end,
    case when p_selection_policy = 'targeted-sparse-v2'
      then v_target.selection_manifest_partial_uids else '[]'::jsonb end,
    p_selection_policy = 'targeted-sparse-v2'
      and v_target.selection_uid_manifest is not null
      and v_target.selection_manifest_scanned_through_uid = v_target.scan_upper_uid;
end;
$function$;

create or replace function public.softora_prepare_mailbox_uid_generation_v2(
  p_sync_key text,
  p_lock_token text,
  p_uid_validity bigint,
  p_uid_next bigint,
  p_selection_policy text,
  p_selection_targets jsonb
)
returns table (
  prepared boolean,
  lock_lost boolean,
  mode text,
  reset_detected boolean,
  resumed boolean,
  active_generation_id uuid,
  target_generation_id uuid,
  current_uid_validity bigint,
  observed_uid_validity bigint,
  scan_upper_uid bigint,
  scanned_through_uid bigint,
  lease_expires_at timestamptz,
  selection_targets jsonb
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_prepared record;
begin
  select * into strict v_prepared
  from public.softora_prepare_mailbox_uid_generation_v3(
    p_sync_key,
    p_lock_token,
    p_uid_validity,
    p_uid_next,
    p_selection_policy,
    p_selection_targets
  ) as prepared_v3;

  -- The pre-checkpoint runtime only understands a complete SEARCH result. If
  -- v3 seeded an incomplete manifest from the active generation, discard only
  -- that resumable header proof while no message bodies have been staged. The
  -- old runtime can then safely freeze its full SEARCH manifest on commit.
  if v_prepared.prepared is true
    and v_prepared.lock_lost is false
    and v_prepared.mode = 'rebuild'
    and v_prepared.target_generation_id is not null
    and p_selection_policy = 'targeted-sparse-v2'
    and v_prepared.target_manifest_complete is false then
    update public.softora_mailbox_uid_generations as generation
    set selection_manifest_scanned_through_uid = 0,
        selection_manifest_partial_uids = '[]'::jsonb,
        updated_at = pg_catalog.clock_timestamp()
    where generation.generation_id = v_prepared.target_generation_id
      and generation.sync_key = pg_catalog.lower(pg_catalog.btrim(p_sync_key))
      and generation.status = 'staging'
      and generation.selection_policy = 'targeted-sparse-v2'
      and generation.selection_uid_manifest is null
      and generation.scanned_through_uid = 0
      and not exists (
        select 1
        from public.softora_mailbox_uid_generation_staging as staged
        where staged.generation_id = generation.generation_id
      );

    if exists (
      select 1
      from public.softora_mailbox_uid_generations as generation
      where generation.generation_id = v_prepared.target_generation_id
        and generation.selection_uid_manifest is null
        and (
          generation.selection_manifest_scanned_through_uid <> 0
          or generation.selection_manifest_partial_uids <> '[]'::jsonb
        )
    ) then
      raise exception using errcode = '55000',
        message = 'MAILBOX_UID_LEGACY_TARGET_MANIFEST_INCOMPATIBLE';
    end if;
  end if;

  return query select
    v_prepared.prepared,
    v_prepared.lock_lost,
    v_prepared.mode,
    v_prepared.reset_detected,
    v_prepared.resumed,
    v_prepared.active_generation_id,
    v_prepared.target_generation_id,
    v_prepared.current_uid_validity,
    v_prepared.observed_uid_validity,
    v_prepared.scan_upper_uid,
    v_prepared.scanned_through_uid,
    v_prepared.lease_expires_at,
    v_prepared.selection_targets;
end;
$function$;

create or replace function public.softora_checkpoint_mailbox_uid_target_manifest_v2(
  p_sync_key text,
  p_lock_token text,
  p_checkpoint_id text,
  p_generation_id uuid,
  p_uid_validity bigint,
  p_expected_scanned_through_uid bigint,
  p_scanned_through_uid bigint,
  p_found_uids jsonb,
  p_scan_complete boolean
)
returns table (
  checkpointed boolean,
  lock_lost boolean,
  replayed boolean,
  scanned_through_uid bigint,
  target_uid_manifest jsonb,
  scan_complete boolean,
  lock_released boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_sync_key text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_sync_key, '')));
  v_lock_token text := pg_catalog.btrim(coalesce(p_lock_token, ''));
  v_checkpoint_id text := pg_catalog.btrim(coalesce(p_checkpoint_id, ''));
  v_payload_digest text;
  v_existing public.softora_mailbox_uid_generation_commits%rowtype;
  v_checkpoint public.softora_mailbox_uid_generation_commits%rowtype;
  v_sync public.softora_mailbox_sync_state%rowtype;
  v_generation public.softora_mailbox_uid_generations%rowtype;
  v_next_manifest jsonb := '[]'::jsonb;
  v_result jsonb;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_sync_key = '' or pg_catalog.char_length(v_sync_key) > 600
    or v_lock_token = '' or pg_catalog.char_length(v_lock_token) > 200
    or v_checkpoint_id = '' or pg_catalog.char_length(v_checkpoint_id) > 200
    or p_generation_id is null
    or coalesce(p_uid_validity, 0) not between 1 and 4294967295
    or coalesce(p_expected_scanned_through_uid, -1) < 0
    or coalesce(p_scanned_through_uid, -1) < p_expected_scanned_through_uid
    or p_scan_complete is null
    or pg_catalog.jsonb_typeof(coalesce(p_found_uids, 'null'::jsonb))
      is distinct from 'array' then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_CHECKPOINT_INVALID';
  end if;

  if pg_catalog.jsonb_array_length(p_found_uids) > 2000
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_found_uids) as found(value)
      where pg_catalog.jsonb_typeof(found.value) is distinct from 'number'
        or found.value #>> '{}' !~ '^[0-9]+$'
        or (found.value #>> '{}')::numeric not between 1 and 9223372036854775807
    ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_CHECKPOINT_INVALID';
  end if;

  if p_found_uids is distinct from (
    select coalesce(pg_catalog.jsonb_agg(valid.uid order by valid.uid), '[]'::jsonb)
    from (
      select distinct (found.value #>> '{}')::bigint as uid
      from pg_catalog.jsonb_array_elements(p_found_uids) as found(value)
    ) as valid
  ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_CHECKPOINT_INVALID';
  end if;

  v_payload_digest := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'operation', 'checkpoint', 'syncKey', v_sync_key,
      'lockToken', v_lock_token, 'generationId', p_generation_id,
      'uidValidity', p_uid_validity,
      'expectedScannedThroughUid', p_expected_scanned_through_uid,
      'scannedThroughUid', p_scanned_through_uid,
      'foundUids', p_found_uids, 'scanComplete', p_scan_complete
    )::text, 'UTF8'), 'sha256'), 'hex');

  select mutation.* into v_existing
  from public.softora_mailbox_uid_generation_commits as mutation
  where mutation.commit_id = v_checkpoint_id;
  if found and (
    v_existing.operation <> 'checkpoint'
    or v_existing.payload_digest <> v_payload_digest
    or v_existing.sync_key <> v_sync_key
    or v_existing.generation_id is distinct from p_generation_id
    or v_existing.uid_validity is distinct from p_uid_validity
  ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_GENERATION_REPLAY_MISMATCH';
  elsif found and v_existing.status = 'completed' then
    return query select true, false, true,
      coalesce((v_existing.result->>'scannedThroughUid')::bigint, 0),
      coalesce(v_existing.result->'targetUidManifest', '[]'::jsonb),
      coalesce((v_existing.result->>'scanComplete')::boolean, false),
      coalesce((v_existing.result->>'lockReleased')::boolean, false);
    return;
  end if;

  select state.* into v_sync
  from public.softora_mailbox_sync_state as state
  where state.sync_key = v_sync_key;
  if not found or v_sync.status <> 'syncing'
    or v_sync.lock_token is distinct from v_lock_token
    or v_sync.lock_expires_at is null
    or v_sync.lock_expires_at <= pg_catalog.clock_timestamp() then
    return query select false, true, false, 0::bigint,
      '[]'::jsonb, false, false;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  perform 1 from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'MAILBOX_CAMPAIGN_FENCE_MISSING';
  end if;

  insert into public.softora_mailbox_uid_generation_commits (
    commit_id, operation, payload_digest, sync_key, generation_id,
    uid_validity, status, updated_at
  ) values (
    v_checkpoint_id, 'checkpoint', v_payload_digest, v_sync_key,
    p_generation_id, p_uid_validity, 'pending', v_now
  ) on conflict (commit_id) do nothing;

  select mutation.* into strict v_checkpoint
  from public.softora_mailbox_uid_generation_commits as mutation
  where mutation.commit_id = v_checkpoint_id
  for update;
  if v_checkpoint.operation <> 'checkpoint'
    or v_checkpoint.payload_digest <> v_payload_digest
    or v_checkpoint.sync_key <> v_sync_key
    or v_checkpoint.generation_id is distinct from p_generation_id
    or v_checkpoint.uid_validity is distinct from p_uid_validity then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_GENERATION_REPLAY_MISMATCH';
  elsif v_checkpoint.status = 'completed' then
    return query select true, false, true,
      coalesce((v_checkpoint.result->>'scannedThroughUid')::bigint, 0),
      coalesce(v_checkpoint.result->'targetUidManifest', '[]'::jsonb),
      coalesce((v_checkpoint.result->>'scanComplete')::boolean, false),
      coalesce((v_checkpoint.result->>'lockReleased')::boolean, false);
    return;
  end if;

  select state.* into v_sync
  from public.softora_mailbox_sync_state as state
  where state.sync_key = v_sync_key
  for update;
  if not found or v_sync.status <> 'syncing'
    or v_sync.lock_token is distinct from v_lock_token
    or v_sync.lock_expires_at is null
    or v_sync.lock_expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_GENERATION_LEASE_INVALID';
  end if;

  perform generation.generation_id
  from public.softora_mailbox_uid_generations as generation
  where generation.generation_id = v_sync.active_uid_generation_id
    or generation.generation_id = v_sync.pending_uid_generation_id
  order by generation.generation_id
  for update;

  select generation.* into v_generation
  from public.softora_mailbox_uid_generations as generation
  where generation.generation_id = p_generation_id;
  if not found or v_generation.sync_key <> v_sync.sync_key
    or v_generation.account_email <> v_sync.account_email
    or v_generation.folder <> v_sync.folder
    or v_generation.generation_id is distinct from v_sync.pending_uid_generation_id
    or v_generation.status <> 'staging'
    or v_generation.selection_policy <> 'targeted-sparse-v2'
    or v_generation.uid_validity <> p_uid_validity
    or v_generation.selection_uid_manifest is not null
    or v_generation.selection_manifest_scanned_through_uid
      <> p_expected_scanned_through_uid
    or p_scanned_through_uid > v_generation.scan_upper_uid
    or p_scan_complete is distinct from
      (p_scanned_through_uid = v_generation.scan_upper_uid)
    or (
      p_scanned_through_uid = p_expected_scanned_through_uid
      and not (p_scan_complete and p_scanned_through_uid = 0)
    ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_CHECKPOINT_CONFLICT';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_found_uids) as found(value)
    where (found.value #>> '{}')::bigint
      not between p_expected_scanned_through_uid + 1 and p_scanned_through_uid
  ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_UID_OUT_OF_WINDOW';
  end if;

  if exists (
    with manifest as (
      select (entry.value #>> '{}')::numeric as uid, entry.ordinality
      from pg_catalog.jsonb_array_elements(
        v_generation.selection_manifest_partial_uids
      ) with ordinality as entry(value, ordinality)
      where pg_catalog.jsonb_typeof(entry.value) = 'number'
        and entry.value #>> '{}' ~ '^[0-9]+$'
    )
    select 1
    from pg_catalog.jsonb_array_elements(
      v_generation.selection_manifest_partial_uids
    ) with ordinality as candidate(value, ordinality)
    left join manifest using (ordinality)
    where manifest.uid is null
      or manifest.uid not between 1 and p_expected_scanned_through_uid
      or exists (
        select 1 from manifest as previous
        where previous.ordinality = manifest.ordinality - 1
          and previous.uid >= manifest.uid
      )
  ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_TARGET_MANIFEST_STORED_INVALID';
  end if;

  select coalesce(pg_catalog.jsonb_agg(uid order by uid), '[]'::jsonb)
  into v_next_manifest
  from (
    select (stored.value #>> '{}')::bigint as uid
    from pg_catalog.jsonb_array_elements(
      v_generation.selection_manifest_partial_uids
    ) as stored(value)
    union
    select (found.value #>> '{}')::bigint as uid
    from pg_catalog.jsonb_array_elements(p_found_uids) as found(value)
  ) as combined;

  if pg_catalog.jsonb_array_length(v_next_manifest) > 2000 then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_LIMIT';
  end if;

  update public.softora_mailbox_uid_generations as generation
  set selection_manifest_scanned_through_uid = p_scanned_through_uid,
      selection_manifest_partial_uids = v_next_manifest,
      selection_uid_manifest = case when p_scan_complete
        then v_next_manifest else null end,
      selection_uid_manifest_digest = case when p_scan_complete then
        pg_catalog.encode(extensions.digest(
          pg_catalog.convert_to(v_next_manifest::text, 'UTF8'), 'sha256'
        ), 'hex') else null end,
      updated_at = v_now
  where generation.generation_id = p_generation_id;

  if not p_scan_complete then
    update public.softora_mailbox_sync_state as state
    set status = 'idle', sync_started_at = null, lock_token = null,
        lock_expires_at = null, last_error = null, updated_at = v_now
    where state.sync_key = v_sync.sync_key
      and state.status = 'syncing'
      and state.lock_token is not distinct from v_lock_token;
    if not found then
      raise exception using errcode = '55000',
        message = 'MAILBOX_UID_GENERATION_LEASE_INVALID';
    end if;
  end if;

  v_result := pg_catalog.jsonb_build_object(
    'checkpointed', true, 'lockLost', false,
    'scannedThroughUid', p_scanned_through_uid,
    'targetUidManifest', v_next_manifest,
    'scanComplete', p_scan_complete,
    'lockReleased', not p_scan_complete
  );
  update public.softora_mailbox_uid_generation_commits as mutation
  set status = 'completed', result = v_result, completed_at = v_now,
      updated_at = v_now
  where mutation.commit_id = v_checkpoint_id;

  return query select true, false, false, p_scanned_through_uid,
    v_next_manifest, p_scan_complete, not p_scan_complete;
end;
$function$;

create or replace function public.softora_invalidate_mailbox_uid_target_manifest_v2(
  p_sync_key text,
  p_lock_token text,
  p_invalidation_id text,
  p_generation_id uuid,
  p_uid_validity bigint,
  p_expected_staged_count integer,
  p_missing_uids jsonb
)
returns table (
  invalidated boolean,
  lock_lost boolean,
  replayed boolean,
  generation_role text,
  pending_abandoned boolean,
  active_manifest_invalidated boolean,
  lock_released boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_sync_key text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_sync_key, '')));
  v_lock_token text := pg_catalog.btrim(coalesce(p_lock_token, ''));
  v_invalidation_id text := pg_catalog.btrim(coalesce(p_invalidation_id, ''));
  v_payload_digest text;
  v_existing public.softora_mailbox_uid_generation_commits%rowtype;
  v_invalidation public.softora_mailbox_uid_generation_commits%rowtype;
  v_sync public.softora_mailbox_sync_state%rowtype;
  v_generation public.softora_mailbox_uid_generations%rowtype;
  v_active public.softora_mailbox_uid_generations%rowtype;
  v_generation_role text;
  v_staged_count integer := 0;
  v_deleted_count integer := 0;
  v_active_manifest_invalidated boolean := false;
  v_result jsonb;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_sync_key = '' or pg_catalog.char_length(v_sync_key) > 600
    or v_lock_token = '' or pg_catalog.char_length(v_lock_token) > 200
    or v_invalidation_id = ''
    or pg_catalog.char_length(v_invalidation_id) > 200
    or p_generation_id is null
    or coalesce(p_uid_validity, 0) not between 1 and 4294967295
    or coalesce(p_expected_staged_count, -1) not between 0 and 2000
    or pg_catalog.jsonb_typeof(coalesce(p_missing_uids, 'null'::jsonb))
      is distinct from 'array' then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_INVALID';
  end if;

  if pg_catalog.jsonb_array_length(p_missing_uids) not between 1 and 2000
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_missing_uids) as missing(value)
      where pg_catalog.jsonb_typeof(missing.value) is distinct from 'number'
        or missing.value #>> '{}' !~ '^[0-9]+$'
        or (missing.value #>> '{}')::numeric not between 1 and 9223372036854775807
    )
    or p_missing_uids is distinct from (
      select coalesce(pg_catalog.jsonb_agg(valid.uid order by valid.uid), '[]'::jsonb)
      from (
        select distinct (missing.value #>> '{}')::bigint as uid
        from pg_catalog.jsonb_array_elements(p_missing_uids) as missing(value)
      ) as valid
    ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_INVALID';
  end if;

  v_payload_digest := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'operation', 'invalidate', 'syncKey', v_sync_key,
      'lockToken', v_lock_token, 'generationId', p_generation_id,
      'uidValidity', p_uid_validity,
      'expectedStagedCount', p_expected_staged_count,
      'missingUids', p_missing_uids
    )::text, 'UTF8'), 'sha256'), 'hex');

  -- A completed lost-response replay is immutable and no longer needs a lease.
  select mutation.* into v_existing
  from public.softora_mailbox_uid_generation_commits as mutation
  where mutation.commit_id = v_invalidation_id;
  if found and (
    v_existing.operation <> 'invalidate'
    or v_existing.payload_digest <> v_payload_digest
    or v_existing.sync_key <> v_sync_key
    or v_existing.generation_id is distinct from p_generation_id
    or v_existing.uid_validity is distinct from p_uid_validity
  ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_GENERATION_REPLAY_MISMATCH';
  elsif found and v_existing.status = 'completed' then
    return query select true, false, true,
      nullif(v_existing.result->>'generationRole', ''),
      coalesce((v_existing.result->>'pendingAbandoned')::boolean, false),
      coalesce((v_existing.result->>'activeManifestInvalidated')::boolean, false),
      coalesce((v_existing.result->>'lockReleased')::boolean, false);
    return;
  end if;

  -- Reject an already-lost lease without creating an idempotency mutation.
  select state.* into v_sync
  from public.softora_mailbox_sync_state as state
  where state.sync_key = v_sync_key;
  if not found or v_sync.status <> 'syncing'
    or v_sync.lock_token is distinct from v_lock_token
    or v_sync.lock_expires_at is null
    or v_sync.lock_expires_at <= pg_catalog.clock_timestamp() then
    return query select false, true, false, null::text,
      false, false, false;
    return;
  end if;

  -- Shared mutation order: advisory -> campaign -> idempotency -> sync state
  -- -> generation rows -> staging. This matches commit/fail/checkpoint.
  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  perform 1 from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'MAILBOX_CAMPAIGN_FENCE_MISSING';
  end if;

  begin
    insert into public.softora_mailbox_uid_generation_commits (
      commit_id, operation, payload_digest, sync_key, generation_id,
      uid_validity, status, updated_at
    ) values (
      v_invalidation_id, 'invalidate', v_payload_digest, v_sync_key,
      p_generation_id, p_uid_validity, 'pending', v_now
    ) on conflict (commit_id) do nothing;
  exception
    when foreign_key_violation then
      raise exception using errcode = '22023',
        message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_CONFLICT';
  end;

  select mutation.* into strict v_invalidation
  from public.softora_mailbox_uid_generation_commits as mutation
  where mutation.commit_id = v_invalidation_id
  for update;
  if v_invalidation.operation <> 'invalidate'
    or v_invalidation.payload_digest <> v_payload_digest
    or v_invalidation.sync_key <> v_sync_key
    or v_invalidation.generation_id is distinct from p_generation_id
    or v_invalidation.uid_validity is distinct from p_uid_validity then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_GENERATION_REPLAY_MISMATCH';
  elsif v_invalidation.status = 'completed' then
    return query select true, false, true,
      nullif(v_invalidation.result->>'generationRole', ''),
      coalesce((v_invalidation.result->>'pendingAbandoned')::boolean, false),
      coalesce((v_invalidation.result->>'activeManifestInvalidated')::boolean, false),
      coalesce((v_invalidation.result->>'lockReleased')::boolean, false);
    return;
  end if;

  select state.* into v_sync
  from public.softora_mailbox_sync_state as state
  where state.sync_key = v_sync_key
  for update;
  if not found or v_sync.status <> 'syncing'
    or v_sync.lock_token is distinct from v_lock_token
    or v_sync.lock_expires_at is null
    or v_sync.lock_expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_GENERATION_LEASE_INVALID';
  end if;

  perform generation.generation_id
  from public.softora_mailbox_uid_generations as generation
  where generation.generation_id = v_sync.active_uid_generation_id
    or generation.generation_id = v_sync.pending_uid_generation_id
  order by generation.generation_id
  for update;

  select generation.* into v_generation
  from public.softora_mailbox_uid_generations as generation
  where generation.generation_id = p_generation_id;
  if not found or v_generation.sync_key is distinct from v_sync.sync_key
    or v_generation.account_email is distinct from v_sync.account_email
    or v_generation.folder is distinct from v_sync.folder
    or v_generation.uid_validity is distinct from p_uid_validity then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_CONFLICT';
  end if;

  if p_generation_id = v_sync.pending_uid_generation_id
    and v_generation.status = 'staging' then
    v_generation_role := 'pending';
  elsif p_generation_id = v_sync.active_uid_generation_id
    and v_generation.status = 'active' then
    v_generation_role := 'active';
  else
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_CONFLICT';
  end if;

  if v_sync.folder <> 'allmail'
    or v_generation.selection_policy <> 'targeted-sparse-v2'
    or v_generation.selection_uid_manifest is null
    or v_generation.selection_manifest_scanned_through_uid
      <> v_generation.scan_upper_uid
    or v_generation.selection_manifest_partial_uids
      is distinct from v_generation.selection_uid_manifest
    or (v_generation_role = 'active'
      and v_generation.selection_manifest_seed_invalidated_at is not null)
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_missing_uids) as missing(value)
      where not exists (
        select 1
        from pg_catalog.jsonb_array_elements(
          v_generation.selection_uid_manifest
        ) with ordinality as manifest(value, ordinality)
        where (manifest.value #>> '{}')::bigint
          = (missing.value #>> '{}')::bigint
          and (
            v_generation_role = 'active'
            or manifest.ordinality > v_generation.scanned_through_uid
          )
      )
    ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_CONFLICT';
  end if;

  select pg_catalog.count(*)::integer into v_staged_count
  from public.softora_mailbox_uid_generation_staging as staged
  where staged.generation_id = p_generation_id;

  if v_generation_role = 'active' then
    if p_expected_staged_count <> 0 then
      raise exception using errcode = '22023',
        message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_CONFLICT';
    end if;
  elsif p_expected_staged_count <> v_generation.scanned_through_uid
    or v_staged_count <> p_expected_staged_count
    or exists (
      select 1
      from public.softora_mailbox_uid_generation_staging as staged
      where staged.generation_id = p_generation_id
        and (
          exists (
            select 1
            from pg_catalog.jsonb_array_elements(p_missing_uids) as missing(value)
            where (missing.value #>> '{}')::bigint = staged.uid
          )
          or not exists (
            select 1
            from pg_catalog.jsonb_array_elements(
              v_generation.selection_uid_manifest
            ) with ordinality as manifest(value, ordinality)
            where manifest.ordinality <= v_generation.scanned_through_uid
              and (manifest.value #>> '{}')::bigint = staged.uid
          )
        )
    ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_CONFLICT';
  end if;

  if v_sync.active_uid_generation_id is not null then
    select generation.* into v_active
    from public.softora_mailbox_uid_generations as generation
    where generation.generation_id = v_sync.active_uid_generation_id;
    if not found or v_active.sync_key is distinct from v_sync.sync_key
      or v_active.status <> 'active'
      or v_active.uid_validity is distinct from v_sync.uid_validity then
      raise exception using errcode = '55000',
        message = 'MAILBOX_UID_GENERATION_ACTIVE_INCONSISTENT';
    end if;
  end if;

  perform pg_catalog.set_config(
    'softora.mailbox_uid_generation_v2_transition', '1', true
  );

  if v_generation_role = 'pending' then
    delete from public.softora_mailbox_uid_generation_staging as staged
    where staged.generation_id = p_generation_id;
    get diagnostics v_deleted_count = row_count;
    if v_deleted_count <> p_expected_staged_count then
      raise exception using errcode = '40001',
        message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_CHANGED';
    end if;

    update public.softora_mailbox_uid_generations as generation
    set status = 'abandoned', abandoned_at = v_now, updated_at = v_now
    where generation.generation_id = p_generation_id
      and generation.status = 'staging';
    if not found then
      raise exception using errcode = '40001',
        message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_CHANGED';
    end if;
  end if;

  if v_sync.active_uid_generation_id is not null then
    update public.softora_mailbox_uid_generations as generation
    set selection_manifest_seed_invalidated_at = coalesce(
          generation.selection_manifest_seed_invalidated_at, v_now
        ),
        updated_at = v_now
    where generation.generation_id = v_sync.active_uid_generation_id
      and generation.status = 'active';
    if not found then
      raise exception using errcode = '40001',
        message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_CHANGED';
    end if;
    v_active_manifest_invalidated := true;
  end if;

  update public.softora_mailbox_sync_state as state
  set pending_uid_generation_id = case when v_generation_role = 'pending'
        then null else state.pending_uid_generation_id end,
      status = 'idle', sync_started_at = null, lock_token = null,
      lock_expires_at = null, last_error = null, updated_at = v_now
  where state.sync_key = v_sync.sync_key
    and state.status = 'syncing'
    and state.lock_token is not distinct from v_lock_token;
  if not found then
    raise exception using errcode = '40001',
      message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_CHANGED';
  end if;

  v_result := pg_catalog.jsonb_build_object(
    'invalidated', true, 'lockLost', false,
    'generationRole', v_generation_role,
    'pendingAbandoned', v_generation_role = 'pending',
    'activeManifestInvalidated', v_active_manifest_invalidated,
    'lockReleased', true
  );
  update public.softora_mailbox_uid_generation_commits as mutation
  set status = 'completed', result = v_result, completed_at = v_now,
      updated_at = v_now
  where mutation.commit_id = v_invalidation_id;

  return query select true, false, false, v_generation_role,
    v_generation_role = 'pending', v_active_manifest_invalidated, true;
end;
$function$;

create or replace function public.softora_commit_mailbox_sync_pass_v2(
  p_sync_key text,
  p_lock_token text,
  p_commit_id text,
  p_generation_id uuid,
  p_uid_validity bigint,
  p_selection_policy text,
  p_target_reference_ids jsonb,
  p_target_uid_manifest jsonb,
  p_rows jsonb,
  p_scanned_from_uid bigint,
  p_scanned_through_uid bigint,
  p_scan_complete boolean,
  p_message_count integer,
  p_last_uid bigint
)
returns table (
  committed boolean,
  replayed boolean,
  activated boolean,
  rebuild_pending boolean,
  upserted_count integer,
  last_uid bigint,
  current_generation_id uuid,
  current_uid_validity bigint
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_sync_key text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_sync_key, '')));
  v_lock_token text := pg_catalog.btrim(coalesce(p_lock_token, ''));
  v_commit_id text := pg_catalog.btrim(coalesce(p_commit_id, ''));
  v_payload_digest text;
  v_commit public.softora_mailbox_uid_generation_commits%rowtype;
  v_sync public.softora_mailbox_sync_state%rowtype;
  v_generation public.softora_mailbox_uid_generations%rowtype;
  v_active public.softora_mailbox_uid_generations%rowtype;
  v_upserted integer := 0;
  v_staged_count integer := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_snapshot_digest text;
  v_result jsonb;
begin
  if v_sync_key = '' or pg_catalog.char_length(v_sync_key) > 600
    or v_lock_token = '' or pg_catalog.char_length(v_lock_token) > 200
    or v_commit_id = '' or pg_catalog.char_length(v_commit_id) > 200
    or p_generation_id is null
    or coalesce(p_uid_validity, 0) not between 1 and 4294967295
    or p_selection_policy not in ('staged-rebuild-v2', 'targeted-sparse-v2')
    or pg_catalog.jsonb_typeof(coalesce(p_target_reference_ids, 'null'::jsonb))
      is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_target_reference_ids) > 2000
    or pg_catalog.jsonb_typeof(coalesce(p_target_uid_manifest, 'null'::jsonb))
      is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_target_uid_manifest) > 2000
    or pg_catalog.jsonb_typeof(p_rows) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_rows) > 2000
    or coalesce(p_scanned_from_uid, -1) < 0
    or coalesce(p_scanned_through_uid, -1) < 0
    or p_scanned_through_uid < p_scanned_from_uid - 1
    or p_scan_complete is null
    or coalesce(p_message_count, -1) < 0
    or coalesce(p_last_uid, -1) < 0
    or (p_selection_policy = 'staged-rebuild-v2' and (
      pg_catalog.jsonb_array_length(p_target_reference_ids) <> 0
      or pg_catalog.jsonb_array_length(p_target_uid_manifest) <> 0
      or p_scanned_from_uid < 1
    ))
    or (p_selection_policy = 'targeted-sparse-v2' and p_last_uid <> 0) then
    raise exception using errcode = '22023', message = 'MAILBOX_UID_GENERATION_COMMIT_INVALID';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_target_reference_ids) as target(value)
    where pg_catalog.jsonb_typeof(target.value) is distinct from 'string'
      or public.softora_normalize_mailbox_message_id(target.value #>> '{}') is null
      or target.value #>> '{}' is distinct from
        public.softora_normalize_mailbox_message_id(target.value #>> '{}')
  ) or pg_catalog.jsonb_array_length(p_target_reference_ids) <> (
    select pg_catalog.count(distinct target.value #>> '{}')::integer
    from pg_catalog.jsonb_array_elements(p_target_reference_ids) as target(value)
  ) or p_target_reference_ids is distinct from (
    select coalesce(pg_catalog.jsonb_agg(target.value #>> '{}'
      order by pg_catalog.convert_to(target.value #>> '{}', 'UTF8')), '[]'::jsonb)
    from pg_catalog.jsonb_array_elements(p_target_reference_ids) as target(value)
  ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_REFERENCES_INVALID';
  end if;

  if exists (
    with manifest as (
      select (entry.value #>> '{}')::numeric as uid, entry.ordinality
      from pg_catalog.jsonb_array_elements(p_target_uid_manifest)
        with ordinality as entry(value, ordinality)
      where pg_catalog.jsonb_typeof(entry.value) = 'number'
        and entry.value #>> '{}' ~ '^[0-9]+$'
    )
    select 1
    from pg_catalog.jsonb_array_elements(p_target_uid_manifest)
      with ordinality as candidate(value, ordinality)
    left join manifest using (ordinality)
    where manifest.uid is null
      or manifest.uid not between 1 and 9223372036854775807
      or exists (
        select 1 from manifest as previous
        where previous.ordinality = manifest.ordinality - 1
          and previous.uid >= manifest.uid
      )
  ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_INVALID';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_rows) as candidate(row_data)
    where pg_catalog.jsonb_typeof(candidate.row_data) is distinct from 'object'
      or (case
        when coalesce(candidate.row_data->>'uid', '') ~ '^[0-9]+$'
          then (candidate.row_data->>'uid')::numeric between 1 and 9223372036854775807
        else false
      end) is not true
      or nullif(pg_catalog.btrim(candidate.row_data->>'provider_id'), '') is null
      or nullif(pg_catalog.btrim(candidate.row_data->>'date'), '') is null
  ) then
    raise exception using errcode = '22023', message = 'MAILBOX_UID_GENERATION_ROW_INVALID';
  end if;

  if pg_catalog.jsonb_array_length(p_rows) <> (
    select pg_catalog.count(distinct (candidate.row_data->>'uid')::bigint)::integer
    from pg_catalog.jsonb_array_elements(p_rows) as candidate(row_data)
  ) then
    raise exception using errcode = '22023', message = 'MAILBOX_UID_GENERATION_ROWS_DUPLICATE';
  end if;

  v_payload_digest := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'operation', 'commit', 'syncKey', v_sync_key, 'lockToken', v_lock_token,
      'generationId', p_generation_id, 'uidValidity', p_uid_validity,
      'selectionPolicy', p_selection_policy,
      'targetReferenceIds', p_target_reference_ids,
      'targetUidManifest', p_target_uid_manifest,
      'rows', p_rows, 'scannedFromUid', p_scanned_from_uid,
      'scannedThroughUid', p_scanned_through_uid,
      'scanComplete', p_scan_complete, 'messageCount', p_message_count,
      'lastUid', p_last_uid
    )::text, 'UTF8'), 'sha256'), 'hex');

  -- Shared lock order: advisory -> campaign -> idempotency -> sync state ->
  -- generation rows. Every state-changing branch rechecks the live lease.
  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  perform 1 from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  if not found then
    raise exception using errcode = '55000', message = 'MAILBOX_CAMPAIGN_FENCE_MISSING';
  end if;

  insert into public.softora_mailbox_uid_generation_commits (
    commit_id, operation, payload_digest, sync_key, generation_id,
    uid_validity, status, updated_at
  ) values (
    v_commit_id, 'commit', v_payload_digest, v_sync_key, p_generation_id,
    p_uid_validity, 'pending', v_now
  ) on conflict (commit_id) do nothing;

  select mutation.* into strict v_commit
  from public.softora_mailbox_uid_generation_commits as mutation
  where mutation.commit_id = v_commit_id
  for update;
  if v_commit.operation <> 'commit'
    or v_commit.payload_digest <> v_payload_digest
    or v_commit.sync_key <> v_sync_key
    or v_commit.generation_id is distinct from p_generation_id
    or v_commit.uid_validity is distinct from p_uid_validity then
    raise exception using errcode = '22023', message = 'MAILBOX_UID_GENERATION_REPLAY_MISMATCH';
  end if;
  if v_commit.status = 'completed' then
    return query select true, true,
      coalesce((v_commit.result->>'activated')::boolean, false),
      coalesce((v_commit.result->>'rebuildPending')::boolean, false),
      coalesce((v_commit.result->>'upsertedCount')::integer, 0),
      coalesce((v_commit.result->>'lastUid')::bigint, 0),
      nullif(v_commit.result->>'currentGenerationId', '')::uuid,
      nullif(v_commit.result->>'currentUidValidity', '')::bigint;
    return;
  end if;

  select state.* into v_sync
  from public.softora_mailbox_sync_state as state
  where state.sync_key = v_sync_key
  for update;
  if not found or v_sync.status <> 'syncing'
    or v_sync.lock_token is distinct from v_lock_token
    or v_sync.lock_expires_at is null
    or v_sync.lock_expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '55000', message = 'MAILBOX_UID_GENERATION_LEASE_INVALID';
  end if;

  perform pg_catalog.set_config(
    'softora.mailbox_uid_generation_v2_transition', '1', true
  );

  perform generation.generation_id
  from public.softora_mailbox_uid_generations as generation
  where generation.generation_id = p_generation_id
    or generation.generation_id = v_sync.active_uid_generation_id
  order by generation.generation_id
  for update;

  select generation.* into v_generation
  from public.softora_mailbox_uid_generations as generation
  where generation.generation_id = p_generation_id;
  if not found or v_generation.sync_key <> v_sync.sync_key
    or v_generation.uid_validity <> p_uid_validity then
    raise exception using errcode = '55000', message = 'MAILBOX_UID_GENERATION_TARGET_INVALID';
  end if;
  if v_sync.active_uid_generation_id is not null then
    select generation.* into v_active
    from public.softora_mailbox_uid_generations as generation
    where generation.generation_id = v_sync.active_uid_generation_id;
  end if;

  if v_sync.folder = 'allmail'
    and p_selection_policy <> 'targeted-sparse-v2' then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_ALLMAIL_SELECTION_POLICY_REQUIRED';
  end if;

  if p_selection_policy = 'targeted-sparse-v2' and (
    v_sync.folder <> 'allmail'
    or v_generation.selection_policy <> 'targeted-sparse-v2'
    or v_generation.selection_targets is distinct from p_target_reference_ids
    or not (
      v_generation.selection_uid_manifest is not null
        and v_generation.selection_manifest_scanned_through_uid
          = v_generation.scan_upper_uid
        and v_generation.selection_manifest_partial_uids
          = v_generation.selection_uid_manifest
      or v_generation.generation_id = v_sync.pending_uid_generation_id
        and v_generation.status = 'staging'
        and v_generation.selection_uid_manifest is null
        and v_generation.selection_manifest_scanned_through_uid = 0
        and v_generation.selection_manifest_partial_uids = '[]'::jsonb
    )
    or v_generation.selection_manifest_seed_invalidated_at is not null
    or not public.softora_is_campaign_mailbox_message(
      v_sync.account_email, 'inbox', '{}'::jsonb
    )
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements_text(p_target_uid_manifest)
        as manifest(uid)
      where manifest.uid::bigint > v_generation.scan_upper_uid
    )
  ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_REFERENCES_UNANCHORED';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_rows) as candidate(row_data)
    where (candidate.row_data ? 'account_email' and
        pg_catalog.lower(pg_catalog.btrim(candidate.row_data->>'account_email'))
          is distinct from v_sync.account_email)
      or (candidate.row_data ? 'folder' and
        pg_catalog.lower(pg_catalog.btrim(candidate.row_data->>'folder'))
          is distinct from v_sync.folder)
      or (candidate.row_data ? 'uid_validity' and (case
        when coalesce(candidate.row_data->>'uid_validity', '') ~ '^[0-9]+$'
          then (candidate.row_data->>'uid_validity')::numeric = p_uid_validity::numeric
        else false end) is not true)
      or (candidate.row_data ? 'uid_generation_id' and
        pg_catalog.lower(candidate.row_data->>'uid_generation_id')
          is distinct from p_generation_id::text)
      or (candidate.row_data ? 'message_key' and candidate.row_data->>'message_key'
        is distinct from v_sync.account_email || '|' || v_sync.folder || '|gen:'
          || p_generation_id::text || '|' || (candidate.row_data->>'uid'))
      or (
        p_selection_policy = 'staged-rebuild-v2'
        and not public.softora_is_campaign_mailbox_message(
          v_sync.account_email, v_sync.folder, candidate.row_data->'payload'
        )
      )
      or (
        p_selection_policy = 'targeted-sparse-v2'
        and not public.softora_mailbox_row_matches_target_references(
          candidate.row_data, p_target_reference_ids
        )
      )
  ) then
    raise exception using errcode = '22023', message = 'MAILBOX_UID_GENERATION_ROW_IDENTITY_MISMATCH';
  end if;

  if v_generation.generation_id = v_sync.active_uid_generation_id
    and v_generation.status = 'active' then
    if p_selection_policy = 'targeted-sparse-v2' then
      if p_scan_complete is not true
        or p_scanned_from_uid <> 0
        or p_scanned_through_uid <> 0
        or p_last_uid <> 0
        or exists (
          select 1
          from pg_catalog.jsonb_array_elements(p_target_uid_manifest)
            as selected(value)
          where not exists (
            select 1
            from pg_catalog.jsonb_array_elements(
              v_generation.selection_uid_manifest
            ) as manifest(value)
            where (manifest.value #>> '{}')::bigint
              = (selected.value #>> '{}')::bigint
          )
        )
        or p_target_uid_manifest is distinct from (
          select coalesce(pg_catalog.jsonb_agg(
            (candidate.row_data->>'uid')::bigint
            order by (candidate.row_data->>'uid')::bigint
          ), '[]'::jsonb)
          from pg_catalog.jsonb_array_elements(p_rows) as candidate(row_data)
        ) then
        raise exception using errcode = '22023',
          message = 'MAILBOX_UID_TARGETED_STEADY_COVERAGE_INVALID';
      end if;
    elsif p_scan_complete is not true
        or p_scanned_from_uid <> greatest(coalesce(v_sync.last_uid, 0), 0) + 1
        or p_last_uid <> greatest(
          greatest(coalesce(v_sync.last_uid, 0), 0), p_scanned_through_uid
        )
        or exists (
          select 1 from pg_catalog.jsonb_array_elements(p_rows) as candidate(row_data)
          where (candidate.row_data->>'uid')::bigint not between 1 and p_scanned_through_uid
        ) then
      raise exception using errcode = '22023',
        message = 'MAILBOX_UID_GENERATION_STEADY_COVERAGE_INVALID';
    end if;

    insert into public.softora_mailbox_messages as stored_message (
      message_key, account_email, folder, uid, uid_validity, uid_generation_id,
      provider_id, message_id, in_reply_to, references_text, sender_name,
      sender_email, recipients_text, subject, preview, body_text,
      body_truncated, has_body, date, internal_date, unread, starred,
      payload, updated_at
    )
    select
      v_sync.account_email || '|' || v_sync.folder || '|gen:'
        || p_generation_id::text || '|' || incoming.uid::text,
      v_sync.account_email, v_sync.folder, incoming.uid, p_uid_validity,
      p_generation_id, incoming.provider_id, incoming.message_id,
      incoming.in_reply_to, incoming.references_text, incoming.sender_name,
      incoming.sender_email, incoming.recipients_text, incoming.subject,
      incoming.preview, incoming.body_text, coalesce(incoming.body_truncated, false),
      coalesce(incoming.has_body, false), incoming.date, incoming.internal_date,
      coalesce(incoming.unread, false), coalesce(incoming.starred, false),
      coalesce(incoming.payload, '{}'::jsonb),
      coalesce(incoming.updated_at, pg_catalog.clock_timestamp())
    from pg_catalog.jsonb_to_recordset(p_rows) as incoming(
      uid bigint, provider_id text, message_id text, in_reply_to text,
      references_text text, sender_name text, sender_email text,
      recipients_text text, subject text, preview text, body_text text,
      body_truncated boolean, has_body boolean, date timestamptz,
      internal_date timestamptz, unread boolean, starred boolean,
      payload jsonb, updated_at timestamptz
    )
    on conflict (message_key) do update set
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

    if p_selection_policy = 'targeted-sparse-v2' then
      select pg_catalog.count(*)::integer into v_staged_count
      from public.softora_mailbox_messages as current_message
      where current_message.uid_generation_id = p_generation_id
        and current_message.generation_superseded_at is null
        and current_message.deleted_at is null;
      update public.softora_mailbox_sync_state as state
      set status = 'ok', last_synced_at = v_now, sync_started_at = null,
          lock_token = null, lock_expires_at = null,
          message_count = v_staged_count, last_error = null, updated_at = v_now
      where state.sync_key = v_sync.sync_key;
      if pg_catalog.jsonb_array_length(p_rows) > 0 then
        update public.softora_mailbox_campaign_consistency as consistency
        set content_version = consistency.content_version + 1,
            updated_at = v_now
        where consistency.scope = 'campaign';
      end if;
    else
      update public.softora_mailbox_sync_state as state
      set status = 'ok', last_synced_at = v_now, sync_started_at = null,
          lock_token = null, lock_expires_at = null, last_uid = p_last_uid,
          message_count = p_message_count, last_error = null, updated_at = v_now
      where state.sync_key = v_sync.sync_key;
    end if;

    v_result := pg_catalog.jsonb_build_object(
      'activated', false, 'rebuildPending', false,
      'upsertedCount', v_upserted, 'lastUid',
        case when p_selection_policy = 'targeted-sparse-v2'
          then greatest(coalesce(v_sync.last_uid, 0), 0)
          else p_last_uid end,
      'currentGenerationId', p_generation_id,
      'currentUidValidity', p_uid_validity
    );
    update public.softora_mailbox_uid_generation_commits as mutation
    set status = 'completed', result = v_result, completed_at = v_now,
        updated_at = v_now
    where mutation.commit_id = v_commit_id;
    return query select true, false, false, false, v_upserted,
      case when p_selection_policy = 'targeted-sparse-v2'
        then greatest(coalesce(v_sync.last_uid, 0), 0)
        else p_last_uid end,
      p_generation_id, p_uid_validity;
    return;
  end if;

  if v_generation.generation_id is distinct from v_sync.pending_uid_generation_id
    or v_generation.status <> 'staging'
    or v_generation.selection_policy is distinct from p_selection_policy then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_GENERATION_REBUILD_COVERAGE_INVALID';
  end if;

  if p_selection_policy = 'targeted-sparse-v2' then
    if v_generation.selection_targets is distinct from p_target_reference_ids
      or v_generation.selection_uid_manifest is not null
        and v_generation.selection_uid_manifest is distinct from p_target_uid_manifest
      or p_scanned_from_uid <> v_generation.scanned_through_uid + 1
      or p_scanned_through_uid <> v_generation.scanned_through_uid
        + pg_catalog.jsonb_array_length(p_rows)
      or p_scanned_through_uid > pg_catalog.jsonb_array_length(p_target_uid_manifest)
      or p_scan_complete is distinct from (
        p_scanned_through_uid = pg_catalog.jsonb_array_length(p_target_uid_manifest)
      )
      or (
        select coalesce(pg_catalog.jsonb_agg(
          (candidate.row_data->>'uid')::bigint order by candidate.ordinality
        ), '[]'::jsonb)
        from pg_catalog.jsonb_array_elements(p_rows) with ordinality
          as candidate(row_data, ordinality)
      ) is distinct from (
        select coalesce(pg_catalog.jsonb_agg(
          (manifest.value #>> '{}')::bigint order by manifest.ordinality
        ), '[]'::jsonb)
        from pg_catalog.jsonb_array_elements(p_target_uid_manifest) with ordinality
          as manifest(value, ordinality)
        where manifest.ordinality between p_scanned_from_uid and p_scanned_through_uid
      ) then
      raise exception using errcode = '22023',
        message = 'MAILBOX_UID_TARGETED_REBUILD_COVERAGE_INVALID';
    end if;
  elsif p_scanned_from_uid <> v_generation.scanned_through_uid + 1
    or p_scanned_through_uid > v_generation.scan_upper_uid
    or p_scan_complete is distinct from
      (p_scanned_through_uid = v_generation.scan_upper_uid)
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_rows) as candidate(row_data)
      where (candidate.row_data->>'uid')::bigint not between
        p_scanned_from_uid and p_scanned_through_uid
    )
    or exists (
      with ordered as (
        select (candidate.row_data->>'uid')::bigint as uid, candidate.ordinality
        from pg_catalog.jsonb_array_elements(p_rows) with ordinality
          as candidate(row_data, ordinality)
      ), compared as (
        select uid, pg_catalog.lag(uid) over (order by ordinality) as previous_uid
        from ordered
      )
      select 1 from compared
      where previous_uid is not null and uid <= previous_uid
    ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_GENERATION_REBUILD_COVERAGE_INVALID';
  end if;

  with canonical as (
    select (candidate.row_data->>'uid')::bigint as uid,
      ((((((candidate.row_data - 'message_key') - 'account_email') - 'folder')
        - 'uid_validity') - 'uid_generation_id') - 'uid')
        || pg_catalog.jsonb_build_object(
          'message_key', v_sync.account_email || '|' || v_sync.folder || '|gen:'
            || p_generation_id::text || '|' || (candidate.row_data->>'uid'),
          'account_email', v_sync.account_email,
          'folder', v_sync.folder,
          'uid', (candidate.row_data->>'uid')::bigint,
          'uid_validity', p_uid_validity,
          'uid_generation_id', p_generation_id
        ) as row_data
    from pg_catalog.jsonb_array_elements(p_rows) as candidate(row_data)
  )
  insert into public.softora_mailbox_uid_generation_staging as staged (
    generation_id, uid, row_data, row_digest, updated_at
  )
  select p_generation_id, canonical.uid, canonical.row_data,
    pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(canonical.row_data::text, 'UTF8'), 'sha256'
    ), 'hex'), v_now
  from canonical
  on conflict (generation_id, uid) do update set
    row_data = excluded.row_data,
    row_digest = excluded.row_digest,
    updated_at = excluded.updated_at;
  get diagnostics v_upserted = row_count;

  update public.softora_mailbox_uid_generations as generation
  set scanned_through_uid = p_scanned_through_uid,
      scan_complete = p_scan_complete,
      selection_uid_manifest = case
        when p_selection_policy = 'targeted-sparse-v2'
          then coalesce(generation.selection_uid_manifest, p_target_uid_manifest)
        else generation.selection_uid_manifest
      end,
      selection_uid_manifest_digest = case
        when p_selection_policy = 'targeted-sparse-v2'
          then coalesce(generation.selection_uid_manifest_digest,
            pg_catalog.encode(extensions.digest(
              pg_catalog.convert_to(p_target_uid_manifest::text, 'UTF8'), 'sha256'
            ), 'hex'))
        else generation.selection_uid_manifest_digest
      end,
      updated_at = v_now
  where generation.generation_id = p_generation_id;

  if not p_scan_complete then
    update public.softora_mailbox_sync_state as state
    set status = 'idle', sync_started_at = null, lock_token = null,
        lock_expires_at = null, last_error = null, updated_at = v_now
    where state.sync_key = v_sync.sync_key;
    v_result := pg_catalog.jsonb_build_object(
      'activated', false, 'rebuildPending', true,
      'upsertedCount', v_upserted,
      'lastUid', greatest(coalesce(v_sync.last_uid, 0), 0),
      'currentGenerationId', v_sync.active_uid_generation_id,
      'currentUidValidity', v_sync.uid_validity
    );
    update public.softora_mailbox_uid_generation_commits as mutation
    set status = 'completed', result = v_result, completed_at = v_now,
        updated_at = v_now
    where mutation.commit_id = v_commit_id;
    return query select true, false, false, true, v_upserted,
      greatest(coalesce(v_sync.last_uid, 0), 0),
      v_sync.active_uid_generation_id, v_sync.uid_validity;
    return;
  end if;

  select pg_catalog.count(*)::integer into v_staged_count
  from public.softora_mailbox_uid_generation_staging as staged
  where staged.generation_id = p_generation_id;
  if (
    p_selection_policy = 'targeted-sparse-v2'
    and (
      p_last_uid <> 0
      or v_staged_count <> pg_catalog.jsonb_array_length(p_target_uid_manifest)
    )
  ) or (
    p_selection_policy = 'staged-rebuild-v2'
    and p_last_uid <> v_generation.scan_upper_uid
  ) then
    raise exception using errcode = '22023', message = 'MAILBOX_UID_GENERATION_SNAPSHOT_INCOMPLETE';
  end if;

  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce(
    pg_catalog.string_agg(staged.uid::text || ':' || staged.row_digest, '|'
      order by staged.uid), ''
  ), 'UTF8'), 'sha256'), 'hex')
  into v_snapshot_digest
  from public.softora_mailbox_uid_generation_staging as staged
  where staged.generation_id = p_generation_id;

  insert into public.softora_mailbox_messages as stored_message (
    message_key, account_email, folder, uid, uid_validity, uid_generation_id,
    provider_id, message_id, in_reply_to, references_text, sender_name,
    sender_email, recipients_text, subject, preview, body_text,
    body_truncated, has_body, date, internal_date, unread, softora_read_at,
    state_revision, state_mutation_key, state_mutation_at, starred,
    reply_dismissed_at, payload, updated_at, deleted_at
  )
  select
    v_sync.account_email || '|' || v_sync.folder || '|gen:'
      || p_generation_id::text || '|' || staged.uid::text,
    v_sync.account_email, v_sync.folder, staged.uid, p_uid_validity,
    p_generation_id, incoming.provider_id, incoming.message_id,
    incoming.in_reply_to, incoming.references_text, incoming.sender_name,
    incoming.sender_email, incoming.recipients_text, incoming.subject,
    incoming.preview, incoming.body_text, coalesce(incoming.body_truncated, false),
    coalesce(incoming.has_body, false), incoming.date, incoming.internal_date,
    case when prior.softora_read_at is not null then false
      else coalesce(incoming.unread, false) end,
    prior.softora_read_at, coalesce(prior.state_revision, 0),
    prior.state_mutation_key, prior.state_mutation_at,
    coalesce(prior.starred, incoming.starred, false),
    prior.reply_dismissed_at, coalesce(incoming.payload, '{}'::jsonb),
    coalesce(incoming.updated_at, v_now), prior.deleted_at
  from public.softora_mailbox_uid_generation_staging as staged
  cross join lateral pg_catalog.jsonb_to_record(staged.row_data) as incoming(
    provider_id text, message_id text, in_reply_to text, references_text text,
    sender_name text, sender_email text, recipients_text text, subject text,
    preview text, body_text text, body_truncated boolean, has_body boolean,
    date timestamptz, internal_date timestamptz, unread boolean,
    starred boolean, payload jsonb, updated_at timestamptz
  )
  left join lateral (
    select old_message.softora_read_at, old_message.state_revision,
      old_message.state_mutation_key, old_message.state_mutation_at,
      old_message.starred, old_message.reply_dismissed_at,
      old_message.deleted_at
    from public.softora_mailbox_messages as old_message
    where old_message.account_email = v_sync.account_email
      and old_message.folder = v_sync.folder
      and old_message.generation_superseded_at is null
      and old_message.uid_generation_id is distinct from p_generation_id
      and public.softora_normalize_mailbox_message_id(old_message.message_id)
        is not null
      and public.softora_normalize_mailbox_message_id(old_message.message_id)
        = public.softora_normalize_mailbox_message_id(incoming.message_id)
    order by old_message.updated_at desc, old_message.message_key
    limit 1
  ) as prior on true
  where staged.generation_id = p_generation_id
  order by staged.uid
  on conflict (message_key) do update set
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
    updated_at = excluded.updated_at,
    deleted_at = coalesce(stored_message.deleted_at, excluded.deleted_at);
  get diagnostics v_upserted = row_count;

  update public.softora_mailbox_messages as old_message
  set generation_superseded_at = coalesce(
        old_message.generation_superseded_at, v_now
      ),
      deleted_at = coalesce(old_message.deleted_at, v_now),
      updated_at = v_now
  where old_message.account_email = v_sync.account_email
    and old_message.folder = v_sync.folder
    and old_message.uid_generation_id is distinct from p_generation_id
    and old_message.generation_superseded_at is null;

  if v_active.generation_id is not null then
    update public.softora_mailbox_uid_generations as generation
    set status = 'superseded', superseded_at = v_now, updated_at = v_now
    where generation.generation_id = v_active.generation_id
      and generation.status = 'active';
  end if;
  update public.softora_mailbox_uid_generations as generation
  set status = 'active', activated_at = v_now,
      snapshot_message_count = v_staged_count,
      snapshot_digest = v_snapshot_digest, updated_at = v_now
  where generation.generation_id = p_generation_id
    and generation.status = 'staging';

  update public.softora_mailbox_sync_state as state
  set active_uid_generation_id = p_generation_id,
      pending_uid_generation_id = null,
      uid_validity = p_uid_validity,
      uid_validity_reset_at = case
        when state.active_uid_generation_id is not null
          and state.active_uid_generation_id is distinct from p_generation_id
          then v_now
        else state.uid_validity_reset_at
      end,
      status = 'ok', last_synced_at = v_now, sync_started_at = null,
      lock_token = null, lock_expires_at = null,
      last_uid = case when p_selection_policy = 'targeted-sparse-v2'
        then state.last_uid else p_last_uid end,
      message_count = v_staged_count, last_error = null, updated_at = v_now
  where state.sync_key = v_sync.sync_key;

  if p_selection_policy = 'targeted-sparse-v2' then
    update public.softora_mailbox_campaign_consistency as consistency
    set content_version = consistency.content_version + 1,
        updated_at = v_now
    where consistency.scope = 'campaign';
  end if;

  v_result := pg_catalog.jsonb_build_object(
    'activated', true, 'rebuildPending', false,
    'upsertedCount', v_upserted, 'lastUid',
      case when p_selection_policy = 'targeted-sparse-v2'
        then greatest(coalesce(v_sync.last_uid, 0), 0)
        else p_last_uid end,
    'currentGenerationId', p_generation_id,
    'currentUidValidity', p_uid_validity
  );
  update public.softora_mailbox_uid_generation_commits as mutation
  set status = 'completed', result = v_result, completed_at = v_now,
      updated_at = v_now
  where mutation.commit_id = v_commit_id;

  return query select true, false, true, false, v_upserted,
    case when p_selection_policy = 'targeted-sparse-v2'
      then greatest(coalesce(v_sync.last_uid, 0), 0)
      else p_last_uid end,
    p_generation_id, p_uid_validity;
end;
$function$;

create or replace function public.softora_skip_mailbox_sync_v2(
  p_sync_key text,
  p_lock_token text,
  p_commit_id text,
  p_reason text
)
returns table (
  skipped boolean,
  replayed boolean,
  lock_lost boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_sync_key text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_sync_key, '')));
  v_lock_token text := pg_catalog.btrim(coalesce(p_lock_token, ''));
  v_commit_id text := pg_catalog.btrim(coalesce(p_commit_id, ''));
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_payload_digest text;
  v_commit public.softora_mailbox_uid_generation_commits%rowtype;
  v_sync public.softora_mailbox_sync_state%rowtype;
  v_lease_precheck_valid boolean := false;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_updated integer := 0;
begin
  if v_sync_key = '' or pg_catalog.char_length(v_sync_key) > 600
    or v_lock_token = '' or pg_catalog.char_length(v_lock_token) > 200
    or v_commit_id = '' or pg_catalog.char_length(v_commit_id) > 200
    or v_reason <> 'folder_missing' then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_GENERATION_SKIP_INVALID';
  end if;

  v_payload_digest := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'operation', 'skip', 'syncKey', v_sync_key,
      'lockToken', v_lock_token, 'reason', v_reason
    )::text, 'UTF8'), 'sha256'), 'hex');

  -- Remember the cheap lease snapshot, but never return from it: a concurrent
  -- identical skip may commit between this read and the advisory lock. The
  -- idempotency row is therefore always re-read after the shared fence.
  select state.* into v_sync
  from public.softora_mailbox_sync_state as state
  where state.sync_key = v_sync_key;
  v_lease_precheck_valid := found
    and v_sync.status = 'syncing'
    and v_sync.lock_token is not distinct from v_lock_token
    and v_sync.lock_expires_at is not null
    and v_sync.lock_expires_at > pg_catalog.clock_timestamp();

  -- Shared lock order: advisory -> campaign -> idempotency -> sync state ->
  -- generation rows. This matches commit/fail and prevents cross-finalizer
  -- deadlocks while making the lease token the only releasable ownership.
  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  perform 1 from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'MAILBOX_CAMPAIGN_FENCE_MISSING';
  end if;

  select mutation.* into v_commit
  from public.softora_mailbox_uid_generation_commits as mutation
  where mutation.commit_id = v_commit_id
  for update;
  if found and (v_commit.operation <> 'skip'
    or v_commit.payload_digest <> v_payload_digest
    or v_commit.sync_key <> v_sync_key) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_GENERATION_REPLAY_MISMATCH';
  elsif found and v_commit.status = 'completed' then
    return query select true, true, false;
    return;
  end if;

  if not v_lease_precheck_valid then
    perform 1 from public.softora_mailbox_sync_state as state
    where state.sync_key = v_sync_key
    for update;
    return query select false, false, true;
    return;
  end if;

  if v_commit.commit_id is null then
    insert into public.softora_mailbox_uid_generation_commits (
      commit_id, operation, payload_digest, sync_key, status, updated_at
    ) values (
      v_commit_id, 'skip', v_payload_digest, v_sync_key, 'pending', v_now
    ) returning * into v_commit;
  end if;

  select state.* into v_sync
  from public.softora_mailbox_sync_state as state
  where state.sync_key = v_sync_key
  for update;
  if not found or v_sync.status <> 'syncing'
    or v_sync.lock_token is distinct from v_lock_token
    or v_sync.lock_expires_at is null
    or v_sync.lock_expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_GENERATION_LEASE_INVALID';
  end if;

  perform generation.generation_id
  from public.softora_mailbox_uid_generations as generation
  where generation.generation_id = v_sync.active_uid_generation_id
    or generation.generation_id = v_sync.pending_uid_generation_id
  order by generation.generation_id
  for update;

  -- Preserve last_uid, message_count, UIDVALIDITY/reset time and both UUID
  -- generation pointers. A missing optional IMAP folder is not a reset.
  update public.softora_mailbox_sync_state as state
  set status = 'ok', last_synced_at = v_now, sync_started_at = null,
      lock_token = null, lock_expires_at = null, last_error = null,
      updated_at = v_now
  where state.sync_key = v_sync.sync_key
    and state.status = 'syncing'
    and state.lock_token is not distinct from v_lock_token;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_GENERATION_LEASE_INVALID';
  end if;

  update public.softora_mailbox_uid_generation_commits as mutation
  set status = 'completed', result = pg_catalog.jsonb_build_object(
        'skipped', true, 'replayed', false, 'lockLost', false,
        'reason', v_reason
      ), completed_at = v_now, updated_at = v_now
  where mutation.commit_id = v_commit_id;

  return query select true, false, false;
end;
$function$;

create or replace function public.softora_fail_mailbox_sync_v2(
  p_sync_key text,
  p_lock_token text,
  p_commit_id text,
  p_error text
)
returns table (
  applied boolean,
  lock_lost boolean,
  replayed boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_sync_key text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_sync_key, '')));
  v_lock_token text := pg_catalog.btrim(coalesce(p_lock_token, ''));
  v_commit_id text := pg_catalog.btrim(coalesce(p_commit_id, ''));
  v_error text := pg_catalog.btrim(coalesce(p_error, ''));
  v_payload_digest text;
  v_existing public.softora_mailbox_uid_generation_commits%rowtype;
  v_commit public.softora_mailbox_uid_generation_commits%rowtype;
  v_sync public.softora_mailbox_sync_state%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_sync_key = '' or pg_catalog.char_length(v_sync_key) > 600
    or v_lock_token = '' or pg_catalog.char_length(v_lock_token) > 200
    or v_commit_id = '' or pg_catalog.char_length(v_commit_id) > 200
    or v_error = '' or pg_catalog.char_length(v_error) > 4000 then
    raise exception using errcode = '22023', message = 'MAILBOX_UID_GENERATION_FAIL_INVALID';
  end if;

  v_payload_digest := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'operation', 'fail', 'syncKey', v_sync_key,
      'lockToken', v_lock_token, 'error', v_error
    )::text, 'UTF8'), 'sha256'), 'hex');

  -- A completed lost-response replay is immutable and does not need a lease.
  select mutation.* into v_existing
  from public.softora_mailbox_uid_generation_commits as mutation
  where mutation.commit_id = v_commit_id;
  if found and (
    v_existing.operation <> 'fail'
    or v_existing.payload_digest <> v_payload_digest
    or v_existing.sync_key <> v_sync_key
  ) then
    raise exception using errcode = '22023', message = 'MAILBOX_UID_GENERATION_REPLAY_MISMATCH';
  elsif found and v_existing.status = 'completed' then
    return query select true, false, true;
    return;
  end if;

  -- Cheap non-locking rejection keeps an already-invalid token at zero writes;
  -- the same lease is checked again under the mandated lock order below.
  select state.* into v_sync
  from public.softora_mailbox_sync_state as state
  where state.sync_key = v_sync_key;
  if not found or v_sync.status <> 'syncing'
    or v_sync.lock_token is distinct from v_lock_token
    or v_sync.lock_expires_at is null
    or v_sync.lock_expires_at <= pg_catalog.clock_timestamp() then
    return query select false, true, false;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  perform 1 from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  if not found then
    raise exception using errcode = '55000', message = 'MAILBOX_CAMPAIGN_FENCE_MISSING';
  end if;

  insert into public.softora_mailbox_uid_generation_commits (
    commit_id, operation, payload_digest, sync_key, status, updated_at
  ) values (
    v_commit_id, 'fail', v_payload_digest, v_sync_key, 'pending', v_now
  ) on conflict (commit_id) do nothing;

  select mutation.* into strict v_commit
  from public.softora_mailbox_uid_generation_commits as mutation
  where mutation.commit_id = v_commit_id
  for update;
  if v_commit.operation <> 'fail'
    or v_commit.payload_digest <> v_payload_digest
    or v_commit.sync_key <> v_sync_key then
    raise exception using errcode = '22023', message = 'MAILBOX_UID_GENERATION_REPLAY_MISMATCH';
  elsif v_commit.status = 'completed' then
    return query select true, false, true;
    return;
  end if;

  select state.* into v_sync
  from public.softora_mailbox_sync_state as state
  where state.sync_key = v_sync_key
  for update;
  if not found or v_sync.status <> 'syncing'
    or v_sync.lock_token is distinct from v_lock_token
    or v_sync.lock_expires_at is null
    or v_sync.lock_expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '55000', message = 'MAILBOX_UID_GENERATION_LEASE_INVALID';
  end if;

  perform generation.generation_id
  from public.softora_mailbox_uid_generations as generation
  where generation.generation_id = v_sync.active_uid_generation_id
    or generation.generation_id = v_sync.pending_uid_generation_id
  order by generation.generation_id
  for update;

  -- Cursor and both generation pointers are deliberately absent here.
  update public.softora_mailbox_sync_state as state
  set status = 'error', sync_started_at = null, lock_token = null,
      lock_expires_at = null, last_error = v_error, updated_at = v_now
  where state.sync_key = v_sync.sync_key;

  update public.softora_mailbox_uid_generation_commits as mutation
  set status = 'completed', result = pg_catalog.jsonb_build_object(
        'applied', true, 'lockLost', false
      ), completed_at = v_now, updated_at = v_now
  where mutation.commit_id = v_commit_id;

  return query select true, false, false;
end;
$function$;

alter table public.softora_mailbox_uid_generations enable row level security;
alter table public.softora_mailbox_uid_generation_staging enable row level security;
alter table public.softora_mailbox_uid_generation_commits enable row level security;

revoke all privileges on table public.softora_mailbox_uid_generations
  from public, anon, authenticated, service_role;
revoke all privileges on table public.softora_mailbox_uid_generation_staging
  from public, anon, authenticated, service_role;
revoke all privileges on table public.softora_mailbox_uid_generation_commits
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.softora_mailbox_uid_generations
  to service_role;
grant select, insert, update, delete on table public.softora_mailbox_uid_generation_staging
  to service_role;
grant select, insert, update, delete on table public.softora_mailbox_uid_generation_commits
  to service_role;

revoke all on function public.softora_enforce_mailbox_message_identity_immutable()
  from public, anon, authenticated, service_role;
revoke all on function public.softora_coerce_mailbox_uid_generation()
  from public, anon, authenticated, service_role;
revoke all on function public.softora_guard_mailbox_uid_generation_v2_state()
  from public, anon, authenticated, service_role;
revoke all on function public.softora_apply_mailbox_state_mutation(
  text, text, bigint, text, text, bigint, boolean, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.softora_mailbox_header_contains_message_id(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.softora_mailbox_row_matches_target_references(jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.softora_mailbox_target_references_are_anchored(text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.softora_freeze_legacy_mailbox_target_manifest()
  from public, anon, authenticated, service_role;
revoke all on function public.softora_prepare_mailbox_uid_generation_v3(
  text, text, bigint, bigint, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.softora_prepare_mailbox_uid_generation_v2(
  text, text, bigint, bigint, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.softora_confirm_mailbox_uid_baseline_v2(
  text, text, uuid, bigint, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.softora_checkpoint_mailbox_uid_target_manifest_v2(
  text, text, text, uuid, bigint, bigint, bigint, jsonb, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.softora_invalidate_mailbox_uid_target_manifest_v2(
  text, text, text, uuid, bigint, integer, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.softora_commit_mailbox_sync_pass_v2(
  text, text, text, uuid, bigint, text, jsonb, jsonb, jsonb,
  bigint, bigint, boolean, integer, bigint
) from public, anon, authenticated, service_role;
revoke all on function public.softora_skip_mailbox_sync_v2(
  text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.softora_fail_mailbox_sync_v2(
  text, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.softora_enforce_mailbox_message_identity_immutable()
  to service_role;
grant execute on function public.softora_coerce_mailbox_uid_generation()
  to service_role;
grant execute on function public.softora_guard_mailbox_uid_generation_v2_state()
  to service_role;
grant execute on function public.softora_apply_mailbox_state_mutation(
  text, text, bigint, text, text, bigint, boolean, boolean
) to service_role;
grant execute on function public.softora_mailbox_header_contains_message_id(text, text)
  to service_role;
grant execute on function public.softora_mailbox_row_matches_target_references(jsonb, jsonb)
  to service_role;
grant execute on function public.softora_mailbox_target_references_are_anchored(text, jsonb)
  to service_role;
grant execute on function public.softora_prepare_mailbox_uid_generation_v3(
  text, text, bigint, bigint, text, jsonb
) to service_role;
grant execute on function public.softora_prepare_mailbox_uid_generation_v2(
  text, text, bigint, bigint, text, jsonb
) to service_role;
grant execute on function public.softora_checkpoint_mailbox_uid_target_manifest_v2(
  text, text, text, uuid, bigint, bigint, bigint, jsonb, boolean
) to service_role;
grant execute on function public.softora_invalidate_mailbox_uid_target_manifest_v2(
  text, text, text, uuid, bigint, integer, jsonb
) to service_role;
grant execute on function public.softora_confirm_mailbox_uid_baseline_v2(
  text, text, uuid, bigint, jsonb
) to service_role;
grant execute on function public.softora_commit_mailbox_sync_pass_v2(
  text, text, text, uuid, bigint, text, jsonb, jsonb, jsonb,
  bigint, bigint, boolean, integer, bigint
) to service_role;
grant execute on function public.softora_skip_mailbox_sync_v2(
  text, text, text, text
) to service_role;
grant execute on function public.softora_fail_mailbox_sync_v2(
  text, text, text, text
) to service_role;

comment on function public.softora_prepare_mailbox_uid_generation_v3(
  text, text, bigint, bigint, text, jsonb
) is 'Fenced prepare/resume for full-window and anchored sparse UUID generations, including durable target-manifest progress, frozen pending targets and post-activation drift detection.';
comment on function public.softora_prepare_mailbox_uid_generation_v2(
  text, text, bigint, bigint, text, jsonb
) is 'Backward-compatible 13-column projection of mailbox UID generation prepare v3 for safe database-before-runtime rollout and rollback.';
comment on function public.softora_checkpoint_mailbox_uid_target_manifest_v2(
  text, text, text, uuid, bigint, bigint, bigint, jsonb, boolean
) is 'Idempotently checkpoints a lease-fenced bounded All Mail UID header scan, freezes the complete sparse manifest, and releases incomplete leases.';
comment on function public.softora_invalidate_mailbox_uid_target_manifest_v2(
  text, text, text, uuid, bigint, integer, jsonb
) is 'Idempotently abandons only a fenced pending sparse generation, or invalidates only active manifest reuse, after an exact missing-UID proof while retaining visible active content.';
comment on function public.softora_confirm_mailbox_uid_baseline_v2(
  text, text, uuid, bigint, jsonb
) is 'Atomically adopts an exactly proven legacy NULL-UIDVALIDITY baseline while retaining its lease.';
comment on function public.softora_commit_mailbox_sync_pass_v2(
  text, text, text, uuid, bigint, text, jsonb, jsonb, jsonb,
  bigint, bigint, boolean, integer, bigint
) is 'Idempotent fenced full-window or anchored sparse mailbox commit with atomic visibility and policy-specific cursor semantics.';
comment on function public.softora_skip_mailbox_sync_v2(
  text, text, text, text
) is 'Lease-fenced idempotent folder_missing finalizer that preserves cursor, UIDVALIDITY, message count and active/pending generation pointers.';
comment on function public.softora_fail_mailbox_sync_v2(
  text, text, text, text
) is 'Fenced idempotent failure finalizer that preserves mailbox cursor and generation state.';
comment on function public.softora_apply_mailbox_state_mutation(
  text, text, bigint, text, text, bigint, boolean, boolean
) is 'Applies idempotent mailbox UI state only to a non-deleted row in the currently visible UID generation.';

-- Recheck the drain immediately before the forward-only switch. Writers can
-- start waiting while the DDL above runs; any such waiter aborts this whole
-- transaction instead of being allowed to cross the legacy/v2 boundary.
do $uid_protocol_activate$
declare
  v_consistency public.softora_mailbox_campaign_consistency%rowtype;
  v_relevant_relations pg_catalog.oid[] := array[
    'public.softora_mailbox_campaign_consistency'::pg_catalog.regclass::pg_catalog.oid,
    'public.softora_mailbox_sync_state'::pg_catalog.regclass::pg_catalog.oid,
    'public.softora_mailbox_messages'::pg_catalog.regclass::pg_catalog.oid,
    'public.softora_mailbox_uid_generations'::pg_catalog.regclass::pg_catalog.oid,
    'public.softora_mailbox_uid_generation_staging'::pg_catalog.regclass::pg_catalog.oid,
    'public.softora_mailbox_uid_generation_commits'::pg_catalog.regclass::pg_catalog.oid
  ];
  v_now timestamptz;
  v_updated integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  select consistency.* into v_consistency
  from public.softora_mailbox_campaign_consistency as consistency
  where consistency.scope = 'campaign'
  for update;

  if not found
    or v_consistency.uid_generation_protocol is distinct from 'draining'
    or v_consistency.uid_generation_drain_started_at is null
    or v_consistency.uid_generation_drain_ready_at is null
    or v_consistency.uid_generation_drain_ready_at > pg_catalog.clock_timestamp() then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_DRAIN_CHANGED';
  end if;
  if exists (
    select 1
    from public.softora_mailbox_sync_state as active_sync
    where active_sync.status = 'syncing'
      and nullif(pg_catalog.btrim(active_sync.lock_token), '') is not null
      and active_sync.lock_expires_at > pg_catalog.clock_timestamp()
  ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_ACTIVE_LEASES';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_locks as waiting_lock
    left join pg_catalog.pg_stat_activity as activity
      on activity.pid = waiting_lock.pid
    where waiting_lock.granted is false
      and waiting_lock.pid <> pg_catalog.pg_backend_pid()
      and (
        (
          waiting_lock.locktype = 'advisory'
          and waiting_lock.database = (
            select database.oid
            from pg_catalog.pg_database as database
            where database.datname = pg_catalog.current_database()
          )
          and waiting_lock.classid = 824031::pg_catalog.oid
          and waiting_lock.objid = 3::pg_catalog.oid
          and waiting_lock.objsubid = 2
        )
        or waiting_lock.relation = any (v_relevant_relations)
        or coalesce(activity.query, '') ilike '%softora_mailbox%'
      )
  ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_WAITING_WRITERS';
  end if;

  v_now := greatest(
    pg_catalog.clock_timestamp(),
    v_consistency.uid_generation_protocol_changed_at + interval '1 microsecond'
  );
  perform pg_catalog.set_config(
    'softora.mailbox_uid_protocol_transition', '1', true
  );
  update public.softora_mailbox_campaign_consistency as consistency
  set uid_generation_protocol = 'v2',
      uid_generation_protocol_changed_at = v_now,
      updated_at = v_now
  where consistency.scope = 'campaign'
    and consistency.uid_generation_protocol = 'draining'
    and consistency.uid_generation_drain_ready_at <= pg_catalog.clock_timestamp();
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_ACTIVATION_FAILED';
  end if;
end;
$uid_protocol_activate$;
notify pgrst, 'reload schema';
-- mailbox-uid-generation-epoch-v2:end

-- mailbox-final-activation-lineage-batch:start
--
-- A staged UID rebuild writes only a few rows per pass, but its final pass
-- atomically materializes the complete generation and retires the previous
-- snapshot. The lineage row trigger used to rebuild the same impacted graph
-- once for every inserted and retired copy. Keep its exact root/edge updates,
-- suppress only those repeated graph rebuilds during the fenced activation,
-- and rebuild the union of affected keys once before the generation pointer
-- becomes visible.

do $preflight$
declare
  v_protocol text;
  v_trigger_enabled "char";
  v_signature text;
begin
  select consistency.uid_generation_protocol into v_protocol
  from public.softora_mailbox_campaign_consistency as consistency
  where consistency.scope = 'campaign';
  if not found or v_protocol is distinct from 'v2' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_LINEAGE_REQUIRES_V2';
  end if;

  foreach v_signature in array array[
    'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
    'public.softora_refresh_mailbox_message_lineage()',
    'public.softora_refresh_mailbox_campaign_lineage_impacts(text,text,text[])',
    'public.softora_rebuild_mailbox_campaign_lineage(text,text[],boolean,jsonb)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception using errcode = '55000',
        message = 'MAILBOX_FINAL_ACTIVATION_LINEAGE_FUNCTION_MISSING',
        detail = v_signature;
    end if;
  end loop;

  if pg_catalog.to_regclass('public.softora_mailbox_messages') is null
    or pg_catalog.to_regclass('public.softora_mailbox_uid_generations') is null
    or pg_catalog.to_regclass('public.softora_mailbox_message_lineage_edges') is null
    or pg_catalog.to_regclass('public.softora_mailbox_campaign_lineage_roots') is null
    or pg_catalog.to_regclass('public.softora_mailbox_campaign_lineage_members') is null
    or pg_catalog.to_regclass('public.softora_mailbox_campaign_lineage_discoveries') is null then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_LINEAGE_TABLE_MISSING';
  end if;

  select trigger_row.tgenabled into v_trigger_enabled
  from pg_catalog.pg_trigger as trigger_row
  where trigger_row.tgrelid = 'public.softora_mailbox_messages'::pg_catalog.regclass
    and trigger_row.tgname = 'softora_refresh_mailbox_message_lineage'
    and not trigger_row.tgisinternal;
  if not found or v_trigger_enabled = 'D' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_LINEAGE_TRIGGER_MISSING';
  end if;
end;
$preflight$;

create or replace function pg_temp.softora_replace_final_activation_fragment(
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
      message = 'MAILBOX_FINAL_ACTIVATION_LINEAGE_PATCH_TARGET_INVALID',
      detail = p_label;
  end if;
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  v_matches := (
    pg_catalog.char_length(v_definition)
    - pg_catalog.char_length(pg_catalog.replace(v_definition, p_old, ''))
  ) / pg_catalog.char_length(p_old);
  if v_matches <> 1 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_LINEAGE_PATCH_DRIFT',
      detail = p_label || ': expected one fragment, found ' || v_matches::text;
  end if;
  execute pg_catalog.replace(v_definition, p_old, p_new);
end;
$function$;

-- A transaction-local setting is trusted only after every identity carried by
-- the affected row matches its exact activation scope. Invalid JSON, extra or
-- missing keys, and unrelated message writes abort instead of silently
-- suppressing lineage work.
create or replace function public.softora_mailbox_lineage_activation_row_matches_v2(
  p_operation text,
  p_old_account_email text,
  p_old_folder text,
  p_old_generation_id uuid,
  p_old_superseded_at timestamptz,
  p_new_account_email text,
  p_new_folder text,
  p_new_generation_id uuid,
  p_new_superseded_at timestamptz
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_raw_scope text := coalesce(pg_catalog.current_setting(
    'softora.mailbox_lineage_batch_activation_v2', true
  ), '');
  v_scope jsonb;
  v_scope_key_count integer := 0;
  v_operation text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_operation, '')));
  v_sync_key text;
  v_account_email text;
  v_folder text;
  v_old_generation_id text;
  v_new_generation_id text;
  v_old_generation_is_null boolean;
  v_old_generation_uuid uuid;
  v_new_generation_uuid uuid;
begin
  if v_raw_scope = '' then
    return false;
  end if;
  begin
    v_scope := v_raw_scope::jsonb;
  exception when others then
    raise exception using errcode = '55000',
      message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
  end;

  if pg_catalog.jsonb_typeof(v_scope) is distinct from 'object' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
  end if;
  select pg_catalog.count(*)::integer into v_scope_key_count
  from pg_catalog.jsonb_object_keys(v_scope) as scope_key(value);
  if v_scope_key_count <> 5
    or not (v_scope ?& array[
      'syncKey', 'accountEmail', 'folder',
      'oldGenerationId', 'newGenerationId'
    ]::text[])
    or pg_catalog.jsonb_typeof(v_scope->'syncKey') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_scope->'accountEmail') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_scope->'folder') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_scope->'newGenerationId') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_scope->'oldGenerationId')
      not in ('string', 'null') then
    raise exception using errcode = '55000',
      message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
  end if;

  v_sync_key := pg_catalog.lower(pg_catalog.btrim(v_scope->>'syncKey'));
  v_account_email := pg_catalog.lower(pg_catalog.btrim(v_scope->>'accountEmail'));
  v_folder := pg_catalog.lower(pg_catalog.btrim(v_scope->>'folder'));
  v_old_generation_id := pg_catalog.lower(pg_catalog.btrim(coalesce(
    v_scope->>'oldGenerationId', ''
  )));
  v_new_generation_id := pg_catalog.lower(pg_catalog.btrim(coalesce(
    v_scope->>'newGenerationId', ''
  )));
  v_old_generation_is_null := v_scope->'oldGenerationId' = 'null'::jsonb;

  begin
    v_new_generation_uuid := v_new_generation_id::uuid;
    if not v_old_generation_is_null then
      v_old_generation_uuid := v_old_generation_id::uuid;
    end if;
  exception when invalid_text_representation then
    raise exception using errcode = '55000',
      message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
  end;

  if coalesce(pg_catalog.current_setting(
      'softora.mailbox_sync_per_key_v2', true
    ), '') is distinct from '1'
    or coalesce(pg_catalog.current_setting(
      'softora.mailbox_uid_generation_v2_transition', true
    ), '') is distinct from '1'
    or v_sync_key = ''
    or pg_catalog.char_length(v_sync_key) > 600
    or v_sync_key <> v_scope->>'syncKey'
    or v_account_email = ''
    or pg_catalog.char_length(v_account_email) > 320
    or v_account_email <> v_scope->>'accountEmail'
    or v_folder = ''
    or pg_catalog.char_length(v_folder) > 200
    or v_folder <> v_scope->>'folder'
    or v_sync_key is distinct from (v_account_email || '|' || v_folder)
    or v_new_generation_id = ''
    or v_new_generation_id is distinct from v_new_generation_uuid::text
    or (
      not v_old_generation_is_null
      and v_old_generation_id is distinct from v_old_generation_uuid::text
    ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
  end if;

  if v_operation = 'INSERT' then
    if pg_catalog.lower(pg_catalog.btrim(coalesce(p_new_account_email, '')))
        <> v_account_email
      or pg_catalog.lower(pg_catalog.btrim(coalesce(p_new_folder, '')))
        <> v_folder
      or p_new_generation_id is distinct from v_new_generation_uuid
      or p_new_superseded_at is not null then
      raise exception using errcode = '55000',
        message = 'MAILBOX_LINEAGE_ACTIVATION_ROW_SCOPE_MISMATCH';
    end if;
  elsif v_operation = 'UPDATE' then
    if pg_catalog.lower(pg_catalog.btrim(coalesce(p_old_account_email, '')))
        <> v_account_email
      or pg_catalog.lower(pg_catalog.btrim(coalesce(p_old_folder, '')))
        <> v_folder
      or pg_catalog.lower(pg_catalog.btrim(coalesce(p_new_account_email, '')))
        <> v_account_email
      or pg_catalog.lower(pg_catalog.btrim(coalesce(p_new_folder, '')))
        <> v_folder
      or (
        -- ON CONFLICT on a row already belonging to the new generation.
        p_old_generation_id is not distinct from v_new_generation_uuid
          and p_new_generation_id is not distinct from v_new_generation_uuid
          and p_old_superseded_at is null
          and p_new_superseded_at is null
        or
        -- Exact retirement of the previous active/legacy generation.
        p_new_generation_id is not distinct from p_old_generation_id
          and p_old_superseded_at is null
          and p_new_superseded_at is not null
          and (
            v_old_generation_is_null and p_old_generation_id is null
            or not v_old_generation_is_null
              and p_old_generation_id is not distinct from v_old_generation_uuid
          )
      ) is not true then
      raise exception using errcode = '55000',
        message = 'MAILBOX_LINEAGE_ACTIVATION_ROW_SCOPE_MISMATCH';
    end if;
  else
    raise exception using errcode = '55000',
      message = 'MAILBOX_LINEAGE_ACTIVATION_ROW_OPERATION_INVALID';
  end if;
  return true;
end;
$function$;

-- This is the set-based counterpart of
-- softora_refresh_mailbox_campaign_lineage_impacts. It accepts every old and
-- new physical key involved in one activation, expands the existing edge/root
-- impact and descendants once, then preserves the existing discovery rules.
create or replace function public.softora_refresh_mailbox_activation_lineage_v2(
  p_account_email text,
  p_folder text,
  p_generation_id uuid,
  p_retired_message_keys text[]
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
  v_message_keys text[];
  v_message_ids text[];
  v_direct_keys text[];
  v_rebuild_keys text[];
  v_previous_roots jsonb;
begin
  if v_account_email = '' or pg_catalog.char_length(v_account_email) > 320
    or v_folder = '' or pg_catalog.char_length(v_folder) > 200
    or p_generation_id is null
    or pg_catalog.strpos(v_account_email, '|') > 0
    or pg_catalog.strpos(v_folder, '|') > 0
    or exists (
      select 1
      from pg_catalog.unnest(coalesce(p_retired_message_keys, '{}'::text[]))
        as retired(message_key)
      where nullif(pg_catalog.btrim(retired.message_key), '') is null
    ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_FINAL_ACTIVATION_LINEAGE_INPUT_INVALID';
  end if;

  perform 1
  from public.softora_mailbox_uid_generations as generation
  where generation.generation_id = p_generation_id
    and generation.account_email = v_account_email
    and generation.folder = v_folder
    and generation.status = 'staging';
  if not found then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_LINEAGE_GENERATION_INVALID';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(coalesce(p_retired_message_keys, '{}'::text[]))
      as retired(message_key)
    left join public.softora_mailbox_messages as message
      on message.message_key = retired.message_key
    where message.message_key is null
      or message.account_email <> v_account_email
      or message.folder <> v_folder
      or message.generation_superseded_at is null
  ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_LINEAGE_RETIRED_SCOPE_INVALID';
  end if;

  select coalesce(
    pg_catalog.array_agg(candidate.message_key order by candidate.message_key),
    '{}'::text[]
  ) into v_message_keys
  from (
    select distinct retired.message_key
    from pg_catalog.unnest(coalesce(p_retired_message_keys, '{}'::text[]))
      as retired(message_key)
    union
    select message.message_key
    from public.softora_mailbox_messages as message
    where message.account_email = v_account_email
      and message.folder = v_folder
      and message.uid_generation_id = p_generation_id
  ) as candidate;

  select coalesce(
    pg_catalog.array_agg(distinct normalized.message_id),
    '{}'::text[]
  ) into v_message_ids
  from (
    select public.softora_normalize_mailbox_message_id(message.message_id)
      as message_id
    from public.softora_mailbox_messages as message
    where message.message_key = any (v_message_keys)
  ) as normalized
  where normalized.message_id is not null;

  select coalesce(
    pg_catalog.array_agg(distinct impacted.message_key),
    '{}'::text[]
  ) into v_direct_keys
  from (
    select changed.message_key
    from pg_catalog.unnest(v_message_keys) as changed(message_key)
    union
    select edge.child_message_key
    from public.softora_mailbox_message_lineage_edges as edge
    where edge.account_email = v_account_email
      and edge.parent_message_id = any (v_message_ids)
    union
    select root.message_key
    from public.softora_mailbox_campaign_lineage_roots as root
    where root.account_email = v_account_email
      and root.message_id = any (v_message_ids)
  ) as impacted;

  with recursive impacted_members as (
    select member.message_key
    from public.softora_mailbox_campaign_lineage_members as member
    where member.account_email = v_account_email
      and member.message_key = any (v_direct_keys)
    union
    select child.message_key
    from impacted_members
    join public.softora_mailbox_campaign_lineage_members as child
      on child.parent_message_key = impacted_members.message_key
  )
  select coalesce(
    pg_catalog.array_agg(distinct rebuild.message_key),
    '{}'::text[]
  ) into v_rebuild_keys
  from (
    select direct_key.message_key
    from pg_catalog.unnest(v_direct_keys) as direct_key(message_key)
    union
    select impacted_members.message_key from impacted_members
  ) as rebuild;

  select coalesce(
    pg_catalog.jsonb_object_agg(member.message_key, member.root_message_key),
    '{}'::jsonb
  ) into v_previous_roots
  from public.softora_mailbox_campaign_lineage_members as member
  where member.account_email = v_account_email
    and member.message_key = any (v_rebuild_keys);

  delete from public.softora_mailbox_campaign_lineage_members as member
  where member.account_email = v_account_email
    and member.message_key = any (v_rebuild_keys);

  perform public.softora_rebuild_mailbox_campaign_lineage(
    v_account_email,
    v_rebuild_keys,
    false,
    v_previous_roots
  );

  update public.softora_mailbox_campaign_lineage_discoveries as discovery
  set active = false,
      last_disconnected_at = pg_catalog.clock_timestamp()
  where discovery.account_email = v_account_email
    and discovery.message_key = any (v_rebuild_keys)
    and discovery.active
    and not exists (
      select 1
      from public.softora_mailbox_campaign_lineage_members as current_member
      where current_member.message_key = discovery.message_key
        and current_member.root_message_key = discovery.root_message_key
    );

  -- All directly changed physical copies have reached their final visibility
  -- state now. No retired/deleted copy may retain an edge, root or member, and
  -- every rebuilt artifact must agree with its visible source message.
  if exists (
    select 1
    from public.softora_mailbox_campaign_lineage_roots as root
    join public.softora_mailbox_messages as message
      on message.message_key = root.message_key
    where root.message_key = any (v_rebuild_keys)
      and (
        message.deleted_at is not null
        or message.generation_superseded_at is not null
        or message.account_email <> v_account_email
        or root.account_email <> v_account_email
        or root.message_id is distinct from
          public.softora_normalize_mailbox_message_id(message.message_id)
      )
  ) or exists (
    select 1
    from public.softora_mailbox_message_lineage_edges as edge
    join public.softora_mailbox_messages as message
      on message.message_key = edge.child_message_key
    where edge.child_message_key = any (v_rebuild_keys)
      and (
        message.deleted_at is not null
        or message.generation_superseded_at is not null
        or message.account_email <> v_account_email
        or edge.account_email <> v_account_email
        or edge.child_message_id is distinct from
          public.softora_normalize_mailbox_message_id(message.message_id)
      )
  ) or exists (
    select 1
    from public.softora_mailbox_campaign_lineage_members as member
    join public.softora_mailbox_messages as message
      on message.message_key = member.message_key
    join public.softora_mailbox_messages as root_message
      on root_message.message_key = member.root_message_key
    where member.message_key = any (v_rebuild_keys)
      and (
        message.deleted_at is not null
        or message.generation_superseded_at is not null
        or root_message.deleted_at is not null
        or root_message.generation_superseded_at is not null
        or message.account_email <> v_account_email
        or member.account_email <> v_account_email
        or member.message_id is distinct from
          public.softora_normalize_mailbox_message_id(message.message_id)
      )
  ) or exists (
    select 1
    from public.softora_mailbox_campaign_lineage_discoveries as discovery
    where discovery.account_email = v_account_email
      and discovery.message_key = any (v_rebuild_keys)
      and discovery.active
      and not exists (
        select 1
        from public.softora_mailbox_campaign_lineage_members as current_member
        where current_member.message_key = discovery.message_key
          and current_member.root_message_key = discovery.root_message_key
      )
  ) or exists (
    select 1
    from pg_catalog.unnest(coalesce(p_retired_message_keys, '{}'::text[]))
      as retired(message_key)
    where exists (
      select 1 from public.softora_mailbox_campaign_lineage_roots as root
      where root.message_key = retired.message_key
    ) or exists (
      select 1 from public.softora_mailbox_message_lineage_edges as edge
      where edge.child_message_key = retired.message_key
    ) or exists (
      select 1 from public.softora_mailbox_campaign_lineage_members as member
      where member.message_key = retired.message_key
    )
  ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_LINEAGE_POSTCONDITION_FAILED';
  end if;
end;
$function$;

-- The row trigger keeps maintaining roots and direct-parent edges. Only its
-- recursive impact refresh is coalesced while the finalizer owns the explicit
-- activation flag.
select pg_temp.softora_replace_final_activation_fragment(
  'public.softora_refresh_mailbox_message_lineage()',
  $old$  if v_old_account <> '' and v_old_account = v_new_account then
    perform public.softora_refresh_mailbox_campaign_lineage_impacts(
      v_old_account,
      v_message_key,
      array[v_old_message_id, v_new_message_id]
    );
  else
    if v_old_account <> '' then
      perform public.softora_refresh_mailbox_campaign_lineage_impacts(
        v_old_account,
        v_message_key,
        array[v_old_message_id]
      );
    end if;
    if v_new_account <> '' then
      perform public.softora_refresh_mailbox_campaign_lineage_impacts(
        v_new_account,
        v_message_key,
        array[v_new_message_id]
      );
    end if;
  end if;$old$,
  $new$  if coalesce(pg_catalog.current_setting(
    'softora.mailbox_lineage_batch_activation_v2', true
  ), '') = '' or public.softora_mailbox_lineage_activation_row_matches_v2(
    tg_op,
    case when tg_op = 'INSERT' then null else old.account_email end,
    case when tg_op = 'INSERT' then null else old.folder end,
    case when tg_op = 'INSERT' then null else old.uid_generation_id end,
    case when tg_op = 'INSERT' then null else old.generation_superseded_at end,
    case when tg_op = 'DELETE' then null else new.account_email end,
    case when tg_op = 'DELETE' then null else new.folder end,
    case when tg_op = 'DELETE' then null else new.uid_generation_id end,
    case when tg_op = 'DELETE' then null else new.generation_superseded_at end
  ) is not true then
    if v_old_account <> '' and v_old_account = v_new_account then
      perform public.softora_refresh_mailbox_campaign_lineage_impacts(
        v_old_account,
        v_message_key,
        array[v_old_message_id, v_new_message_id]
      );
    else
      if v_old_account <> '' then
        perform public.softora_refresh_mailbox_campaign_lineage_impacts(
          v_old_account,
          v_message_key,
          array[v_old_message_id]
        );
      end if;
      if v_new_account <> '' then
        perform public.softora_refresh_mailbox_campaign_lineage_impacts(
          v_new_account,
          v_message_key,
          array[v_new_message_id]
        );
      end if;
    end if;
  end if;$new$,
  'lineage trigger: coalesce recursive impact refresh only during activation'
);

-- Add one transaction-local key list to the reviewed finalizer and activate
-- batching only after every snapshot/coverage guard has passed.
select pg_temp.softora_replace_final_activation_fragment(
  'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
  $old$  v_snapshot_digest text;
  v_result jsonb;
begin$old$,
  $new$  v_snapshot_digest text;
  v_result jsonb;
  v_retired_message_keys text[] := '{}'::text[];
begin$new$,
  'commit activation: declare exact retired-key set'
);

select pg_temp.softora_replace_final_activation_fragment(
  'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
  $old$  from public.softora_mailbox_uid_generation_staging as staged
  where staged.generation_id = p_generation_id;

  insert into public.softora_mailbox_messages as stored_message ($old$,
  $new$  from public.softora_mailbox_uid_generation_staging as staged
  where staged.generation_id = p_generation_id;

  select coalesce(
    pg_catalog.array_agg(old_message.message_key order by old_message.message_key),
    '{}'::text[]
  ) into v_retired_message_keys
  from public.softora_mailbox_messages as old_message
  where old_message.account_email = v_sync.account_email
    and old_message.folder = v_sync.folder
    and old_message.uid_generation_id is distinct from p_generation_id
    and old_message.generation_superseded_at is null;

  perform pg_catalog.set_config(
    'softora.mailbox_lineage_batch_activation_v2',
    pg_catalog.jsonb_build_object(
      'syncKey', v_sync.sync_key,
      'accountEmail', v_sync.account_email,
      'folder', v_sync.folder,
      'oldGenerationId', v_sync.active_uid_generation_id,
      'newGenerationId', p_generation_id
    )::text,
    true
  );

  insert into public.softora_mailbox_messages as stored_message ($new$,
  'commit activation: capture old keys and enable batch lineage'
);

select pg_temp.softora_replace_final_activation_fragment(
  'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
  $old$  where old_message.account_email = v_sync.account_email
    and old_message.folder = v_sync.folder
    and old_message.uid_generation_id is distinct from p_generation_id
    and old_message.generation_superseded_at is null;

  if v_active.generation_id is not null then$old$,
  $new$  where old_message.account_email = v_sync.account_email
    and old_message.folder = v_sync.folder
    and (
      v_sync.active_uid_generation_id is null
        and old_message.uid_generation_id is null
      or v_sync.active_uid_generation_id is not null
        and old_message.uid_generation_id = v_sync.active_uid_generation_id
    )
    and old_message.generation_superseded_at is null;

  perform pg_catalog.set_config(
    'softora.mailbox_lineage_batch_activation_v2', '', true
  );

  -- The healthy invariant has exactly one visible old generation. Preserve the
  -- former broad cleanup as a fail-safe for any historical stale generation,
  -- but run that exceptional remainder with ordinary per-row lineage impact.
  -- This keeps the batch scope exact without ever leaving stale visible rows.
  update public.softora_mailbox_messages as stale_message
  set generation_superseded_at = coalesce(
        stale_message.generation_superseded_at, v_now
      ),
      deleted_at = coalesce(stale_message.deleted_at, v_now),
      updated_at = v_now
  where stale_message.account_email = v_sync.account_email
    and stale_message.folder = v_sync.folder
    and stale_message.uid_generation_id is distinct from p_generation_id
    and stale_message.generation_superseded_at is null;

  perform public.softora_refresh_mailbox_activation_lineage_v2(
    v_sync.account_email,
    v_sync.folder,
    p_generation_id,
    v_retired_message_keys
  );

  if v_active.generation_id is not null then$new$,
  'commit activation: rebuild the combined lineage impact once'
);

revoke all on function public.softora_refresh_mailbox_activation_lineage_v2(
  text, text, uuid, text[]
) from public, anon, authenticated, service_role;
grant execute on function public.softora_refresh_mailbox_activation_lineage_v2(
  text, text, uuid, text[]
) to service_role;
revoke all on function public.softora_mailbox_lineage_activation_row_matches_v2(
  text, text, text, uuid, timestamptz, text, text, uuid, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.softora_mailbox_lineage_activation_row_matches_v2(
  text, text, text, uuid, timestamptz, text, text, uuid, timestamptz
) to service_role;

comment on function public.softora_refresh_mailbox_activation_lineage_v2(
  text, text, uuid, text[]
) is 'Rebuilds the combined old/new lineage impact exactly once inside a fenced final UID-generation activation.';
comment on function public.softora_mailbox_lineage_activation_row_matches_v2(
  text, text, text, uuid, timestamptz, text, text, uuid, timestamptz
) is 'Fails closed unless a row belongs exactly to the transaction-local old/new UID-generation activation scope.';

notify pgrst, 'reload schema';
-- mailbox-final-activation-lineage-batch:end

-- mailbox-final-activation-scale:start
--
-- Final UID-generation activation must stay comfortably below the mailbox
-- client's fixed deadline even when a Sent snapshot, several historical
-- generations and many logical tombstones are involved. Preserve the exact
-- activation semantics while making its remaining hot paths index/set based:
-- canonical Message-ID lookup, prior-state inheritance, campaign-lineage
-- resolution and stale retirement.

do $preflight$
declare
  v_protocol text;
  v_definition text;
  v_oid pg_catalog.oid;
  v_signature text;
  v_resolver_calls integer;
begin
  select consistency.uid_generation_protocol into v_protocol
  from public.softora_mailbox_campaign_consistency as consistency
  where consistency.scope = 'campaign';
  if not found or v_protocol is distinct from 'v2' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_REQUIRES_V2';
  end if;

  if pg_catalog.to_regclass('public.softora_mailbox_messages') is null
    or pg_catalog.to_regclass('public.softora_mailbox_uid_generations') is null
    or pg_catalog.to_regclass('public.softora_mailbox_uid_generation_staging') is null
    or pg_catalog.to_regclass(
      'public.softora_mailbox_campaign_lineage_discoveries'
    ) is null
    or pg_catalog.to_regclass(
      'public.softora_mailbox_campaign_lineage_members'
    ) is null then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_TABLE_MISSING';
  end if;

  if pg_catalog.to_regclass(
      'public.softora_mailbox_messages_prior_state_active_idx'
    ) is not null then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_INDEX_DRIFT';
  end if;

  if pg_catalog.to_regclass(
      'public.softora_mailbox_message_id_exact_lookup_idx'
    ) is not null then
    v_definition := pg_catalog.pg_get_indexdef(pg_catalog.to_regclass(
      'public.softora_mailbox_message_id_exact_lookup_idx'
    ));
    if v_definition is distinct from
      'CREATE INDEX softora_mailbox_message_id_exact_lookup_idx ON public.softora_mailbox_messages USING btree (account_email, softora_normalize_mailbox_message_id(message_id)) WHERE ((deleted_at IS NULL) AND (NULLIF(btrim(message_id), ''''::text) IS NOT NULL))' then
      raise exception using errcode = '55000',
        message = 'MAILBOX_FINAL_ACTIVATION_SCALE_CANONICAL_INDEX_DRIFT';
    end if;
  end if;

  foreach v_signature in array array[
    'public.softora_normalize_mailbox_message_id(text)',
    'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
    'public.softora_mailbox_lineage_activation_row_matches_v2(text,text,text,uuid,timestamptz,text,text,uuid,timestamptz)',
    'public.softora_refresh_mailbox_activation_lineage_v2(text,text,uuid,text[])',
    'public.softora_resolve_mailbox_campaign_lineage(text,text[])',
    'public.softora_rebuild_mailbox_campaign_lineage(text,text[],boolean,jsonb)'
  ] loop
    v_oid := pg_catalog.to_regprocedure(v_signature);
    if v_oid is null then
      raise exception using errcode = '55000',
        message = 'MAILBOX_FINAL_ACTIVATION_SCALE_FUNCTION_MISSING',
        detail = v_signature;
    end if;
    if exists (
      select 1
      from pg_catalog.pg_proc as procedure
      where procedure.oid = v_oid
        and procedure.prosecdef
    ) then
      raise exception using errcode = '55000',
        message = 'MAILBOX_FINAL_ACTIVATION_SCALE_SECURITY_DRIFT',
        detail = v_signature;
    end if;
  end loop;

  select procedure.provolatile into strict v_protocol
  from pg_catalog.pg_proc as procedure
  where procedure.oid =
    'public.softora_normalize_mailbox_message_id(text)'::pg_catalog.regprocedure;
  if v_protocol is distinct from 'i' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_NORMALIZER_NOT_IMMUTABLE';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)'::pg_catalog.regprocedure
  );
  if pg_catalog.strpos(v_definition, 'v_retired_message_keys text[]') = 0
    or pg_catalog.strpos(v_definition, '''oldGenerationId''') = 0
    or (
      pg_catalog.char_length(v_definition)
      - pg_catalog.char_length(pg_catalog.replace(
        pg_catalog.lower(v_definition), 'left join ' || 'lateral (', ''
      ))
    ) / pg_catalog.char_length('left join ' || 'lateral (') <> 1
    or pg_catalog.strpos(
      v_definition,
      'softora.mailbox_lineage_batch_activation_v2'
    ) = 0 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_COMMIT_DRIFT';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.softora_mailbox_lineage_activation_row_matches_v2(text,text,text,uuid,timestamptz,text,text,uuid,timestamptz)'::pg_catalog.regprocedure
  );
  if pg_catalog.strpos(v_definition, '''oldGenerationId''') = 0
    or pg_catalog.strpos(v_definition, '''oldGenerationIds''') > 0
    or pg_catalog.strpos(v_definition, 'v_scope_key_count <> 5') = 0 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_SCOPE_DRIFT';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.softora_rebuild_mailbox_campaign_lineage(text,text[],boolean,jsonb)'::pg_catalog.regprocedure
  );
  v_resolver_calls := (
    pg_catalog.char_length(v_definition)
    - pg_catalog.char_length(pg_catalog.replace(
      v_definition,
      'public.softora_resolve_mailbox_campaign_lineage(',
      ''
    ))
  ) / pg_catalog.char_length(
    'public.softora_resolve_mailbox_campaign_lineage('
  );
  if v_resolver_calls <> 2
    or pg_catalog.strpos(
      v_definition,
      'on conflict (message_key, root_message_key) do update set'
    ) = 0
    or pg_catalog.strpos(
      v_definition,
      'first_discovered_at = case'
    ) = 0
    or pg_catalog.strpos(
      v_definition,
      'when coalesce(p_previous_roots'
    ) = 0
    or pg_catalog.strpos(
      v_definition,
      'on conflict (message_key) do update set'
    ) = 0 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_REBUILD_DRIFT';
  end if;
end;
$preflight$;

-- The existing exact-lookup index used a raw non-empty predicate that the
-- planner could not infer from normalized equality, so canonical lookups
-- ignored it. Rebuild the same physical index with the resolver's exact
-- predicate instead of keeping a redundant parallel index.
drop index if exists public.softora_mailbox_message_id_exact_lookup_idx;
create index softora_mailbox_message_id_exact_lookup_idx
on public.softora_mailbox_messages (
  account_email,
  public.softora_normalize_mailbox_message_id(message_id)
)
where deleted_at is null
  and public.softora_normalize_mailbox_message_id(message_id) is not null;

create index if not exists softora_mailbox_messages_prior_state_active_idx
on public.softora_mailbox_messages (
  account_email,
  folder,
  public.softora_normalize_mailbox_message_id(message_id),
  updated_at desc,
  message_key
)
include (
  uid_generation_id,
  softora_read_at,
  state_revision,
  state_mutation_key,
  state_mutation_at,
  starred,
  reply_dismissed_at,
  deleted_at
)
where generation_superseded_at is null
  and public.softora_normalize_mailbox_message_id(message_id) is not null;

create or replace function pg_temp.softora_replace_final_activation_scale_fragment(
  p_signature text,
  p_old text,
  p_new text,
  p_label text
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_oid pg_catalog.oid := pg_catalog.to_regprocedure(p_signature);
  v_definition text;
  v_matches integer;
begin
  if v_oid is null or coalesce(p_old, '') = '' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_PATCH_TARGET_INVALID',
      detail = p_label;
  end if;
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  v_matches := (
    pg_catalog.char_length(v_definition)
    - pg_catalog.char_length(pg_catalog.replace(v_definition, p_old, ''))
  ) / pg_catalog.char_length(p_old);
  if v_matches <> 1 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_PATCH_DRIFT',
      detail = p_label || ': expected one fragment, found ' || v_matches::text;
  end if;
  execute pg_catalog.replace(v_definition, p_old, p_new);
end;
$function$;

-- The scope now carries every visible old generation captured before the
-- activation starts. A JSON null is the intentional identity of legacy rows;
-- arbitrary values, duplicates, non-canonical UUIDs and extra keys fail closed.
create or replace function public.softora_mailbox_lineage_activation_row_matches_v2(
  p_operation text,
  p_old_account_email text,
  p_old_folder text,
  p_old_generation_id uuid,
  p_old_superseded_at timestamptz,
  p_new_account_email text,
  p_new_folder text,
  p_new_generation_id uuid,
  p_new_superseded_at timestamptz
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_raw_scope text := coalesce(pg_catalog.current_setting(
    'softora.mailbox_lineage_batch_activation_v2', true
  ), '');
  v_scope jsonb;
  v_scope_key_count integer := 0;
  v_operation text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_operation, '')));
  v_sync_key text;
  v_account_email text;
  v_folder text;
  v_new_generation_id text;
  v_new_generation_uuid uuid;
  v_old_generation_ids jsonb;
  v_old_generation_uuids uuid[] := '{}'::uuid[];
  v_old_generation_includes_null boolean := false;
  v_generation_item jsonb;
  v_generation_text text;
  v_generation_uuid uuid;
begin
  if v_raw_scope = '' then
    return false;
  end if;
  begin
    v_scope := v_raw_scope::jsonb;
  exception when others then
    raise exception using errcode = '55000',
      message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
  end;

  if pg_catalog.jsonb_typeof(v_scope) is distinct from 'object' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
  end if;
  select pg_catalog.count(*)::integer into v_scope_key_count
  from pg_catalog.jsonb_object_keys(v_scope) as scope_key(value);
  if v_scope_key_count <> 5
    or not (v_scope ?& array[
      'syncKey', 'accountEmail', 'folder',
      'oldGenerationIds', 'newGenerationId'
    ]::text[])
    or pg_catalog.jsonb_typeof(v_scope->'syncKey') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_scope->'accountEmail') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_scope->'folder') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_scope->'newGenerationId') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_scope->'oldGenerationIds')
      is distinct from 'array' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
  end if;

  v_sync_key := pg_catalog.lower(pg_catalog.btrim(v_scope->>'syncKey'));
  v_account_email := pg_catalog.lower(pg_catalog.btrim(v_scope->>'accountEmail'));
  v_folder := pg_catalog.lower(pg_catalog.btrim(v_scope->>'folder'));
  v_new_generation_id := pg_catalog.lower(pg_catalog.btrim(coalesce(
    v_scope->>'newGenerationId', ''
  )));
  v_old_generation_ids := v_scope->'oldGenerationIds';

  if pg_catalog.jsonb_array_length(v_old_generation_ids) <> (
    select pg_catalog.count(distinct generation.value)::integer
    from pg_catalog.jsonb_array_elements(v_old_generation_ids)
      as generation(value)
  ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
  end if;

  begin
    v_new_generation_uuid := v_new_generation_id::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '55000',
      message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
  end;

  for v_generation_item in
    select generation.value
    from pg_catalog.jsonb_array_elements(v_old_generation_ids)
      as generation(value)
  loop
    if v_generation_item = 'null'::jsonb then
      v_old_generation_includes_null := true;
    elsif pg_catalog.jsonb_typeof(v_generation_item) = 'string' then
      v_generation_text := v_generation_item #>> '{}';
      begin
        v_generation_uuid := v_generation_text::uuid;
      exception when invalid_text_representation then
        raise exception using errcode = '55000',
          message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
      end;
      if v_generation_text is distinct from v_generation_uuid::text then
        raise exception using errcode = '55000',
          message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
      end if;
      v_old_generation_uuids := pg_catalog.array_append(
        v_old_generation_uuids, v_generation_uuid
      );
    else
      raise exception using errcode = '55000',
        message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
    end if;
  end loop;

  if v_new_generation_uuid = any (v_old_generation_uuids)
    or coalesce(pg_catalog.current_setting(
      'softora.mailbox_sync_per_key_v2', true
    ), '') is distinct from '1'
    or coalesce(pg_catalog.current_setting(
      'softora.mailbox_uid_generation_v2_transition', true
    ), '') is distinct from '1'
    or v_sync_key = ''
    or pg_catalog.char_length(v_sync_key) > 600
    or v_sync_key <> v_scope->>'syncKey'
    or v_account_email = ''
    or pg_catalog.char_length(v_account_email) > 320
    or v_account_email <> v_scope->>'accountEmail'
    or v_folder = ''
    or pg_catalog.char_length(v_folder) > 200
    or v_folder <> v_scope->>'folder'
    or v_sync_key is distinct from (v_account_email || '|' || v_folder)
    or v_new_generation_id = ''
    or v_new_generation_id is distinct from v_new_generation_uuid::text then
    raise exception using errcode = '55000',
      message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
  end if;

  if v_operation = 'INSERT' then
    if pg_catalog.lower(pg_catalog.btrim(coalesce(p_new_account_email, '')))
        <> v_account_email
      or pg_catalog.lower(pg_catalog.btrim(coalesce(p_new_folder, '')))
        <> v_folder
      or p_new_generation_id is distinct from v_new_generation_uuid
      or p_new_superseded_at is not null then
      raise exception using errcode = '55000',
        message = 'MAILBOX_LINEAGE_ACTIVATION_ROW_SCOPE_MISMATCH';
    end if;
  elsif v_operation = 'UPDATE' then
    if pg_catalog.lower(pg_catalog.btrim(coalesce(p_old_account_email, '')))
        <> v_account_email
      or pg_catalog.lower(pg_catalog.btrim(coalesce(p_old_folder, '')))
        <> v_folder
      or pg_catalog.lower(pg_catalog.btrim(coalesce(p_new_account_email, '')))
        <> v_account_email
      or pg_catalog.lower(pg_catalog.btrim(coalesce(p_new_folder, '')))
        <> v_folder
      or (
        -- ON CONFLICT on a row already belonging to the new generation.
        p_old_generation_id is not distinct from v_new_generation_uuid
          and p_new_generation_id is not distinct from v_new_generation_uuid
          and p_old_superseded_at is null
          and p_new_superseded_at is null
        or
        -- One of the exact visible generations captured before activation.
        p_new_generation_id is not distinct from p_old_generation_id
          and p_old_superseded_at is null
          and p_new_superseded_at is not null
          and (
            p_old_generation_id is null
              and v_old_generation_includes_null
            or p_old_generation_id = any (v_old_generation_uuids)
          )
      ) is not true then
      raise exception using errcode = '55000',
        message = 'MAILBOX_LINEAGE_ACTIVATION_ROW_SCOPE_MISMATCH';
    end if;
  else
    raise exception using errcode = '55000',
      message = 'MAILBOX_LINEAGE_ACTIVATION_ROW_OPERATION_INVALID';
  end if;
  return true;
end;
$function$;

-- Resolve once, then feed both upserts from that materialized result. The
-- discovery upsert returns its conflict-adjusted timestamp directly to the
-- member upsert, preserving backfill and previous-root semantics exactly.
create or replace function public.softora_rebuild_mailbox_campaign_lineage(
  p_account_email text,
  p_start_keys text[],
  p_backfill boolean default false,
  p_previous_roots jsonb default '{}'::jsonb
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  with resolved_lineage as materialized (
    select resolved.*
    from public.softora_resolve_mailbox_campaign_lineage(
      p_account_email, p_start_keys
    ) as resolved
  ), upserted_discoveries as (
    insert into public.softora_mailbox_campaign_lineage_discoveries (
      message_key, root_message_key, account_email,
      first_discovered_at, last_confirmed_at
    )
    select
      resolved.message_key,
      resolved.root_message_key,
      resolved.account_email,
      case when p_backfill
        then coalesce(messages.created_at, pg_catalog.clock_timestamp())
        else pg_catalog.clock_timestamp()
      end,
      pg_catalog.clock_timestamp()
    from resolved_lineage as resolved
    join public.softora_mailbox_messages as messages
      on messages.message_key = resolved.message_key
    on conflict (message_key, root_message_key) do update set
      account_email = excluded.account_email,
      first_discovered_at = case
        when coalesce(p_previous_roots->>excluded.message_key, '')
          = excluded.root_message_key
          then public.softora_mailbox_campaign_lineage_discoveries.first_discovered_at
        else excluded.first_discovered_at
      end,
      last_confirmed_at = excluded.last_confirmed_at,
      active = true,
      last_disconnected_at = null
    returning message_key, root_message_key, first_discovered_at
  )
  insert into public.softora_mailbox_campaign_lineage_members (
    message_key, account_email, message_id, parent_message_key,
    root_message_key, root_message_id, lineage_depth, message_date,
    is_incoming, is_proven_automated, lineage_discovered_at,
    created_at, updated_at
  )
  select
    resolved.message_key,
    resolved.account_email,
    resolved.message_id,
    resolved.parent_message_key,
    resolved.root_message_key,
    resolved.root_message_id,
    resolved.lineage_depth,
    messages.date,
    public.softora_is_mailbox_incoming_message(
      messages.account_email,
      messages.folder,
      messages.sender_email,
      messages.recipients_text,
      messages.payload
    ),
    public.softora_has_proven_automated_reply(messages.payload),
    discoveries.first_discovered_at,
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  from resolved_lineage as resolved
  join upserted_discoveries as discoveries
    on discoveries.message_key = resolved.message_key
    and discoveries.root_message_key = resolved.root_message_key
  join public.softora_mailbox_messages as messages
    on messages.message_key = resolved.message_key
  on conflict (message_key) do update set
    account_email = excluded.account_email,
    message_id = excluded.message_id,
    parent_message_key = excluded.parent_message_key,
    root_message_key = excluded.root_message_key,
    root_message_id = excluded.root_message_id,
    lineage_depth = excluded.lineage_depth,
    message_date = excluded.message_date,
    is_incoming = excluded.is_incoming,
    is_proven_automated = excluded.is_proven_automated,
    lineage_discovered_at = excluded.lineage_discovered_at,
    updated_at = excluded.updated_at;
end;
$function$;

select pg_temp.softora_replace_final_activation_scale_fragment(
  'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
  $old$  v_result jsonb;
  v_retired_message_keys text[] := '{}'::text[];
begin$old$,
  $new$  v_result jsonb;
  v_retired_message_keys text[] := '{}'::text[];
  v_retired_generation_ids jsonb := '[]'::jsonb;
begin$new$,
  'commit activation: declare every retired generation identity'
);

select pg_temp.softora_replace_final_activation_scale_fragment(
  'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
  $old$  select coalesce(
    pg_catalog.array_agg(old_message.message_key order by old_message.message_key),
    '{}'::text[]
  ) into v_retired_message_keys
  from public.softora_mailbox_messages as old_message
  where old_message.account_email = v_sync.account_email
    and old_message.folder = v_sync.folder
    and old_message.uid_generation_id is distinct from p_generation_id
    and old_message.generation_superseded_at is null;

  perform pg_catalog.set_config(
    'softora.mailbox_lineage_batch_activation_v2',
    pg_catalog.jsonb_build_object(
      'syncKey', v_sync.sync_key,
      'accountEmail', v_sync.account_email,
      'folder', v_sync.folder,
      'oldGenerationId', v_sync.active_uid_generation_id,
      'newGenerationId', p_generation_id
    )::text,
    true
  );$old$,
  $new$  select
    coalesce(
      pg_catalog.array_agg(
        old_message.message_key order by old_message.message_key
      ),
      '{}'::text[]
    ),
    coalesce(
      pg_catalog.jsonb_agg(
        distinct old_message.uid_generation_id
        order by old_message.uid_generation_id
      ),
      '[]'::jsonb
    )
  into v_retired_message_keys, v_retired_generation_ids
  from public.softora_mailbox_messages as old_message
  where old_message.account_email = v_sync.account_email
    and old_message.folder = v_sync.folder
    and old_message.uid_generation_id is distinct from p_generation_id
    and old_message.generation_superseded_at is null;

  perform pg_catalog.set_config(
    'softora.mailbox_lineage_batch_activation_v2',
    pg_catalog.jsonb_build_object(
      'syncKey', v_sync.sync_key,
      'accountEmail', v_sync.account_email,
      'folder', v_sync.folder,
      'oldGenerationIds', v_retired_generation_ids,
      'newGenerationId', p_generation_id
    )::text,
    true
  );$new$,
  'commit activation: capture all visible old generation identities'
);

-- Parse the staged payload once and rank every eligible old state once. The
-- DISTINCT ON order is byte-for-byte equivalent to the former lateral LIMIT 1.
select pg_temp.softora_replace_final_activation_scale_fragment(
  'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
  $old$  insert into public.softora_mailbox_messages as stored_message (
    message_key, account_email, folder, uid, uid_validity, uid_generation_id,
    provider_id, message_id, in_reply_to, references_text, sender_name,
    sender_email, recipients_text, subject, preview, body_text,
    body_truncated, has_body, date, internal_date, unread, softora_read_at,
    state_revision, state_mutation_key, state_mutation_at, starred,
    reply_dismissed_at, payload, updated_at, deleted_at
  )
  select
    v_sync.account_email || '|' || v_sync.folder || '|gen:'
      || p_generation_id::text || '|' || staged.uid::text,
    v_sync.account_email, v_sync.folder, staged.uid, p_uid_validity,
    p_generation_id, incoming.provider_id, incoming.message_id,
    incoming.in_reply_to, incoming.references_text, incoming.sender_name,
    incoming.sender_email, incoming.recipients_text, incoming.subject,
    incoming.preview, incoming.body_text, coalesce(incoming.body_truncated, false),
    coalesce(incoming.has_body, false), incoming.date, incoming.internal_date,
    case when prior.softora_read_at is not null then false
      else coalesce(incoming.unread, false) end,
    prior.softora_read_at, coalesce(prior.state_revision, 0),
    prior.state_mutation_key, prior.state_mutation_at,
    coalesce(prior.starred, incoming.starred, false),
    prior.reply_dismissed_at, coalesce(incoming.payload, '{}'::jsonb),
    coalesce(incoming.updated_at, v_now), prior.deleted_at
  from public.softora_mailbox_uid_generation_staging as staged
  cross join lateral pg_catalog.jsonb_to_record(staged.row_data) as incoming(
    provider_id text, message_id text, in_reply_to text, references_text text,
    sender_name text, sender_email text, recipients_text text, subject text,
    preview text, body_text text, body_truncated boolean, has_body boolean,
    date timestamptz, internal_date timestamptz, unread boolean,
    starred boolean, payload jsonb, updated_at timestamptz
  )
  left join lateral (
    select old_message.softora_read_at, old_message.state_revision,
      old_message.state_mutation_key, old_message.state_mutation_at,
      old_message.starred, old_message.reply_dismissed_at,
      old_message.deleted_at
    from public.softora_mailbox_messages as old_message
    where old_message.account_email = v_sync.account_email
      and old_message.folder = v_sync.folder
      and old_message.generation_superseded_at is null
      and old_message.uid_generation_id is distinct from p_generation_id
      and public.softora_normalize_mailbox_message_id(old_message.message_id)
        is not null
      and public.softora_normalize_mailbox_message_id(old_message.message_id)
        = public.softora_normalize_mailbox_message_id(incoming.message_id)
    order by old_message.updated_at desc, old_message.message_key
    limit 1
  ) as prior on true
  where staged.generation_id = p_generation_id
  order by staged.uid$old$,
  $new$  with staged_rows as materialized (
    select
      staged.uid,
      incoming.provider_id,
      incoming.message_id,
      incoming.in_reply_to,
      incoming.references_text,
      incoming.sender_name,
      incoming.sender_email,
      incoming.recipients_text,
      incoming.subject,
      incoming.preview,
      incoming.body_text,
      incoming.body_truncated,
      incoming.has_body,
      incoming.date,
      incoming.internal_date,
      incoming.unread,
      incoming.starred,
      incoming.payload,
      incoming.updated_at,
      public.softora_normalize_mailbox_message_id(incoming.message_id)
        as normalized_message_id
    from public.softora_mailbox_uid_generation_staging as staged
    cross join lateral pg_catalog.jsonb_to_record(staged.row_data) as incoming(
      provider_id text, message_id text, in_reply_to text, references_text text,
      sender_name text, sender_email text, recipients_text text, subject text,
      preview text, body_text text, body_truncated boolean, has_body boolean,
      date timestamptz, internal_date timestamptz, unread boolean,
      starred boolean, payload jsonb, updated_at timestamptz
    )
    where staged.generation_id = p_generation_id
  ), prior_state as materialized (
    select distinct on (candidate.normalized_message_id)
      candidate.normalized_message_id,
      candidate.softora_read_at,
      candidate.state_revision,
      candidate.state_mutation_key,
      candidate.state_mutation_at,
      candidate.starred,
      candidate.reply_dismissed_at,
      candidate.deleted_at
    from (
      select
        public.softora_normalize_mailbox_message_id(old_message.message_id)
          as normalized_message_id,
        old_message.softora_read_at,
        old_message.state_revision,
        old_message.state_mutation_key,
        old_message.state_mutation_at,
        old_message.starred,
        old_message.reply_dismissed_at,
        old_message.deleted_at,
        old_message.updated_at,
        old_message.message_key
      from public.softora_mailbox_messages as old_message
      where old_message.account_email = v_sync.account_email
        and old_message.folder = v_sync.folder
        and old_message.generation_superseded_at is null
        and old_message.uid_generation_id is distinct from p_generation_id
    ) as candidate
    where candidate.normalized_message_id is not null
    order by
      candidate.normalized_message_id,
      candidate.updated_at desc,
      candidate.message_key
  )
  insert into public.softora_mailbox_messages as stored_message (
    message_key, account_email, folder, uid, uid_validity, uid_generation_id,
    provider_id, message_id, in_reply_to, references_text, sender_name,
    sender_email, recipients_text, subject, preview, body_text,
    body_truncated, has_body, date, internal_date, unread, softora_read_at,
    state_revision, state_mutation_key, state_mutation_at, starred,
    reply_dismissed_at, payload, updated_at, deleted_at
  )
  select
    v_sync.account_email || '|' || v_sync.folder || '|gen:'
      || p_generation_id::text || '|' || staged.uid::text,
    v_sync.account_email, v_sync.folder, staged.uid, p_uid_validity,
    p_generation_id, staged.provider_id, staged.message_id,
    staged.in_reply_to, staged.references_text, staged.sender_name,
    staged.sender_email, staged.recipients_text, staged.subject,
    staged.preview, staged.body_text, coalesce(staged.body_truncated, false),
    coalesce(staged.has_body, false), staged.date, staged.internal_date,
    case when prior.softora_read_at is not null then false
      else coalesce(staged.unread, false) end,
    prior.softora_read_at, coalesce(prior.state_revision, 0),
    prior.state_mutation_key, prior.state_mutation_at,
    coalesce(prior.starred, staged.starred, false),
    prior.reply_dismissed_at, coalesce(staged.payload, '{}'::jsonb),
    coalesce(staged.updated_at, v_now), prior.deleted_at
  from staged_rows as staged
  left join prior_state as prior
    on prior.normalized_message_id = staged.normalized_message_id
  order by staged.uid$new$,
  'commit activation: inherit prior state set based'
);

-- Retire every captured visible old row in one statement while the strict
-- batch scope is active. Clear the scope immediately after that statement,
-- then rebuild the combined old/new lineage impact exactly once.
select pg_temp.softora_replace_final_activation_scale_fragment(
  'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
  $old$  update public.softora_mailbox_messages as old_message
  set generation_superseded_at = coalesce(
        old_message.generation_superseded_at, v_now
      ),
      deleted_at = coalesce(old_message.deleted_at, v_now),
      updated_at = v_now
  where old_message.account_email = v_sync.account_email
    and old_message.folder = v_sync.folder
    and (
      v_sync.active_uid_generation_id is null
        and old_message.uid_generation_id is null
      or v_sync.active_uid_generation_id is not null
        and old_message.uid_generation_id = v_sync.active_uid_generation_id
    )
    and old_message.generation_superseded_at is null;

  perform pg_catalog.set_config(
    'softora.mailbox_lineage_batch_activation_v2', '', true
  );

  -- The healthy invariant has exactly one visible old generation. Preserve the
  -- former broad cleanup as a fail-safe for any historical stale generation,
  -- but run that exceptional remainder with ordinary per-row lineage impact.
  -- This keeps the batch scope exact without ever leaving stale visible rows.
  update public.softora_mailbox_messages as stale_message
  set generation_superseded_at = coalesce(
        stale_message.generation_superseded_at, v_now
      ),
      deleted_at = coalesce(stale_message.deleted_at, v_now),
      updated_at = v_now
  where stale_message.account_email = v_sync.account_email
    and stale_message.folder = v_sync.folder
    and stale_message.uid_generation_id is distinct from p_generation_id
    and stale_message.generation_superseded_at is null;

  perform public.softora_refresh_mailbox_activation_lineage_v2(
    v_sync.account_email,
    v_sync.folder,
    p_generation_id,
    v_retired_message_keys
  );$old$,
  $new$  update public.softora_mailbox_messages as old_message
  set generation_superseded_at = coalesce(
        old_message.generation_superseded_at, v_now
      ),
      deleted_at = coalesce(old_message.deleted_at, v_now),
      updated_at = v_now
  where old_message.account_email = v_sync.account_email
    and old_message.folder = v_sync.folder
    and old_message.uid_generation_id is distinct from p_generation_id
    and old_message.generation_superseded_at is null;

  perform pg_catalog.set_config(
    'softora.mailbox_lineage_batch_activation_v2', '', true
  );

  perform public.softora_refresh_mailbox_activation_lineage_v2(
    v_sync.account_email,
    v_sync.folder,
    p_generation_id,
    v_retired_message_keys
  );$new$,
  'commit activation: retire all stale generations in one batch'
);

revoke all on function public.softora_commit_mailbox_sync_pass_v2(
  text, text, text, uuid, bigint, text, jsonb, jsonb, jsonb,
  bigint, bigint, boolean, integer, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.softora_commit_mailbox_sync_pass_v2(
  text, text, text, uuid, bigint, text, jsonb, jsonb, jsonb,
  bigint, bigint, boolean, integer, bigint
) to service_role;
revoke all on function public.softora_mailbox_lineage_activation_row_matches_v2(
  text, text, text, uuid, timestamptz, text, text, uuid, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.softora_mailbox_lineage_activation_row_matches_v2(
  text, text, text, uuid, timestamptz, text, text, uuid, timestamptz
) to service_role;
revoke all on function public.softora_rebuild_mailbox_campaign_lineage(
  text, text[], boolean, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.softora_rebuild_mailbox_campaign_lineage(
  text, text[], boolean, jsonb
) to service_role;

comment on index public.softora_mailbox_messages_prior_state_active_idx is
  'Covers tombstone-inclusive prior mailbox state handoff for active UID generations.';
comment on index public.softora_mailbox_message_id_exact_lookup_idx is
  'Supports canonical mailbox Message-ID resolution with the exact visible-row predicate.';
comment on function public.softora_mailbox_lineage_activation_row_matches_v2(
  text, text, text, uuid, timestamptz, text, text, uuid, timestamptz
) is 'Fails closed unless a mailbox row belongs to the exact new generation or any captured old generation in one activation batch.';
comment on function public.softora_rebuild_mailbox_campaign_lineage(
  text, text[], boolean, jsonb
) is 'Materializes the canonical lineage resolver once and reuses its rows for discovery and member upserts.';

do $postcondition$
declare
  v_definition text;
  v_resolver_calls integer;
begin
  v_definition := case
    when pg_catalog.to_regclass(
      'public.softora_mailbox_message_id_exact_lookup_idx'
    ) is null then null
    else pg_catalog.pg_get_indexdef(pg_catalog.to_regclass(
      'public.softora_mailbox_message_id_exact_lookup_idx'
    ))
  end;
  if v_definition is distinct from
    'CREATE INDEX softora_mailbox_message_id_exact_lookup_idx ON public.softora_mailbox_messages USING btree (account_email, softora_normalize_mailbox_message_id(message_id)) WHERE ((deleted_at IS NULL) AND (softora_normalize_mailbox_message_id(message_id) IS NOT NULL))' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_CANONICAL_INDEX_POSTCONDITION_FAILED';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)'::pg_catalog.regprocedure
  );
  if pg_catalog.strpos(v_definition, 'with staged_rows as materialized') = 0
    or pg_catalog.strpos(v_definition, 'prior_state as materialized') = 0
    or pg_catalog.strpos(v_definition, '''oldGenerationIds''') = 0
    or pg_catalog.strpos(
      v_definition, 'left join ' || 'lateral ('
    ) > 0
    or pg_catalog.strpos(v_definition, 'stale_message') > 0 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_COMMIT_POSTCONDITION_FAILED';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.softora_rebuild_mailbox_campaign_lineage(text,text[],boolean,jsonb)'::pg_catalog.regprocedure
  );
  v_resolver_calls := (
    pg_catalog.char_length(v_definition)
    - pg_catalog.char_length(pg_catalog.replace(
      v_definition,
      'public.softora_resolve_mailbox_campaign_lineage(',
      ''
    ))
  ) / pg_catalog.char_length(
    'public.softora_resolve_mailbox_campaign_lineage('
  );
  if v_resolver_calls <> 1
    or pg_catalog.strpos(v_definition, 'resolved_lineage as materialized') = 0
    or pg_catalog.strpos(v_definition, 'returning message_key') = 0
    or exists (
      select 1
      from pg_catalog.pg_proc as procedure
      where procedure.oid =
        'public.softora_rebuild_mailbox_campaign_lineage(text,text[],boolean,jsonb)'::pg_catalog.regprocedure
        and procedure.prosecdef
    ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_REBUILD_POSTCONDITION_FAILED';
  end if;
end;
$postcondition$;

notify pgrst, 'reload schema';
-- mailbox-final-activation-scale:end
-- mailbox-stored-message-evidence-lookup:start
create or replace function public.softora_list_stored_mailbox_message_ids(
  p_account_emails text[],
  p_folder text,
  p_message_ids text[]
)
returns table(message_id text)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if coalesce(pg_catalog.cardinality(p_account_emails), 0) > 20
    or coalesce(pg_catalog.cardinality(p_message_ids), 0) > 200 then
    raise exception using errcode = '22023',
      message = 'MAILBOX_STORED_MESSAGE_EVIDENCE_INPUT_TOO_LARGE';
  end if;

  return query
  with accounts as materialized (
    select distinct pg_catalog.lower(pg_catalog.btrim(account.value)) as account_email
    from pg_catalog.unnest(coalesce(p_account_emails, array[]::text[])) account(value)
    where pg_catalog.btrim(account.value) <> ''
  ), targets as materialized (
    select distinct public.softora_normalize_mailbox_message_id(target.value) as message_id
    from pg_catalog.unnest(coalesce(p_message_ids, array[]::text[])) target(value)
    where public.softora_normalize_mailbox_message_id(target.value) is not null
  ), evidence as materialized (
    select public.softora_normalize_mailbox_message_id(message.message_id) as message_id
    from public.softora_mailbox_messages message
    join accounts on accounts.account_email = pg_catalog.lower(pg_catalog.btrim(message.account_email))
    join targets on targets.message_id = public.softora_normalize_mailbox_message_id(message.message_id)
    where pg_catalog.lower(pg_catalog.btrim(message.folder))
      = pg_catalog.lower(pg_catalog.btrim(coalesce(p_folder, 'sent')))

    union all

    select tombstone.normalized_message_id
    from public.softora_mailbox_message_tombstones tombstone
    join accounts on accounts.account_email = tombstone.account_email
    join targets on targets.message_id = tombstone.normalized_message_id
  )
  select distinct evidence.message_id
  from evidence
  where evidence.message_id is not null
  order by evidence.message_id;
end;
$function$;

revoke all on function public.softora_list_stored_mailbox_message_ids(text[], text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.softora_list_stored_mailbox_message_ids(text[], text, text[])
  to service_role;

notify pgrst, 'reload schema';
-- mailbox-stored-message-evidence-lookup:end
-- mailbox-accepted-provenance-evidence-lookup:start
create index if not exists softora_mailbox_send_provenance_accepted_message_id_idx
on public.softora_mailbox_send_provenance (
  (pg_catalog.lower(pg_catalog.btrim(account_email))),
  (public.softora_normalize_mailbox_message_id(sent_message_id)),
  accepted_at desc,
  intent_id
)
where status = 'accepted'
  and public.softora_normalize_mailbox_message_id(sent_message_id) is not null;

create or replace function public.softora_list_accepted_mailbox_send_provenance_by_message_ids(
  p_account_emails text[],
  p_message_ids text[],
  p_max_rows integer default 500
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if coalesce(pg_catalog.cardinality(p_account_emails), 0) > 20
    or coalesce(pg_catalog.cardinality(p_message_ids), 0) > 200
    or coalesce(p_max_rows, 0) not between 1 and 2000 then
    raise exception using errcode = '22023',
      message = 'MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_INPUT_TOO_LARGE';
  end if;

  return (
    with accounts as materialized (
      select distinct pg_catalog.lower(pg_catalog.btrim(account.value)) as account_email
      from pg_catalog.unnest(coalesce(p_account_emails, array[]::text[])) account(value)
      where pg_catalog.btrim(account.value) <> ''
    ), targets as materialized (
      select distinct public.softora_normalize_mailbox_message_id(target.value) as message_id
      from pg_catalog.unnest(coalesce(p_message_ids, array[]::text[])) target(value)
      where public.softora_normalize_mailbox_message_id(target.value) is not null
    ), bounded as materialized (
      select provenance.*, targets.message_id as canonical_message_id
      from public.softora_mailbox_send_provenance provenance
      join accounts
        on accounts.account_email = pg_catalog.lower(pg_catalog.btrim(provenance.account_email))
      join targets
        on targets.message_id = public.softora_normalize_mailbox_message_id(
          provenance.sent_message_id
        )
      where provenance.status = 'accepted'
      order by provenance.accepted_at desc nulls last,
        provenance.updated_at desc nulls last,
        provenance.created_at desc nulls last,
        provenance.intent_id
      limit (p_max_rows + 1)
    )
    select pg_catalog.jsonb_build_object(
      'rows', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(evidence)
          order by evidence.accepted_at desc nulls last,
            evidence.updated_at desc nulls last,
            evidence.created_at desc nulls last,
            evidence.intent_id
        )
        from bounded evidence
      ), '[]'::jsonb),
      'complete', (select pg_catalog.count(*) <= p_max_rows from bounded),
      'overflow', (select pg_catalog.count(*) > p_max_rows from bounded),
      'returned_count', (select pg_catalog.count(*) from bounded),
      'max_rows', p_max_rows
    )
  );
end;
$function$;

revoke all on function public.softora_list_accepted_mailbox_send_provenance_by_message_ids(
  text[], text[], integer
) from public, anon, authenticated, service_role;
grant execute on function public.softora_list_accepted_mailbox_send_provenance_by_message_ids(
  text[], text[], integer
) to service_role;

notify pgrst, 'reload schema';
-- mailbox-accepted-provenance-evidence-lookup:end
