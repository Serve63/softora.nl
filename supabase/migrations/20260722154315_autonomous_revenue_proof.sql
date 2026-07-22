create table if not exists public.softora_revenue_proof_events (
  event_key text primary key,
  event_kind text not null
    check (event_kind in (
      'lead_qualified',
      'proposal_sent',
      'contract_accepted',
      'cash_in',
      'lead_cost',
      'delivery_cost',
      'refund',
      'delivery_accepted'
    )),
  order_id text not null,
  amount_eur numeric(12, 2),
  source text not null,
  external_event_id text not null,
  automation_run_id text,
  evidence_hash text not null,
  autonomous boolean not null default false,
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint softora_revenue_proof_events_source_event_unique
    unique (source, event_kind, external_event_id),
  constraint softora_revenue_proof_events_amount_shape
    check (
      (
        event_kind in ('cash_in', 'refund')
        and amount_eur is not null
        and amount_eur > 0
      )
      or
      (
        event_kind in ('lead_cost', 'delivery_cost')
        and amount_eur is not null
        and amount_eur >= 0
      )
      or
      (
        event_kind in (
          'lead_qualified',
          'proposal_sent',
          'contract_accepted',
          'delivery_accepted'
        )
        and amount_eur is null
      )
    ),
  constraint softora_revenue_proof_events_evidence_hash_shape
    check (evidence_hash ~ '^[a-f0-9]{64}$'),
  constraint softora_revenue_proof_events_autonomous_shape
    check (
      autonomous = true
      and automation_run_id is not null
      and length(automation_run_id) > 0
    ),
  constraint softora_revenue_proof_events_cash_source_shape
    check (event_kind <> 'cash_in' or source = 'bunq')
);

create index if not exists softora_revenue_proof_events_occurred_idx
  on public.softora_revenue_proof_events (occurred_at desc);

create index if not exists softora_revenue_proof_events_order_idx
  on public.softora_revenue_proof_events (order_id, occurred_at asc);

create index if not exists softora_revenue_proof_events_kind_idx
  on public.softora_revenue_proof_events (event_kind, occurred_at desc);

alter table public.softora_revenue_proof_events enable row level security;

revoke all on table public.softora_revenue_proof_events from anon, authenticated;

create or replace function public.prevent_softora_revenue_proof_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'softora_revenue_proof_events is append-only';
end;
$$;

revoke all on function public.prevent_softora_revenue_proof_event_mutation() from public;

drop trigger if exists softora_revenue_proof_events_append_only
  on public.softora_revenue_proof_events;

create trigger softora_revenue_proof_events_append_only
before update or delete on public.softora_revenue_proof_events
for each row execute function public.prevent_softora_revenue_proof_event_mutation();

comment on table public.softora_revenue_proof_events is
  'Append-only evidence ledger for the autonomous revenue proof. Server-side service-role access only.';
