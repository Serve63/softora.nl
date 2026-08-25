const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const migrationPath = path.resolve(__dirname,
  '../../supabase/migrations/20260825025630_mailbox_stored_message_evidence_lookup.sql');
const schemaPath = path.resolve(__dirname, '../../supabase/data-ops-schema.sql');
const tombstoneMigrationPath = path.resolve(__dirname,
  '../../supabase/migrations/20260820171023_mailbox_contact_search_and_logical_tombstones.sql');

function markedBlock(source) {
  const match = source.match(/-- mailbox-stored-message-evidence-lookup:start[\s\S]*?-- mailbox-stored-message-evidence-lookup:end/);
  assert.ok(match, 'stored-message evidence-blok ontbreekt');
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

test('stored-message evidence-RPC normaliseert casing en omvat oude rijen plus losse tombstones zonder cap', async () => {
  const database = new PGlite();
  await database.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.softora_mailbox_messages (
      account_email text, folder text, message_id text,
      deleted_at timestamptz, generation_superseded_at timestamptz
    );
    create table public.softora_mailbox_message_tombstones (
      account_email text not null, normalized_message_id text not null,
      deleted_at timestamptz, updated_at timestamptz,
      primary key (account_email, normalized_message_id)
    );
  `);
  const tombstoneMigration = fs.readFileSync(tombstoneMigrationPath, 'utf8');
  await database.exec(sqlFunctionBlock(tombstoneMigration, 'softora_normalize_mailbox_message_id'));
  await database.exec(fs.readFileSync(migrationPath, 'utf8'));

  await database.exec(`
    insert into public.softora_mailbox_messages (
      account_email, folder, message_id, deleted_at, generation_superseded_at
    )
    select 'serve@softora.nl', 'sent',
      '<Bulk-' || ((number - 1) % 99)::text || '@Example.COM>', null, null
    from pg_catalog.generate_series(1, 1000) number;

    insert into public.softora_mailbox_messages values
      ('serve@softora.nl', 'sent', '<TARGET@Example.COM>', null, null),
      ('serve@softora.nl', 'sent', '<SUPERSEDED@Example.COM>', null, pg_catalog.now()),
      ('serve@softora.nl', 'sent', '<DELETED@Example.COM>', pg_catalog.now(), null),
      ('martijn@softora.nl', 'sent', '<WRONG-ACCOUNT@Example.COM>', null, null),
      ('serve@softora.nl', 'inbox', '<WRONG-FOLDER@Example.COM>', null, null);

    insert into public.softora_mailbox_message_tombstones values
      ('serve@softora.nl', 'tombstone-only@example.com', pg_catalog.now(), pg_catalog.now());
  `);

  const requestedIds = Array.from({ length: 99 }, (_, index) => `bulk-${index}@example.com`)
    .concat(['target@example.com', 'superseded@example.com', 'deleted@example.com',
      'tombstone-only@example.com', 'wrong-account@example.com', 'wrong-folder@example.com']);
  const sqlIds = requestedIds.map((value) => `'${value}'`).join(',');
  const evidence = await database.query(`
    select message_id
    from public.softora_list_stored_mailbox_message_ids(
      array['SERVE@SOFTORA.NL'], 'SENT', array[${sqlIds}]
    )
  `);
  const found = evidence.rows.map((row) => row.message_id);
  assert.equal(found.length, 103);
  assert.equal(found.includes('target@example.com'), true);
  assert.equal(found.includes('superseded@example.com'), true);
  assert.equal(found.includes('deleted@example.com'), true);
  assert.equal(found.includes('tombstone-only@example.com'), true);
  assert.equal(found.includes('wrong-account@example.com'), false);
  assert.equal(found.includes('wrong-folder@example.com'), false);

  const privileges = await database.query(`
    select
      has_function_privilege('anon', 'public.softora_list_stored_mailbox_message_ids(text[],text,text[])', 'execute') as anon_execute,
      has_function_privilege('authenticated', 'public.softora_list_stored_mailbox_message_ids(text[],text,text[])', 'execute') as authenticated_execute,
      has_function_privilege('service_role', 'public.softora_list_stored_mailbox_message_ids(text[],text,text[])', 'execute') as service_execute
  `);
  assert.deepEqual(privileges.rows[0], {
    anon_execute: false,
    authenticated_execute: false,
    service_execute: true,
  });
  await database.close();
});

test('stored-message evidence-RPC is begrensd, invoker-secured en exact gespiegeld', () => {
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  assert.equal(markedBlock(schema), markedBlock(migration));
  assert.match(migration, /security invoker\s+set search_path = ''/i);
  assert.match(migration, /cardinality\(p_account_emails\)[\s\S]*?> 20/);
  assert.match(migration, /cardinality\(p_message_ids\)[\s\S]*?> 200/);
  assert.match(migration, /softora_mailbox_message_tombstones/);
  assert.match(migration, /softora_normalize_mailbox_message_id\(message\.message_id\)/);
  assert.doesNotMatch(migration, /security definer/i);
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated, service_role;/);
  assert.match(migration, /grant execute[\s\S]*to service_role;/);
});
