-- Requests time out after 10 minutes. Old uncertain charges retain their budget
-- reservation, but must not permanently consume a concurrency slot.
create or replace function public.softora_kvk_api_reserve(
  p_request_id uuid, p_worker_role text, p_reserve_eur_cents integer
) returns boolean
language plpgsql security invoker set search_path = public
as $$
declare
  v_budget public.softora_kvk_api_budget%rowtype;
  v_count integer;
  v_in_flight integer;
begin
  if p_request_id is null or p_worker_role is null or p_worker_role not in ('searcher', 'controller')
     or p_reserve_eur_cents is null or p_reserve_eur_cents < 1 or p_reserve_eur_cents > 10000 then
    raise exception 'Invalid KVK API reservation';
  end if;
  -- Serialize role limits and the shared budget under the same row lock.
  select * into v_budget from public.softora_kvk_api_budget where id = true for update;
  if not found then return false; end if;
  v_count := case when p_worker_role = 'searcher' then v_budget.searcher_count else v_budget.controller_count end;
  select count(*) into v_in_flight from public.softora_kvk_api_budget_requests
    where worker_role = p_worker_role and state = 'reserved'
      and created_at > now() - interval '15 minutes';
  if v_in_flight >= v_count then return false; end if;
  update public.softora_kvk_api_budget
     set reserved_eur_cents = reserved_eur_cents + p_reserve_eur_cents, updated_at = now()
   where id = true
     and spent_eur_cents + reserved_eur_cents + p_reserve_eur_cents <= limit_eur_cents
     and ((p_worker_role = 'searcher' and searcher_enabled
           and searcher_heartbeat_at >= now() - interval '2 minutes'
           and searcher_heartbeat_at >= searcher_requested_at)
       or (p_worker_role = 'controller' and controller_enabled
           and controller_heartbeat_at >= now() - interval '2 minutes'
           and controller_heartbeat_at >= controller_requested_at));
  if not found then return false; end if;
  insert into public.softora_kvk_api_budget_requests (request_id, worker_role, reserved_eur_cents)
    values (p_request_id, p_worker_role, p_reserve_eur_cents);
  return true;
end;
$$;
revoke execute on function public.softora_kvk_api_reserve(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.softora_kvk_api_reserve(uuid, text, integer) to service_role;
