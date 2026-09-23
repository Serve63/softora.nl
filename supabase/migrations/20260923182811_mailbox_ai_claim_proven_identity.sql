-- An inbox copy can retain the queued message key while its allmail/coldmail
-- copy carries the verified campaign lineage. Prefer a proven exact copy, but
-- allow the same message identity to supply proof when the exact copy cannot.
create or replace function public.softora_claim_mailbox_ai(p_token uuid)
returns setof public.softora_mailbox_ai_presentations
language plpgsql security invoker set search_path = '' as $$
declare budget public.softora_mailbox_ai_budget; job public.softora_mailbox_ai_presentations;
begin
  if p_token is null then return; end if;
  select * into budget from public.softora_mailbox_ai_budget where id='mailbox-luna-v1' for update;
  if not found or budget.approved_micro_usd-budget.reserved_micro_usd < 300000 then return; end if;
  if (select count(*) from public.softora_mailbox_ai_presentations where status='running' and started_at>now()-interval '16 minutes') >= 2 then return; end if;
  select p.* into job from public.softora_mailbox_ai_presentations p
    join lateral (
      select 0 as priority,m.created_at,m.date from public.softora_mailbox_messages m
      where m.account_email=p.account_email and m.message_key=p.message_key
        and m.deleted_at is null and m.generation_superseded_at is null
        and m.folder in ('inbox','instantly','allmail','coldmail') and lower(m.sender_email)<>lower(m.account_email)
        and public.softora_mailbox_ai_has_campaign_hint(m)
        and public.softora_mailbox_message_has_campaign_proof(
          m.message_key, m.account_email, m.folder, m.message_id, m.in_reply_to,
          m.references_text, m.sender_name, m.sender_email, m.recipients_text,
          m.subject, m.payload, m.sender_email, null)
        and (budget.include_history or budget.incoming_after is null or m.created_at>=budget.incoming_after)
      union all
      select 1 as priority,m.created_at,m.date from public.softora_mailbox_messages m
      where m.account_email=p.account_email and m.message_id=p.source->>'identity'
        and m.deleted_at is null and m.generation_superseded_at is null
        and m.folder in ('inbox','instantly','allmail','coldmail') and lower(m.sender_email)<>lower(m.account_email)
        and public.softora_mailbox_ai_has_campaign_hint(m)
        and public.softora_mailbox_message_has_campaign_proof(
          m.message_key, m.account_email, m.folder, m.message_id, m.in_reply_to,
          m.references_text, m.sender_name, m.sender_email, m.recipients_text,
          m.subject, m.payload, m.sender_email, null)
        and (budget.include_history or budget.incoming_after is null or m.created_at>=budget.incoming_after)
      order by priority,created_at desc limit 1
    ) canonical on true
    where p.status='queued' and p.version='mailbox-luna-v1'
      and p.attempt_count < 2 and (p.retry_after is null or p.retry_after <= now())
    order by (canonical.created_at>=budget.incoming_after) desc nulls last, canonical.date desc nulls last, p.id
    limit 1 for update of p skip locked;
  if not found then return; end if;
  update public.softora_mailbox_ai_budget set reserved_micro_usd=reserved_micro_usd+300000 where id=budget.id;
  return query update public.softora_mailbox_ai_presentations set status='running', claim_token=p_token,
    started_at=now(), claim_reserved_micro_usd=300000,
    attempt_count=attempt_count+1, retry_after=null where id=job.id returning *;
end;
$$;
