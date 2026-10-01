-- Separate preparation/budget records; these never replace outbound recipient guards.
create table public.softora_mail_stock_control (
  id text primary key check (id = 'nightly'),
  enabled boolean not null default false,
  softora_target integer not null default 200 check (softora_target between 0 and 200),
  instantly_target integer not null default 200 check (instantly_target between 0 and 200),
  approved_cents bigint not null default 100000 check (approved_cents between 0 and 100000),
  charged_cents bigint not null default 0 check (charged_cents >= 0),
  held_cents bigint not null default 0 check (held_cents >= 0),
  last_check_day date,
  last_result jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
insert into public.softora_mail_stock_control (id) values ('nightly');

create table public.softora_mail_stock_generations (
  customer_id text primary key,
  provider text not null check (provider in ('softora', 'instantly')),
  customer jsonb not null,
  identity_keys text[] not null,
  batch_id text not null,
  job_id text unique,
  status text not null default 'planned' check (status in ('planned', 'reserved', 'settled', 'uncertain', 'failed')),
  reserved_cents bigint not null default 0,
  charged_cents bigint not null default 0,
  generation jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index softora_mail_stock_batch_idx on public.softora_mail_stock_generations (batch_id);
create index softora_mail_stock_identity_idx on public.softora_mail_stock_generations using gin (identity_keys);
alter table public.softora_mail_stock_control enable row level security;
alter table public.softora_mail_stock_generations enable row level security;
revoke all on public.softora_mail_stock_control, public.softora_mail_stock_generations from public, anon, authenticated;
grant select, insert, update on public.softora_mail_stock_control, public.softora_mail_stock_generations to service_role;

create function public.softora_mail_stock_allocate(p_customer jsonb, p_provider text, p_keys text[], p_batch_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c public.softora_mail_stock_control; customer_id text := p_customer->>'id';
begin
  select * into strict c from public.softora_mail_stock_control where id = 'nightly' for update;
  if not c.enabled or c.charged_cents + c.held_cents + 1000 > c.approved_cents then
    return jsonb_build_object('allocated', false, 'reason', 'disabled_or_budget');
  end if;
  if p_provider not in ('softora','instantly') or coalesce(customer_id,'') = '' or coalesce(cardinality(p_keys),0) < 2
    or cardinality(p_keys) > 5 or p_batch_id !~ '^mail_stock_[0-9]{8}$' then raise exception 'Invalid stock allocation'; end if;
  if exists (select 1 from public.softora_mail_stock_generations g where g.identity_keys && p_keys)
    or exists (select 1 from public.softora_outbound_recipient_guards g where g.guard_key = any(p_keys)
      and (g.permanent or g.expires_at is null or g.expires_at > now())) then
    return jsonb_build_object('allocated', false, 'reason', 'identity_conflict');
  end if;
  insert into public.softora_mail_stock_generations(customer_id,provider,customer,identity_keys,batch_id)
    values(customer_id,p_provider,p_customer,p_keys,p_batch_id);
  return jsonb_build_object('allocated', true);
end; $$;

create function public.softora_mail_stock_reserve(p_customer_id text, p_job_id text, p_ready_ids text[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c public.softora_mail_stock_control; g public.softora_mail_stock_generations;
begin
  select * into strict c from public.softora_mail_stock_control where id = 'nightly' for update;
  select * into g from public.softora_mail_stock_generations where customer_id = p_customer_id for update;
  if exists (select 1 from public.softora_mail_stock_generations a where a.status = 'uncertain' or
    (a.status = 'reserved' and (a.updated_at < now() - interval '15 minutes' or not exists
      (select 1 from public.softora_webdesign_jobs j where j.job_id = a.job_id and j.status = 'running')))) then
    update public.softora_mail_stock_control set enabled = false,
      last_result = jsonb_build_object('reason','unsettled_request'), updated_at = now() where id = 'nightly';
    return jsonb_build_object('reserved', false, 'reason', 'unsettled_request');
  end if;
  if not found or not c.enabled or g.status <> 'planned' or
    c.charged_cents + c.held_cents + 1000 > c.approved_cents then
    return jsonb_build_object('reserved', false, 'reason', 'disabled_budget_or_already_attempted');
  end if;
  if p_ready_ids is null or cardinality(p_ready_ids) + (select count(*) from public.softora_mail_stock_generations a
    where a.batch_id = g.batch_id and a.provider = g.provider and a.status in ('reserved','settled')
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

create function public.softora_mail_stock_settle(p_customer_id text, p_job_id text, p_charge_cents bigint, p_generation jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c public.softora_mail_stock_control; g public.softora_mail_stock_generations;
begin
  select * into strict c from public.softora_mail_stock_control where id = 'nightly' for update;
  select * into g from public.softora_mail_stock_generations where customer_id = p_customer_id for update;
  if not found or g.job_id is distinct from p_job_id then raise exception 'Stock settlement job mismatch'; end if;
  if g.status in ('settled','failed') then return jsonb_build_object('settled', true, 'existing', true); end if;
  if g.status not in ('reserved','uncertain') then raise exception 'Stock settlement is not reserved'; end if;
  if p_charge_cents is null or p_charge_cents < 0 or p_charge_cents > g.reserved_cents then
    -- An unknown/over-bound cost is never refunded or automatically retried.
    update public.softora_mail_stock_generations set status = 'uncertain', generation = p_generation,
      updated_at = now() where customer_id = p_customer_id;
    update public.softora_mail_stock_control set enabled = false,
      last_result = jsonb_build_object('reason','cost_uncertain','jobId',p_job_id), updated_at = now() where id = 'nightly';
    return jsonb_build_object('settled', false, 'reason', 'cost_uncertain');
  end if;
  update public.softora_mail_stock_generations set status = case when p_charge_cents = 0 and p_generation is null then 'failed' else 'settled' end, charged_cents = p_charge_cents,
    generation = p_generation, updated_at = now() where customer_id = p_customer_id;
  update public.softora_mail_stock_control set held_cents = held_cents - g.reserved_cents,
    charged_cents = charged_cents + p_charge_cents, updated_at = now() where id = 'nightly';
  return jsonb_build_object('settled', true, 'chargedCents', p_charge_cents);
end; $$;

revoke all on function public.softora_mail_stock_allocate(jsonb,text,text[],text),
  public.softora_mail_stock_reserve(text,text,text[]), public.softora_mail_stock_settle(text,text,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.softora_mail_stock_allocate(jsonb,text,text[],text),
  public.softora_mail_stock_reserve(text,text,text[]), public.softora_mail_stock_settle(text,text,bigint,jsonb) to service_role;
