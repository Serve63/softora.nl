alter table public.softora_kvk_company_directory
  add column if not exists unusable_review_grade smallint not null default 0,
  add column if not exists premium_database_transferred boolean not null default false;

alter table public.softora_kvk_company_directory_meta
  add column if not exists category_totals jsonb not null default '{}'::jsonb;

alter table public.softora_kvk_company_directory
  drop constraint if exists softora_kvk_company_directory_review_grade;

alter table public.softora_kvk_company_directory
  add constraint softora_kvk_company_directory_review_grade
  check (unusable_review_grade between 0 and 3);

create index if not exists softora_kvk_directory_treated_cursor_idx
  on public.softora_kvk_company_directory (source_company_id)
  where lead_status in ('usable', 'unusable');

create index if not exists softora_kvk_directory_successful_cursor_idx
  on public.softora_kvk_company_directory (source_company_id)
  where lead_status = 'usable';

create index if not exists softora_kvk_directory_usable_cursor_idx
  on public.softora_kvk_company_directory (source_company_id)
  where lead_status = 'usable'
    and usable_review_state = 'verified'
    and premium_database_transferred = false;

create index if not exists softora_kvk_directory_with_website_cursor_idx
  on public.softora_kvk_company_directory (source_company_id)
  where lead_status = 'usable'
    and usable_review_state = 'verified'
    and premium_database_transferred = false
    and website_status = 'found'
    and website <> '';

create index if not exists softora_kvk_directory_without_website_cursor_idx
  on public.softora_kvk_company_directory (source_company_id)
  where lead_status = 'usable'
    and usable_review_state = 'verified'
    and premium_database_transferred = false
    and website_status in ('no_website', 'not_working');

create index if not exists softora_kvk_directory_control_cursor_idx
  on public.softora_kvk_company_directory (source_company_id)
  where lead_status = 'unusable' and unusable_review_grade = 1;

create index if not exists softora_kvk_directory_definitive_cursor_idx
  on public.softora_kvk_company_directory (source_company_id)
  where lead_status = 'unusable' and unusable_review_grade >= 2;
