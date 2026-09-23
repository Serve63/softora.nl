-- Supports the source-identity branch of the exact cache lookup without scanning every job for an account.
create index mailbox_ai_source_identity on public.softora_mailbox_ai_presentations(account_email,(source->>'identity'),version);
create index softora_mailbox_ai_received_date_idx on public.softora_mailbox_messages(date desc,message_key) where folder in ('inbox','instantly','allmail','coldmail') and has_body and not body_truncated and deleted_at is null and generation_superseded_at is null;
