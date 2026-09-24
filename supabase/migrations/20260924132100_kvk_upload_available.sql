create table public.softora_kvk_upload_receipts (
  request_id uuid primary key,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.softora_kvk_upload_receipts enable row level security;
revoke all on public.softora_kvk_upload_receipts from public, anon, authenticated;
grant select, insert on public.softora_kvk_upload_receipts to service_role;

create or replace function public.softora_kvk_upload_available(
  p_request_id uuid, p_mode text, p_dry_run boolean, p_candidates jsonb
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_result jsonb;
  v_ids bigint[];
  v_count integer;
begin
  if p_mode is distinct from 'with-website' or p_dry_run is null
    or (not p_dry_run and p_request_id is null)
    or jsonb_typeof(p_candidates) is distinct from 'array'
    or jsonb_array_length(p_candidates) > 50000 then
    raise exception 'Invalid upload request';
  end if;
  if not p_dry_run then
    -- Serialize uploads with every other customer writer, while reads stay available.
    lock table public.softora_customers in share row exclusive mode;
    lock table public.softora_kvk_company_directory in share row exclusive mode;
    select result into v_result from public.softora_kvk_upload_receipts where request_id = p_request_id;
    if found then return v_result; end if;
  end if;

  with candidates as (
    select d.*, row_number() over (partition by coalesce(nullif(c.identity_key,''),'kvk:'||d.kvk_nummer) order by d.source_company_id) as identity_rank
    from public.softora_kvk_unused_company_directory d
    join jsonb_to_recordset(p_candidates) as c(source_company_id bigint, identity_key text, guard_keys jsonb)
      on c.source_company_id = d.source_company_id
    where d.website_status not in ('no_website','not_working')
      and btrim(d.website) <> '' and d.kvk_nummer ~ '^[0-9]{8}$'
      and not exists (select 1 from public.softora_customers existing
        where existing.identity_key = c.identity_key
          and (existing.deleted_at is not null and existing.source = 'kvk-database-return-to-scraper'
            and existing.payload->>'bronDatabase' = 'Softora Bedrijven Scraper') is not true)
      and not exists (select 1 from public.softora_outbound_recipient_guards g
        where g.guard_key in (select jsonb_array_elements_text(c.guard_keys)))
  )
  select coalesce(array_agg(source_company_id), '{}'::bigint[]) into v_ids from (
    select distinct on (case when btrim(d.email) <> '' then lower(btrim(d.email)) else 'kvk:' || d.kvk_nummer end)
      d.source_company_id
    from candidates d where identity_rank = 1
    order by case when btrim(d.email) <> '' then lower(btrim(d.email)) else 'kvk:' || d.kvk_nummer end, d.source_company_id
  ) eligible;
  v_count := cardinality(v_ids);
  v_result := jsonb_build_object('count',v_count,'destination','available','requestId',p_request_id);
  if p_dry_run then return v_result; end if;

  with source_rows as (
    select d.*, c.identity_key, 'kvk-upload-' || p_request_id::text || '-' || d.kvk_nummer as customer_id
    from public.softora_kvk_company_directory d
    join jsonb_to_recordset(p_candidates) as c(source_company_id bigint, identity_key text)
      on c.source_company_id = d.source_company_id
    where d.source_company_id = any(v_ids)
  )
  insert into public.softora_customers(customer_id,identity_key,company,contact_name,phone,email,website,
    database_status,lifecycle_status,responsible,payload,source,version)
  select customer_id,identity_key,bedrijfsnaam,bedrijfsnaam,telefoonnummer,email,website,
    'prospect','prospect','Serve',
    jsonb_build_object('id',customer_id,'naam',bedrijfsnaam,'bedrijf',bedrijfsnaam,'tel',telefoonnummer,
      'telefoon',telefoonnummer,'email',email,'website',website,'dom',website,'stad',woonplaats,
      'woonplaats',woonplaats,'gemeente',gemeente,'provincie',provincie,'status','prospect','databaseStatus','prospect',
      'call',true,'mail',true,'service','website','verantwoordelijk','Serve','updatedAt',now(),
      'kvkNummer',kvk_nummer,'bronDatabase','Softora Bedrijven Scraper','bronCompanyId',source_company_id,
      'premiumTransferRunId','kvk-transfer-' || p_request_id::text,'premiumTransferDestination','available',
      'hist',jsonb_build_array(jsonb_build_object('type','prospect','label','Geüpload vanuit Bedrijvendatabase',
        'date',current_date,'actor','Softora','messageKey','kvk-transfer:' || kvk_nummer))),
    'kvk-database-transfer',floor(extract(epoch from clock_timestamp()) * 1000)::bigint
  from source_rows;
  -- Destination exclusion also survives a later refresh of the local source mirror.
  update public.softora_kvk_company_directory set premium_database_transferred = true where source_company_id = any(v_ids);
  insert into public.softora_kvk_upload_receipts(request_id,result) values(p_request_id,v_result);
  return v_result;
end;
$$;
revoke all on function public.softora_kvk_upload_available(uuid,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.softora_kvk_upload_available(uuid,text,boolean,jsonb) to service_role;
notify pgrst, 'reload schema';
