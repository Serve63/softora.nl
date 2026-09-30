-- Add display evidence to the existing protected mirror. No contact approval or
-- access changes; existing publishers remain compatible through the default.
set lock_timeout = '5s';
alter table public.softora_kvk_company_directory
  add column if not exists research_dossier jsonb not null default '{}'::jsonb;
comment on column public.softora_kvk_company_directory.research_dossier is
  'Unconfirmed candidate contacts and sources from the canonical research audit; display only.';
