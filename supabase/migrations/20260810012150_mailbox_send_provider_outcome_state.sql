-- mailbox-send-provider-outcome-state:start
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.softora_mailbox_canonical_sha256(p_parts text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        coalesce(string_agg(
          octet_length(convert_to(coalesce(part, ''), 'UTF8'))::text || ':' || coalesce(part, ''),
          '|' order by ordinal
        ), ''),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from unnest(p_parts) with ordinality as values_with_order(part, ordinal);
$$;
revoke all on function public.softora_mailbox_canonical_sha256(text[])
  from public, anon, authenticated, service_role;

alter table public.softora_mailbox_send_provenance
  add column if not exists send_identity_key text,
  add column if not exists send_scope_key text,
  add column if not exists payload_fingerprint text,
  add column if not exists attachments_fingerprint text not null default '',
  add column if not exists dispatch_state text not null default 'reserved',
  add column if not exists dispatch_started_at timestamptz,
  add column if not exists dispatch_lease_expires_at timestamptz,
  add column if not exists outbound_guard_required boolean not null default false,
  add column if not exists outbound_guard_reconcile_required boolean not null default false,
  add column if not exists sent_reconcile_required boolean not null default false,
  add column if not exists accepted_recipients jsonb not null default '[]'::jsonb,
  add column if not exists rejected_recipients jsonb not null default '[]'::jsonb,
  add column if not exists storage_degraded boolean not null default false,
  add column if not exists reconcile_required boolean not null default false;

do $$
begin
  if exists (
    select 1
    from public.softora_mailbox_send_provenance
    where status in ('prepared', 'accepted')
      and (
        lower(btrim(provider)) not in ('smtp', 'instantly') or
        (mode = 'reply' and (
          nullif(btrim(reply_target_message_id), '') is null or
          coalesce(nullif(btrim(provider_thread_id), ''), nullif(btrim(conversation_id), '')) is null
        ))
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Actieve legacy mailbox-send mist semantische provider/threadidentiteit';
  end if;
end;
$$;

with normalized as (
  select
    intent_id,
    lower(btrim(owner)) as owner_value,
    lower(btrim(account_email)) as account_value,
    lower(btrim(recipient_email)) as recipient_value,
    lower(btrim(provider)) as provider_value,
    lower(btrim(mode)) as mode_value,
    case
      when lower(btrim(mode)) = 'reply' then coalesce(
        nullif(btrim(provider_thread_id), ''), btrim(coalesce(conversation_id, ''))
      )
      else btrim(coalesce(conversation_id, ''))
    end as thread_value,
    case when lower(btrim(mode)) = 'reply'
      then btrim(coalesce(reply_target_message_id, '')) else '' end as reply_target_value
  from public.softora_mailbox_send_provenance
), semantic_scopes as (
  select
    intent_id,
    provider_value || '-' || mode_value || '-scope:' ||
      public.softora_mailbox_canonical_sha256(array[
        owner_value, account_value, recipient_value, provider_value, mode_value,
        thread_value, reply_target_value
      ]) as semantic_scope_key
  from normalized
)
update public.softora_mailbox_send_provenance as provenance
set send_scope_key = semantic_scopes.semantic_scope_key
from semantic_scopes
where provenance.intent_id = semantic_scopes.intent_id
  and (provenance.send_scope_key is null or provenance.send_scope_key like 'legacy:%');

update public.softora_mailbox_send_provenance
set payload_fingerprint = public.softora_mailbox_canonical_sha256(array[
  btrim(coalesce(subject, '')),
  replace(replace(btrim(coalesce(body_text, '')), E'\r\n', E'\n'), E'\r', E'\n'),
  lower(btrim(coalesce(cc_text, ''))),
  lower(btrim(coalesce(bcc_text, ''))),
  btrim(coalesce(attachments_fingerprint, ''))
])
where payload_fingerprint is null;

update public.softora_mailbox_send_provenance
set send_identity_key = case
  when mode = 'reply' then replace(send_scope_key, '-scope:', ':')
  else 'new-message:' || public.softora_mailbox_canonical_sha256(array[
    send_scope_key, payload_fingerprint
  ])
end
where send_identity_key is null or send_identity_key like 'legacy:%';

update public.softora_mailbox_send_provenance
set
  dispatch_state = case
    when status in ('accepted', 'failed') then 'finished'
    else 'started'
  end,
  dispatch_started_at = case
    when status in ('prepared', 'unknown')
      then coalesce(dispatch_started_at, updated_at, created_at)
    else dispatch_started_at
  end,
  dispatch_lease_expires_at = null
where dispatch_state = 'reserved' and dispatch_lease_expires_at is null;

alter table public.softora_mailbox_send_provenance
  alter column send_identity_key set not null,
  alter column send_scope_key set not null,
  alter column payload_fingerprint set not null;

alter table public.softora_mailbox_send_provenance
  drop constraint if exists softora_mailbox_send_provenance_status_check,
  drop constraint if exists softora_mailbox_send_provenance_provider_check,
  drop constraint if exists softora_mailbox_send_provenance_dispatch_state_check;
alter table public.softora_mailbox_send_provenance
  add constraint softora_mailbox_send_provenance_status_check
    check (status in ('prepared', 'accepted', 'failed', 'unknown')),
  add constraint softora_mailbox_send_provenance_provider_check
    check (provider in ('smtp', 'instantly')),
  add constraint softora_mailbox_send_provenance_dispatch_state_check
    check (dispatch_state in ('reserved', 'started', 'finished'));

create or replace function public.softora_enforce_mailbox_send_status_monotone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not (
    old.status = new.status or
    (old.status = 'prepared' and new.status in ('accepted', 'unknown', 'failed')) or
    (old.status = 'unknown' and new.status = 'accepted')
  ) then
    raise exception using
      errcode = '23514',
      message = 'Mailbox-sendstatus mag niet worden teruggedraaid';
  end if;
  if not (
    old.dispatch_state = new.dispatch_state or
    (old.dispatch_state = 'reserved' and new.dispatch_state in ('started', 'finished')) or
    (old.dispatch_state = 'started' and new.dispatch_state = 'finished')
  ) then
    raise exception using
      errcode = '23514',
      message = 'Mailbox-dispatchstatus mag niet worden teruggedraaid';
  end if;
  return new;
end;
$$;
revoke all on function public.softora_enforce_mailbox_send_status_monotone()
  from public, anon, authenticated, service_role;
drop trigger if exists softora_mailbox_send_status_monotone
  on public.softora_mailbox_send_provenance;
create trigger softora_mailbox_send_status_monotone
before update of status, dispatch_state on public.softora_mailbox_send_provenance
for each row execute function public.softora_enforce_mailbox_send_status_monotone();

drop index if exists public.softora_mailbox_send_provenance_active_identity_idx;
create unique index softora_mailbox_send_provenance_active_identity_idx
  on public.softora_mailbox_send_provenance (send_identity_key)
  where status in ('prepared', 'unknown', 'accepted');

create unique index if not exists softora_mailbox_send_provenance_active_scope_idx
  on public.softora_mailbox_send_provenance (send_scope_key)
  where mode = 'new-message' and status in ('prepared', 'unknown');

revoke all privileges on table public.softora_mailbox_send_provenance
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.softora_mailbox_send_provenance
  to service_role;
-- mailbox-send-provider-outcome-state:end
