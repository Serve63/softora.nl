-- No budget increase here: activation is a separate, explicitly approved operation.
alter table public.softora_mailbox_ai_budget add column incoming_after timestamptz;
create or replace function public.softora_claim_mailbox_ai(p_token uuid)
returns setof public.softora_mailbox_ai_presentations
language plpgsql security invoker set search_path = '' as $$
declare budget public.softora_mailbox_ai_budget; job public.softora_mailbox_ai_presentations;
begin
  if p_token is null then return; end if;
  select * into budget from public.softora_mailbox_ai_budget where id = 'mailbox-luna-v1' for update;
  if not found or budget.approved_micro_usd - budget.reserved_micro_usd < 100000 then return; end if;
  select * into job from public.softora_mailbox_ai_presentations
    where status = 'queued' and version = 'mailbox-luna-v1'
      and (budget.incoming_after is null or exists (select 1 from public.softora_mailbox_messages m
        where m.account_email = softora_mailbox_ai_presentations.account_email
          and (m.message_key = softora_mailbox_ai_presentations.message_key or m.message_id = softora_mailbox_ai_presentations.source->>'identity')
          and m.created_at >= budget.incoming_after)) order by created_at, id limit 1 for update skip locked;
  if not found then return; end if;
  -- Reserve both selection and removal review BEFORE any request; failures are not refunded or retried.
  update public.softora_mailbox_ai_budget set reserved_micro_usd = reserved_micro_usd + 100000 where id = budget.id;
  return query update public.softora_mailbox_ai_presentations
    set status = 'running', claim_token = p_token, started_at = now() where id = job.id returning *;
end;
$$;

create or replace function public.softora_mailbox_ai_candidates(p_limit integer default 20)
returns setof public.softora_mailbox_messages
language sql stable security invoker set search_path = '' as $$
  select m.* from public.softora_mailbox_messages m
  where exists (select 1 from public.softora_mailbox_ai_budget b where b.id = 'mailbox-luna-v1'
      and b.approved_micro_usd - b.reserved_micro_usd >= 100000
      and (b.incoming_after is null or m.created_at >= b.incoming_after))
    and m.folder in ('inbox','instantly','allmail') and m.has_body and not m.body_truncated
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

-- Read-only gate state; original bodies and stored decisions remain unchanged.
create function public.softora_mailbox_ai_states(p_ids text[])
returns table(id text, status text, decision jsonb, version text, gate boolean, reason text)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.status, p.decision, p.version,
    eligible.value and p.status in ('queued','running')
      and p.created_at > now() - interval '10 minutes'
      and (p.status = 'running' or b.approved_micro_usd - b.reserved_micro_usd >= 100000),
    case when p.status = 'ready' then null
      when p.status = 'failed' then 'failed'
      when not eligible.value then 'outside_scope'
      when p.created_at <= now() - interval '10 minutes' then 'timeout'
      when p.status <> 'running' and b.approved_micro_usd - b.reserved_micro_usd < 100000 then 'budget'
      else null end
  from public.softora_mailbox_ai_presentations p
  cross join public.softora_mailbox_ai_budget b
  cross join lateral (select b.incoming_after is not null and exists (
    select 1 from public.softora_mailbox_messages m where m.account_email = p.account_email
      and (m.message_key = p.message_key or m.message_id = p.source->>'identity')
      and m.created_at >= b.incoming_after) as value) eligible
  where b.id = 'mailbox-luna-v1' and p.id = any(p_ids);
$$;
revoke all on function public.softora_mailbox_ai_states(text[]) from public, anon, authenticated;
grant execute on function public.softora_mailbox_ai_states(text[]) to service_role;
