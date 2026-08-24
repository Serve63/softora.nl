'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMailboxMessageKey,
  createMailboxUidValidityStore,
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

function createUidValidityHarness(resolver) {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push([name, args]);
      return resolver(name, args);
    },
  };
  const store = createMailboxUidValidityStore({
    runDurableWrite: async (label, operation, options) => {
      const response = await operation(client);
      return response?.error
        ? { ok: false, data: null, error: response.error, label, options }
        : { ok: true, data: response?.data, error: null, label, options };
    },
    buildSyncKey: (accountEmail, folder) =>
      `${String(accountEmail).trim().toLowerCase()}|${String(folder).trim().toLowerCase()}`,
    normalizeString: (value) => String(value || '').trim(),
  });
  return { calls, store };
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

test('targeted prepare accepteert alleen een manifest waarvan compleet exact met de UID-cursor klopt', async () => {
  const base = {
    prepared: true,
    lock_lost: false,
    mode: 'rebuild',
    reset_detected: true,
    resumed: true,
    active_generation_id: GENERATION_A1,
    target_generation_id: GENERATION_A2,
    current_uid_validity: 700,
    observed_uid_validity: 701,
    scan_upper_uid: 100,
    scanned_through_uid: 0,
    lease_expires_at: '2026-08-21T21:00:00.000Z',
    selection_targets: ['target@test.nl'],
    selection_manifest_scanned_through_uid: 50,
    target_uid_manifest: [4, 49],
    target_manifest_complete: false,
  };
  let response = base;
  const { store } = createUidValidityHarness(() => ({ data: [response], error: null }));
  const input = {
    accountEmail: 'serve@softora.nl',
    folder: 'allmail',
    lockToken: 'targeted-lease',
    uidValidity: 701,
    uidNext: 101,
    selectionPolicy: 'targeted-sparse-v2',
    selectionTargets: ['target@test.nl'],
  };

  const partial = await store.prepareUidGeneration(input);
  assert.equal(partial.ok, true);
  assert.equal(partial.targetManifestScannedThroughUid, 50);
  assert.deepEqual(partial.targetUidManifest, [4, 49]);
  assert.equal(partial.targetManifestComplete, false);

  response = {
    ...base,
    selection_manifest_scanned_through_uid: 100,
    target_manifest_complete: false,
  };
  const falseAtUpper = await store.prepareUidGeneration(input);
  assert.equal(falseAtUpper.ok, false);
  assert.equal(falseAtUpper.error.code, 'MAILBOX_UID_GENERATION_PROTOCOL_INVALID');

  response = {
    ...base,
    selection_manifest_scanned_through_uid: 50,
    target_manifest_complete: true,
  };
  const trueBeforeUpper = await store.prepareUidGeneration(input);
  assert.equal(trueBeforeUpper.ok, false);
  assert.equal(trueBeforeUpper.error.code, 'MAILBOX_UID_GENERATION_PROTOCOL_INVALID');

  response = {
    ...base,
    mode: 'steady',
    active_generation_id: GENERATION_A2,
  };
  const incompleteSteady = await store.prepareUidGeneration(input);
  assert.equal(incompleteSteady.ok, false);
  assert.equal(incompleteSteady.error.code, 'MAILBOX_UID_GENERATION_PROTOCOL_INVALID');

  response = {
    ...base,
    selection_manifest_scanned_through_uid: 100,
    target_uid_manifest: [4, 49, 100],
    target_manifest_complete: true,
  };
  const complete = await store.prepareUidGeneration(input);
  assert.equal(complete.ok, true);
  assert.equal(complete.targetManifestComplete, true);
  assert.deepEqual(complete.targetUidManifest, [4, 49, 100]);

  response = {
    ...base,
    selection_targets: [],
    selection_manifest_scanned_through_uid: 0,
    target_uid_manifest: [],
    target_manifest_complete: false,
  };
  const emptyPending = await store.prepareUidGeneration({
    ...input,
    selectionTargets: [],
  });
  assert.equal(emptyPending.ok, true);
  assert.deepEqual(emptyPending.selectionTargets, []);
  assert.deepEqual(emptyPending.targetUidManifest, []);

  const emptyPendingAfterTargetDrift = await store.prepareUidGeneration({
    ...input,
    selectionTargets: ['new-current-target@test.nl'],
  });
  assert.equal(emptyPendingAfterTargetDrift.ok, true);
  assert.deepEqual(emptyPendingAfterTargetDrift.selectionTargets, []);

  for (const malformedTargets of [
    null,
    {},
    ['Target@Test.NL'],
    ['target@test.nl', 'target@test.nl'],
    ['z@test.nl', 'a@test.nl'],
  ]) {
    response = { ...base, selection_targets: malformedTargets };
    const rejectedTargets = await store.prepareUidGeneration(input);
    assert.equal(rejectedTargets.ok, false);
    assert.equal(rejectedTargets.error.code, 'MAILBOX_UID_GENERATION_PROTOCOL_INVALID');
  }

  response = {
    ...base,
    selection_targets: [],
    mode: 'steady',
    active_generation_id: GENERATION_A2,
    selection_manifest_scanned_through_uid: 100,
    target_manifest_complete: true,
  };
  const emptySteady = await store.prepareUidGeneration({
    ...input,
    selectionTargets: [],
  });
  assert.equal(emptySteady.ok, true);
  assert.equal(emptySteady.targetManifestComplete, true);

  for (const malformed of [
    { selection_manifest_scanned_through_uid: -1, target_manifest_complete: false },
    { selection_manifest_scanned_through_uid: null, target_manifest_complete: false },
    { selection_manifest_scanned_through_uid: '', target_manifest_complete: false },
    { selection_manifest_scanned_through_uid: false, target_manifest_complete: false },
    { selection_manifest_scanned_through_uid: 50, target_manifest_complete: 'false' },
  ]) {
    response = { ...base, ...malformed };
    const rejected = await store.prepareUidGeneration(input);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, 'MAILBOX_UID_GENERATION_PROTOCOL_INVALID');
  }
});

test('targetmanifest-checkpoint weigert vervormde deltas vóór RPC en bewaart het exacte RPC-contract', async () => {
  const checkpointId = '33333333-3333-4333-8333-333333333333';
  const { calls, store } = createUidValidityHarness((_name, args) => ({
    data: [{
      checkpointed: true,
      lock_lost: false,
      replayed: false,
      scanned_through_uid: args.p_scanned_through_uid,
      target_uid_manifest: [11, 19],
      scan_complete: args.p_scan_complete,
      lock_released: !args.p_scan_complete,
    }],
    error: null,
  }));
  const input = {
    accountEmail: 'Serve@Softora.nl',
    folder: 'AllMail',
    lockToken: 'checkpoint-lease',
    checkpointId,
    generationId: GENERATION_A2,
    uidValidity: 701,
    expectedScannedThroughUid: 10,
    scannedThroughUid: 20,
    foundUids: [11, 19],
    scanComplete: false,
    deadlineAtMs: 123456,
  };

  const checkpointed = await store.checkpointTargetUidManifest(input);
  assert.deepEqual(checkpointed, {
    ok: true,
    checkpointed: true,
    lockLost: false,
    replayed: false,
    targetManifestScannedThroughUid: 20,
    targetUidManifest: [11, 19],
    targetManifestComplete: false,
    lockReleased: true,
  });
  assert.deepEqual(calls, [[
    'softora_checkpoint_mailbox_uid_target_manifest_v2',
    {
      p_sync_key: 'serve@softora.nl|allmail',
      p_lock_token: 'checkpoint-lease',
      p_checkpoint_id: checkpointId,
      p_generation_id: GENERATION_A2,
      p_uid_validity: 701,
      p_expected_scanned_through_uid: 10,
      p_scanned_through_uid: 20,
      p_found_uids: [11, 19],
      p_scan_complete: false,
    },
  ]]);

  for (const invalid of [
    { foundUids: [19, 11] },
    { foundUids: [11, 11] },
    { foundUids: [10] },
    { foundUids: [21] },
    { scanComplete: 'false' },
    { expectedScannedThroughUid: '' },
    { scannedThroughUid: false },
    { scannedThroughUid: 10, foundUids: [], scanComplete: false },
  ]) {
    const rejected = await store.checkpointTargetUidManifest({ ...input, ...invalid });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.checkpointed, false);
    assert.equal(rejected.error.code, 'MAILBOX_UID_TARGET_MANIFEST_CHECKPOINT_INVALID');
  }
  assert.equal(calls.length, 1);

  for (const malformed of [
    { replayed: undefined },
    { scan_complete: undefined },
    { lock_released: undefined },
    { scanned_through_uid: null },
    { scanned_through_uid: '' },
  ]) {
    const malformedHarness = createUidValidityHarness(() => ({
      data: [{
        checkpointed: true,
        lock_lost: false,
        replayed: false,
        scanned_through_uid: 20,
        target_uid_manifest: [11, 19],
        scan_complete: false,
        lock_released: true,
        ...malformed,
      }],
      error: null,
    }));
    const rejected = await malformedHarness.store.checkpointTargetUidManifest(input);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, 'MAILBOX_UID_GENERATION_PROTOCOL_INVALID');
  }
});

test('targetmanifest-invalidatie valideert expungebewijs en bewaart het exacte RPC-contract', async () => {
  const invalidationId = '44444444-4444-4444-8444-444444444444';
  let response = {
    invalidated: true,
    lock_lost: false,
    replayed: false,
    generation_role: 'pending',
    pending_abandoned: true,
    active_manifest_invalidated: true,
    lock_released: true,
  };
  const { calls, store } = createUidValidityHarness(() => ({
    data: [response],
    error: null,
  }));
  const input = {
    accountEmail: 'Serve@Softora.nl',
    folder: 'AllMail',
    lockToken: 'invalidate-lease',
    invalidationId,
    generationId: GENERATION_A2,
    uidValidity: 701,
    expectedStagedCount: 2,
    missingUids: [11, 19],
    deadlineAtMs: 123456,
  };

  assert.deepEqual(await store.invalidateTargetUidManifest(input), {
    ok: true,
    invalidated: true,
    lockLost: false,
    replayed: false,
    generationRole: 'pending',
    pendingAbandoned: true,
    activeManifestInvalidated: true,
    lockReleased: true,
  });
  assert.deepEqual(calls, [[
    'softora_invalidate_mailbox_uid_target_manifest_v2',
    {
      p_sync_key: 'serve@softora.nl|allmail',
      p_lock_token: 'invalidate-lease',
      p_invalidation_id: invalidationId,
      p_generation_id: GENERATION_A2,
      p_uid_validity: 701,
      p_expected_staged_count: 2,
      p_missing_uids: [11, 19],
    },
  ]]);

  for (const invalid of [
    { missingUids: [] },
    { missingUids: [19, 11] },
    { missingUids: [11, 11] },
    { missingUids: [0] },
    { expectedStagedCount: -1 },
    { expectedStagedCount: '' },
    { invalidationId: 'geen-uuid' },
  ]) {
    const rejected = await store.invalidateTargetUidManifest({ ...input, ...invalid });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.invalidated, false);
    assert.equal(
      rejected.error.code,
      'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_INVALID'
    );
  }
  assert.equal(calls.length, 1);

  for (const malformed of [
    { replayed: undefined },
    { generation_role: 'unknown' },
    { pending_abandoned: false },
    { active_manifest_invalidated: 'true' },
    { lock_released: false },
  ]) {
    response = {
      invalidated: true,
      lock_lost: false,
      replayed: false,
      generation_role: 'pending',
      pending_abandoned: true,
      active_manifest_invalidated: true,
      lock_released: true,
      ...malformed,
    };
    const rejected = await store.invalidateTargetUidManifest(input);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, 'MAILBOX_UID_GENERATION_PROTOCOL_INVALID');
  }

  response = {
    invalidated: true,
    lock_lost: false,
    replayed: true,
    generation_role: 'active',
    pending_abandoned: false,
    active_manifest_invalidated: true,
    lock_released: true,
  };
  const active = await store.invalidateTargetUidManifest({
    ...input,
    expectedStagedCount: 0,
  });
  assert.equal(active.ok, true);
  assert.equal(active.generationRole, 'active');
  assert.equal(active.pendingAbandoned, false);
  assert.equal(active.replayed, true);
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
