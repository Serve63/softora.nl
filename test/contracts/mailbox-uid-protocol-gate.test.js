const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createMailboxSyncProtocolLockStore,
} = require('../../server/services/mailbox-sync-protocol-lock');

const migration = fs.readFileSync(path.resolve(
  __dirname,
  '../../supabase/migrations/20260821174321_mailbox_uid_generation_protocol_gate.sql'
), 'utf8');
const postgresTest = fs.readFileSync(path.resolve(
  __dirname,
  '../postgres/mailbox-uid-protocol-gate.postgres.test.js'
), 'utf8');
const postgresRunner = fs.readFileSync(path.resolve(
  __dirname,
  '../postgres/run-mailbox-uid-protocol-gate.js'
), 'utf8');
const schema = fs.readFileSync(path.resolve(
  __dirname,
  '../../supabase/data-ops-schema.sql'
), 'utf8');

function createLockHarness(resolver) {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push([name, args]);
      return resolver(name, args, calls.length);
    },
  };
  const runDurableWrite = async (_label, operation) => {
    try {
      const response = await operation(client);
      if (response?.error) return { ok: false, data: null, error: response.error };
      return { ok: true, data: response?.data, error: null };
    } catch (error) {
      return { ok: false, data: null, error };
    }
  };
  const store = createMailboxSyncProtocolLockStore({
    runDurableWrite,
    buildSyncKey: (accountEmail, folder) =>
      `${String(accountEmail || '').trim().toLowerCase()}|${String(folder || '').trim().toLowerCase()}`,
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeFolder: (value) => String(value || '').trim().toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    createLockToken: () => 'deterministic-lock-token',
  });
  return { calls, store };
}

function acquired(args) {
  return {
    data: [{
      acquired: true,
      locked: false,
      claimed_lock_token: args.p_lock_token,
      lock_expires_at: '2026-08-21T20:05:00.000Z',
    }],
    error: null,
  };
}

test('data-ops bootstrap spiegelt alleen de legacy-compatibele protocolgate byte-exact', () => {
  const startMarker = '-- mailbox-uid-generation-protocol-gate:start';
  const endMarker = '-- mailbox-uid-generation-protocol-gate:end';
  const start = schema.indexOf(startMarker);
  const end = schema.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start);
  assert.equal(schema.slice(start), migration);
  assert.match(migration, /notify pgrst, 'reload schema';/);
  assert.doesNotMatch(schema, /mailbox-uid-generation-bootstrap-(?:sentinel|drain)/);
  assert.doesNotMatch(schema, /mailbox-uid-generation-epoch-v2/);
  assert.doesNotMatch(schema.slice(start), /set uid_generation_protocol = 'v2'/);
});

test('gate is forward-only, scoped and keeps a three-minute drain floor', () => {
  assert.match(migration, /uid_generation_protocol = any \(array\['legacy', 'draining', 'v2'\]/);
  assert.match(
    migration,
    /old\.uid_generation_protocol = 'legacy' and new\.uid_generation_protocol = 'draining'[\s\S]*old\.uid_generation_protocol = 'draining' and new\.uid_generation_protocol = 'v2'/
  );
  assert.doesNotMatch(migration, /old\.uid_generation_protocol = 'v2' and new\.uid_generation_protocol/);
  assert.match(migration, /p_drain_seconds, 0\) not between 180 and 900/);
  assert.doesNotMatch(migration, /softora_activate_mailbox_uid_generation_v2/i);
  assert.doesNotMatch(migration, /softora_mailbox_messages|allmail|instantly/i);
  assert.doesNotMatch(migration, /security definer/i);
});

test('old and dual callers share advisory-protocol-sync lock order without an overload', () => {
  assert.match(
    migration,
    /drop function public\.softora_claim_mailbox_sync_lock\([\s\S]*integer, boolean[\s\S]*create function public\.softora_claim_mailbox_sync_lock\(/
  );
  assert.match(migration, /p_protocol text default 'legacy'/);
  assert.match(
    migration,
    /pg_advisory_xact_lock\(824031, 3\)[\s\S]*softora_mailbox_campaign_consistency[\s\S]*for update;[\s\S]*softora_mailbox_sync_state[\s\S]*for update;/
  );
  assert.match(
    migration,
    /uid_generation_protocol = 'draining'[\s\S]*uid_generation_protocol is distinct from v_protocol[\s\S]*return query select false, true, null::text/
  );
  assert.equal(
    (migration.match(/create function public\.softora_claim_mailbox_sync_lock\(/g) || []).length,
    1
  );
});

test('gate RPCs are security-invoker and service-role only', () => {
  [
    'softora_get_mailbox_uid_generation_protocol()',
    'softora_begin_mailbox_uid_generation_v2_drain(integer)',
    'softora_claim_mailbox_sync_lock(\n  text, text, text, text, integer, boolean, text\n)',
  ].forEach((signature) => {
    assert.ok(migration.includes(`grant execute on function public.${signature}`), `${signature} mist grant`);
  });
  assert.match(
    migration,
    /revoke all on function public\.softora_guard_mailbox_uid_generation_protocol\(\)[\s\S]*from public, anon, authenticated, service_role/
  );
});

test('legacy adapter keeps the old RPC payload byte-for-byte protocol-free', async () => {
  const { calls, store } = createLockHarness((_name, args) => acquired(args));
  const result = await store.acquireSyncLock({
    accountEmail: 'Serve@Softora.nl',
    folder: 'INBOX',
    lockTtlMs: 90_000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.protocolMode, 'legacy');
  assert.deepEqual(calls, [[
    'softora_claim_mailbox_sync_lock',
    {
      p_sync_key: 'serve@softora.nl|inbox',
      p_account_email: 'serve@softora.nl',
      p_folder: 'inbox',
      p_lock_token: 'deterministic-lock-token',
      p_lock_ttl_seconds: 90,
      p_force: false,
    },
  ]]);
});

for (const protocol of ['legacy', 'v2']) {
  test(`dual adapter claims only the database-reported ${protocol} protocol`, async () => {
    const { calls, store } = createLockHarness((name, args) => {
      if (name === 'softora_get_mailbox_uid_generation_protocol') {
        return {
          data: [{
            protocol,
            protocol_changed_at: '2026-08-21T19:00:00.000Z',
            drain_started_at: protocol === 'v2' ? '2026-08-21T18:55:00.000Z' : null,
            drain_ready_at: protocol === 'v2' ? '2026-08-21T18:58:00.000Z' : null,
            drain_ready: false,
          }],
          error: null,
        };
      }
      return acquired(args);
    });
    const result = await store.acquireSyncLockForProtocol({
      accountEmail: 'serve@softora.nl',
      folder: 'inbox',
    });

    assert.equal(result.ok, true);
    assert.equal(result.protocolMode, protocol);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], ['softora_get_mailbox_uid_generation_protocol', {}]);
    assert.equal(calls[1][1].p_protocol, protocol);
  });
}

test('draining coalesces before any lease claim', async () => {
  const { calls, store } = createLockHarness(() => ({
    data: [{
      protocol: 'draining',
      protocol_changed_at: '2026-08-21T19:00:00.000Z',
      drain_started_at: '2026-08-21T19:00:00.000Z',
      drain_ready_at: '2026-08-21T19:03:00.000Z',
      drain_ready: false,
    }],
    error: null,
  }));
  const result = await store.acquireSyncLockForProtocol({
    accountEmail: 'serve@softora.nl', folder: 'inbox',
  });

  assert.equal(result.ok, false);
  assert.equal(result.locked, true);
  assert.equal(result.contention, 'active_lock');
  assert.equal(result.protocolMode, 'draining');
  assert.equal(calls.length, 1);
});

test('unknown protocol and protocol-read failure never fall back to legacy', async () => {
  const invalid = createLockHarness(() => ({
    data: [{ protocol: 'future-v3' }], error: null,
  }));
  const invalidResult = await invalid.store.acquireSyncLockForProtocol({
    accountEmail: 'serve@softora.nl', folder: 'inbox',
  });
  assert.equal(invalidResult.ok, false);
  assert.equal(invalidResult.error.code, 'MAILBOX_UID_PROTOCOL_INVALID');
  assert.equal(invalid.calls.length, 1);

  const unavailable = createLockHarness(() => ({
    data: null, error: new Error('schema cache unavailable'),
  }));
  const unavailableResult = await unavailable.store.acquireSyncLockForProtocol({
    accountEmail: 'serve@softora.nl', folder: 'inbox',
  });
  assert.equal(unavailableResult.ok, false);
  assert.match(unavailableResult.error.message, /schema cache unavailable/);
  assert.equal(unavailable.calls.length, 1);
});

test('dedicated PostgreSQL runner is local-only, disposable and covers both caller generations', () => {
  assert.match(postgresRunner, /MAILBOX_POSTGRES_ADMIN_URL/);
  assert.match(postgresRunner, /localHosts/);
  assert.match(postgresRunner, /create database/);
  assert.match(postgresRunner, /drop database if exists/);
  assert.match(postgresTest, /oude zes-argumentencaller/);
  assert.match(postgresTest, /dual v2-caller/);
  assert.match(postgresTest, /legacy -> draining -> v2/);
});
