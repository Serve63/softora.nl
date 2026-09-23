-- Rows deliberately returned from the premium database to the scraper are
-- available again. Keep every other historical customer identity and email
-- alias excluded, including active premium customers and sent recipients.
create or replace view public.softora_kvk_unused_company_directory
with (security_invoker = true) as
with customer_identifiers as materialized (
  select
    regexp_replace(coalesce(payload->>'kvkNummer', ''), '[^0-9]', '', 'g') as kvk,
    case when payload->>'bronDatabase' = 'Softora Bedrijven Scraper'
      then btrim(coalesce(payload->>'bronCompanyId', '')) else '' end as source_id,
    lower(btrim(coalesce(email, ''))) as email
  from public.softora_customers
  where (deleted_at is not null
    and source = 'kvk-database-return-to-scraper'
    and payload->>'bronDatabase' = 'Softora Bedrijven Scraper') is not true
)
select d.*
from public.softora_kvk_company_directory d
where d.lead_status = 'usable'
  and d.premium_database_transferred = false
  and regexp_replace(coalesce(d.kvk_nummer, ''), '[^0-9]', '', 'g') not in (
    select kvk from customer_identifiers where kvk <> ''
  )
  and d.source_company_id::text not in (
    select source_id from customer_identifiers where source_id <> ''
  )
  and lower(btrim(coalesce(d.email, ''))) not in (
    select email from customer_identifiers where email <> ''
    union
    select lower(btrim(key_value))
    from public.softora_customer_identity_keys
    where key_type = 'email' and btrim(coalesce(key_value, '')) <> ''
  );

revoke all on table public.softora_kvk_unused_company_directory from public, anon, authenticated;
grant select on table public.softora_kvk_unused_company_directory to service_role;
comment on view public.softora_kvk_unused_company_directory is
  'Unused usable KVK rows, excluding premium imports by KVK, scraper source ID or exact email/alias except rows explicitly deleted and returned to the scraper; not a send-eligibility decision.';
notify pgrst, 'reload schema';
