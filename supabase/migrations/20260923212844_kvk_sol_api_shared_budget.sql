-- One shared, transactional EUR budget for the KVK API Searcher and Controller.
create table if not exists public.softora_kvk_api_budget (
  id boolean primary key default true check (id),
  limit_eur_cents integer not null check (limit_eur_cents = 10000),
  spent_eur_cents integer not null default 0 check (spent_eur_cents >= 0),
  reserved_eur_cents integer not null default 0 check (reserved_eur_cents >= 0),
  searcher_enabled boolean not null default false,
  controller_enabled boolean not null default false,
  searcher_requested_at timestamptz,
  controller_requested_at timestamptz,
  searcher_heartbeat_at timestamptz,
  controller_heartbeat_at timestamptz,
  searcher_message text not null default '',
  controller_message text not null default '',
  searcher_batch text not null default '',
  controller_batch text not null default '',
  updated_at timestamptz not null default now(),
  constraint softora_kvk_api_budget_within_limit
    check (spent_eur_cents + reserved_eur_cents <= limit_eur_cents)
);

create table if not exists public.softora_kvk_api_budget_requests (
  request_id uuid primary key,
  worker_role text not null check (worker_role in ('searcher', 'controller')),
  reserved_eur_cents integer not null check (reserved_eur_cents > 0),
  actual_eur_cents integer check (actual_eur_cents >= 0),
  state text not null default 'reserved' check (state in ('reserved', 'settled')),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint softora_kvk_api_budget_request_actual_within_reservation
    check (actual_eur_cents is null or actual_eur_cents <= reserved_eur_cents)
);

alter table public.softora_kvk_api_budget enable row level security;
alter table public.softora_kvk_api_budget_requests enable row level security;
revoke all on public.softora_kvk_api_budget from public, anon, authenticated;
revoke all on public.softora_kvk_api_budget_requests from public, anon, authenticated;
grant select, insert, update on public.softora_kvk_api_budget to service_role;
grant select, insert, update on public.softora_kvk_api_budget_requests to service_role;

insert into public.softora_kvk_api_budget (id, limit_eur_cents)
values (true, 10000)
on conflict (id) do nothing;

create or replace function public.softora_kvk_api_reserve(
  p_request_id uuid,
  p_worker_role text,
  p_reserve_eur_cents integer
) returns boolean
language plpgsql security invoker set search_path = public
as $$
begin
  if p_request_id is null or p_worker_role not in ('searcher', 'controller')
     or p_reserve_eur_cents is null or p_reserve_eur_cents < 1
     or p_reserve_eur_cents > 10000 then
    raise exception 'Invalid KVK API reservation';
  end if;
  update public.softora_kvk_api_budget
     set reserved_eur_cents = reserved_eur_cents + p_reserve_eur_cents,
         updated_at = now()
   where id = true
     and spent_eur_cents + reserved_eur_cents + p_reserve_eur_cents <= limit_eur_cents
     and (
       (p_worker_role = 'searcher' and searcher_enabled
        and searcher_heartbeat_at >= now() - interval '2 minutes'
        and searcher_heartbeat_at >= searcher_requested_at)
       or
       (p_worker_role = 'controller' and controller_enabled
        and controller_heartbeat_at >= now() - interval '2 minutes'
        and controller_heartbeat_at >= controller_requested_at)
     );
  if not found then return false; end if;
  -- A duplicate request ID raises and rolls back the budget update atomically.
  insert into public.softora_kvk_api_budget_requests
    (request_id, worker_role, reserved_eur_cents)
  values (p_request_id, p_worker_role, p_reserve_eur_cents);
  return true;
end;
$$;

create or replace function public.softora_kvk_api_settle(
  p_request_id uuid,
  p_actual_eur_cents integer
) returns boolean
language plpgsql security invoker set search_path = public
as $$
declare
  v_request public.softora_kvk_api_budget_requests%rowtype;
begin
  select * into v_request
    from public.softora_kvk_api_budget_requests
   where request_id = p_request_id for update;
  if not found or v_request.state <> 'reserved'
     or p_actual_eur_cents is null or p_actual_eur_cents < 0
     or p_actual_eur_cents > v_request.reserved_eur_cents then
    return false;
  end if;
  update public.softora_kvk_api_budget
     set reserved_eur_cents = reserved_eur_cents - v_request.reserved_eur_cents,
         spent_eur_cents = spent_eur_cents + p_actual_eur_cents,
         updated_at = now()
   where id = true and reserved_eur_cents >= v_request.reserved_eur_cents;
  if not found then raise exception 'KVK API budget inconsistent'; end if;
  update public.softora_kvk_api_budget_requests
     set state = 'settled', actual_eur_cents = p_actual_eur_cents,
         settled_at = now()
   where request_id = p_request_id;
  return true;
end;
$$;

revoke execute on function public.softora_kvk_api_reserve(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.softora_kvk_api_settle(uuid, integer) from public, anon, authenticated;
grant execute on function public.softora_kvk_api_reserve(uuid, text, integer) to service_role;
grant execute on function public.softora_kvk_api_settle(uuid, integer) to service_role;
