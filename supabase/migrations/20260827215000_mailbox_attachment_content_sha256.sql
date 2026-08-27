-- Hash-bearing attachment metadata is additive: existing three-field rows stay
-- valid, while new four-field rows must use one exact lowercase SHA-256 per
-- attachment. A batch may never mix hashed and legacy metadata.
-- mailbox-attachment-content-sha256:start

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
  v_has_sha256 boolean;
  v_hash_mode boolean := null;
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

    v_has_sha256 := pg_catalog.jsonb_exists(v_item, 'sha256');
    if v_hash_mode is null then
      v_hash_mode := v_has_sha256;
    elsif v_hash_mode is distinct from v_has_sha256 then
      return false;
    end if;

    if v_key_count <> (case when v_has_sha256 then 4 else 3 end)
      or pg_catalog.jsonb_typeof(v_item->'filename') <> 'string'
      or pg_catalog.char_length(pg_catalog.btrim(v_item->>'filename')) not between 1 and 120
      or (v_item->>'filename') <> pg_catalog.btrim(v_item->>'filename')
      or (v_item->>'filename') ~ '[[:cntrl:]/\\]'
      or pg_catalog.jsonb_typeof(v_item->'contentType') <> 'string'
      or pg_catalog.char_length(pg_catalog.btrim(v_item->>'contentType')) not between 3 and 255
      or (v_item->>'contentType') <> pg_catalog.lower(pg_catalog.btrim(v_item->>'contentType'))
      or pg_catalog.strpos(v_item->>'contentType', '/') <= 1
      or pg_catalog.jsonb_typeof(v_item->'size') <> 'number'
      or (v_has_sha256 and (
        pg_catalog.jsonb_typeof(v_item->'sha256') <> 'string'
        or (v_item->>'sha256') !~ '^[0-9a-f]{64}$'
      )) then
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

-- mailbox-attachment-content-sha256:end
