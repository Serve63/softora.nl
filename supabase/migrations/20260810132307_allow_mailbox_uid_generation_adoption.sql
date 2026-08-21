-- mailbox-uidvalidity-identity-adoption:start
create or replace function public.softora_enforce_mailbox_message_identity_immutable()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_account_email text := lower(btrim(coalesce(old.account_email, '')));
  v_folder text := lower(btrim(coalesce(old.folder, '')));
  v_generation_adoption boolean := false;
begin
  v_generation_adoption :=
    old.uid_validity is null
    and new.uid_validity between 1 and 4294967295
    and lower(btrim(new.account_email)) = v_account_email
    and lower(btrim(new.folder)) = v_folder
    and new.uid is not distinct from old.uid
    and new.provider_id is not distinct from old.provider_id
    and old.message_key = v_account_email || '|' || v_folder || '|' || old.uid::text
    and new.message_key = v_account_email || '|' || v_folder || '|uv:'
      || new.uid_validity::text || '|' || old.uid::text;

  if old.message_key is distinct from new.message_key
    or lower(btrim(old.account_email)) is distinct from lower(btrim(new.account_email))
    or lower(btrim(old.folder)) is distinct from lower(btrim(new.folder))
    or old.uid is distinct from new.uid
    or old.uid_validity is distinct from new.uid_validity
    or old.provider_id is distinct from new.provider_id then
    if not v_generation_adoption then
      raise exception using errcode = '23505',
        message = 'Bestaande mailboxidentiteit mag niet van account of provider wisselen';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.softora_enforce_mailbox_message_identity_immutable()
  from public, anon, authenticated, service_role;
grant execute on function public.softora_enforce_mailbox_message_identity_immutable()
  to service_role;
-- mailbox-uidvalidity-identity-adoption:end
