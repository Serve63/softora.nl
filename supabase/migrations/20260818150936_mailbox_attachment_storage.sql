-- Private, short-lived mailbox attachment staging for direct browser uploads.
-- Mailbox send provenance remains the source of truth; this bucket only holds
-- opaque temporary objects before the already-reserved send is completed.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'softora-mailbox-attachments',
  'softora-mailbox-attachments',
  false,
  4194304,
  array[
    'application/octet-stream',
    'application/msword',
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/csv',
    'text/plain'
  ]
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
