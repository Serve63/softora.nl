-- Subscription jobs keep the verified house-colour lock between Mac claim and delivery.
create or replace function public.softora_webdesign_subscription_guard(p_job_id text, p_claim text, p_guard jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if p_claim !~ '^[a-f0-9-]{36}$' or pg_catalog.jsonb_typeof(p_guard) <> 'object'
    or pg_catalog.jsonb_typeof(p_guard->'palette') <> 'array' or pg_catalog.length(p_guard::text) > 8000 then
    raise exception 'invalid guard';
  end if;
  update public.softora_webdesign_jobs set updated_at = now(),
    payload = payload || pg_catalog.jsonb_build_object('subscriptionBrandGuard', p_guard)
  where job_id = p_job_id and status = 'running'
    and payload->>'executionProvider' = 'codex-subscription' and payload->>'subscriptionClaim' = p_claim;
  return pg_catalog.jsonb_build_object('ok', found);
end $$;
revoke all on function public.softora_webdesign_subscription_guard(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.softora_webdesign_subscription_guard(text,text,jsonb) to service_role;
