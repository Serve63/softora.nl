-- Keep the online directory's partial indexes aligned with the filters used by
-- the live category pages. Pending review state must not hide otherwise usable,
-- unused companies, so these indexes intentionally do not filter on
-- usable_review_state.

drop index if exists public.softora_kvk_directory_usable_cursor_idx;
create index softora_kvk_directory_usable_cursor_idx
  on public.softora_kvk_company_directory (source_company_id)
  where lead_status = 'usable'
    and premium_database_transferred = false;

drop index if exists public.softora_kvk_directory_with_website_cursor_idx;
create index softora_kvk_directory_with_website_cursor_idx
  on public.softora_kvk_company_directory (source_company_id)
  where lead_status = 'usable'
    and premium_database_transferred = false
    and website_status = 'found'
    and website <> '';
