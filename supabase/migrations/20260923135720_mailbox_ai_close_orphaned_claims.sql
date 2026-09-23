-- Older broad-queue claims can outlive their mailbox source. They must not
-- remain "running" forever or be retried outside proven campaign scope.
-- Their reservation remains untouched because provider billing is uncertain.
update public.softora_mailbox_ai_presentations p
set status='failed', finished_at=now(),
    usage=coalesce(p.usage, '{"complete":false,"errorCode":"MAILBOX_AI_ORPHANED_SCOPE"}'::jsonb)
where p.version='mailbox-luna-v1' and p.status='running'
  and p.started_at < now()-interval '16 minutes'
  and not exists (
    select 1 from public.softora_mailbox_messages m
    join public.softora_mailbox_ai_budget b on b.id='mailbox-luna-v1'
    where m.account_email=p.account_email
      and (m.message_key=p.message_key or m.message_id=p.source->>'identity')
      and m.deleted_at is null and m.generation_superseded_at is null
      and m.folder in ('inbox','instantly','allmail','coldmail')
      and lower(m.sender_email)<>lower(m.account_email)
      and (b.include_history or b.incoming_after is null or m.created_at>=b.incoming_after)
      and public.softora_mailbox_ai_has_campaign_hint(m)
      and public.softora_mailbox_message_has_campaign_proof(
        m.message_key,m.account_email,m.folder,m.message_id,m.in_reply_to,
        m.references_text,m.sender_name,m.sender_email,m.recipients_text,
        m.subject,m.payload,m.sender_email,null)
  );
