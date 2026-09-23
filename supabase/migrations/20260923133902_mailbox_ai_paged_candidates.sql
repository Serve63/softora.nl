-- Evaluate expensive campaign proof only for a bounded page. The cursor walks
-- historical hints while a separate recent lane admits new replies promptly.
create table public.softora_mailbox_ai_candidate_cursor (
  id text primary key check (id = 'mailbox-luna-v1'),
  after_date timestamptz,
  after_message_key text,
  after_account_email text,
  updated_at timestamptz not null default now(),
  check ((after_date is null) = (after_message_key is null)
    and (after_date is null) = (after_account_email is null))
);
insert into public.softora_mailbox_ai_candidate_cursor(id) values ('mailbox-luna-v1');
alter table public.softora_mailbox_ai_candidate_cursor enable row level security;
revoke all on public.softora_mailbox_ai_candidate_cursor from public, anon, authenticated;
grant select, update on public.softora_mailbox_ai_candidate_cursor to service_role;

create index softora_mailbox_ai_recent_created_idx
  on public.softora_mailbox_messages(created_at desc, message_key desc, account_email desc)
  where folder in ('inbox','instantly','allmail','coldmail')
    and has_body and not body_truncated
    and deleted_at is null and generation_superseded_at is null;

create index softora_mailbox_ai_paged_date_idx
  on public.softora_mailbox_messages(date desc, message_key desc, account_email desc)
  where folder in ('inbox','instantly','allmail','coldmail')
    and has_body and not body_truncated
    and deleted_at is null and generation_superseded_at is null;

create or replace function public.softora_mailbox_ai_candidates(p_limit integer default 20)
returns setof public.softora_mailbox_messages
language plpgsql security invoker set search_path = '' as $$
declare budget public.softora_mailbox_ai_budget;
  scan_date timestamptz;
  scan_key text;
  scan_account text;
begin
  select * into budget from public.softora_mailbox_ai_budget where id='mailbox-luna-v1';
  if not found or budget.approved_micro_usd-budget.reserved_micro_usd < 300000 then return; end if;
  select after_date,after_message_key,after_account_email into scan_date,scan_key,scan_account
    from public.softora_mailbox_ai_candidate_cursor where id='mailbox-luna-v1' for update;

  return query
  with batch as materialized (
    -- LIMIT must precede body checks, presentation lookups and campaign proof.
    -- Otherwise the planner scans the whole mailbox to find 20 eligible rows.
    select m.account_email,m.message_key,m.date from public.softora_mailbox_messages m
    where m.folder in ('inbox','instantly','allmail','coldmail') and m.has_body and not m.body_truncated
      and m.deleted_at is null and m.generation_superseded_at is null and m.date is not null
      and (scan_date is null or (m.date,m.message_key,m.account_email) < (scan_date,scan_key,scan_account))
      and (budget.include_history or budget.incoming_after is null or m.created_at>=budget.incoming_after)
    order by m.date desc,m.message_key desc,m.account_email desc limit 4000
  ), advance as (
    update public.softora_mailbox_ai_candidate_cursor c
      set after_date=(select b.date from batch b order by b.date,b.message_key,b.account_email limit 1),
          after_message_key=(select b.message_key from batch b order by b.date,b.message_key,b.account_email limit 1),
          after_account_email=(select b.account_email from batch b order by b.date,b.message_key,b.account_email limit 1),
          updated_at=now()
    where c.id='mailbox-luna-v1' returning c.id
  ), recent as materialized (
    select m.account_email,m.message_key from public.softora_mailbox_messages m
    where m.created_at>=now()-interval '30 minutes'
      and m.folder in ('inbox','instantly','allmail','coldmail') and m.has_body and not m.body_truncated
      and m.deleted_at is null and m.generation_superseded_at is null
      and (budget.include_history or budget.incoming_after is null or m.created_at>=budget.incoming_after)
    order by m.created_at desc,m.message_key desc,m.account_email desc limit 20
  ), chosen as (
    select x.account_email,x.message_key,min(x.priority) priority from (
      select r.account_email,r.message_key,0 priority from recent r
      union all select b.account_email,b.message_key,1 priority from batch b
    ) x group by x.account_email,x.message_key
  )
  select m.* from chosen x
  join public.softora_mailbox_messages m
    on m.account_email=x.account_email and m.message_key=x.message_key
  cross join advance
  where length(trim(m.body_text)) between 1 and 240000
    and cardinality(string_to_array(m.body_text,E'\n'))<=2400
    and lower(m.sender_email)<>lower(m.account_email)
    and coalesce(m.payload->>'direction','received')<>'sent'
    and public.softora_mailbox_ai_has_campaign_hint(m)
    and not exists (select 1 from public.softora_mailbox_ai_presentations p
      where p.account_email=m.account_email and p.message_key=m.message_key and p.version='mailbox-luna-v1'
        and p.source->>'body'=m.body_text
        and p.source->>'from'=coalesce(nullif(m.sender_name,''),nullif(m.sender_email,''),'Onbekend')
        and p.source->>'email'=coalesce(m.sender_email,''))
    and not exists (select 1 from public.softora_mailbox_ai_presentations p
      where p.account_email=m.account_email and p.source->>'identity'=nullif(m.message_id,'')
        and p.version='mailbox-luna-v1' and p.source->>'body'=m.body_text
        and p.source->>'from'=coalesce(nullif(m.sender_name,''),nullif(m.sender_email,''),'Onbekend')
        and p.source->>'email'=coalesce(m.sender_email,''))
    and public.softora_mailbox_message_has_campaign_proof(
    m.message_key,m.account_email,m.folder,m.message_id,m.in_reply_to,
    m.references_text,m.sender_name,m.sender_email,m.recipients_text,
    m.subject,m.payload,m.sender_email,null)
  order by x.priority,m.date desc,m.message_key desc
  limit greatest(1,least(coalesce(p_limit,20),20));
end;
$$;
