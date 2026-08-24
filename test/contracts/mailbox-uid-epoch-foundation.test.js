'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMailboxMessageKey,
  normalizeMailboxGenerationId,
  normalizeMailboxTargetReferences,
} = require('../../server/services/mailbox-uid-validity');
const {
  getMailboxSyncLeaseDeadlineAtMs,
  normalizeMailboxTargetUidManifest,
} = require('../../server/services/mailbox-sync-finalizer');
const {
  createMailboxLegacySyncFinalizer,
} = require('../../server/services/mailbox-sync-legacy-finalizer');
const {
  createMailboxSyncProtocolLockStore,
} = require('../../server/services/mailbox-sync-protocol-lock');
const {
  createMailboxUidGenerationIndex,
} = require('../../server/services/mailbox-uid-generation-index');

const GENERATION_A1 = '11111111-1111-4111-8111-111111111111';
const GENERATION_A2 = '22222222-2222-4222-8222-222222222222';

function createProtocolHarness(resolver) {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push([name, args]);
      return resolver(name, args);
    },
  };
  const store = createMailboxSyncProtocolLockStore({
    runDurableWrite: async (_label, operation) => {
      const response = await operation(client);
      return response?.error
        ? { ok: false, data: null, error: response.error }
        : { ok: true, data: response?.data, error: null };
    },
    buildSyncKey: (accountEmail, folder) =>
      `${String(accountEmail).trim().toLowerCase()}|${String(folder).trim().toLowerCase()}`,
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeFolder: (value) => String(value || '').trim().toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    createLockToken: () => 'lease-token',
  });
  return { calls, store };
}

function acquired(args) {
  return {
    data: [{
      acquired: true,
      locked: false,
      claimed_lock_token: args.p_lock_token,
      lock_expires_at: '2026-08-21T21:00:00.000Z',
    }],
    error: null,
  };
}

test('gelijke UIDVALIDITY-epochs blijven door UUID-generaties duurzaam verschillend', () => {
  const firstA = buildMailboxMessageKey({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    uid: 42,
    generationId: GENERATION_A1,
  });
  const secondA = buildMailboxMessageKey({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    uid: 42,
    generationId: GENERATION_A2,
  });

  assert.notEqual(firstA, secondA);
  assert.match(firstA, /gen:11111111-1111-4111-8111-111111111111/);
  assert.match(secondA, /gen:22222222-2222-4222-8222-222222222222/);
  assert.equal(normalizeMailboxGenerationId('niet-een-uuid'), '');
  assert.deepEqual(
    normalizeMailboxTargetReferences([' <B@Test.nl> ', 'a@test.nl', 'b@test.nl']),
    ['a@test.nl', 'b@test.nl']
  );
  assert.deepEqual(
    normalizeMailboxTargetReferences(['_target@test.nl', '-target@test.nl']),
    ['-target@test.nl', '_target@test.nl']
  );
  assert.deepEqual(
    normalizeMailboxTargetReferences(['x==v8@test.nl', 'x=6b@test.nl']),
    ['x=6b@test.nl', 'x==v8@test.nl']
  );
  assert.deepEqual(
    normalizeMailboxTargetReferences(['\u{10000}@test.nl', '\uE000@test.nl']),
    ['\uE000@test.nl', '\u{10000}@test.nl']
  );
});

test('legacy lockpayload blijft ongewijzigd en dual runtime claimt expliciet v2', async () => {
  const legacy = createProtocolHarness((_name, args) => acquired(args));
  const legacyResult = await legacy.store.acquireSyncLock({
    accountEmail: 'Serve@Softora.nl',
    folder: 'INBOX',
  });

  assert.equal(legacyResult.ok, true);
  assert.equal(Object.hasOwn(legacy.calls[0][1], 'p_protocol'), false);

  const dual = createProtocolHarness((name, args) => {
    if (name === 'softora_get_mailbox_uid_generation_protocol') {
      return {
        data: [{
          protocol: 'v2',
          protocol_changed_at: '2026-08-21T20:00:00.000Z',
          drain_started_at: '2026-08-21T19:55:00.000Z',
          drain_ready_at: '2026-08-21T19:58:00.000Z',
          drain_ready: false,
        }],
        error: null,
      };
    }
    return acquired(args);
  });
  const dualResult = await dual.store.acquireSyncLockForProtocol({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
  });

  assert.equal(dualResult.ok, true);
  assert.equal(dualResult.protocolMode, 'v2');
  assert.deepEqual(dual.calls.map(([name]) => name), [
    'softora_get_mailbox_uid_generation_protocol',
    'softora_claim_mailbox_sync_lock',
  ]);
  assert.equal(dual.calls[1][1].p_protocol, 'v2');
});

test('finalizer houdt commit binnen lease en accepteert alleen oplopende UID-manifests', () => {
  assert.deepEqual(normalizeMailboxTargetUidManifest([1, 4, 9]), [1, 4, 9]);
  assert.equal(normalizeMailboxTargetUidManifest([1, 1]), null);
  assert.equal(normalizeMailboxTargetUidManifest([2, 1]), null);
  assert.equal(getMailboxSyncLeaseDeadlineAtMs({
    requestDeadlineAtMs: Date.parse('2026-08-21T20:59:55.000Z'),
    leaseExpiresAt: '2026-08-21T21:00:00.000Z',
    reserveMs: 10_000,
    nowMs: Date.parse('2026-08-21T20:59:00.000Z'),
  }), Date.parse('2026-08-21T20:59:50.000Z'));
});

test('legacy finalizer maakt uitsluitend de eigen actieve lease vrij', async () => {
  const observed = { patch: null, filters: [] };
  const query = {
    update(patch) {
      observed.patch = patch;
      return this;
    },
    eq(column, value) {
      observed.filters.push([column, value]);
      return this;
    },
  };
  const finishSync = createMailboxLegacySyncFinalizer({
    runDurableWrite: async (_label, operation) => operation({
      from: () => query,
    }),
    buildSyncKey: (accountEmail, folder) => `${accountEmail}|${folder}`,
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, limit) => value.slice(0, limit),
    isoNow: () => '2026-08-21T21:00:00.000Z',
  });

  await finishSync({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    lockToken: 'own-lease',
    messageCount: 3,
    lastUid: 7,
  });

  assert.equal(observed.patch.status, 'ok');
  assert.equal(observed.patch.lock_token, null);
  assert.deepEqual(observed.filters, [
    ['sync_key', 'serve@softora.nl|inbox'],
    ['lock_token', 'own-lease'],
  ]);
});

test('generation-index verwijdert database-identiteit en dedupliceert vóór commit', () => {
  const index = createMailboxUidGenerationIndex({
    runDurableWrite: async () => ({ ok: true, data: [] }),
    buildSyncKey: (accountEmail, folder) => `${accountEmail}|${folder}`,
    buildMessageRow: (message, accountEmail, folder, _index, options) => ({
      message_key: `${accountEmail}|${folder}|${message.uid}`,
      account_email: accountEmail,
      folder,
      uid: message.uid,
      uid_validity: options.uidValidity,
      uid_generation_id: options.generationId,
      subject: message.subject,
    }),
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeFolder: (value) => String(value || '').trim().toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    now: () => new Date('2026-08-21T21:00:00.000Z'),
    messagesTable: 'softora_mailbox_messages',
  });

  const rows = index.buildSyncCommitRows({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    messages: [
      { uid: 2, subject: 'twee' },
      { uid: 1, subject: 'een' },
      { uid: 1, subject: 'duplicaat' },
    ],
    uidValidity: 700,
    generationId: GENERATION_A1,
  });

  assert.deepEqual(rows.map((row) => row.uid), [1, 2]);
  assert.equal(Object.hasOwn(rows[0], 'message_key'), false);
  assert.equal(Object.hasOwn(rows[0], 'uid_generation_id'), false);
});
