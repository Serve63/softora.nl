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

create or replace function public.softora_preserve_mailbox_read_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.softora_read_at is not null then
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
        '^\\s*((re|fw|fwd)\\s*:\\s*)+',
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
