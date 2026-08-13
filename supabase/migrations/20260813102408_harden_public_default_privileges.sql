-- Future objects created by the hosted migration/SQL-editor role in the
-- exposed public schema must be private by default. Application access is
-- granted explicitly per object and remains subject to RLS.
--
-- Hosted Supabase keeps supabase_admin platform-owned; postgres cannot alter
-- that role's default ACL. Do not make this migration fail by pretending it
-- can. Current objects and effective browser access are verified separately.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;
