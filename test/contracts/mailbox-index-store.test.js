const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

test('mailbox index store logs Supabase timeouts as soft index errors', async () => {
  const loggerErrors = [];
  const loggerInfos = [];
  const timeoutClient = {
    from() {
      return {
        select() {
          return {
            eq() {
              return this;
            },
            limit() {
              return this;
            },
            async maybeSingle() {
              const error = new Error('Supabase client timeout na 12s');
              error.name = 'AbortError';
              return { data: null, error };
            },
          };
        },
      };
    },
  };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => timeoutClient,
    logger: {
      error: (...args) => loggerErrors.push(args),
      info: (...args) => loggerInfos.push(args),
    },
  });

  const state = await store.getSyncState({ accountEmail: 'info@softora.nl', folder: 'inbox' });

  assert.equal(state, null);
  assert.equal(
    loggerInfos.some((args) => args[0] === '[MailboxIndex][get-sync-state][SoftError]'),
    true
  );
  assert.equal(
    loggerErrors.some((args) => String(args[0]).includes('[MailboxIndex][get-sync-state]')),
    false
  );
});

test('mailbox index store timeboxes hanging Supabase index reads', async () => {
  const loggerErrors = [];
  const loggerInfos = [];
  const hangingClient = {
    from() {
      return {
        select() {
          return {
            eq() {
              return this;
            },
            limit() {
              return this;
            },
            maybeSingle() {
              return new Promise(() => {});
            },
          };
        },
      };
    },
  };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => hangingClient,
    mailboxIndexQueryTimeoutMs: 25,
    logger: {
      error: (...args) => loggerErrors.push(args),
      info: (...args) => loggerInfos.push(args),
    },
  });

  const startedAt = Date.now();
  const state = await store.getSyncState({ accountEmail: 'info@softora.nl', folder: 'inbox' });

  assert.equal(state, null);
  assert.ok(Date.now() - startedAt < 1000);
  assert.equal(
    loggerInfos.some((args) => args[0] === '[MailboxIndex][get-sync-state][SoftError]'),
    true
  );
  assert.equal(loggerErrors.length, 0);
});

test('mailbox index schema declares tables, indexes, RLS and service-role access', () => {
  const schema = fs.readFileSync(
    path.resolve(__dirname, '../../supabase/data-ops-schema.sql'),
    'utf8'
  );

  assert.match(schema, /create table if not exists public\.softora_mailbox_messages/);
  assert.match(schema, /create table if not exists public\.softora_mailbox_sync_state/);
  assert.match(schema, /softora_mailbox_messages_account_folder_date_idx/);
  assert.match(schema, /softora_mailbox_sync_state_account_folder_idx/);
  assert.match(schema, /alter table public\.softora_mailbox_messages enable row level security;/);
  assert.match(schema, /alter table public\.softora_mailbox_sync_state enable row level security;/);
  assert.match(schema, /grant select, insert, update, delete on public\.softora_mailbox_messages to service_role;/);
  assert.match(schema, /grant select, insert, update, delete on public\.softora_mailbox_sync_state to service_role;/);
});
