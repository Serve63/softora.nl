create table if not exists public.softora_social_lead_signals (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('facebook', 'instagram')),
  source_type text not null check (source_type in ('serp', 'meta_graph', 'manual')),
  provider text not null default 'manual',
  source_url text not null,
  post_url text,
  profile_url text,
  external_id text,
  message_text text not null default '',
  snippet text,
  author_name text,
  region text,
  query text,
  keyword_group text,
  published_at timestamptz,
  found_at timestamptz not null default now(),
  likes integer check (likes is null or likes >= 0),
  comments integer check (comments is null or comments >= 0),
  engagement_known boolean not null default false,
  relevance_score integer not null default 0 check (relevance_score between 0 and 100),
  score_reasons jsonb not null default '[]'::jsonb,
  lead_status text not null default 'new' check (lead_status in ('new', 'relevant', 'not_relevant', 'follow_up', 'archived')),
  internal_notes text,
  suggested_reply text,
  website_url text,
  website_domain text,
  website_title text,
  website_status text not null default 'website_not_checked' check (website_status in ('website_found', 'no_website_found', 'website_not_working', 'website_unverified', 'website_not_checked', 'provider_unavailable')),
  website_source text check (website_source is null or website_source in ('post', 'profile_or_page', 'public_search', 'manual', 'not_found', 'not_checked')),
  website_confidence_score integer check (website_confidence_score is null or website_confidence_score between 0 and 100),
  website_http_status integer,
  website_checked_at timestamptz,
  website_check_error text,
  website_candidates jsonb not null default '[]'::jsonb,
  kvk_number text,
  source_company_id text,
  company_id text,
  match_status text,
  fingerprint text not null,
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint softora_social_lead_signals_fingerprint_check check (char_length(fingerprint) = 64 and fingerprint ~ '^[a-f0-9]{64}$')
);

create unique index if not exists softora_social_lead_signals_fingerprint_uidx
  on public.softora_social_lead_signals (fingerprint);
create index if not exists softora_social_lead_signals_inbox_idx
  on public.softora_social_lead_signals (lead_status, relevance_score desc, published_at desc);
create index if not exists softora_social_lead_signals_platform_idx
  on public.softora_social_lead_signals (platform, published_at desc);
create index if not exists softora_social_lead_signals_website_idx
  on public.softora_social_lead_signals (website_status, published_at desc);

create table if not exists public.softora_social_lead_scan_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  provider text not null,
  platforms jsonb not null default '[]'::jsonb,
  regions jsonb not null default '[]'::jsonb,
  query_plan jsonb not null default '[]'::jsonb,
  query_cursor integer not null default 0 check (query_cursor >= 0),
  used_queries jsonb not null default '[]'::jsonb,
  max_queries integer not null default 12 check (max_queries between 1 and 100),
  website_lookup_limit integer not null default 10 check (website_lookup_limit between 0 and 50),
  result_count integer not null default 0 check (result_count >= 0),
  new_signal_count integer not null default 0 check (new_signal_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  website_check_count integer not null default 0 check (website_check_count >= 0),
  website_found_count integer not null default 0 check (website_found_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  last_error text,
  status text not null default 'running' check (status in ('running', 'paused', 'completed', 'completed_with_errors', 'provider_unavailable', 'failed'))
);

create index if not exists softora_social_lead_scan_runs_started_idx
  on public.softora_social_lead_scan_runs (started_at desc);

alter table public.softora_social_lead_signals enable row level security;
alter table public.softora_social_lead_scan_runs enable row level security;

revoke all on table public.softora_social_lead_signals from public, anon, authenticated;
revoke all on table public.softora_social_lead_scan_runs from public, anon, authenticated;
grant select, insert, update, delete on table public.softora_social_lead_signals to service_role;
grant select, insert, update, delete on table public.softora_social_lead_scan_runs to service_role;

create or replace function public.softora_social_lead_signals_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

drop trigger if exists softora_social_lead_signals_touch_updated_at on public.softora_social_lead_signals;
create trigger softora_social_lead_signals_touch_updated_at
before update on public.softora_social_lead_signals
for each row execute function public.softora_social_lead_signals_touch_updated_at();

drop trigger if exists softora_social_lead_scan_runs_touch_updated_at on public.softora_social_lead_scan_runs;
create trigger softora_social_lead_scan_runs_touch_updated_at
before update on public.softora_social_lead_scan_runs
for each row execute function public.softora_social_lead_signals_touch_updated_at();

revoke execute on function public.softora_social_lead_signals_touch_updated_at() from public, anon, authenticated;
grant execute on function public.softora_social_lead_signals_touch_updated_at() to service_role;
