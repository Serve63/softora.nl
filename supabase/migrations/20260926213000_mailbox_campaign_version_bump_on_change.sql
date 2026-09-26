-- A steady fast refresh re-commits the newest few messages on every run, and
-- the commit bumped the campaign content_version whenever p_rows was non-empty.
-- The version then changed about twice a minute without any visible change, so
-- the API could never reuse its campaign list. Fingerprint the visible columns
-- of the committed rows (the same list the statement trigger compares) before
-- and after the upsert, and bump only when they differ or rows are new.
create or replace function pg_temp.softora_replace_mailbox_function_fragment(
  p_signature text,
  p_old text,
  p_new text,
  p_label text
)
returns void
language plpgsql
volatile
set search_path = ''
as $function$
declare
  v_oid pg_catalog.oid := pg_catalog.to_regprocedure(p_signature);
  v_definition text;
  v_matches integer;
begin
  if v_oid is null or coalesce(p_old, '') = '' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_SYNC_REPAIR_PATCH_TARGET_INVALID', detail = p_label;
  end if;
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  v_matches := (
    pg_catalog.char_length(v_definition)
    - pg_catalog.char_length(pg_catalog.replace(v_definition, p_old, ''))
  ) / pg_catalog.char_length(p_old);
  if v_matches <> 1 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_SYNC_REPAIR_PATCH_DRIFT',
      detail = p_label || ': expected one fragment, found ' || v_matches::text;
  end if;
  execute pg_catalog.replace(v_definition, p_old, p_new);
end;
$function$;

select pg_temp.softora_replace_mailbox_function_fragment(
  'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
  $old$STEADY_COVERAGE_INVALID';
    end if;

    insert into public.softora_mailbox_messages as stored_message ($old$,
  $new$STEADY_COVERAGE_INVALID';
    end if;

    perform pg_catalog.set_config('softora.mailbox_commit_visible_before', coalesce((
      select pg_catalog.md5(pg_catalog.string_agg(row(
        visible.message_key, visible.account_email, visible.folder, visible.uid,
        visible.provider_id, visible.message_id, visible.in_reply_to, visible.references_text,
        visible.sender_name, visible.sender_email, visible.recipients_text, visible.subject,
        visible.preview, visible.body_text, visible.body_truncated, visible.has_body,
        visible.date, visible.internal_date, visible.unread, visible.softora_read_at,
        visible.starred, visible.reply_dismissed_at, visible.payload, visible.deleted_at,
        visible.generation_superseded_at
      )::text, '|' order by visible.message_key))
      from public.softora_mailbox_messages as visible
      where visible.message_key in (
        select v_sync.account_email || '|' || v_sync.folder || '|gen:' || p_generation_id::text
          || '|' || ((candidate.row_data->>'uid')::bigint)::text
        from pg_catalog.jsonb_array_elements(p_rows) as candidate(row_data)
      )
    ), ''), true);

    insert into public.softora_mailbox_messages as stored_message ($new$,
  'commit steady: fingerprint visible rows before upsert'
);

select pg_temp.softora_replace_mailbox_function_fragment(
  'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
  $old$      pg_catalog.jsonb_array_length(p_rows) > 0
    );$old$,
  $new$      pg_catalog.jsonb_array_length(p_rows) > 0
        and coalesce(pg_catalog.current_setting('softora.mailbox_commit_visible_before', true), '')
          is distinct from coalesce((
      select pg_catalog.md5(pg_catalog.string_agg(row(
        visible.message_key, visible.account_email, visible.folder, visible.uid,
        visible.provider_id, visible.message_id, visible.in_reply_to, visible.references_text,
        visible.sender_name, visible.sender_email, visible.recipients_text, visible.subject,
        visible.preview, visible.body_text, visible.body_truncated, visible.has_body,
        visible.date, visible.internal_date, visible.unread, visible.softora_read_at,
        visible.starred, visible.reply_dismissed_at, visible.payload, visible.deleted_at,
        visible.generation_superseded_at
      )::text, '|' order by visible.message_key))
      from public.softora_mailbox_messages as visible
      where visible.message_key in (
        select v_sync.account_email || '|' || v_sync.folder || '|gen:' || p_generation_id::text
          || '|' || ((candidate.row_data->>'uid')::bigint)::text
        from pg_catalog.jsonb_array_elements(p_rows) as candidate(row_data)
      )
    ), '')
    );$new$,
  'commit steady: bump only on a visible change'
);
