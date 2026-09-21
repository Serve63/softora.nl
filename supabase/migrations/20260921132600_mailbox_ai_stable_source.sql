-- Re-key derived records only; preserve paid attempts and the lifetime reservation counter.
-- Run with the pilot budget paused and no in-flight classifier requests.
do $$ begin
  if exists (select 1 from public.softora_mailbox_ai_presentations where status = 'running') then
    raise exception 'Pause the worker and wait for in-flight jobs before re-keying';
  end if;
end $$;
create temporary table mailbox_ai_source_keys on commit drop as
with hashes as (
  select p.id, p.status, p.created_at,
    encode(extensions.digest((select string_agg(octet_length(v)::text || ':' || v, '|' order by ord)
      from unnest(array[p.source->>'body', p.source->>'from', p.source->>'email',
        p.source->>'account', p.source->>'identity']) with ordinality a(v, ord)), 'sha256'), 'hex') as hash
  from public.softora_mailbox_ai_presentations p where p.version = 'mailbox-luna-v1'
), keys as (
  select *, encode(extensions.digest('mailbox-luna-v1:' || hash, 'sha256'), 'hex') as new_id from hashes
)
select *, row_number() over (partition by new_id order by
  case status when 'ready' then 0 when 'queued' then 1 else 2 end, created_at, id) as preference from keys;
update public.softora_mailbox_ai_presentations p
  set id = 'legacy-html:' || p.id, version = 'mailbox-luna-v1-html-key'
  from mailbox_ai_source_keys k where p.id = k.id and k.preference > 1;
update public.softora_mailbox_ai_presentations p
  set id = k.new_id, source = jsonb_set(jsonb_set(p.source, '{hash}', to_jsonb(k.hash)), '{id}', to_jsonb(k.new_id))
  from mailbox_ai_source_keys k where p.id = k.id and k.preference = 1;

-- Optional HTML hydration must not make unchanged source text a new job.
create or replace function public.softora_mailbox_ai_candidates(p_limit integer default 20)
returns setof public.softora_mailbox_messages
language sql stable security invoker set search_path = '' as $$
  select m.* from public.softora_mailbox_messages m
  where m.folder in ('inbox','instantly','allmail') and m.has_body and not m.body_truncated
    and m.deleted_at is null and m.generation_superseded_at is null
    and length(trim(m.body_text)) between 1 and 60000
    and cardinality(string_to_array(m.body_text, E'\n')) <= 600 and lower(m.sender_email) <> lower(m.account_email)
    and coalesce(m.payload->>'direction','received') <> 'sent'
    and not exists (select 1 from public.softora_mailbox_ai_presentations p
      where p.account_email = m.account_email and (p.message_key = m.message_key or p.source->>'identity' = nullif(m.message_id,'')) and p.version = 'mailbox-luna-v1'
        and p.source->>'body' = m.body_text and p.source->>'from' = coalesce(nullif(m.sender_name,''),nullif(m.sender_email,''),'Onbekend')
        and p.source->>'email' = coalesce(m.sender_email,''))
  order by m.date desc, m.message_key limit greatest(1,least(coalesce(p_limit,20),50));
$$;
