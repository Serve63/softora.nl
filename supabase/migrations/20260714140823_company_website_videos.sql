create table if not exists public.softora_company_website_videos (
  company_id text primary key,
  original_website_url text not null,
  normalized_website_url text not null,
  video_path text,
  storage_bucket text not null default 'softora-company-website-videos',
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'failed')),
  error_text text,
  lock_token text,
  lock_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists softora_company_website_videos_status_idx
  on public.softora_company_website_videos (status, updated_at);

alter table public.softora_company_website_videos enable row level security;

revoke all on table public.softora_company_website_videos from public, anon, authenticated;
grant select, insert, update, delete on public.softora_company_website_videos to service_role;

create or replace function public.softora_queue_company_website_video(
  p_company_id text,
  p_original_website_url text,
  p_normalized_website_url text,
  p_force_retry boolean default false
)
returns setof public.softora_company_website_videos
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.softora_company_website_videos (
    company_id,
    original_website_url,
    normalized_website_url,
    status,
    updated_at
  ) values (
    p_company_id,
    p_original_website_url,
    p_normalized_website_url,
    'pending',
    now()
  )
  on conflict (company_id) do update
  set
    original_website_url = excluded.original_website_url,
    normalized_website_url = excluded.normalized_website_url,
    video_path = null,
    status = 'pending',
    error_text = null,
    lock_token = null,
    lock_expires_at = null,
    started_at = null,
    completed_at = null,
    updated_at = now()
  where
    p_force_retry
    or softora_company_website_videos.normalized_website_url <> excluded.normalized_website_url
    or softora_company_website_videos.status = 'failed';

  return query
  select * from public.softora_company_website_videos where company_id = p_company_id;
end;
$$;

create or replace function public.softora_claim_company_website_video(
  p_lock_token text,
  p_lock_timeout_seconds integer default 300
)
returns setof public.softora_company_website_videos
language plpgsql
security invoker
set search_path = public
as $$
declare
  claimed_company_id text;
begin
  select company_id
  into claimed_company_id
  from public.softora_company_website_videos
  where
    status = 'pending'
    or (status = 'processing' and lock_expires_at < now())
  order by updated_at asc
  for update skip locked
  limit 1;

  if claimed_company_id is null then
    return;
  end if;

  return query
  update public.softora_company_website_videos
  set
    status = 'processing',
    error_text = null,
    lock_token = p_lock_token,
    lock_expires_at = now() + make_interval(secs => greatest(60, least(1800, p_lock_timeout_seconds))),
    started_at = now(),
    completed_at = null,
    updated_at = now()
  where company_id = claimed_company_id
  returning *;
end;
$$;

revoke all on function public.softora_queue_company_website_video(text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.softora_claim_company_website_video(text, integer) from public, anon, authenticated;
grant execute on function public.softora_queue_company_website_video(text, text, text, boolean) to service_role;
grant execute on function public.softora_claim_company_website_video(text, integer) to service_role;
