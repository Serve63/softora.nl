-- Sent-thread lookups only need (account_email, date). The previous index
-- copied subject, recipients and the whole payload into every index row, so
-- sync rejected larger sent mails ("index row requires 60760 bytes, maximum
-- size is 8191" / "exceeds btree version 4 maximum 2704").
-- Applied on production with CREATE/DROP INDEX CONCURRENTLY first; these
-- statements are idempotent afterwards.
-- Rollback:
--   create index concurrently softora_mailbox_sent_thread_lookup_idx
--     on public.softora_mailbox_messages (account_email, date desc)
--     include (subject, recipients_text, message_id, in_reply_to, references_text, payload)
--     where folder = 'sent' and deleted_at is null;
--   drop index concurrently public.softora_mailbox_sent_thread_recent_idx;
create index if not exists softora_mailbox_sent_thread_recent_idx
  on public.softora_mailbox_messages (account_email, date desc)
  where folder = 'sent' and deleted_at is null;
drop index if exists public.softora_mailbox_sent_thread_lookup_idx;
