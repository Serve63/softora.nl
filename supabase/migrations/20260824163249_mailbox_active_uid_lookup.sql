-- Restore the access path used by campaign sync after UID generations replaced
-- the former account/folder/uid uniqueness index. The partial predicate exactly
-- matches the active-row filters used by listMessageUidsForAccount, while date
-- remains available for the campaign-history lower bound without a heap read.
create index if not exists softora_mailbox_messages_account_folder_uid_active_idx
  on public.softora_mailbox_messages (account_email, folder, uid desc)
  include (date)
  where deleted_at is null
    and generation_superseded_at is null;
