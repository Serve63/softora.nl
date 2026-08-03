const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MAILBOX_INDEX_PAGE_SIZE,
  createMailboxIndexStore,
} = require('../../server/services/mailbox-index-store');

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
      toDisplay: 'Klant <klant@example.nl>',
      cc: 'boekhouder@example.nl',
      bcc: 'archief@example.nl',
      recipientRoutingEvidenceKnown: true,
      attachments: [{
        filename: 'voorstel.pdf',
        contentType: 'application/pdf',
        size: 1234,
      }],
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
  assert.equal(Object.hasOwn(row, 'deleted_at'), false);
  assert.deepEqual(row.payload, {
    source: 'imap-sync',
    embeddedImageCount: 0,
    originalCampaignOutbound: false,
    webdesignLinkEvidenceKnown: false,
    webdesignLinkUrl: '',
    recipientRoutingEvidenceKnown: true,
    toDisplay: 'Klant <klant@example.nl>',
    cc: 'boekhouder@example.nl',
    bcc: 'archief@example.nl',
    deliveredTo: '',
    attachments: [{
      filename: 'voorstel.pdf',
      contentType: 'application/pdf',
      size: 1234,
    }],
  });

  const listMessage = store.normalizeMessageRow(row);
  assert.equal(listMessage.id, 'inbox:42');
  assert.equal(listMessage.accountEmail, 'info@softora.nl');
  assert.equal(listMessage.body, '');
  assert.equal(listMessage.hasBody, true);
  assert.equal(listMessage.bodyImageEvidenceKnown, true);
  assert.equal(listMessage.embeddedImageCount, 0);
  assert.equal(listMessage.originalCampaignOutbound, false);
  assert.equal(listMessage.webdesignLinkEvidenceKnown, false);
  assert.equal(listMessage.webdesignLinkUrl, '');
  assert.equal(listMessage.cc, 'boekhouder@example.nl');
  assert.equal(listMessage.bcc, 'archief@example.nl');
  assert.deepEqual(listMessage.attachments, [{
    filename: 'voorstel.pdf',
    contentType: 'application/pdf',
    size: 1234,
  }]);

  const detailMessage = store.normalizeMessageRow(row, { includeBody: true });
  assert.equal(detailMessage.body, 'Volledige tekst');
});

test('mailbox index store preserves exact Instantly HTML and link provenance markers', () => {
  const store = createMailboxIndexStore({
    now: () => new Date('2026-07-26T16:00:00.000Z'),
  });
  const exactUrl = 'https://www.softora.nl/webdesign/bossche-brouwers?cid=exact';
  const row = store.buildProviderMessageRow({
    provider: 'instantly',
    providerMessageId: 'provider-message-42',
    providerThreadId: 'provider-thread-7',
    providerCampaignId: 'provider-campaign-3',
    providerAccountEmail: 'serve@softora.nl',
    providerOwner: 'serve',
    accountEmail: 'serve@softora.nl',
    folder: 'sent',
    direction: 'sent',
    from: 'Servé Creusen',
    email: 'serve@softora.nl',
    to: 'administratie@bosschebrouwers.nl',
    subject: 'Kleine vraag over jullie website',
    body: `Je kunt het webdesign hier [${exactUrl}] bekijken`,
    date: '2026-07-26T15:58:00.000Z',
    originalCampaignOutbound: true,
    providerBodyHtmlEvidenceKnown: true,
    providerRichBodyAvailable: true,
    providerOriginalBodyEvidenceKnown: true,
    providerOriginalBodyAvailable: true,
    webdesignLinkEvidenceKnown: true,
    webdesignLinkUrl: exactUrl,
  });

  assert.equal(row.payload.providerBodyHtmlEvidenceKnown, true);
  assert.equal(row.payload.providerRichBodyAvailable, true);
  assert.equal(row.payload.providerOriginalBodyEvidenceKnown, true);
  assert.equal(row.payload.providerOriginalBodyAvailable, true);
  assert.equal(row.payload.webdesignLinkEvidenceKnown, true);
  assert.equal(row.payload.webdesignLinkUrl, exactUrl);

  const normalized = store.normalizeMessageRow(row, { includeBody: true });
  assert.equal(normalized.provider, 'instantly');
  assert.equal(normalized.providerBodyHtmlEvidenceKnown, true);
  assert.equal(normalized.providerRichBodyAvailable, true);
  assert.equal(normalized.providerOriginalBodyEvidenceKnown, true);
  assert.equal(normalized.providerOriginalBodyAvailable, true);
  assert.equal(normalized.webdesignLinkEvidenceKnown, true);
  assert.equal(normalized.webdesignLinkUrl, exactUrl);
  assert.match(normalized.body, /webdesign hier \[https:\/\/www\.softora\.nl/);
});

test('mailbox index store joins exact active Instantly threads without a broad body scan', async () => {
  const calls = [];
  const rowBuilder = createMailboxIndexStore({
    now: () => new Date('2026-07-26T16:00:00.000Z'),
  });
  const activeOutboundRow = rowBuilder.buildProviderMessageRow({
    provider: 'instantly',
    providerMessageId: 'provider-active-sent',
    providerThreadId: 'provider-active-thread',
    providerAccountEmail: 'serve-sender@example.com',
    providerOwner: 'serve',
    accountEmail: 'serve-sender@example.com',
    folder: 'sent',
    direction: 'sent',
    from: 'Servé Creusen',
    email: 'serve-sender@example.com',
    to: 'prospect@example.org',
    subject: 'Kleine vraag over jullie website',
    body: 'Oude uitgaande mail',
    date: '2026-06-05T12:00:00.000Z',
    originalCampaignOutbound: true,
    providerOriginalBodyEvidenceKnown: false,
  });
  const client = {
    from(table) {
      const queryState = { columns: '', filters: [] };
      const query = {
        select(columns) {
          queryState.columns = columns;
          calls.push(['select', table, columns]);
          return query;
        },
        eq(column, value) {
          queryState.filters.push(['eq', column, value]);
          calls.push(['eq', column, value]);
          return query;
        },
        in(column, value) {
          queryState.filters.push(['in', column, value]);
          calls.push(['in', column, value]);
          return query;
        },
        contains(column, value) {
          queryState.filters.push(['contains', column, value]);
          calls.push(['contains', column, value]);
          return query;
        },
        is(column, value) {
          queryState.filters.push(['is', column, value]);
          calls.push(['is', column, value]);
          return query;
        },
        order(column, options) {
          calls.push(['order', column, options]);
          return query;
        },
        range(from, to) {
          calls.push(['range', from, to]);
          return Promise.resolve({
            data: [{
              account_email: 'serve-sender@example.com',
              provider_thread_id: 'provider-active-thread',
            }],
            error: null,
          });
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: queryState.columns.startsWith('message_key,account_email,folder,')
              ? [activeOutboundRow]
              : [],
            error: null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
  });

  const messages = await store.listProviderActiveConversationAuditMessages({
    provider: 'instantly',
    accountEmails: ['serve-sender@example.com'],
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].providerMessageId, 'provider-active-sent');
  assert.equal(messages[0].providerThreadId, 'provider-active-thread');
  assert.equal(
    calls.some((call) => (
      call[0] === 'select' &&
      call[2] === 'account_email,provider_thread_id:payload->>providerThreadId'
    )),
    true
  );
  assert.equal(
    calls.some((call) => (
      call[0] === 'in' &&
      call[1] === 'payload->>providerThreadId' &&
      call[2][0] === 'provider-active-thread'
    )),
    true
  );
  assert.equal(
    calls.some((call) => (
      call[0] === 'contains' &&
      call[1] === 'payload' &&
      call[2].originalCampaignOutbound === true
    )),
    true
  );
});

test('mailbox index store vindt de oudste campagne-uid zonder verwijderde historie uit te sluiten', async () => {
  const calls = [];
  const uidsByTerm = new Map([
    ['%Kleine vraag over jullie website%', 42],
    ['%Nieuw webdesign%', 19],
  ]);
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      from(table) {
        const filters = {};
        const query = {
          select(columns) {
            calls.push(['select', table, columns]);
            return query;
          },
          eq(column, value) {
            filters[column] = value;
            calls.push(['eq', column, value]);
            return query;
          },
          ilike(column, value) {
            filters[column] = value;
            calls.push(['ilike', column, value]);
            return query;
          },
          order(column, options) {
            calls.push(['order', column, options]);
            return query;
          },
          limit(value) {
            calls.push(['limit', value]);
            return Promise.resolve({
              data: [{ uid: uidsByTerm.get(filters.subject) }],
              error: null,
            });
          },
        };
        return query;
      },
    }),
  });

  const uid = await store.getOldestMatchingMessageUid({
    accountEmail: 'SERVE290@GMAIL.COM',
    folder: 'SENT',
    subjectTerms: ['Kleine vraag over jullie website', 'Nieuw webdesign'],
  });

  assert.equal(uid, 19);
  assert.equal(calls.some((call) => call[0] === 'is' && call[1] === 'deleted_at'), false);
  assert.deepEqual(
    calls.filter((call) => call[0] === 'ilike'),
    [
      ['ilike', 'subject', '%Kleine vraag over jullie website%'],
      ['ilike', 'subject', '%Nieuw webdesign%'],
    ]
  );
});

test('mailbox index store bewaart gelezen status voor exact account, map en uid', async () => {
  const calls = [];
  const query = {
    update(patch) {
      calls.push(['update', patch]);
      return query;
    },
    eq(column, value) {
      calls.push(['eq', column, value]);
      return query;
    },
    is(column, value) {
      calls.push(['is', column, value]);
      return query;
    },
    then(resolve) {
      resolve({ data: [], error: null });
    },
  };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      from(table) {
        calls.push(['from', table]);
        return query;
      },
    }),
    now: () => new Date('2026-07-22T14:00:00.000Z'),
  });

  const result = await store.markMessageRead({
    accountEmail: 'SERVE@SOFTORA.NL',
    folder: 'INBOX',
    id: 'inbox:42',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ['from', 'softora_mailbox_messages'],
    ['update', { unread: false, updated_at: '2026-07-22T14:00:00.000Z' }],
    ['eq', 'account_email', 'serve@softora.nl'],
    ['eq', 'folder', 'inbox'],
    ['is', 'deleted_at', null],
    ['eq', 'uid', 42],
  ]);
});

test('mailbox index store meldt het als een tombstone geen bericht raakt', async () => {
  const query = {
    update() { return query; },
    eq() { return query; },
    select() { return query; },
    then(resolve) { resolve({ data: [], error: null }); },
  };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({ from: () => query }),
  });

  const result = await store.markMessageDeleted({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    uid: 42,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'MAILBOX_INDEX_MESSAGE_NOT_FOUND');
});

test('mailbox index store bewaart verwijdering als duurzaam tombstone zonder sync-resurrectie', async () => {
  const calls = [];
  const query = {
    update(patch) {
      calls.push(['update', patch]);
      return query;
    },
    eq(column, value) {
      calls.push(['eq', column, value]);
      return query;
    },
    select(columns) {
      calls.push(['select', columns]);
      return query;
    },
    then(resolve) {
      resolve({ data: [{ message_key: 'serve@softora.nl|inbox|42' }], error: null });
    },
  };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      from(table) {
        calls.push(['from', table]);
        return query;
      },
    }),
    now: () => new Date('2026-07-23T09:00:00.000Z'),
  });

  const result = await store.markMessageDeleted({
    accountEmail: 'SERVE@SOFTORA.NL',
    folder: 'INBOX',
    id: 'inbox:42',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ['from', 'softora_mailbox_messages'],
    ['update', {
      deleted_at: '2026-07-23T09:00:00.000Z',
      updated_at: '2026-07-23T09:00:00.000Z',
    }],
    ['eq', 'account_email', 'serve@softora.nl'],
    ['eq', 'folder', 'inbox'],
    ['eq', 'uid', 42],
    ['select', 'message_key'],
  ]);
});

test('mailbox index store herstelt uitsluitend het exact gekozen Softora-bericht', async () => {
  const calls = [];
  const query = {
    update(patch) {
      calls.push(['update', patch]);
      return query;
    },
    eq(column, value) {
      calls.push(['eq', column, value]);
      return query;
    },
    select(columns) {
      calls.push(['select', columns]);
      return query;
    },
    then(resolve) {
      resolve({ data: [{ message_key: 'serve@softora.nl|inbox|42' }], error: null });
    },
  };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      from(table) {
        calls.push(['from', table]);
        return query;
      },
    }),
    now: () => new Date('2026-07-23T09:05:00.000Z'),
  });

  const result = await store.restoreMessage({
    accountEmail: 'SERVE@SOFTORA.NL',
    folder: 'INBOX',
    id: 'inbox:42',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ['from', 'softora_mailbox_messages'],
    ['update', {
      deleted_at: null,
      updated_at: '2026-07-23T09:05:00.000Z',
    }],
    ['eq', 'account_email', 'serve@softora.nl'],
    ['eq', 'folder', 'inbox'],
    ['eq', 'uid', 42],
    ['select', 'message_key'],
  ]);
});

test('mailbox index sync laat ontbrekende tombstonevelden ongemoeid bij upsert', async () => {
  let upsertOptions = null;
  let upsertRows = null;
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      from() {
        return {
          async upsert(rows, options) {
            upsertRows = rows;
            upsertOptions = options;
            return { data: [], error: null };
          },
        };
      },
    }),
    now: () => new Date('2026-07-23T09:00:00.000Z'),
  });

  const result = await store.upsertMessages({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    messages: [{
      id: 'inbox:42',
      uid: 42,
      body: 'Reactie',
      date: '2026-07-23T08:30:00.000Z',
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(upsertRows[0], 'deleted_at'), false);
  assert.deepEqual(upsertOptions, {
    onConflict: 'message_key',
    defaultToNull: false,
  });
});

test('mailbox index store reads campaign inbox messages across selected accounts', async () => {
  const calls = [];
  const client = {
    from(table) {
      const query = {
        select(columns) {
          calls.push(['select', table, columns]);
          return query;
        },
        in(column, values) {
          calls.push(['in', column, values]);
          return query;
        },
        eq(column, value) {
          calls.push(['eq', column, value]);
          return query;
        },
        is(column, value) {
          calls.push(['is', column, value]);
          return query;
        },
        order(column, options) {
          calls.push(['order', column, options]);
          return query;
        },
        limit(value) {
          calls.push(['limit', value]);
          return Promise.resolve({
            data: [
              {
                account_email: 'serve@softora.nl',
                folder: 'inbox',
                uid: 42,
                provider_id: 'inbox:42',
                sender_name: 'Studio Noord',
                sender_email: 'info@studionoord.nl',
                subject: 'Re: Nieuw webdesign',
                date: '2026-07-20T10:15:00.000Z',
              },
            ],
            error: null,
          });
        },
      };
      return query;
    },
  };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    logger: { error() {}, info() {} },
  });

  const messages = await store.listMessagesForAccounts({
    accountEmails: ['Serve@Softora.nl', 'martijn@softora.nl'],
    folder: 'INBOX',
    limit: 2000,
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].accountEmail, 'serve@softora.nl');
  assert.equal(messages[0].email, 'info@studionoord.nl');
  assert.deepEqual(calls.find((call) => call[0] === 'in'), [
    'in',
    'account_email',
    ['serve@softora.nl', 'martijn@softora.nl'],
  ]);
  assert.deepEqual(calls.find((call) => call[0] === 'eq'), ['eq', 'folder', 'inbox']);
  assert.deepEqual(calls.find((call) => call[0] === 'limit'), ['limit', 2000]);
});

test('mailbox index store leest de volledige accountgeschiedenis gepagineerd', async () => {
  const ranges = [];
  const rows = Array.from({ length: MAILBOX_INDEX_PAGE_SIZE + 2 }, (_, index) => ({
    message_key: `martijn@softora.nl|sent|${index + 1}`,
    account_email: 'martijn@softora.nl',
    folder: 'sent',
    uid: index + 1,
    provider_id: `sent:${index + 1}`,
    sender_name: 'Martijn van de Ven',
    sender_email: 'martijn@softora.nl',
    recipients_text: `contact-${index}@example.test`,
    subject: 'Re: Kleine vraag over jullie website',
    date: new Date(Date.UTC(2026, 5, 30) - index * 1000).toISOString(),
  }));
  const client = {
    from() {
      const query = {
        select() { return query; },
        in() { return query; },
        eq() { return query; },
        is() { return query; },
        order() { return query; },
        range(from, to) {
          ranges.push([from, to]);
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
      };
      return query;
    },
  };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    logger: { error() {}, info() {} },
  });

  const messages = await store.listAllMessagesForAccounts({
    accountEmails: ['martijn@softora.nl'],
    folder: 'sent',
  });

  assert.equal(messages.length, MAILBOX_INDEX_PAGE_SIZE + 2);
  assert.deepEqual(ranges, [
    [0, MAILBOX_INDEX_PAGE_SIZE - 1],
    [MAILBOX_INDEX_PAGE_SIZE, (MAILBOX_INDEX_PAGE_SIZE * 2) - 1],
  ]);
  assert.equal(messages.at(-1).id, `sent:${MAILBOX_INDEX_PAGE_SIZE + 2}`);
});

test('mailbox index store filtert campagneberichten in SQL en dedupliceert overlappende termen', async () => {
  const subjectFilters = [];
  const ranges = [];
  const client = {
    from() {
      let subjectFilter = '';
      const query = {
        select() { return query; },
        in() { return query; },
        eq() { return query; },
        ilike(column, value) {
          assert.equal(column, 'subject');
          subjectFilter = value;
          subjectFilters.push(value);
          return query;
        },
        is() { return query; },
        order() { return query; },
        range(from, to) {
          ranges.push([from, to]);
          return Promise.resolve({
            data: [{
              message_key: 'serve@softora.nl|inbox|42',
              account_email: 'serve@softora.nl',
              folder: 'inbox',
              uid: 42,
              provider_id: 'inbox:42',
              sender_email: 'klant@example.test',
              subject: subjectFilter.includes('Kleine vraag')
                ? 'Re: Kleine vraag over jullie website'
                : 'Re: Nieuw webdesign',
              date: '2026-07-24T10:00:00.000Z',
            }],
            error: null,
          });
        },
      };
      return query;
    },
  };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    logger: { error() {}, info() {} },
  });

  const messages = await store.listMatchingMessagesForAccounts({
    accountEmails: ['SERVE@SOFTORA.NL'],
    folder: 'INBOX',
    subjectTerms: ['Kleine vraag over jullie website', 'Nieuw webdesign'],
    limit: 500,
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, 'inbox:42');
  assert.deepEqual(subjectFilters, [
    '%Kleine vraag over jullie website%',
    '%Nieuw webdesign%',
  ]);
  assert.deepEqual(ranges, [[0, 499], [0, 499]]);
});

test('mailbox index store haalt oude Sent-ouders gericht op internet-message-id op', async () => {
  const calls = [];
  const client = {
    from(table) {
      const filters = {};
      const query = {
        select(columns) {
          calls.push(['select', table, columns]);
          return query;
        },
        in(column, values) {
          filters[column] = values;
          calls.push(['in', column, values]);
          return query;
        },
        eq(column, value) {
          filters[column] = value;
          calls.push(['eq', column, value]);
          return query;
        },
        is(column, value) {
          calls.push(['is', column, value]);
          return Promise.resolve({
            data: [{
              message_key: 'serve@softora.nl|sent|62',
              account_email: 'serve@softora.nl',
              folder: 'sent',
              uid: 62,
              provider_id: 'sent:62',
              message_id: '<bizzylizzy-parent@softora.nl>',
              sender_email: 'serve@softora.nl',
              recipients_text: 'info@bizzylizzy.nl',
              subject: 'Kleine vraag over jullie website',
              preview: 'Goedendag,',
              date: '2026-06-01T10:33:11.000Z',
              payload: { originalCampaignOutbound: true },
            }],
            error: null,
          });
        },
      };
      return query;
    },
  };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    logger: { error() {}, info() {} },
  });

  const messages = await store.listMessagesByMessageIdsForAccounts({
    accountEmails: ['SERVE@SOFTORA.NL'],
    folder: 'SENT',
    messageIds: [
      '<bizzylizzy-parent@softora.nl>',
      '<bizzylizzy-parent@softora.nl>',
    ],
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, 'sent:62');
  assert.equal(messages[0].originalCampaignOutbound, true);
  assert.deepEqual(calls.filter((call) => call[0] === 'in'), [
    ['in', 'account_email', ['serve@softora.nl']],
    ['in', 'message_id', ['<bizzylizzy-parent@softora.nl>']],
  ]);
  assert.deepEqual(calls.find((call) => call[0] === 'eq'), ['eq', 'folder', 'sent']);
});

test('mailbox index store leest alleen uid-metadata voor begrensde syncselectie', async () => {
  const calls = [];
  const client = {
    from() {
      const query = {
        select(columns) {
          calls.push(['select', columns]);
          return query;
        },
        eq(column, value) {
          calls.push(['eq', column, value]);
          return query;
        },
        is(column, value) {
          calls.push(['is', column, value]);
          return query;
        },
        order(column, options) {
          calls.push(['order', column, options]);
          return query;
        },
        gte(column, value) {
          calls.push(['gte', column, value]);
          return query;
        },
        range(from, to) {
          calls.push(['range', from, to]);
          return Promise.resolve({
            data: [{ uid: 42 }, { uid: 42 }, { uid: 41 }],
            error: null,
          });
        },
      };
      return query;
    },
  };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    logger: { error() {}, info() {} },
  });

  const uids = await store.listMessageUidsForAccount({
    accountEmail: 'SERVE@SOFTORA.NL',
    folder: 'SENT',
    since: '2026-05-01T00:00:00.000Z',
    limit: 500,
  });

  assert.deepEqual(uids, [42, 41]);
  assert.deepEqual(calls.find((call) => call[0] === 'select'), ['select', 'uid']);
  assert.deepEqual(calls.find((call) => call[0] === 'gte'), [
    'gte',
    'date',
    '2026-05-01T00:00:00.000Z',
  ]);
  assert.deepEqual(calls.find((call) => call[0] === 'range'), ['range', 0, 499]);
});

test('mailbox index store hydrates only selected message bodies in one query', async () => {
  const calls = [];
  const client = {
    from(table) {
      calls.push(['from', table]);
      return {
        select(columns) {
          calls.push(['select', columns]);
          return this;
        },
        in(column, values) {
          calls.push(['in', column, values]);
          return this;
        },
        is(column, value) {
          calls.push(['is', column, value]);
          return Promise.resolve({
            data: [{
              message_key: 'serve@softora.nl|inbox|42',
              body_text: 'Dit is de volledige reactie.',
              has_body: true,
              body_truncated: false,
              payload: {
                embeddedImageCount: 0,
                originalCampaignOutbound: false,
              },
              folder: 'inbox',
              subject: 'Re: Kleine vraag over jullie website',
              preview: 'Dit is de korte preview.',
              in_reply_to: '<campaign@example.test>',
              references_text: '<campaign@example.test>',
            }],
            error: null,
          });
        },
      };
    },
  };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    logger: { error() {}, info() {} },
  });

  const messages = await store.hydrateMessageBodies({
    messages: [{
      id: 'inbox:42',
      uid: 42,
      accountEmail: 'serve@softora.nl',
      folder: 'inbox',
      preview: 'Dit is de korte preview.',
    }],
  });

  assert.equal(messages[0].body, 'Dit is de volledige reactie.');
  assert.equal(messages[0].hasBody, true);
  assert.equal(messages[0].bodyImageEvidenceKnown, true);
  assert.equal(messages[0].embeddedImageCount, 0);
  assert.equal(messages[0].originalCampaignOutbound, false);
  assert.deepEqual(calls.find((call) => call[0] === 'select'), [
    'select',
    'message_key,account_email,provider_id,body_text,has_body,body_truncated,payload,folder,subject,preview,in_reply_to,references_text',
  ]);
  assert.deepEqual(calls.find((call) => call[0] === 'in'), [
    'in',
    'message_key',
    ['serve@softora.nl|inbox|42'],
  ]);
});

test('mailbox index store hydrateert Instantly-body alleen via exact account en provider-id', async () => {
  const calls = [];
  const client = {
    from(table) {
      calls.push(['from', table]);
      const filters = {};
      return {
        select(columns) {
          calls.push(['select', columns]);
          return this;
        },
        eq(column, value) {
          filters[column] = value;
          calls.push(['eq', column, value]);
          return this;
        },
        in(column, values) {
          filters[column] = values;
          calls.push(['in', column, values]);
          return this;
        },
        is(column, value) {
          calls.push(['is', column, value]);
          return Promise.resolve({
            data: [{
              message_key: 'serve@websoftora.com|instantly|0',
              account_email: 'serve@websoftora.com',
              provider_id: 'instantly:abc-123',
              body_text: 'Exacte Instantly-body.',
              has_body: true,
              body_truncated: false,
              payload: {
                provider: 'instantly',
                direction: 'sent',
                providerOwner: 'serve',
                embeddedImageCount: 0,
                originalCampaignOutbound: true,
              },
              folder: 'instantly',
              subject: 'Kleine vraag over jullie website',
              preview: 'Korte preview',
              in_reply_to: '',
              references_text: '',
            }],
            error: null,
          });
        },
      };
    },
  };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    logger: { error() {}, info() {} },
  });

  const messages = await store.hydrateMessageBodies({
    messages: [{
      id: 'instantly:abc-123',
      uid: 0,
      accountEmail: 'serve@websoftora.com',
      folder: 'instantly',
      preview: 'Korte preview',
    }],
  });

  assert.equal(messages[0].body, 'Exacte Instantly-body.');
  assert.equal(messages[0].hasBody, true);
  assert.equal(messages[0].originalCampaignOutbound, true);
  assert.deepEqual(calls.find((call) => call[0] === 'eq'), ['eq', 'folder', 'instantly']);
  assert.deepEqual(
    calls.filter((call) => call[0] === 'in'),
    [
      ['in', 'account_email', ['serve@websoftora.com']],
      ['in', 'provider_id', ['instantly:abc-123']],
    ]
  );
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

test('mailbox index store opens a short cooldown after Supabase index timeouts', async () => {
  let readCalls = 0;
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
              readCalls += 1;
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
    mailboxIndexFailureCooldownMs: 1000,
    logger: {
      error: () => {},
      info: (...args) => loggerInfos.push(args),
    },
  });

  const first = await store.getSyncState({ accountEmail: 'info@softora.nl', folder: 'inbox' });
  const secondStartedAt = Date.now();
  const second = await store.getSyncState({ accountEmail: 'info@softora.nl', folder: 'inbox' });

  assert.equal(first, null);
  assert.equal(second, null);
  assert.equal(readCalls, 1);
  assert.ok(Date.now() - secondStartedAt < 100);
  assert.equal(
    loggerInfos.some((args) => args[0] === '[MailboxIndex][circuit-open][SoftError]'),
    true
  );
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
