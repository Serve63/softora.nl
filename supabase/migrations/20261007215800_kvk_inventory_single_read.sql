-- One consistent read of the existing safe source view, without Data API row caps
-- or repeating the customer exclusion scan for every 1,000 rows.
create or replace function public.softora_kvk_unused_inventory_rows()
returns jsonb language sql stable security invoker set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.source_company_id), '[]'::jsonb)
  from (
    select source_company_id, bedrijfsnaam, kvk_nummer, contact_status, lead_status,
      unusable_reason, telefoonnummer, email, website, website_status, woonplaats,
      gemeente, provincie, usable_review_state, usable_review_outcome,
      unusable_review_grade, premium_database_transferred, search_text
    from public.softora_kvk_unused_company_directory
    order by source_company_id
    limit 100001
  ) rows;
$$;
revoke all on function public.softora_kvk_unused_inventory_rows() from public, anon, authenticated;
grant execute on function public.softora_kvk_unused_inventory_rows() to service_role;
notify pgrst, 'reload schema';
