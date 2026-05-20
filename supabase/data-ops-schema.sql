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
  starred boolean not null default false,
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

alter table public.softora_customers enable row level security;
alter table public.softora_active_orders enable row level security;
alter table public.softora_order_runtime enable row level security;
alter table public.softora_design_photos enable row level security;
alter table public.softora_webdesign_jobs enable row level security;
alter table public.softora_mailbox_messages enable row level security;
alter table public.softora_mailbox_sync_state enable row level security;
