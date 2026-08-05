alter table public.softora_mailbox_messages
  add column if not exists softora_read_at timestamptz;

create or replace function public.softora_preserve_mailbox_read_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.softora_read_at is not null then
    new.softora_read_at := old.softora_read_at;
    new.unread := false;
  elsif new.softora_read_at is not null then
    new.unread := false;
  end if;
  return new;
end;
$$;

drop trigger if exists softora_mailbox_messages_preserve_read_state
  on public.softora_mailbox_messages;
create trigger softora_mailbox_messages_preserve_read_state
before update on public.softora_mailbox_messages
for each row execute function public.softora_preserve_mailbox_read_state();
