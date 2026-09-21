-- Derived presentation only. The canonical mailbox message is never modified.
create table public.softora_mailbox_ai_budget (
  id text primary key check (id = 'mailbox-luna-v1'),
  approved_micro_usd bigint not null default 0 check (approved_micro_usd >= 0),
  reserved_micro_usd bigint not null default 0 check (reserved_micro_usd >= 0)
);
insert into public.softora_mailbox_ai_budget(id) values ('mailbox-luna-v1');
create table public.softora_mailbox_ai_presentations (
  id text primary key,
  version text not null,
  account_email text not null,
  message_key text not null,
  source jsonb not null,
  status text not null default 'queued' check (status in ('queued','running','ready','failed')),
  decision jsonb,
  usage jsonb,
  claim_token uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index mailbox_ai_queue on public.softora_mailbox_ai_presentations(created_at) where status = 'queued';
create index mailbox_ai_source on public.softora_mailbox_ai_presentations(account_email, message_key, version);
alter table public.softora_mailbox_ai_budget enable row level security;
alter table public.softora_mailbox_ai_presentations enable row level security;
revoke all on public.softora_mailbox_ai_budget, public.softora_mailbox_ai_presentations from public, anon, authenticated;
grant select, insert, update on public.softora_mailbox_ai_budget, public.softora_mailbox_ai_presentations to service_role;

create function public.softora_claim_mailbox_ai(p_token uuid)
returns setof public.softora_mailbox_ai_presentations
language plpgsql security invoker set search_path = '' as $$
declare budget public.softora_mailbox_ai_budget; job public.softora_mailbox_ai_presentations;
begin
  if p_token is null then return; end if;
  select * into budget from public.softora_mailbox_ai_budget where id = 'mailbox-luna-v1' for update;
  if not found or budget.approved_micro_usd - budget.reserved_micro_usd < 100000 then return; end if;
  select * into job from public.softora_mailbox_ai_presentations
    where status = 'queued' and version = 'mailbox-luna-v1' order by created_at, id limit 1 for update skip locked;
  if not found then return; end if;
  -- Reserve both selection and removal review BEFORE any request; failures are not refunded or retried.
  update public.softora_mailbox_ai_budget set reserved_micro_usd = reserved_micro_usd + 100000 where id = budget.id;
  return query update public.softora_mailbox_ai_presentations
    set status = 'running', claim_token = p_token, started_at = now() where id = job.id returning *;
end;
$$;

create function public.softora_mailbox_ai_candidates(p_limit integer default 20)
returns setof public.softora_mailbox_messages
language sql stable security invoker set search_path = '' as $$
  select m.* from public.softora_mailbox_messages m
  where m.folder in ('inbox','instantly','allmail') and m.has_body and not m.body_truncated
    and m.deleted_at is null and m.generation_superseded_at is null
    and length(trim(m.body_text)) between 1 and 60000
    and cardinality(string_to_array(m.body_text, E'\n')) <= 600 and lower(m.sender_email) <> lower(m.account_email)
    and coalesce(m.payload->>'direction','received') <> 'sent'
    and not exists (select 1 from public.softora_mailbox_ai_presentations p
      where p.account_email = m.account_email and (p.message_key = m.message_key or p.source->>'identity' = nullif(m.message_id,'')) and p.version = 'mailbox-luna-v1'
        and p.source->>'body' = m.body_text and p.source->>'from' = coalesce(nullif(m.sender_name,''),nullif(m.sender_email,''),'Onbekend')
        and p.source->>'email' = coalesce(m.sender_email,'')
        and p.source->>'html' = left(coalesce(m.payload->>'sourceHtml',''),60000))
  order by m.date desc, m.message_key limit greatest(1,least(coalesce(p_limit,20),50));
$$;
revoke all on function public.softora_claim_mailbox_ai(uuid), public.softora_mailbox_ai_candidates(integer) from public, anon, authenticated;
grant execute on function public.softora_claim_mailbox_ai(uuid), public.softora_mailbox_ai_candidates(integer) to service_role;
