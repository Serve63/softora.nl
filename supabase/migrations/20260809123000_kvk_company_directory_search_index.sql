create extension if not exists pg_trgm with schema extensions;

create index if not exists softora_kvk_company_directory_search_trgm_idx
  on public.softora_kvk_company_directory
  using gin (search_text extensions.gin_trgm_ops);
