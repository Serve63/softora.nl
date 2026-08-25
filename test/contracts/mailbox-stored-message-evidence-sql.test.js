const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const migrationPath = path.resolve(__dirname,
  '../../supabase/migrations/20260825025630_mailbox_stored_message_evidence_lookup.sql');
const provenanceMigrationPath = path.resolve(__dirname,
  '../../supabase/migrations/20260825031043_mailbox_accepted_provenance_evidence_lookup.sql');
const schemaPath = path.resolve(__dirname, '../../supabase/data-ops-schema.sql');
const tombstoneMigrationPath = path.resolve(__dirname,
  '../../supabase/migrations/20260820171023_mailbox_contact_search_and_logical_tombstones.sql');

function markedBlock(source) {
  const match = source.match(/-- mailbox-stored-message-evidence-lookup:start[\s\S]*?-- mailbox-stored-message-evidence-lookup:end/);
  assert.ok(match, 'stored-message evidence-blok ontbreekt');
  return match[0];
}

function acceptedProvenanceMarkedBlock(source) {
  const match = source.match(/-- mailbox-accepted-provenance-evidence-lookup:start[\s\S]*?-- mailbox-accepted-provenance-evidence-lookup:end/);
  assert.ok(match, 'accepted-provenance evidence-blok ontbreekt');
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

test('accepted-provenance evidence-RPC aggregeert meer dan 1000 canonieke matches zonder account- of statuslek', async () => {
  const database = new PGlite();
  await database.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.softora_mailbox_send_provenance (
      intent_id text primary key,
      idempotency_key text not null,
      owner text not null,
      account_email text not null,
      recipient_email text not null,
      mode text not null,
      conversation_id text,
      reply_target_message_id text,
      references_text text,
      provider text not null,
      provider_thread_id text,
      provider_message_id text,
      sent_message_id text,
      sender_name text,
      subject text not null,
      body_text text,
      cc_text text,
      bcc_text text,
      status text not null,
      error_text text,
      dispatch_state text,
      accepted_at timestamptz,
      created_at timestamptz,
      updated_at timestamptz
    );
  `);
  const tombstoneMigration = fs.readFileSync(tombstoneMigrationPath, 'utf8');
  await database.exec(sqlFunctionBlock(tombstoneMigration, 'softora_normalize_mailbox_message_id'));
  await database.exec(fs.readFileSync(provenanceMigrationPath, 'utf8'));

  await database.exec(`
    insert into public.softora_mailbox_send_provenance (
      intent_id, idempotency_key, owner, account_email, recipient_email, mode,
      conversation_id, reply_target_message_id, references_text, provider,
      provider_thread_id, provider_message_id, sent_message_id, sender_name,
      subject, body_text, cc_text, bcc_text, status, dispatch_state,
      accepted_at, created_at, updated_at
    )
    select
      'accepted-' || number::text,
      'accepted-key-' || number::text,
      'serve',
      'serve@softora.nl',
      'contact-' || number::text || '@example.nl',
      'reply',
      'conversation-' || number::text,
      '<parent-' || number::text || '@example.nl>',
      '<root@example.nl> <parent-' || number::text || '@example.nl>',
      'smtp',
      'thread-' || number::text,
      'provider-' || number::text,
      case number % 3
        when 0 then '<TARGET@Example.COM>'
        when 1 then ' target@example.com '
        else '<<Target@Example.COM>>,'
      end,
      'Servé Creusen',
      'Re: Kleine vraag',
      'Exact antwoord ' || number::text,
      'cc@example.nl',
      'bcc@example.nl',
      'accepted',
      'finished',
      '2026-08-25T00:00:00Z'::timestamptz + number * interval '1 second',
      '2026-08-24T23:00:00Z'::timestamptz,
      '2026-08-25T00:00:00Z'::timestamptz + number * interval '1 second'
    from pg_catalog.generate_series(1, 1005) number;

    insert into public.softora_mailbox_send_provenance (
      intent_id, idempotency_key, owner, account_email, recipient_email, mode,
      provider, sent_message_id, subject, status, accepted_at, created_at, updated_at
    ) values
      ('wrong-account', 'wrong-account-key', 'martijn', 'martijn@softora.nl',
        'wrong@example.nl', 'reply', 'smtp', '<target@example.com>', 'Re: Fout',
        'accepted', pg_catalog.now(), pg_catalog.now(), pg_catalog.now()),
      ('wrong-status', 'wrong-status-key', 'serve', 'serve@softora.nl',
        'wrong@example.nl', 'reply', 'smtp', '<target@example.com>', 'Re: Fout',
        'failed', pg_catalog.now(), pg_catalog.now(), pg_catalog.now()),
      ('wrong-id', 'wrong-id-key', 'serve', 'serve@softora.nl',
        'wrong@example.nl', 'reply', 'smtp', '<other@example.com>', 'Re: Fout',
        'accepted', pg_catalog.now(), pg_catalog.now(), pg_catalog.now());
  `);

  const completeResult = await database.query(`
    select public.softora_list_accepted_mailbox_send_provenance_by_message_ids(
      array[' SERVE@SOFTORA.NL '], array[' <<TARGET@example.com>>, '], 1100
    ) as evidence
  `);
  const complete = completeResult.rows[0].evidence;
  assert.equal(complete.complete, true);
  assert.equal(complete.overflow, false);
  assert.equal(complete.returned_count, 1005);
  assert.equal(complete.max_rows, 1100);
  assert.equal(complete.rows.length, 1005);
  assert.equal(complete.rows[0].intent_id, 'accepted-1005');
  assert.equal(complete.rows[0].canonical_message_id, 'target@example.com');
  assert.equal(complete.rows[0].recipient_email, 'contact-1005@example.nl');
  assert.equal(complete.rows[0].body_text, 'Exact antwoord 1005');
  assert.equal(complete.rows.some((row) => row.intent_id === 'wrong-account'), false);
  assert.equal(complete.rows.some((row) => row.intent_id === 'wrong-status'), false);
  assert.equal(complete.rows.some((row) => row.intent_id === 'wrong-id'), false);

  const overflowResult = await database.query(`
    select public.softora_list_accepted_mailbox_send_provenance_by_message_ids(
      array['serve@softora.nl'], array['target@example.com'], 1000
    ) as evidence
  `);
  const overflow = overflowResult.rows[0].evidence;
  assert.equal(overflow.complete, false);
  assert.equal(overflow.overflow, true);
  assert.equal(overflow.returned_count, 1001);
  assert.equal(overflow.rows.length, 1001);

  const emptyResult = await database.query(`
    select public.softora_list_accepted_mailbox_send_provenance_by_message_ids(
      array[]::text[], array[]::text[], 10
    ) as evidence
  `);
  assert.deepEqual(emptyResult.rows[0].evidence, {
    rows: [], complete: true, overflow: false, returned_count: 0, max_rows: 10,
  });

  await assert.rejects(
    database.query(`
      select public.softora_list_accepted_mailbox_send_provenance_by_message_ids(
        array(select 'account-' || number::text || '@example.nl'
          from pg_catalog.generate_series(1, 21) number),
        array['target@example.com'], 10
      )
    `),
    /MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_INPUT_TOO_LARGE/
  );
  await assert.rejects(
    database.query(`
      select public.softora_list_accepted_mailbox_send_provenance_by_message_ids(
        array['serve@softora.nl'],
        array(select 'target-' || number::text || '@example.com'
          from pg_catalog.generate_series(1, 201) number), 10
      )
    `),
    /MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_INPUT_TOO_LARGE/
  );

  const privileges = await database.query(`
    select
      has_function_privilege('anon', 'public.softora_list_accepted_mailbox_send_provenance_by_message_ids(text[],text[],integer)', 'execute') as anon_execute,
      has_function_privilege('authenticated', 'public.softora_list_accepted_mailbox_send_provenance_by_message_ids(text[],text[],integer)', 'execute') as authenticated_execute,
      has_function_privilege('service_role', 'public.softora_list_accepted_mailbox_send_provenance_by_message_ids(text[],text[],integer)', 'execute') as service_execute
  `);
  assert.deepEqual(privileges.rows[0], {
    anon_execute: false,
    authenticated_execute: false,
    service_execute: true,
  });
  await database.close();
});

test('accepted-provenance evidence-RPC is canoniek, geaggregeerd, invoker-secured en exact gespiegeld', () => {
  const migration = fs.readFileSync(provenanceMigrationPath, 'utf8');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  assert.equal(acceptedProvenanceMarkedBlock(schema), acceptedProvenanceMarkedBlock(migration));
  assert.match(migration, /returns jsonb[\s\S]*?security invoker[\s\S]*?set search_path = ''/i);
  assert.match(migration, /cardinality\(p_account_emails\)[\s\S]*?> 20/);
  assert.match(migration, /cardinality\(p_message_ids\)[\s\S]*?> 200/);
  assert.match(migration, /p_max_rows[\s\S]*?between 1 and 2000/);
  assert.match(migration, /status = 'accepted'/);
  assert.match(migration, /softora_mailbox_send_provenance_accepted_message_id_idx/);
  assert.match(migration, /softora_normalize_mailbox_message_id\([\s\S]*?sent_message_id/);
  assert.match(migration, /limit \(p_max_rows \+ 1\)[\s\S]*?jsonb_agg/i);
  assert.match(migration, /'complete'[\s\S]*?'overflow'[\s\S]*?'returned_count'/);
  assert.doesNotMatch(migration, /security definer/i);
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated, service_role;/);
  assert.match(migration, /grant execute[\s\S]*to service_role;/);
});
