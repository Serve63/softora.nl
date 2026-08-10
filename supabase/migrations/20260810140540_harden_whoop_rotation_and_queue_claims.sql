alter table public.softora_health_whoop_connections
  add column if not exists sync_lock_id text,
  add column if not exists sync_lock_until timestamptz;

alter table public.softora_health_whoop_connections
  drop constraint if exists softora_health_whoop_connections_status_check;
alter table public.softora_health_whoop_connections
  add constraint softora_health_whoop_connections_status_check
  check (status in (
    'disconnected',
    'connected',
    'error',
    'reauthorization_required',
    'refresh_uncertain'
  ));

alter table public.softora_health_sync_runs
  drop constraint if exists softora_health_sync_runs_mode_check;
alter table public.softora_health_sync_runs
  add constraint softora_health_sync_runs_mode_check
  check (mode in ('daily', 'backfill', 'manual', 'webhook', 'reconcile'));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'softora_health_whoop_webhook_events_status_check'
      and conrelid = 'public.softora_health_whoop_webhook_events'::regclass
  ) then
    alter table public.softora_health_whoop_webhook_events
      add constraint softora_health_whoop_webhook_events_status_check
      check (status in ('pending', 'processing', 'retry', 'processed', 'dead'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'softora_health_whoop_webhook_events_attempts_check'
      and conrelid = 'public.softora_health_whoop_webhook_events'::regclass
  ) then
    alter table public.softora_health_whoop_webhook_events
      add constraint softora_health_whoop_webhook_events_attempts_check
      check (attempts >= 0);
  end if;
end $$;
