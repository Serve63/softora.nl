alter table public.softora_mailbox_messages
  add column if not exists reply_dismissed_at timestamptz;
