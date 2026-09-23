-- Settle only complete, recorded usage. Uncertain attempts keep their entire hold.
-- approved_micro_usd is never changed by this migration.
alter table public.softora_mailbox_ai_budget add column spent_micro_usd bigint not null default 0 check (spent_micro_usd >= 0);
alter table public.softora_mailbox_ai_budget add column include_history boolean not null default false;
alter table public.softora_mailbox_ai_presentations add column claim_reserved_micro_usd bigint not null default 0 check (claim_reserved_micro_usd >= 0);
alter table public.softora_mailbox_ai_presentations add column charged_micro_usd bigint check (charged_micro_usd >= 0);
alter table public.softora_mailbox_ai_presentations add column prior_uncertain_micro_usd bigint not null default 0 check (prior_uncertain_micro_usd >= 0);
update public.softora_mailbox_ai_presentations set claim_reserved_micro_usd=100000 where started_at is not null;

create function public.softora_settle_mailbox_ai_usage() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare cost bigint;
begin
  if new.status <> 'ready' or new.charged_micro_usd is not null or new.claim_reserved_micro_usd = 0 then return new; end if;
  -- No zero-cost assumption when usage is absent, invalid, or only one of two calls is known.
  if new.usage->>'model' = 'gpt-6-luna' then
    if coalesce(new.usage->>'complete','false') <> 'true'
      or coalesce(new.usage->>'billingMicroUsd','') !~ '^[0-9]{1,12}$' then return new; end if;
    cost := (new.usage->>'billingMicroUsd')::bigint;
  elsif new.usage->>'model' is null then
    -- Legacy Luna 5.6: both successful calls were already summed. Maximum cache-write premium assumed.
    if coalesce(new.usage->>'inputTokens','') !~ '^[0-9]{1,9}$'
      or coalesce(new.usage->>'outputTokens','') !~ '^[0-9]{1,9}$'
      or (new.usage->>'inputTokens')::numeric <= 0 then return new; end if;
    cost := ceil((new.usage->>'inputTokens')::numeric * 0.25 + (new.usage->>'outputTokens')::numeric * 1.20);
  else return new;
  end if;
  -- Counter includes known spend + all outstanding/uncertain reservations for old-reader compatibility.
  update public.softora_mailbox_ai_budget
    set reserved_micro_usd = reserved_micro_usd - new.claim_reserved_micro_usd + cost,
        spent_micro_usd = spent_micro_usd + cost where id = 'mailbox-luna-v1';
  new.charged_micro_usd := cost;
  return new;
end;
$$;
revoke all on function public.softora_settle_mailbox_ai_usage() from public, anon, authenticated;
grant execute on function public.softora_settle_mailbox_ai_usage() to service_role;
create trigger mailbox_ai_settle_usage before update of status, usage on public.softora_mailbox_ai_presentations
for each row execute function public.softora_settle_mailbox_ai_usage();
update public.softora_mailbox_ai_presentations set status=status where status='ready';

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
    join lateral (select m.created_at, m.date from public.softora_mailbox_messages m
      where m.account_email=p.account_email and (m.message_key=p.message_key or m.message_id=p.source->>'identity')
        and m.deleted_at is null and m.generation_superseded_at is null
        and m.folder in ('inbox','instantly','allmail')
        and coalesce(m.payload->>'direction','received')<>'sent'
        and lower(m.sender_email)<>lower(m.account_email)
        and (budget.include_history or budget.incoming_after is null or m.created_at>=budget.incoming_after)
      order by m.created_at desc limit 1) canonical on true
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
    and m.folder in ('inbox','instantly','allmail') and m.has_body and not m.body_truncated
    and m.deleted_at is null and m.generation_superseded_at is null
    and length(trim(m.body_text)) between 1 and 240000
    and cardinality(string_to_array(m.body_text, E'\n')) <= 2400 and lower(m.sender_email) <> lower(m.account_email)
    and coalesce(m.payload->>'direction','received') <> 'sent'
    and not exists (select 1 from public.softora_mailbox_ai_presentations p
      where p.account_email = m.account_email and (p.message_key = m.message_key or p.source->>'identity' = nullif(m.message_id,'')) and p.version = 'mailbox-luna-v1'
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
      and (b.include_history or m.created_at >= b.incoming_after)) as value) eligible
  where b.id = 'mailbox-luna-v1' and p.id = any(p_ids);
$$;
revoke all on function public.softora_mailbox_ai_states(text[]) from public, anon, authenticated;
grant execute on function public.softora_mailbox_ai_states(text[]) to service_role;
