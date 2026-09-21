-- The background worker searches across owners; account-leading indexes cannot
-- serve its global date order and caused full scans before LIMIT 20.
create index softora_mailbox_ai_candidate_date_idx
  on public.softora_mailbox_messages(date desc, message_key)
  where folder in ('inbox','instantly','allmail') and has_body and not body_truncated
    and deleted_at is null and generation_superseded_at is null;
