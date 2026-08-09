create table if not exists public.softora_kvk_company_directory (
  source_company_id bigint primary key,
  kvk_nummer text not null unique,
  bedrijfsnaam text not null,
  contact_status text not null default 'unknown',
  lead_status text not null default 'unresearched',
  unusable_reason text not null default '',
  telefoonnummer text not null default '',
  email text not null default '',
  website text not null default '',
  website_status text not null default 'unknown',
  woonplaats text not null default '',
  gemeente text not null default '',
  provincie text not null default '',
  usable_review_state text not null default 'not_required',
  usable_review_outcome text not null default '',
  search_text text not null default '',
  sync_generation text not null,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  constraint softora_kvk_company_directory_kvk_length
    check (char_length(kvk_nummer) between 1 and 32),
  constraint softora_kvk_company_directory_name_length
    check (char_length(bedrijfsnaam) between 1 and 500),
  constraint softora_kvk_company_directory_generation_length
    check (char_length(sync_generation) between 1 and 100)
);

create table if not exists public.softora_kvk_company_directory_meta (
  id text primary key,
  total bigint not null default 0,
  completed boolean not null default false,
  sync_generation text not null default '',
  source_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint softora_kvk_company_directory_meta_id
    check (id = 'canonical'),
  constraint softora_kvk_company_directory_meta_total
    check (total >= 0)
);

create index if not exists softora_kvk_company_directory_generation_idx
  on public.softora_kvk_company_directory (sync_generation);

alter table public.softora_kvk_company_directory enable row level security;
alter table public.softora_kvk_company_directory_meta enable row level security;

revoke all on table public.softora_kvk_company_directory from anon, authenticated;
revoke all on table public.softora_kvk_company_directory_meta from anon, authenticated;

grant select, insert, update, delete on table public.softora_kvk_company_directory to service_role;
grant select, insert, update, delete on table public.softora_kvk_company_directory_meta to service_role;

comment on table public.softora_kvk_company_directory is
  'Server-side online mirror of the canonical local KVK company directory; no direct browser access.';
comment on table public.softora_kvk_company_directory_meta is
  'Completion and exact-count metadata for the online KVK company directory mirror.';
