begin;

alter table public.softora_social_lead_signals
  drop constraint if exists softora_social_lead_signals_platform_check;

alter table public.softora_social_lead_signals
  add constraint softora_social_lead_signals_platform_check
  check (platform in ('facebook', 'instagram', 'linkedin'));

comment on column public.softora_social_lead_signals.platform is
  'Supported active sources are facebook and linkedin. Instagram rows remain readable only for legacy preservation and are hidden by the application.';

commit;

