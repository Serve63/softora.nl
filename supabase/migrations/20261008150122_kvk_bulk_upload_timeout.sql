-- Bulk transfers insert customers and mark up to 50,000 source rows atomically.
-- PostgREST otherwise inherits the authenticator's 8s statement timeout, which
-- cancelled the 12,844-row transfer during the final source update.
-- Scope the bounded budget to this RPC; keep role defaults and lock timeout.
alter function public.softora_kvk_upload_available_counted(uuid,text,boolean,jsonb,integer)
  set statement_timeout = '60s';

notify pgrst, 'reload schema';
