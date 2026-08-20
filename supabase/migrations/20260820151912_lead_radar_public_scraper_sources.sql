begin;

alter table public.softora_social_lead_signals
  drop constraint if exists softora_social_lead_signals_platform_check;

alter table public.softora_social_lead_signals
  add constraint softora_social_lead_signals_platform_check
  check (platform in ('facebook', 'instagram', 'linkedin', 'web', 'mastodon', 'bluesky'));

alter table public.softora_social_lead_signals
  drop constraint if exists softora_social_lead_signals_source_type_check;

alter table public.softora_social_lead_signals
  add constraint softora_social_lead_signals_source_type_check
  check (source_type in ('serp', 'meta_graph', 'manual', 'feed', 'public_api', 'crawl'));

comment on column public.softora_social_lead_signals.platform is
  'Active self-scraped sources are web, mastodon and bluesky. Facebook, Instagram and LinkedIn remain allowed for legacy preservation and manual evidence imports.';

comment on column public.softora_social_lead_signals.source_type is
  'Origin of the evidence. New automatic rows use feed, public_api or crawl; legacy provider rows remain readable.';

alter table public.softora_social_lead_signals enable row level security;
revoke all on table public.softora_social_lead_signals from public, anon, authenticated;
grant select, insert, update, delete on table public.softora_social_lead_signals to service_role;

notify pgrst, 'reload schema';

commit;
