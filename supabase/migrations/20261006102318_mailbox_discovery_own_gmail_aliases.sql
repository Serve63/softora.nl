-- Normalize only for excluding the caller's own mailbox identities. Account
-- authorization, external contact addresses and exact thread scope stay unchanged.
create or replace function public.softora_mailbox_own_identity(p_email text)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  with email as (
    select pg_catalog.lower(pg_catalog.btrim(p_email)) as value
  )
  select case
    when pg_catalog.split_part(value, '@', 2) = any(array['gmail.com', 'googlemail.com']::text[])
      then pg_catalog.replace(pg_catalog.split_part(pg_catalog.split_part(value, '@', 1), '+', 1), '.', '') || '@gmail.com'
    else value
  end
  from email;
$function$;

create or replace function public.softora_mailbox_outreach_contacts(
  p_account_emails text[]
)
returns table (contact_email text)
language sql
stable
security invoker
set search_path = ''
as $function$
  with accounts as (
    select array(
      select distinct pg_catalog.lower(pg_catalog.btrim(account_email))
      from pg_catalog.unnest(coalesce(p_account_emails, array[]::text[])) as source(account_email)
      where nullif(pg_catalog.btrim(account_email), '') is not null
    ) as values, array(
      select distinct public.softora_mailbox_own_identity(account_email)
      from pg_catalog.unnest(coalesce(p_account_emails, array[]::text[])) as source(account_email)
      where nullif(pg_catalog.btrim(account_email), '') is not null
    ) as own_identities
  )
  select guard.key_value as contact_email
  from public.softora_outbound_recipient_guards guard
  cross join accounts
  where guard.key_type = 'email'
    and guard.permanent = true
    and guard.channel = any(array['coldmail', 'instantly']::text[])
    and guard.provider = any(array['softora', 'instantly']::text[])
    and guard.sender_email = any(accounts.values)
    and public.softora_mailbox_own_identity(guard.key_value) <> all(accounts.own_identities)
  union
  select provenance.recipient_email
  from public.softora_mailbox_send_provenance provenance
  cross join accounts
  where provenance.account_email = any(accounts.values)
    and provenance.status = 'accepted'
    and provenance.provider = any(array['smtp', 'imap', 'instantly']::text[])
    and public.softora_mailbox_own_identity(provenance.recipient_email) <> all(accounts.own_identities)
  union
  select participant.contact_email
  from public.softora_mailbox_messages proof
  cross join accounts
  cross join lateral pg_catalog.unnest(public.softora_mailbox_message_participants(
    proof.sender_email,
    proof.recipients_text,
    proof.payload
  )) as participant(contact_email)
  where proof.deleted_at is null
    and proof.generation_superseded_at is null
    and proof.account_email = any(accounts.values)
    and public.softora_mailbox_own_identity(participant.contact_email) <> all(accounts.own_identities)
    and (
      proof.folder = 'coldmail'
      or (
        proof.folder = 'instantly'
        and pg_catalog.lower(pg_catalog.btrim(proof.payload->>'providerAccountEmail'))
          = pg_catalog.lower(pg_catalog.btrim(proof.account_email))
        and pg_catalog.lower(pg_catalog.btrim(proof.payload->>'providerOwner'))
          = any(array['serve', 'martijn']::text[])
      )
      or (
        proof.folder = 'sent'
        and pg_catalog.lower(pg_catalog.btrim(proof.payload->>'originalCampaignOutbound')) = 'true'
      )
      or pg_catalog.regexp_replace(
        public.softora_mailbox_search_normalize(proof.subject),
        '^((re|fw|fwd)[[:space:]]*:[[:space:]]*)+',
        ''
      ) = any(array['kleine vraag over jullie website', 'nieuw webdesign']::text[])
    );
$function$;

revoke all on function public.softora_mailbox_own_identity(text) from public, anon, authenticated;
grant execute on function public.softora_mailbox_own_identity(text) to service_role;
revoke all on function public.softora_mailbox_outreach_contacts(text[]) from public, anon, authenticated;
grant execute on function public.softora_mailbox_outreach_contacts(text[]) to service_role;
