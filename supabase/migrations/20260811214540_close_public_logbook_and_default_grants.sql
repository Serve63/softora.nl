-- Keep Servé's personal sportschool logbook reachable only through the
-- authenticated server route. RLS and grants are intentionally both locked.
alter table public.softora_sportschool_logbook enable row level security;
alter table public.softora_sportschool_logbook_history enable row level security;

drop policy if exists softora_sportschool_logbook_public_insert
  on public.softora_sportschool_logbook;
drop policy if exists softora_sportschool_logbook_public_select
  on public.softora_sportschool_logbook;
drop policy if exists softora_sportschool_logbook_public_update
  on public.softora_sportschool_logbook;

revoke all privileges on table public.softora_sportschool_logbook
  from public, anon, authenticated;
revoke all privileges on table public.softora_sportschool_logbook_history
  from public, anon, authenticated;
revoke all privileges on sequence public.softora_sportschool_logbook_history_history_id_seq
  from public, anon, authenticated;

grant select, insert, update, delete on table public.softora_sportschool_logbook
  to service_role;
grant select, insert, update, delete on table public.softora_sportschool_logbook_history
  to service_role;
grant usage, select on sequence public.softora_sportschool_logbook_history_history_id_seq
  to service_role;

drop policy if exists softora_sportschool_logbook_service_role_all
  on public.softora_sportschool_logbook;
create policy softora_sportschool_logbook_service_role_all
  on public.softora_sportschool_logbook
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists softora_sportschool_logbook_history_service_role_all
  on public.softora_sportschool_logbook_history;
create policy softora_sportschool_logbook_history_service_role_all
  on public.softora_sportschool_logbook_history
  for all
  to service_role
  using (true)
  with check (true);

-- These server-owned tables had automatic API-role grants despite having no
-- client-facing contract. Preserve service access and remove the public edge.
alter table public.softora_mailbox_sync_state enable row level security;
alter table public.softora_omzetwerk_feasibility_requests enable row level security;

revoke all privileges on table public.softora_mailbox_sync_state
  from public, anon, authenticated;
revoke all privileges on table public.softora_omzetwerk_feasibility_requests
  from public, anon, authenticated;

grant select, insert, update, delete on table public.softora_mailbox_sync_state
  to service_role;
grant select, insert, update, delete on table public.softora_omzetwerk_feasibility_requests
  to service_role;

-- Trigger helpers are not API endpoints. The service role retains explicit
-- execute access so mailbox writes continue to fire the trigger normally.
revoke execute on function public.softora_preserve_mailbox_read_state()
  from public, anon, authenticated;
grant execute on function public.softora_preserve_mailbox_read_state()
  to service_role;

-- Future public-schema objects must opt browser roles in explicitly. Keep the
-- service-role defaults intact to avoid breaking existing server migrations.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
