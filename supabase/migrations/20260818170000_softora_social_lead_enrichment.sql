begin;

alter table public.softora_social_lead_signals
  add column if not exists business_name text,
  add column if not exists business_address text,
  add column if not exists business_city text,
  add column if not exists business_region text,
  add column if not exists business_postal_code text,
  add column if not exists business_phone text,
  add column if not exists business_domain text,
  add column if not exists business_website_url text,
  add column if not exists business_place_id text,
  add column if not exists business_cid text,
  add column if not exists business_category text,
  add column if not exists business_is_claimed boolean,
  add column if not exists business_rating numeric,
  add column if not exists business_rating_votes integer,
  add column if not exists business_match_status text not null default 'not_checked',
  add column if not exists business_match_score integer,
  add column if not exists business_agency_detected boolean,
  add column if not exists business_match_reasons jsonb not null default '[]'::jsonb,
  add column if not exists business_candidates jsonb not null default '[]'::jsonb,
  add column if not exists business_source text,
  add column if not exists business_checked_at timestamptz,
  add column if not exists business_check_error text,
  add column if not exists website_redirect_url text,
  add column if not exists website_check_provider text,
  add column if not exists website_technical_checks jsonb not null default '{}'::jsonb,
  add column if not exists website_links jsonb not null default '[]'::jsonb;

alter table public.softora_social_lead_signals
  drop constraint if exists softora_social_lead_signals_business_match_status_check;

alter table public.softora_social_lead_signals
  add constraint softora_social_lead_signals_business_match_status_check
  check (business_match_status in ('not_checked', 'matched', 'ambiguous', 'not_found', 'agency_detected', 'provider_unavailable', 'provider_error'));

alter table public.softora_social_lead_signals
  drop constraint if exists softora_social_lead_signals_business_match_score_check;

alter table public.softora_social_lead_signals
  add constraint softora_social_lead_signals_business_match_score_check
  check (business_match_score is null or business_match_score between 0 and 100);

create index if not exists softora_social_lead_signals_business_match_idx
  on public.softora_social_lead_signals (business_match_status, published_at desc);

create index if not exists softora_social_lead_signals_business_domain_idx
  on public.softora_social_lead_signals (business_domain);

comment on column public.softora_social_lead_signals.business_match_status is
  'Business Listings match state. agency_detected is retained for review but should not enter outreach automatically.';

comment on column public.softora_social_lead_signals.website_technical_checks is
  'Compact OnPage checks only; no full crawl payload is stored.';

commit;
