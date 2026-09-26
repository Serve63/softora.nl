-- Server-only cache of the built campaign reply list, shared between
-- serverless instances. Entries are keyed by the campaign content_version and
-- are never a source of truth: the API rebuilds on any mismatch or failure.
create table if not exists public.softora_mailbox_campaign_list_cache (
  cache_key text primary key check (char_length(cache_key) between 1 and 300),
  content_version bigint not null,
  built_at timestamptz not null,
  payload text not null,
  updated_at timestamptz not null default now()
);

alter table public.softora_mailbox_campaign_list_cache enable row level security;
revoke all on table public.softora_mailbox_campaign_list_cache from public, anon, authenticated;
grant select, insert, update, delete on table public.softora_mailbox_campaign_list_cache to service_role;
