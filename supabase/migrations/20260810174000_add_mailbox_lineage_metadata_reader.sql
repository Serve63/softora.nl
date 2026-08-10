-- The canonical lineage reader can return more than a megabyte because every
-- durable message row includes body_text. Bootstrap consumers hydrate bodies
-- separately by exact identity, so keep the same bounded lineage semantics
-- while removing only that redundant field at the database boundary.

create or replace function public.softora_find_mailbox_campaign_lineage_metadata(
  p_account_emails text[],
  p_reply_limit integer default 200,
  p_max_depth integer default 20,
  p_max_context_messages integer default 9000,
  p_deadline_ms integer default 8000,
  p_before_message_date timestamptz default null,
  p_before_message_key text default null,
  p_before_discovered_at timestamptz default null,
  p_before_discovered_key text default null
)
returns table (
  message jsonb,
  lineage_depth integer,
  campaign_root_message_id text,
  lineage_discovered_at timestamptz,
  lineage_selected_reply boolean,
  lineage_selection_source text,
  lineage_has_more boolean,
  lineage_context_truncated boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    lineage.message - 'body_text' as message,
    lineage.lineage_depth,
    lineage.campaign_root_message_id,
    lineage.lineage_discovered_at,
    lineage.lineage_selected_reply,
    lineage.lineage_selection_source,
    lineage.lineage_has_more,
    lineage.lineage_context_truncated
  from public.softora_find_mailbox_campaign_lineage(
    p_account_emails,
    p_reply_limit,
    p_max_depth,
    p_max_context_messages,
    p_deadline_ms,
    p_before_message_date,
    p_before_message_key,
    p_before_discovered_at,
    p_before_discovered_key
  ) as lineage;
$$;

revoke all on function public.softora_find_mailbox_campaign_lineage_metadata(
  text[], integer, integer, integer, integer, timestamptz, text, timestamptz, text
) from public, anon, authenticated, service_role;
grant execute on function public.softora_find_mailbox_campaign_lineage_metadata(
  text[], integer, integer, integer, integer, timestamptz, text, timestamptz, text
) to service_role;
