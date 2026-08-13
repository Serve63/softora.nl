const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMailboxSendProvenanceStore,
} = require('../../server/services/mailbox-send-provenance-store');

function createFakeSupabase() {
  const rows = [];
  return {
    rows,
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
            rows.push(row);
            return { data: row, error: null };
          }
          if (state.action === 'update') {
            const row = matching()[0];
            if (!row) return { data: null, error: { code: 'PGRST116', message: 'missing' } };
            Object.assign(row, state.patch);
            return { data: row, error: null };
          }
          return { data: matching()[0] || null, error: null };
        },
        async maybeSingle() {
          return { data: matching()[0] || null, error: null };
        },
      };
      return query;
    },
  };
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
