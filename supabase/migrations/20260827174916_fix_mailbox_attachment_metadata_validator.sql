-- PostgreSQL's SQL-standard POSITION(substring IN string) grammar cannot be
-- schema-qualified as a regular function call. Use pg_catalog.strpos so the
-- attachment metadata constraint remains executable with search_path empty.

create or replace function public.softora_mailbox_attachments_metadata_is_valid(
  p_value jsonb
)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $function$
declare
  v_item jsonb;
  v_key_count integer;
  v_size numeric;
  v_total numeric := 0;
begin
  if pg_catalog.jsonb_typeof(p_value) <> 'array'
    or pg_catalog.jsonb_array_length(p_value) > 5 then
    return false;
  end if;

  for v_item in
    select item.value
    from pg_catalog.jsonb_array_elements(p_value) as item(value)
  loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object' then
      return false;
    end if;
    select pg_catalog.count(*)::integer
    into v_key_count
    from pg_catalog.jsonb_object_keys(v_item);

    if v_key_count <> 3
      or pg_catalog.jsonb_typeof(v_item->'filename') <> 'string'
      or pg_catalog.char_length(pg_catalog.btrim(v_item->>'filename')) not between 1 and 120
      or (v_item->>'filename') <> pg_catalog.btrim(v_item->>'filename')
      or (v_item->>'filename') ~ '[[:cntrl:]/\\]'
      or pg_catalog.jsonb_typeof(v_item->'contentType') <> 'string'
      or pg_catalog.char_length(pg_catalog.btrim(v_item->>'contentType')) not between 3 and 255
      or (v_item->>'contentType') <> pg_catalog.lower(pg_catalog.btrim(v_item->>'contentType'))
      or pg_catalog.strpos(v_item->>'contentType', '/') <= 1
      or pg_catalog.jsonb_typeof(v_item->'size') <> 'number' then
      return false;
    end if;

    v_size := (v_item->>'size')::numeric;
    if v_size <> pg_catalog.trunc(v_size)
      or v_size < 1
      or v_size > 4194304 then
      return false;
    end if;
    v_total := v_total + v_size;
  end loop;

  return v_total <= 5242880;
end;
$function$;

revoke all on function public.softora_mailbox_attachments_metadata_is_valid(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.softora_mailbox_attachments_metadata_is_valid(jsonb)
  to service_role;

notify pgrst, 'reload schema';
