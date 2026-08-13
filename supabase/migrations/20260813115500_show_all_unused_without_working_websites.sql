drop index if exists public.softora_kvk_directory_without_website_cursor_idx;

create index softora_kvk_directory_without_website_cursor_idx
  on public.softora_kvk_company_directory (source_company_id)
  where lead_status = 'usable'
    and premium_database_transferred = false
    and website_status in ('no_website', 'not_working');
