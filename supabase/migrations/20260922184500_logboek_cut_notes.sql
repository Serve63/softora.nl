-- Per-day exercise notes stay in Supabase and never change the shared exercise plan.
alter table public.softora_logboek_cut_sessions
  add column if not exists notes jsonb not null default '{}'::jsonb;
alter table public.softora_logboek_cut_events
  add column if not exists note_text text;

create function public.softora_logboek_cut_note(
 p_date date, p_order integer, p_text text, p_version integer, p_operation uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
 s public.softora_logboek_cut_sessions%rowtype;
 e public.softora_logboek_cut_events%rowtype;
 k text := 'note:' || p_order::text;
 v integer;
begin
 if p_order < 0 or p_version < 0 or length(p_text) > 1000 then raise exception 'Invalid note'; end if;
 select * into s from public.softora_logboek_cut_sessions where training_date=p_date for update;
 if not found then raise exception 'Session missing'; end if;
 if not exists (select 1 from jsonb_array_elements(s.exercises) x where (x->>'order')::integer=p_order)
 then raise exception 'Invalid exercise'; end if;
 select * into e from public.softora_logboek_cut_events where operation_id=p_operation;
 if found then
   if e.training_date<>p_date or e.set_key<>k or e.note_text<>p_text or e.expected_version<>p_version
   then raise exception 'Operation mismatch'; end if;
   return jsonb_build_object('conflict',false,'session',to_jsonb(s));
 end if;
 v := coalesce((s.notes->p_order::text->>'version')::integer,0);
 if v<>p_version then return jsonb_build_object('conflict',true,'session',to_jsonb(s)); end if;
 update public.softora_logboek_cut_sessions
 set notes=jsonb_set(notes,array[p_order::text],jsonb_build_object('text',p_text,'version',v+1)), updated_at=clock_timestamp()
 where training_date=p_date returning * into s;
 insert into public.softora_logboek_cut_events(operation_id,training_date,set_key,done,expected_version,note_text)
 values(p_operation,p_date,k,false,p_version,p_text);
 return jsonb_build_object('conflict',false,'session',to_jsonb(s));
end;
$$;
revoke all on function public.softora_logboek_cut_note(date,integer,text,integer,uuid) from public, anon, authenticated;
grant execute on function public.softora_logboek_cut_note(date,integer,text,integer,uuid) to service_role;
