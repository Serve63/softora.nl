-- Only hashed credentials and bounded integration metadata; no session cookies.
create table public.softora_agenda_mcp_records (
  id text primary key,
  kind text not null check (kind in ('consent', 'code', 'access', 'refresh', 'grant', 'mutation')),
  value jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.softora_agenda_mcp_records enable row level security;
revoke all on public.softora_agenda_mcp_records from public, anon, authenticated;
grant select, insert, update, delete on public.softora_agenda_mcp_records to service_role;
create index agenda_mcp_expiry on public.softora_agenda_mcp_records (expires_at);
create index agenda_mcp_grant on public.softora_agenda_mcp_records ((value->>'grantId')) where kind in ('access', 'refresh', 'grant');
