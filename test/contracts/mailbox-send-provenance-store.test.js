const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createMailboxSendIdentityKey,
  createMailboxSendProvenanceStore,
} = require('../../server/services/mailbox-send-provenance-store');

function createFakeSupabase() {
  const rows = [];
  return {
    rows,
    from() {
      const state = { action: 'select', filters: [], patch: null, inserted: null };
      const matching = () => rows.filter((row) => state.filters.every(([key, value, kind]) => (
        kind === 'in' ? value.includes(row[key]) : kind === 'lte' ? row[key] <= value : row[key] === value
      )));
      const query = {
        select() { return query; },
        insert(row) { state.action = 'insert'; state.inserted = { ...row }; return query; },
        update(patch) { state.action = 'update'; state.patch = { ...patch }; return query; },
        eq(key, value) { state.filters.push([key, value, 'eq']); return query; },
        in(key, value) { state.filters.push([key, value, 'in']); return query; },
        lte(key, value) { state.filters.push([key, value, 'lte']); return query; },
        order() { return query; },
        limit(limit) {
          return Promise.resolve({ data: matching().slice(0, limit), error: null });
        },
        async single() {
          if (state.action === 'insert') {
            if (rows.some((row) => (
              row.idempotency_key === state.inserted.idempotency_key ||
              (row.send_identity_key === state.inserted.send_identity_key &&
                ['prepared', 'unknown', 'accepted'].includes(row.status)) ||
              (row.mode === 'new-message' && state.inserted.mode === 'new-message' &&
                row.send_scope_key === state.inserted.send_scope_key &&
                ['prepared', 'unknown'].includes(row.status))
            ))) {
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

test('Instantly reply-identiteit blokkeert een nieuwe browserkey maar laat een echte volgende reply toe', async () => {
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-08-10T09:00:00.000Z'),
    logger: { error() {} },
  });
  const payload = {
    intentId: 'send:instantly-first', idempotencyKey: 'browser-key-first',
    owner: 'serve', accountEmail: 'serve@websoftora.com', recipientEmail: 'klant@example.nl',
    mode: 'reply', conversationId: 'instantly:thread-1', replyTargetMessageId: 'incoming-1',
    references: 'incoming-1', provider: 'instantly', providerThreadId: 'thread-1',
    subject: 'Re: Vraag', body: 'Eerste antwoord', cc: '', bcc: '',
  };
  const first = await store.reserve(payload);
  await store.markUnknown(first.intent.intentId, 'timeout');

  const reloaded = await store.reserve({
    ...payload, intentId: 'send:instantly-reloaded', idempotencyKey: 'browser-key-reloaded',
    subject: 'Re: Gewijzigd', body: 'Aangepast na timeout', cc: 'ander@example.nl',
  });
  assert.equal(reloaded.created, false);
  assert.equal(reloaded.intent.intentId, first.intent.intentId);
  assert.equal(reloaded.intent.status, 'unknown');
  assert.equal(reloaded.intent.sendIdentityKey, createMailboxSendIdentityKey(payload));

  const nextReply = await store.reserve({
    ...payload, intentId: 'send:instantly-next', idempotencyKey: 'browser-key-next',
    replyTargetMessageId: 'incoming-2', references: 'incoming-1 incoming-2', body: 'Tweede antwoord',
  });
  assert.equal(nextReply.created, true);
  assert.notEqual(nextReply.intent.sendIdentityKey, first.intent.sendIdentityKey);
});

test('SMTP replyscope blokkeert wijzigingen; new-message splitst exact replay en tijdelijke scope-lock', async () => {
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true, getSupabaseClient: () => client,
    now: () => new Date('2026-08-10T10:00:00.000Z'), logger: { error() {} },
  });
  const reply = {
    intentId: 'send:smtp-reply-1', idempotencyKey: 'smtp-reply-key-1', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'klant@example.nl', mode: 'reply',
    conversationId: 'smtp:conversation-1', replyTargetMessageId: '<incoming-1@example.nl>',
    references: '<incoming-1@example.nl>', provider: 'smtp', providerThreadId: '',
    subject: 'Re: Vraag', body: 'Eerste tekst', cc: '', bcc: '',
  };
  const first = await store.reserve(reply);
  await store.markUnknown(first.intent.intentId, 'timeout na DATA');
  const reloaded = await store.reserve({
    ...reply, intentId: 'send:smtp-reply-2', idempotencyKey: 'smtp-reply-key-2',
    subject: 'Gewijzigd', body: 'Gewijzigde tekst', cc: 'ander@example.nl',
  });
  assert.equal(reloaded.created, false);
  assert.equal(reloaded.intent.intentId, first.intent.intentId);

  const fresh = {
    ...reply, intentId: 'send:new-1', idempotencyKey: 'new-key-1', mode: 'new-message',
    conversationId: 'draft:klant', replyTargetMessageId: '', references: '', subject: 'Los bericht',
  };
  const newFirst = await store.reserve(fresh);
  await store.accept(newFirst.intent.intentId, { messageId: '<new-1@softora.nl>' });
  const responseLostReplay = await store.reserve({
    ...fresh, intentId: 'send:new-replay', idempotencyKey: 'new-key-replay',
  });
  assert.equal(responseLostReplay.created, false);
  assert.equal(responseLostReplay.intent.intentId, newFirst.intent.intentId);
  assert.equal(responseLostReplay.intent.status, 'accepted');
  const nextNew = await store.reserve({
    ...fresh, intentId: 'send:new-2', idempotencyKey: 'new-key-2', body: 'Echt volgend bericht',
  });
  assert.equal(nextNew.created, true);
  await store.markUnknown(nextNew.intent.intentId, 'timeout na DATA');
  const changedDuringUnknown = await store.reserve({
    ...fresh, intentId: 'send:new-3', idempotencyKey: 'new-key-3',
    body: 'Nog weer andere tekst', cc: 'nieuw@example.nl',
  });
  assert.equal(changedDuringUnknown.created, false);
  assert.equal(changedDuringUnknown.intent.intentId, nextNew.intent.intentId);
});

test('reconcile-selectie bevat alleen dispatch-gestarte rows en filtert exact op provider', async () => {
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true, getSupabaseClient: () => client,
    now: () => new Date('2026-08-10T10:00:00.000Z'), logger: { error() {} },
  });
  const base = {
    owner: 'serve', accountEmail: 'serve@softora.nl', recipientEmail: 'klant@example.nl',
    mode: 'new-message', conversationId: 'draft:1', subject: 'Vraag', body: 'Tekst',
  };
  await store.reserve({ ...base, intentId: 'smtp:prepared', idempotencyKey: 'smtp:key', provider: 'smtp' });
  await store.markDispatchStarted('smtp:prepared');
  await store.reserve({ ...base, intentId: 'instantly:prepared', idempotencyKey: 'instantly:key',
    provider: 'instantly', mode: 'reply', conversationId: 'instantly:thread-2',
    providerThreadId: 'thread-2', replyTargetMessageId: 'incoming-2', references: 'incoming-2',
    recipientEmail: 'ander@example.nl' });
  await store.markDispatchStarted('instantly:prepared');
  const smtp = await store.listReconcileRequired({
    accountEmails: ['serve@softora.nl'], provider: 'smtp', limit: 25,
  });
  assert.deepEqual(smtp.map((intent) => intent.intentId), ['smtp:prepared']);
  assert.equal(smtp[0].reconcileRequired, true);
  assert.equal(smtp[0].sentReconcileRequired, true);
});

test('CAS-statusupdates laten accepted nooit door late unknown of failed overschrijven', async () => {
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true, getSupabaseClient: () => client,
    now: () => new Date('2026-08-10T12:00:00.000Z'), logger: { error() {} },
  });
  const input = {
    intentId: 'send:cas', idempotencyKey: 'key:cas', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'cas@example.nl', mode: 'new-message',
    conversationId: 'draft:cas', provider: 'smtp', subject: 'CAS', body: 'Body',
  };
  await store.reserve(input);
  await store.markDispatchStarted(input.intentId);
  await store.accept(input.intentId, { messageId: '<cas@softora.nl>' });
  assert.equal((await store.markUnknown(input.intentId, 'late timeout')).status, 'accepted');
  assert.equal((await store.fail(input.intentId, 'late rejection')).status, 'accepted');
  assert.equal(client.rows[0].status, 'accepted');
  assert.equal(client.rows[0].dispatch_state, 'finished');

  const unknown = { ...input, intentId: 'send:cas-unknown', idempotencyKey: 'key:cas-unknown',
    recipientEmail: 'cas-unknown@example.nl', conversationId: 'draft:cas-unknown' };
  await store.reserve(unknown);
  await store.markDispatchStarted(unknown.intentId);
  await store.markUnknown(unknown.intentId, 'timeout');
  assert.equal((await store.fail(unknown.intentId, 'late failure')).status, 'unknown');
  assert.equal((await store.accept(unknown.intentId, { messageId: '<reconciled@softora.nl>' })).status, 'accepted');
});

test('verlopen reserved dispatch wordt zonder providerbewijs failed en geeft de sendidentiteit vrij', async () => {
  const client = createFakeSupabase();
  let current = new Date('2026-08-10T12:00:00.000Z');
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true, getSupabaseClient: () => client,
    now: () => current, logger: { error() {} },
  });
  const input = {
    intentId: 'send:lease-first', idempotencyKey: 'key:lease-first', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lease@example.nl', mode: 'new-message',
    conversationId: 'draft:lease', provider: 'smtp', subject: 'Lease', body: 'Body',
  };
  await store.reserve(input);
  current = new Date('2026-08-10T12:11:00.000Z');
  const expired = await store.listExpiredUndispatched({ accountEmails: [input.accountEmail] });
  assert.deepEqual(expired.map((intent) => intent.intentId), [input.intentId]);
  assert.equal((await store.abandonUndispatched(input.intentId)).abandoned, true);
  const retry = await store.reserve({
    ...input, intentId: 'send:lease-retry', idempotencyKey: 'key:lease-retry',
  });
  assert.equal(retry.created, true);
});

test('provider-outcome-migratie is bytegelijk in deploymigratie en data-ops-schema', () => {
  const migration = fs.readFileSync(path.resolve(
    __dirname, '../../supabase/migrations/20260810012150_mailbox_send_provider_outcome_state.sql'
  ), 'utf8');
  const schema = fs.readFileSync(path.resolve(__dirname, '../../supabase/data-ops-schema.sql'), 'utf8');
  const block = (source) => source.match(
    /-- mailbox-send-provider-outcome-state:start[\s\S]*?-- mailbox-send-provider-outcome-state:end/
  )?.[0] || '';
  assert.ok(block(migration));
  assert.equal(block(schema), block(migration));
  assert.match(migration, /status in \('prepared', 'accepted', 'failed', 'unknown'\)/);
  assert.match(migration, /unique index[\s\S]+send_identity_key[\s\S]+status in \('prepared', 'unknown', 'accepted'\)/i);
  assert.match(migration, /unique index[\s\S]+send_scope_key[\s\S]+mode = 'new-message'[\s\S]+status in \('prepared', 'unknown'\)/i);
});
