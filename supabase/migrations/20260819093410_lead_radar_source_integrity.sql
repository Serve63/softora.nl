alter table public.softora_social_lead_signals
  add column if not exists source_verification_status text not null default 'unverified',
  add column if not exists source_verification_reason text,
  add column if not exists source_verified_at timestamptz,
  add column if not exists source_canonical_url text,
  add column if not exists source_post_id text,
  add column if not exists source_content_match_score integer;

alter table public.softora_social_lead_scan_runs
  add column if not exists verified_count integer not null default 0,
  add column if not exists rejected_count integer not null default 0,
  add column if not exists unverified_count integer not null default 0,
  add column if not exists platform_stats jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'softora_social_lead_signals_source_verification_status_check'
      and conrelid = 'public.softora_social_lead_signals'::regclass
  ) then
    alter table public.softora_social_lead_signals
      add constraint softora_social_lead_signals_source_verification_status_check
      check (source_verification_status in ('unverified', 'verified', 'rejected', 'manual'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'softora_social_lead_signals_source_content_match_score_check'
      and conrelid = 'public.softora_social_lead_signals'::regclass
  ) then
    alter table public.softora_social_lead_signals
      add constraint softora_social_lead_signals_source_content_match_score_check
      check (source_content_match_score is null or source_content_match_score between 0 and 100);
  end if;
end
$$;

create index if not exists softora_social_lead_signals_verified_publication_idx
  on public.softora_social_lead_signals (published_at desc)
  where source_verification_status = 'verified';

alter table public.softora_social_lead_signals enable row level security;
alter table public.softora_social_lead_scan_runs enable row level security;

revoke all on table public.softora_social_lead_signals from public, anon, authenticated;
revoke all on table public.softora_social_lead_scan_runs from public, anon, authenticated;
grant select, insert, update, delete on table public.softora_social_lead_signals to service_role;
grant select, insert, update, delete on table public.softora_social_lead_scan_runs to service_role;

notify pgrst, 'reload schema';
