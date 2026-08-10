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
            if (rows.some((row) => row.idempotency_key === state.inserted.idempotency_key)) {
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
