const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const migration = fs.readFileSync(path.join(
  repoRoot,
  'supabase/migrations/20260827233202_mailbox_pre_dispatch_claim_fencing.sql'
), 'utf8');

const tableName = 'softora_mailbox_send_provenance';
const claimName = 'softora_claim_mailbox_pre_dispatch';
const finalizeName = 'softora_finalize_mailbox_pre_dispatch_claim';
const startName = 'softora_start_mailbox_pre_dispatch';
const expireReservedName = 'softora_expire_mailbox_reserved_dispatch';
const expireStartedName = 'softora_expire_mailbox_started_dispatch';
const rpcNames = [claimName, finalizeName, startName, expireReservedName, expireStartedName];

const expectedParameters = {
  [claimName]: [
    'p_row jsonb',
    'p_transition_token uuid',
    'p_lease_ms integer',
  ],
  [finalizeName]: [
    'p_intent_id text',
    'p_expected_transition_token uuid',
    'p_expected_dispatch_lease_expires_at timestamptz',
    'p_expected_updated_at timestamptz',
    'p_expected_claim_fingerprint text',
    'p_next_transition_token uuid',
    'p_lease_ms integer',
    'p_send_identity_key text',
    'p_send_scope_key text',
    'p_payload_fingerprint text',
    'p_attachments_fingerprint text',
    'p_request_payload_fingerprint text',
    'p_attachments_metadata jsonb',
    'p_sent_message_id text',
    'p_sender_name text',
    'p_subject text',
    'p_body_text text',
    'p_cc_text text',
    'p_bcc_text text',
  ],
  [startName]: [
    'p_intent_id text',
    'p_expected_transition_token uuid',
    'p_expected_dispatch_lease_expires_at timestamptz',
    'p_expected_updated_at timestamptz',
    'p_expected_claim_fingerprint text',
    'p_expected_finalized_at timestamptz',
    'p_next_transition_token uuid',
    'p_lease_ms integer',
  ],
  [expireReservedName]: [
    'p_intent_id text',
    'p_expected_transition_token uuid',
    'p_expected_dispatch_lease_expires_at timestamptz',
    'p_expected_updated_at timestamptz',
    'p_expected_claim_fingerprint text',
    'p_expected_finalized_at timestamptz',
    'p_next_transition_token uuid',
  ],
  [expireStartedName]: [
    'p_intent_id text',
    'p_expected_transition_token uuid',
    'p_expected_dispatch_lease_expires_at timestamptz',
    'p_expected_updated_at timestamptz',
    'p_expected_claim_fingerprint text',
    'p_expected_finalized_at timestamptz',
    'p_expected_dispatch_started_at timestamptz',
    'p_next_transition_token uuid',
  ],
};

const expectedPrivilegeTypes = {
  [claimName]: ['jsonb', 'uuid', 'integer'],
  [finalizeName]: [
    'text', 'uuid', 'timestamptz', 'timestamptz', 'text', 'uuid', 'integer',
    'text', 'text', 'text', 'text', 'text', 'jsonb', 'text', 'text', 'text',
    'text', 'text', 'text',
  ],
  [startName]: [
    'text', 'uuid', 'timestamptz', 'timestamptz', 'text', 'timestamptz',
    'uuid', 'integer',
  ],
  [expireReservedName]: [
    'text', 'uuid', 'timestamptz', 'timestamptz', 'text', 'timestamptz', 'uuid',
  ],
  [expireStartedName]: [
    'text', 'uuid', 'timestamptz', 'timestamptz', 'text', 'timestamptz',
    'timestamptz', 'uuid',
  ],
};

function literalCount(source, fragment) {
  return source.split(fragment).length - 1;
}

function normalizeSql(source) {
  return source
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim()
    .toLowerCase();
}

function functionDefinition(source, name) {
  const prefix = `create or replace function public.${name}(`;
  assert.equal(literalCount(source, prefix), 1, `${name} moet exact eenmaal worden gedefinieerd`);

  const start = source.indexOf(prefix);
  const end = source.indexOf('\n$function$;', start);
  assert.ok(end > start, `${name} mist het verwachte functie-einde`);
  return source.slice(start, end + '\n$function$;'.length);
}

function functionParameters(source, name) {
  const prefix = `create or replace function public.${name}(`;
  const start = source.indexOf(prefix);
  const end = source.indexOf('\n)\nreturns ', start);
  assert.ok(start >= 0 && end > start, `${name} heeft geen leesbare RPC-signature`);
  return source
    .slice(start + prefix.length, end)
    .split(',')
    .map((parameter) => parameter.replace(/\s+/g, ' ').trim());
}

function assertContainsOnce(source, fragment, label = fragment) {
  assert.equal(literalCount(source, fragment), 1, `${label} moet exact eenmaal voorkomen`);
}

function assertExactFenceSet(source, fences, label) {
  for (const fence of fences) {
    assertContainsOnce(source, fence, `${label}: ${fence.trim()}`);
  }
}

function assertIdempotentConstraint(name) {
  const drop = `drop constraint if exists ${name}`;
  const add = `add constraint ${name}`;
  assertContainsOnce(migration, drop, `${name} idempotente drop`);
  assertContainsOnce(migration, add, `${name} herinstallatie`);
  assert.ok(migration.indexOf(drop) < migration.indexOf(add), `${name} moet voor de add worden verwijderd`);
}

test('de migratie installeert alle vijf RPC-signatures en constraints herhaalbaar', () => {
  for (const name of rpcNames) {
    assert.deepEqual(functionParameters(migration, name), expectedParameters[name]);
    const definition = functionDefinition(migration, name);
    assert.match(definition, /returns setof public\.softora_mailbox_send_provenance/);
  }

  assertContainsOnce(migration, 'add column if not exists pre_dispatch_claim_fingerprint text');
  assertContainsOnce(migration, 'add column if not exists pre_dispatch_finalized_at timestamptz');
  assertIdempotentConstraint('softora_mailbox_send_pre_dispatch_claim_format_check');
  assertIdempotentConstraint('softora_mailbox_send_pre_dispatch_finalized_context_check');
  assert.match(migration, /pre_dispatch_claim_fingerprint is null\s+or pre_dispatch_claim_fingerprint ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(migration, /pre_dispatch_finalized_at is null\s+or pre_dispatch_claim_fingerprint is not null/);
});

test('de eerste claim bindt het request aan één DB-tijd en harde prepared-reserved toestand', () => {
  const claim = functionDefinition(migration, claimName);

  assertContainsOnce(claim, 'select pg_catalog.clock_timestamp() as ts', 'claim databaseklok');
  assert.doesNotMatch(claim, /\b(?:now|statement_timestamp|transaction_timestamp)\s*\(|\bcurrent_timestamp\b/i);
  assert.match(
    claim,
    /db_now\.ts \+ pg_catalog\.make_interval\(secs => p_lease_ms::double precision \/ 1000\.0\)/
  );

  const payloadKeys = [
    'intent_id', 'idempotency_key', 'send_identity_key', 'send_scope_key',
    'payload_fingerprint', 'attachments_fingerprint', 'request_payload_fingerprint',
    'attachments_metadata', 'owner', 'account_email', 'recipient_email', 'mode',
    'conversation_id', 'reply_target_message_id', 'references_text', 'provider',
    'provider_thread_id', 'sent_message_id', 'sender_name', 'subject', 'body_text',
    'cc_text', 'bcc_text', 'pre_dispatch_claim_fingerprint',
  ];
  for (const key of payloadKeys) {
    assert.match(claim, new RegExp(`p_row->>?'${key}'`), `${key} moet aan p_row gebonden blijven`);
  }

  const normalizedClaim = normalizeSql(claim);
  assert.match(
    normalizedClaim,
    /nullif\(p_row->>'bcc_text', ''\), 'prepared', 'reserved', null, db_now\.ts \+ pg_catalog\.make_interval\(secs => p_lease_ms::double precision \/ 1000\.0\), false, false, null, p_transition_token, p_row->>'pre_dispatch_claim_fingerprint', null, db_now\.ts, db_now\.ts from db_now/
  );
  assert.doesNotMatch(
    claim,
    /p_row->>?'(?:status|dispatch_state|dispatch_started_at|dispatch_lease_expires_at|transition_token|pre_dispatch_finalized_at|created_at|updated_at)'/
  );
  assertContainsOnce(claim, 'where p_transition_token is not null', 'claim vereist UUID-token');
  assertContainsOnce(claim, 'and p_lease_ms between 900000 and 3600000', 'claim leasegrenzen');
  assertContainsOnce(
    claim,
    "and p_row->>'pre_dispatch_claim_fingerprint' ~ '^[0-9a-f]{64}$'",
    'claim SHA-256-binding'
  );
  assertContainsOnce(claim, 'on conflict do nothing', 'claim overschrijft geen bestaand intent');
});

test('finalize gebruikt één databaseklok en de volledige claim-CAS zonder dispatch te starten', () => {
  const finalize = functionDefinition(migration, finalizeName);

  assertContainsOnce(finalize, 'select pg_catalog.clock_timestamp() as ts', 'finalize databaseklok');
  assert.doesNotMatch(finalize, /\b(?:now|statement_timestamp|transaction_timestamp)\s*\(|\bcurrent_timestamp\b/i);
  assert.match(finalize, /pre_dispatch_finalized_at = db_now\.ts,[\s\S]*updated_at = db_now\.ts/);
  assert.match(
    finalize,
    /dispatch_lease_expires_at = db_now\.ts\s+\+ pg_catalog\.make_interval\(secs => p_lease_ms::double precision \/ 1000\.0\)/
  );

  assertExactFenceSet(finalize, [
    'where provenance.intent_id = p_intent_id',
    "and provenance.status = 'prepared'",
    "and provenance.dispatch_state = 'reserved'",
    'and provenance.transition_token = p_expected_transition_token',
    'and provenance.dispatch_lease_expires_at = p_expected_dispatch_lease_expires_at',
    'and provenance.updated_at = p_expected_updated_at',
    'and provenance.pre_dispatch_claim_fingerprint = p_expected_claim_fingerprint',
    'and provenance.pre_dispatch_finalized_at is null',
    'and provenance.dispatch_lease_expires_at > db_now.ts',
  ], 'finalize-CAS');

  assertContainsOnce(finalize, 'transition_token = p_next_transition_token', 'finalize tokenrotatie');
  assertContainsOnce(finalize, 'and p_next_transition_token is not null', 'finalize niet-lege opvolgtoken');
  assertContainsOnce(
    finalize,
    'and p_next_transition_token <> p_expected_transition_token',
    'finalize nieuwe opvolgtoken'
  );
  assertContainsOnce(finalize, 'and p_lease_ms between 900000 and 3600000', 'finalize leasegrenzen');
  assert.doesNotMatch(finalize, /set\s+dispatch_state\s*=/i);
  assert.doesNotMatch(finalize, /dispatch_started_at/i);
});

test('start vereist exact de gefinaliseerde claim en deelt één DB-tijd voor start en update', () => {
  const start = functionDefinition(migration, startName);

  assertContainsOnce(start, 'select pg_catalog.clock_timestamp() as ts', 'start databaseklok');
  assert.doesNotMatch(start, /\b(?:now|statement_timestamp|transaction_timestamp)\s*\(|\bcurrent_timestamp\b/i);
  assert.match(
    start,
    /set dispatch_state = 'started',\s+dispatch_started_at = db_now\.ts,[\s\S]*updated_at = db_now\.ts/
  );
  assert.match(
    start,
    /dispatch_lease_expires_at = db_now\.ts\s+\+ pg_catalog\.make_interval\(secs => p_lease_ms::double precision \/ 1000\.0\)/
  );

  assertExactFenceSet(start, [
    'where provenance.intent_id = p_intent_id',
    "and provenance.status = 'prepared'",
    "and provenance.dispatch_state = 'reserved'",
    'and provenance.transition_token = p_expected_transition_token',
    'and provenance.dispatch_lease_expires_at = p_expected_dispatch_lease_expires_at',
    'and provenance.updated_at = p_expected_updated_at',
    'and provenance.pre_dispatch_claim_fingerprint = p_expected_claim_fingerprint',
    'and provenance.pre_dispatch_finalized_at = p_expected_finalized_at',
    'and provenance.pre_dispatch_finalized_at is not null',
    'and provenance.dispatch_lease_expires_at > db_now.ts',
  ], 'start-CAS');

  assertContainsOnce(start, 'transition_token = p_next_transition_token', 'start tokenrotatie');
  assertContainsOnce(start, 'and p_next_transition_token is not null', 'start niet-lege opvolgtoken');
  assertContainsOnce(
    start,
    'and p_next_transition_token <> p_expected_transition_token',
    'start nieuwe opvolgtoken'
  );
  assertContainsOnce(start, 'and p_lease_ms between 30000 and 900000', 'start leasegrenzen');
});

test('reserved-expiry gebruikt uitsluitend de databaseklok en de volledige null-safe fence', () => {
  const expiry = functionDefinition(migration, expireReservedName);
  assertContainsOnce(expiry, 'select pg_catalog.clock_timestamp() as ts', 'reserved-expiry databaseklok');
  assert.doesNotMatch(expiry, /\b(?:now|statement_timestamp|transaction_timestamp)\s*\(|\bcurrent_timestamp\b/i);
  assertExactFenceSet(expiry, [
    'where provenance.intent_id = p_intent_id',
    "and provenance.status = 'prepared'",
    "and provenance.dispatch_state = 'reserved'",
    'and provenance.transition_token = p_expected_transition_token',
    'and provenance.dispatch_lease_expires_at = p_expected_dispatch_lease_expires_at',
    'and provenance.updated_at = p_expected_updated_at',
    'and provenance.pre_dispatch_claim_fingerprint is not distinct from p_expected_claim_fingerprint',
    'and provenance.pre_dispatch_finalized_at is not distinct from p_expected_finalized_at',
    'and provenance.dispatch_lease_expires_at <= db_now.ts',
    'and p_next_transition_token is not null',
    'and p_next_transition_token is distinct from p_expected_transition_token',
  ], 'reserved-expiry-CAS');
  assert.match(
    normalizeSql(expiry),
    /set status = 'failed', dispatch_state = 'finished', dispatch_lease_expires_at = null, reconcile_required = false, sent_reconcile_required = false, error_text = 'de pre-dispatchreservering verliep voordat de provider werd gestart\.', transition_token = p_next_transition_token, updated_at = db_now\.ts/
  );
  assert.equal(literalCount(expiry, 'update public.softora_mailbox_send_provenance'), 1);
  assertContainsOnce(expiry, 'returning provenance.*', 'reserved-expiry atomisch readbackresultaat');
});

test('started-expiry wordt nooit failed en bindt started-at plus alle overige fences', () => {
  const expiry = functionDefinition(migration, expireStartedName);
  assertContainsOnce(expiry, 'select pg_catalog.clock_timestamp() as ts', 'started-expiry databaseklok');
  assert.doesNotMatch(expiry, /\b(?:now|statement_timestamp|transaction_timestamp)\s*\(|\bcurrent_timestamp\b/i);
  assertExactFenceSet(expiry, [
    'where provenance.intent_id = p_intent_id',
    "and provenance.status = 'prepared'",
    "and provenance.dispatch_state = 'started'",
    'and provenance.transition_token = p_expected_transition_token',
    'and provenance.dispatch_lease_expires_at = p_expected_dispatch_lease_expires_at',
    'and provenance.updated_at = p_expected_updated_at',
    'and provenance.pre_dispatch_claim_fingerprint is not distinct from p_expected_claim_fingerprint',
    'and provenance.pre_dispatch_finalized_at is not distinct from p_expected_finalized_at',
    'and provenance.dispatch_started_at is not distinct from p_expected_dispatch_started_at',
    'and provenance.dispatch_started_at is not null',
    'and provenance.dispatch_lease_expires_at <= db_now.ts',
    'and p_next_transition_token is not null',
    'and p_next_transition_token is distinct from p_expected_transition_token',
  ], 'started-expiry-CAS');
  assert.match(
    normalizeSql(expiry),
    /set status = 'unknown', dispatch_state = 'started', dispatch_lease_expires_at = null, reconcile_required = true, sent_reconcile_required = true, error_text = 'de dispatchlease is verlopen; de provideruitkomst moet eerst worden gereconcilieerd\.', transition_token = p_next_transition_token, updated_at = db_now\.ts/
  );
  assert.doesNotMatch(expiry, /set\s+status\s*=\s*'failed'/i);
  assert.equal(literalCount(expiry, 'update public.softora_mailbox_send_provenance'), 1);
  assertContainsOnce(expiry, 'returning provenance.*', 'started-expiry atomisch readbackresultaat');
});

test('RPCs blijven invoker-only, schema-vast en uitsluitend uitvoerbaar door service_role', () => {
  assert.doesNotMatch(migration, /security\s+definer/i);

  for (const name of rpcNames) {
    const definition = functionDefinition(migration, name);
    assert.match(definition, /language sql\s+volatile\s+security invoker\s+set search_path = ''/i);

    const types = expectedPrivilegeTypes[name].join(', ');
    const revoke = normalizeSql(
      `revoke all on function public.${name}(${types}) from public, anon, authenticated, service_role;`
    );
    const grant = normalizeSql(
      `grant execute on function public.${name}(${types}) to service_role;`
    );
    const normalizedMigration = normalizeSql(migration);
    assertContainsOnce(normalizedMigration, revoke, `${name} gesloten execute-rechten`);
    assertContainsOnce(normalizedMigration, grant, `${name} service_role execute-recht`);
  }

  const grantTargets = [...migration.matchAll(
    /grant execute on function public\.[a-z0-9_]+\([\s\S]*?\)\s+to\s+([a-z0-9_]+);/gi
  )].map((match) => match[1].toLowerCase());
  assert.deepEqual(grantTargets, Array(5).fill('service_role'));
  assert.equal((migration.match(/^\s*grant\b/gim) || []).length, 5);
  assert.equal((migration.match(/revoke all on function public\./gi) || []).length, 5);

  const withoutQualifiedTable = migration.replaceAll(`public.${tableName}`, '');
  assert.doesNotMatch(
    withoutQualifiedTable,
    new RegExp(`\\b${tableName}\\b`),
    'iedere tabelreferentie moet public-gekwalificeerd blijven bij een lege search_path'
  );
});
