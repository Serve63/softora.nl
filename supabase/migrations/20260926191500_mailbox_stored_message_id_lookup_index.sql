-- softora_list_stored_mailbox_message_ids joins on the normalized account and
-- Message-ID without a generation filter, so the existing partial
-- logical-message index cannot serve it and every campaign refresh scanned
-- the whole mailbox table (~1.2s). This index matches that join exactly.
create index if not exists softora_mailbox_messages_account_normalized_message_id_idx
  on public.softora_mailbox_messages (
    pg_catalog.lower(pg_catalog.btrim(account_email)),
    public.softora_normalize_mailbox_message_id(message_id)
  );
