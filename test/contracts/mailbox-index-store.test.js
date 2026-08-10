const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MAILBOX_INDEX_PAGE_SIZE,
  createMailboxIndexStore,
} = require('../../server/services/mailbox-index-store');
const {
  createMailboxCampaignMutationRunner,
} = require('../../server/services/mailbox-campaign-mutation-runner');
const {
  MAILBOX_CAMPAIGN_ATOMIC_COMMIT_RPC,
} = require('../../server/services/mailbox-index-atomic-commit');

function createMailboxIndexClient() {
  const stateRows = new Map();
  const rpcCalls = [];
  return {
    rpcCalls,
    stateRows,
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name !== 'softora_claim_mailbox_sync_lock') {
        return { data: null, error: new Error(`Onverwachte RPC: ${name}`) };
      }
      const current = stateRows.get(args.p_sync_key);
      if (current?.status === 'syncing' && current.lock_token) {
        return {
          data: [{
            acquired: false,
            locked: true,
            claimed_lock_token: null,
            lock_expires_at: current.lock_expires_at,
          }],
          error: null,
        };
      }
      const lockExpiresAt = new Date(Date.now() + (args.p_lock_ttl_seconds * 1000)).toISOString();
      stateRows.set(args.p_sync_key, {
        ...(current || {}),
        sync_key: args.p_sync_key,
        account_email: args.p_account_email,
        folder: args.p_folder,
        status: 'syncing',
        lock_token: args.p_lock_token,
        lock_expires_at: lockExpiresAt,
      });
      return {
        data: [{
          acquired: true,
          locked: false,
          claimed_lock_token: args.p_lock_token,
          lock_expires_at: lockExpiresAt,
        }],
        error: null,
      };
    },
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
              return this;
            },
            async select() {
              const current = stateRows.get(filters.sync_key);
              if (!current || current.lock_token !== filters.lock_token) {
                return { data: [], error: null };
              }
              stateRows.set(filters.sync_key, { ...current, ...patch });
              return { data: [{ sync_key: filters.sync_key }], error: null };
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
    autoSubmitted: '',
    precedence: '',
    autoResponseSuppress: '',
    automatedReplyEvidence: false,
    softoraConversationId: '',
    softoraSendIntentId: '',
    softoraSendMode: '',
    softoraReplyTargetMessageId: '',
    softoraThreadProvenanceKnown: false,
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

test('mailbox index store preserves durable Softora thread provenance from MIME headers', () => {
  const store = createMailboxIndexStore({
    now: () => new Date('2026-08-05T20:00:00.000Z'),
  });
  const row = store.buildMessageRow({
    id: 'sent:216',
    uid: 216,
    folder: 'sent',
    accountEmail: 'contact.venvisuals@gmail.com',
    email: 'contact.venvisuals@gmail.com',
    to: 'info@blue-monkey.nl',
    subject: 'Re: Kleine vraag over jullie website',
    body: 'Dankjewel.',
    date: '2026-08-05T18:26:02.000Z',
    messageId: '<blue-sent@gmail.com>',
    inReplyTo: '<blue-inbound@example.nl>',
    references: '<blue-original@example.nl> <blue-inbound@example.nl>',
    softoraConversationId: 'conversation:blue',
    softoraSendIntentId: 'send:blue',
    softoraSendMode: 'reply',
    softoraReplyTargetMessageId: '<blue-inbound@example.nl>',
    softoraThreadProvenanceKnown: true,
  }, 'contact.venvisuals@gmail.com', 'sent');

  const restored = store.normalizeMessageRow(row, { includeBody: true });
  assert.equal(restored.softoraConversationId, 'conversation:blue');
  assert.equal(restored.softoraSendIntentId, 'send:blue');
  assert.equal(restored.softoraSendMode, 'reply');
  assert.equal(restored.softoraReplyTargetMessageId, '<blue-inbound@example.nl>');
  assert.equal(restored.softoraThreadProvenanceKnown, true);
});

test('mailbox index treats a stored direct To header as exact routing evidence for legacy rows', () => {
  const store = createMailboxIndexStore();
  const restored = store.normalizeMessageRow({
    message_key: 'martijnven123@gmail.com|sent|526',
    account_email: 'martijnven123@gmail.com',
    folder: 'sent',
    uid: 526,
    provider_id: 'sent:526',
    sender_name: 'Martijn van de Ven',
    sender_email: 'martijnven123@gmail.com',
    recipients_text: 'jolanda.meijden@bogaerstalen.nl',
    subject: 'Re: Kleine vraag over jullie website',
    body_text: 'Ik wilde nog even kort vragen of je al naar de preview hebt gekeken.',
    has_body: true,
    body_truncated: false,
    date: '2026-06-25T12:32:49.000Z',
    payload: { source: 'imap-sync' },
  }, { includeBody: true });

  assert.equal(restored.to, 'jolanda.meijden@bogaerstalen.nl');
  assert.equal(restored.recipientRoutingEvidenceKnown, true);

  const unknown = store.normalizeMessageRow({
    message_key: 'martijnven123@gmail.com|sent|527',
    account_email: 'martijnven123@gmail.com',
    folder: 'sent',
    uid: 527,
    provider_id: 'sent:527',
    sender_email: 'martijnven123@gmail.com',
    recipients_text: '',
    subject: 'Legacy zonder ontvanger',
    date: '2026-06-25T12:40:00.000Z',
    payload: { source: 'imap-sync' },
  });
  assert.equal(unknown.recipientRoutingEvidenceKnown, false);
});

test('mailbox index performs one bounded targeted lookup for old unthreaded Sent candidates', async () => {
  const rpcCalls = [];
  const client = {
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      return {
        error: null,
        data: [{
          target_conversation_id: 'conversation:blue',
          message: {
            message_key: 'contact.venvisuals@gmail.com|sent|216',
            account_email: 'contact.venvisuals@gmail.com',
            folder: 'sent',
            uid: 216,
            provider_id: 'sent:216',
            message_id: '<blue-sent@gmail.com>',
            in_reply_to: '',
            references_text: '',
            sender_name: 'Martijn van de Ven',
            sender_email: 'contact.venvisuals@gmail.com',
            recipients_text: 'info@blue-monkey.nl',
            subject: 'Re: Kleine vraag over jullie website',
            preview: 'Dankjewel.',
            body_text: 'Dankjewel.',
            body_truncated: false,
            has_body: true,
            date: '2026-08-05T18:26:02.000Z',
            unread: false,
            starred: false,
            payload: {},
          },
        }],
      };
    },
  };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
  });
  const rows = await store.listUnthreadedSentCandidatesForConversations({
    targets: [{
      conversationId: 'conversation:blue',
      accountEmail: 'contact.venvisuals@gmail.com',
      counterpartyEmail: 'info@blue-monkey.nl',
      canonicalSubject: 'kleine vraag over jullie website',
      latestInboundAt: '2026-06-25T13:27:19.000Z',
    }],
  });

  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, 'softora_find_mailbox_unthreaded_sent_candidates');
  assert.equal(rpcCalls[0].args.p_targets[0].account_email, 'contact.venvisuals@gmail.com');
  assert.equal(rows[0].targetConversationId, 'conversation:blue');
  assert.equal(rows[0].message.id, 'sent:216');
});

test('mailbox index zoekt forwarded parentmails per exact account, onderwerp en ontvanger met body', async () => {
  const calls = [];
  const row = {
    message_key: 'martijn@softora.nl|sent|242',
    account_email: 'martijn@softora.nl',
    folder: 'sent',
    uid: 242,
    provider_id: 'sent:242',
    message_id: '<ttv-original@softora.nl>',
    sender_email: 'martijn@softora.nl',
    recipients_text: 'info@ttvirene.nl',
    subject: 'Kleine vraag over jullie website',
    preview: 'Goedendag, afgelopen week kwam ik jullie website ttvirene.nl tegen.',
    body_text: 'Goedendag,\n\nAfgelopen week kwam ik jullie website ttvirene.nl tegen.',
    body_truncated: false,
    has_body: true,
    date: '2026-07-16T09:56:41.000Z',
    payload: { originalCampaignOutbound: true },
  };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      from(table) {
        const query = {
          select(columns) { calls.push(['select', table, columns]); return query; },
          eq(column, value) { calls.push(['eq', column, value]); return query; },
          ilike(column, value) { calls.push(['ilike', column, value]); return query; },
          is(column, value) { calls.push(['is', column, value]); return query; },
          order(column, options) { calls.push(['order', column, options]); return query; },
          limit(value) {
            calls.push(['limit', value]);
            return Promise.resolve({ data: [row], error: null });
          },
        };
        return query;
      },
    }),
  });

  const messages = await store.listSentCandidatesForQuotedReplies({
    targets: [{
      accountEmail: 'MARTIJN@SOFTORA.NL',
      canonicalSubject: 'kleine vraag over jullie website',
      recipientEmail: 'INFO@TTVIRENE.NL',
    }],
    limitPerTarget: 10,
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, 'sent:242');
  assert.match(messages[0].body, /ttvirene\.nl/);
  assert.deepEqual(calls.filter((call) => call[0] === 'eq'), [
    ['eq', 'account_email', 'martijn@softora.nl'],
    ['eq', 'folder', 'sent'],
  ]);
  assert.deepEqual(calls.filter((call) => call[0] === 'ilike'), [
    ['ilike', 'subject', '%kleine vraag over jullie website%'],
    ['ilike', 'recipients_text', '%info@ttvirene.nl%'],
  ]);
  assert.deepEqual(calls.find((call) => call[0] === 'limit'), ['limit', 10]);
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
  assert.equal(Object.hasOwn(row, 'softora_read_at'), false);

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

test('mailbox index store laat een duurzame Softora-leesactie voorgaan op provider unread', () => {
  const store = createMailboxIndexStore({
    now: () => new Date('2026-08-05T16:00:00.000Z'),
  });
  const row = store.buildProviderMessageRow({
    provider: 'instantly',
    providerMessageId: 'provider-unread-1',
    providerThreadId: 'provider-thread-1',
    providerAccountEmail: 'serve-sender@example.com',
    providerOwner: 'serve',
    accountEmail: 'serve-sender@example.com',
    folder: 'inbox',
    direction: 'received',
    email: 'prospect@example.org',
    subject: 'Re: Website',
    body: 'Reactie',
    date: '2026-08-05T15:58:00.000Z',
    unread: true,
  });

  assert.equal(store.normalizeMessageRow({
    ...row,
    softora_read_at: null,
  }).unread, true);
  const opened = store.normalizeMessageRow({
    ...row,
    unread: true,
    softora_read_at: '2026-08-05T15:59:00.000Z',
  });
  assert.equal(opened.unread, false);
  assert.equal(opened.readAt, '2026-08-05T15:59:00.000Z');
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
    ['update', {
      unread: false,
      softora_read_at: '2026-07-22T14:00:00.000Z',
      updated_at: '2026-07-22T14:00:00.000Z',
    }],
    ['eq', 'account_email', 'serve@softora.nl'],
    ['eq', 'folder', 'inbox'],
    ['is', 'deleted_at', null],
    ['eq', 'uid', 42],
  ]);
});

test('mailbox index store handelt de antwoordherinnering duurzaam af', async () => {
  const calls = [];
  const dismissedAt = '2026-08-04T15:10:00.000Z';
  const query = {
    update(patch) { calls.push(['update', patch]); return query; },
    eq(column, value) { calls.push(['eq', column, value]); return query; },
    is(column, value) { calls.push(['is', column, value]); return query; },
    select(columns) { calls.push(['select', columns]); return query; },
    then(resolve) {
      resolve({ data: [{ message_key: 'serve@softora.nl|inbox|42', reply_dismissed_at: dismissedAt }], error: null });
    },
  };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({ from: (table) => { calls.push(['from', table]); return query; } }),
    now: () => new Date(dismissedAt),
  });

  const result = await store.markMessageReplyDismissed({
    accountEmail: 'SERVE@SOFTORA.NL',
    folder: 'INBOX',
    id: 'inbox:42',
  });

  assert.equal(result.ok, true);
  assert.equal(result.dismissedAt, dismissedAt);
  assert.deepEqual(calls, [
    ['from', 'softora_mailbox_messages'],
    ['update', {
      unread: false,
      softora_read_at: dismissedAt,
      reply_dismissed_at: dismissedAt,
      updated_at: dismissedAt,
    }],
    ['eq', 'account_email', 'serve@softora.nl'],
    ['eq', 'folder', 'inbox'],
    ['is', 'deleted_at', null],
    ['eq', 'uid', 42],
    ['select', 'message_key,reply_dismissed_at'],
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

test('mailbox index campaign-upsert koppelt de harde abortsignal aan PostgREST', async () => {
  const controller = new AbortController();
  let attachedSignal = null;
  let rpcCall = null;
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      rpc(name, args) {
        rpcCall = { name, args };
        return {
          abortSignal(signal) {
            attachedSignal = signal;
            return Promise.resolve({
              data: [{ mutation_status: 'completed', upserted_count: 1 }],
              error: null,
            });
          },
        };
      },
    }),
  });

  const result = await store.upsertMessages({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    signal: controller.signal,
    mutationId: '11111111-1111-4111-8111-111111111111',
    requestKey: 'imap-sync:test-42',
    messages: [{ id: 'inbox:42', uid: 42, date: '2026-08-09T20:00:00.000Z' }],
  });

  assert.equal(result.ok, true);
  assert.ok(attachedSignal);
  assert.notEqual(attachedSignal, controller.signal);
  assert.equal(attachedSignal.aborted, false);
  assert.equal(rpcCall.name, MAILBOX_CAMPAIGN_ATOMIC_COMMIT_RPC);
  assert.equal(rpcCall.args.p_request_key, 'imap-sync:test-42');
  assert.equal(rpcCall.args.p_rows[0].message_key, 'serve@softora.nl|inbox|42');
});

test('non-campaign syncwrite gebruikt abortbare PostgREST zonder atomische campaign-RPC', async () => {
  const controller = new AbortController();
  let attachedSignal = null;
  let rpcCalls = 0;
  let upsertCalls = 0;
  const query = {
    abortSignal(signal) {
      attachedSignal = signal;
      return Promise.resolve({ data: [], error: null });
    },
  };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      rpc() { rpcCalls += 1; return query; },
      from() {
        return {
          upsert() { upsertCalls += 1; return query; },
        };
      },
    }),
  });

  const result = await store.upsertMessages({
    accountEmail: 'beheer@example.test',
    folder: 'inbox',
    signal: controller.signal,
    messages: [{ id: 'inbox:7', uid: 7, date: '2026-08-09T20:00:00.000Z' }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.upserted, 1);
  assert.equal(rpcCalls, 0);
  assert.equal(upsertCalls, 1);
  assert.ok(attachedSignal);
  assert.notEqual(attachedSignal, controller.signal);
});

test('mailbox index Instantly-upsert koppelt dezelfde harde abortsignal aan PostgREST', async () => {
  const controller = new AbortController();
  let attachedSignal = null;
  const query = {
    abortSignal(signal) {
      attachedSignal = signal;
      return Promise.resolve({
        data: [{ mutation_status: 'completed', upserted_count: 1 }],
        error: null,
      });
    },
  };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      rpc: () => query,
    }),
  });

  const result = await store.upsertProviderMessages({
    provider: 'instantly',
    signal: controller.signal,
    mutationId: '22222222-2222-4222-8222-222222222222',
    requestKey: 'instantly-upsert:test-reply-1',
    messages: [{
      providerMessageId: 'reply-1',
      providerAccountEmail: 'serve@websoftora.com',
      providerOwner: 'serve',
      date: '2026-08-09T19:00:00.000Z',
      subject: 'Re: Website',
    }],
  });

  assert.equal(result.ok, true);
  assert.ok(attachedSignal);
  assert.notEqual(attachedSignal, controller.signal);
  assert.equal(attachedSignal.aborted, false);
});

test('Instantly provider-read koppelt caller abort aan de actieve PostgREST-query', async () => {
  const controller = new AbortController();
  let attachedSignal = null;
  const query = {
    select() { return this; },
    eq() { return this; },
    in() { return this; },
    is() { return this; },
    order() { return this; },
    limit() { return this; },
    abortSignal(signal) {
      attachedSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({ from: () => query }),
    mailboxIndexFailureCooldownMs: 0,
    logger: { error() {}, info() {} },
  });
  const running = store.listProviderMessages({
    provider: 'instantly',
    accountEmails: ['serve@websoftora.com'],
    signal: controller.signal,
  });
  await new Promise((resolve) => setImmediate(resolve));
  const reason = Object.assign(new Error('owner deadline'), {
    code: 'INSTANTLY_SYNC_OWNER_TIMEOUT', timedOut: true,
  });
  controller.abort(reason);

  assert.equal(await running, null);
  assert.ok(attachedSignal);
  assert.equal(attachedSignal.aborted, true);
  assert.equal(attachedSignal.reason, reason);
});

test('alle campaign history pre-reads dragen de folderdeadline naar PostgREST', async () => {
  const controller = new AbortController();
  const attachedSignals = [];
  const createQuery = () => {
    const query = {
      select() { return this; },
      in() { return this; },
      eq() { return this; },
      ilike() { return this; },
      is() { return this; },
      gte() { return this; },
      order() { return this; },
      range() { return this; },
      limit() { return this; },
      abortSignal(signal) {
        attachedSignals.push(signal);
        return Promise.resolve({ data: [], error: null });
      },
    };
    return query;
  };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({ from: () => createQuery() }),
  });

  await store.listAllMessagesForAccounts({
    accountEmails: ['serve@softora.nl'], folder: 'inbox', limit: 1,
    signal: controller.signal,
  });
  await store.listMatchingMessagesForAccounts({
    accountEmails: ['serve@softora.nl'], folder: 'inbox', subjectTerms: ['kleine vraag'],
    limit: 1, signal: controller.signal,
  });
  await store.listMessageUidsForAccount({
    accountEmail: 'serve@softora.nl', folder: 'inbox', limit: 1,
    signal: controller.signal,
  });
  await store.getOldestMatchingMessageUid({
    accountEmail: 'serve@softora.nl', folder: 'inbox', subjectTerms: ['kleine vraag'],
    signal: controller.signal,
  });

  assert.equal(attachedSignals.length, 4);
  attachedSignals.forEach((signal) => {
    assert.notEqual(signal, controller.signal);
    assert.equal(signal.aborted, false);
  });
});

test('late niet-cooperatieve campaign writes settelen vóór journal-completion en onzekere abort blijft pending', async () => {
  function deferredWrite({ rejectOnAbort = false } = {}) {
    let resolveWrite;
    let rejectWrite;
    let resolveAborted;
    const promise = new Promise((resolve, reject) => {
      resolveWrite = resolve;
      rejectWrite = reject;
    });
    const aborted = new Promise((resolve) => { resolveAborted = resolve; });
    return {
      aborted,
      query: {
        abortSignal(signal) {
          signal.addEventListener('abort', () => {
            resolveAborted();
            if (rejectOnAbort) rejectWrite(new Error('HTTP-request geannuleerd'));
          }, { once: true });
          return promise;
        },
      },
      commit() {
        resolveWrite({
          data: [{ mutation_status: 'completed', upserted_count: 1 }],
          error: null,
        });
      },
    };
  }

  const lateImap = deferredWrite();
  const lateProvider = deferredWrite();
  const uncertainImap = deferredWrite({ rejectOnAbort: true });
  const imapQueries = [lateImap.query, uncertainImap.query];
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      rpc(_name, args) {
        return args.p_rows[0]?.folder === 'instantly' ? lateProvider.query : imapQueries.shift();
      },
    }),
    mailboxIndexQueryTimeoutMs: 250,
    mailboxIndexFailureCooldownMs: 0,
    logger: { error() {}, info() {} },
  });
  let mutationSequence = 0;
  const committed = new Set();
  const completions = [];
  const runner = createMailboxCampaignMutationRunner({
    mailboxCampaignConsistencyStore: {
      isAvailable: () => true,
      beginMutation: async () => ({
        mutationId: `11111111-1111-4111-8111-${String(++mutationSequence).padStart(12, '0')}`,
        status: 'pending',
        replayed: false,
      }),
      completeMutation: async (input) => {
        assert.equal(committed.has(input.requestKey), true, 'journal completed vóór write-settlement');
        completions.push(input);
      },
    },
  });
  const runIndexedWrite = (requestKey, kind, write) => runner.run({
    requestKey,
    kind,
  }, async (context) => {
    const result = await write(context);
    if (!result.ok) throw result.error;
    return result;
  });
  const lateImapRun = runIndexedWrite('late-imap', 'imap-sync', (context) => store.upsertMessages({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    signal: context.signal, mutationId: context.mutationId, requestKey: context.requestKey,
    messages: [{ id: 'inbox:42', uid: 42, date: '2026-08-09T20:00:00.000Z' }],
  }));
  const lateProviderRun = runIndexedWrite('late-provider', 'instantly-upsert', (context) => store.upsertProviderMessages({
    provider: 'instantly',
    signal: context.signal, mutationId: context.mutationId, requestKey: context.requestKey,
    messages: [{
      providerMessageId: 'reply-late',
      providerAccountEmail: 'serve@websoftora.com',
      providerOwner: 'serve',
      date: '2026-08-09T20:01:00.000Z',
      subject: 'Re: Website',
    }],
  }));
  const uncertainRun = runIndexedWrite('uncertain-imap', 'imap-sync', (context) => store.upsertMessages({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    signal: context.signal, mutationId: context.mutationId, requestKey: context.requestKey,
    messages: [{ id: 'inbox:43', uid: 43, date: '2026-08-09T20:02:00.000Z' }],
  }));
  const uncertainAssertion = assert.rejects(uncertainRun, {
    code: 'MAILBOX_INDEX_WRITE_OUTCOME_UNKNOWN',
    leaveMutationPending: true,
  });

  await Promise.all([lateImap.aborted, lateProvider.aborted, uncertainImap.aborted]);
  assert.equal(completions.length, 0);
  committed.add('late-imap');
  lateImap.commit();
  committed.add('late-provider');
  lateProvider.commit();

  const [imapResult, providerResult] = await Promise.all([lateImapRun, lateProviderRun]);
  await uncertainAssertion;
  assert.equal(imapResult.ok, true);
  assert.equal(providerResult.ok, true);
  assert.deepEqual(completions.map((item) => item.requestKey).sort(), [
    'late-imap',
    'late-provider',
  ]);
  assert.equal(completions.every((item) => item.result.ok === true), true);
});

test('deadline → reap-poging → late atomische commit maakt de fence nooit voortijdig ready', async () => {
  let deadlineCallback = null;
  let resolveTransactionStarted;
  let resolveTransactionLock;
  let commitTransaction;
  let completes = 0;
  const transactionStarted = new Promise((resolve) => { resolveTransactionStarted = resolve; });
  const transactionLock = new Promise((resolve) => { resolveTransactionLock = resolve; });
  const database = { contentVersion: 0, messages: [], mutationStatus: 'pending', locked: false };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    mailboxIndexQueryTimeoutMs: 10_000,
    mailboxIndexFailureCooldownMs: 0,
    logger: { error() {}, info() {} },
    getSupabaseClient: () => ({
      rpc(name, args) {
        assert.equal(name, MAILBOX_CAMPAIGN_ATOMIC_COMMIT_RPC);
        return {
          abortSignal() {
            database.locked = true;
            resolveTransactionStarted();
            return new Promise((resolve) => {
              commitTransaction = () => {
                database.messages.push(...args.p_rows);
                database.contentVersion += 1;
                database.mutationStatus = 'completed';
                database.locked = false;
                resolve({
                  data: [{ mutation_status: 'completed', upserted_count: args.p_rows.length }],
                  error: null,
                });
                resolveTransactionLock();
              };
            });
          },
        };
      },
    }),
  });
  const runner = createMailboxCampaignMutationRunner({
    mailboxCampaignConsistencyStore: {
      isAvailable: () => true,
      beginMutation: async () => ({
        mutationId: '33333333-3333-4333-8333-333333333333',
        status: 'pending',
        replayed: false,
      }),
      completeMutation: async () => { completes += 1; },
    },
    setTimer(callback) {
      deadlineCallback = callback;
      return { unref() {} };
    },
    clearTimer() {},
  });
  const running = runner.run({
    requestKey: 'imap-sync:late-atomic',
    kind: 'imap-sync',
  }, async (context) => {
    const result = await store.upsertMessages({
      accountEmail: 'serve@softora.nl',
      folder: 'inbox',
      signal: context.signal,
      mutationId: context.mutationId,
      requestKey: context.requestKey,
      messages: [{ id: 'inbox:99', uid: 99, date: '2026-08-09T20:03:00.000Z' }],
    });
    if (!result.ok) throw result.error;
    return result;
  });

  await transactionStarted;
  deadlineCallback();
  await assert.rejects(running, { code: 'MAILBOX_CAMPAIGN_MUTATION_DEADLINE' });
  assert.equal(completes, 0);

  let fenceSettled = false;
  const fenceAttempt = (async () => {
    if (database.locked) await transactionLock;
    let reapedCount = 0;
    if (database.mutationStatus === 'pending') {
      database.mutationStatus = 'abandoned';
      reapedCount = 1;
    }
    return {
      contentVersion: database.contentVersion,
      ready: database.mutationStatus !== 'pending',
      reapedCount,
    };
  })().then((result) => { fenceSettled = true; return result; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fenceSettled, false, 'fence werd ready terwijl de DB-transactie nog kon committen');

  commitTransaction();
  const fence = await fenceAttempt;
  assert.deepEqual(fence, { contentVersion: 1, ready: true, reapedCount: 0 });
  assert.equal(database.messages.length, 1);
  assert.equal(database.mutationStatus, 'completed');
});

test('deadline → concurrent reap → RPC-rollback levert ready zonder late data', async () => {
  let deadlineCallback = null;
  let resolveTransactionStarted;
  let resolveTransactionLock;
  let rollbackTransaction;
  const transactionStarted = new Promise((resolve) => { resolveTransactionStarted = resolve; });
  const transactionLock = new Promise((resolve) => { resolveTransactionLock = resolve; });
  const database = { contentVersion: 0, messages: [], mutationStatus: 'pending', locked: false };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    mailboxIndexQueryTimeoutMs: 10_000,
    mailboxIndexFailureCooldownMs: 0,
    logger: { error() {}, info() {} },
    getSupabaseClient: () => ({
      rpc() {
        return {
          abortSignal() {
            database.locked = true;
            resolveTransactionStarted();
            return new Promise((resolve) => {
              rollbackTransaction = () => {
                database.locked = false;
                resolve({ data: null, error: { code: '57014', message: 'rollback' } });
                resolveTransactionLock();
              };
            });
          },
        };
      },
    }),
  });
  const runner = createMailboxCampaignMutationRunner({
    mailboxCampaignConsistencyStore: {
      isAvailable: () => true,
      beginMutation: async () => ({
        mutationId: '44444444-4444-4444-8444-444444444444',
        status: 'pending',
        replayed: false,
      }),
      completeMutation: async () => assert.fail('onzekere rollback mag niet completeren'),
    },
    setTimer(callback) {
      deadlineCallback = callback;
      return { unref() {} };
    },
    clearTimer() {},
  });
  const running = runner.run({ requestKey: 'imap-sync:rollback', kind: 'imap-sync' },
    async (context) => {
      const result = await store.upsertMessages({
        accountEmail: 'serve@softora.nl', folder: 'inbox', signal: context.signal,
        mutationId: context.mutationId, requestKey: context.requestKey,
        messages: [{ id: 'inbox:100', uid: 100, date: '2026-08-09T20:04:00.000Z' }],
      });
      if (!result.ok) throw result.error;
      return result;
    });

  await transactionStarted;
  deadlineCallback();
  await assert.rejects(running, { code: 'MAILBOX_CAMPAIGN_MUTATION_DEADLINE' });
  let fenceSettled = false;
  const fenceAttempt = (async () => {
    if (database.locked) await transactionLock;
    if (database.mutationStatus === 'pending') database.mutationStatus = 'abandoned';
    return { contentVersion: database.contentVersion, ready: true, reapedCount: 1 };
  })().then((result) => { fenceSettled = true; return result; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fenceSettled, false);

  rollbackTransaction();
  assert.deepEqual(await fenceAttempt, { contentVersion: 0, ready: true, reapedCount: 1 });
  assert.deepEqual(database.messages, []);
  assert.equal(database.mutationStatus, 'abandoned');
});

test('reaper wint vóór een gequeue-de RPC en die late RPC schrijft niets na ready', async () => {
  let deadlineCallback = null;
  let startQueuedRpc;
  const database = { messages: [], mutationStatus: 'pending' };
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    mailboxIndexQueryTimeoutMs: 10_000,
    mailboxIndexFailureCooldownMs: 0,
    logger: { error() {}, info() {} },
    getSupabaseClient: () => ({
      rpc(_name, args) {
        return {
          abortSignal() {
            return new Promise((resolve) => {
              startQueuedRpc = () => {
                if (database.mutationStatus !== 'pending') {
                  resolve({ data: null, error: { code: '55000', message: 'niet schrijfbaar' } });
                  return;
                }
                database.messages.push(...args.p_rows);
                database.mutationStatus = 'completed';
                resolve({ data: [{ mutation_status: 'completed', upserted_count: 1 }], error: null });
              };
            });
          },
        };
      },
    }),
  });
  const runner = createMailboxCampaignMutationRunner({
    mailboxCampaignConsistencyStore: {
      isAvailable: () => true,
      beginMutation: async () => ({
        mutationId: '55555555-5555-4555-8555-555555555555',
        status: 'pending',
        replayed: false,
      }),
      completeMutation: async () => assert.fail('deadline mag niet completeren'),
    },
    setTimer(callback) {
      deadlineCallback = callback;
      return { unref() {} };
    },
    clearTimer() {},
  });
  const running = runner.run({ requestKey: 'imap-sync:queued', kind: 'imap-sync' },
    async (context) => {
      const result = await store.upsertMessages({
        accountEmail: 'serve@softora.nl', folder: 'inbox', signal: context.signal,
        mutationId: context.mutationId, requestKey: context.requestKey,
        messages: [{ id: 'inbox:101', uid: 101, date: '2026-08-09T20:05:00.000Z' }],
      });
      if (!result.ok) throw result.error;
      return result;
    });

  await new Promise((resolve) => setImmediate(resolve));
  deadlineCallback();
  await assert.rejects(running, { code: 'MAILBOX_CAMPAIGN_MUTATION_DEADLINE' });
  database.mutationStatus = 'abandoned';
  const fence = { ready: true, reapedCount: 1 };
  startQueuedRpc();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fence, { ready: true, reapedCount: 1 });
  assert.deepEqual(database.messages, []);
  assert.equal(database.mutationStatus, 'abandoned');
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

test('mailbox index store haalt alleen exacte Sent-descendants binnen hetzelfde account op', async () => {
  const calls = [];
  const rows = [{
    message_key: 'serve@softora.nl|sent|71',
    account_email: 'serve@softora.nl',
    folder: 'sent',
    uid: 71,
    provider_id: 'sent:71',
    message_id: '<brigit-follow-up@softora.nl>',
    in_reply_to: '<brigit-reply@example.nl>',
    references_text: '<brigit-parent@softora.nl>, <brigit-reply@example.nl>',
    sender_email: 'serve@softora.nl',
    recipients_text: 'info@bizzylizzy.nl',
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Dankjewel voor je reactie.',
    date: '2026-06-02T11:12:14.000Z',
    payload: {},
  }, {
    message_key: 'martijn@softora.nl|sent|72',
    account_email: 'martijn@softora.nl',
    folder: 'sent',
    uid: 72,
    provider_id: 'sent:72',
    message_id: '<cross-owner@softora.nl>',
    in_reply_to: '<brigit-reply@example.nl>',
    references_text: '<brigit-reply@example.nl>',
    sender_email: 'martijn@softora.nl',
    recipients_text: 'info@bizzylizzy.nl',
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Dit bericht hoort niet bij Servé.',
    date: '2026-06-02T11:13:14.000Z',
    payload: {},
  }, {
    message_key: 'serve@softora.nl|sent|73',
    account_email: 'serve@softora.nl',
    folder: 'sent',
    uid: 73,
    provider_id: 'sent:73',
    message_id: '<substring@softora.nl>',
    in_reply_to: '',
    references_text: '<not-brigit-reply@example.nl>',
    sender_email: 'serve@softora.nl',
    recipients_text: 'someone@example.nl',
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Alleen een substringmatch.',
    date: '2026-06-02T11:14:14.000Z',
    payload: {},
  }];
  const client = {
    from(table) {
      const query = {
        select(columns) {
          calls.push(['select', table, columns]);
          return query;
        },
        eq(column, value) {
          calls.push(['eq', column, value]);
          return query;
        },
        in(column, values) {
          calls.push(['in', column, values]);
          return query;
        },
        or(filters) {
          calls.push(['or', filters]);
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
        range(from, to) {
          calls.push(['range', from, to]);
          return Promise.resolve({ data: rows, error: null });
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

  const descendants = await store.listMessagesReferencingMessageIdsForAccounts({
    accountEmails: ['SERVE@SOFTORA.NL'],
    folder: 'SENT',
    messageIds: ['<brigit-reply@example.nl>'],
  });

  assert.deepEqual(descendants.map((message) => message.id), ['sent:71']);
  assert.ok(calls.some((call) => call[0] === 'eq' && call[1] === 'account_email' && call[2] === 'serve@softora.nl'));
  assert.ok(calls.some((call) => call[0] === 'eq' && call[1] === 'folder' && call[2] === 'sent'));
  assert.ok(calls.some((call) => call[0] === 'or' && call[1].includes('in_reply_to')));
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
                recipientRoutingEvidenceKnown: true,
                toDisplay: 'Servé Creusen <serve@softora.nl>',
                cc: 'team@example.nl',
                bcc: '',
                deliveredTo: 'serve@softora.nl',
                attachments: [{ filename: 'reactie.txt', contentType: 'text/plain', size: 12 }],
              },
              recipients_text: 'serve@softora.nl',
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
  assert.equal(messages[0].to, 'serve@softora.nl');
  assert.equal(messages[0].toDisplay, 'Servé Creusen <serve@softora.nl>');
  assert.equal(messages[0].cc, 'team@example.nl');
  assert.equal(messages[0].recipientRoutingEvidenceKnown, true);
  assert.deepEqual(messages[0].attachments, [{ filename: 'reactie.txt', contentType: 'text/plain', size: 12 }]);
  assert.deepEqual(calls.find((call) => call[0] === 'select'), [
    'select',
    'message_key,account_email,provider_id,body_text,has_body,body_truncated,payload,folder,subject,preview,in_reply_to,references_text,recipients_text',
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
                recipientRoutingEvidenceKnown: true,
                toDisplay: 'Prospect <prospect@example.org>',
              },
              recipients_text: 'prospect@example.org',
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
  assert.equal(messages[0].to, 'prospect@example.org');
  assert.equal(messages[0].toDisplay, 'Prospect <prospect@example.org>');
  assert.equal(messages[0].recipientRoutingEvidenceKnown, true);
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
  const forced = await store.acquireSyncLock({
    accountEmail: 'info@softora.nl', folder: 'inbox', force: true,
  });

  assert.equal(first.ok, true);
  assert.equal(second.locked, true);
  assert.equal(forced.locked, true);
  assert.equal(client.rpcCalls.length, 3);
  assert.equal(client.rpcCalls[0].name, 'softora_claim_mailbox_sync_lock');
  assert.equal(client.rpcCalls[0].args.p_sync_key, 'info@softora.nl|inbox');
  assert.equal(client.rpcCalls[0].args.p_force, false);
  assert.equal(client.rpcCalls[2].args.p_force, true);

  const staleFinish = await store.finishSync({
    accountEmail: 'info@softora.nl', folder: 'inbox', lockToken: 'stale-token',
  });
  assert.equal(staleFinish.ok, false);
  assert.equal(staleFinish.lockLost, true);

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

test('mailbox index lockclaim faalt gesloten als de database-RPC ontbreekt', async () => {
  let directStateWrites = 0;
  const rpcError = Object.assign(new Error('RPC ontbreekt'), { code: 'PGRST202' });
  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      async rpc() { return { data: null, error: rpcError }; },
      from() {
        directStateWrites += 1;
        return { upsert: async () => ({ data: [], error: null }) };
      },
    }),
    logger: { error() {} },
  });

  const result = await store.acquireSyncLock({
    accountEmail: 'info@softora.nl', folder: 'inbox', force: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.locked, false);
  assert.equal(result.error, rpcError);
  assert.equal(directStateWrites, 0);
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
  assert.match(schema, /reply_dismissed_at timestamptz/);
  assert.match(schema, /softora_read_at timestamptz/);
  assert.match(schema, /create trigger softora_mailbox_messages_preserve_read_state/);
  assert.match(schema, /create table if not exists public\.softora_mailbox_sync_state/);
  assert.match(schema, /create table if not exists public\.softora_mailbox_send_provenance/);
  assert.match(schema, /softora_find_mailbox_unthreaded_sent_candidates/);
  assert.equal(schema.includes("'^\\s*((re|fw|fwd)\\s*:\\s*)+'"), true);
  assert.equal(schema.includes("'^\\\\s*((re|fw|fwd)\\\\s*:\\\\s*)+'"), false);
  assert.match(schema, /softora_mailbox_sent_thread_lookup_idx/);
  assert.match(schema, /softora_mailbox_messages_account_folder_date_idx/);
  assert.match(schema, /softora_mailbox_sync_state_account_folder_idx/);
  assert.match(schema, /alter table public\.softora_mailbox_messages enable row level security;/);
  assert.match(schema, /alter table public\.softora_mailbox_sync_state enable row level security;/);
  assert.match(schema, /alter table public\.softora_mailbox_send_provenance enable row level security;/);
  assert.match(schema, /grant select, insert, update, delete on public\.softora_mailbox_messages to service_role;/);
  assert.match(schema, /grant select, insert, update, delete on public\.softora_mailbox_sync_state to service_role;/);
  assert.match(schema, /grant select, insert, update on table public\.softora_mailbox_send_provenance to service_role;/);
  assert.match(schema, /revoke all on table public\.softora_mailbox_send_provenance from public, anon, authenticated;/);
});
