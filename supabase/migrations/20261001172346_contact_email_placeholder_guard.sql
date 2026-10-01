-- Guard canonical storage as well as older/direct importers. This predicate
-- reads only its input and grants no additional table or privileged access.
set lock_timeout = '5s';
set statement_timeout = '120s';
create or replace function public.softora_contact_email_is_protected(value text)
returns boolean
language sql immutable parallel safe
set search_path = pg_catalog
as $$
  select case
    when coalesce(value, '') = '' then false
    when value ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' then false
    else regexp_replace(
      regexp_replace(lower(value), '&[^;[:space:]]{1,32};', '', 'g'),
      '[^a-z]', '', 'g'
    ) ~ '(emailprotected|emailprotection|cfemail)'
  end;
$$;

alter table public.softora_customers
  add constraint softora_customers_no_protected_email
  check (
    not public.softora_contact_email_is_protected(email)
    and not public.softora_contact_email_is_protected(payload->>'email')
    and not public.softora_contact_email_is_protected(payload->>'contactEmail')
  ) not valid;
alter table public.softora_kvk_company_directory
  add constraint softora_kvk_directory_no_protected_email
  check (not public.softora_contact_email_is_protected(email)) not valid;

-- Retain the company and contact history; an unresolved address cannot be used
-- for mail and the explicit marker prevents legacy UI address guessing.
with repair as (
  select customer_id, case
    when not public.softora_contact_email_is_protected(email)
      and coalesce(email, '') not in ('', '—') then email
    when not public.softora_contact_email_is_protected(payload->>'email')
      and coalesce(payload->>'email', '') not in ('', '—') then payload->>'email'
    when not public.softora_contact_email_is_protected(payload->>'contactEmail')
      and coalesce(payload->>'contactEmail', '') not in ('', '—') then payload->>'contactEmail'
    else '—'
  end as clean_email
  from public.softora_customers
  where public.softora_contact_email_is_protected(email)
     or public.softora_contact_email_is_protected(payload->>'email')
     or public.softora_contact_email_is_protected(payload->>'contactEmail')
)
update public.softora_customers c
set email = repair.clean_email,
    payload = c.payload || jsonb_build_object('email', repair.clean_email)
      || case when public.softora_contact_email_is_protected(c.payload->>'contactEmail')
        then jsonb_build_object('contactEmail', '') else '{}'::jsonb end
      || case when repair.clean_email = '—' then jsonb_build_object(
        'mail', false, 'canMail', false, 'emailVerificationStatus', 'protected'
      ) else '{}'::jsonb end,
    version = (extract(epoch from clock_timestamp()) * 1000)::bigint,
    updated_at = now()
from repair
where c.customer_id = repair.customer_id;
update public.softora_kvk_company_directory
set email = ''
where public.softora_contact_email_is_protected(email);

alter table public.softora_customers
  validate constraint softora_customers_no_protected_email;
alter table public.softora_kvk_company_directory
  validate constraint softora_kvk_directory_no_protected_email;

-- Rollback: drop these two constraints, then this input-only function.
-- Restore contact values only from a protected backup or verified sources.
