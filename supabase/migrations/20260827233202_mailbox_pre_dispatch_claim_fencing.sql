-- A mailbox send is claimed before attachment download, body enrichment,
-- recipient guards, or provider work. The random transition_token fences each
-- phase; these columns durably distinguish the early claim from its fully
-- materialized, provider-ready successor.
-- mailbox-pre-dispatch-claim-fencing:start

alter table public.softora_mailbox_send_provenance
  add column if not exists pre_dispatch_claim_fingerprint text,
  add column if not exists pre_dispatch_finalized_at timestamptz;

alter table public.softora_mailbox_send_provenance
  drop constraint if exists softora_mailbox_send_pre_dispatch_claim_format_check,
  drop constraint if exists softora_mailbox_send_pre_dispatch_finalized_context_check;

alter table public.softora_mailbox_send_provenance
  add constraint softora_mailbox_send_pre_dispatch_claim_format_check
    check (
      pre_dispatch_claim_fingerprint is null
      or pre_dispatch_claim_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  add constraint softora_mailbox_send_pre_dispatch_finalized_context_check
    check (
      pre_dispatch_finalized_at is null
      or pre_dispatch_claim_fingerprint is not null
    );

comment on column public.softora_mailbox_send_provenance.pre_dispatch_claim_fingerprint
  is 'SHA-256 over immutable account, thread, request payload, and attachment metadata claimed before pre-provider work.';
comment on column public.softora_mailbox_send_provenance.pre_dispatch_finalized_at
  is 'Set only after exact claim-token CAS has bound final body and attachment byte fingerprints.';

create or replace function public.softora_claim_mailbox_pre_dispatch(
  p_row jsonb,
  p_transition_token uuid,
  p_lease_ms integer
)
returns setof public.softora_mailbox_send_provenance
language sql
volatile
security invoker
set search_path = ''
as $function$
  with db_now as (
    select pg_catalog.clock_timestamp() as ts
  )
  insert into public.softora_mailbox_send_provenance (
    intent_id, idempotency_key, send_identity_key, send_scope_key,
    payload_fingerprint, attachments_fingerprint, request_payload_fingerprint,
    attachments_metadata, owner, account_email, recipient_email, mode,
    conversation_id, reply_target_message_id, references_text, provider,
    provider_thread_id, sent_message_id, sender_name, subject, body_text,
    cc_text, bcc_text, status, dispatch_state, dispatch_started_at,
    dispatch_lease_expires_at, reconcile_required, sent_reconcile_required,
    error_text, transition_token, pre_dispatch_claim_fingerprint,
    pre_dispatch_finalized_at, created_at, updated_at
  )
  select
    p_row->>'intent_id', p_row->>'idempotency_key',
    p_row->>'send_identity_key', p_row->>'send_scope_key',
    p_row->>'payload_fingerprint', coalesce(p_row->>'attachments_fingerprint', ''),
    nullif(p_row->>'request_payload_fingerprint', ''),
    case when p_row->'attachments_metadata' = 'null'::jsonb
      then null else p_row->'attachments_metadata' end,
    p_row->>'owner', p_row->>'account_email', p_row->>'recipient_email',
    p_row->>'mode', nullif(p_row->>'conversation_id', ''),
    nullif(p_row->>'reply_target_message_id', ''),
    nullif(p_row->>'references_text', ''), p_row->>'provider',
    nullif(p_row->>'provider_thread_id', ''), nullif(p_row->>'sent_message_id', ''),
    nullif(p_row->>'sender_name', ''), p_row->>'subject',
    coalesce(p_row->>'body_text', ''), nullif(p_row->>'cc_text', ''),
    nullif(p_row->>'bcc_text', ''), 'prepared', 'reserved', null,
    db_now.ts + pg_catalog.make_interval(secs => p_lease_ms::double precision / 1000.0),
    false, false, null, p_transition_token,
    p_row->>'pre_dispatch_claim_fingerprint', null, db_now.ts, db_now.ts
  from db_now
  where p_transition_token is not null
    and p_lease_ms between 900000 and 3600000
    and p_row->>'pre_dispatch_claim_fingerprint' ~ '^[0-9a-f]{64}$'
  on conflict do nothing
  returning *;
$function$;

create or replace function public.softora_finalize_mailbox_pre_dispatch_claim(
  p_intent_id text,
  p_expected_transition_token uuid,
  p_expected_dispatch_lease_expires_at timestamptz,
  p_expected_updated_at timestamptz,
  p_expected_claim_fingerprint text,
  p_next_transition_token uuid,
  p_lease_ms integer,
  p_send_identity_key text,
  p_send_scope_key text,
  p_payload_fingerprint text,
  p_attachments_fingerprint text,
  p_request_payload_fingerprint text,
  p_attachments_metadata jsonb,
  p_sent_message_id text,
  p_sender_name text,
  p_subject text,
  p_body_text text,
  p_cc_text text,
  p_bcc_text text
)
returns setof public.softora_mailbox_send_provenance
language sql
volatile
security invoker
set search_path = ''
as $function$
  with db_now as (
    select pg_catalog.clock_timestamp() as ts
  ), transitioned as (
    update public.softora_mailbox_send_provenance as provenance
    set send_identity_key = p_send_identity_key,
        send_scope_key = p_send_scope_key,
        payload_fingerprint = p_payload_fingerprint,
        attachments_fingerprint = p_attachments_fingerprint,
        request_payload_fingerprint = p_request_payload_fingerprint,
        attachments_metadata = p_attachments_metadata,
        sent_message_id = p_sent_message_id,
        sender_name = p_sender_name,
        subject = p_subject,
        body_text = p_body_text,
        cc_text = p_cc_text,
        bcc_text = p_bcc_text,
        pre_dispatch_finalized_at = db_now.ts,
        dispatch_lease_expires_at = db_now.ts
          + pg_catalog.make_interval(secs => p_lease_ms::double precision / 1000.0),
        error_text = null,
        transition_token = p_next_transition_token,
        updated_at = db_now.ts
    from db_now
    where provenance.intent_id = p_intent_id
      and provenance.status = 'prepared'
      and provenance.dispatch_state = 'reserved'
      and provenance.transition_token = p_expected_transition_token
      and provenance.dispatch_lease_expires_at = p_expected_dispatch_lease_expires_at
      and provenance.updated_at = p_expected_updated_at
      and provenance.pre_dispatch_claim_fingerprint = p_expected_claim_fingerprint
      and provenance.pre_dispatch_finalized_at is null
      and provenance.dispatch_lease_expires_at > db_now.ts
      and p_next_transition_token is not null
      and p_next_transition_token <> p_expected_transition_token
      and p_lease_ms between 900000 and 3600000
    returning provenance.*
  )
  select * from transitioned;
$function$;

create or replace function public.softora_start_mailbox_pre_dispatch(
  p_intent_id text,
  p_expected_transition_token uuid,
  p_expected_dispatch_lease_expires_at timestamptz,
  p_expected_updated_at timestamptz,
  p_expected_claim_fingerprint text,
  p_expected_finalized_at timestamptz,
  p_next_transition_token uuid,
  p_lease_ms integer
)
returns setof public.softora_mailbox_send_provenance
language sql
volatile
security invoker
set search_path = ''
as $function$
  with db_now as (
    select pg_catalog.clock_timestamp() as ts
  ), transitioned as (
    update public.softora_mailbox_send_provenance as provenance
    set dispatch_state = 'started',
        dispatch_started_at = db_now.ts,
        dispatch_lease_expires_at = db_now.ts
          + pg_catalog.make_interval(secs => p_lease_ms::double precision / 1000.0),
        transition_token = p_next_transition_token,
        updated_at = db_now.ts
    from db_now
    where provenance.intent_id = p_intent_id
      and provenance.status = 'prepared'
      and provenance.dispatch_state = 'reserved'
      and provenance.transition_token = p_expected_transition_token
      and provenance.dispatch_lease_expires_at = p_expected_dispatch_lease_expires_at
      and provenance.updated_at = p_expected_updated_at
      and provenance.pre_dispatch_claim_fingerprint = p_expected_claim_fingerprint
      and provenance.pre_dispatch_finalized_at = p_expected_finalized_at
      and provenance.pre_dispatch_finalized_at is not null
      and provenance.dispatch_lease_expires_at > db_now.ts
      and p_next_transition_token is not null
      and p_next_transition_token <> p_expected_transition_token
      and p_lease_ms between 30000 and 900000
    returning provenance.*
  )
  select * from transitioned;
$function$;

create or replace function public.softora_expire_mailbox_reserved_dispatch(
  p_intent_id text,
  p_expected_transition_token uuid,
  p_expected_dispatch_lease_expires_at timestamptz,
  p_expected_updated_at timestamptz,
  p_expected_claim_fingerprint text,
  p_expected_finalized_at timestamptz,
  p_next_transition_token uuid
)
returns setof public.softora_mailbox_send_provenance
language sql
volatile
security invoker
set search_path = ''
as $function$
  with db_now as (
    select pg_catalog.clock_timestamp() as ts
  ), transitioned as (
    update public.softora_mailbox_send_provenance as provenance
    set status = 'failed',
        dispatch_state = 'finished',
        dispatch_lease_expires_at = null,
        reconcile_required = false,
        sent_reconcile_required = false,
        error_text = 'De pre-dispatchreservering verliep voordat de provider werd gestart.',
        transition_token = p_next_transition_token,
        updated_at = db_now.ts
    from db_now
    where provenance.intent_id = p_intent_id
      and provenance.status = 'prepared'
      and provenance.dispatch_state = 'reserved'
      and provenance.transition_token = p_expected_transition_token
      and provenance.dispatch_lease_expires_at = p_expected_dispatch_lease_expires_at
      and provenance.updated_at = p_expected_updated_at
      and provenance.pre_dispatch_claim_fingerprint is not distinct from p_expected_claim_fingerprint
      and provenance.pre_dispatch_finalized_at is not distinct from p_expected_finalized_at
      and provenance.dispatch_lease_expires_at <= db_now.ts
      and p_next_transition_token is not null
      and p_next_transition_token is distinct from p_expected_transition_token
    returning provenance.*
  )
  select * from transitioned;
$function$;

create or replace function public.softora_expire_mailbox_started_dispatch(
  p_intent_id text,
  p_expected_transition_token uuid,
  p_expected_dispatch_lease_expires_at timestamptz,
  p_expected_updated_at timestamptz,
  p_expected_claim_fingerprint text,
  p_expected_finalized_at timestamptz,
  p_expected_dispatch_started_at timestamptz,
  p_next_transition_token uuid
)
returns setof public.softora_mailbox_send_provenance
language sql
volatile
security invoker
set search_path = ''
as $function$
  with db_now as (
    select pg_catalog.clock_timestamp() as ts
  ), transitioned as (
    update public.softora_mailbox_send_provenance as provenance
    set status = 'unknown',
        dispatch_state = 'started',
        dispatch_lease_expires_at = null,
        reconcile_required = true,
        sent_reconcile_required = true,
        error_text = 'De dispatchlease is verlopen; de provideruitkomst moet eerst worden gereconcilieerd.',
        transition_token = p_next_transition_token,
        updated_at = db_now.ts
    from db_now
    where provenance.intent_id = p_intent_id
      and provenance.status = 'prepared'
      and provenance.dispatch_state = 'started'
      and provenance.transition_token = p_expected_transition_token
      and provenance.dispatch_lease_expires_at = p_expected_dispatch_lease_expires_at
      and provenance.updated_at = p_expected_updated_at
      and provenance.pre_dispatch_claim_fingerprint is not distinct from p_expected_claim_fingerprint
      and provenance.pre_dispatch_finalized_at is not distinct from p_expected_finalized_at
      and provenance.dispatch_started_at is not distinct from p_expected_dispatch_started_at
      and provenance.dispatch_started_at is not null
      and provenance.dispatch_lease_expires_at <= db_now.ts
      and p_next_transition_token is not null
      and p_next_transition_token is distinct from p_expected_transition_token
    returning provenance.*
  )
  select * from transitioned;
$function$;

revoke all on function public.softora_finalize_mailbox_pre_dispatch_claim(
  text, uuid, timestamptz, timestamptz, text, uuid, integer,
  text, text, text, text, text, jsonb, text, text, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.softora_claim_mailbox_pre_dispatch(jsonb, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.softora_claim_mailbox_pre_dispatch(jsonb, uuid, integer)
  to service_role;
grant execute on function public.softora_finalize_mailbox_pre_dispatch_claim(
  text, uuid, timestamptz, timestamptz, text, uuid, integer,
  text, text, text, text, text, jsonb, text, text, text, text, text, text
) to service_role;

revoke all on function public.softora_start_mailbox_pre_dispatch(
  text, uuid, timestamptz, timestamptz, text, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.softora_start_mailbox_pre_dispatch(
  text, uuid, timestamptz, timestamptz, text, timestamptz, uuid, integer
) to service_role;

revoke all on function public.softora_expire_mailbox_reserved_dispatch(
  text, uuid, timestamptz, timestamptz, text, timestamptz, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.softora_expire_mailbox_reserved_dispatch(
  text, uuid, timestamptz, timestamptz, text, timestamptz, uuid
) to service_role;

revoke all on function public.softora_expire_mailbox_started_dispatch(
  text, uuid, timestamptz, timestamptz, text, timestamptz, timestamptz, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.softora_expire_mailbox_started_dispatch(
  text, uuid, timestamptz, timestamptz, text, timestamptz, timestamptz, uuid
) to service_role;

notify pgrst, 'reload schema';

-- mailbox-pre-dispatch-claim-fencing:end
