-- A request may have reached the provider before its worker disappeared. Retain
-- that entire hold as uncertain; each bounded replay must reserve a new hold.
alter table public.softora_mailbox_ai_presentations
  add column attempt_count integer not null default 0 check (attempt_count between 0 and 2),
  add column retry_after timestamptz;

update public.softora_mailbox_ai_presentations
set attempt_count = 1 where started_at is not null;

create function public.softora_recover_mailbox_ai()
returns integer language plpgsql security invoker set search_path = '' as $$
declare recovered integer;
begin
  with candidates as (
    select p.id, p.status, p.claim_reserved_micro_usd, p.charged_micro_usd, p.attempt_count
    from public.softora_mailbox_ai_presentations p
    where p.version = 'mailbox-luna-v1' and (
      (p.status = 'running' and p.started_at < now() - interval '16 minutes')
      or (p.status = 'failed' and p.attempt_count < 2
        and p.finished_at < now() - interval '3 minutes'
        and (p.usage->>'errorCode' in ('MAILBOX_AI_TIMEOUT', 'MAILBOX_AI_REQUEST_FAILED')
          or (p.usage->>'errorCode' = 'MAILBOX_AI_PROVIDER_ERROR'
            and p.usage->>'providerStatus' ~ '^(429|5[0-9][0-9])$')))
    )
    and exists (
      select 1 from public.softora_mailbox_messages m
      join public.softora_mailbox_ai_budget b on b.id = 'mailbox-luna-v1'
      where m.account_email = p.account_email
        and (m.message_key = p.message_key or m.message_id = p.source->>'identity')
        and m.deleted_at is null and m.generation_superseded_at is null
        and m.folder in ('inbox','instantly','allmail','coldmail')
        and lower(m.sender_email) <> lower(m.account_email)
        and (b.include_history or b.incoming_after is null or m.created_at >= b.incoming_after)
        and public.softora_mailbox_ai_has_campaign_hint(m)
        and public.softora_mailbox_message_has_campaign_proof(
          m.message_key, m.account_email, m.folder, m.message_id, m.in_reply_to,
          m.references_text, m.sender_name, m.sender_email, m.recipients_text,
          m.subject, m.payload, m.sender_email, null)
    )
    order by p.started_at nulls last, p.finished_at nulls last
    limit 20 for update of p skip locked
  ), changed as (
    update public.softora_mailbox_ai_presentations p set
      status = case when c.attempt_count < 2 then 'queued' else 'failed' end,
      prior_uncertain_micro_usd = p.prior_uncertain_micro_usd
        + case when c.charged_micro_usd is null then c.claim_reserved_micro_usd else 0 end,
      claim_reserved_micro_usd = 0,
      claim_token = null,
      started_at = null,
      finished_at = case when c.attempt_count < 2 then null else coalesce(p.finished_at, now()) end,
      retry_after = case when c.attempt_count < 2 then now() + interval '3 minutes' else null end,
      usage = case when c.status = 'running'
        then coalesce(p.usage, '{}'::jsonb) || '{"errorCode":"MAILBOX_AI_WORKER_LOST"}'::jsonb
        else p.usage end
    from candidates c where p.id = c.id returning p.id
  ) select count(*) into recovered from changed;
  return recovered;
end;
$$;
revoke all on function public.softora_recover_mailbox_ai() from public, anon, authenticated;
grant execute on function public.softora_recover_mailbox_ai() to service_role;

create or replace function public.softora_claim_mailbox_ai(p_token uuid)
returns setof public.softora_mailbox_ai_presentations
language plpgsql security invoker set search_path = '' as $$
declare budget public.softora_mailbox_ai_budget; job public.softora_mailbox_ai_presentations;
begin
  if p_token is null then return; end if;
  select * into budget from public.softora_mailbox_ai_budget where id='mailbox-luna-v1' for update;
  if not found or budget.approved_micro_usd-budget.reserved_micro_usd < 300000 then return; end if;
  -- Global concurrency cap, including overlapping cron invocations.
  if (select count(*) from public.softora_mailbox_ai_presentations where status='running' and started_at>now()-interval '16 minutes') >= 2 then return; end if;
  select p.* into job from public.softora_mailbox_ai_presentations p
    join lateral (
      -- Try the canonical primary key first; only stale keys need JSON identity fallback.
      select m.created_at,m.date from public.softora_mailbox_messages m
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
      select m.created_at,m.date from public.softora_mailbox_messages m
      where m.account_email=p.account_email and m.message_id=p.source->>'identity'
        and m.deleted_at is null and m.generation_superseded_at is null
        and m.folder in ('inbox','instantly','allmail','coldmail') and lower(m.sender_email)<>lower(m.account_email)
        and public.softora_mailbox_ai_has_campaign_hint(m)
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
