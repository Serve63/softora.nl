const test = require('node:test');
const assert = require('node:assert/strict');

const { createMailboxIndexStore } = require('../../server/services/mailbox-index-store');

function createMailboxIndexClient() {
  const stateRows = new Map();
  return {
    stateRows,
    from(table) {
      if (table !== 'softora_mailbox_sync_state') {
        return {
          upsert: async () => ({ data: [], error: null }),
        };
      }
      return {
        select() {
          const filters = {};
          return {
            eq(column, value) {
              filters[column] = value;
              return this;
            },
            limit() {
              return this;
            },
            async maybeSingle() {
              const row = stateRows.get(filters.sync_key);
              return { data: row || null, error: null };
            },
          };
        },
        async upsert(row) {
          stateRows.set(row.sync_key, { ...(stateRows.get(row.sync_key) || {}), ...row });
          return { data: row, error: null };
        },
        update(patch) {
          const filters = {};
          return {
            eq(column, value) {
              filters[column] = value;
              if (filters.sync_key && Object.prototype.hasOwnProperty.call(filters, 'lock_token')) {
                const current = stateRows.get(filters.sync_key);
                if (current && current.lock_token === filters.lock_token) {
                  stateRows.set(filters.sync_key, { ...current, ...patch });
                }
                return Promise.resolve({ data: [], error: null });
              }
              return this;
            },
          };
        },
      };
    },
  };
}

test('mailbox index store maps IMAP messages into stable indexed rows', () => {
  const store = createMailboxIndexStore({
    now: () => new Date('2026-05-20T12:00:00.000Z'),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
  });

  const row = store.buildMessageRow(
    {
      id: 'inbox:42',
      uid: 42,
      folder: 'inbox',
      from: 'Serve',
      email: 'serve@softora.nl',
      to: 'klant@example.nl',
      subject: 'Mailbox snelheid',
      preview: 'Supabase index',
      body: 'Volledige tekst',
      date: '2026-05-20T11:00:00.000Z',
      messageId: '<m-42@softora.nl>',
      unread: true,
      starred: false,
    },
    'INFO@SOFTORA.NL',
    'INBOX',
    0
  );

  assert.equal(row.message_key, 'info@softora.nl|inbox|42');
  assert.equal(row.account_email, 'info@softora.nl');
  assert.equal(row.folder, 'inbox');
  assert.equal(row.has_body, true);
  assert.equal(row.body_text, 'Volledige tekst');
  assert.equal(row.message_id, '<m-42@softora.nl>');

  const listMessage = store.normalizeMessageRow(row);
  assert.equal(listMessage.id, 'inbox:42');
  assert.equal(listMessage.body, '');
  assert.equal(listMessage.hasBody, true);

  const detailMessage = store.normalizeMessageRow(row, { includeBody: true });
  assert.equal(detailMessage.body, 'Volledige tekst');
});

test('mailbox index store uses sync locks to avoid duplicate mailbox syncs', async () => {
  const client = createMailboxIndexClient();
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-05-20T12:00:00.000Z'),
    logger: { error: () => {} },
  });

  const first = await store.acquireSyncLock({ accountEmail: 'info@softora.nl', folder: 'inbox' });
  const second = await store.acquireSyncLock({ accountEmail: 'info@softora.nl', folder: 'inbox' });

  assert.equal(first.ok, true);
  assert.equal(second.locked, true);

  await store.finishSync({
    accountEmail: 'info@softora.nl',
    folder: 'inbox',
    lockToken: first.lockToken,
    messageCount: 2,
    lastUid: 42,
  });

  const third = await store.acquireSyncLock({ accountEmail: 'info@softora.nl', folder: 'inbox' });
  assert.equal(third.ok, true);
});
