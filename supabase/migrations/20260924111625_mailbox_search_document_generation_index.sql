-- The contact timeline scope (softora_mailbox_contact_scope) filters
-- search_document LIKE '%contact%' together with generation_superseded_at is
-- null only. The previous partial trigram index also required deleted_at is
-- null, so the planner could not use it and every contact lookup scanned all
-- active messages four times (~0.9 s per timeline; 97 ms with this index).
-- This index covers a superset of the old rows, so queries that also filter
-- deleted_at still use it. Applied CONCURRENTLY on production beforehand; this
-- file records the resulting state idempotently.
--
-- Rollback:
--   create index concurrently if not exists softora_mailbox_messages_search_document_idx
--     on public.softora_mailbox_messages using gin (search_document gin_trgm_ops)
--     where deleted_at is null and generation_superseded_at is null;
--   drop index concurrently if exists public.softora_mailbox_messages_search_document_active_generation_idx;
create index if not exists softora_mailbox_messages_search_document_active_generation_idx
  on public.softora_mailbox_messages using gin (search_document gin_trgm_ops)
  where generation_superseded_at is null;
drop index if exists public.softora_mailbox_messages_search_document_idx;
