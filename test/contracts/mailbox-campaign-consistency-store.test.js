const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAILBOX_CAMPAIGN_CONSISTENCY_RPCS,
  createMailboxCampaignConsistencyStore,
} = require('../../server/repositories/mailbox-campaign-consistency-store');

const PROPOSED_MUTATION_ID = '5fd5ea53-8fbd-4dba-ae1b-53fd36cc9385';
const STORED_MUTATION_ID = '857a2b8c-5118-4ccd-84e7-1dfc8b33f4e3';

function createRpcClient(respond) {
  const calls = [];
  return {
    calls,
    client: {
      async rpc(name, args) {
        calls.push({ name, args });
        return respond(name, args, calls.length);
      },
    },
  };
}

function createStore(client, overrides = {}) {
  return createMailboxCampaignConsistencyStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    randomUUID: () => PROPOSED_MUTATION_ID,
    logger: { error() {} },
    ...overrides,
  });
}

test('beginMutation gebruikt alleen de service-role RPC en behoudt bigint-versies exact', async () => {
  const { client, calls } = createRpcClient(() => ({
    data: [{
      mutation_id: STORED_MUTATION_ID,
      request_key: 'sync:serve:inbox:42',
      mutation_status: 'pending',
      started_content_version: '9007199254740993',
      completed_content_version: null,
      current_content_version: '9007199254740993',
      lease_expires_at: '2026-08-09T21:35:00.000Z',
      replayed: true,
    }],
    error: null,
  }));
  const store = createStore(client);

  const mutation = await store.beginMutation({
    requestKey: 'sync:serve:inbox:42',
    kind: ' IMAP-SYNC ',
    accountEmail: ' Serve@Softora.nl ',
    folder: ' Inbox ',
    leaseSeconds: 9999,
  });

  assert.deepEqual(calls, [{
    name: MAILBOX_CAMPAIGN_CONSISTENCY_RPCS.beginMutation,
    args: {
      p_mutation_id: PROPOSED_MUTATION_ID,
      p_request_key: 'sync:serve:inbox:42',
      p_mutation_kind: 'imap-sync',
      p_account_email: 'serve@softora.nl',
      p_folder: 'inbox',
      p_lease_seconds: 900,
    },
  }]);
  assert.equal(mutation.mutationId, STORED_MUTATION_ID);
  assert.equal(mutation.replayed, true);
  assert.equal(mutation.startedContentVersion, '9007199254740993');
  assert.equal(mutation.contentVersion, '9007199254740993');
  assert.equal(mutation.completedContentVersion, null);
});

test('completeMutation is retry-veilig en stuurt een begrensd JSON-resultaat', async () => {
  const { client, calls } = createRpcClient(() => ({
    data: [{
      mutation_id: STORED_MUTATION_ID,
      mutation_status: 'completed',
      started_content_version: '7',
      completed_content_version: '8',
      current_content_version: '8',
      replayed: true,
    }],
    error: null,
  }));
  const store = createStore(client);

  const mutation = await store.completeMutation({
    mutationId: STORED_MUTATION_ID,
    requestKey: 'sync:serve:inbox:42',
    result: { written: 3 },
  });

  assert.deepEqual(calls[0], {
    name: MAILBOX_CAMPAIGN_CONSISTENCY_RPCS.completeMutation,
    args: {
      p_mutation_id: STORED_MUTATION_ID,
      p_request_key: 'sync:serve:inbox:42',
      p_result: { written: 3 },
    },
  });
  assert.equal(mutation.status, 'completed');
  assert.equal(mutation.completedContentVersion, '8');
  assert.equal(mutation.replayed, true);
});

test('getFence rapporteert pending en atomair gereapte mutaties zonder ready te vervalsen', async () => {
  const { client, calls } = createRpcClient(() => ({
    data: [{
      content_version: '91',
      pending_count: '2',
      ready: false,
      reaped_count: '1',
      checked_at: '2026-08-09T21:40:00.000Z',
    }],
    error: null,
  }));
  const store = createStore(client);

  const fence = await store.getFence();

  assert.deepEqual(calls[0], {
    name: MAILBOX_CAMPAIGN_CONSISTENCY_RPCS.getFence,
    args: { p_reap_expired: true },
  });
  assert.deepEqual(fence, {
    contentVersion: '91',
    pendingCount: 2,
    ready: false,
    reapedCount: 1,
    checkedAt: '2026-08-09T21:40:00.000Z',
  });
});

test('getFence weigert een tegenstrijdige database-response fail-closed', async () => {
  const { client } = createRpcClient(() => ({
    data: [{
      content_version: '3',
      pending_count: '1',
      ready: true,
      reaped_count: '0',
      checked_at: '2026-08-09T21:40:00.000Z',
    }],
    error: null,
  }));
  const store = createStore(client);

  await assert.rejects(() => store.getFence(), {
    code: 'MAILBOX_CAMPAIGN_CONSISTENCY_RESPONSE_INVALID',
  });
});

test('de store faalt zonder durable Supabase-client en heeft geen memory-fallback', async () => {
  const store = createMailboxCampaignConsistencyStore({
    isSupabaseConfigured: () => false,
  });

  await assert.rejects(() => store.getFence(), {
    code: 'MAILBOX_CAMPAIGN_CONSISTENCY_UNAVAILABLE',
  });
});

test('RPC-fouten en onveilige numeric bigint-responses worden niet stil geaccepteerd', async () => {
  const logged = [];
  const failed = createRpcClient(() => ({ data: null, error: { code: '57014', message: 'timeout' } }));
  const failedStore = createStore(failed.client, {
    logger: { error(...args) { logged.push(args); } },
  });

  await assert.rejects(() => failedStore.getFence(), {
    code: 'MAILBOX_CAMPAIGN_CONSISTENCY_RPC_FAILED',
  });
  assert.equal(logged.length, 1);

  const unsafe = createRpcClient(() => ({
    data: [{
      content_version: Number.MAX_SAFE_INTEGER + 1,
      pending_count: 0,
      ready: true,
      reaped_count: 0,
      checked_at: '2026-08-09T21:40:00.000Z',
    }],
    error: null,
  }));
  await assert.rejects(() => createStore(unsafe.client).getFence(), {
    code: 'MAILBOX_CAMPAIGN_CONSISTENCY_RESPONSE_INVALID',
  });
});

test('RPC-cardinaliteit, identity en versie-invarianten falen gesloten', async () => {
  const duplicateRows = createRpcClient(() => ({
    data: [{ content_version: '1' }, { content_version: '1' }],
    error: null,
  }));
  await assert.rejects(() => createStore(duplicateRows.client).getFence(), {
    code: 'MAILBOX_CAMPAIGN_CONSISTENCY_RESPONSE_INVALID',
  });

  const wrongIdentity = createRpcClient(() => ({
    data: [{
      mutation_id: PROPOSED_MUTATION_ID,
      request_key: 'andere:key',
      mutation_status: 'pending',
      started_content_version: '8',
      completed_content_version: null,
      current_content_version: '8',
      lease_expires_at: '2026-08-09T21:35:00.000Z',
      replayed: false,
    }],
    error: null,
  }));
  await assert.rejects(() => createStore(wrongIdentity.client).beginMutation({
    requestKey: 'verwachte:key',
    kind: 'imap-sync',
  }), {
    code: 'MAILBOX_CAMPAIGN_CONSISTENCY_RESPONSE_INVALID',
  });

  const contradictoryStatus = createRpcClient(() => ({
    data: [{
      mutation_id: STORED_MUTATION_ID,
      mutation_status: 'completed',
      started_content_version: '8',
      completed_content_version: null,
      current_content_version: '8',
      replayed: true,
    }],
    error: null,
  }));
  await assert.rejects(() => createStore(contradictoryStatus.client).completeMutation({
    mutationId: STORED_MUTATION_ID,
    requestKey: 'sync:serve:inbox:42',
  }), {
    code: 'MAILBOX_CAMPAIGN_CONSISTENCY_RESPONSE_INVALID',
  });
});

test('ongeldige idempotency-input bereikt de database niet', async () => {
  const { client, calls } = createRpcClient(() => ({ data: [], error: null }));
  const store = createStore(client);

  await assert.rejects(() => store.beginMutation({ requestKey: '', kind: 'imap-sync' }), {
    code: 'MAILBOX_CAMPAIGN_CONSISTENCY_INVALID',
  });
  assert.equal(calls.length, 0);
});
