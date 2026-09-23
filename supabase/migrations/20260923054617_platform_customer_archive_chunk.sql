-- A bounded JSON result avoids PostgREST's row cap and repeated page requests.
-- The caller still needs SELECT access; this function never bypasses RLS.
create or replace function public.softora_customer_archive_chunk(p_offset integer, p_limit integer)
returns json
language sql
stable
security invoker
set search_path = ''
as $$
  select json_build_object(
    'rows', coalesce(json_agg(json_build_object(
      'customer_id', page.customer_id,
      'payload', page.payload,
      'updated_at', page.updated_at
    ) order by page.updated_at desc, page.customer_id asc), '[]'::json)
  )
  from (
    select customer_id, payload, updated_at
    from public.softora_customers
    where deleted_at is null
    order by updated_at desc, customer_id asc
    limit least(greatest(coalesce(p_limit, 0), 0), 5000)
    offset least(greatest(coalesce(p_offset, 0), 0), 25000)
  ) as page;
$$;

revoke all on function public.softora_customer_archive_chunk(integer, integer)
  from public, anon, authenticated;
grant execute on function public.softora_customer_archive_chunk(integer, integer)
  to service_role;
