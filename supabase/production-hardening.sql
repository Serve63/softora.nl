-- Softora production hardening for runtime/data-ops tables.
-- Safe to re-run. Keeps all table access server-side through the service role.

alter table public.softora_runtime_state enable row level security;
alter table public.softora_customers enable row level security;
alter table public.softora_active_orders enable row level security;
alter table public.softora_order_runtime enable row level security;
alter table public.softora_design_photos enable row level security;
alter table public.softora_webdesign_jobs enable row level security;

revoke all on table
  public.softora_runtime_state,
  public.softora_customers,
  public.softora_active_orders,
  public.softora_order_runtime,
  public.softora_design_photos,
  public.softora_webdesign_jobs
from anon, authenticated;

grant select, insert, update, delete on table
  public.softora_runtime_state,
  public.softora_customers,
  public.softora_active_orders,
  public.softora_order_runtime,
  public.softora_design_photos,
  public.softora_webdesign_jobs
to service_role;

do $$
declare
  target_table text;
  policy_name text;
begin
  foreach target_table in array array[
    'softora_runtime_state',
    'softora_customers',
    'softora_active_orders',
    'softora_order_runtime',
    'softora_design_photos',
    'softora_webdesign_jobs'
  ]
  loop
    policy_name := target_table || '_service_role_all';
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = target_table
        and policyname = policy_name
    ) then
      execute format(
        'create policy %I on public.%I for all to service_role using (true) with check (true)',
        policy_name,
        target_table
      );
    end if;
  end loop;
end $$;
