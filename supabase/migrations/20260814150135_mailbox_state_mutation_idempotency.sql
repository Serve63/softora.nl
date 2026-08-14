alter table public.softora_mailbox_messages
  add column if not exists state_revision bigint not null default 0;
alter table public.softora_mailbox_messages
  add column if not exists state_mutation_key text;
alter table public.softora_mailbox_messages
  add column if not exists state_mutation_at timestamptz;

alter table public.softora_mailbox_messages
  drop constraint if exists softora_mailbox_messages_state_revision_check;
alter table public.softora_mailbox_messages
  add constraint softora_mailbox_messages_state_revision_check
  check (state_revision >= 0) not valid;
alter table public.softora_mailbox_messages
  validate constraint softora_mailbox_messages_state_revision_check;

alter table public.softora_mailbox_messages
  drop constraint if exists softora_mailbox_messages_state_mutation_key_check;
alter table public.softora_mailbox_messages
  add constraint softora_mailbox_messages_state_mutation_key_check
  check (
    state_mutation_key is null
    or state_mutation_key ~ '^[a-f0-9]{64}$'
  ) not valid;
alter table public.softora_mailbox_messages
  validate constraint softora_mailbox_messages_state_mutation_key_check;

create index if not exists softora_mailbox_messages_state_mutation_key_idx
  on public.softora_mailbox_messages (state_mutation_key)
  where state_mutation_key is not null;

create or replace function public.softora_preserve_mailbox_read_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.state_revision > old.state_revision then
    if new.unread then
      new.softora_read_at := null;
    elsif new.softora_read_at is null then
      new.softora_read_at := clock_timestamp();
    end if;
  elsif old.softora_read_at is not null then
    new.softora_read_at := old.softora_read_at;
    new.unread := false;
  elsif new.softora_read_at is not null then
    new.unread := false;
  end if;
  return new;
end;
$$;

create or replace function public.softora_apply_mailbox_state_mutation(
  p_account_email text,
  p_folder text,
  p_uid bigint,
  p_provider_id text,
  p_mutation_key text,
  p_revision bigint,
  p_unread boolean default false,
  p_dismiss_reply boolean default false
)
returns table (
  message_key text,
  applied boolean,
  replayed boolean,
  superseded boolean,
  current_revision bigint,
  current_mutation_key text,
  unread boolean,
  softora_read_at timestamptz,
  reply_dismissed_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_row public.softora_mailbox_messages%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if char_length(btrim(coalesce(p_account_email, ''))) < 3
    or char_length(btrim(coalesce(p_folder, ''))) < 1
    or char_length(btrim(coalesce(p_mutation_key, ''))) <> 64
    or btrim(coalesce(p_mutation_key, '')) !~ '^[a-f0-9]{64}$'
    or coalesce(p_revision, 0) < 1
    or (coalesce(p_uid, 0) < 1 and char_length(btrim(coalesce(p_provider_id, ''))) < 1) then
    raise exception using errcode = '22023', message = 'Ongeldige mailbox-state-mutatie';
  end if;

  select m.*
  into v_row
  from public.softora_mailbox_messages as m
  where lower(btrim(m.account_email)) = lower(btrim(p_account_email))
    and lower(btrim(m.folder)) = lower(btrim(p_folder))
    and m.deleted_at is null
    and (
      (coalesce(p_uid, 0) > 0 and m.uid = p_uid)
      or (
        coalesce(p_uid, 0) < 1
        and m.provider_id = btrim(p_provider_id)
      )
    )
  order by m.updated_at desc, m.message_key
  limit 1
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Mailboxbericht niet gevonden';
  end if;

  if v_row.state_revision > p_revision
    or (
      v_row.state_revision = p_revision
      and v_row.state_mutation_key is distinct from btrim(p_mutation_key)
    ) then
    return query select
      v_row.message_key, false, false, true,
      v_row.state_revision, v_row.state_mutation_key,
      v_row.unread, v_row.softora_read_at, v_row.reply_dismissed_at;
    return;
  end if;

  if v_row.state_revision = p_revision
    and v_row.state_mutation_key = btrim(p_mutation_key) then
    return query select
      v_row.message_key, false, true, false,
      v_row.state_revision, v_row.state_mutation_key,
      v_row.unread, v_row.softora_read_at, v_row.reply_dismissed_at;
    return;
  end if;

  update public.softora_mailbox_messages as m
  set unread = coalesce(p_unread, false),
      softora_read_at = case
        when coalesce(p_unread, false) then null
        else coalesce(m.softora_read_at, v_now)
      end,
      reply_dismissed_at = case
        when coalesce(p_dismiss_reply, false) then coalesce(m.reply_dismissed_at, v_now)
        when coalesce(p_unread, false) then null
        else m.reply_dismissed_at
      end,
      state_revision = p_revision,
      state_mutation_key = btrim(p_mutation_key),
      state_mutation_at = v_now,
      updated_at = v_now
  where m.message_key = v_row.message_key
  returning m.* into v_row;

  return query select
    v_row.message_key, true, false, false,
    v_row.state_revision, v_row.state_mutation_key,
    v_row.unread, v_row.softora_read_at, v_row.reply_dismissed_at;
end;
$$;

revoke execute on function public.softora_apply_mailbox_state_mutation(
  text, text, bigint, text, text, bigint, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.softora_apply_mailbox_state_mutation(
  text, text, bigint, text, text, bigint, boolean, boolean
) to service_role;
