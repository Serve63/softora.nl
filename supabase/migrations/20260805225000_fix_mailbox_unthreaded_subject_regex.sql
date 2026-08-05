create or replace function public.softora_find_mailbox_unthreaded_sent_candidates(
  p_targets jsonb,
  p_limit integer default 1000
)
returns table (target_conversation_id text, message jsonb)
language sql
stable
set search_path = public
as $$
  with targets as (
    select
      nullif(trim(target.conversation_id), '') as conversation_id,
      lower(trim(target.account_email)) as account_email,
      lower(trim(target.counterparty_email)) as counterparty_email,
      lower(trim(target.canonical_subject)) as canonical_subject,
      target.latest_inbound_at
    from jsonb_to_recordset(coalesce(p_targets, '[]'::jsonb)) as target(
      conversation_id text,
      account_email text,
      counterparty_email text,
      canonical_subject text,
      latest_inbound_at timestamptz
    )
    where nullif(trim(target.conversation_id), '') is not null
      and nullif(trim(target.account_email), '') is not null
      and nullif(trim(target.counterparty_email), '') is not null
      and nullif(trim(target.canonical_subject), '') is not null
      and target.latest_inbound_at is not null
  ), ranked as (
    select
      targets.conversation_id as target_conversation_id,
      to_jsonb(messages) as message,
      row_number() over (
        partition by targets.conversation_id
        order by messages.date asc, messages.message_key asc
      ) as candidate_rank
    from targets
    join public.softora_mailbox_messages as messages
      on messages.account_email = targets.account_email
      and messages.folder = 'sent'
      and messages.deleted_at is null
      and messages.date > targets.latest_inbound_at
      and position(targets.counterparty_email in lower(coalesce(messages.recipients_text, ''))) > 0
      and regexp_replace(
        lower(trim(coalesce(messages.subject, ''))),
        '^\s*((re|fw|fwd)\s*:\s*)+',
        '',
        'i'
      ) = targets.canonical_subject
      and coalesce(messages.in_reply_to, '') = ''
      and coalesce(messages.references_text, '') = ''
      and coalesce(messages.payload->>'providerThreadId', '') = ''
  )
  select ranked.target_conversation_id, ranked.message
  from ranked
  where ranked.candidate_rank <= 3
  order by ranked.target_conversation_id, ranked.candidate_rank
  limit greatest(1, least(coalesce(p_limit, 1000), 3000));
$$;

revoke all on function public.softora_find_mailbox_unthreaded_sent_candidates(jsonb, integer)
  from public, anon, authenticated;

grant execute on function public.softora_find_mailbox_unthreaded_sent_candidates(jsonb, integer)
  to service_role;
