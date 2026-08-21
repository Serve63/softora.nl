const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const migrationPath = path.resolve(
  __dirname,
  '../../supabase/migrations/20260821144000_mailbox_recipient_batch_lookup.sql'
);
const historyMigrationPath = path.resolve(
  __dirname,
  '../../supabase/migrations/20260817102256_mailbox_full_history_search.sql'
);
const schemaPath = path.resolve(__dirname, '../../supabase/data-ops-schema.sql');

function batchLookupBlock(source) {
  const match = source.match(
    /-- mailbox-recipient-batch-lookup:start[\s\S]*?-- mailbox-recipient-batch-lookup:end/
  );
  assert.ok(match, 'mailbox recipient batch lookup-blok ontbreekt');
  return match[0];
}

function sqlFunctionBlock(source, signature) {
  const start = source.indexOf(`create or replace function public.${signature}`);
  assert.ok(start >= 0, `${signature} ontbreekt`);
  const endMarker = '$function$;';
  const end = source.indexOf(endMarker, start);
  assert.ok(end >= 0, `${signature} is niet afgesloten`);
  return source.slice(start, end + endMarker.length);
}

test('recipient-batch-RPC bewaart scope, exacte ontvangers, historie en deterministische limiet', async () => {
  const database = new PGlite();
  await database.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.softora_mailbox_messages (
      message_key text primary key,
      account_email text,
      folder text,
      uid bigint,
      provider_id text,
      message_id text,
      in_reply_to text,
      references_text text,
      sender_name text,
      sender_email text,
      recipients_text text,
      subject text,
      preview text,
      body_text text,
      date timestamptz,
      internal_date timestamptz,
      unread boolean,
      softora_read_at timestamptz,
      state_revision bigint,
      state_mutation_key text,
      state_mutation_at timestamptz,
      starred boolean,
      reply_dismissed_at timestamptz,
      has_body boolean,
      body_truncated boolean,
      payload jsonb,
      created_at timestamptz,
      updated_at timestamptz,
      deleted_at timestamptz,
      generation_superseded_at timestamptz
    );
  `);
  const historySource = fs.readFileSync(historyMigrationPath, 'utf8');
  await database.exec(sqlFunctionBlock(historySource, 'softora_mailbox_participant_emails'));
  await database.exec(sqlFunctionBlock(historySource, 'softora_mailbox_message_participants'));
  await database.exec(fs.readFileSync(migrationPath, 'utf8'));

  const rows = [
    ['active-a', 'serve@softora.nl', 'sent', 1, 'other@example.nl', 'Prospect <TARGET@Example.NL>', '2026-08-21T10:00:00Z', null, null, '{}'],
    ['active-z', 'serve@softora.nl', 'sent', 2, 'other@example.nl', 'Target <target@example.nl>', '2026-08-21T10:00:00Z', null, null, '{}'],
    ['superseded', 'serve@softora.nl', 'sent', 3, 'other@example.nl', 'target@example.nl', '2026-08-21T09:00:00Z', null, '2026-08-21T09:30:00Z', '{}'],
    ['sender-only-newest', 'serve@softora.nl', 'sent', 4, 'target@example.nl', 'other@example.nl', '2026-08-21T12:00:00Z', null, null, '{}'],
    ['payload-only-newer', 'serve@softora.nl', 'sent', 5, 'other@example.nl', 'other@example.nl', '2026-08-21T11:00:00Z', null, null, '{"cc":"target@example.nl"}'],
    ['wrong-account', 'martijn@softora.nl', 'sent', 6, 'other@example.nl', 'target@example.nl', '2026-08-21T13:00:00Z', null, null, '{}'],
    ['wrong-folder', 'serve@softora.nl', 'inbox', 7, 'other@example.nl', 'target@example.nl', '2026-08-21T13:00:00Z', null, null, '{}'],
    ['deleted', 'serve@softora.nl', 'sent', 8, 'other@example.nl', 'target@example.nl', '2026-08-21T13:00:00Z', '2026-08-21T13:01:00Z', null, '{}'],
  ];
  for (const [messageKey, accountEmail, folder, uid, senderEmail, recipientsText, date, deletedAt, supersededAt, payload] of rows) {
    await database.query(`
      insert into public.softora_mailbox_messages (
        message_key, account_email, folder, uid, provider_id, sender_email,
        recipients_text, date, internal_date, unread, state_revision, starred,
        has_body, body_truncated, payload, deleted_at, generation_superseded_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $8, false, 0, false, false, false, $9::jsonb, $10, $11)
    `, [
      messageKey,
      accountEmail,
      folder,
      uid,
      `${folder}:${uid}`,
      senderEmail,
      recipientsText,
      date,
      payload,
      deletedAt,
      supersededAt,
    ]);
  }

  const allMatches = await database.query(`
    select public.softora_list_mailbox_messages_by_recipients(
      array['serve@softora.nl'], 'sent', array['target@example.nl'], 10
    ) as messages
  `);
  assert.deepEqual(
    allMatches.rows[0].messages.map((message) => message.message_key),
    ['active-z', 'active-a', 'superseded']
  );
  assert.equal(Object.hasOwn(allMatches.rows[0].messages[0], 'body_text'), false);
  assert.deepEqual(
    Object.keys(allMatches.rows[0].messages[0]).sort(),
    [
      'account_email', 'body_truncated', 'date', 'folder', 'has_body', 'in_reply_to',
      'internal_date', 'message_id', 'message_key', 'payload', 'preview', 'provider_id',
      'recipients_text', 'references_text', 'reply_dismissed_at', 'sender_email',
      'sender_name', 'softora_read_at', 'starred', 'state_mutation_at',
      'state_mutation_key', 'state_revision', 'subject', 'uid', 'unread',
    ].sort()
  );

  const capped = await database.query(`
    select public.softora_list_mailbox_messages_by_recipients(
      array['serve@softora.nl'], 'sent', array['target@example.nl'], 1
    ) as messages
  `);
  assert.deepEqual(capped.rows[0].messages.map((message) => message.message_key), ['active-z']);

  const privileges = await database.query(`
    select
      has_function_privilege('anon', 'public.softora_list_mailbox_messages_by_recipients(text[],text,text[],integer)', 'execute') as anon_execute,
      has_function_privilege('authenticated', 'public.softora_list_mailbox_messages_by_recipients(text[],text,text[],integer)', 'execute') as authenticated_execute,
      has_function_privilege('service_role', 'public.softora_list_mailbox_messages_by_recipients(text[],text,text[],integer)', 'execute') as service_execute
  `);
  assert.deepEqual(privileges.rows[0], {
    anon_execute: false,
    authenticated_execute: false,
    service_execute: true,
  });
  await database.close();
});

test('recipient-batch-RPC blijft exact gespiegeld en gebruikt bestaande GIN zonder schema-oppervlak te verbreden', () => {
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  assert.equal(batchLookupBlock(schema), batchLookupBlock(migration));
  assert.match(migration, /returns jsonb/);
  assert.match(migration, /generation_superseded_at is null/);
  assert.match(migration, /generation_superseded_at is not null/);
  assert.match(migration, /union all/);
  assert.equal((migration.match(/softora_mailbox_participant_emails\(m\.recipients_text\)/g) || []).length, 2);
  assert.doesNotMatch(migration, /to_jsonb\(m\)/);
  assert.doesNotMatch(migration, /create index/i);
  assert.doesNotMatch(migration, /create or replace function public\.softora_mailbox_participant_emails/);
  assert.match(
    migration,
    /revoke all on function public\.softora_list_mailbox_messages_by_recipients[\s\S]*from public, anon, authenticated, service_role;/
  );
  assert.match(migration, /grant execute[\s\S]*to service_role;/);
  assert.match(migration, /notify pgrst, 'reload schema';/);
});
