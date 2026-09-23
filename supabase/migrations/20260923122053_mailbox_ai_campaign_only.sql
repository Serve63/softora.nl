-- Only campaign-related incoming mail belongs to the Softora coldmailbox AI budget.
-- Retain existing paid results and unknown holds; the temporary budget pause is
-- restored only after this gate has been tested live.


create or replace function public.softora_claim_mailbox_ai(p_token uuid)
returns setof public.softora_mailbox_ai_presentations
language plpgsql security invoker set search_path = '' as $$
declare budget public.softora_mailbox_ai_budget; job public.softora_mailbox_ai_presentations;
begin
  if p_token is null then return; end if;
  select * into budget from public.softora_mailbox_ai_budget where id='mailbox-luna-v1' for update;
  if not found or budget.approved_micro_usd-budget.reserved_micro_usd < 300000 then return; end if;
  -- Global concurrency cap, including overlapping cron invocations.
  if (select count(*) from public.softora_mailbox_ai_presentations where status='running' and started_at>now()-interval '10 minutes') >= 8 then return; end if;
  select p.* into job from public.softora_mailbox_ai_presentations p
    join lateral (
      -- Try the canonical primary key first; only stale keys need JSON identity fallback.
      select m.created_at,m.date from public.softora_mailbox_messages m
      where m.account_email=p.account_email and m.message_key=p.message_key
        and m.deleted_at is null and m.generation_superseded_at is null
        and m.folder in ('inbox','instantly','allmail','coldmail') and lower(m.sender_email)<>lower(m.account_email)
        and public.softora_mailbox_message_has_campaign_proof(
          m.message_key, m.account_email, m.folder, m.message_id, m.in_reply_to,
          m.references_text, m.sender_name, m.sender_email, m.recipients_text,
          m.subject, m.payload, m.sender_email, null)
        and (budget.include_history or budget.incoming_after is null or m.created_at>=budget.incoming_after)
      union all
      select m.created_at,m.date from public.softora_mailbox_messages m
      where m.account_email=p.account_email and m.message_id=p.source->>'identity'
        and m.deleted_at is null and m.generation_superseded_at is null
        and m.folder in ('inbox','instantly','allmail','coldmail') and lower(m.sender_email)<>lower(m.account_email)
        and public.softora_mailbox_message_has_campaign_proof(
          m.message_key, m.account_email, m.folder, m.message_id, m.in_reply_to,
          m.references_text, m.sender_name, m.sender_email, m.recipients_text,
          m.subject, m.payload, m.sender_email, null)
        and (budget.include_history or budget.incoming_after is null or m.created_at>=budget.incoming_after)
        and not exists (select 1 from public.softora_mailbox_messages exact
          where exact.message_key=p.message_key and exact.account_email=p.account_email
            and exact.deleted_at is null and exact.generation_superseded_at is null)
      order by created_at desc limit 1
    ) canonical on true
    where p.status='queued' and p.version='mailbox-luna-v1'
    order by (canonical.created_at>=budget.incoming_after) desc nulls last, canonical.date desc nulls last, p.id
    limit 1 for update of p skip locked;
  if not found then return; end if;
  update public.softora_mailbox_ai_budget set reserved_micro_usd=reserved_micro_usd+300000 where id=budget.id;
  return query update public.softora_mailbox_ai_presentations set status='running', claim_token=p_token,
    started_at=now(), claim_reserved_micro_usd=300000 where id=job.id returning *;
end;
$$;

create or replace function public.softora_mailbox_ai_candidates(p_limit integer default 20)
returns setof public.softora_mailbox_messages
language sql stable security invoker set search_path = '' as $$
  select m.* from public.softora_mailbox_messages m
  where exists (select 1 from public.softora_mailbox_ai_budget b where b.id = 'mailbox-luna-v1'
      and b.approved_micro_usd - b.reserved_micro_usd >= 300000
      and (b.include_history or b.incoming_after is null or m.created_at >= b.incoming_after))
    and m.folder in ('inbox','instantly','allmail','coldmail') and m.has_body and not m.body_truncated
    and m.deleted_at is null and m.generation_superseded_at is null
    and length(trim(m.body_text)) between 1 and 240000
    and cardinality(string_to_array(m.body_text, E'\n')) <= 2400 and lower(m.sender_email) <> lower(m.account_email)
    and coalesce(m.payload->>'direction','received') <> 'sent'
    and public.softora_mailbox_message_has_campaign_proof(
          m.message_key, m.account_email, m.folder, m.message_id, m.in_reply_to,
          m.references_text, m.sender_name, m.sender_email, m.recipients_text,
          m.subject, m.payload, m.sender_email, null)
    and not exists (select 1 from public.softora_mailbox_ai_presentations p
      where p.account_email = m.account_email and p.message_key = m.message_key and p.version = 'mailbox-luna-v1'
        and p.source->>'body' = m.body_text and p.source->>'from' = coalesce(nullif(m.sender_name,''),nullif(m.sender_email,''),'Onbekend')
        and p.source->>'email' = coalesce(m.sender_email,''))
    and not exists (select 1 from public.softora_mailbox_ai_presentations p
      where p.account_email = m.account_email and p.source->>'identity' = nullif(m.message_id,'') and p.version = 'mailbox-luna-v1'
        and p.source->>'body' = m.body_text and p.source->>'from' = coalesce(nullif(m.sender_name,''),nullif(m.sender_email,''),'Onbekend')
        and p.source->>'email' = coalesce(m.sender_email,''))
  order by m.date desc, m.message_key limit greatest(1,least(coalesce(p_limit,20),50));
$$;

create or replace function public.softora_mailbox_ai_states(p_ids text[])
returns table(id text, status text, decision jsonb, version text, gate boolean, reason text)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.status, p.decision, p.version,
    eligible.value and p.status in ('queued','running')
      and p.created_at > now() - interval '10 minutes'
      and (p.status = 'running' or b.approved_micro_usd - b.reserved_micro_usd >= 300000),
    case when p.status = 'ready' then null
      when p.status = 'failed' then 'failed'
      when not eligible.value then 'outside_scope'
      when p.created_at <= now() - interval '10 minutes' then 'timeout'
      when p.status <> 'running' and b.approved_micro_usd - b.reserved_micro_usd < 300000 then 'budget'
      else null end
  from public.softora_mailbox_ai_presentations p
  cross join public.softora_mailbox_ai_budget b
  cross join lateral (select exists (
    select 1 from public.softora_mailbox_messages m where m.account_email = p.account_email
      and (m.message_key = p.message_key or m.message_id = p.source->>'identity')
      and (b.include_history or m.created_at >= b.incoming_after)
      and m.deleted_at is null and m.generation_superseded_at is null
      and public.softora_mailbox_message_has_campaign_proof(
          m.message_key, m.account_email, m.folder, m.message_id, m.in_reply_to,
          m.references_text, m.sender_name, m.sender_email, m.recipients_text,
          m.subject, m.payload, m.sender_email, null) ) as value) eligible
  where b.id = 'mailbox-luna-v1' and p.id = any(p_ids);
$$;
