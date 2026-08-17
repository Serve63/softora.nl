-- webdesign-bulk-worker-lease:start
create table if not exists public.softora_background_worker_locks (
  lock_key text primary key
    check (lock_key ~ '^[a-z0-9][a-z0-9:_-]{2,119}$'),
  lock_token text not null
    check (char_length(btrim(lock_token)) between 1 and 200),
  lock_expires_at timestamptz not null,
  acquired_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists softora_background_worker_locks_expires_idx
  on public.softora_background_worker_locks (lock_expires_at, lock_key);

alter table public.softora_background_worker_locks enable row level security;
revoke all privileges on table public.softora_background_worker_locks
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.softora_background_worker_locks
  to service_role;

create or replace function public.softora_claim_background_worker_lock(
  p_lock_key text,
  p_lock_token text,
  p_lock_ttl_seconds integer default 900
)
returns table (
  acquired boolean,
  claimed_lock_token text,
  lock_expires_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_lock_key text := lower(btrim(coalesce(p_lock_key, '')));
  v_lock_token text := btrim(coalesce(p_lock_token, ''));
  v_now timestamptz := clock_timestamp();
  v_current public.softora_background_worker_locks%rowtype;
begin
  if v_lock_key !~ '^[a-z0-9][a-z0-9:_-]{2,119}$'
    or char_length(v_lock_token) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'BACKGROUND_WORKER_LOCK_IDENTITY_INVALID';
  end if;

  insert into public.softora_background_worker_locks as stored_lock (
    lock_key, lock_token, lock_expires_at, acquired_at, updated_at
  ) values (
    v_lock_key,
    v_lock_token,
    v_now + make_interval(secs => greatest(30, least(1800, coalesce(p_lock_ttl_seconds, 900)))),
    v_now,
    v_now
  )
  on conflict (lock_key) do update set
    lock_token = excluded.lock_token,
    lock_expires_at = excluded.lock_expires_at,
    acquired_at = excluded.acquired_at,
    updated_at = excluded.updated_at
  where stored_lock.lock_expires_at <= v_now
    or stored_lock.lock_token = v_lock_token
  returning stored_lock.* into v_current;

  if found then
    return query select true, v_current.lock_token, v_current.lock_expires_at;
    return;
  end if;

  select * into v_current
  from public.softora_background_worker_locks as active_lock
  where active_lock.lock_key = v_lock_key;
  return query select false, null::text, v_current.lock_expires_at;
end;
$$;

create or replace function public.softora_release_background_worker_lock(
  p_lock_key text,
  p_lock_token text
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_deleted integer := 0;
begin
  delete from public.softora_background_worker_locks
  where lock_key = lower(btrim(coalesce(p_lock_key, '')))
    and lock_token = btrim(coalesce(p_lock_token, ''));
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

comment on table public.softora_background_worker_locks
  is 'Short token-bound leases that coalesce overlapping Softora serverless background workers.';
comment on function public.softora_claim_background_worker_lock(text, text, integer)
  is 'Atomically claims or renews a named background-worker lease; active foreign tokens are never replaced.';
comment on function public.softora_release_background_worker_lock(text, text)
  is 'Releases a background-worker lease only when the lock token still matches.';

revoke all on function public.softora_claim_background_worker_lock(text, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.softora_release_background_worker_lock(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.softora_claim_background_worker_lock(text, text, integer)
  to service_role;
grant execute on function public.softora_release_background_worker_lock(text, text)
  to service_role;
-- webdesign-bulk-worker-lease:end
