-- Track upper-bound accounting separately from known usage; preserve the lifetime budget.
alter table public.softora_mail_stock_generations add column accounted_at_maximum boolean not null default false;

create or replace function public.softora_mail_stock_reserve(p_customer_id text, p_job_id text, p_ready_ids text[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c public.softora_mail_stock_control; g public.softora_mail_stock_generations;
begin
  select * into strict c from public.softora_mail_stock_control where id = 'nightly' for update;
  select * into g from public.softora_mail_stock_generations where customer_id = p_customer_id for update;
  if not found or not c.enabled or g.status <> 'planned' or
    c.charged_cents + c.held_cents + 1000 > c.approved_cents then
    return jsonb_build_object('reserved', false, 'reason', 'disabled_budget_or_already_attempted');
  end if;
  if p_ready_ids is null or cardinality(p_ready_ids) + (select count(*) from public.softora_mail_stock_generations a
    where a.provider = g.provider and (a.status = 'reserved' or (a.status = 'settled' and a.generation is not null and exists
        (select 1 from public.softora_webdesign_jobs j where j.job_id = a.job_id and j.status = 'running')))
      and not (a.customer_id = any(p_ready_ids))) >= (case when g.provider = 'softora' then c.softora_target else c.instantly_target end) then
    return jsonb_build_object('reserved', false, 'reason', 'target_full');
  end if;
  if not exists (select 1 from public.softora_webdesign_jobs j where j.job_id = p_job_id
    and j.owner_key = 'nightly-mail-stock::system' and j.customer_id = p_customer_id
    and j.status = 'running' and j.payload->'customer'->>'webdesignMailProvider' = g.provider) then
    return jsonb_build_object('reserved', false, 'reason', 'job_mismatch');
  end if;
  if exists (select 1 from public.softora_outbound_recipient_guards o where o.guard_key = any(g.identity_keys)
    and (o.permanent or o.expires_at is null or o.expires_at > now())) then
    return jsonb_build_object('reserved', false, 'reason', 'outbound_conflict');
  end if;
  update public.softora_mail_stock_generations set status = 'reserved', job_id = p_job_id,
    reserved_cents = 1000, updated_at = now() where customer_id = p_customer_id;
  update public.softora_mail_stock_control set held_cents = held_cents + 1000, updated_at = now() where id = 'nightly';
  return jsonb_build_object('reserved', true, 'reservedCents', 1000);
end; $$;

create or replace function public.softora_mail_stock_settle(p_customer_id text, p_job_id text, p_charge_cents bigint, p_generation jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c public.softora_mail_stock_control; g public.softora_mail_stock_generations; maximum_accounted boolean := p_charge_cents is null;
begin
  select * into strict c from public.softora_mail_stock_control where id = 'nightly' for update;
  select * into g from public.softora_mail_stock_generations where customer_id = p_customer_id for update;
  if not found or g.job_id is distinct from p_job_id then raise exception 'Stock settlement job mismatch'; end if;
  if g.status in ('settled','failed') then return jsonb_build_object('settled', true, 'existing', true); end if;
  if g.status not in ('reserved','uncertain') then raise exception 'Stock settlement is not reserved'; end if;
  -- Unknown outcomes consume the entire approved per-request bound. They are never replayed.
  if maximum_accounted then p_charge_cents := g.reserved_cents; end if;
  if p_charge_cents < 0 or p_charge_cents > g.reserved_cents then
    -- An unknown/over-bound cost is never refunded or automatically retried.
    update public.softora_mail_stock_generations set status = 'uncertain', generation = p_generation,
      updated_at = now() where customer_id = p_customer_id;
    update public.softora_mail_stock_control set enabled = false,
      last_result = jsonb_build_object('reason','cost_uncertain','jobId',p_job_id), updated_at = now() where id = 'nightly';
    return jsonb_build_object('settled', false, 'reason', 'cost_uncertain');
  end if;
  update public.softora_mail_stock_generations set status = case when p_charge_cents = 0 and p_generation is null then 'failed' else 'settled' end, charged_cents = p_charge_cents,
    generation = p_generation, accounted_at_maximum = maximum_accounted, updated_at = now() where customer_id = p_customer_id;
  update public.softora_mail_stock_control set held_cents = held_cents - g.reserved_cents,
    charged_cents = charged_cents + p_charge_cents, updated_at = now() where id = 'nightly';
  return jsonb_build_object('settled', true, 'chargedCents', p_charge_cents);
end; $$;

create function public.softora_mail_stock_reconcile()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c public.softora_mail_stock_control; g public.softora_mail_stock_generations; reconciled integer := 0;
begin
  select * into strict c from public.softora_mail_stock_control where id = 'nightly' for update;
  for g in select * from public.softora_mail_stock_generations where status = 'reserved'
    and updated_at < now() - interval '15 minutes' for update loop
    -- The function runtime is at most 800s. A stale request cannot still own this 900s lease.
    perform public.softora_mail_stock_settle(g.customer_id,g.job_id,null,g.generation);
    reconciled := reconciled + 1;
  end loop;
  update public.softora_mail_stock_generations a set status = 'failed', updated_at = now()
    where a.status = 'planned' and exists (select 1 from public.softora_webdesign_jobs j
      where j.customer_id = a.customer_id and j.owner_key = 'nightly-mail-stock::system'
        and j.payload->>'batchId' = a.batch_id and (j.status = 'error' or j.created_at < now() - interval '6 hours'));
  return jsonb_build_object('ok',true,'reconciled',reconciled);
end; $$;
revoke all on function public.softora_mail_stock_reconcile() from public,anon,authenticated;
grant execute on function public.softora_mail_stock_reconcile() to service_role;
