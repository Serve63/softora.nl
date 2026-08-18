begin;

alter table public.softora_social_lead_signals
  add column if not exists publication_date_source text not null default 'unknown',
  add column if not exists publication_date_raw text,
  add column if not exists publication_date_confidence integer;

alter table public.softora_social_lead_signals
  drop constraint if exists softora_social_lead_signals_publication_date_source_check;

alter table public.softora_social_lead_signals
  add constraint softora_social_lead_signals_publication_date_source_check
  check (publication_date_source in ('provider_timestamp', 'provider_date', 'serp_date', 'serp_text', 'manual', 'unknown'));

alter table public.softora_social_lead_signals
  drop constraint if exists softora_social_lead_signals_publication_date_confidence_check;

alter table public.softora_social_lead_signals
  add constraint softora_social_lead_signals_publication_date_confidence_check
  check (publication_date_confidence is null or publication_date_confidence between 0 and 100);

create index if not exists softora_social_lead_signals_publication_date_idx
  on public.softora_social_lead_signals (publication_date_source, published_at desc);

comment on column public.softora_social_lead_signals.publication_date_source is
  'Source used for publication date: provider field, SERP text, manual input, or unknown.';

commit;
