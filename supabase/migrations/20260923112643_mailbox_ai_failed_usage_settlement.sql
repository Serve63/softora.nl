-- Successful API responses can have unusable content but still provide complete billable usage.
-- Transport/partial failures remain fully reserved. No replay or budget increase.
create or replace function public.softora_settle_mailbox_ai_usage() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare cost bigint;
begin
  if new.status not in ('ready','failed') or new.charged_micro_usd is not null or new.claim_reserved_micro_usd = 0 then return new; end if;
  -- No zero-cost assumption when usage is absent, invalid, or only one of two calls is known.
  if new.usage->>'model' = 'gpt-6-luna' then
    if coalesce(new.usage->>'complete','false') <> 'true'
      or coalesce(new.usage->>'billingMicroUsd','') !~ '^[0-9]{1,12}$' then return new; end if;
    cost := (new.usage->>'billingMicroUsd')::bigint;
  elsif new.usage->>'model' is null and new.status='ready' then
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

-- Separate identity lookups so both branches use their complete point indexes.
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
