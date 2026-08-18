begin;

alter table public.softora_social_lead_signals
  drop constraint if exists softora_social_lead_signals_publication_date_source_check;

alter table public.softora_social_lead_signals
  add constraint softora_social_lead_signals_publication_date_source_check
  check (publication_date_source in (
    'provider_timestamp', 'provider_date', 'serp_date', 'serp_text',
    'post_meta', 'post_jsonld', 'post_time', 'manual', 'unknown'
  ));

comment on column public.softora_social_lead_signals.publication_date_source is
  'Source used for publication date: provider field, public post metadata/JSON-LD/time, SERP text, manual input, or unknown.';

commit;

