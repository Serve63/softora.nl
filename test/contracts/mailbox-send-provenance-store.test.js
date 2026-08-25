const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMailboxSendProvenanceStore,
} = require('../../server/services/mailbox-send-provenance-store');
const { createSupabaseStateStore } = require('../../server/services/supabase-state');

function createFakeSupabase(options = {}) {
  const rows = [];
  const client = {
    rows,
    insertCalls: 0,
    readCalls: 0,
    updateCalls: 0,
    from() {
      const state = { action: 'select', filters: [], patch: null, inserted: null };
      const matching = () => rows.filter((row) => state.filters.every(([key, value, kind]) => (
        kind === 'in' ? value.includes(row[key]) : row[key] === value
      )));
      const query = {
        select() { return query; },
        insert(row) { state.action = 'insert'; state.inserted = { ...row }; return query; },
        update(patch) { state.action = 'update'; state.patch = { ...patch }; return query; },
        eq(key, value) { state.filters.push([key, value, 'eq']); return query; },
        in(key, value) { state.filters.push([key, value, 'in']); return query; },
        is(key, value) { state.filters.push([key, value, 'eq']); return query; },
        order() { return query; },
        limit(limit) {
          return Promise.resolve({ data: matching().slice(0, limit), error: null });
        },
        async single() {
          if (state.action === 'insert') {
            const requiredKeys = ['send_identity_key', 'send_scope_key', 'payload_fingerprint'];
            if (requiredKeys.some((key) => !String(state.inserted[key] || '').trim())) {
              return { data: null, error: { code: '23502', message: 'null identity key' } };
            }
            const active = (row) => ['prepared', 'unknown', 'accepted'].includes(row.status);
            if (rows.some((row) => row.idempotency_key === state.inserted.idempotency_key
              || (active(row) && row.send_identity_key === state.inserted.send_identity_key)
              || (state.inserted.mode === 'new-message' && ['prepared', 'unknown'].includes(row.status)
                && row.send_scope_key === state.inserted.send_scope_key))) {
              return { data: null, error: { code: '23505', message: 'duplicate key' } };
            }
            const row = {
              created_at: '2026-08-05T20:00:00.000Z',
              updated_at: '2026-08-05T20:00:00.000Z',
              ...state.inserted,
            };
            client.insertCalls += 1;
            const outcome = typeof options.onInsert === 'function'
              ? await options.onInsert({
                  call: client.insertCalls,
                  row: { ...row },
                })
              : null;
            if (!outcome || outcome.commit !== false) rows.push(row);
            if (outcome?.error) return { data: null, error: outcome.error };
            return { data: row, error: null };
          }
          if (state.action === 'update') {
            const row = matching()[0];
            if (!row) return { data: null, error: { code: 'PGRST116', message: 'missing' } };
            client.updateCalls += 1;
            const outcome = typeof options.onUpdate === 'function'
              ? await options.onUpdate({
                  call: client.updateCalls,
                  patch: { ...state.patch },
                  row: { ...row },
                })
              : null;
            if (outcome?.concurrentPatch) Object.assign(row, outcome.concurrentPatch);
            if (!outcome || outcome.commit !== false) Object.assign(row, state.patch);
            if (outcome?.error) return { data: null, error: outcome.error };
            return { data: row, error: null };
          }
          return { data: matching()[0] || null, error: null };
        },
        async maybeSingle() {
          client.readCalls += 1;
          const outcome = typeof options.onMaybeSingle === 'function'
            ? await options.onMaybeSingle({
                call: client.readCalls,
                rows: matching().map((row) => ({ ...row })),
              })
            : null;
          if (outcome?.error) return { data: null, error: outcome.error };
          if (Object.prototype.hasOwnProperty.call(outcome || {}, 'data')) {
            return { data: outcome.data, error: null };
          }
          return { data: matching()[0] || null, error: null };
        },
      };
      return query;
    },
  };
  return client;
}

test('mailbox send provenance survives acceptance and prevents an idempotent resend', async () => {
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-08-05T20:00:00.000Z'),
    logger: { error() {} },
  });
  const payload = {
    intentId: 'send:blue',
    idempotencyKey: 'blue-key',
    owner: 'martijn',
    accountEmail: 'contact.venvisuals@gmail.com',
    recipientEmail: 'info@blue-monkey.nl',
    mode: 'reply',
    conversationId: 'conversation:blue',
    replyTargetMessageId: '<blue-inbound@example.nl>',
    references: '<blue-original@example.nl> <blue-inbound@example.nl>',
    provider: 'smtp',
    messageId: '<planned@example.nl>',
    senderName: 'Martijn van de Ven',
    subject: 'Re: Kleine vraag over jullie website',
    body: 'Dankjewel voor je reactie.',
  };

  const first = await store.reserve(payload);
  assert.equal(first.created, true);
  assert.match(client.rows[0].send_identity_key, /^smtp-reply:[0-9a-f]{64}$/);
  assert.match(client.rows[0].send_scope_key, /^smtp-reply-scope:[0-9a-f]{64}$/);
  assert.match(client.rows[0].payload_fingerprint, /^[0-9a-f]{64}$/);
  await store.accept(payload.intentId, {
    messageId: '<accepted@example.nl>',
    acceptedAt: '2026-08-05T20:01:00.000Z',
  });
  const repeated = await store.reserve(payload);
  assert.equal(repeated.created, false);
  assert.equal(repeated.intent.status, 'accepted');
  assert.equal(repeated.intent.messageId, '<accepted@example.nl>');
  const accepted = await store.listAcceptedMessages({
    accountEmails: ['contact.venvisuals@gmail.com'],
  });
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].conversationId, 'conversation:blue');
});

test('gerichte accepted-provenance lookup gebruikt één canonieke geaggregeerde RPC en behoudt ambiguïteit', async () => {
  const rpcCalls = [];
  const rows = [1, 2].map((number) => ({
    intent_id: `send:targeted-${number}`,
    idempotency_key: `browser:targeted-${number}`,
    owner: 'serve',
    account_email: 'serve@softora.nl',
    recipient_email: 'lead@example.nl',
    mode: 'reply',
    conversation_id: 'conversation:targeted',
    reply_target_message_id: '<incoming@example.nl>',
    references_text: '<root@example.nl> <incoming@example.nl>',
    provider: 'smtp',
    provider_thread_id: 'thread-targeted',
    provider_message_id: `provider-targeted-${number}`,
    sent_message_id: number === 1 ? '<TARGET@Example.NL>' : 'target@example.nl',
    canonical_message_id: 'target@example.nl',
    sender_name: 'Servé Creusen',
    subject: 'Re: Kleine vraag',
    body_text: `Exact antwoord ${number}`,
    cc_text: 'cc@example.nl',
    bcc_text: 'bcc@example.nl',
    status: 'accepted',
    dispatch_state: 'finished',
    accepted_at: `2026-08-25T00:0${number}:00.000Z`,
    created_at: '2026-08-25T00:00:00.000Z',
    updated_at: `2026-08-25T00:0${number}:00.000Z`,
  }));
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      async rpc(name, args) {
        rpcCalls.push([name, args]);
        return {
          data: {
            rows,
            complete: true,
            overflow: false,
            returned_count: rows.length,
            max_rows: 3,
          },
          error: null,
        };
      },
    }),
    logger: { error() {} },
  });

  const accepted = await store.listAcceptedMessagesByMessageIds({
    accountEmails: [' SERVE@SOFTORA.NL ', 'serve@softora.nl'],
    messageIds: [' <<TARGET@EXAMPLE.NL>>, ', '<target@example.nl>'],
    maxRows: 3,
  });

  assert.equal(accepted.length, 2, 'dubbele accepted provenance moet zichtbaar blijven als ambiguïteit');
  assert.deepEqual(accepted.map((row) => row.intentId), ['send:targeted-1', 'send:targeted-2']);
  assert.equal(accepted[0].messageId, '<TARGET@Example.NL>');
  assert.equal(accepted[0].canonicalMessageId, 'target@example.nl');
  assert.equal(accepted[0].body, 'Exact antwoord 1');
  assert.equal(accepted[0].replyTargetMessageId, '<incoming@example.nl>');
  assert.deepEqual(rpcCalls, [[
    'softora_list_accepted_mailbox_send_provenance_by_message_ids',
    {
      p_account_emails: ['serve@softora.nl'],
      p_message_ids: ['target@example.nl'],
      p_max_rows: 3,
    },
  ]]);
});

test('gerichte accepted-provenance lookup faalt gesloten op overflow, scopeschending en ontbrekende opslag', async () => {
  const baseRow = {
    intent_id: 'send:overflow', idempotency_key: 'browser:overflow', owner: 'serve',
    account_email: 'serve@softora.nl', recipient_email: 'lead@example.nl', mode: 'reply',
    provider: 'smtp', sent_message_id: '<target@example.nl>',
    canonical_message_id: 'target@example.nl', subject: 'Re: Vraag', body_text: 'Antwoord',
    status: 'accepted', dispatch_state: 'finished',
  };
  const overflowRows = [1, 2, 3].map((number) => ({
    ...baseRow, intent_id: `send:overflow-${number}`,
  }));
  const overflowStore = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      async rpc() {
        return { data: {
          rows: overflowRows, complete: false, overflow: true,
          returned_count: 3, max_rows: 2,
        }, error: null };
      },
    }),
    logger: { error() {} },
  });
  await assert.rejects(
    overflowStore.listAcceptedMessagesByMessageIds({
      accountEmails: ['serve@softora.nl'], messageIds: ['target@example.nl'], maxRows: 2,
    }),
    (error) => error.code === 'MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_OVERFLOW'
  );

  const scopeStore = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      async rpc() {
        return { data: {
          rows: [{ ...baseRow, account_email: 'martijn@softora.nl' }],
          complete: true, overflow: false, returned_count: 1, max_rows: 2,
        }, error: null };
      },
    }),
    logger: { error() {} },
  });
  await assert.rejects(
    scopeStore.listAcceptedMessagesByMessageIds({
      accountEmails: ['serve@softora.nl'], messageIds: ['target@example.nl'], maxRows: 2,
    }),
    (error) => error.code === 'MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_INVALID_RESULT'
  );

  const unavailableStore = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => false,
    logger: { error() {} },
  });
  await assert.rejects(
    unavailableStore.listAcceptedMessagesByMessageIds({
      accountEmails: ['serve@softora.nl'], messageIds: ['target@example.nl'], maxRows: 2,
    }),
    (error) => error.code === 'MAILBOX_SEND_PROVENANCE_UNAVAILABLE'
  );
});

test('gerichte accepted-provenance lookup weigert te brede input vóór de RPC', async () => {
  let rpcCalls = 0;
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({ async rpc() { rpcCalls += 1; return { data: null, error: null }; } }),
  });
  await assert.rejects(
    store.listAcceptedMessagesByMessageIds({
      accountEmails: ['serve@softora.nl'],
      messageIds: Array.from({ length: 201 }, (_, index) => `target-${index}@example.nl`),
      maxRows: 500,
    }),
    (error) => error.code === 'MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_INPUT_TOO_LARGE'
  );
  assert.equal(rpcCalls, 0);
});

test('mailbox send provenance bypasses an active shared circuit and retries one isolated timeout', async () => {
  let backgroundCalls = 0;
  let criticalCalls = 0;
  const createdClients = [];
  const createClient = (_url, _key, options = {}) => {
    const timedFetch = options.global.fetch;
    const client = {
      timedFetch,
      from() {
        let inserted = null;
        const query = {
          insert(row) { inserted = { ...row }; return query; },
          select() { return query; },
          eq() { return query; },
          in() { return query; },
          async single() {
            try {
              await timedFetch('https://example.supabase.co/rest/v1/softora_mailbox_send_provenance', {
                method: 'POST',
              });
              return { data: inserted, error: null };
            } catch (error) {
              return { data: null, error };
            }
          },
          async maybeSingle() {
            try {
              await timedFetch('https://example.supabase.co/rest/v1/softora_mailbox_send_provenance', {
                method: 'GET',
              });
              return { data: null, error: null };
            } catch (error) {
              return { data: null, error };
            }
          },
        };
        return query;
      },
    };
    createdClients.push(client);
    return client;
  };
  const stateStore = createSupabaseStateStore({
    supabaseUrl: 'https://example.supabase.co',
    supabaseServiceRoleKey: 'service-role-key',
    supabaseStateTable: 'runtime_state',
    supabaseStateKey: 'runtime_state_main',
    createClient,
    fetchImpl: async (url) => {
      if (String(url).includes('/background-sync')) {
        backgroundCalls += 1;
        const error = new Error('Supabase client timeout na 1500ms');
        error.name = 'AbortError';
        throw error;
      }
      criticalCalls += 1;
      if (criticalCalls === 1) {
        const error = new Error('Supabase client timeout na 8000ms');
        error.name = 'AbortError';
        throw error;
      }
      return { ok: true, status: 201, text: async () => '[]' };
    },
  });
  const backgroundClient = stateStore.getSupabaseClient();
  await assert.rejects(
    backgroundClient.timedFetch('https://example.supabase.co/background-sync'),
    /1500ms/
  );
  await assert.rejects(
    backgroundClient.timedFetch('https://example.supabase.co/background-sync'),
    /tijdelijk overgeslagen/
  );

  const provenanceStore = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: stateStore.getSupabaseClient,
    retryDelayMs: 0,
  });
  const result = await provenanceStore.reserve({
    intentId: 'send:circuit-isolated', idempotencyKey: 'browser:circuit-isolated', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'prospect@example.nl', mode: 'reply',
    conversationId: 'conversation:circuit-isolated', replyTargetMessageId: '<incoming@example.nl>',
    references: '<incoming@example.nl>', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Re: Website', body: 'Dankjewel voor je reactie.',
  });

  assert.equal(result.created, true);
  assert.equal(result.intent.status, 'prepared');
  assert.equal(backgroundCalls, 1, 'het gedeelde circuit hoort de tweede achtergrondcall over te slaan');
  assert.equal(criticalCalls, 5, 'de kritieke insert mag pas na geïsoleerde conflict-read-backs opnieuw proberen');
  assert.equal(createdClients.length, 2, 'default- en kritieke clientpolicy horen gescheiden te zijn');
});

test('reserve recovers its exact committed UUID after a response-timeout and starts one provider dispatch', async () => {
  let firstInsert = true;
  const client = createFakeSupabase({
    onInsert: () => {
      if (!firstInsert) return null;
      firstInsert = false;
      return {
        commit: true,
        error: Object.assign(new Error('insert committed but response timed out'), { code: 'ETIMEDOUT' }),
      };
    },
  });
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-08-24T13:40:00.000Z'),
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:reserve-commit-timeout', idempotencyKey: 'browser:reserve-commit-timeout', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:reserve-commit-timeout', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Vraag', body: 'Bericht',
  };
  let providerDispatches = 0;

  const reservation = await store.reserve(payload);
  const committedReservationToken = client.rows[0].transition_token;
  if (reservation.created) {
    await store.startDispatch(reservation.intent.intentId);
    providerDispatches += 1;
  }

  assert.equal(reservation.created, true);
  assert.equal(reservation.intent.transitionToken, committedReservationToken);
  assert.notEqual(client.rows[0].transition_token, committedReservationToken);
  assert.equal(client.insertCalls, 1, 'een gecommitteerde INSERT-timeout mag geen tweede INSERT doen');
  assert.equal(providerDispatches, 1);
  assert.equal(client.rows[0].dispatch_state, 'started');
});

test('reserve retries the same UUID only after read-back proves the first insert did not commit', async () => {
  let firstInsert = true;
  const attemptedTokens = [];
  const client = createFakeSupabase({
    onInsert: ({ row }) => {
      attemptedTokens.push(row.transition_token);
      if (!firstInsert) return null;
      firstInsert = false;
      return {
        commit: false,
        error: Object.assign(new Error('insert timed out before commit'), { code: 'ETIMEDOUT' }),
      };
    },
  });
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-08-24T13:45:00.000Z'),
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:reserve-precommit-timeout', idempotencyKey: 'browser:reserve-precommit-timeout', owner: 'martijn',
    accountEmail: 'martijn@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:reserve-precommit-timeout', provider: 'smtp', senderName: 'Martijn van de Ven',
    subject: 'Vraag', body: 'Bericht',
  };

  const reservation = await store.reserve(payload);

  assert.equal(reservation.created, true);
  assert.equal(client.insertCalls, 2);
  assert.equal(new Set(attemptedTokens).size, 1, 'de bewezen veilige retry behoudt exact hetzelfde reservatietoken');
  assert.equal(reservation.intent.transitionToken, attemptedTokens[0]);
});

test('a committed reserve with failed response and failed read-backs is safely renewed after its lease', async () => {
  let currentTime = new Date('2026-08-24T13:47:00.000Z');
  let firstInsert = true;
  const readTimeout = () => Object.assign(new Error('reservation read-back timed out'), { code: 'ETIMEDOUT' });
  const client = createFakeSupabase({
    onInsert: () => {
      if (!firstInsert) return null;
      firstInsert = false;
      return {
        commit: true,
        error: Object.assign(new Error('insert response timed out'), { code: 'ETIMEDOUT' }),
      };
    },
    onMaybeSingle: ({ call }) => call <= 2 ? { error: readTimeout() } : null,
  });
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => currentTime,
    reservationLeaseMs: 30_000,
    retryDelayMs: 0,
  });
  const original = {
    intentId: 'send:lost-reserve-response', idempotencyKey: 'browser:stable-after-reserve-failure', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:lost-reserve-response', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Vraag', body: 'Bericht',
  };

  await assert.rejects(() => store.reserve(original), (error) => error.code === 'ETIMEDOUT');
  const abandonedToken = client.rows[0].transition_token;
  assert.equal(client.rows[0].dispatch_state, 'reserved');
  currentTime = new Date('2026-08-24T13:47:31.000Z');
  const retry = { ...original, intentId: 'send:renewed-after-lost-readback' };
  let providerDispatches = 0;

  const renewed = await store.reserve(retry);
  if (renewed.created) {
    await store.startDispatch(retry.intentId);
    providerDispatches += 1;
  }

  assert.equal(renewed.created, true);
  assert.equal(renewed.intent.intentId, retry.intentId);
  assert.notEqual(renewed.intent.transitionToken, abandonedToken);
  assert.equal(client.rows.length, 1);
  assert.equal(providerDispatches, 1);
  assert.equal(client.rows[0].dispatch_state, 'started');
});

test('an expired reserved row with another idempotency key is failed before a new row is inserted', async () => {
  let currentTime = new Date('2026-08-24T13:48:00.000Z');
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => currentTime,
    reservationLeaseMs: 30_000,
    retryDelayMs: 0,
  });
  const original = {
    intentId: 'send:expired-other-key-a', idempotencyKey: 'browser:expired-other-key-a', owner: 'martijn',
    accountEmail: 'martijn@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:expired-other-key', provider: 'smtp', senderName: 'Martijn van de Ven',
    subject: 'Vraag', body: 'Bericht',
  };
  await store.reserve(original);
  currentTime = new Date('2026-08-24T13:48:31.000Z');
  const replacement = {
    ...original,
    intentId: 'send:expired-other-key-b',
    idempotencyKey: 'browser:expired-other-key-b',
  };

  const reserved = await store.reserve(replacement);

  assert.equal(reserved.created, true);
  assert.equal(reserved.intent.intentId, replacement.intentId);
  assert.equal(client.rows.length, 2);
  assert.equal(client.rows.find((row) => row.intent_id === original.intentId).status, 'failed');
  assert.equal(client.rows.find((row) => row.intent_id === replacement.intentId).status, 'prepared');
});

test('concurrent same-key reclaim exposes one renewed reservation and one provider dispatch', async () => {
  let currentTime = new Date('2026-08-24T13:49:00.000Z');
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => currentTime,
    reservationLeaseMs: 30_000,
    retryDelayMs: 0,
  });
  const original = {
    intentId: 'send:reclaim-original', idempotencyKey: 'browser:reclaim-stable', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:reclaim-stable', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Vraag', body: 'Bericht',
  };
  await store.reserve(original);
  currentTime = new Date('2026-08-24T13:49:31.000Z');
  let providerDispatches = 0;
  const flow = async (suffix) => {
    const input = { ...original, intentId: `send:reclaim-${suffix}` };
    const reservation = await store.reserve(input);
    if (!reservation.created) return reservation;
    await store.startDispatch(input.intentId);
    providerDispatches += 1;
    return reservation;
  };

  const results = await Promise.all([flow('one'), flow('two')]);

  assert.deepEqual(results.map((result) => result.created).sort(), [false, true]);
  assert.equal(providerDispatches, 1);
  assert.equal(client.rows.length, 1);
  assert.equal(client.rows[0].dispatch_state, 'started');
});

test('legacy reserved rows with a null lease age out only after the bounded reservation TTL', async () => {
  let currentTime = new Date('2026-08-24T13:50:00.000Z');
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => currentTime,
    reservationLeaseMs: 30_000,
    retryDelayMs: 0,
  });
  const original = {
    intentId: 'send:legacy-null-lease', idempotencyKey: 'browser:legacy-null-lease', owner: 'martijn',
    accountEmail: 'martijn@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:legacy-null-lease', provider: 'smtp', senderName: 'Martijn van de Ven',
    subject: 'Vraag', body: 'Bericht',
  };
  await store.reserve(original);
  client.rows[0].dispatch_lease_expires_at = null;
  client.rows[0].transition_token = null;
  currentTime = new Date('2026-08-24T13:50:20.000Z');

  const early = await store.reserve({ ...original, intentId: 'send:legacy-too-early' });
  assert.equal(early.created, false);
  assert.equal(client.rows[0].intent_id, original.intentId);

  currentTime = new Date('2026-08-24T13:50:31.000Z');
  const renewed = await store.reserve({ ...original, intentId: 'send:legacy-renewed' });

  assert.equal(renewed.created, true);
  assert.equal(renewed.intent.intentId, 'send:legacy-renewed');
  assert.match(renewed.intent.transitionToken, /^[0-9a-f-]{36}$/);
});

test('two identical concurrent reserve-and-start flows expose exactly one provider winner', async () => {
  const client = createFakeSupabase();
  const tokens = [
    '00000000-0000-4000-8000-000000000071',
    '00000000-0000-4000-8000-000000000072',
    '00000000-0000-4000-8000-000000000073',
  ];
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-08-24T13:50:00.000Z'),
    createTransitionToken: () => tokens.shift(),
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:concurrent-reserve', idempotencyKey: 'browser:concurrent-reserve', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:concurrent-reserve', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Vraag', body: 'Bericht',
  };
  let providerDispatches = 0;
  const flow = async () => {
    const reservation = await store.reserve(payload);
    if (!reservation.created) return reservation;
    await store.startDispatch(reservation.intent.intentId);
    providerDispatches += 1;
    return reservation;
  };

  const reservations = await Promise.all([flow(), flow()]);

  assert.deepEqual(reservations.map((result) => result.created).sort(), [false, true]);
  assert.equal(providerDispatches, 1);
  assert.equal(client.rows.length, 1);
  assert.equal(client.rows[0].dispatch_state, 'started');
});

test('accepted provenance listing bypasses an open shared circuit with its own bounded client', async () => {
  let backgroundCalls = 0;
  let acceptedListCalls = 0;
  const createdPolicies = [];
  const acceptedRow = {
    intent_id: 'send:accepted-circuit', idempotency_key: 'browser:accepted-circuit',
    owner: 'serve', account_email: 'serve@softora.nl', recipient_email: 'lead@example.nl',
    mode: 'reply', provider: 'smtp', status: 'accepted', dispatch_state: 'finished',
    sent_message_id: '<accepted-circuit@example.nl>', subject: 'Re: Website', body_text: 'Exact antwoord',
    accepted_at: '2026-08-24T13:51:00.000Z', created_at: '2026-08-24T13:50:00.000Z',
    updated_at: '2026-08-24T13:51:00.000Z', transition_token: '00000000-0000-4000-8000-000000000051',
  };
  const createClient = (_url, _key, options = {}) => {
    const timedFetch = options.global.fetch;
    createdPolicies.push(options);
    return {
      timedFetch,
      from() {
        const query = {
          select() { return query; },
          in() { return query; },
          eq() { return query; },
          order() { return query; },
          async limit() {
            try {
              await timedFetch('https://example.supabase.co/rest/v1/softora_mailbox_send_provenance', {
                method: 'GET',
              });
              return { data: [acceptedRow], error: null };
            } catch (error) {
              return { data: null, error };
            }
          },
        };
        return query;
      },
    };
  };
  const stateStore = createSupabaseStateStore({
    supabaseUrl: 'https://example.supabase.co',
    supabaseServiceRoleKey: 'service-role-key',
    supabaseStateTable: 'runtime_state',
    supabaseStateKey: 'runtime_state_main',
    createClient,
    fetchImpl: async (url) => {
      if (String(url).includes('/background-sync')) {
        backgroundCalls += 1;
        const error = new Error('Supabase client timeout na 1500ms');
        error.name = 'AbortError';
        throw error;
      }
      acceptedListCalls += 1;
      return { ok: true, status: 200, text: async () => '[]' };
    },
  });
  const backgroundClient = stateStore.getSupabaseClient();
  await assert.rejects(
    backgroundClient.timedFetch('https://example.supabase.co/background-sync'),
    /1500ms/
  );
  await assert.rejects(
    backgroundClient.timedFetch('https://example.supabase.co/background-sync'),
    /tijdelijk overgeslagen/
  );

  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: stateStore.getSupabaseClient,
    retryDelayMs: 0,
  });
  const accepted = await store.listAcceptedMessages({ accountEmails: ['SERVE@softora.nl'] });

  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].intentId, 'send:accepted-circuit');
  assert.equal(accepted[0].messageId, '<accepted-circuit@example.nl>');
  assert.equal(backgroundCalls, 1);
  assert.equal(acceptedListCalls, 1);
  assert.equal(createdPolicies.length, 2);
  assert.equal(createdPolicies[1].global.fetch === createdPolicies[0].global.fetch, false);
});

test('mailbox send provenance requests the bounded isolated client policy for every send guard query', async () => {
  const requestedPolicies = [];
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: (options) => {
      requestedPolicies.push(options || {});
      return client;
    },
    retryDelayMs: 0,
  });

  await store.reserve({
    intentId: 'send:policy', idempotencyKey: 'browser:policy', owner: 'martijn',
    accountEmail: 'martijn@softora.nl', recipientEmail: 'prospect@example.nl', mode: 'new-message',
    conversationId: 'draft:prospect', provider: 'smtp', senderName: 'Martijn van de Ven',
    subject: 'Kleine vraag', body: 'Goedendag',
  });

  assert.deepEqual(requestedPolicies, [{
    timeoutMs: 8000,
    ignoreFailureCooldown: true,
    suppressFailureCooldown: true,
  }]);
});

test('mailbox send provenance fails closed when durable storage is unavailable', async () => {
  const store = createMailboxSendProvenanceStore({ isSupabaseConfigured: () => false });
  await assert.rejects(() => store.reserve({}), (error) => (
    error.code === 'MAILBOX_SEND_PROVENANCE_INVALID' ||
    error.code === 'MAILBOX_SEND_PROVENANCE_UNAVAILABLE'
  ));
});

test('semantic reply identity blocks a second browser key before provider dispatch', async () => {
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
  });
  const base = {
    owner: 'martijn', accountEmail: 'martijn@websoftora.com', recipientEmail: 'bestuur@example.nl',
    mode: 'reply', conversationId: 'instantly:martijn:thread-1', replyTargetMessageId: 'message-1',
    references: 'message-1', provider: 'instantly', providerThreadId: 'thread-1',
    senderName: 'Martijn van de Ven', subject: 'Re: Vraag', body: 'Antwoord',
  };
  const first = await store.reserve({ ...base, intentId: 'send:first', idempotencyKey: 'browser:first' });
  const second = await store.reserve({ ...base, intentId: 'send:second', idempotencyKey: 'browser:second' });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.intent.intentId, 'send:first');
  assert.equal(client.rows.length, 1);
});

test('dispatch state records success and ambiguous provider outcome without allowing blind resend', async () => {
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-08-13T10:00:00.000Z'),
  });
  const payload = {
    intentId: 'send:unknown', idempotencyKey: 'browser:unknown', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:lead', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Vraag', body: 'Bericht',
  };
  await store.reserve(payload);
  await store.startDispatch(payload.intentId);
  const unknown = await store.markUnknown(payload.intentId, new Error('timeout'), { sentReconcileRequired: true });
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.dispatchState, 'started');
  assert.equal(unknown.reconcileRequired, true);
  assert.equal(unknown.sentReconcileRequired, true);
  const retry = await store.reserve({ ...payload, intentId: 'send:retry', idempotencyKey: 'browser:retry' });
  assert.equal(retry.created, false);
  assert.equal(retry.intent.status, 'unknown');
  const accepted = await store.accept(payload.intentId, { messageId: '<confirmed@example.nl>' });
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.dispatchState, 'finished');
  assert.equal(accepted.reconcileRequired, false);
});

test('conditional transitions recover exact commit-success response-timeouts without blind mutation retries', async () => {
  const timedOutTransitions = new Set(['started', 'accepted']);
  const timeout = () => Object.assign(new Error('commit succeeded but response timed out'), {
    code: 'ETIMEDOUT',
  });
  const client = createFakeSupabase({
    onUpdate: ({ patch }) => {
      const transition = patch.status === 'accepted' ? 'accepted' : patch.dispatch_state;
      if (timedOutTransitions.delete(transition)) return { commit: true, error: timeout() };
      return null;
    },
  });
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-08-24T14:00:00.000Z'),
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:commit-timeout', idempotencyKey: 'browser:commit-timeout', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:commit-timeout', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Vraag', body: 'Bericht',
  };
  await store.reserve(payload);

  const started = await store.startDispatch(payload.intentId);
  assert.equal(started.dispatchState, 'started');
  assert.match(started.transitionToken, /^[0-9a-f-]{36}$/);
  assert.equal(client.updateCalls, 1, 'een gecommitteerde start-timeout mag geen tweede PATCH doen');

  const accepted = await store.accept(payload.intentId, {
    messageId: '<commit-timeout@example.nl>',
    acceptedAt: '2026-08-24T14:01:00.000Z',
  });
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.messageId, '<commit-timeout@example.nl>');
  assert.notEqual(accepted.transitionToken, started.transitionToken);
  assert.equal(client.updateCalls, 2, 'ook accepted read-back herstelt zonder blinde PATCH-retry');
});

test('conditional transition retries only after read-back proves the original source state still holds', async () => {
  let firstStartAttempt = true;
  const client = createFakeSupabase({
    onUpdate: ({ patch }) => {
      if (!patch.status && patch.dispatch_state === 'started' && firstStartAttempt) {
        firstStartAttempt = false;
        return {
          commit: false,
          error: Object.assign(new Error('request timed out before commit'), { code: 'ETIMEDOUT' }),
        };
      }
      return null;
    },
  });
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-08-24T14:10:00.000Z'),
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:read-confirmed-retry', idempotencyKey: 'browser:read-confirmed-retry', owner: 'martijn',
    accountEmail: 'martijn@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:read-confirmed-retry', provider: 'smtp', senderName: 'Martijn van de Ven',
    subject: 'Vraag', body: 'Bericht',
  };
  await store.reserve(payload);

  const started = await store.startDispatch(payload.intentId);

  assert.equal(started.dispatchState, 'started');
  assert.equal(client.updateCalls, 2);
  assert.equal(client.rows[0].transition_token, started.transitionToken);
});

test('two concurrent starts with the same clock expose exactly one dispatch winner', async () => {
  const client = createFakeSupabase();
  const transitionTokens = [
    '00000000-0000-4000-8000-000000000060',
    '00000000-0000-4000-8000-000000000061',
    '00000000-0000-4000-8000-000000000062',
  ];
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-08-24T14:20:00.000Z'),
    createTransitionToken: () => transitionTokens.shift(),
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:concurrent-start', idempotencyKey: 'browser:concurrent-start', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:concurrent-start', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Vraag', body: 'Bericht',
  };
  await store.reserve(payload);
  let providerDispatches = 0;
  const dispatch = async () => {
    const started = await store.startDispatch(payload.intentId);
    providerDispatches += 1;
    return started;
  };

  const results = await Promise.allSettled([dispatch(), dispatch()]);
  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(providerDispatches, 1);
  assert.equal(client.rows[0].transition_token, fulfilled[0].value.transitionToken);
  assert.equal(client.rows[0].dispatch_state, 'started');
  assert.equal(rejected[0].reason.code, 'PGRST116');
});

test('an expired started lease becomes explicit reconciliation and is never reopened for resend', async () => {
  let currentTime = new Date('2026-08-24T15:00:00.000Z');
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => currentTime,
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:expired-start', idempotencyKey: 'browser:expired-start', owner: 'martijn',
    accountEmail: 'martijn@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:expired-start', provider: 'smtp', senderName: 'Martijn van de Ven',
    subject: 'Vraag', body: 'Bericht',
  };
  await store.reserve(payload);
  await store.startDispatch(payload.intentId, 30_000);
  currentTime = new Date('2026-08-24T15:01:00.000Z');

  const repeated = await store.reserve({
    ...payload,
    intentId: 'send:expired-retry',
    idempotencyKey: 'browser:expired-retry',
  });

  assert.equal(repeated.created, false);
  assert.equal(repeated.intent.status, 'unknown');
  assert.equal(repeated.intent.dispatchState, 'started');
  assert.equal(repeated.intent.reconcileRequired, true);
  assert.equal(repeated.intent.sentReconcileRequired, true);
  assert.match(repeated.intent.error, /provideruitkomst moet eerst worden gereconcilieerd/i);
  assert.equal(client.rows.length, 1);
});

test('accepted terminal evidence safely wins a race against expired-lease reconciliation', async () => {
  let currentTime = new Date('2026-08-24T15:10:00.000Z');
  let injectAcceptedRace = true;
  const client = createFakeSupabase({
    onUpdate: ({ patch }) => {
      if (patch.status !== 'unknown' || !injectAcceptedRace) return null;
      injectAcceptedRace = false;
      return {
        commit: false,
        concurrentPatch: {
          status: 'accepted',
          dispatch_state: 'finished',
          dispatch_lease_expires_at: null,
          sent_message_id: '<accepted-during-expiry@example.nl>',
          accepted_at: '2026-08-24T15:10:45.000Z',
          reconcile_required: false,
          sent_reconcile_required: false,
          transition_token: '00000000-0000-4000-8000-000000000081',
        },
        error: { code: 'PGRST116', message: 'conditional row changed concurrently' },
      };
    },
  });
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => currentTime,
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:expiry-accept-race', idempotencyKey: 'browser:expiry-accept-race', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:expiry-accept-race', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Vraag', body: 'Bericht',
  };
  await store.reserve(payload);
  await store.startDispatch(payload.intentId, 30_000);
  currentTime = new Date('2026-08-24T15:11:00.000Z');

  const repeated = await store.reserve(payload);

  assert.equal(repeated.created, false);
  assert.equal(repeated.intent.status, 'accepted');
  assert.equal(repeated.intent.messageId, '<accepted-during-expiry@example.nl>');
  assert.equal(client.rows[0].status, 'accepted');
  assert.equal(client.rows[0].reconcile_required, false);
});

test('missing canonical sender values fail before any provenance insert', async () => {
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
  });
  await assert.rejects(() => store.reserve({
    intentId: 'send:invalid', idempotencyKey: 'browser:invalid', owner: ' ', accountEmail: '',
    recipientEmail: 'lead@example.nl', mode: 'new-message', provider: 'smtp', subject: 'Vraag', body: 'Body',
  }), (error) => error.code === 'MAILBOX_SEND_PROVENANCE_INVALID');
  assert.equal(client.rows.length, 0);
});
