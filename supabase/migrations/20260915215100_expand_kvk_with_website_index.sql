-- A usable, unused company belongs to "Met website" whenever it has a URL
-- and the website has not explicitly been classified as missing or not working.
-- This includes confirmed current-robot rows whose legacy website_status is
-- still `unknown` even though the website URL and usable review are present.

drop index if exists public.softora_kvk_directory_with_website_cursor_idx;
create index softora_kvk_directory_with_website_cursor_idx
  on public.softora_kvk_company_directory (source_company_id)
  where lead_status = 'usable'
    and premium_database_transferred = false
    and website <> ''
    and website_status <> 'no_website'
    and website_status <> 'not_working';
