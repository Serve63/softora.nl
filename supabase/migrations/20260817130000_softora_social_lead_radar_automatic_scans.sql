alter table public.softora_social_lead_scan_runs
  add column if not exists scan_mode text not null default 'manual',
  add column if not exists max_age_days integer;

alter table public.softora_social_lead_scan_runs
  drop constraint if exists softora_social_lead_scan_runs_scan_mode_check;

alter table public.softora_social_lead_scan_runs
  add constraint softora_social_lead_scan_runs_scan_mode_check
  check (scan_mode in ('manual', 'automatic'));

alter table public.softora_social_lead_scan_runs
  drop constraint if exists softora_social_lead_scan_runs_max_age_days_check;

alter table public.softora_social_lead_scan_runs
  add constraint softora_social_lead_scan_runs_max_age_days_check
  check (max_age_days is null or max_age_days between 1 and 3650);

create index if not exists softora_social_lead_scan_runs_automatic_idx
  on public.softora_social_lead_scan_runs (scan_mode, started_at desc);
