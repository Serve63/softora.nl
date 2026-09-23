-- Private staging for staff meeting recordings. Only the server service role
-- can create upload grants, read objects, or inspect job ownership.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'softora-premium-samenvatten',
  'softora-premium-samenvatten',
  false,
  104857600,
  array['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav',
        'audio/x-wav', 'audio/aac', 'audio/ogg', 'audio/webm',
        'application/octet-stream']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.softora_premium_samenvatten_jobs (
  id uuid primary key,
  owner_id text not null,
  object_path text not null unique,
  file_name text not null,
  file_size bigint not null check (file_size between 1 and 104857600),
  mime_type text not null,
  status text not null check (status in ('ready', 'submitting', 'processing', 'completed', 'failed')),
  transcript_id text,
  summary_status text not null default 'pending' check (summary_status in ('pending', 'running', 'completed', 'failed')),
  summary_json jsonb,
  summary_request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create index if not exists softora_premium_samenvatten_jobs_owner_created_idx
  on public.softora_premium_samenvatten_jobs (owner_id, created_at desc);
create index if not exists softora_premium_samenvatten_jobs_expiry_idx
  on public.softora_premium_samenvatten_jobs (expires_at);

alter table public.softora_premium_samenvatten_jobs enable row level security;
revoke all on public.softora_premium_samenvatten_jobs from anon, authenticated;
grant select, insert, update, delete on public.softora_premium_samenvatten_jobs to service_role;
