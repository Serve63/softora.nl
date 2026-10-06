-- Een onzekere verzending ('unknown') mag naar 'failed' zodra een providercontrole
-- aantoont dat er niets is verzonden; anders blokkeert die poging de thread voor altijd.
create or replace function public.softora_enforce_mailbox_send_status_monotone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not (
    old.status = new.status or
    (old.status = 'prepared' and new.status in ('accepted', 'unknown', 'failed')) or
    (old.status = 'unknown' and new.status = 'accepted') or
    -- Alleen na aantoonbare providercontrole: onzeker blijkt niet verzonden.
    (old.status = 'unknown' and new.status = 'failed'
      and new.dispatch_state = 'finished'
      and new.reconcile_required = false
      and new.sent_reconcile_required = false)
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
