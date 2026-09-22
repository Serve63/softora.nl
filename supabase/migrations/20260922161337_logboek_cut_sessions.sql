-- Separate cut schedule and daily snapshots; never write the original logbook.
create table public.softora_logboek_cut_plan (
 id text primary key check (id = 'serve_cut'),
 payload jsonb not null,
 updated_at timestamptz not null default now()
);
create table public.softora_logboek_cut_sessions (
 training_date date primary key,
 exercises jsonb not null check (jsonb_typeof(exercises) = 'array'),
 checks jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now()
);
create table public.softora_logboek_cut_events (
 operation_id uuid primary key,
 training_date date not null references public.softora_logboek_cut_sessions(training_date),
 set_key text not null,
 done boolean not null,
 expected_version integer not null,
 created_at timestamptz not null default now()
);
alter table public.softora_logboek_cut_plan enable row level security;
alter table public.softora_logboek_cut_sessions enable row level security;
alter table public.softora_logboek_cut_events enable row level security;
revoke all on public.softora_logboek_cut_plan, public.softora_logboek_cut_sessions, public.softora_logboek_cut_events from anon, authenticated;
grant select, insert, update on public.softora_logboek_cut_plan, public.softora_logboek_cut_sessions, public.softora_logboek_cut_events to service_role;
insert into public.softora_logboek_cut_plan(id,payload)
 select 'serve_cut', payload from public.softora_sportschool_logbook where id = 'serve_logbook'
 on conflict do nothing;

create function public.softora_logboek_cut_set(
 p_date date, p_order integer, p_set integer, p_done boolean, p_version integer, p_operation uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
 s public.softora_logboek_cut_sessions%rowtype;
 e public.softora_logboek_cut_events%rowtype;
 k text := p_order::text || ':' || p_set::text;
 v integer;
begin
 select * into s from public.softora_logboek_cut_sessions where training_date=p_date for update;
 if not found then raise exception 'Session missing'; end if;
 if not exists (select 1 from jsonb_array_elements(s.exercises) x
   where (x->>'order')::integer=p_order and p_set>=0 and p_set<(x->>'sets')::integer)
 then raise exception 'Invalid set'; end if;
 select * into e from public.softora_logboek_cut_events where operation_id=p_operation;
 if found then
   if e.training_date<>p_date or e.set_key<>k or e.done<>p_done or e.expected_version<>p_version
   then raise exception 'Operation mismatch'; end if;
   return jsonb_build_object('conflict',false,'session',to_jsonb(s));
 end if;
 v := coalesce((s.checks->k->>'version')::integer,0);
 if v<>p_version then return jsonb_build_object('conflict',true,'session',to_jsonb(s)); end if;
 update public.softora_logboek_cut_sessions
 set checks=jsonb_set(checks,array[k],jsonb_build_object('done',p_done,'version',v+1)), updated_at=clock_timestamp()
 where training_date=p_date returning * into s;
 insert into public.softora_logboek_cut_events(operation_id,training_date,set_key,done,expected_version)
 values(p_operation,p_date,k,p_done,p_version);
 return jsonb_build_object('conflict',false,'session',to_jsonb(s));
end;
$$;
revoke all on function public.softora_logboek_cut_set(date,integer,integer,boolean,integer,uuid) from public, anon, authenticated;
grant execute on function public.softora_logboek_cut_set(date,integer,integer,boolean,integer,uuid) to service_role;
