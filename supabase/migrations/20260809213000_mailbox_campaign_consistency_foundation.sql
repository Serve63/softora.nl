-- mailbox-campaign-consistency:start
create table if not exists public.softora_mailbox_campaign_consistency (
  scope text primary key default 'campaign' check (scope = 'campaign'),
  content_version bigint not null default 0 check (content_version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.softora_mailbox_campaign_mutations (
  mutation_id uuid primary key,
  scope text not null default 'campaign'
    references public.softora_mailbox_campaign_consistency (scope),
  request_key text not null check (char_length(btrim(request_key)) between 1 and 200),
  mutation_kind text not null check (char_length(btrim(mutation_kind)) between 1 and 120),
  account_email text,
  folder text,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'abandoned')),
  started_content_version bigint not null check (started_content_version >= 0),
  completed_content_version bigint,
  lease_expires_at timestamptz not null,
  completed_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint softora_mailbox_campaign_mutations_scope_request_key_key
    unique (scope, request_key),
  check (
    (status = 'pending' and completed_at is null and completed_content_version is null)
    or (
      status in ('completed', 'abandoned')
      and completed_at is not null
      and completed_content_version is not null
      and completed_content_version >= started_content_version
    )
  )
);

create index if not exists softora_mailbox_campaign_mutations_pending_lease_idx
  on public.softora_mailbox_campaign_mutations (lease_expires_at, mutation_id)
  where status = 'pending';

insert into public.softora_mailbox_campaign_consistency (scope, content_version)
values ('campaign', 0)
on conflict (scope) do nothing;

create or replace function public.softora_is_campaign_mailbox_message(
  p_account_email text,
  p_folder text,
  p_payload jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select (
    lower(btrim(coalesce(p_account_email, ''))) = any (array[
      'serve@softora.nl', 'servecreusen@softora.nl', 'servec321@gmail.com',
      'serve290@gmail.com', 'servecreusen7@gmail.com', 'martijn@softora.nl',
      'martijnvandeven@softora.nl', 'martijnven123@gmail.com',
      'contact.venvisuals@gmail.com'
    ]::text[])
    and lower(btrim(coalesce(p_folder, '')))
      = any (array['inbox', 'sent', 'coldmail']::text[])
  ) or (
    lower(btrim(coalesce(p_folder, ''))) = 'instantly'
    and lower(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'providerOwner', '')))
      = any (array['serve', 'martijn']::text[])
  );
$$;

create or replace function public.softora_track_mailbox_campaign_message_change()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_affects_campaign boolean := false;
begin
  if coalesce(current_setting('softora.mailbox_campaign_version_bumped', true), '') = '1' then
    return null;
  elsif tg_op = 'TRUNCATE' then
    v_affects_campaign := true;
  elsif tg_op = 'INSERT' then
    select exists (
      select 1 from softora_mailbox_campaign_new_rows as new_row
      where public.softora_is_campaign_mailbox_message(
        new_row.account_email, new_row.folder, new_row.payload
      )
    ) into v_affects_campaign;
  elsif tg_op = 'DELETE' then
    select exists (
      select 1 from softora_mailbox_campaign_old_rows as old_row
      where public.softora_is_campaign_mailbox_message(
        old_row.account_email, old_row.folder, old_row.payload
      )
    ) into v_affects_campaign;
  else
    select exists (
      select 1
      from softora_mailbox_campaign_old_rows as old_row
      full join softora_mailbox_campaign_new_rows as new_row
        on new_row.message_key = old_row.message_key
      where (
        public.softora_is_campaign_mailbox_message(
          old_row.account_email, old_row.folder, old_row.payload
        ) or public.softora_is_campaign_mailbox_message(
          new_row.account_email, new_row.folder, new_row.payload
        )
      ) and row(
        old_row.message_key, old_row.account_email, old_row.folder, old_row.uid,
        old_row.provider_id, old_row.message_id, old_row.in_reply_to, old_row.references_text,
        old_row.sender_name, old_row.sender_email, old_row.recipients_text, old_row.subject,
        old_row.preview, old_row.body_text, old_row.body_truncated, old_row.has_body,
        old_row.date, old_row.internal_date, old_row.unread, old_row.softora_read_at,
        old_row.starred, old_row.reply_dismissed_at, old_row.payload, old_row.deleted_at
      ) is distinct from row(
        new_row.message_key, new_row.account_email, new_row.folder, new_row.uid,
        new_row.provider_id, new_row.message_id, new_row.in_reply_to, new_row.references_text,
        new_row.sender_name, new_row.sender_email, new_row.recipients_text, new_row.subject,
        new_row.preview, new_row.body_text, new_row.body_truncated, new_row.has_body,
        new_row.date, new_row.internal_date, new_row.unread, new_row.softora_read_at,
        new_row.starred, new_row.reply_dismissed_at, new_row.payload, new_row.deleted_at
      )
    ) into v_affects_campaign;
  end if;

  if v_affects_campaign then
    perform set_config('softora.mailbox_campaign_version_bumped', '1', true);
    insert into public.softora_mailbox_campaign_consistency (
      scope, content_version, created_at, updated_at
    ) values ('campaign', 1, clock_timestamp(), clock_timestamp())
    on conflict (scope) do update set
      content_version = public.softora_mailbox_campaign_consistency.content_version + 1,
      updated_at = clock_timestamp();
  end if;
  return null;
end;
$$;

drop trigger if exists softora_track_mailbox_campaign_message_change
  on public.softora_mailbox_messages;
drop trigger if exists softora_track_mailbox_campaign_message_insert on public.softora_mailbox_messages;
drop trigger if exists softora_track_mailbox_campaign_message_update on public.softora_mailbox_messages;
drop trigger if exists softora_track_mailbox_campaign_message_delete on public.softora_mailbox_messages;
drop trigger if exists softora_track_mailbox_campaign_message_truncate on public.softora_mailbox_messages;
create trigger softora_track_mailbox_campaign_message_insert
after insert on public.softora_mailbox_messages
referencing new table as softora_mailbox_campaign_new_rows
for each statement execute function public.softora_track_mailbox_campaign_message_change();
create trigger softora_track_mailbox_campaign_message_update
after update on public.softora_mailbox_messages
referencing old table as softora_mailbox_campaign_old_rows
  new table as softora_mailbox_campaign_new_rows
for each statement execute function public.softora_track_mailbox_campaign_message_change();
create trigger softora_track_mailbox_campaign_message_delete
after delete on public.softora_mailbox_messages
referencing old table as softora_mailbox_campaign_old_rows
for each statement execute function public.softora_track_mailbox_campaign_message_change();
create trigger softora_track_mailbox_campaign_message_truncate
after truncate on public.softora_mailbox_messages
for each statement execute function public.softora_track_mailbox_campaign_message_change();

create or replace function public.softora_begin_mailbox_campaign_mutation(
  p_mutation_id uuid,
  p_request_key text,
  p_mutation_kind text,
  p_account_email text default null,
  p_folder text default null,
  p_lease_seconds integer default 120
)
returns table (
  mutation_id uuid, request_key text, mutation_status text,
  started_content_version bigint, completed_content_version bigint,
  current_content_version bigint, lease_expires_at timestamptz, replayed boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_state public.softora_mailbox_campaign_consistency%rowtype;
  v_mutation public.softora_mailbox_campaign_mutations%rowtype;
  v_inserted boolean := false;
  v_request_key text := btrim(coalesce(p_request_key, ''));
  v_kind text := lower(btrim(coalesce(p_mutation_kind, '')));
  v_account text := nullif(lower(btrim(coalesce(p_account_email, ''))), '');
  v_folder text := nullif(lower(btrim(coalesce(p_folder, ''))), '');
  v_lease integer := greatest(15, least(coalesce(p_lease_seconds, 120), 900));
begin
  if p_mutation_id is null or char_length(v_request_key) not between 1 and 200
    or char_length(v_kind) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'Ongeldige mailboxmutatie';
  end if;

  insert into public.softora_mailbox_campaign_consistency (scope, content_version)
  values ('campaign', 0) on conflict (scope) do nothing;
  select * into strict v_state
  from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;

  insert into public.softora_mailbox_campaign_mutations (
    mutation_id, scope, request_key, mutation_kind, account_email, folder,
    started_content_version, lease_expires_at
  ) values (
    p_mutation_id, 'campaign', v_request_key, v_kind, v_account, v_folder,
    v_state.content_version, clock_timestamp() + make_interval(secs => v_lease)
  )
  on conflict on constraint softora_mailbox_campaign_mutations_scope_request_key_key do nothing
  returning * into v_mutation;
  v_inserted := found;

  if not v_inserted then
    select * into strict v_mutation
    from public.softora_mailbox_campaign_mutations as existing_mutation
    where existing_mutation.scope = 'campaign'
      and existing_mutation.request_key = v_request_key
    for update;
    if v_mutation.mutation_kind is distinct from v_kind
      or v_mutation.account_email is distinct from v_account
      or v_mutation.folder is distinct from v_folder then
      raise exception using errcode = '22023',
        message = 'request_key hoort al bij een andere mailboxmutatie';
    end if;
  end if;

  return query select
    v_mutation.mutation_id, v_mutation.request_key, v_mutation.status,
    v_mutation.started_content_version, v_mutation.completed_content_version,
    v_state.content_version, v_mutation.lease_expires_at, not v_inserted;
end;
$$;

create or replace function public.softora_complete_mailbox_campaign_mutation(
  p_mutation_id uuid,
  p_request_key text,
  p_result jsonb default '{}'::jsonb
)
returns table (
  mutation_id uuid, mutation_status text, started_content_version bigint,
  completed_content_version bigint, current_content_version bigint, replayed boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_state public.softora_mailbox_campaign_consistency%rowtype;
  v_mutation public.softora_mailbox_campaign_mutations%rowtype;
  v_replayed boolean := false;
begin
  select * into strict v_state
  from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  select * into strict v_mutation
  from public.softora_mailbox_campaign_mutations as selected_mutation
  where selected_mutation.mutation_id = p_mutation_id for update;

  if v_mutation.request_key is distinct from btrim(coalesce(p_request_key, '')) then
    raise exception using errcode = '22023',
      message = 'mutation_id en request_key horen niet bij elkaar';
  elsif v_mutation.status = 'pending' then
    update public.softora_mailbox_campaign_mutations as pending_mutation set
      status = 'completed',
      completed_content_version = v_state.content_version,
      completed_at = clock_timestamp(),
      result = coalesce(p_result, '{}'::jsonb),
      updated_at = clock_timestamp()
    where pending_mutation.mutation_id = p_mutation_id
      and pending_mutation.status = 'pending'
    returning * into v_mutation;
  else
    v_replayed := true;
  end if;

  return query select
    v_mutation.mutation_id, v_mutation.status, v_mutation.started_content_version,
    v_mutation.completed_content_version, v_state.content_version, v_replayed;
end;
$$;

create or replace function public.softora_get_mailbox_campaign_fence(
  p_reap_expired boolean default true
)
returns table (
  content_version bigint, pending_count bigint, ready boolean,
  reaped_count bigint, checked_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_state public.softora_mailbox_campaign_consistency%rowtype;
  v_pending bigint := 0;
  v_reaped bigint := 0;
  v_checked_at timestamptz := clock_timestamp();
begin
  insert into public.softora_mailbox_campaign_consistency (scope, content_version)
  values ('campaign', 0) on conflict (scope) do nothing;
  select * into strict v_state
  from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;

  if coalesce(p_reap_expired, true) then
    with reaped as (
      update public.softora_mailbox_campaign_mutations set
        status = 'abandoned',
        completed_content_version = v_state.content_version,
        completed_at = v_checked_at,
        updated_at = v_checked_at
      where scope = 'campaign' and status = 'pending'
        and lease_expires_at <= v_checked_at
      returning 1
    ) select count(*) into v_reaped from reaped;
  end if;
  select count(*) into v_pending
  from public.softora_mailbox_campaign_mutations
  where scope = 'campaign' and status = 'pending';

  return query select
    v_state.content_version, v_pending, v_pending = 0, v_reaped, v_checked_at;
end;
$$;

alter table public.softora_mailbox_campaign_consistency enable row level security;
alter table public.softora_mailbox_campaign_mutations enable row level security;
revoke all privileges on table public.softora_mailbox_campaign_consistency
  from public, anon, authenticated, service_role;
revoke all privileges on table public.softora_mailbox_campaign_mutations
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.softora_mailbox_campaign_consistency to service_role;
grant select, insert, update on table public.softora_mailbox_campaign_mutations to service_role;

revoke all on function public.softora_is_campaign_mailbox_message(text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.softora_track_mailbox_campaign_message_change()
  from public, anon, authenticated;
revoke all on function public.softora_begin_mailbox_campaign_mutation(uuid, text, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.softora_complete_mailbox_campaign_mutation(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.softora_get_mailbox_campaign_fence(boolean)
  from public, anon, authenticated;
grant execute on function public.softora_is_campaign_mailbox_message(text, text, jsonb)
  to service_role;
grant execute on function public.softora_track_mailbox_campaign_message_change()
  to service_role;
grant execute on function public.softora_begin_mailbox_campaign_mutation(uuid, text, text, text, text, integer)
  to service_role;
grant execute on function public.softora_complete_mailbox_campaign_mutation(uuid, text, jsonb)
  to service_role;
grant execute on function public.softora_get_mailbox_campaign_fence(boolean)
  to service_role;
-- mailbox-campaign-consistency:end
