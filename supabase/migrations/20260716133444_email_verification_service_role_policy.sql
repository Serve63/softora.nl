drop policy if exists softora_email_verifications_service_role_all
  on public.softora_email_verifications;
create policy softora_email_verifications_service_role_all
  on public.softora_email_verifications
  for all
  to service_role
  using (true)
  with check (true);
