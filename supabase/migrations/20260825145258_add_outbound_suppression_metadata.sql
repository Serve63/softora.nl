alter table public.softora_outbound_recipient_guards
  add column if not exists suppressed boolean not null default false,
  add column if not exists suppression_reason text,
  add column if not exists suppression_source text,
  add column if not exists suppression_actor text,
  add column if not exists suppressed_at timestamptz;

comment on column public.softora_outbound_recipient_guards.suppressed is
  'Permanent all-channel outbound suppression, independent from historical send status.';
comment on column public.softora_outbound_recipient_guards.suppression_reason is
  'Human-readable reason for the permanent outbound suppression.';
comment on column public.softora_outbound_recipient_guards.suppression_source is
  'System or import source that created the permanent outbound suppression.';
comment on column public.softora_outbound_recipient_guards.suppression_actor is
  'Actor that created the permanent outbound suppression.';
