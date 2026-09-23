-- Designs are divided between the two people independently of whether the
-- eventual delivery uses Instantly or Softora's own nine-mailbox scheduler.
alter table public.softora_instantly_sender_rotation rename to softora_webdesign_owner_rotation;
alter table public.softora_webdesign_owner_rotation rename column next_sender_email to next_owner_email;
alter table public.softora_instantly_sender_assignments rename to softora_webdesign_owner_assignments;
alter table public.softora_webdesign_owner_assignments rename column sender_email to owner_email;

drop function public.softora_assign_instantly_sender(text);

create function public.softora_assign_webdesign_owner(p_customer_id text)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_customer_id text := btrim(coalesce(p_customer_id, ''));
  v_owner text;
  v_next text;
begin
  if char_length(v_customer_id) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'WEBDESIGN_OWNER_CUSTOMER_ID_INVALID';
  end if;

  select assignment.owner_email into v_owner
  from public.softora_webdesign_owner_assignments as assignment
  where assignment.customer_id = v_customer_id;
  if found then return v_owner; end if;

  select rotation.next_owner_email into v_next
  from public.softora_webdesign_owner_rotation as rotation
  where rotation.rotation_key = 'design'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'WEBDESIGN_OWNER_ROTATION_MISSING';
  end if;

  -- Waiting concurrent requests must reuse the winner's customer assignment.
  select assignment.owner_email into v_owner
  from public.softora_webdesign_owner_assignments as assignment
  where assignment.customer_id = v_customer_id;
  if found then return v_owner; end if;

  -- Keep historical Instantly designs with their original sender.
  select photo.legacy_meta->>'senderEmail' into v_owner
  from public.softora_design_photos as photo
  where photo.customer_id = v_customer_id and photo.deleted_at is null;
  if coalesce(v_owner, '') not in ('serve@softora.nl', 'martijn@softora.nl') then
    v_owner := v_next;
    update public.softora_webdesign_owner_rotation
    set next_owner_email = case v_next
      when 'serve@softora.nl' then 'martijn@softora.nl'
      else 'serve@softora.nl'
    end
    where rotation_key = 'design';
  end if;

  insert into public.softora_webdesign_owner_assignments (customer_id, owner_email)
  values (v_customer_id, v_owner);
  return v_owner;
end;
$$;

revoke all on function public.softora_assign_webdesign_owner(text)
  from public, anon, authenticated, service_role;
grant execute on function public.softora_assign_webdesign_owner(text) to service_role;
