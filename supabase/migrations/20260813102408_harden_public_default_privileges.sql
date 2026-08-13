-- Future objects in the exposed public schema must be private by default.
-- Application access is granted explicitly per object and remains subject to RLS.
alter default privileges for role supabase_admin in schema public
  revoke all on tables from anon, authenticated, service_role;

alter default privileges for role supabase_admin in schema public
  revoke all on sequences from anon, authenticated, service_role;

alter default privileges for role supabase_admin in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;
