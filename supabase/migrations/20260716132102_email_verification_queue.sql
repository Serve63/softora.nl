create table if not exists public.softora_email_verifications (
  email text primary key,
  domain text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'valid', 'invalid', 'unknown')),
  reason text not null default '',
  smtp_code integer,
  smtp_response text not null default '',
  mx_host text not null default '',
  catch_all boolean,
  requested_at timestamptz not null default now(),
  checked_at timestamptz,
  valid_until timestamptz,
  retry_after timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  source text not null default 'softora-self-hosted-smtp-v1',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists softora_email_verifications_status_requested_idx
  on public.softora_email_verifications (status, requested_at);
create index if not exists softora_email_verifications_valid_until_idx
  on public.softora_email_verifications (valid_until)
  where status = 'valid';
create index if not exists softora_email_verifications_retry_after_idx
  on public.softora_email_verifications (retry_after)
  where status = 'unknown';

alter table public.softora_email_verifications enable row level security;

revoke all on table public.softora_email_verifications from public, anon, authenticated;
grant select, insert, update, delete on public.softora_email_verifications to service_role;

comment on table public.softora_email_verifications is
  'Fail-closed mailboxverificaties voor Softora outbound, uitgevoerd door de eigen lokale SMTP-worker.';
