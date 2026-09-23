-- One database transaction assigns each new Instantly design to Servé or
-- Martijn. Repeated requests for one customer keep the first assignment.
create table if not exists public.softora_instantly_sender_rotation (
  rotation_key text primary key,
  next_sender_email text not null check (next_sender_email in ('serve@softora.nl', 'martijn@softora.nl'))
);

insert into public.softora_instantly_sender_rotation (rotation_key, next_sender_email)
values ('design', 'serve@softora.nl')
on conflict (rotation_key) do nothing;

create table if not exists public.softora_instantly_sender_assignments (
  customer_id text primary key,
  sender_email text not null check (sender_email in ('serve@softora.nl', 'martijn@softora.nl')),
  assigned_at timestamptz not null default now()
);

alter table public.softora_instantly_sender_rotation enable row level security;
alter table public.softora_instantly_sender_assignments enable row level security;
revoke all on table public.softora_instantly_sender_rotation from public, anon, authenticated, service_role;
revoke all on table public.softora_instantly_sender_assignments from public, anon, authenticated, service_role;
grant select, update on table public.softora_instantly_sender_rotation to service_role;
grant select, insert on table public.softora_instantly_sender_assignments to service_role;

create or replace function public.softora_assign_instantly_sender(p_customer_id text)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_customer_id text := btrim(coalesce(p_customer_id, ''));
  v_sender text;
  v_next text;
begin
  if char_length(v_customer_id) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'INSTANTLY_SENDER_CUSTOMER_ID_INVALID';
  end if;

  select assignment.sender_email into v_sender
  from public.softora_instantly_sender_assignments as assignment
  where assignment.customer_id = v_customer_id;
  if found then return v_sender; end if;

  -- Serializes assignments across every server process, including concurrent batches.
  select rotation.next_sender_email into v_next
  from public.softora_instantly_sender_rotation as rotation
  where rotation.rotation_key = 'design'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'INSTANTLY_SENDER_ROTATION_MISSING';
  end if;

  -- A second request for the same customer may have waited for the row lock.
  select assignment.sender_email into v_sender
  from public.softora_instantly_sender_assignments as assignment
  where assignment.customer_id = v_customer_id;
  if found then return v_sender; end if;

  -- Preserve the sender on existing designs; never silently reassign old leads.
  select photo.legacy_meta->>'senderEmail' into v_sender
  from public.softora_design_photos as photo
  where photo.customer_id = v_customer_id and photo.deleted_at is null;
  if coalesce(v_sender, '') not in ('serve@softora.nl', 'martijn@softora.nl') then
    v_sender := v_next;
    update public.softora_instantly_sender_rotation
    set next_sender_email = case v_next
      when 'serve@softora.nl' then 'martijn@softora.nl'
      else 'serve@softora.nl'
    end
    where rotation_key = 'design';
  end if;

  insert into public.softora_instantly_sender_assignments (customer_id, sender_email)
  values (v_customer_id, v_sender);
  return v_sender;
end;
$$;

revoke all on function public.softora_assign_instantly_sender(text)
  from public, anon, authenticated, service_role;
grant execute on function public.softora_assign_instantly_sender(text) to service_role;
