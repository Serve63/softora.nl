do $$
begin
  if exists (
    select 1
    from public.softora_mailbox_send_provenance
    where send_identity_key !~ '^(smtp-reply|instantly-reply|new-message):[0-9a-f]{64}$'
      or send_scope_key !~ '^(smtp|instantly)-(reply|new-message)-scope:[0-9a-f]{64}$'
      or payload_fingerprint !~ '^[0-9a-f]{64}$'
  ) then
    raise exception using
      errcode = '23514',
      message = 'Mailbox-sendprovenance bevat niet-deterministische identiteitssleutels';
  end if;
end;
$$;

alter table public.softora_mailbox_send_provenance
  drop constraint if exists softora_mailbox_send_provenance_identity_format_check,
  drop constraint if exists softora_mailbox_send_provenance_scope_format_check,
  drop constraint if exists softora_mailbox_send_provenance_payload_format_check;

alter table public.softora_mailbox_send_provenance
  add constraint softora_mailbox_send_provenance_identity_format_check
    check (send_identity_key ~ '^(smtp-reply|instantly-reply|new-message):[0-9a-f]{64}$'),
  add constraint softora_mailbox_send_provenance_scope_format_check
    check (send_scope_key ~ '^(smtp|instantly)-(reply|new-message)-scope:[0-9a-f]{64}$'),
  add constraint softora_mailbox_send_provenance_payload_format_check
    check (payload_fingerprint ~ '^[0-9a-f]{64}$');
