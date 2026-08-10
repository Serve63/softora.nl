const test = require('node:test');
const assert = require('node:assert/strict');

const { createMailboxService: createRawMailboxService, sanitizeMailboxDisplayText } = require('../../server/services/mailbox');
const {
  CAMPAIGN_GMAIL_LABEL_FOLDER,
  CAMPAIGN_SYNC_FETCH_LIMIT,
  CAMPAIGN_SYNC_INDEX_SCAN_LIMIT,
  CAMPAIGN_SYNC_UID_SCAN_LIMIT,
  createMailboxSyncService,
  getMailboxSyncFoldersForAccount,
} = require('../../server/services/mailbox-campaign-sync');
const { registerMailboxRoutes } = require('../../server/routes/mailbox');
const {
  createMailboxPayloadFingerprint,
  createMailboxRecipientFingerprint,
} = require('../../server/services/mailbox-send-provenance-store');
const {
  MAILBOX_CAMPAIGN_SNAPSHOT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
  parseMailboxCampaignSnapshot,
  serializeMailboxCampaignSnapshot,
} = require('../../server/services/mailbox-campaign-snapshot');
const { createMailboxIndexStore } = require('../../server/services/mailbox-index-store');

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

let provenanceSequence = 0;
function createMailboxService(deps = {}) {
  const intents = new Map();
  const mailboxSendProvenanceStore = deps.mailboxSendProvenanceStore || {
    reserve: async (payload) => {
      const existing = intents.get(payload.idempotencyKey);
      if (existing) return { created: false, intent: existing };
      const intent = { ...payload, status: 'prepared' };
      intents.set(payload.idempotencyKey, intent);
      return { created: true, intent };
    },
    markDispatchStarted: async (intentId) => {
      const intent = Array.from(intents.values()).find((candidate) => candidate.intentId === intentId) || {};
      const started = { ...intent, intentId, status: 'prepared', dispatchState: 'started', reconcileRequired: true };
      if (intent.idempotencyKey) intents.set(intent.idempotencyKey, started);
      return started;
    },
    markUnknown: async (intentId) => ({ intentId, status: 'unknown', dispatchState: 'started' }),
    accept: async (intentId, payload) => {
      const intent = Array.from(intents.values()).find((candidate) => candidate.intentId === intentId) || {};
      const accepted = { ...intent, ...payload, intentId, status: 'accepted' };
      if (intent.idempotencyKey) intents.set(intent.idempotencyKey, accepted);
      return accepted;
    },
    fail: async () => null,
    listAcceptedMessages: async () => [],
    listReconcileRequired: async () => [],
    listExpiredUndispatched: async () => [],
    abandonUndispatched: async () => ({ abandoned: false }),
  };
  const mailboxComposeThreadContext = deps.mailboxComposeThreadContext || {
    resolve: async ({ body = {}, accountEmail, recipientEmail, provider }) => ({
      intentId: `test-send:${++provenanceSequence}`,
      idempotencyKey: body.idempotencyKey || `test-idempotency:${provenanceSequence}`,
      owner: body.owner || (/martijn|venvisuals/i.test(accountEmail) ? 'martijn' : 'serve'),
      senderName: /martijn|venvisuals/i.test(accountEmail) ? 'Martijn van de Ven' : 'Servé Creusen',
      accountEmail,
      recipientEmail,
      mode: body.mode || (provider === 'instantly' ? 'reply' : 'new-message'),
      conversationId: body.context?.conversationId || `conversation:test:${provenanceSequence}`,
      replyTargetMessageId: body.providerMessageId || '',
      references: body.providerMessageId || '',
      provider: provider || 'smtp',
      providerThreadId: body.providerThreadId || '',
      messageId: `<test-${provenanceSequence}@softora.nl>`,
    }),
  };
  const mailboxIndexStore = deps.mailboxIndexStore ? {
    acquireSyncLock: async ({ accountEmail, folder }) => ({ ok: true, lockToken: `test-action:${accountEmail}:${folder}` }),
    releaseSyncLock: async () => ({ ok: true, data: [{ sync_key: 'test-action' }] }),
    getMessageForAction: async (input) => ({ id: input.id, uid: input.uid }),
    ...deps.mailboxIndexStore,
  } : undefined;
  return createRawMailboxService({
    ...deps,
    ...(mailboxIndexStore ? { mailboxIndexStore } : {}),
    mailboxSendProvenanceStore,
    mailboxComposeThreadContext,
  });
}

function createResponseRecorder() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createFakeImapClient({ boxes = [], messagesByMailbox = {} }) {
  let activeMailbox = '';
  const appendedMessages = [];
  const movedMessages = [];
  const searchQueries = [];
  const searchOptions = [];
  const fetchOptions = [];
  return {
    usable: true,
    mailbox: { uidValidity: 777 },
    lockedMailboxes: [],
    appendedMessages,
    movedMessages,
    searchQueries,
    searchOptions,
    fetchOptions,
    async connect() {},
    async list() {
      return boxes;
    },
    async getMailboxLock(mailboxName) {
      activeMailbox = mailboxName;
      this.lockedMailboxes.push(mailboxName);
      if (!Object.prototype.hasOwnProperty.call(messagesByMailbox, mailboxName)) {
        throw new Error('Command failed');
      }
      return { release() {} };
    },
    async search(query, options) {
      searchQueries.push(query);
      searchOptions.push(options);
      return (messagesByMailbox[activeMailbox] || []).map((message) => message.uid);
    },
    fetch(uids, query, options) {
      fetchOptions.push({ query, options });
      const messages = messagesByMailbox[activeMailbox] || [];
      return (async function* fetchMessages() {
        for (const uid of uids) {
          const message = messages.find((item) => item.uid === uid);
          if (message) yield message;
        }
      })();
    },
    async append(mailboxName, raw, flags, date) {
      appendedMessages.push({ mailboxName, raw, flags, date });
      if (!Object.prototype.hasOwnProperty.call(messagesByMailbox, mailboxName)) {
        throw new Error('Command failed');
      }
      return { path: mailboxName };
    },
    async messageMove(uids, destination, options) {
      movedMessages.push({ mailboxName: activeMailbox, uids, destination, options });
      const sourceMessages = messagesByMailbox[activeMailbox] || [];
      if (!Object.prototype.hasOwnProperty.call(messagesByMailbox, destination)) {
        throw new Error('Command failed');
      }
      const uidSet = new Set(Array.isArray(uids) ? uids : [uids]);
      const moving = sourceMessages.filter((message) => uidSet.has(message.uid));
      messagesByMailbox[activeMailbox] = sourceMessages.filter((message) => !uidSet.has(message.uid));
      messagesByMailbox[destination].push(...moving);
      return { path: destination };
    },
    async logout() {
      this.usable = false;
    },
  };
}

function createUidValidityCheckClient(uidValidity = 777, events = []) {
  return {
    usable: true,
    mailbox: { uidValidity },
    async connect() { events.push('connect'); },
    async list() { return [{ path: 'INBOX', specialUse: '\\Inbox' }]; },
    async getMailboxLock(mailboxName) {
      events.push(`lock:${mailboxName}`);
      return { release: () => events.push(`release:${mailboxName}`) };
    },
    async logout() { this.usable = false; events.push('logout'); },
  };
}

function withSyncReadHealth(messages = [], overrides = {}) {
  const selectedUids = messages.map((message) => Number(message?.uid) || 0).filter(Boolean);
  Object.defineProperty(messages, 'syncReadHealth', {
    configurable: true,
    value: {
      uidValidity: 777,
      folderMissing: false,
      parseFailures: [],
      selectedUids,
      yieldedUids: selectedUids,
      missingUids: [],
      selectedCount: selectedUids.length,
      yieldedCount: selectedUids.length,
      ...overrides,
    },
  });
  return messages;
}

function createPersistentMailboxUidSelectionClient(indexed) {
  return {
    from() {
      const filters = {};
      let minimumDate = '';
      let rangeStart = 0;
      let rangeEnd = Number.POSITIVE_INFINITY;
      const execute = () => {
        const rows = Array.from(indexed.values())
          .filter((message) => (
            (!filters.account_email || message.accountEmail === filters.account_email) &&
            (!filters.folder || message.folder === filters.folder) &&
            (!minimumDate || Date.parse(message.date) >= Date.parse(minimumDate))
          ))
          .sort((left, right) => Number(right.uid) - Number(left.uid))
          .slice(rangeStart, rangeEnd + 1)
          .map((message) => ({
            uid: message.uid,
            parse_status: message.parseStatus || null,
            parse_retry_at: message.parseRetryAt || null,
          }));
        return Promise.resolve({ data: rows, error: null });
      };
      const query = {
        select() { return query; },
        eq(column, value) { filters[column] = value; return query; },
        is() { return query; },
        order() { return query; },
        gte(column, value) {
          if (column === 'date') minimumDate = value;
          return query;
        },
        range(from, to) { rangeStart = from; rangeEnd = to; return query; },
        abortSignal() { return execute(); },
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      return query;
    },
  };
}

function createOutboundGuardStore(calls = [], overrides = {}) {
  return {
    reserveRecipients: async (items, options) => {
      calls.push({ type: 'reserve', items, options });
      if (overrides.reserveResult) return overrides.reserveResult;
      return {
        ok: true,
        reservationId: 'mailbox-webdesign-reservation-1',
        count: items.length * 4,
        expectedCount: items.length * 4,
      };
    },
    confirmReservation: async (reservationId, options) => {
      calls.push({ type: 'confirm', reservationId, options });
      if (overrides.confirmError) throw overrides.confirmError;
      if (overrides.confirmResult) return overrides.confirmResult;
      return { ok: true, count: 4 };
    },
    releaseReservation: async (reservationId) => {
      calls.push({ type: 'release', reservationId });
      if (overrides.releaseError) throw overrides.releaseError;
      if (overrides.releaseResult) return overrides.releaseResult;
      return { ok: true };
    },
  };
}

function stripUnlinkedWebsiteDomainMarkup(html) {
  return String(html || '').replace(
    /<span class="softora-unlinked-website-domain"[^>]*>([\s\S]*?)<\/span>/g,
    '$1'
  );
}

test('mailbox service exposes configured softora mailbox accounts', async () => {
  const service = createMailboxService({
    mailConfig: {
      mailFromAddress: 'info@softora.nl',
      mailFromName: 'Softora',
      smtpHost: 'smtp.example.test',
      smtpUser: 'info@softora.nl',
      smtpPass: 'secret',
      imapHost: 'imap.example.test',
      imapUser: 'info@softora.nl',
      imapPass: 'secret',
    },
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'ruben@softora.nl',
        name: 'Ruben',
        smtpHost: 'smtp.example.test',
        smtpUser: 'ruben@softora.nl',
        smtpPass: 'secret',
        imapHost: 'imap.example.test',
        imapUser: 'ruben@softora.nl',
        imapPass: 'secret',
      },
    ]),
  });
  const res = createResponseRecorder();

  await service.accountsResponse({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.accounts.some((account) => account.email === 'info@softora.nl'));
  assert.ok(res.body.accounts.some((account) => account.email === 'ruben@softora.nl'));
  assert.equal(
    res.body.accounts.find((account) => account.email === 'ruben@softora.nl').imapConfigured,
    true
  );
});

test('mailbox detail behoudt de virtuele Instantly-folder tot aan de providerindex', async () => {
  const lookups = [];
  const exactMessage = {
    id: 'instantly:019f3ba3-1e94-7aae-870f-6a05bd8e3a7a',
    accountEmail: 'servecreusen@websoftora.com',
    folder: 'sent',
    storageFolder: 'instantly',
    provider: 'instantly',
    providerOwner: 'serve',
    providerMessageId: '019f3ba3-1e94-7aae-870f-6a05bd8e3a7a',
    body: 'Volledige exacte Instantly-mail aan Gemeente Vught.',
    hasBody: true,
  };
  const service = createMailboxService({
    mailboxIndexStore: {
      isAvailable: () => true,
      async listMessages() { return []; },
      async getMessage(input) {
        lookups.push(input);
        return input.folder === 'instantly' ? exactMessage : null;
      },
    },
    instantlyMailboxService: {
      getConfiguredAccounts(owner) {
        return owner === 'serve'
          ? [{ email: 'servecreusen@websoftora.com', owner: 'serve' }]
          : [];
      },
    },
  });

  assert.equal((await service.getMessage({
    accountEmail: 'servecreusen@websoftora.com',
    folder: 'INSTANTLY',
    id: exactMessage.id,
  })).body, exactMessage.body);

  const response = createResponseRecorder();
  await service.getMessageResponse({
    query: {
      account: 'servecreusen@websoftora.com',
      folder: 'instantly',
      id: exactMessage.id,
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.message.body, exactMessage.body);
  assert.deepEqual(lookups.map((lookup) => lookup.folder), ['instantly', 'instantly']);
});

test('mailbox read-only auth fallback leest een ontbrekend detail zonder indexwrite', async () => {
  let upserts = 0;
  const rawMessage = Buffer.from(
    'Message-ID: <readonly-detail@example.test>\r\n' +
    'Subject: Re: Kleine vraag\r\n' +
    'From: Klant <klant@example.test>\r\n' +
    'To: serve@softora.nl\r\n\r\n' +
    'Alleen lezen.'
  );
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl',
      imapHost: 'imap.example.test',
      imapUser: 'serve@softora.nl',
      imapPass: 'secret',
    }]),
    createImapClient: () => createFakeImapClient({
      boxes: [{ path: 'INBOX', specialUse: '\\Inbox' }],
      messagesByMailbox: {
        INBOX: [{ uid: 42, flags: [], internalDate: new Date(), source: rawMessage }],
      },
    }),
    mailboxIndexStore: {
      isAvailable: () => true,
      getMessage: async () => null,
      upsertMessages: async () => { upserts += 1; return { ok: true, upserted: 1 }; },
    },
  });
  const res = createResponseRecorder();
  await service.getMessageResponse({
    premiumReadOnlyTokenFallback: true,
    query: { account: 'serve@softora.nl', folder: 'inbox', id: 'inbox:42', uidValidity: '777' },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message.body, 'Alleen lezen.');
  assert.equal(upserts, 0);
});

test('mailbox service excludes automated delivery failures from list and detail without touching human replies', async () => {
  const automated = {
    id: 'inbox:1',
    uid: 1,
    uidValidity: 777,
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    email: 'mailer-daemon@googlemail.com',
    from: 'Mail Delivery Subsystem',
    subject: 'Delivery Status Notification (Failure)',
    preview: 'Final-Recipient: rfc822; fout@example.test',
    body: 'Final-Recipient: rfc822; fout@example.test\nDiagnostic-Code: smtp; 5.1.1 user unknown',
    hasBody: true,
    bodyImageEvidenceKnown: true,
    embeddedImageCount: 0,
  };
  const human = {
    id: 'inbox:2',
    uid: 2,
    uidValidity: 777,
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    email: 'klant@example.test',
    from: 'Echte klant',
    subject: 'Re: Website',
    preview: 'Eerder was er een delivery failure, nu lukt het wel.',
    body: 'Eerder was er een delivery failure, nu lukt het wel.',
    hasBody: true,
    bodyImageEvidenceKnown: true,
    embeddedImageCount: 0,
  };
  const mailboxIndexStore = {
    isAvailable: () => true,
    listMessages: async () => [automated, human],
    getSyncState: async () => ({ last_synced_at: '2026-07-26T12:00:00.000Z' }),
    isSyncStateStale: () => false,
    getMessage: async ({ id }) => id === 'inbox:1' ? automated : human,
  };
  const service = createMailboxService({
    mailConfig: {
      mailFromAddress: 'serve@softora.nl',
      mailFromName: 'Servé Creusen',
      imapHost: 'imap.example.test',
      imapUser: 'serve@softora.nl',
      imapPass: 'secret',
    },
    mailboxIndexStore,
    createImapClient: () => createUidValidityCheckClient(777),
  });

  const messages = await service.listMessages({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
  });
  assert.deepEqual(messages.map((message) => message.id), ['inbox:2']);
  await assert.rejects(
    service.getMessage({
      accountEmail: 'serve@softora.nl',
      folder: 'inbox',
      id: 'inbox:1',
      uidValidity: 777,
    }),
    { status: 404 }
  );
  assert.equal((await service.getMessage({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    id: 'inbox:2',
    uidValidity: 777,
  })).id, 'inbox:2');
});

test('campaign mailbox response excludes delivery and support acknowledgements without hiding later human replies', async () => {
  const sourceMessages = [
    {
      id: 'bounce',
      email: 'mailer-daemon@googlemail.com',
      from: 'Mail Delivery Subsystem',
      subject: 'Delivery Status Notification (Failure)',
      body: 'Final-Recipient: rfc822; fout@example.test\nDiagnostic-Code: smtp; 5.1.1 user unknown',
      date: '2026-07-26T12:00:00.000Z',
    },
    {
      id: 'human',
      email: 'klant@example.test',
      from: 'Klant',
      subject: 'Re: Website',
      body: 'De eerdere delivery failure is opgelost; bedankt.',
      date: '2026-07-26T12:01:00.000Z',
    },
    {
      id: 'support-acknowledgement',
      email: 'helpdesknl@sbsupply.eu',
      from: 'helpdesknl@sbsupply.eu',
      subject: '[Serviceaanvraag ontvangen] Kleine vraag over jullie website',
      preview: '##- Please type your reply above this line -##',
      body: 'Uw aanvraag (269705) is ontvangen en wordt zo snel mogelijk in behandeling genomen.',
      date: '2026-07-26T12:02:00.000Z',
    },
    {
      id: 'human-support-reply',
      email: 'helpdesknl@sbsupply.eu',
      from: 'SBSupply support',
      subject: 'Re: [Serviceaanvraag ontvangen] Kleine vraag over jullie website',
      preview: 'Dank voor het ontwerp. Kun je de preview doorsturen?',
      body: [
        'Dank voor het ontwerp. Kun je de preview doorsturen?',
        '',
        'On Tue, 29 Jul 2026, helpdesknl@sbsupply.eu wrote:',
        'Uw aanvraag (269705) is ontvangen en wordt zo snel mogelijk in behandeling genomen.',
      ].join('\n'),
      date: '2026-07-26T12:03:00.000Z',
    },
    {
      id: 'typetuin-acknowledgement',
      email: 'info@typetuin.nl',
      from: 'Support De Typetuin',
      subject: 'We hebben jouw vraag met als onderwerp - Kleine vraag over jullie website ontvangen.',
      preview: 'Hartelijk dank voor je bericht. Wij streven ernaar om je bericht binnen 1 werkdag te beantwoorden.',
      body: 'Van 24 juli t/m 5 augustus is de Typetuin gesloten. In deze periode beantwoorden wij geen e-mails.',
      date: '2026-07-26T12:04:00.000Z',
    },
  ];
  const service = createMailboxService({
    mailboxCampaignRepliesService: {
      listReplies: async () => sourceMessages,
    },
    instantlyMailboxService: {
      isConfigured: () => false,
    },
  });
  const res = createResponseRecorder();

  await service.campaignRepliesResponse({ query: { limit: '100' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.messages.map((message) => message.id), ['human-support-reply', 'human']);
  assert.equal(sourceMessages.length, 5);
  assert.equal(sourceMessages[0].id, 'bounce');
  assert.equal(sourceMessages[2].id, 'support-acknowledgement');
  assert.equal(sourceMessages[4].id, 'typetuin-acknowledgement');
});

test('selected owner response leest geen andere Instantly-owner en schrijft geen partiële globale snapshot', async () => {
  let savedSnapshot = '';
  let localReplyOptions = null;
  const listedOwners = [];
  const messagesByOwner = {
    serve: [{
      id: 'ramon',
      mailboxId: 'instantly:ramon-reply',
      provider: 'instantly',
      providerMessageId: 'ramon-reply',
      providerThreadId: 'ramon-thread',
      providerAccountEmail: 'serve@websoftora.com',
      providerOwner: 'serve',
      storageFolder: 'instantly',
      accountEmail: 'serve@websoftora.com',
      email: 'info@ramoncc.nl',
      conversationId: 'instantly:serve@websoftora.com:ramon-thread',
      activityAt: '2026-07-07T10:47:10.000Z',
      messageId: '<ramon@example.org>',
      threadMessages: [],
    }],
    martijn: [{
      id: 'martijn-thread',
      mailboxId: 'instantly:martijn-reply',
      provider: 'instantly',
      providerMessageId: 'martijn-reply',
      providerThreadId: 'martijn-thread',
      providerAccountEmail: 'martijn-sender@example.org',
      providerOwner: 'martijn',
      storageFolder: 'instantly',
      accountEmail: 'martijn-sender@example.org',
      email: 'prospect@example.org',
      conversationId: 'instantly:martijn-sender@example.org:martijn-thread',
      activityAt: '2026-07-07T10:48:10.000Z',
      messageId: '<martijn@example.org>',
      threadMessages: [],
    }],
  };
  const service = createMailboxService({
    mailboxCampaignRepliesService: {
      listReplies: async (options) => {
        localReplyOptions = options;
        return [];
      },
    },
    instantlyMailboxService: {
      isConfigured: () => true,
      getConfiguredAccounts: (owner) => owner === 'serve'
        ? [{ email: 'serve@websoftora.com' }]
        : [{ email: 'martijn-sender@example.org' }],
      listOwnerConversations: async (owner) => {
        listedOwners.push(owner);
        return messagesByOwner[owner];
      },
    },
    mailboxCampaignConsistencyStore: {
      isAvailable: () => true,
      getFence: async () => ({ contentVersion: '12', pendingCount: 0, ready: true }),
    },
    getUiStateValues: async () => ({
      values: {},
      source: 'supabase',
      revision: 0,
    }),
    compareAndSwapUiStateValues: async (_scope, values) => {
      savedSnapshot = values[MAILBOX_CAMPAIGN_SNAPSHOT_KEY];
      return { ok: true, revision: 1 };
    },
  });
  const res = createResponseRecorder();

  await service.campaignRepliesResponse({
    query: { limit: '100', owner: 'serve', refreshInstantly: '0' },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(localReplyOptions, { limit: 100, owner: 'serve' });
  assert.deepEqual(listedOwners, ['serve']);
  assert.deepEqual(res.body.messages.map((message) => message.id), ['ramon']);
  assert.equal(res.body.sync.snapshotComplete, false);
  assert.equal(savedSnapshot, '');
});

test('mailbox read-only auth fallback kan geen durable snapshot of provider-refresh schrijven', async () => {
  const persists = [];
  const service = createMailboxService({
    mailboxCampaignRepliesService: { listReplies: async () => [] },
    mailboxCampaignSnapshotStore: {
      getFence: async () => ({ contentVersion: '12', pendingCount: 0, ready: true }),
      persist: async (...args) => { persists.push(args); return { ok: true }; },
      readDegraded: async () => null,
      invalidate: async () => ({ ok: true }),
    },
    instantlyMailboxService: {
      isConfigured: () => false,
      syncMailbox: async () => { throw new Error('provider-refresh mag niet worden gestart'); },
    },
  });
  const fallbackResponse = createResponseRecorder();
  await service.campaignRepliesResponse({
    query: { limit: '100', refreshInstantly: '1' },
    premiumReadOnlyTokenFallback: true,
  }, fallbackResponse);
  assert.equal(fallbackResponse.statusCode, 200);
  assert.equal(persists.length, 0);

  const normal = await service.listCampaignReplies({ limit: 100 });
  assert.equal(persists.length, 1);
  assert.equal(normal.savedAt, normal.contentAt);
  assert.equal(persists[0][1].savedAt, normal.contentAt);
  assert.equal(persists[0][1].contentAt, normal.contentAt);
});

test('ongeldige mailbox-owner blijft 400 en kan nooit verbreden naar beide eigenaren', async () => {
  let reads = 0;
  let fallbacks = 0;
  const service = createMailboxService({
    mailboxCampaignRepliesService: { listReplies: async () => { reads += 1; return []; } },
    mailboxCampaignSnapshotStore: {
      persist: async () => ({ ok: true }),
      readDegraded: async () => { fallbacks += 1; return { ok: true, messages: [] }; },
      invalidate: async () => ({ ok: true }),
    },
    instantlyMailboxService: { isConfigured: () => false },
  });
  const res = createResponseRecorder();
  await service.campaignRepliesResponse({ query: { owner: 'aanvaller' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(reads, 0);
  assert.equal(fallbacks, 0);
});

test('mailbox service sends mail through selected account smtp', async () => {
  const sent = [];
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Serve',
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpUser: 'serve@softora.nl',
        smtpPass: 'secret',
      },
    ]),
    createTransport: (config) => ({
      sendMail: async (message) => {
        sent.push({ config, message });
        return { messageId: 'm-1', accepted: [message.to], rejected: [] };
      },
    }),
  });
  const res = createResponseRecorder();

  await service.sendMessageResponse(
    {
      body: {
        account: 'serve@softora.nl',
        to: 'klant@example.nl',
        subject: 'Test',
        body: 'Hallo',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(sent[0].config.auth.user, 'serve@softora.nl');
  assert.equal(sent[0].message.from, 'Servé Creusen <serve@softora.nl>');
  assert.equal(sent[0].message.to, 'klant@example.nl');
});

test('mailbox service verstuurt alleen expliciete CC, BCC en veilige composebijlagen', async () => {
  const sent = [];
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl',
      smtpHost: 'smtp.example.test',
      smtpUser: 'serve@softora.nl',
      smtpPass: 'secret',
    }]),
    createTransport: () => ({
      sendMail: async (message) => {
        sent.push(message);
        return { messageId: '<compose@softora.nl>', accepted: [message.to], rejected: [] };
      },
    }),
  });
  const res = createResponseRecorder();

  await service.sendMessageResponse({
    body: {
      account: 'serve@softora.nl',
      to: 'klant@example.nl',
      cc: 'boekhouder@example.nl, collega@example.nl',
      bcc: 'archief@example.nl',
      subject: 'Documenten',
      body: 'Hierbij de documenten.',
      attachments: [{
        filename: 'voorstel.pdf',
        contentType: 'application/pdf',
        contentBase64: Buffer.from('veilig document').toString('base64'),
      }],
    },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(sent[0].cc, ['boekhouder@example.nl', 'collega@example.nl']);
  assert.deepEqual(sent[0].bcc, ['archief@example.nl']);
  assert.equal(sent[0].attachments.length, 1);
  assert.equal(sent[0].attachments[0].filename, 'voorstel.pdf');
  assert.equal(sent[0].attachments[0].content.toString(), 'veilig document');
  assert.equal(sent[0].attachments[0].contentDisposition, 'attachment');
});

test('mailbox service blokkeert dubbele ontvangers en gevaarlijke composebijlagen voor SMTP', async () => {
  let sendCalls = 0;
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl',
      smtpHost: 'smtp.example.test',
      smtpUser: 'serve@softora.nl',
      smtpPass: 'secret',
    }]),
    createTransport: () => ({
      sendMail: async () => {
        sendCalls += 1;
        return { accepted: [] };
      },
    }),
  });
  const duplicateRes = createResponseRecorder();
  await service.sendMessageResponse({
    body: {
      account: 'serve@softora.nl',
      to: 'klant@example.nl',
      cc: 'klant@example.nl',
      subject: 'Dubbel',
    },
  }, duplicateRes);
  assert.equal(duplicateRes.statusCode, 400);

  const attachmentRes = createResponseRecorder();
  await service.sendMessageResponse({
    body: {
      account: 'serve@softora.nl',
      to: 'klant@example.nl',
      subject: 'Onveilig',
      attachments: [{
        filename: 'factuur.exe',
        contentBase64: Buffer.from('niet uitvoeren').toString('base64'),
      }],
    },
  }, attachmentRes);
  assert.equal(attachmentRes.statusCode, 400);
  assert.equal(sendCalls, 0);
});

test('mailbox service enriches normal webdesign sends with public link and inline images by default', async () => {
  const sent = [];
  const guardCalls = [];
  const customerId = 'manual-import-pckbv-eu-privacy-0583';
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Serve',
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpUser: 'serve@softora.nl',
        smtpPass: 'secret',
      },
    ]),
    async getUiStateValues(scope) {
      if (scope === 'premium_customers_database') {
        return {
          values: {
            softora_customers_premium_v1: JSON.stringify([
              {
                id: customerId,
                bedrijf: 'PCK B.V.',
                naam: 'PCK',
                email: 'info@pckbv.eu',
                stad: 'Florijnstraat 13, 4861 BW Chaam',
                website: 'https://pckbv.eu',
              },
            ]),
          },
        };
      }
      if (scope === 'premium_database_photos') {
        return {
          values: {
            softora_database_photos_v1: JSON.stringify({
              [customerId]: {
                id: customerId,
                identityKey: 'pck b v|pck|',
                websitePhoto: TINY_PNG_DATA_URL,
                websiteMockup: TINY_PNG_DATA_URL,
                websitePhotoName: 'PCK B.V. webdesign.png',
                websiteMockupName: 'PCK B.V. device mockup.jpg',
              },
            }),
          },
        };
      }
      return { values: {} };
    },
    createTransport: (config) => ({
      sendMail: async (message) => {
        guardCalls.push({ type: 'smtp' });
        sent.push({ config, message });
        return { messageId: 'm-1', accepted: [message.to], rejected: [] };
      },
    }),
    outboundRecipientGuardStore: createOutboundGuardStore(guardCalls),
  });

  await service.sendMessage({
    accountEmail: 'serve@softora.nl',
    to: 'info@pckbv.eu',
    subject: 'Kleine vraag over jullie website',
    text: [
      'Goedendag,',
      '',
      'Afgelopen week kwam ik jullie website (pckbv.eu) tegen. Vanuit enthousiasme heb ik een fris webdesign gemaakt.',
      '',
      'Met vriendelijke groet,',
      'Martijn van de Ven',
      '',
      '📍 {{afzenderPlaats}}',
      '',
      'PS: Zie je het webdesign niet? Klik dan even op ‘afbeeldingen tonen’ ergens in je scherm 😊',
      '',
      '[Geen webdesign willen ontvangen? Laat het me weten!](https://www.softora.nl/afmelden?t=abc)',
    ].join('\n'),
  });

  assert.equal(sent.length, 1);
  assert.deepEqual(guardCalls.slice(0, 3).map((call) => call.type), ['reserve', 'smtp', 'confirm']);
  assert.equal(guardCalls[0].items[0].recipientEmail, 'info@pckbv.eu');
  assert.equal(guardCalls[0].items[0].recipientDomain, 'pckbv.eu');
  assert.equal(guardCalls[0].items[0].recipientCompany, 'PCK B.V.');
  assert.equal(guardCalls[0].items[0].recipientId, customerId);
  assert.equal(guardCalls[0].options.channel, 'mailbox');
  assert.equal(guardCalls[0].options.permanent, true);
  assert.equal(guardCalls[2].options.status, 'sent');
  assert.match(
    sent[0].message.text,
    /Webdesign niet zichtbaar\? Check het hier 👈/
  );
  assert.match(sent[0].message.text, /Met vriendelijke groet,\nServé Creusen\n\n📍 Chaam/);
  assert.doesNotMatch(sent[0].message.text, /Martijn van de Ven/);
  assert.doesNotMatch(sent[0].message.text, /📍 Liempde/);
  assert.doesNotMatch(sent[0].message.text, /📍 Alphen/);
  assert.doesNotMatch(sent[0].message.text, /📍 \{\{stad\}\}/);
  assert.doesNotMatch(sent[0].message.text, /📍 \{\{afzenderPlaats\}\}/);
  assert.doesNotMatch(sent[0].message.text, /Florijnstraat/);
  assert.doesNotMatch(sent[0].message.text, /PS: Wordt het webdesign niet zichtbaar/);
  assert.doesNotMatch(sent[0].message.text, /afbeeldingen tonen/i);
  assert.match(
    sent[0].message.html,
    /Webdesign niet zichtbaar\? Check het <a href="https:\/\/www\.softora\.nl\/webdesign\/pck-b-v\?cid=manual-import-pckbv-eu-privacy-0583&amp;sender=serve" target="_blank" rel="noopener noreferrer" style="color:#0a66c2;text-decoration:underline;">hier<\/a> 👈/
  );
  assert.match(sent[0].message.html, /website \(<span class="softora-unlinked-website-domain"[^>]+>pckbv\u2060\.\u2060eu<\/span>\) tegen/);
  assert.doesNotMatch(sent[0].message.html, /<a[^>]+href="https?:\/\/(?:www\.)?pckbv\.eu/i);
  assert.match(sent[0].message.html, /<img src="cid:webdesign-manual-import-pckbv-eu-privacy-0583-1@softora"/);
  assert.match(sent[0].message.html, /<img src="cid:mockup-manual-import-pckbv-eu-privacy-0583-2@softora"/);
  assert.equal(sent[0].message.headers['X-Softora-Template-Version'], 'softora-webdesign-email-2026-07-15-v7');
  assert.match(sent[0].message.html, /^<!doctype html><html lang="nl"><head>/);
  assert.match(sent[0].message.html, /<meta name="viewport" content="width=device-width,initial-scale=1\.0">/);
  assert.match(sent[0].message.html, /data-softora-template-version="softora-webdesign-email-2026-07-15-v7"/);
  assert.match(sent[0].message.html, /class="softora-webdesign-email-body softora-mailbox-webdesign-body"/);
  assert.match(sent[0].message.html, /font-size:16px;line-height:26px;color:#1a1a2e;width:100%;max-width:600px;/);
  assert.match(sent[0].message.html, /class="softora-webdesign-image-stack"[^>]+max-width:600px/);
  assert.match(sent[0].message.html, /alt="PCK B\.V\. webdesign" class="softora-webdesign-image" width="600"/);
  assert.match(sent[0].message.html, /alt="PCK B\.V\. device mockup" class="softora-webdesign-image softora-webdesign-image--mockup" width="600"/);
  assert.match(sent[0].message.html, /class="softora-mockup-caption"[^>]*>Hieronder zie je een korte indruk van de eerste versie op verschillende schermen\.<\/p>/);
  assert.equal((sent[0].message.html.match(/alt="PCK B\.V\. webdesign"/g) || []).length, 1);
  assert.equal((sent[0].message.html.match(/alt="PCK B\.V\. device mockup"/g) || []).length, 1);
  assert.doesNotMatch(stripUnlinkedWebsiteDomainMarkup(sent[0].message.html), /900px|softora-desktop-image-pair|softora-mobile-image-pair|white-space:nowrap|display:inline-block|word-break:keep-all|table-layout:fixed|min-device-width/);
  assert.equal(sent[0].message.attachments.length, 2);
  assert.deepEqual(
    sent[0].message.attachments.map((attachment) => [attachment.cid, attachment.contentDisposition]),
    [
      ['webdesign-manual-import-pckbv-eu-privacy-0583-1@softora', 'inline'],
      ['mockup-manual-import-pckbv-eu-privacy-0583-2@softora', 'inline'],
    ]
  );
});

test('mailbox service enriches webdesign sends from stored photo metadata when customer row is unavailable', async () => {
  const sent = [];
  const guardCalls = [];
  const customerId = 'import-309-db-mohsau65-wp5f4v';
  const service = createMailboxService({
    webdesignImageDelivery: 'cid',
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Serve',
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpUser: 'serve@softora.nl',
        smtpPass: 'secret',
      },
    ]),
    async getUiStateValues(scope) {
      if (scope === 'premium_database_photos') {
        return {
          values: {
            softora_database_photos_v1: JSON.stringify({
              [customerId]: {
                id: customerId,
                company: 'Podotherapi3 Vissers',
                websitePhoto: TINY_PNG_DATA_URL,
                websiteMockup: TINY_PNG_DATA_URL,
                websitePhotoName: 'podotherapi3-vissers-webdesign.png',
                websiteMockupName: 'podotherapi3-vissers-device-mockup.png',
              },
            }),
          },
        };
      }
      return { values: {} };
    },
    createTransport: (config) => ({
      sendMail: async (message) => {
        guardCalls.push({ type: 'smtp' });
        sent.push({ config, message });
        return { messageId: 'm-1', accepted: [message.to], rejected: [] };
      },
    }),
    outboundRecipientGuardStore: createOutboundGuardStore(guardCalls),
  });

  await service.sendMessage({
    accountEmail: 'serve@softora.nl',
    to: 'info@podotherapi3.nl',
    subject: 'Kleine vraag over jullie website',
    text: [
      'Goedendag,',
      '',
      'Afgelopen week kwam ik jullie website (podotherapi3.nl) tegen. Vanuit enthousiasme heb ik een fris webdesign gemaakt.',
      '',
      'Met vriendelijke groet,',
      'Servé Creusen',
      '',
      'PS: Wordt het webdesign niet zichtbaar? open het via hier 👈',
    ].join('\n'),
  });

  assert.equal(sent.length, 1);
  assert.deepEqual(guardCalls.slice(0, 3).map((call) => call.type), ['reserve', 'smtp', 'confirm']);
  assert.equal(guardCalls[0].items[0].recipientEmail, 'info@podotherapi3.nl');
  assert.equal(guardCalls[0].items[0].recipientDomain, 'podotherapi3.nl');
  assert.equal(guardCalls[0].items[0].recipientCompany, 'Podotherapi3 Vissers');
  assert.equal(guardCalls[0].items[0].recipientId, customerId);
  assert.match(
    sent[0].message.html,
    /href="https:\/\/www\.softora\.nl\/webdesign\/podotherapi3-vissers\?cid=import-309-db-mohsau65-wp5f4v&amp;sender=serve"/
  );
  assert.match(sent[0].message.html, /<img src="cid:webdesign-import-309-db-mohsau65-wp5f4v-1@softora"/);
  assert.match(sent[0].message.html, /<img src="cid:mockup-import-309-db-mohsau65-wp5f4v-2@softora"/);
  assert.equal(sent[0].message.attachments.length, 2);
  assert.deepEqual(
    sent[0].message.attachments.map((attachment) => [attachment.cid, attachment.contentDisposition]),
    [
      ['webdesign-import-309-db-mohsau65-wp5f4v-1@softora', 'inline'],
      ['mockup-import-309-db-mohsau65-wp5f4v-2@softora', 'inline'],
    ]
  );
});

test('mailbox service blocks manual webdesign sends before SMTP when the central guard conflicts', async () => {
  const sent = [];
  const guardCalls = [];
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Serve',
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpUser: 'serve@softora.nl',
        smtpPass: 'secret',
      },
    ]),
    createTransport: () => ({
      sendMail: async (message) => {
        sent.push(message);
        return { messageId: 'm-should-not-send', accepted: [message.to], rejected: [] };
      },
    }),
    outboundRecipientGuardStore: createOutboundGuardStore(guardCalls, {
      reserveResult: {
        ok: false,
        reservationId: 'conflict-reservation',
        conflict: {
          provider: 'softora',
          sender_email: 'martijn@softora.nl',
          recipient_email: 'info@blocked.example',
        },
      },
    }),
  });

  await assert.rejects(
    () =>
      service.sendMessage({
        accountEmail: 'serve@softora.nl',
        to: 'info@blocked.example',
        subject: 'Kleine vraag over jullie website',
        text: 'Beste collega-ondernemer,\n\nIk heb een nieuw webdesign gemaakt voor blocked.example.',
      }),
    (error) => {
      assert.equal(error.code, 'MAILBOX_WEBDESIGN_OUTBOUND_GUARD_CONFLICT');
      assert.equal(error.status, 409);
      return true;
    }
  );

  assert.equal(sent.length, 0);
  assert.equal(guardCalls.length, 1);
  assert.equal(guardCalls[0].type, 'reserve');
});

test('mailbox service guards webdesign sends even when the copy uses preview wording', async () => {
  const sent = [];
  const guardCalls = [];
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Serve',
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpUser: 'serve@softora.nl',
        smtpPass: 'secret',
      },
    ]),
    createTransport: () => ({
      sendMail: async (message) => {
        sent.push(message);
        return { messageId: 'm-should-not-send', accepted: [message.to], rejected: [] };
      },
    }),
    outboundRecipientGuardStore: createOutboundGuardStore(guardCalls, {
      reserveResult: {
        ok: false,
        reservationId: 'preview-copy-conflict',
        conflict: {
          provider: 'softora',
          sender_email: 'martijn@softora.nl',
          recipient_email: 'info@previewcopy.example',
        },
      },
    }),
  });

  await assert.rejects(
    () =>
      service.sendMessage({
        accountEmail: 'serve@softora.nl',
        to: 'info@previewcopy.example',
        subject: 'Kleine vraag over jullie website',
        text: [
          'Beste collega-ondernemer,',
          '',
          'Ik ben benieuwd wat je van het webdesign vindt.',
          'Als je wilt stuur ik ook de online preview, zodat je zelf door het ontwerp kunt scrollen.',
          '',
          'PS: Wordt het webdesign niet zichtbaar?',
          'Bekijk het via hier 👈',
        ].join('\n'),
      }),
    (error) => {
      assert.equal(error.code, 'MAILBOX_WEBDESIGN_OUTBOUND_GUARD_CONFLICT');
      assert.equal(error.status, 409);
      return true;
    }
  );

  assert.equal(sent.length, 0);
  assert.equal(guardCalls.length, 1);
  assert.equal(guardCalls[0].type, 'reserve');
  assert.equal(guardCalls[0].items[0].recipientEmail, 'info@previewcopy.example');
  assert.equal(guardCalls[0].items[0].recipientDomain, 'previewcopy.example');
});

test('mailbox service blocks manual webdesign sends when customer history already shows outbound mail', async () => {
  const sent = [];
  const guardCalls = [];
  const customerId = 'manual-import-vandenbroekwitgoed';
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Serve',
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpUser: 'serve@softora.nl',
        smtpPass: 'secret',
      },
    ]),
    async getUiStateValues(scope) {
      if (scope === 'premium_customers_database') {
        return {
          values: {
            softora_customers_premium_v1: JSON.stringify([
              {
                id: customerId,
                bedrijf: 'Van den Broek Witgoed',
                email: 'info@vandenbroekwitgoed.nl',
                website: 'https://vandenbroekwitgoed.nl',
                database_status: 'gemaild',
                lifecycle_status: 'gemaild',
                lastColdmailSentAt: '2026-06-08T06:32:23.412Z',
              },
            ]),
          },
        };
      }
      return { values: {} };
    },
    createTransport: () => ({
      sendMail: async (message) => {
        sent.push(message);
        return { messageId: 'm-should-not-send', accepted: [message.to], rejected: [] };
      },
    }),
    outboundRecipientGuardStore: createOutboundGuardStore(guardCalls),
  });

  await assert.rejects(
    () =>
      service.sendMessage({
        accountEmail: 'serve@softora.nl',
        to: 'info@vandenbroekwitgoed.nl',
        subject: 'Kleine vraag over jullie website',
        text: 'Beste collega-ondernemer,\n\nIk heb een nieuw webdesign gemaakt voor vandenbroekwitgoed.nl.',
      }),
    (error) => {
      assert.equal(error.code, 'MAILBOX_WEBDESIGN_PRIOR_OUTBOUND_HISTORY');
      assert.equal(error.status, 409);
      assert.equal(error.customerId, customerId);
      return true;
    }
  );

  assert.equal(sent.length, 0);
  assert.equal(guardCalls.length, 0);
});

test('mailbox service blocks manual webdesign sends when customer history shows instantly outreach', async () => {
  const sent = [];
  const guardCalls = [];
  const customerId = 'manual-import-cafetariadebank';
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Serve',
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpUser: 'serve@softora.nl',
        smtpPass: 'secret',
      },
    ]),
    async getUiStateValues(scope) {
      if (scope === 'premium_customers_database') {
        return {
          values: {
            softora_customers_premium_v1: JSON.stringify([
              {
                id: customerId,
                bedrijf: 'Cafetaria De Bank',
                email: 'info@cafetariadebank.nl',
                website: 'https://cafetariadebank.nl',
                lastColdmailProvider: 'instantly',
                instantlyStatus: 'opened',
                instantlyEmailSentAt: '2026-06-04T14:24:00.000Z',
              },
            ]),
          },
        };
      }
      return { values: {} };
    },
    createTransport: () => ({
      sendMail: async (message) => {
        sent.push(message);
        return { messageId: 'm-should-not-send', accepted: [message.to], rejected: [] };
      },
    }),
    outboundRecipientGuardStore: createOutboundGuardStore(guardCalls),
  });

  await assert.rejects(
    () =>
      service.sendMessage({
        accountEmail: 'serve@softora.nl',
        to: 'info@cafetariadebank.nl',
        subject: 'Kleine vraag over jullie website',
        text: 'Beste collega-ondernemer,\n\nIk heb een nieuw webdesign gemaakt voor cafetariadebank.nl.',
      }),
    (error) => {
      assert.equal(error.code, 'MAILBOX_WEBDESIGN_PRIOR_OUTBOUND_HISTORY');
      assert.equal(error.status, 409);
      assert.equal(error.customerId, customerId);
      return true;
    }
  );

  assert.equal(sent.length, 0);
  assert.equal(guardCalls.length, 0);
});

test('mailbox service refuses manual webdesign sends when the central guard is unavailable', async () => {
  const sent = [];
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Serve',
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpUser: 'serve@softora.nl',
        smtpPass: 'secret',
      },
    ]),
    createTransport: () => ({
      sendMail: async (message) => {
        sent.push(message);
        return { messageId: 'm-should-not-send', accepted: [message.to], rejected: [] };
      },
    }),
  });

  await assert.rejects(
    () =>
      service.sendMessage({
        accountEmail: 'serve@softora.nl',
        to: 'info@unguarded.example',
        subject: 'Kleine vraag over jullie website',
        text: 'Beste collega-ondernemer,\n\nIk heb een nieuw webdesign gemaakt voor unguarded.example.',
      }),
    (error) => {
      assert.equal(error.code, 'MAILBOX_WEBDESIGN_OUTBOUND_GUARD_UNAVAILABLE');
      assert.equal(error.status, 503);
      return true;
    }
  );

  assert.equal(sent.length, 0);
});

test('mailbox service houdt SMTP-acceptatie leidend wanneer guard-confirm lokaal geen rij vindt', async () => {
  const sent = [];
  const guardCalls = [];
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Serve',
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpUser: 'serve@softora.nl',
        smtpPass: 'secret',
      },
    ]),
    createTransport: () => ({
      sendMail: async (message) => {
        sent.push(message);
        return { messageId: 'm-confirm-empty', accepted: [message.to], rejected: [] };
      },
    }),
    outboundRecipientGuardStore: createOutboundGuardStore(guardCalls, {
      confirmResult: { ok: false, reason: 'reservation_not_found', count: 0 },
    }),
  });

  const result = await service.sendMessage({
    accountEmail: 'serve@softora.nl',
    to: 'info@confirm-empty.example',
    subject: 'Kleine vraag over jullie website',
    text: 'Beste collega-ondernemer,\n\nIk heb een nieuw webdesign gemaakt voor confirm-empty.example.',
  });

  assert.equal(sent.length, 1);
  assert.deepEqual(result.accepted, ['info@confirm-empty.example']);
  assert.equal(result.providerOutcomeUnknown, false);
  assert.equal(result.storageDegraded, true);
  assert.equal(result.reconcileRequired, true);
  assert.deepEqual(guardCalls.map((call) => call.type), ['reserve', 'confirm']);
});

test('mailbox service sends Martijn mail with the full display name', async () => {
  const sent = [];
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'martijn@softora.nl',
        name: 'Martijn',
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpUser: 'martijn@softora.nl',
        smtpPass: 'secret',
      },
    ]),
    createTransport: (config) => ({
      sendMail: async (message) => {
        sent.push({ config, message });
        return { messageId: 'm-1', accepted: [message.to], rejected: [] };
      },
    }),
  });
  const res = createResponseRecorder();

  await service.sendMessageResponse(
    {
      body: {
        account: 'martijn@softora.nl',
        to: 'klant@example.nl',
        subject: 'Test',
        body: 'Hallo',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(sent[0].config.auth.user, 'martijn@softora.nl');
  assert.equal(sent[0].message.from, 'Martijn van de Ven <martijn@softora.nl>');
});

test('mailbox service enforces the canonical name and exact SMTP login for all nine sender aliases', async () => {
  const sent = [];
  const aliases = [
    ['serve@softora.nl', 'Servé Creusen'],
    ['martijn@softora.nl', 'Martijn van de Ven'],
    ['servecreusen@softora.nl', 'Servé Creusen'],
    ['martijnvandeven@softora.nl', 'Martijn van de Ven'],
    ['servec321@gmail.com', 'Servé Creusen'],
    ['martijnven123@gmail.com', 'Martijn van de Ven'],
    ['serve290@gmail.com', 'Servé Creusen'],
    ['servecreusen7@gmail.com', 'Servé Creusen'],
    ['contact.venvisuals@gmail.com', 'Martijn van de Ven'],
  ];
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify(aliases.map(([email, expectedName]) => (
      {
        email,
        name: expectedName === 'Servé Creusen' ? 'Martijn' : 'Servé',
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpUser: email,
        smtpPass: 'secret',
      }
    ))),
    createTransport: (config) => ({
      sendMail: async (message) => {
        sent.push({ config, message });
        return { messageId: 'm-1', accepted: [message.to], rejected: [] };
      },
    }),
  });
  const accountsRes = createResponseRecorder();
  await service.accountsResponse({}, accountsRes);
  assert.equal(accountsRes.statusCode, 200);
  for (const [email, expectedName] of aliases) {
    const account = accountsRes.body.accounts.find((item) => item.email === email);
    assert.equal(account.name, expectedName, email);
    assert.equal(account.smtpConfigured, true, email);
    await service.sendMessage({
      accountEmail: email,
      to: 'klant@example.nl',
      subject: 'Test',
      text: 'Hallo',
    });
    const delivery = sent.at(-1);
    assert.equal(delivery.config.auth.user, email, email);
    assert.equal(delivery.message.from, `${expectedName} <${email}>`, email);
  }
  assert.equal(sent.length, aliases.length);
});

test('mailbox service blocks Venvisual before SMTP when it would authenticate as Servé', async () => {
  let smtpCalls = 0;
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'contact.venvisuals@gmail.com',
        name: 'Servé',
        smtpHost: 'smtp.gmail.test',
        smtpUser: 'servec321@gmail.com',
        smtpPass: 'serve-secret',
      },
    ]),
    createTransport: () => ({
      async sendMail() {
        smtpCalls += 1;
        return { messageId: 'must-not-send' };
      },
    }),
  });

  await assert.rejects(
    () => service.sendMessage({
      accountEmail: 'contact.venvisuals@gmail.com',
      to: 'klant@example.nl',
      subject: 'Test',
      text: 'Hallo',
    }),
    (error) => {
      assert.equal(error.code, 'SENDER_SMTP_IDENTITY_MISMATCH');
      assert.match(error.message, /SMTP-login hoort niet bij/);
      return true;
    }
  );
  assert.equal(smtpCalls, 0);
});

test('mailbox service stores app-sent mail in the resolved sent folder when IMAP is available', async () => {
  const sent = [];
  const client = createFakeImapClient({
    boxes: [
      { path: 'INBOX' },
      { path: 'INBOX/Verstuurd', specialUse: '\\Sent' },
    ],
    messagesByMailbox: {
      'INBOX/Verstuurd': [],
    },
  });
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Serve',
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpUser: 'serve@softora.nl',
        smtpPass: 'secret',
        imapHost: 'imap.example.test',
        imapUser: 'serve@softora.nl',
        imapPass: 'secret',
      },
    ]),
    createTransport: (config) => ({
      sendMail: async (message) => {
        sent.push({ config, message });
        return { messageId: 'm-1', accepted: [message.to], rejected: [] };
      },
    }),
    createImapClient: () => client,
  });

  await service.sendMessage({
    accountEmail: 'serve@softora.nl',
    to: 'klant@example.nl',
    subject: 'Test verzonden',
    text: 'Hallo klant',
  });

  assert.equal(sent.length, 1);
  assert.equal(client.appendedMessages.length, 1);
  assert.equal(client.appendedMessages[0].mailboxName, 'INBOX/Verstuurd');
  assert.deepEqual(client.appendedMessages[0].flags, ['\\Seen']);
});

test('mailbox service resolves sent folders through IMAP special-use metadata', async () => {
  const sentDate = new Date('2026-05-12T11:15:00.000Z');
  const client = createFakeImapClient({
    boxes: [
      { path: 'INBOX' },
      { path: 'INBOX/Verstuurd', specialUse: '\\Sent' },
    ],
    messagesByMailbox: {
      'INBOX/Verstuurd': [
        {
          uid: 42,
          flags: ['\\Seen'],
          internalDate: sentDate,
          source: {
            date: sentDate,
            text: 'Hallo klant',
            subject: 'Verzonden bericht',
            from: { value: [{ name: 'Serve', address: 'serve@softora.nl' }] },
            to: { value: [{ name: 'Klant', address: 'klant@example.nl' }] },
          },
        },
      ],
    },
  });
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Serve',
        imapHost: 'imap.example.test',
        imapUser: 'serve@softora.nl',
        imapPass: 'secret',
      },
    ]),
    createImapClient: () => client,
    parseMailSource: async (source) => source,
  });

  const messages = await service.listMessages({ accountEmail: 'serve@softora.nl', folder: 'sent' });

  assert.deepEqual(client.lockedMailboxes, ['INBOX/Verstuurd']);
  // ImapFlow compiles this object to SEARCH ALL; the old array input produced an empty query.
  assert.deepEqual(client.searchQueries, [{ all: true }]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].subject, 'Verzonden bericht');
  assert.equal(messages[0].from, 'Serve');
  assert.equal(messages[0].email, 'serve@softora.nl');
  assert.equal(messages[0].to, 'klant@example.nl');
});

test('mailbox service resolves Dutch sent folders without special-use metadata', async () => {
  const sentDate = new Date('2026-05-12T11:15:00.000Z');
  const client = createFakeImapClient({
    boxes: [
      { path: 'INBOX' },
      { path: 'INBOX/Verstuurd' },
    ],
    messagesByMailbox: {
      'INBOX/Verstuurd': [
        {
          uid: 43,
          flags: ['\\Seen'],
          internalDate: sentDate,
          source: {
            date: sentDate,
            text: 'Hallo vanaf Serve',
            subject: 'STRATO verzonden bericht',
            from: { value: [{ name: 'Serve', address: 'serve@softora.nl' }] },
            to: { value: [{ name: 'Klant', address: 'klant@example.nl' }] },
          },
        },
      ],
    },
  });
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Serve',
        imapHost: 'imap.example.test',
        imapUser: 'serve@softora.nl',
        imapPass: 'secret',
      },
    ]),
    createImapClient: () => client,
    parseMailSource: async (source) => source,
  });

  const messages = await service.listMessages({ accountEmail: 'serve@softora.nl', folder: 'sent' });

  assert.deepEqual(client.lockedMailboxes, ['INBOX/Verstuurd']);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].subject, 'STRATO verzonden bericht');
});

test('mailbox service bewaart exacte To, CC, BCC en bijlagemetadata uit de MIME-bron', async () => {
  const sentDate = new Date('2026-07-24T16:15:00.000Z');
  const client = createFakeImapClient({
    boxes: [{ path: 'INBOX/Verstuurd' }],
    messagesByMailbox: {
      'INBOX/Verstuurd': [{
        uid: 297,
        flags: ['\\Seen'],
        internalDate: sentDate,
        source: {
          date: sentDate,
          text: 'Beste Sandra, hierbij mijn reactie.',
          subject: 'Re: Kleine vraag over jullie website',
          from: { value: [{ name: 'Martijn van de Ven', address: 'martijn@softora.nl' }] },
          to: { value: [{ name: 'Sandra van Berkel', address: 'equirehab4you@gmail.com' }] },
          cc: { value: [{ name: 'Collega', address: 'collega@softora.nl' }] },
          bcc: { value: [{ name: 'Servé Creusen', address: 'serve@softora.nl' }] },
          attachments: [{
            filename: 'voorstel.pdf',
            contentType: 'application/pdf',
            contentDisposition: 'attachment',
            content: Buffer.from('document'),
          }],
        },
      }],
    },
  });
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([{
      email: 'martijn@softora.nl',
      imapHost: 'imap.example.test',
      imapUser: 'martijn@softora.nl',
      imapPass: 'secret',
    }]),
    createImapClient: () => client,
    parseMailSource: async (source) => source,
  });

  const [message] = await service.listMessages({
    accountEmail: 'martijn@softora.nl',
    folder: 'sent',
  });

  assert.equal(message.to, 'equirehab4you@gmail.com');
  assert.equal(message.toDisplay, 'Sandra van Berkel <equirehab4you@gmail.com>');
  assert.equal(message.cc, 'Collega <collega@softora.nl>');
  assert.equal(message.bcc, 'Servé Creusen <serve@softora.nl>');
  assert.equal(message.recipientRoutingEvidenceKnown, true);
  assert.deepEqual(message.attachments, [{
    filename: 'voorstel.pdf',
    contentType: 'application/pdf',
    size: 8,
  }]);
});

test('mailbox service never reuses quoted cid campaign images as incoming-message media', async () => {
  const sentDate = new Date('2026-05-18T13:18:00.000Z');
  const client = createFakeImapClient({
    boxes: [{ path: 'INBOX' }],
    messagesByMailbox: {
      INBOX: [
        {
          uid: 44,
          flags: ['\\Seen'],
          internalDate: sentDate,
          source: {
            date: sentDate,
            text: [
              'Ziet er goed uit.',
              '',
              'Op ma 18 mei 2026 om 15:18 schreef Servé Creusen',
              '[image: Softora Testmodus webdesign]',
              '[image: Softora Testmodus device mockup]',
            ].join('\n'),
            html: [
              '<p>Ziet er goed uit.</p>',
              '<blockquote>',
              '<img src="cid:webdesign-softora-test-mode-recipient@softora" alt="Softora Testmodus webdesign">',
              '<img src="cid:webdesign-mockup-softora-test-mode-recipient@softora" alt="Softora Testmodus device mockup">',
              '</blockquote>',
            ].join(''),
            subject: 'Re: Nieuw webdesign gemaakt',
            from: { value: [{ name: 'Klant', address: 'klant@example.nl' }] },
            to: { value: [{ name: 'Serve', address: 'serve@softora.nl' }] },
            attachments: [
              {
                cid: 'webdesign-softora-test-mode-recipient@softora',
                contentType: 'image/png',
                content: Buffer.from('webdesign-photo'),
              },
              {
                contentId: '<webdesign-mockup-softora-test-mode-recipient@softora>',
                contentType: 'image/png',
                content: Buffer.from('device-mockup-photo'),
              },
            ],
          },
        },
      ],
    },
  });
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        imapHost: 'imap.example.test',
        imapUser: 'serve@softora.nl',
        imapPass: 'secret',
      },
    ]),
    createImapClient: () => client,
    parseMailSource: async (source) => source,
  });

  const messages = await service.listMessages({ accountEmail: 'serve@softora.nl', folder: 'inbox' });

  assert.equal(messages.length, 1);
  assert.match(messages[0].body, /\[image: Softora Testmodus webdesign\]/);
  assert.deepEqual(messages[0].bodyImages, []);
  assert.deepEqual(messages[0].inlineImages, []);
  assert.equal(messages[0].bodyImageEvidenceKnown, true);
  assert.equal(messages[0].embeddedImageCount, 2);
  assert.equal(messages[0].originalCampaignOutbound, false);
  assert.doesNotMatch(messages[0].preview, /\[image:/);
});

test('mailbox service keeps inline cid images when plain text has no image placeholders', async () => {
  const sentDate = new Date('2026-05-18T15:18:00.000Z');
  const client = createFakeImapClient({
    boxes: [{ path: 'INBOX/Verstuurd' }],
    messagesByMailbox: {
      'INBOX/Verstuurd': [
        {
          uid: 61,
          flags: ['\\Seen'],
          internalDate: sentDate,
          source: {
            date: sentDate,
            text: [
              'Goedemiddag,',
              '',
              'Ik heb een nieuw webdesign voor jullie site gemaakt.',
              '',
              'Met vriendelijke groet,',
              'Servé Creusen',
            ].join('\n'),
            html: [
              '<p>Goedemiddag,</p>',
              '<p>Ik heb een nieuw webdesign voor jullie site gemaakt.</p>',
              '<img src="cid:webdesign-softora-test-mode-recipient@softora" alt="Softora Testmodus webdesign">',
              '<p>Met vriendelijke groet,<br>Servé Creusen</p>',
            ].join(''),
            subject: 'Nieuw webdesign gemaakt',
            from: { value: [{ name: 'Servé Creusen', address: 'serve@softora.nl' }] },
            to: { value: [{ name: 'Klant', address: 'klant@example.nl' }] },
            attachments: [
              {
                cid: 'webdesign-softora-test-mode-recipient@softora',
                contentType: 'image/png',
                content: Buffer.from('webdesign-photo'),
              },
            ],
          },
        },
      ],
    },
  });
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        imapHost: 'imap.example.test',
        imapUser: 'serve@softora.nl',
        imapPass: 'secret',
      },
    ]),
    createImapClient: () => client,
    parseMailSource: async (source) => source,
  });

  const messages = await service.listMessages({ accountEmail: 'serve@softora.nl', folder: 'sent' });

  assert.equal(messages.length, 1);
  assert.doesNotMatch(messages[0].body, /\[image:/);
  assert.equal(messages[0].bodyImages.length, 1);
  assert.equal(messages[0].bodyImages[0].alt, 'Softora Testmodus webdesign');
  assert.equal(messages[0].bodyImages[0].dataUrl, 'data:image/png;base64,d2ViZGVzaWduLXBob3Rv');
  assert.equal(messages[0].bodyImages[0].owner, undefined);
  assert.equal(messages[0].bodyImageEvidenceKnown, true);
  assert.equal(messages[0].embeddedImageCount, 1);
  assert.equal(messages[0].originalCampaignOutbound, true);
});

test('mailbox service never turns a quoted image placeholder into stored database media', async () => {
  const photoKey = 'softora_database_photo_data_v1_softora_testmodus';
  const client = createFakeImapClient({
    boxes: [{ path: 'INBOX' }],
    messagesByMailbox: {
      INBOX: [
        {
          uid: 44,
          flags: ['\\Seen'],
          internalDate: new Date('2026-05-18T13:18:00.000Z'),
          source: {
            date: new Date('2026-05-18T13:18:00.000Z'),
            text: [
              'Ziet er goed uit.',
              '',
              'Op ma 18 mei 2026 om 15:18 schreef Servé Creusen',
              '[image: Softora Testmodus webdesign]',
              'Geen webdesign willen ontvangen? Laat het me weten!',
            ].join('\n'),
            html: '',
            subject: 'Re: Nieuw webdesign gemaakt',
            from: { value: [{ name: 'Klant', address: 'klant@example.nl' }] },
            to: { value: [{ name: 'Serve', address: 'serve@softora.nl' }] },
            attachments: [],
          },
        },
      ],
    },
  });
  let stateReads = 0;
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        imapHost: 'imap.example.test',
        imapUser: 'serve@softora.nl',
        imapPass: 'secret',
      },
    ]),
    getUiStateValues: async (scope) => {
      stateReads += 1;
      if (scope === 'premium_customers_database') return { values: {} };
      assert.equal(scope, 'premium_database_photos');
      return {
        values: {
          softora_database_photos_v1: JSON.stringify({
            softora_testmodus: {
              id: 'softora_testmodus',
              photoKey,
              chunkCount: 1,
              websitePhotoName: 'Softora Testmodus webdesign.png',
            },
          }),
          [`${photoKey}_0`]: TINY_PNG_DATA_URL,
        },
      };
    },
    createImapClient: () => client,
    parseMailSource: async (source) => source,
  });

  const messages = await service.listMessages({ accountEmail: 'serve@softora.nl', folder: 'inbox' });

  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].bodyImages, []);
  assert.deepEqual(messages[0].inlineImages, []);
  assert.equal(messages[0].embeddedImageCount, 0);
  assert.equal(stateReads, 0);
});

test('mailbox service trusts indexed zero-image evidence and never synthesizes reply media', async () => {
  let imapCalls = 0;
  const customerId = 'devyldre';
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        imapHost: 'imap.example.test',
        imapUser: 'serve@softora.nl',
        imapPass: 'secret',
      },
    ]),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      getMessage: async () => ({
        id: 'inbox:44',
        uid: 44,
        folder: 'inbox',
        from: 'De Vyldre',
        email: 'info@devyldre.com',
        to: 'serve@softora.nl',
        subject: 'Re: Kleine vraag over jullie website',
        body: [
          'Dankjewel voor je mail.',
          '',
          'Op 20 jul 2026 om 07:12 heeft Servé Creusen het volgende geschreven:',
          '',
          'Afgelopen week kwam ik jullie website devyldre.com tegen.',
          'Uit enthousiasme heb ik een fris webdesign gemaakt.',
          'Hieronder zie je een korte indruk van de eerste versie op verschillende schermen.',
        ].join('\n'),
        hasBody: true,
        bodyImageEvidenceKnown: true,
        embeddedImageCount: 0,
        originalCampaignOutbound: false,
        indexed: true,
      }),
    },
    getUiStateValues: async (scope) => {
      if (scope === 'premium_database_photos') {
        return {
          values: {
            softora_database_photos_v1: JSON.stringify({
              [customerId]: {
                id: customerId,
                websitePhoto: TINY_PNG_DATA_URL,
                websitePhotoName: 'De Vyldre webdesign.png',
                websiteMockup: TINY_PNG_DATA_URL,
                websiteMockupName: 'De Vyldre device mockup.png',
              },
            }),
          },
        };
      }
      if (scope === 'premium_customers_database') {
        return {
          values: {
            softora_customers_premium_v1: JSON.stringify([
              {
                id: customerId,
                bedrijf: 'De Vyldre',
                dom: 'devyldre.com',
                email: 'info@devyldre.com',
              },
            ]),
          },
        };
      }
      return { values: {} };
    },
    createImapClient: () => {
      imapCalls += 1;
      return createUidValidityCheckClient(777);
    },
  });

  const message = await service.getMessage({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    id: 'inbox:44',
    uidValidity: 777,
  });

  assert.equal(imapCalls, 1);
  assert.deepEqual(message.bodyImages || [], []);
  assert.deepEqual(message.inlineImages || [], []);
  assert.doesNotMatch(message.body, /\[image:/);
});

test('mailbox service weigert een volledig geïndexeerd detail uit een stale UIDVALIDITY-generatie', async () => {
  const events = [];
  const indexReads = [];
  const service = createMailboxService({
    logger: { error() {} },
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl',
      imapHost: 'imap.example.test',
      imapUser: 'serve@softora.nl',
      imapPass: 'secret',
    }]),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      getMessage: async (input) => {
        indexReads.push(input);
        return {
          id: 'inbox:42', uid: 42, uidValidity: 111, folder: 'inbox',
          accountEmail: 'serve@softora.nl', email: 'klant@example.nl', to: 'serve@softora.nl',
          body: 'Oude generatie', hasBody: true, bodyImageEvidenceKnown: true, embeddedImageCount: 0,
        };
      },
    },
    createImapClient: () => createUidValidityCheckClient(222, events),
  });
  const res = createResponseRecorder();

  await service.getMessageResponse({
    query: { account: 'serve@softora.nl', folder: 'inbox', id: 'inbox:42', uidValidity: 111 },
  }, res);

  assert.equal(res.statusCode, 409);
  assert.match(res.body.detail, /UIDVALIDITY/i);
  assert.deepEqual(indexReads, [{
    accountEmail: 'serve@softora.nl', folder: 'inbox', id: 'inbox:42', uidValidity: 111,
  }]);
  assert.deepEqual(events, ['connect', 'lock:INBOX', 'release:INBOX', 'logout']);
});

test('mailbox service never replaces stale indexed image labels with another stored design', async () => {
  const requestedCustomerIds = [];
  const customerId = 'nicole-vintage-fashion';
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        imapHost: 'imap.example.test',
        imapUser: 'serve@softora.nl',
        imapPass: 'secret',
      },
    ]),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      getMessage: async () => ({
        id: 'inbox:45',
        uid: 45,
        folder: 'inbox',
        from: 'Nicole Pennings',
        email: 'info@nicolevintagefashion.com',
        to: 'serve@softora.nl',
        subject: 'Re: Kleine vraag over jullie website',
        body: [
          'Dank voor de moeite.',
          '',
          'Afgelopen week kwam ik jullie website nicolevintagefashion.com tegen.',
          'Uit enthousiasme heb ik een fris webdesign gemaakt.',
          '',
          '[image: www.dejavu-kapsalon.nl-preview]',
          '[image: www.dejavu-kapsalon.nl-preview-device-mockup-v8]',
        ].join('\n'),
        hasBody: true,
        bodyImageEvidenceKnown: true,
        embeddedImageCount: 0,
        originalCampaignOutbound: false,
        indexed: true,
      }),
    },
    getUiStateValues: async (scope) => {
      if (scope === 'premium_database_photos') {
        return {
          values: {
            softora_database_photos_v1: JSON.stringify({
              'deja-vu': {
                id: 'deja-vu',
                websitePhoto: TINY_PNG_DATA_URL,
                websitePhotoName: 'www.dejavu-kapsalon.nl-preview.png',
                websiteMockup: TINY_PNG_DATA_URL,
                websiteMockupName: 'www.dejavu-kapsalon.nl-preview-device-mockup-v8.jpg',
              },
            }),
          },
        };
      }
      if (scope === 'premium_customers_database') {
        return {
          values: {
            softora_customers_premium_v1: JSON.stringify([
              {
                id: 'deja-vu',
                bedrijf: 'Deja Vu Hairdressers',
                dom: 'dejavu-kapsalon.nl',
                email: 'info@dejavu-kapsalon.nl',
              },
              {
                id: customerId,
                bedrijf: 'Nicole Vintage Fashion',
                dom: 'nicolevintagefashion.com',
                email: 'info@nicolevintagefashion.com',
                websitePhoto: 'https://expired.example/nicole.png',
                websiteMockup: 'https://expired.example/nicole-mockup.png',
              },
            ]),
          },
        };
      }
      return { values: {} };
    },
    dataOpsStore: {
      listDesignPhotosWithSignedUrls: async (options) => {
        requestedCustomerIds.push(...options.customerIds);
        return [
          {
            customerId,
            websitePhotoUrl: TINY_PNG_DATA_URL,
            websiteMockupUrl: TINY_PNG_DATA_URL,
            fileName: 'nicolevintagefashion.com-preview.png',
            websiteMockupName: 'nicolevintagefashion.com-preview-device-mockup.jpg',
          },
        ];
      },
    },
    createImapClient: () => createUidValidityCheckClient(777),
  });

  const message = await service.getMessage({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    id: 'inbox:45',
    uidValidity: 777,
  });

  assert.deepEqual(requestedCustomerIds, []);
  assert.deepEqual(message.bodyImages || [], []);
  assert.match(message.body, /\[image: www\.dejavu-kapsalon\.nl-preview\]/);
});

test('mailbox service never falls back to another company design for a matched recipient', async () => {
  const customerId = 'nicole-vintage-fashion';
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        imapHost: 'imap.example.test',
        imapUser: 'serve@softora.nl',
        imapPass: 'secret',
      },
    ]),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      getMessage: async () => ({
        id: 'inbox:46',
        uid: 46,
        folder: 'inbox',
        from: 'Nicole Pennings',
        email: 'info@nicolevintagefashion.com',
        to: 'serve@softora.nl',
        subject: 'Re: Kleine vraag over jullie website',
        body: [
          'Dank voor de moeite.',
          '',
          'Afgelopen week kwam ik jullie website nicolevintagefashion.com tegen.',
          'Uit enthousiasme heb ik een fris webdesign gemaakt.',
          '',
          '[image: www.dejavu-kapsalon.nl-preview]',
          '[image: www.dejavu-kapsalon.nl-preview-device-mockup-v8]',
        ].join('\n'),
        hasBody: true,
        bodyImageEvidenceKnown: true,
        embeddedImageCount: 0,
        originalCampaignOutbound: false,
        indexed: true,
      }),
    },
    getUiStateValues: async (scope) => {
      if (scope === 'premium_database_photos') {
        return {
          values: {
            softora_database_photos_v1: JSON.stringify({
              'deja-vu': {
                id: 'deja-vu',
                websitePhoto: TINY_PNG_DATA_URL,
                websitePhotoName: 'www.dejavu-kapsalon.nl-preview.png',
                websiteMockup: TINY_PNG_DATA_URL,
                websiteMockupName: 'www.dejavu-kapsalon.nl-preview-device-mockup-v8.jpg',
              },
            }),
          },
        };
      }
      if (scope === 'premium_customers_database') {
        return {
          values: {
            softora_customers_premium_v1: JSON.stringify([
              {
                id: 'deja-vu',
                bedrijf: 'Deja Vu Hairdressers',
                dom: 'dejavu-kapsalon.nl',
                email: 'info@dejavu-kapsalon.nl',
              },
              {
                id: customerId,
                bedrijf: 'Nicole Vintage Fashion',
                dom: 'nicolevintagefashion.com',
                email: 'info@nicolevintagefashion.com',
              },
            ]),
          },
        };
      }
      return { values: {} };
    },
    dataOpsStore: {
      listDesignPhotosWithSignedUrls: async () => [],
    },
    createImapClient: () => createUidValidityCheckClient(777),
  });

  const message = await service.getMessage({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    id: 'inbox:46',
    uidValidity: 777,
  });

  assert.equal((message.bodyImages || []).length, 0);
  assert.equal((message.inlineImages || []).length, 0);
});

test('mailbox service keeps link-only webdesign sends free of recovered image placeholders', async () => {
  const client = createFakeImapClient({
    boxes: [{ path: 'INBOX/Verstuurd' }],
    messagesByMailbox: {
      'INBOX/Verstuurd': [
        {
          uid: 55,
          flags: ['\\Seen'],
          internalDate: new Date('2026-06-11T06:21:00.000Z'),
          source: {
            date: new Date('2026-06-11T06:21:00.000Z'),
            text: [
              'Goedendag,',
              '',
              'Afgelopen week kwam ik jullie website (jagthuijs.nl) tegen.',
              '',
              'Vanuit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
              '',
              'Je kunt het webdesign hier bekijken 👈',
              '',
              'Met vriendelijke groet,',
              'Servé Creusen',
              '',
              '📍 Liempde',
            ].join('\n'),
            html: '',
            subject: 'Kleine vraag over jullie website',
            from: { value: [{ name: 'Servé Creusen', address: 'serve@softora.nl' }] },
            to: { value: [{ name: 'Jaghthuijs', address: 'info@jagthuijs.nl' }] },
            attachments: [],
          },
        },
      ],
    },
  });
  const requestedScopes = [];
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        imapHost: 'imap.example.test',
        imapUser: 'serve@softora.nl',
        imapPass: 'secret',
      },
    ]),
    getUiStateValues: async (scope) => {
      requestedScopes.push(scope);
      return { values: {} };
    },
    createImapClient: () => client,
    parseMailSource: async (source) => source,
  });

  const messages = await service.listMessages({ accountEmail: 'serve@softora.nl', folder: 'sent' });

  assert.equal(messages.length, 1);
  assert.doesNotMatch(messages[0].body, /\[image:/i);
  assert.doesNotMatch(messages[0].body, /korte indruk van de eerste versie/i);
  assert.equal(messages[0].bodyImages.length, 0);
  assert.equal(messages[0].bodyImageEvidenceKnown, true);
  assert.equal(messages[0].embeddedImageCount, 0);
  assert.equal(messages[0].originalCampaignOutbound, true);
  assert.deepEqual(requestedScopes, []);
});

test('mailbox service herstelt alleen de exacte oorspronkelijke webdesignlink uit MIME-html', async () => {
  const exactUrl =
    'https://www.softora.nl/webdesign/salon-tof?cid=safe-row-247&sender=serve';
  const plainBody = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website salontof.nl tegen.',
    '',
    'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link bekijken 🎨',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
  ].join('\n');
  const client = createFakeImapClient({
    boxes: [{ path: 'INBOX/Verstuurd' }],
    messagesByMailbox: {
      'INBOX/Verstuurd': [{
        uid: 247,
        flags: ['\\Seen'],
        internalDate: new Date('2026-07-24T10:59:00.000Z'),
        source: {
          date: new Date('2026-07-24T10:59:00.000Z'),
          text: plainBody,
          html: [
            '<p>Goedendag,</p>',
            '<p>Afgelopen week kwam ik jullie website salontof.nl tegen.</p>',
            '<p><a href="https://evil.example/webdesign/verkeerd">deze link</a></p>',
            '<p>Bekijk onze referentie: <a href="https://www.softora.nl/webdesign/verkeerd">deze link</a>.</p>',
            `<p>Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze <a href="${exactUrl.replaceAll('&', '&amp;')}">link</a> bekijken 🎨</p>`,
            '<script>alert("xss")</script>',
          ].join(''),
          subject: 'Kleine vraag over jullie website',
          from: { value: [{ name: 'Servé Creusen', address: 'serve@softora.nl' }] },
          to: { value: [{ name: 'Salon TOF', address: 'info@salontof.nl' }] },
          attachments: [],
        },
      }],
    },
  });
  const upserts = [];
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl',
      imapHost: 'imap.example.test',
      imapUser: 'serve@softora.nl',
      imapPass: 'secret',
    }]),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      getMessage: async () => ({
        id: 'sent:247',
        uid: 247,
        folder: 'sent',
        accountEmail: 'serve@softora.nl',
        subject: 'Kleine vraag over jullie website',
        body: plainBody,
        hasBody: true,
        bodyTruncated: false,
        bodyImageEvidenceKnown: true,
        embeddedImageCount: 0,
        originalCampaignOutbound: true,
        webdesignLinkEvidenceKnown: false,
        webdesignLinkUrl: '',
        indexed: true,
      }),
      upsertMessages: async (payload) => {
        upserts.push(payload);
        return { ok: true };
      },
    },
    createImapClient: () => client,
    parseMailSource: async (source) => source,
  });

  const message = await service.getMessage({
    accountEmail: 'serve@softora.nl',
    folder: 'sent',
    id: 'sent:247',
    uidValidity: 777,
  });

  assert.match(
    message.body,
    new RegExp(`deze link \\[${exactUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`)
  );
  assert.doesNotMatch(message.body, /evil\.example|alert\(/);
  assert.equal(message.body.toLowerCase().includes('<script'), false);
  assert.equal(message.webdesignLinkEvidenceKnown, true);
  assert.equal(message.webdesignLinkUrl, exactUrl);
  assert.equal(upserts.length, 0);
});

test('mailbox service exposes hidden coldmail opt-out links for clickable mail previews', async () => {
  const client = createFakeImapClient({
    boxes: [{ path: 'INBOX/Verstuurd' }],
    messagesByMailbox: {
      'INBOX/Verstuurd': [
        {
          uid: 58,
          flags: ['\\Seen'],
          internalDate: new Date('2026-05-18T15:18:00.000Z'),
          source: {
            date: new Date('2026-05-18T15:18:00.000Z'),
            text: [
              'Goedemiddag,',
              '',
              'Geen webdesign willen ontvangen? Laat het me weten!',
            ].join('\n'),
            html: [
              '<p>Goedemiddag,</p>',
              '<p><a href="https://www.softora.nl/afmelden?t=test-token">Geen webdesign willen ontvangen? Laat het me weten!</a></p>',
            ].join(''),
            subject: 'Nieuw webdesign gemaakt!',
            from: { value: [{ name: 'Servé Creusen', address: 'serve@softora.nl' }] },
            to: { value: [{ name: 'Klant', address: 'klant@example.nl' }] },
            attachments: [],
          },
        },
      ],
    },
  });
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        imapHost: 'imap.example.test',
        imapUser: 'serve@softora.nl',
        imapPass: 'secret',
      },
    ]),
    createImapClient: () => client,
    parseMailSource: async (source) => source,
  });

  const messages = await service.listMessages({ accountEmail: 'serve@softora.nl', folder: 'sent' });

  assert.equal(messages.length, 1);
  assert.match(messages[0].body, /Geen webdesign willen ontvangen\? Laat het me weten!/);
  assert.doesNotMatch(messages[0].body, /test-token/);
  assert.equal(messages[0].optOutUrl, 'https://www.softora.nl/afmelden?t=test-token');
});

test('mailbox service never infers sent webdesign images from links or stored customer designs', async () => {
  const photoUrl = 'https://example.supabase.co/storage/v1/object/sign/jagthuijs-design-photo.png?token=photo';
  const mockupUrl = 'https://example.supabase.co/storage/v1/object/sign/jagthuijs-design-mockup.png?token=mockup';
  const softoraPhotoUrl = 'https://example.supabase.co/storage/v1/object/sign/softora-design-photo.png?token=photo';
  const softoraMockupUrl = 'https://example.supabase.co/storage/v1/object/sign/softora-design-mockup.png?token=mockup';
  const fetchedUrls = [];
  const oldFetch = global.fetch;
  global.fetch = async (url) => {
    fetchedUrls.push(String(url));
    const buffer = String(url).includes('mockup') ? Buffer.from('device-mockup-photo') : Buffer.from('webdesign-photo');
    return {
      ok: true,
      headers: {
        get(name) {
          if (String(name).toLowerCase() === 'content-type') return 'image/png';
          if (String(name).toLowerCase() === 'content-length') return String(buffer.length);
          return '';
        },
      },
      async arrayBuffer() {
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      },
    };
  };

  try {
    const client = createFakeImapClient({
      boxes: [{ path: 'INBOX/Verstuurd' }],
      messagesByMailbox: {
        'INBOX/Verstuurd': [
          {
            uid: 62,
            flags: ['\\Seen'],
            internalDate: new Date('2026-05-18T19:04:00.000Z'),
            source: {
              date: new Date('2026-05-18T19:04:00.000Z'),
              text: [
                'Goedemiddag,',
                '',
                'Afgelopen week kwam ik toevallig jullie website (jagthuijs.nl) tegen.',
                'Vanuit enthousiasme heb ik een nieuw webdesign voor jullie site gemaakt.',
                '',
                'Met vriendelijke groet,',
                'Servé Creusen',
                '📍 Haaren',
                '📞 0629917185',
                '',
                'Geen webdesign willen ontvangen? Laat het me weten!: https://www.softora.nl/afmelden?t=test',
              ].join('\n'),
              html: '',
              subject: 'Nieuw webdesign gemaakt!',
              from: { value: [{ name: 'Servé Creusen', address: 'serve@softora.nl' }] },
              to: { value: [{ name: 'Jaghthuijs', address: 'info@jagthuijs.nl' }] },
              attachments: [],
            },
          },
        ],
      },
    });
    const service = createMailboxService({
      mailboxAccountsRaw: JSON.stringify([
        {
          email: 'serve@softora.nl',
          imapHost: 'imap.example.test',
          imapUser: 'serve@softora.nl',
          imapPass: 'secret',
        },
      ]),
      getUiStateValues: async (scope) => {
        if (scope === 'premium_database_photos') {
          return {
            values: {
              softora_database_photos_v1: JSON.stringify({
                jagthuijs: {
                  id: 'jagthuijs',
                  identityKey: 'jaghthuijs|info@jagthuijs.nl',
                  websitePhotoUrl: photoUrl,
                  websiteMockupUrl: mockupUrl,
                  websitePhotoName: 'Jaghthuijs webdesign.png',
                  websiteMockupName: 'Jaghthuijs device mockup.png',
                },
                softora_site: {
                  id: 'softora_site',
                  identityKey: 'softora|info@softora.nl',
                  websitePhotoUrl: softoraPhotoUrl,
                  websiteMockupUrl: softoraMockupUrl,
                  websitePhotoName: 'Softora webdesign.png',
                  websiteMockupName: 'Softora device mockup.png',
                },
              }),
            },
          };
        }
        if (scope === 'premium_customers_database') {
          return {
            values: {
              softora_customers_premium_v1: JSON.stringify([
                {
                  id: 'jagthuijs',
                  bedrijf: 'Jaghthuijs',
                  naam: 'Jaghthuijs',
                  tel: '0629917185',
                  dom: 'jagthuijs.nl',
                  email: 'info@jagthuijs.nl',
                },
                {
                  id: 'softora_site',
                  bedrijf: 'Softora',
                  naam: 'Softora',
                  tel: '0629917185',
                  dom: 'softora.nl',
                  email: 'info@softora.nl',
                },
              ]),
            },
          };
        }
        return { values: {} };
      },
      createImapClient: () => client,
      parseMailSource: async (source) => source,
    });

    const messages = await service.listMessages({ accountEmail: 'serve@softora.nl', folder: 'sent' });

    assert.equal(messages.length, 1);
    assert.doesNotMatch(messages[0].body, /\[image:/);
    assert.deepEqual(messages[0].bodyImages, []);
    assert.deepEqual(messages[0].inlineImages, []);
    assert.equal(messages[0].bodyImageEvidenceKnown, true);
    assert.equal(messages[0].embeddedImageCount, 0);
    assert.equal(messages[0].originalCampaignOutbound, true);
    assert.equal(messages[0].optOutUrl, 'https://www.softora.nl/afmelden?t=test');
    assert.deepEqual(fetchedUrls, []);
  } finally {
    global.fetch = oldFetch;
  }
});

test('mailbox service saves app-sent messages into the sent folder', async () => {
  const client = createFakeImapClient({
    boxes: [{ path: 'INBOX' }, { path: 'INBOX/Verstuurd' }],
    messagesByMailbox: { 'INBOX/Verstuurd': [] },
  });
  const sent = [];
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Serve',
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpUser: 'serve@softora.nl',
        smtpPass: 'secret',
        imapHost: 'imap.example.test',
        imapUser: 'serve@softora.nl',
        imapPass: 'secret',
      },
    ]),
    createTransport: (config) => ({
      sendMail: async (message) => {
        sent.push({ config, message });
        return { messageId: '<m-serve-1@softora.nl>', accepted: [message.to], rejected: [] };
      },
    }),
    createImapClient: () => client,
  });

  const result = await service.sendMessage({
    accountEmail: 'serve@softora.nl',
    to: 'klant@example.nl',
    subject: 'Test vanuit mailbox',
    text: 'Hallo klant',
  });

  assert.equal(result.sentCopySaved, true);
  assert.equal(sent.length, 1);
  assert.equal(client.appendedMessages.length, 1);
  assert.equal(client.appendedMessages[0].mailboxName, 'INBOX/Verstuurd');
  assert.match(String(client.appendedMessages[0].raw), /Subject: Test vanuit mailbox/);
});

test('mailbox service returns an empty list when an optional folder is missing', async () => {
  const client = createFakeImapClient({
    boxes: [{ path: 'INBOX' }],
    messagesByMailbox: { INBOX: [] },
  });
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        imapHost: 'imap.example.test',
        imapUser: 'serve@softora.nl',
        imapPass: 'secret',
      },
    ]),
    createImapClient: () => client,
    parseMailSource: async (source) => source,
  });

  const messages = await service.listMessages({ accountEmail: 'serve@softora.nl', folder: 'sent' });

  assert.deepEqual(messages, []);
  assert.deepEqual(client.lockedMailboxes, []);
});

test('mailbox sync noemt een ontbrekende providermap nooit compleet of vers', async () => {
  const finishCalls = [];
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl',
      imapHost: 'imap.example.test',
      imapUser: 'serve@softora.nl',
      imapPass: 'secret',
    }]),
    createImapClient: () => createFakeImapClient({
      boxes: [{ path: 'INBOX' }],
      messagesByMailbox: { INBOX: [] },
    }),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      acquireSyncLock: async () => ({ ok: true, lockToken: 'missing-folder-lock' }),
      upsertMessages: async () => ({ ok: true, upserted: 0 }),
      finishSync: async (options) => { finishCalls.push(options); return { ok: true }; },
    },
    logger: { info() {}, warn() {}, error() {} },
  });

  const result = await service.syncMailboxFolder({
    accountEmail: 'serve@softora.nl', folder: 'sent', force: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.complete, false);
  assert.equal(result.freshnessConfirmed, false);
  assert.equal(result.partial, true);
  assert.equal(result.folderMissing, true);
  assert.equal(result.reason, 'folder_missing');
  assert.equal(result.code, 'MAILBOX_SYNC_FOLDER_MISSING');
  assert.match(finishCalls[0].error, /mailboxmap ontbreekt/i);
});

test('mailbox service derives imap settings from smtp settings when possible', async () => {
  const service = createMailboxService({
    mailConfig: {
      mailFromAddress: 'info@softora.nl',
      smtpHost: 'smtp.softora.nl',
      smtpUser: 'info@softora.nl',
      smtpPass: 'secret',
    },
  });
  const res = createResponseRecorder();

  await service.accountsResponse({}, res);

  const info = res.body.accounts.find((account) => account.email === 'info@softora.nl');
  assert.equal(info.imapConfigured, true);
  assert.equal(info.smtpConfigured, true);
});

test('mailbox service derives per-account imap settings from per-account smtp env', async () => {
  const oldEnv = { ...process.env };
  process.env.MAILBOX_INFO_SMTP_HOST = 'smtp.softora.nl';
  process.env.MAILBOX_INFO_SMTP_USER = 'info@softora.nl';
  process.env.MAILBOX_INFO_SMTP_PASS = 'secret';
  try {
    const service = createMailboxService({ mailConfig: {} });
    const res = createResponseRecorder();

    await service.accountsResponse({}, res);

    const info = res.body.accounts.find((account) => account.email === 'info@softora.nl');
    assert.equal(info.imapConfigured, true);
  } finally {
    process.env = oldEnv;
  }
});

test('mailbox service connects softora accounts from shared mail hosts and compact account passwords', async () => {
  const oldEnv = { ...process.env };
  process.env.MAILBOX_INFO_PASS = 'secret';
  try {
    const service = createMailboxService({
      mailConfig: {
        smtpHost: 'smtp.strato.com',
        smtpPort: 465,
        smtpSecure: true,
      },
    });
    const accounts = service.getAccounts();
    const info = accounts.find((account) => account.email === 'info@softora.nl');

    assert.equal(info.smtpConfigured, true);
    assert.equal(info.imapConfigured, true);
    assert.equal(info.smtpHost, 'smtp.strato.com');
    assert.equal(info.smtpPort, 465);
    assert.equal(info.smtpSecure, true);
    assert.equal(info.smtpUser, 'info@softora.nl');
    assert.equal(info.imapHost, 'imap.strato.com');
    assert.equal(info.imapUser, 'info@softora.nl');
  } finally {
    process.env = oldEnv;
  }
});

test('mailbox service accepts full email env keys from Render blueprints', async () => {
  const oldEnv = { ...process.env };
  process.env.MAILBOX_SERVE_SOFTORA_NL_PASS = 'serve-secret';
  try {
    const service = createMailboxService({
      mailConfig: {
        smtpHost: 'smtp.strato.com',
        smtpPort: 465,
        smtpSecure: true,
      },
    });
    const serve = service.getAccounts().find((account) => account.email === 'serve@softora.nl');

    assert.equal(serve.smtpConfigured, true);
    assert.equal(serve.imapConfigured, true);
    assert.equal(serve.smtpUser, 'serve@softora.nl');
    assert.equal(serve.smtpPass, 'serve-secret');
    assert.equal(serve.imapUser, 'serve@softora.nl');
    assert.equal(serve.imapPass, 'serve-secret');
  } finally {
    process.env = oldEnv;
  }
});

test('mailbox service supports domain-level softora mailbox provider defaults', async () => {
  const oldEnv = { ...process.env };
  process.env.MAILBOX_SOFTORA_NL_SMTP_HOST = 'smtp.strato.com';
  process.env.MAILBOX_SOFTORA_NL_SMTP_PORT = '465';
  process.env.MAILBOX_SOFTORA_NL_SMTP_SECURE = 'true';
  process.env.MAILBOX_SOFTORA_NL_IMAP_HOST = 'imap.strato.com';
  process.env.MAILBOX_SOFTORA_NL_IMAP_PORT = '993';
  process.env.MAILBOX_SOFTORA_NL_IMAP_SECURE = 'true';
  process.env.MAILBOX_RUBEN_PASS = 'secret';
  try {
    const service = createMailboxService({ mailConfig: {} });
    const ruben = service.getAccounts().find((account) => account.email === 'ruben@softora.nl');

    assert.equal(ruben.smtpConfigured, true);
    assert.equal(ruben.imapConfigured, true);
    assert.equal(ruben.smtpHost, 'smtp.strato.com');
    assert.equal(ruben.smtpPort, 465);
    assert.equal(ruben.smtpSecure, true);
    assert.equal(ruben.imapHost, 'imap.strato.com');
    assert.equal(ruben.imapPort, 993);
    assert.equal(ruben.imapSecure, true);
  } finally {
    process.env = oldEnv;
  }
});

test('mailbox service can intentionally expose aliases through the base mailbox credentials', async () => {
  const oldEnv = { ...process.env };
  process.env.MAILBOX_SOFTORA_NL_USE_BASE_CREDENTIALS = 'true';
  try {
    const service = createMailboxService({
      mailConfig: {
        mailFromAddress: 'zakelijk@theimpactbox.co',
        mailFromName: 'Impactbox',
        smtpHost: 'smtp.strato.com',
        smtpUser: 'zakelijk@theimpactbox.co',
        smtpPass: 'secret',
        imapHost: 'imap.strato.com',
        imapUser: 'zakelijk@theimpactbox.co',
        imapPass: 'secret',
      },
    });
    const info = service.getAccounts().find((account) => account.email === 'info@softora.nl');

    assert.equal(info.smtpConfigured, true);
    assert.equal(info.imapConfigured, true);
    assert.equal(info.smtpUser, 'zakelijk@theimpactbox.co');
    assert.equal(info.imapUser, 'zakelijk@theimpactbox.co');
  } finally {
    process.env = oldEnv;
  }
});

test('mailbox service marks opened messages as seen through IMAP uid flags', async () => {
  const calls = [];
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Servé',
        imapHost: 'imap.example.test',
        imapUser: 'serve@softora.nl',
        imapPass: 'secret',
      },
    ]),
    createImapClient: (config) => ({
      usable: true,
      mailbox: { uidValidity: 777 },
      connect: async () => calls.push(['connect', config.auth.user]),
      list: async () => [{ path: 'INBOX' }],
      getMailboxLock: async (mailboxName) => {
        calls.push(['lock', mailboxName]);
        return { release: () => calls.push(['release', mailboxName]) };
      },
      messageFlagsAdd: async (uids, flags, options) => {
        calls.push(['flagsAdd', uids, flags, options]);
      },
      logout: async () => calls.push(['logout']),
    }),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      markMessageRead: async (input) => {
        calls.push(['indexRead', input]);
        return { ok: true };
      },
    },
  });
  const res = createResponseRecorder();

  await service.markMessageReadResponse(
    {
      body: {
        account: 'serve@softora.nl',
        id: 'inbox:42',
        uidValidity: 777,
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.result, {
    account: 'serve@softora.nl',
    folder: 'inbox',
    uid: 42,
    uidValidity: 777,
    unread: false,
  });
  assert.deepEqual(calls, [
    ['connect', 'serve@softora.nl'],
    ['lock', 'INBOX'],
    ['indexRead', { accountEmail: 'serve@softora.nl', id: 'inbox:42', folder: 'inbox', uid: 42, uidValidity: 777 }],
    ['flagsAdd', [42], ['\\Seen'], { uid: true }],
    ['release', 'INBOX'],
    ['logout'],
  ]);
});

test('mailbox service weigert stale UIDVALIDITY vóór database- en IMAP-leesmutatie', async () => {
  const mutations = [];
  const service = createMailboxService({
    logger: { error() {} },
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl',
      name: 'Servé',
      imapHost: 'imap.example.test',
      imapUser: 'serve@softora.nl',
      imapPass: 'secret',
    }]),
    createImapClient: () => ({
      usable: true,
      mailbox: { uidValidity: 222 },
      connect: async () => {},
      list: async () => [{ path: 'INBOX' }],
      getMailboxLock: async () => ({ release() {} }),
      messageFlagsAdd: async (...args) => mutations.push(['imap-seen', ...args]),
      logout: async () => {},
    }),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      markMessageRead: async (input) => {
        mutations.push(['index-read', input]);
        return { ok: true };
      },
    },
  });

  const staleRes = createResponseRecorder();
  await service.markMessageReadResponse({
    body: {
      account: 'serve@softora.nl',
      id: 'inbox:42',
      uid: 42,
      uidValidity: 111,
    },
  }, staleRes);

  assert.equal(staleRes.statusCode, 409);
  assert.match(staleRes.body.detail, /UIDVALIDITY/i);
  assert.deepEqual(mutations, []);

  const currentRes = createResponseRecorder();
  await service.markMessageReadResponse({
    body: {
      account: 'serve@softora.nl',
      id: 'inbox:42',
      uid: 42,
      uidValidity: 222,
    },
  }, currentRes);

  assert.equal(currentRes.statusCode, 200);
  assert.deepEqual(mutations, [
    ['index-read', {
      accountEmail: 'serve@softora.nl',
      id: 'inbox:42',
      folder: 'inbox',
      uid: 42,
      uidValidity: 222,
    }],
    ['imap-seen', [42], ['\\Seen'], { uid: true }],
  ]);
});

test('mailbox service handelt een antwoordherinnering pas na een geslaagde leesactie duurzaam af', async () => {
  const calls = [];
  const dismissedAt = '2026-08-04T15:10:00.000Z';
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl',
      name: 'Servé',
      imapHost: 'imap.example.test',
      imapUser: 'serve@softora.nl',
      imapPass: 'secret',
    }]),
    createImapClient: () => ({
      usable: true,
      mailbox: { uidValidity: 777 },
      connect: async () => calls.push(['connect']),
      list: async () => [{ path: 'INBOX' }],
      getMailboxLock: async () => ({ release: () => calls.push(['release']) }),
      messageFlagsAdd: async () => calls.push(['seen']),
      logout: async () => calls.push(['logout']),
    }),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      markMessageRead: async () => ({ ok: true }),
      markMessageReplyDismissed: async (input) => {
        calls.push(['dismiss', input]);
        return { ok: true, data: [{ message_key: 'serve@softora.nl|inbox|42' }], dismissedAt };
      },
    },
  });
  const res = createResponseRecorder();

  await service.markMessageReadResponse({
    body: { account: 'serve@softora.nl', id: 'inbox:42', uidValidity: 777, dismissReply: true },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.result.replyDismissedAt, dismissedAt);
  assert.deepEqual(calls, [
    ['connect'],
    ['dismiss', { accountEmail: 'serve@softora.nl', id: 'inbox:42', folder: 'inbox', uid: 42, uidValidity: 777 }],
    ['seen'],
    ['release'],
    ['logout'],
  ]);
});

test('mailbox service muteert niets als de atomische lees-en-dismissupdate stale blijkt', async () => {
  const mutations = [];
  const staleError = Object.assign(new Error('Stale UIDVALIDITY'), {
    code: 'MAILBOX_UIDVALIDITY_STALE',
    status: 409,
  });
  const service = createMailboxService({
    logger: { error() {} },
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl',
      imapHost: 'imap.example.test',
      imapUser: 'serve@softora.nl',
      imapPass: 'secret',
    }]),
    createImapClient: () => ({
      ...createUidValidityCheckClient(777),
      messageFlagsAdd: async () => mutations.push('imap-seen'),
    }),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      markMessageRead: async () => { mutations.push('index-read'); return { ok: true }; },
      markMessageReplyDismissed: async () => ({ ok: false, unavailable: false, data: [], error: staleError }),
    },
  });
  const res = createResponseRecorder();

  await service.markMessageReadResponse({
    body: { account: 'serve@softora.nl', id: 'inbox:42', uidValidity: 777, dismissReply: true },
  }, res);

  assert.equal(res.statusCode, 409);
  assert.deepEqual(mutations, []);
});

test('mailbox service verbergt en herstelt een gesprek alleen in Softora zonder bronmailmutatie', async () => {
  const persistenceCalls = [];
  const actionOrder = [];
  let imapClientCreations = 0;
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Servé',
        imapHost: 'imap.example.test',
        imapUser: 'serve@softora.nl',
        imapPass: 'secret',
      },
    ]),
    createImapClient: () => {
      imapClientCreations += 1;
      let selectedMailbox = '';
      return {
        usable: true,
        mailbox: { uidValidity: 777 },
        connect: async () => {},
        list: async () => [
          { path: 'INBOX', specialUse: '\\Inbox' },
          { path: 'Sent', specialUse: '\\Sent' },
        ],
        getMailboxLock: async (mailboxName) => {
          selectedMailbox = mailboxName;
          actionOrder.push(`lock:${mailboxName}`);
          return { release: () => actionOrder.push(`release:${mailboxName}`) };
        },
        logout: async () => actionOrder.push(`logout:${selectedMailbox}`),
      };
    },
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      getSyncState: async () => ({ status: 'ok', last_error: null }),
      acquireSyncLock: async ({ folder }) => {
        actionOrder.push(`lease:${folder}`);
        return { ok: true, lockToken: `lease:${folder}` };
      },
      releaseSyncLock: async ({ folder, status }) => {
        actionOrder.push(`lease-release:${folder}:${status}`);
        return { ok: true, data: [{ sync_key: folder }] };
      },
      markMessageDeleted: async (input) => {
        actionOrder.push(`delete:${input.folder}`);
        persistenceCalls.push(['index-delete', input]);
        return { ok: true };
      },
      restoreMessage: async (input) => {
        persistenceCalls.push(['index-restore', input]);
        return { ok: true };
      },
    },
  });
  const res = createResponseRecorder();

  await service.hideConversationResponse(
    {
      body: {
        account: 'serve@softora.nl',
        id: 'inbox:42',
        messages: [
          { account: 'serve@softora.nl', id: 'inbox:42', uid: 42, uidValidity: 777, folder: 'inbox' },
          { account: 'serve@softora.nl', id: 'sent:7', uid: 7, uidValidity: 777, folder: 'sent' },
        ],
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.result, {
    hidden: true,
    sourceMailboxMutated: false,
    messageCount: 2,
    snapshotUpdated: false,
  });
  assert.equal(imapClientCreations, 2);
  assert.deepEqual(actionOrder, [
    'lease:inbox', 'lock:INBOX', 'lease:sent', 'lock:Sent',
    'delete:inbox', 'delete:sent',
    'release:Sent', 'logout:Sent', 'lease-release:sent:ok',
    'release:INBOX', 'logout:INBOX', 'lease-release:inbox:ok',
  ]);
  assert.deepEqual(persistenceCalls, [
    ['index-delete', {
      accountEmail: 'serve@softora.nl',
      id: 'inbox:42',
      folder: 'inbox',
      uid: 42,
      uidValidity: 777,
    }],
    ['index-delete', {
      accountEmail: 'serve@softora.nl',
      id: 'sent:7',
      folder: 'sent',
      uid: 7,
      uidValidity: 777,
    }],
  ]);

  const restoreRes = createResponseRecorder();
  await service.restoreConversationResponse(
    {
      body: {
        account: 'serve@softora.nl',
        id: 'inbox:42',
        messages: [
          { account: 'serve@softora.nl', id: 'inbox:42', uid: 42, uidValidity: 777, folder: 'inbox' },
          { account: 'serve@softora.nl', id: 'sent:7', uid: 7, uidValidity: 777, folder: 'sent' },
        ],
      },
    },
    restoreRes
  );
  assert.equal(restoreRes.statusCode, 200);
  assert.deepEqual(restoreRes.body.result, {
    restored: true,
    sourceMailboxMutated: false,
    messageCount: 2,
  });
  assert.equal(imapClientCreations, 4);
  assert.deepEqual(persistenceCalls.slice(-2), [
    ['index-restore', {
      accountEmail: 'serve@softora.nl',
      id: 'inbox:42',
      folder: 'inbox',
      uid: 42,
      uidValidity: 777,
    }],
    ['index-restore', {
      accountEmail: 'serve@softora.nl',
      id: 'sent:7',
      folder: 'sent',
      uid: 7,
      uidValidity: 777,
    }],
  ]);
});

test('mailbox service precontroleert elke gespreksmail en muteert niets bij één stale UIDVALIDITY', async () => {
  const indexMutations = [];
  const sourceMutations = [];
  const service = createMailboxService({
    logger: { error() {} },
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl',
      name: 'Servé',
      imapHost: 'imap.example.test',
      imapUser: 'serve@softora.nl',
      imapPass: 'secret',
    }]),
    createImapClient: () => {
      const client = {
        usable: true,
        mailbox: { uidValidity: 0 },
        connect: async () => {},
        list: async () => [
          { path: 'INBOX', specialUse: '\\Inbox' },
          { path: 'Sent', specialUse: '\\Sent' },
        ],
        getMailboxLock: async (mailboxName) => {
          client.mailbox.uidValidity = mailboxName === 'Sent' ? 222 : 111;
          return { release() {} };
        },
        messageFlagsAdd: async (...args) => sourceMutations.push(['flags', ...args]),
        messageMove: async (...args) => sourceMutations.push(['move', ...args]),
        messageDelete: async (...args) => sourceMutations.push(['delete', ...args]),
        logout: async () => {},
      };
      return client;
    },
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      markMessageDeleted: async (input) => {
        indexMutations.push(['delete', input]);
        return { ok: true };
      },
      restoreMessage: async (input) => {
        indexMutations.push(['restore', input]);
        return { ok: true };
      },
    },
  });
  const res = createResponseRecorder();

  await service.hideConversationResponse({
    body: {
      account: 'serve@softora.nl',
      id: 'inbox:42',
      messages: [
        { account: 'serve@softora.nl', id: 'inbox:42', uid: 42, uidValidity: 111, folder: 'inbox' },
        { account: 'serve@softora.nl', id: 'sent:42', uid: 42, uidValidity: 111, folder: 'sent' },
      ],
    },
  }, res);

  assert.equal(res.statusCode, 409);
  assert.match(res.body.detail, /UIDVALIDITY/i);
  assert.deepEqual(indexMutations, []);
  assert.deepEqual(sourceMutations, []);
});

test('mailbox service preflight alle indexdoelen vóór de eerste zichtbaarheidsschrijf', async () => {
  const indexMutations = [];
  let preflightCount = 0;
  const service = createMailboxService({
    logger: { error() {} },
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl',
      imapHost: 'imap.example.test',
      imapUser: 'serve@softora.nl',
      imapPass: 'secret',
    }]),
    createImapClient: () => ({
      usable: true,
      mailbox: { uidValidity: 111 },
      connect: async () => {},
      list: async () => [{ path: 'INBOX', specialUse: '\\Inbox' }, { path: 'Sent', specialUse: '\\Sent' }],
      getMailboxLock: async () => ({ release() {} }),
      logout: async () => {},
    }),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      getMessageForAction: async () => (++preflightCount === 1 ? { id: 'inbox:42' } : null),
      markMessageDeleted: async (input) => { indexMutations.push(['delete', input]); return { ok: true }; },
      restoreMessage: async (input) => { indexMutations.push(['rollback', input]); throw new Error('rollback failed'); },
    },
  });
  const res = createResponseRecorder();

  await service.hideConversationResponse({
    body: {
      account: 'serve@softora.nl',
      messages: [
        { account: 'serve@softora.nl', id: 'inbox:42', uid: 42, uidValidity: 111, folder: 'inbox' },
        { account: 'serve@softora.nl', id: 'sent:7', uid: 7, uidValidity: 111, folder: 'sent' },
      ],
    },
  }, res);

  assert.equal(res.statusCode, 409);
  assert.equal(preflightCount, 2);
  assert.deepEqual(indexMutations, []);
});

test('mailbox service strips tracking and standalone asset urls from display text', () => {
  const clean = sanitizeMailboxDisplayText(`
[https://cdn.openai.com/API/logo-assets/openai-logo-email-header-1.png]

Your authentication code

If you have questions please contact us through our help center
[https://u20216706.ct.sendgrid.net/ls/click?upn=test123]

https://u20216706.ct.sendgrid.net/wf/open?upn=test123

Bekijk normale link: [https://softora.nl/voorbeelddesign1]
`);

  assert.match(clean, /Your authentication code/);
  assert.match(clean, /If you have questions please contact us through our help center/);
  assert.match(clean, /https:\/\/softora\.nl\/voorbeelddesign1/);
  assert.doesNotMatch(clean, /cdn\.openai\.com/);
  assert.doesNotMatch(clean, /sendgrid\.net/);
});

test('mailbox service removes Gmail signature artifacts before indexing Martijn replies', () => {
  const clean = sanitizeMailboxDisplayText(`
[https://ci3.googleusercontent.com/mail-sig/AIorK4xO039AXHNmO6ZlXuH8i0cEctngV0Ftl-cF9usjh8mD9halM4-1NEbcTR5bMI4_9hVevZAMmacdAxt5]

Muziekschool Pedro van Meel

--

Muziekschool Pedro van Meel
Piano & Keyboarddocent
[https://ci3.googleusercontent.com/mail-sig/AIorK4xD5yVpdOdHdlYOPUiaBdnN7zb6OBxpDoq6jOp8n3vcDIsyFUcejkDgWeaiviNV0rt7OOXeynE]
E-mail: keyboardpianoleraar@gmail.com [keyboardpianoleraar@gmail.com]
Website: www.pianokeyboardleraar.nl [http://www.pianokeyboardleraar.nl]
Tel: 06-54967032
`);

  assert.doesNotMatch(clean, /googleusercontent\.com/i);
  assert.doesNotMatch(clean, /keyboardpianoleraar@gmail\.com\s*\[keyboardpianoleraar@gmail\.com\]/i);
  assert.equal((clean.match(/Muziekschool Pedro van Meel/g) || []).length, 1);
  assert.match(clean, /Website: www\.pianokeyboardleraar\.nl \[http:\/\/www\.pianokeyboardleraar\.nl\]/);
});

test('mailbox service rejects invalid mark-read message references', async () => {
  const service = createMailboxService({
    logger: { error() {} },
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Servé',
        imapHost: 'imap.example.test',
        imapUser: 'serve@softora.nl',
        imapPass: 'secret',
      },
    ]),
  });
  const res = createResponseRecorder();

  await service.markMessageReadResponse(
    {
      body: {
        account: 'serve@softora.nl',
        id: 'not-a-message',
      },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'Gelezen status opslaan mislukt');
});

test('mailbox service rewrites compose draft through OpenAI with reply context', async () => {
  const calls = [];
  const service = createMailboxService({
    env: {
      OPENAI_ORGANIZATION_ID: 'org_softora',
      OPENAI_PROJECT_ID: 'proj_softora',
    },
    getOpenAiApiKey: () => 'openai-key',
    openAiApiBaseUrl: 'https://api.openai.test/v1',
    openAiModel: 'gpt-test',
    fetchJsonWithTimeout: async (url, options, timeout) => {
      calls.push({ url, options, timeout, payload: JSON.parse(options.body) });
      return {
        response: { ok: true, status: 200 },
        data: {
          model: 'gpt-test',
          usage: { total_tokens: 123 },
          choices: [{ message: { content: JSON.stringify({
            intent: 'acknowledgement',
            ctaAllowed: false,
            paragraphs: [{ text: 'Dankjewel voor je vraag.', evidence: ['received.intent'] }],
          }) } }],
        },
      };
    },
    extractOpenAiTextContent: (content) => String(content || ''),
  });

  const result = await service.rewriteDraft({
    accountEmail: 'serve@softora.nl',
    to: 'klant@example.nl',
    subject: 'Re: Vraag',
    body: 'hoi ik stuur dit ff',
    senderProfile: {
      toneStyle: 'Informeel & persoonlijk',
      aiInstructions: 'Eindig altijd met Groetjes, Servé.',
      body: 'Groetjes,\nServé',
    },
    context: {
      from: 'Klant',
      email: 'klant@example.nl',
      subject: 'Vraag',
      preview: 'Kan dit?',
      body: 'Kan dit voor vrijdag?',
      date: '2026-05-07',
      time: '14:00',
    },
  });

  assert.equal(result.text, 'Beste,\n\nDankjewel voor je vraag. 😁\n\nMet vriendelijke groet,\nServé Creusen');
  assert.equal(result.model, 'gpt-test');
  assert.equal(calls[0].url, 'https://api.openai.test/v1/chat/completions');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer openai-key');
  assert.equal(calls[0].options.headers['OpenAI-Organization'], 'org_softora');
  assert.equal(calls[0].options.headers['OpenAI-Project'], 'proj_softora');
  assert.equal(calls[0].timeout, 65000);
  assert.equal(calls[0].payload.model, 'gpt-test');
  assert.match(calls[0].payload.messages[0].content, /Verzin geen feiten/);
  assert.match(calls[0].payload.messages[0].content, /centraal antwoordprofiel serve-mailbox-reply-v2/);
  assert.match(calls[0].payload.messages[0].content, /Schrijf altijd namens Servé Creusen/);
  assert.match(calls[0].payload.messages[0].content, /server voegt de bewezen aanhef, exact één 😁/);
  assert.match(calls[0].payload.messages[0].content, /iedere zin moet rechtstreeks volgen/i);
  assert.match(calls[0].payload.messages[0].content, /uitsluitend geldige JSON/);
  assert.match(calls[0].payload.messages[1].content, /"ontvangenMail"/);
  assert.match(calls[0].payload.messages[1].content, /Kan dit voor vrijdag/);
  assert.match(calls[0].payload.messages[1].content, /hoi ik stuur dit ff/);
  assert.doesNotMatch(calls[0].payload.messages[1].content, /Groetjes[\s\S]*Servé/);
  assert.doesNotMatch(calls[0].payload.messages[1].content, /Informeel & persoonlijk/);
  assert.doesNotMatch(calls[0].payload.messages[1].content, /afzenderProfiel/);
  assert.match(calls[0].payload.messages[1].content, /antwoordContext/);
});

test('mailbox service schrijft zonder concept een voorgestelde reactie vanuit de ontvangen mail', async () => {
  const calls = [];
  const service = createMailboxService({
    getOpenAiApiKey: () => 'openai-key',
    openAiApiBaseUrl: 'https://api.openai.test/v1',
    openAiModel: 'gpt-test',
    fetchJsonWithTimeout: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return {
        response: { ok: true, status: 200 },
        data: {
          model: 'gpt-test',
          choices: [{ message: { content: 'Hoi Lisa,\n\nDankjewel voor je reactie! 😁\n\nMet vriendelijke groet,\nMartijn van de Ven' } }],
        },
      };
    },
    extractOpenAiTextContent: (content) => String(content || ''),
  });

  const result = await service.rewriteDraft({
    accountEmail: 'martijn@softora.nl',
    to: 'lisa@example.nl',
    subject: 'Re: Kleine vraag over jullie website',
    body: '',
    context: {
      from: 'Lisa',
      email: 'lisa@example.nl',
      subject: 'Re: Kleine vraag over jullie website',
      body: 'Hoi Martijn, stuur de online preview maar door. Wat kost zoiets?',
    },
  });

  assert.match(result.text, /^Beste Lisa,/);
  assert.match(result.text, /Martijn van de Ven$/);
  assert.doesNotMatch(result.text, /Servé Creusen/);
  assert.match(calls[0].messages[0].content, /Schrijf zelfstandig de best passende reactie/);
  assert.match(calls[0].messages[0].content, /Schrijf altijd namens Martijn van de Ven/);
  assert.match(calls[0].messages[0].content, /serve-mailbox-reply-v2/);
  assert.match(calls[0].messages[0].content, /prijsvraag blijft de enige vaste waarheid/i);
  assert.match(calls[0].messages[1].content, /stuur de online preview maar door/);
  assert.match(calls[0].messages[1].content, /"conceptAntwoord":""/);
  assert.match(calls[0].messages[1].content, /"aanhefNaam":"Lisa"/);
  assert.match(calls[0].messages[1].content, /"intent":"price_question"/);
  assert.match(calls[0].messages[1].content, /"ctaAllowed":true/);
  assert.doesNotMatch(calls[0].messages[1].content, /afzenderProfiel/);
});

test('mailbox service laat replycontext Martijn bepalen en corrigeert een verkeerde AI-signatuur', async () => {
  const calls = [];
  const service = createMailboxService({
    getOpenAiApiKey: () => 'openai-key',
    openAiApiBaseUrl: 'https://api.openai.test/v1',
    openAiModel: 'gpt-test',
    fetchJsonWithTimeout: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return {
        response: { ok: true, status: 200 },
        data: {
          choices: [{ message: { content: 'Hoi,\n\nDankjewel voor je reactie 😁\n\nMet vriendelijke groet,\nServé Creusen' } }],
        },
      };
    },
    extractOpenAiTextContent: (content) => String(content || ''),
  });

  const result = await service.rewriteDraft({
    accountEmail: 'serve@softora.nl',
    to: 'klant@example.nl',
    subject: 'Re: Vraag',
    body: '',
    context: {
      accountEmail: 'martijn@softora.nl',
      from: 'Klant',
      email: 'klant@example.nl',
      subject: 'Vraag',
      body: 'Bedankt voor je mail.',
    },
  });

  assert.match(calls[0].messages[0].content, /Schrijf altijd namens Martijn van de Ven/);
  assert.match(calls[0].messages[1].content, /"accountEmail":"martijn@softora.nl"/);
  assert.match(calls[0].messages[1].content, /"naam":"Martijn van de Ven"/);
  assert.equal(result.text, 'Beste,\n\nDankjewel voor je reactie 😁\n\nMet vriendelijke groet,\nMartijn van de Ven');
});

test('mailbox service geeft Salon TOF zowel inbound als oorspronkelijke coldmail en corrigeert Webflow-feiten', async () => {
  const calls = [];
  const service = createMailboxService({
    getOpenAiApiKey: () => 'openai-key',
    openAiApiBaseUrl: 'https://api.openai.test/v1',
    openAiModel: 'gpt-test',
    fetchJsonWithTimeout: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return {
        response: { ok: true, status: 200 },
        data: {
          choices: [{
            message: {
              content: 'Beste,\n\nGoede vraag. Dit ontwerp heb ik helemaal op maat met code gebouwd. Dan kunnen we samen kort kijken wat er mogelijk is.\n\nAls je wilt, denk ik graag even met je mee over wat voor jou handig is. Als je wilt, is het een idee dat ik volgende week [dag] even langskom? 😁',
            },
          }],
        },
      };
    },
    extractOpenAiTextContent: (content) => String(content || ''),
  });

  const result = await service.rewriteDraft({
    accountEmail: 'serve@softora.nl',
    to: 'info@salontof.nl',
    subject: 'Re: Kleine vraag over je website',
    body: '',
    context: {
      from: 'Salon TOF',
      email: 'info@salontof.nl',
      subject: 'Re: Kleine vraag over je website',
      body: 'Met welk programma werk je? Wij hebben nu Webflow.',
      originalSentMail: {
        folder: 'sent',
        from: 'Servé Creusen',
        to: 'info@salontof.nl',
        subject: 'Kleine vraag over je website',
        body: 'Ik heb een fris webdesign gemaakt en hoor graag wat je ervan vindt.',
      },
    },
  });

  const promptPayload = JSON.parse(calls[0].messages[1].content);
  assert.equal(promptPayload.ontvangenMail.body, 'Met welk programma werk je? Wij hebben nu Webflow.');
  assert.equal(
    promptPayload.oorspronkelijkeVerzondenMail.body,
    'Ik heb een fris webdesign gemaakt en hoor graag wat je ervan vindt.'
  );
  assert.equal(promptPayload.antwoordContext.aanhefNaam, '');
  assert.match(result.text, /^Beste,/);
  assert.match(result.text, /Het ontwerp dat ik stuurde heb ik volledig op maat met code gebouwd\./);
  assert.match(result.text, /indeling, uitstraling en werking precies afstemmen/);
  assert.match(result.text, /zonder vast te zitten aan een standaard websitebouwer/);
  assert.doesNotMatch(result.text, /Hoi Salon|Leuke vraag|dus niet in Webflow|Webflow kan ik|Wij hebben nu|\bWebflow\b|\bjullie\b|laagdrempelig|\bkansen\b|denk ik graag even met je mee|Als je wilt/i);
  assert.equal((result.text.match(/Als je wilt/g) || []).length, 0);
  assert.equal((result.text.match(/\bWebflow\b/gi) || []).length, 0);
  assert.doesNotMatch(result.text, /\[dag\]|langskom|volgende week|afspraak/i);
  assert.doesNotMatch(result.text, /\b(?:maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\b/i);
  assert.equal((result.text.match(/😁/gu) || []).length, 1);
  assert.equal(result.text.endsWith('Met vriendelijke groet,\nServé Creusen'), true);
});

test('mailbox service bewaart coldmailprofiel alleen bij een los concept zonder replycontext', async () => {
  const calls = [];
  const service = createMailboxService({
    getOpenAiApiKey: () => 'openai-key',
    openAiApiBaseUrl: 'https://api.openai.test/v1',
    openAiModel: 'gpt-test',
    fetchJsonWithTimeout: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return {
        response: { ok: true, status: 200 },
        data: { choices: [{ message: { content: 'Hoi,\n\nNettere tekst.' } }] },
      };
    },
    extractOpenAiTextContent: (content) => String(content || ''),
  });

  await service.rewriteDraft({
    accountEmail: 'serve@softora.nl',
    to: 'klant@example.nl',
    subject: 'Los bericht',
    body: 'maak dit ff beter',
    senderProfile: {
      toneStyle: 'Informeel & persoonlijk',
      aiInstructions: 'Houd het kort.',
      body: 'Met vriendelijke groet,\nServé',
    },
  });

  assert.match(calls[0].messages[0].content, /mailherschrijver van Softora/);
  assert.doesNotMatch(calls[0].messages[0].content, /Malik Mailing/);
  assert.match(calls[0].messages[1].content, /afzenderProfiel/);
  assert.match(calls[0].messages[1].content, /Houd het kort/);
});

test('mailbox service refuses rewrite without OpenAI key', async () => {
  const service = createMailboxService({
    logger: { error() {} },
    getOpenAiApiKey: () => '',
  });
  const res = createResponseRecorder();

  await service.rewriteDraftResponse(
    {
      body: {
        body: 'hoi',
      },
    },
    res
  );

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'Mailtekst verbeteren mislukt');
  assert.equal(res.body.detail, 'OpenAI API-key ontbreekt.');
});

test('mailbox list response valt bij een lege index begrensd terug op de originele IMAP-mailbox', async () => {
  let imapCalls = 0;
  const client = createFakeImapClient({
    boxes: [{ path: 'INBOX' }],
    messagesByMailbox: {
      INBOX: [{
        uid: 42,
        flags: [],
        internalDate: new Date('2026-08-10T10:00:00.000Z'),
        source: {
          date: new Date('2026-08-10T10:00:00.000Z'),
          text: 'Direct uit de originele mailbox.',
          subject: 'Nieuwe originele mail',
          from: { value: [{ name: 'Klant', address: 'klant@example.test' }] },
          to: { value: [{ name: 'Servé', address: 'serve@softora.nl' }] },
        },
      }],
    },
  });
  const service = createMailboxService({
    logger: { error() {} },
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        imapHost: 'imap.example.test',
        imapUser: 'serve@softora.nl',
        imapPass: 'secret',
      },
    ]),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      getSyncState: async () => null,
      isSyncStateStale: () => true,
    },
    createImapClient: () => {
      imapCalls += 1;
      return client;
    },
    parseMailSource: async (source) => source,
  });
  const res = createResponseRecorder();

  await service.listMessagesResponse(
    { query: { account: 'serve@softora.nl', folder: 'inbox', limit: '50' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.messages.map((message) => message.subject), ['Nieuwe originele mail']);
  assert.equal(res.body.sync.source, 'imap-live');
  assert.equal(res.body.sync.warming, false);
  assert.equal(res.body.sync.refreshRecommended, false);
  assert.equal(res.body.sync.indexAvailable, true);
  assert.equal(typeof res.body.sync.durationMs, 'number');
  assert.match(String(res.headers['server-timing'] || ''), /^mailbox;dur=/);
  assert.equal(imapCalls, 1);
});

test('mailbox list response gebruikt IMAP ook wanneer de indexread zelf faalt', async () => {
  const client = createFakeImapClient({
    boxes: [{ path: 'INBOX' }],
    messagesByMailbox: {
      INBOX: [{
        uid: 77,
        flags: [],
        internalDate: new Date('2026-08-10T10:30:00.000Z'),
        source: {
          date: new Date('2026-08-10T10:30:00.000Z'),
          text: 'Index is stuk, bron is goed.',
          subject: 'Bron blijft zichtbaar',
          from: { value: [{ address: 'bron@example.test' }] },
          to: { value: [{ address: 'serve@softora.nl' }] },
        },
      }],
    },
  });
  const service = createMailboxService({
    logger: { warn() {}, error() {} },
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl',
      imapHost: 'imap.example.test',
      imapUser: 'serve@softora.nl',
      imapPass: 'secret',
    }]),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => { throw new Error('Supabase index timeout'); },
    },
    createImapClient: () => client,
    parseMailSource: async (source) => source,
  });
  const res = createResponseRecorder();

  await service.listMessagesResponse(
    { query: { account: 'serve@softora.nl', folder: 'inbox', limit: '50' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.messages.map((message) => message.subject), ['Bron blijft zichtbaar']);
  assert.equal(res.body.sync.source, 'imap-live');
  assert.equal(res.body.sync.indexAvailable, false);
});

test('mailbox list response kan indexuitval nooit als autoritatief lege HTTP 200 teruggeven', async () => {
  const service = createMailboxService({
    logger: { warn() {}, error() {} },
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl',
      imapHost: 'imap.example.test',
      imapUser: 'serve@softora.nl',
      imapPass: 'secret',
    }]),
    mailboxIndexStore: {
      isAvailable: () => false,
      listMessages: async () => [],
    },
    createImapClient: () => ({
      usable: true,
      async connect() { throw new Error('IMAP tijdelijk onbereikbaar'); },
      async close() {},
    }),
  });
  const res = createResponseRecorder();

  await service.listMessagesResponse(
    { query: { account: 'serve@softora.nl', folder: 'inbox', limit: '50' } },
    res
  );

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'MAILBOX_LIVE_FALLBACK_FAILED');
  assert.notDeepEqual(res.body.messages, []);
});

test('mailbox live fallback breekt een hangende IMAP-read hard af op de lijstdeadline', async () => {
  let rejectConnect;
  let closeCalls = 0;
  const client = {
    usable: true,
    connect() {
      return new Promise((_resolve, reject) => { rejectConnect = reject; });
    },
    close() {
      closeCalls += 1;
      this.usable = false;
      rejectConnect?.(new Error('IMAP client gesloten'));
    },
  };
  const service = createMailboxService({
    logger: { warn() {}, error() {} },
    mailboxListLiveTimeoutMs: 20,
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl',
      imapHost: 'imap.example.test',
      imapUser: 'serve@softora.nl',
      imapPass: 'secret',
    }]),
    mailboxIndexStore: {
      isAvailable: () => false,
      listMessages: async () => [],
    },
    createImapClient: () => client,
  });
  const res = createResponseRecorder();

  await service.listMessagesResponse(
    { query: { account: 'serve@softora.nl', folder: 'inbox', limit: '50' } },
    res
  );

  assert.equal(res.statusCode, 504);
  assert.equal(res.body.code, 'MAILBOX_LIST_LIVE_TIMEOUT');
  assert.equal(closeCalls, 1);
});

test('mailbox list response marks an error-status index stale without blocking on live IMAP', async () => {
  let imapCalls = 0;
  const service = createMailboxService({
    logger: { error() {} },
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        imapHost: 'imap.example.test',
        imapUser: 'serve@softora.nl',
        imapPass: 'secret',
      },
    ]),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [
        {
          id: 'inbox:42',
          uid: 42,
          folder: 'inbox',
          from: 'Serve',
          email: 'serve@softora.nl',
          to: 'klant@example.nl',
          subject: 'Cached mail',
          preview: 'Direct zichtbaar',
          body: '',
          date: '2026-05-20T12:00:00.000Z',
          unread: true,
          indexed: true,
        },
      ],
      getSyncState: async () => ({
        last_synced_at: '2026-05-20T11:00:00.000Z',
        status: 'error',
      }),
      isSyncStateStale: () => false,
    },
    createImapClient: () => {
      imapCalls += 1;
      throw new Error('IMAP mag cached mailboxlijst niet blokkeren');
    },
  });
  const res = createResponseRecorder();

  await service.listMessagesResponse(
    { query: { account: 'serve@softora.nl', folder: 'inbox', limit: '50' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.messages.length, 1);
  assert.equal(res.body.messages[0].subject, 'Cached mail');
  assert.equal(res.body.sync.source, 'index');
  assert.equal(res.body.sync.status, 'error');
  assert.equal(res.body.sync.stale, true);
  assert.equal(res.body.sync.refreshRecommended, true);
  assert.equal(res.body.sync.warming, false);
  assert.equal(res.body.sync.indexAvailable, true);
  assert.equal(imapCalls, 0);
});

test('mailbox campaign replies response joins indexed inbox mail to targeted webdesign customers', async () => {
  let customerLookup = null;
  let hydratedReplyIds = [];
  let snapshotWrite = null;
  const service = createMailboxService({
    logger: { error() {} },
    mailboxCampaignConsistencyStore: {
      isAvailable: () => true,
      getFence: async () => ({ contentVersion: '12', pendingCount: 0, ready: true }),
    },
    getUiStateValues: async () => ({
      values: {},
      source: 'supabase',
      revision: 0,
    }),
    compareAndSwapUiStateValues: async (scope, values, meta) => {
      snapshotWrite = { scope, values, meta };
      return { ok: true, revision: 1 };
    },
    mailboxIndexStore: {
      listMessagesForAccounts: async () => [
        {
          id: 'inbox:42',
          accountEmail: 'serve@softora.nl',
          folder: 'inbox',
          email: 'info@studionoord.nl',
          from: 'Studio Noord',
          subject: 'Re: Nieuw webdesign',
          preview: 'Kunnen we morgen bellen?',
          date: '2026-07-20T10:15:00.000Z',
          unread: true,
          indexed: true,
        },
        {
          id: 'inbox:77',
          accountEmail: 'martijn@softora.nl',
          folder: 'inbox',
          email: 'contact@dekroon.nl',
          from: 'Bakkerij De Kroon',
          subject: 'Re: Nieuw webdesign',
          preview: 'Geen interesse.',
          date: '2026-07-19T15:45:00.000Z',
          unread: false,
          indexed: true,
        },
        {
          id: 'inbox:80',
          accountEmail: 'serve@softora.nl',
          folder: 'inbox',
          email: 'lead@example.nl',
          date: '2026-07-18T10:00:00.000Z',
        },
        {
          id: 'inbox:90',
          accountEmail: 'serve@softora.nl',
          folder: 'inbox',
          email: 'klant@example.nl',
          date: '2026-07-17T10:00:00.000Z',
        },
        {
          id: 'inbox:91',
          accountEmail: 'servecreusen7@gmail.com',
          folder: 'inbox',
          email: 'persoonlijk.antwoord@example.nl',
          from: 'Marie-José',
          subject: 'Re: Kleine vraag over jullie website',
          preview: 'Bedankt voor je ontwerp.',
          date: '2026-07-21T10:00:00.000Z',
        },
        {
          id: 'inbox:92',
          accountEmail: 'servecreusen7@gmail.com',
          folder: 'inbox',
          email: 'postmaster@example.nl',
          from: 'Postmaster',
          subject: 'Undeliverable: Kleine vraag over jullie website',
          preview: 'Delivery failed.',
          date: '2026-07-22T10:00:00.000Z',
        },
        {
          id: 'inbox:93',
          accountEmail: 'serve290@gmail.com',
          folder: 'inbox',
          email: 'info@bijkatrien.com',
          from: 'Bij Katrien',
          subject: 'Uw mail is ontvangen | Bij Katrien Re: Kleine vraag over jullie website',
          preview: 'Hartelijk dank voor uw mail. Op dit moment ben ik op vakantie tot 20 augustus.',
          date: '2026-07-22T08:13:00.000Z',
        },
      ].reverse(),
      hydrateMessageBodies: async ({ messages }) => {
        hydratedReplyIds = messages.map((message) => message.id);
        return messages.map((message) => ({
          ...message,
          body: `Volledige inhoud voor ${message.id}`,
          hasBody: true,
        }));
      },
    },
    dataOpsStore: {
      listCustomersByEmails: async (options) => {
        customerLookup = options;
        return [
          {
            id: 'softora-pending',
            bedrijf: 'Studio Noord',
            email: 'info@studionoord.nl',
            campaignType: 'webdesign',
            lastColdmailProvider: 'softora',
            outreachStatus: 'reactie_ontvangen',
          },
          {
            id: 'softora-handled',
            bedrijf: 'Bakkerij De Kroon',
            email: 'contact@dekroon.nl',
            campaignType: 'website_design',
            lastColdmailProvider: 'softora',
            outreachStatus: 'geen_interesse',
          },
          {
            id: 'instantly-reply',
            bedrijf: 'Instantly Lead',
            email: 'lead@example.nl',
            campaignType: 'webdesign',
            lastColdmailProvider: 'instantly',
          },
          {
            id: 'normal-mail',
            bedrijf: 'Bestaande klant',
            email: 'klant@example.nl',
          },
        ];
      },
    },
  });
  const res = createResponseRecorder();

  await service.campaignRepliesResponse({ query: { limit: '100' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.messages.length, 3);
  assert.equal(res.body.messages[0].id, 'inbox:91');
  assert.equal(res.body.messages[0].campaign.company, 'Marie-José');
  assert.equal(res.body.messages[0].campaign.customerId, '');
  assert.equal(res.body.messages[0].campaign.actionRequired, true);
  assert.equal(res.body.messages[0].outreach, null);
  assert.equal(res.body.messages[1].id, 'inbox:42');
  assert.equal(res.body.messages[1].accountEmail, 'serve@softora.nl');
  assert.equal(res.body.messages[1].campaign.company, 'Studio Noord');
  assert.equal(res.body.messages[1].campaign.actionRequired, true);
  assert.equal(res.body.messages[1].outreach.customerId, 'softora-pending');
  assert.equal(res.body.messages[1].body, 'Volledige inhoud voor inbox:42');
  assert.equal(res.body.messages[2].campaign.actionRequired, false);
  assert.equal(res.body.messages[2].outreach, null);
  assert.equal(res.body.sync.source, 'campaign-replies-index');
  assert.deepEqual(customerLookup.emails.sort(), [
    'contact@dekroon.nl',
    'info@studionoord.nl',
    'klant@example.nl',
    'lead@example.nl',
    'persoonlijk.antwoord@example.nl',
  ]);
  assert.equal(customerLookup.bypassReadFailureCooldown, true);
  assert.deepEqual(hydratedReplyIds, ['inbox:91', 'inbox:42', 'inbox:77']);
  assert.equal(snapshotWrite.scope, MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE);
  assert.equal(snapshotWrite.meta.source, 'mailbox-campaign-replies');
  const persistedSnapshot = JSON.parse(
    snapshotWrite.values[MAILBOX_CAMPAIGN_SNAPSHOT_KEY]
  );
  assert.equal(persistedSnapshot.messages[0].from, 'Marie-José');
  assert.equal(persistedSnapshot.messages[1].from, 'Studio Noord');
  assert.equal(persistedSnapshot.messages[1].body, '');
  assert.equal(persistedSnapshot.messages[1].hasBody, false);
});

test('mailbox routes expose accounts, messages, send, local hide restore and rewrite endpoints', () => {
  const routes = [];
  const app = {
    get(path, ...handlers) {
      routes.push(['GET', path, handlers]);
    },
    post(path, ...handlers) {
      routes.push(['POST', path, handlers]);
    },
  };

  registerMailboxRoutes(app, {
    coordinator: {
      accountsResponse() {},
      campaignRepliesResponse() {},
      listMessagesResponse() {},
      getMessageResponse() {},
      getMessageBodiesResponse() {},
      getMessageImageResponse() {},
      markMessageReadResponse() {},
      hideConversationResponse() {},
      restoreConversationResponse() {},
      sendMessageResponse() {},
      rewriteDraftResponse() {},
    },
  });

  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/accounts'));
  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/campaign-replies'));
  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/messages'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/messages/bodies'));
  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/message-image'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/messages/read'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/messages/hide'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/messages/restore'));
  assert.ok(!routes.some(([, path]) => path === '/api/mailbox/messages/delete'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/send'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/rewrite'));
});

test('mailbox image response serves exact-message MIME media with durable private browser cache', async () => {
  const client = createFakeImapClient({
    boxes: [{ path: 'INBOX' }],
    messagesByMailbox: {
      INBOX: [{
        uid: 42,
        flags: ['\\Seen'],
        internalDate: new Date('2026-07-24T10:00:00.000Z'),
        source: {
          date: new Date('2026-07-24T10:00:00.000Z'),
          text: 'Bericht met afbeelding',
          html: '<p>Bericht met afbeelding</p><img src="cid:exact-image@example.test" alt="Ontwerp">',
          subject: 'Losse afbeelding',
          from: { value: [{ name: 'Klant', address: 'klant@example.test' }] },
          to: { value: [{ name: 'Servé', address: 'serve@softora.nl' }] },
          attachments: [{
            cid: 'exact-image@example.test',
            contentType: 'image/png',
            content: Buffer.from('mailbox-image'),
          }],
        },
      }],
    },
  });
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl',
      imapHost: 'imap.example.test',
      imapUser: 'serve@softora.nl',
      imapPass: 'secret',
    }]),
    createImapClient: () => client,
    parseMailSource: async (source) => source,
  });
  const response = createResponseRecorder();

  await service.getMessageImageResponse({
    query: {
      account: 'serve@softora.nl', folder: 'inbox', id: 'inbox:42', uidValidity: '777', index: '0',
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'image/png');
  assert.equal(response.headers['cache-control'], 'private, max-age=31536000, immutable');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(Buffer.isBuffer(response.body), true);
  assert.equal(response.body.toString(), 'mailbox-image');
});

test('signed-token mailbox detail and image fallback never upsert the mailbox index', async () => {
  const client = createFakeImapClient({
    boxes: [{ path: 'INBOX' }],
    messagesByMailbox: {
      INBOX: [{
        uid: 42,
        flags: ['\\Seen'],
        internalDate: new Date('2026-08-09T20:00:00.000Z'),
        source: {
          date: new Date('2026-08-09T20:00:00.000Z'),
          text: 'Alleen lezen.',
          html: '<p>Alleen lezen.</p><img src="cid:readonly-image@example.test">',
          subject: 'Re: Kleine vraag',
          from: { value: [{ name: 'Klant', address: 'klant@example.test' }] },
          to: { value: [{ name: 'Servé', address: 'serve@softora.nl' }] },
          attachments: [{
            cid: 'readonly-image@example.test',
            contentType: 'image/png',
            content: Buffer.from('readonly-image'),
          }],
        },
      }],
    },
  });
  let upserts = 0;
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl',
      imapHost: 'imap.example.test',
      imapUser: 'serve@softora.nl',
      imapPass: 'secret',
    }]),
    createImapClient: () => client,
    parseMailSource: async (source) => source,
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      getMessage: async () => null,
      upsertMessages: async () => {
        upserts += 1;
        return { ok: true, upserted: 1 };
      },
    },
  });
  const fallbackDetailResponse = createResponseRecorder();

  await service.getMessageResponse({
    query: { account: 'serve@softora.nl', folder: 'inbox', id: 'inbox:42', uidValidity: '777' },
    premiumReadOnlyTokenFallback: true,
  }, fallbackDetailResponse);

  assert.equal(fallbackDetailResponse.statusCode, 200);
  assert.equal(upserts, 0);

  const fallbackImageResponse = createResponseRecorder();
  await service.getMessageImageResponse({
    query: {
      account: 'serve@softora.nl', folder: 'inbox', id: 'inbox:42', uidValidity: '777', index: '0',
    },
    premiumReadOnlyTokenFallback: true,
  }, fallbackImageResponse);

  assert.equal(fallbackImageResponse.statusCode, 200);
  assert.equal(fallbackImageResponse.body.toString(), 'readonly-image');
  assert.equal(upserts, 0);

  const normalDetailResponse = createResponseRecorder();
  await service.getMessageResponse({
    query: { account: 'serve@softora.nl', folder: 'inbox', id: 'inbox:42', uidValidity: '777' },
  }, normalDetailResponse);

  assert.equal(normalDetailResponse.statusCode, 200);
  assert.equal(upserts, 0);
});

test('mailbox cron sync route requires CRON_SECRET bearer access', () => {
  let cronCalled = 0;
  const routes = [];
  const app = {
    get(path, ...handlers) {
      routes.push(['GET', path, handlers]);
    },
    post(path, ...handlers) {
      routes.push(['POST', path, handlers]);
    },
  };

  registerMailboxRoutes(app, {
    cronSecret: 'cron-secret',
    coordinator: {
      accountsResponse() {},
      listMessagesResponse() {},
      getMessageResponse() {},
      syncMailboxResponse(_req, res) {
        cronCalled += 1;
        res.status(200).json({ ok: true });
      },
      sendMessageResponse() {},
    },
  });

  const route = routes.find(([method, path]) => method === 'GET' && path === '/api/mailbox/sync');
  const blocked = createResponseRecorder();
  route[2][0]({ headers: { authorization: 'Bearer wrong' } }, blocked, () => {});
  assert.equal(blocked.statusCode, 401);
  assert.equal(cronCalled, 0);

  const allowed = createResponseRecorder();
  route[2][0]({ headers: { authorization: 'Bearer cron-secret' } }, allowed, () => {
    route[2][1]({}, allowed);
  });
  assert.equal(allowed.statusCode, 200);
  assert.equal(cronCalled, 1);
});

test('mailbox cron sync skips safely during Supabase outage pause', () => {
  let cronCalled = 0;
  const routes = [];
  const app = {
    get(path, ...handlers) {
      routes.push(['GET', path, handlers]);
    },
    post(path, ...handlers) {
      routes.push(['POST', path, handlers]);
    },
  };

  registerMailboxRoutes(app, {
    cronSecret: 'cron-secret',
    supabaseOutageCronPause: 'true',
    coordinator: {
      accountsResponse() {},
      listMessagesResponse() {},
      getMessageResponse() {},
      syncMailboxResponse(_req, res) {
        cronCalled += 1;
        res.status(200).json({ ok: true });
      },
      sendMessageResponse() {},
    },
  });

  const route = routes.find(([method, path]) => method === 'GET' && path === '/api/mailbox/sync');
  const paused = createResponseRecorder();
  route[2][0]({ headers: { authorization: 'Bearer cron-secret' } }, paused, () => {
    route[2][1]({}, paused);
  });

  assert.equal(paused.statusCode, 200);
  assert.equal(paused.body.ok, true);
  assert.equal(paused.body.skipped, true);
  assert.equal(paused.body.code, 'SUPABASE_OUTAGE_CRON_PAUSED');
  assert.equal(cronCalled, 0);
});

test('mailbox service meldt een lege IMAP-targetset degraded en nooit compleet', async () => {
  const service = createMailboxService({ mailConfig: {} });

  assert.equal(typeof service.syncMailboxResponse, 'function');
  assert.equal(typeof service.syncInstantlyMailboxResponse, 'function');

  const response = createResponseRecorder();
  await service.syncMailboxResponse({ query: {}, body: {} }, response);

  assert.equal(response.statusCode, 207);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.complete, false);
  assert.equal(response.body.freshnessConfirmed, false);
  assert.equal(response.body.degraded, true);
  assert.equal(response.body.reason, 'no_sync_targets');
  assert.equal(response.body.statusCode, 207);
  assert.deepEqual(response.body.results, []);
});

test('mailbox sync abort closes the active IMAP client before any index write', async () => {
  let rejectConnect;
  let closeCalls = 0;
  let upsertCalls = 0;
  let clientConfig = null;
  const client = {
    usable: true,
    connect() {
      return new Promise((_resolve, reject) => {
        rejectConnect = reject;
      });
    },
    close() {
      closeCalls += 1;
      this.usable = false;
      rejectConnect?.(new Error('IMAP client gesloten'));
    },
  };
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl',
      imapHost: 'imap.example.test',
      imapUser: 'serve@softora.nl',
      imapPass: 'secret',
    }]),
    createImapClient: (config) => {
      clientConfig = config;
      return client;
    },
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      acquireSyncLock: async () => ({ ok: true, lockToken: 'abort-lock' }),
      upsertMessages: async () => {
        upsertCalls += 1;
        return { ok: true, upserted: 1 };
      },
      finishSync: async () => ({ ok: true }),
    },
  });
  const controller = new AbortController();
  const deadlineAt = Date.now() + 10_000;
  const pending = service.syncMailboxFolder({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    runSignal: controller.signal,
    runDeadlineAt: deadlineAt,
    folderTimeoutMs: 10_000,
  });
  await new Promise((resolve) => setImmediate(resolve));
  const timeout = Object.assign(new Error('run timeout'), {
    code: 'MAILBOX_SYNC_RUN_TIMEOUT',
    timedOut: true,
  });
  controller.abort(timeout);

  await assert.rejects(pending, (error) => error === timeout);
  assert.equal(closeCalls, 1);
  assert.equal(upsertCalls, 0);
  assert.ok(clientConfig.connectionTimeout <= 8_000);
  assert.ok(clientConfig.greetingTimeout <= 8_000);
  assert.ok(clientConfig.socketTimeout <= 10_000);
});

test('campaign mailbox sync skips configured accounts outside the campaign', async () => {
  const requestedAccounts = [];
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Servé',
        imapHost: 'imap.example.test',
        imapUser: 'serve@softora.nl',
        imapPass: 'secret',
      },
      {
        email: 'zakelijk@theimpactbox.co',
        name: 'Impactbox',
        imapHost: 'imap.example.test',
        imapUser: 'zakelijk@theimpactbox.co',
        imapPass: 'secret',
      },
    ]),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      acquireSyncLock: async ({ accountEmail }) => {
        requestedAccounts.push(accountEmail);
        return {
          ok: false,
          locked: true,
          lockExpiresAt: new Date(Date.now() + 30_000).toISOString(),
        };
      },
    },
  });
  const response = createResponseRecorder();

  await service.syncMailboxResponse(
    {
      method: 'POST',
      query: {},
      body: { folder: 'inbox,sent', campaignOnly: true },
    },
    response
  );

  assert.equal(response.statusCode, 202);
  assert.deepEqual(requestedAccounts, ['serve@softora.nl', 'serve@softora.nl']);
});

test('campaign mailbox sync adds the exact Gmail coldmail label only for Gmail campaign accounts', () => {
  const normalizeFolder = (value) => String(value || '').trim().toLowerCase();

  assert.deepEqual(
    getMailboxSyncFoldersForAccount({
      account: { email: 'servec321@gmail.com', imapHost: 'imap.gmail.com' },
      folders: ['inbox', 'sent'],
      campaignOnly: true,
      normalizeFolder,
    }),
    ['inbox', 'sent', CAMPAIGN_GMAIL_LABEL_FOLDER]
  );
  assert.deepEqual(
    getMailboxSyncFoldersForAccount({
      account: { email: 'serve@softora.nl', imapHost: 'imap.strato.com' },
      folders: ['inbox', 'sent', CAMPAIGN_GMAIL_LABEL_FOLDER],
      campaignOnly: true,
      normalizeFolder,
    }),
    ['inbox', 'sent']
  );
});

test('mailbox cron supplements normal folders with the Gmail campaign label', async () => {
  const requestedFolders = [];
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([{
      email: 'servec321@gmail.com',
      name: 'Servé',
      imapHost: 'imap.gmail.com',
      imapUser: 'servec321@gmail.com',
      imapPass: 'app-password',
    }]),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      acquireSyncLock: async ({ folder }) => {
        requestedFolders.push(folder);
        return {
          ok: false,
          locked: true,
          lockExpiresAt: new Date(Date.now() + 30_000).toISOString(),
        };
      },
    },
  });
  const response = createResponseRecorder();

  await service.syncMailboxResponse({
    method: 'GET',
    query: {},
    body: {},
  }, response);

  assert.equal(response.statusCode, 202);
  assert.deepEqual(requestedFolders, ['inbox', 'sent', CAMPAIGN_GMAIL_LABEL_FOLDER]);
});

test('campaign mailbox sync imports a future Skip Inbox reply from the exact Gmail label', async () => {
  const client = createFakeImapClient({
    boxes: [{ path: 'Softora / Coldmail' }],
    messagesByMailbox: {
      'Softora / Coldmail': [{
        uid: 91,
        flags: [],
        internalDate: new Date('2026-07-25T10:00:00.000Z'),
        source: Buffer.from(
          'Message-ID: <filtered-reply@example.nl>\r\n' +
          'Subject: Re: Kleine vraag over jullie website\r\n' +
          'From: Klant <klant@example.nl>\r\n' +
          'To: servec321@gmail.com\r\n\r\n' +
          'Dank voor je ontwerp.'
        ),
      }],
    },
  });
  const upserts = [];
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([{
      email: 'servec321@gmail.com',
      name: 'Servé',
      imapHost: 'imap.gmail.com',
      imapUser: 'servec321@gmail.com',
      imapPass: 'app-password',
    }]),
    createImapClient: () => client,
    setUiStateValues: async (_scope, values) => ({ values, source: 'supabase' }),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      acquireSyncLock: async () => ({ ok: true, lockToken: 'gmail-label-lock' }),
      prepareUidValidity: async () => ({ ok: true, uidValidity: 777 }),
      listMessageUidsForAccount: async () => [],
      upsertMessages: async (options) => {
        upserts.push(options);
        return { ok: true, upserted: options.messages.length };
      },
      finishSync: async () => ({ ok: true }),
    },
  });
  const response = createResponseRecorder();

  await service.syncMailboxResponse({
    method: 'POST',
    query: {},
    body: {
      account: 'servec321@gmail.com',
      folder: CAMPAIGN_GMAIL_LABEL_FOLDER,
      campaignOnly: true,
      force: true,
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(client.lockedMailboxes, ['Softora / Coldmail']);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].folder, CAMPAIGN_GMAIL_LABEL_FOLDER);
  assert.equal(upserts[0].messages[0].messageId, '<filtered-reply@example.nl>');
  assert.equal(response.body.results[0].synced, 1);
});

test('campaign mailbox sync excludes an explicitly requested non-campaign account', async () => {
  let lockCalls = 0;
  const service = createMailboxSyncService({
    mailboxIndexStore: {
      acquireSyncLock: async () => {
        lockCalls += 1;
        return { ok: false, locked: true };
      },
    },
    assertReadableAccount: (email) => ({
      email,
      imapHost: 'imap.gmail.com',
      imapConfigured: true,
    }),
    canUseMailboxIndex: () => true,
    fetchMessagesFromImap: async () => [],
    getSafeLimit: (limit) => limit,
    getAccounts: () => [],
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeFolder: (value) => String(value || '').trim().toLowerCase(),
  });

  const result = await service.syncMailbox({
    accountEmail: 'zakelijk@theimpactbox.co',
    folders: ['inbox'],
    campaignOnly: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.complete, false);
  assert.equal(result.freshnessConfirmed, false);
  assert.equal(result.degraded, true);
  assert.equal(result.reason, 'no_sync_targets');
  assert.equal(result.statusCode, 207);
  assert.deepEqual(result.results, []);
  assert.equal(lockCalls, 0);
});

test('campaign mailbox sync journaliseert IMAP-read en abortbare indexwrite in één mutation scope', async () => {
  const controller = new AbortController();
  const writes = [];
  let runnerOptions = null;
  let fetchSignal = null;
  let activeChecks = 0;
  const service = createMailboxSyncService({
    mailboxIndexStore: {
      acquireSyncLock: async () => ({ ok: true, lockToken: 'journal-lock' }),
      listMessageUidsForAccount: async () => [],
      upsertMessages: async (options) => {
        writes.push(options);
        return { ok: true, upserted: options.messages.length };
      },
      finishSync: async () => ({ ok: true }),
    },
    assertReadableAccount: (email) => ({ email, imapConfigured: true }),
    canUseMailboxIndex: () => true,
    fetchMessagesFromImap: async (options) => {
      fetchSignal = options.signal;
      return withSyncReadHealth([{ uid: 91, id: 'inbox:91' }]);
    },
    getSafeLimit: (limit) => limit,
    getAccounts: () => [],
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeFolder: (value) => String(value || '').trim().toLowerCase(),
    invalidateCampaignSnapshot: async () => ({ ok: true }),
    campaignMutationLeaseSeconds: 120,
    campaignMutationDeadlineMs: 90_000,
    campaignMutationRunner: {
      isAvailable: () => true,
      run: async (options, task) => {
        runnerOptions = options;
        return task({
          signal: controller.signal,
          mutationId: '55555555-5555-4555-8555-555555555555',
          requestKey: options.requestKey,
          assertActive: () => { activeChecks += 1; },
        });
      },
    },
  });

  const result = await service.syncMailboxFolder({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    campaignOnly: true,
    force: true,
  });

  assert.equal(result.ok, true);
  assert.equal(runnerOptions.requestKey, 'imap-sync:journal-lock:serve@softora.nl:inbox');
  assert.equal(runnerOptions.kind, 'imap-sync');
  assert.equal(runnerOptions.accountEmail, 'serve@softora.nl');
  assert.equal(runnerOptions.folder, 'inbox');
  assert.equal(runnerOptions.leaseSeconds, 120);
  assert.ok(runnerOptions.deadlineMs > 0 && runnerOptions.deadlineMs <= 25_000);
  assert.ok(runnerOptions.signal instanceof AbortSignal);
  assert.equal(fetchSignal, controller.signal);
  assert.equal(writes[0].signal, controller.signal);
  assert.equal(writes[0].mutationId, '55555555-5555-4555-8555-555555555555');
  assert.equal(writes[0].requestKey, runnerOptions.requestKey);
  assert.equal(writes[0].syncLockToken, 'journal-lock');
  assert.equal(writes[0].uidValidity, 777);
  assert.equal(activeChecks, 2);
});

test('campaign deadline sluit een hangende ImapFlow hard en laat geen orphan of late upsert achter', async () => {
  const controller = new AbortController();
  let resolveFetchStarted;
  let resolveFetchAfterClose;
  const fetchStarted = new Promise((resolve) => { resolveFetchStarted = resolve; });
  const fetchAfterClose = new Promise((resolve) => { resolveFetchAfterClose = resolve; });
  let closeCalls = 0;
  let logoutCalls = 0;
  let parseCalls = 0;
  let upserts = 0;
  const client = {
    usable: true,
    async connect() {},
    async list() { return [{ path: 'INBOX', specialUse: '\\Inbox' }]; },
    async getMailboxLock() { return { release() {} }; },
    async search() { return [91]; },
    fetch() {
      return (async function* hangingFetch() {
        resolveFetchStarted();
        await fetchAfterClose;
        if (!client.usable) return;
        yield {
          uid: 91,
          flags: [],
          internalDate: new Date('2026-08-09T20:00:00.000Z'),
          source: Buffer.from('Subject: late'),
        };
      })();
    },
    close() {
      closeCalls += 1;
      this.usable = false;
      resolveFetchAfterClose();
    },
    async logout() { logoutCalls += 1; },
  };
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl',
      imapHost: 'imap.example.test',
      imapUser: 'serve@softora.nl',
      imapPass: 'secret',
    }]),
    createImapClient: () => client,
    parseMailSource: async () => { parseCalls += 1; return {}; },
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      acquireSyncLock: async () => ({ ok: true, lockToken: 'abort-imap-lock' }),
      listMessageUidsForAccount: async () => [],
      upsertMessages: async () => { upserts += 1; return { ok: true, upserted: 1 }; },
      finishSync: async () => ({ ok: true }),
    },
    mailboxCampaignMutationRunner: {
      isAvailable: () => true,
      run: async (_options, task) => task({
        signal: controller.signal,
        assertActive() {
          if (controller.signal.aborted) throw controller.signal.reason;
        },
      }),
    },
    logger: { error() {}, warn() {} },
  });

  const running = service.syncMailboxFolder({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    campaignOnly: true,
    incrementalOnly: true,
    force: true,
  });
  await fetchStarted;
  const deadlineError = new Error('campaign deadline');
  deadlineError.code = 'MAILBOX_CAMPAIGN_MUTATION_DEADLINE';
  controller.abort(deadlineError);

  await assert.rejects(running, { code: 'MAILBOX_CAMPAIGN_MUTATION_DEADLINE' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closeCalls, 1);
  assert.equal(logoutCalls, 0);
  assert.equal(parseCalls, 0);
  assert.equal(upserts, 0);
});

test('één poison MIME quarantaint alleen die UID en laat latere gezonde replies duurzaam door', async () => {
  const rawMessages = [1, 2, 3].map((uid) => ({
    uid,
    flags: [],
    internalDate: new Date(`2026-08-09T20:0${uid}:00.000Z`),
    source: Buffer.from(`uid:${uid}`),
  }));
  const parsedUids = [];
  const upserts = [];
  const finishes = [];
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl',
      imapHost: 'imap.example.test',
      imapUser: 'serve@softora.nl',
      imapPass: 'secret',
    }]),
    createImapClient: () => createFakeImapClient({
      boxes: [{ path: 'INBOX', specialUse: '\\Inbox' }],
      messagesByMailbox: { INBOX: rawMessages },
    }),
    parseMailSource: async (source) => {
      const uid = Number(String(source).split(':')[1]);
      parsedUids.push(uid);
      if (uid === 2) throw Object.assign(new Error('corrupte MIME'), { code: 'MIME_CORRUPT' });
      return {
        messageId: `<healthy-${uid}@example.test>`,
        subject: 'Re: Kleine vraag',
        text: `Gezonde reply ${uid}`,
        from: { value: [{ address: `klant${uid}@example.test`, name: `Klant ${uid}` }] },
        to: { value: [{ address: 'serve@softora.nl', name: 'Servé' }] },
        date: new Date(`2026-08-09T20:0${uid}:00.000Z`),
        attachments: [],
      };
    },
    setUiStateValues: async () => ({ source: 'supabase' }),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      acquireSyncLock: async () => ({ ok: true, lockToken: `poison-lock-${finishes.length}` }),
      prepareUidValidity: async () => ({ ok: true, uidValidity: 777 }),
      listMessageUidsForAccount: async () => [],
      upsertMessages: async (options) => {
        upserts.push(options.messages.map((message) => message.uid));
        return { ok: true, upserted: options.messages.length };
      },
      finishSync: async (options) => { finishes.push(options); return { ok: true }; },
    },
    logger: { info() {}, warn() {}, error() {} },
  });

  const first = await service.syncMailboxFolder({
    accountEmail: 'serve@softora.nl', folder: 'inbox', campaignOnly: true,
    incrementalOnly: true, fastRefresh: true, force: true,
  });
  const second = await service.syncMailboxFolder({
    accountEmail: 'serve@softora.nl', folder: 'inbox', campaignOnly: true,
    incrementalOnly: true, fastRefresh: true, force: true,
  });

  assert.deepEqual(upserts.map((uids) => uids.slice().sort()), [[1, 2, 3], [1, 2, 3]]);
  assert.deepEqual(first.failedUids, [2]);
  assert.equal(first.failedMessageCount, 1);
  assert.equal(first.partial, true);
  assert.equal(first.complete, false);
  assert.equal(first.freshnessConfirmed, false);
  assert.equal(first.code, 'MAILBOX_SYNC_MESSAGE_PARSE_PARTIAL');
  assert.equal(second.partial, true);
  assert.equal(parsedUids.filter((uid) => uid === 2).length, 1);
  assert.match(finishes[0].error, /2:MIME_CORRUPT/);
  assert.equal(Object.prototype.hasOwnProperty.call(finishes[0], 'messageCount'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(finishes[0], 'lastUid'), false);
});

test('een tijdens fetch verdwenen geselecteerde UID blijft expliciet partial en kan geen cursor afronden', async () => {
  const client = createFakeImapClient({
    boxes: [{ path: 'INBOX', specialUse: '\\Inbox' }],
    messagesByMailbox: {
      INBOX: [{
        uid: 101,
        flags: [],
        internalDate: new Date('2026-08-09T20:01:00.000Z'),
        source: Buffer.from('uid:101'),
      }],
    },
  });
  client.search = async (query, options) => {
    client.searchQueries.push(query);
    client.searchOptions.push(options);
    return [101, 102];
  };
  const upserts = [];
  const finishes = [];
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl',
      imapHost: 'imap.example.test',
      imapUser: 'serve@softora.nl',
      imapPass: 'secret',
    }]),
    createImapClient: () => client,
    setUiStateValues: async () => ({ source: 'supabase' }),
    parseMailSource: async () => ({
      messageId: '<uid-101@example.test>',
      subject: 'Re: Kleine vraag',
      text: 'Gezonde reply 101',
      from: { value: [{ address: 'klant@example.test', name: 'Klant' }] },
      to: { value: [{ address: 'serve@softora.nl', name: 'Servé' }] },
      date: new Date('2026-08-09T20:01:00.000Z'),
      attachments: [],
    }),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      acquireSyncLock: async () => ({ ok: true, lockToken: 'expunge-lock' }),
      prepareUidValidity: async () => ({ ok: true, uidValidity: 777 }),
      listMessageUidsForAccount: async () => [],
      upsertMessages: async (options) => {
        upserts.push(options);
        return { ok: true, upserted: options.messages.length };
      },
      finishSync: async (options) => {
        finishes.push(options);
        return { ok: true };
      },
    },
    logger: { info() {}, warn() {}, error() {} },
  });

  const result = await service.syncMailboxFolder({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    campaignOnly: true,
    incrementalOnly: true,
    force: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.partial, true);
  assert.equal(result.complete, false);
  assert.equal(result.freshnessConfirmed, false);
  assert.equal(result.code, 'MAILBOX_SYNC_FETCH_INCOMPLETE');
  assert.deepEqual(result.selectedUids.slice().sort((a, b) => a - b), [101, 102]);
  assert.deepEqual(result.yieldedUids, [101]);
  assert.deepEqual(result.missingUids, [102]);
  assert.deepEqual(upserts[0].messages.map((message) => message.uid), [101]);
  assert.match(finishes[0].error, /102/);
  assert.equal(Object.prototype.hasOwnProperty.call(finishes[0], 'messageCount'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(finishes[0], 'lastUid'), false);
});

test('een oversized MIME blijft zichtbaar als metadata-placeholder en een latere gezonde refetch vervangt hem', async () => {
  const indexed = new Map();
  const finishes = [];
  const upsertBatches = [];
  let selectionNowMs = Date.now();
  let lockSequence = 0;
  const persistentSelectionStore = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => createPersistentMailboxUidSelectionClient(indexed),
    now: () => new Date(selectionNowMs),
    mailboxIndexFailureCooldownMs: 0,
    logger: { info() {}, warn() {}, error() {} },
  });
  const mailboxIndexStore = {
    isAvailable: () => true,
    listMessages: async () => Array.from(indexed.values()),
    acquireSyncLock: async () => ({ ok: true, lockToken: `quarantine-lock-${++lockSequence}` }),
    prepareUidValidity: async () => ({ ok: true, uidValidity: 777 }),
    listMessageUidSyncStateForAccount: persistentSelectionStore.listMessageUidSyncStateForAccount,
    upsertMessages: async ({ messages }) => {
      upsertBatches.push(messages.map((message) => ({ ...message })));
      messages.forEach((message) => indexed.set(message.uid, { ...message }));
      return { ok: true, upserted: messages.length };
    },
    finishSync: async (options) => {
      finishes.push(options);
      return { ok: true };
    },
  };
  const accountConfig = JSON.stringify([{
    email: 'serve@softora.nl',
    imapHost: 'imap.example.test',
    imapUser: 'serve@softora.nl',
    imapPass: 'secret',
  }]);
  const metadata = {
    subject: 'Belangrijke aanvraag',
    from: [{ name: 'Klant', address: 'klant@example.test' }],
    to: [{ name: 'Servé', address: 'serve@softora.nl' }],
    date: new Date('2026-08-09T20:42:00.000Z'),
    messageId: '<oversized-42@example.test>',
  };
  const oversizedClient = createFakeImapClient({
    boxes: [{ path: 'INBOX', specialUse: '\\Inbox' }],
    messagesByMailbox: {
      INBOX: [
        {
          uid: 42,
          flags: [],
          internalDate: metadata.date,
          envelope: metadata,
          source: Buffer.alloc(15 * 1024 * 1024 + 1),
        },
        {
          uid: 43,
          flags: [],
          internalDate: new Date('2026-08-09T20:43:00.000Z'),
          source: Buffer.from('uid:43'),
        },
      ],
    },
  });
  const parseMailSource = async (source) => {
    const uid = Number(String(source).split(':')[1]);
    return {
      messageId: `<healthy-${uid}@example.test>`,
      subject: uid === 42 ? 'Belangrijke aanvraag hersteld' : 'Gezonde buurmail',
      text: `Gezonde inhoud ${uid}`,
      from: { value: [{ address: 'klant@example.test', name: 'Klant' }] },
      to: { value: [{ address: 'serve@softora.nl', name: 'Servé' }] },
      date: new Date(`2026-08-09T20:${uid}:00.000Z`),
      attachments: [],
    };
  };
  const firstService = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: accountConfig,
    createImapClient: () => oversizedClient,
    setUiStateValues: async () => ({ source: 'supabase' }),
    parseMailSource,
    mailboxIndexStore,
    logger: { info() {}, warn() {}, error() {} },
  });

  const first = await firstService.syncMailboxFolder({
    accountEmail: 'serve@softora.nl', folder: 'inbox', campaignOnly: true,
    incrementalOnly: true, force: true,
  });
  const placeholder = indexed.get(42);
  assert.equal(first.partial, true);
  assert.equal(first.code, 'MAILBOX_SYNC_MESSAGE_PARSE_PARTIAL');
  assert.equal(placeholder.parseStatus, 'quarantined');
  assert.equal(placeholder.parseErrorCode, 'MAILBOX_MESSAGE_SOURCE_TOO_LARGE');
  assert.equal(placeholder.subject, 'Belangrijke aanvraag');
  assert.equal(placeholder.from, 'Klant <klant@example.test>');
  assert.equal(placeholder.email, 'klant@example.test');
  assert.equal(placeholder.date, '2026-08-09T20:42:00.000Z');
  assert.equal(placeholder.providerMetadataEvidenceKnown, true);
  assert.equal(placeholder.bodyUnavailable, true);
  assert.ok(Date.parse(placeholder.parseRetryAt) > selectionNowMs);
  assert.equal(indexed.get(43).body, 'Gezonde inhoud 43');

  const recoveredClient = createFakeImapClient({
    boxes: [{ path: 'INBOX', specialUse: '\\Inbox' }],
    messagesByMailbox: {
      INBOX: [{
        uid: 42,
        flags: [],
        internalDate: metadata.date,
        envelope: metadata,
        source: Buffer.from('uid:42'),
      }],
    },
  });
  const recoveredService = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: accountConfig,
    createImapClient: () => recoveredClient,
    setUiStateValues: async () => ({ source: 'supabase' }),
    parseMailSource,
    mailboxIndexStore,
    logger: { info() {}, warn() {}, error() {} },
  });
  const deferred = await recoveredService.syncMailboxFolder({
    accountEmail: 'serve@softora.nl', folder: 'inbox', campaignOnly: true,
    incrementalOnly: true, force: true,
  });

  assert.equal(deferred.complete, false);
  assert.equal(deferred.freshnessConfirmed, false);
  assert.equal(deferred.partial, true);
  assert.deepEqual(deferred.selectedUids, []);
  assert.deepEqual(deferred.quarantinedUids, [42]);
  assert.equal(indexed.get(42).parseStatus, 'quarantined');

  selectionNowMs = Date.parse(placeholder.parseRetryAt) + 1;
  const recovered = await recoveredService.syncMailboxFolder({
    accountEmail: 'serve@softora.nl', folder: 'inbox', campaignOnly: true,
    incrementalOnly: true, force: true,
  });

  assert.equal(recovered.complete, true);
  assert.equal(recovered.freshnessConfirmed, true);
  assert.deepEqual(recovered.selectedUids, [42]);
  assert.deepEqual(upsertBatches.at(-1).map((message) => message.uid), [42]);
  assert.equal(indexed.get(42).subject, 'Belangrijke aanvraag hersteld');
  assert.equal(indexed.get(42).body, 'Gezonde inhoud 42');
  assert.equal(indexed.get(42).parseStatus, undefined);
  assert.equal(indexed.get(42).parseRetryAt, undefined);
  assert.equal(indexed.get(42).bodyUnavailable, undefined);
  assert.equal(finishes.length, 3);
});

test('campaign cron kan zonder verplichte mutation journal geen fetch of upsert starten', async () => {
  let fetches = 0;
  let writes = 0;
  const service = createMailboxSyncService({
    mailboxIndexStore: {
      acquireSyncLock: async () => ({ ok: true, lockToken: 'journal-missing' }),
      listMessageUidsForAccount: async () => [],
      upsertMessages: async () => { writes += 1; return { ok: true, upserted: 1 }; },
      finishSync: async () => ({ ok: true }),
    },
    assertReadableAccount: (email) => ({ email, imapConfigured: true }),
    canUseMailboxIndex: () => true,
    fetchMessagesFromImap: async () => { fetches += 1; return [{ uid: 91 }]; },
    getSafeLimit: (limit) => limit,
    getAccounts: () => [],
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeFolder: (value) => String(value || '').trim().toLowerCase(),
    requireCampaignMutationJournal: true,
    campaignMutationRunner: { isAvailable: () => false },
    logger: { error() {} },
  });

  const result = await service.syncMailbox({
    accountEmail: 'serve@softora.nl',
    folders: ['inbox'],
    campaignOnly: true,
    force: true,
  });

  assert.equal(result.ok, false);
  assert.match(result.results[0].error, /mutatiejournal/i);
  assert.equal(fetches, 0);
  assert.equal(writes, 0);
});

test('campaign Gmail label sync records a failure and succeeds on the next forced retry', async () => {
  let attempts = 0;
  const finished = [];
  const service = createMailboxSyncService({
    mailboxIndexStore: {
      acquireSyncLock: async () => ({ ok: true, lockToken: `lock-${attempts + 1}` }),
      prepareUidValidity: async () => ({ ok: true, uidValidity: 777 }),
      listMessageUidsForAccount: async () => [],
      upsertMessages: async ({ messages }) => ({ ok: true, upserted: messages.length }),
      finishSync: async (options) => {
        finished.push(options);
        return { ok: true };
      },
    },
    assertReadableAccount: (email) => ({
      email,
      imapHost: 'imap.gmail.com',
      imapConfigured: true,
    }),
    canUseMailboxIndex: () => true,
    fetchMessagesFromImap: async ({ folder, campaignHistory, indexedUids }) => {
      attempts += 1;
      assert.equal(folder, CAMPAIGN_GMAIL_LABEL_FOLDER);
      assert.equal(campaignHistory, false);
      assert.deepEqual(indexedUids, []);
      if (attempts === 1) throw new Error('tijdelijke Gmail IMAP-fout');
      return withSyncReadHealth([{ uid: 91, id: 'coldmail:91' }]);
    },
    getSafeLimit: (limit) => limit,
    getAccounts: () => [],
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeFolder: (value) => String(value || '').trim().toLowerCase(),
    logger: { error() {} },
  });

  const first = await service.syncMailbox({
    accountEmail: 'servec321@gmail.com',
    folders: [CAMPAIGN_GMAIL_LABEL_FOLDER],
    campaignOnly: true,
    force: true,
  });
  const second = await service.syncMailbox({
    accountEmail: 'servec321@gmail.com',
    folders: [CAMPAIGN_GMAIL_LABEL_FOLDER],
    campaignOnly: true,
    force: true,
  });

  assert.equal(first.ok, false);
  assert.match(first.results[0].error, /tijdelijke Gmail IMAP-fout/);
  assert.equal(second.ok, true);
  assert.equal(second.results[0].synced, 1);
  assert.match(String(finished[0].error), /tijdelijke Gmail IMAP-fout/);
  assert.equal(finished[1].error, undefined);
});

test('mailbox cron sync indexes a lightweight sent batch and reports the remaining backlog', async () => {
  const sentMessages = Array.from({ length: 120 }, (_item, index) => ({
    uid: index + 1,
    flags: ['\\Seen'],
    internalDate: new Date(Date.UTC(2026, 5, 15, 8, index % 60, 0)),
    source: Buffer.from(`Subject: Bericht ${index + 1}\r\nFrom: Servé <serve@softora.nl>\r\nTo: klant@example.test\r\n\r\nTest`),
  }));
  const client = createFakeImapClient({
    boxes: [{ path: 'Sent', specialUse: '\\Sent' }],
    messagesByMailbox: { Sent: sentMessages },
  });
  const upsertedCounts = [];
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Servé',
        imapHost: 'imap.example.test',
        imapUser: 'serve@softora.nl',
        imapPass: 'secret',
      },
    ]),
    createImapClient: () => client,
    parseMailSource: async () => ({
      subject: 'Test',
      text: 'Test',
      from: { value: [{ address: 'serve@softora.nl', name: 'Servé' }] },
      to: { value: [{ address: 'klant@example.test', name: 'Klant' }] },
      date: new Date('2026-06-15T08:00:00.000Z'),
      attachments: [],
    }),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      acquireSyncLock: async () => ({ ok: true, lockToken: 'lock-1' }),
      prepareUidValidity: async () => ({ ok: true, uidValidity: 777 }),
      upsertMessages: async ({ messages }) => {
        upsertedCounts.push(messages.length);
        return { ok: true, upserted: messages.length };
      },
      finishSync: async () => ({ ok: true }),
    },
  });
  const response = createResponseRecorder();

  await service.syncMailboxResponse(
    { method: 'GET', query: { account: 'serve@softora.nl', folder: 'sent' }, body: {} },
    response
  );

  assert.equal(response.statusCode, 207);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.complete, false);
  assert.equal(response.body.freshnessConfirmed, false);
  assert.equal(response.body.results[0].code, 'MAILBOX_SYNC_SELECTION_TRUNCATED');
  assert.equal(response.body.results[0].remainingUidCount, 90);
  assert.deepEqual(upsertedCounts, [30]);
  assert.equal(response.body.results[0].synced, 30);
});

test('campaign mailbox sync combines newest mail with missing historical conversation messages', async () => {
  const sentMessages = Array.from({ length: 120 }, (_item, index) => ({
    uid: index + 1,
    flags: ['\\Seen'],
    internalDate: new Date(Date.UTC(2026, 5, 15, 8, index % 60, 0)),
    source: Buffer.from(`Subject: Re: Kleine vraag over jullie website\r\nFrom: Servé <serve290@gmail.com>\r\nTo: joey@vangestelsteigerbouw.nl\r\n\r\nTest ${index + 1}`),
  }));
  const client = createFakeImapClient({
    boxes: [{ path: 'Sent', specialUse: '\\Sent' }],
    messagesByMailbox: { Sent: sentMessages },
  });
  let oldestLookup = null;
  let upsertedUids = [];
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve290@gmail.com',
        name: 'Servé',
        imapHost: 'imap.example.test',
        imapUser: 'serve290@gmail.com',
        imapPass: 'secret',
      },
    ]),
    createImapClient: () => client,
    parseMailSource: async (source) => ({
      subject: 'Re: Kleine vraag over jullie website',
      text: source.toString(),
      from: { value: [{ address: 'serve290@gmail.com', name: 'Servé' }] },
      to: { value: [{ address: 'joey@vangestelsteigerbouw.nl', name: 'Joey' }] },
      date: new Date('2026-06-15T08:00:00.000Z'),
      attachments: [],
    }),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      acquireSyncLock: async () => ({ ok: true, lockToken: 'lock-history' }),
      prepareUidValidity: async () => ({ ok: true, uidValidity: 777 }),
      getOldestMatchingMessageUid: async (options) => {
        oldestLookup = options;
        return 91;
      },
      listMessageUidsForAccount: async (options) => {
        assert.equal(options.limit, CAMPAIGN_SYNC_UID_SCAN_LIMIT);
        return [119, 120];
      },
      upsertMessages: async ({ messages }) => {
        upsertedUids = messages.map((message) => message.uid);
        return { ok: true, upserted: messages.length };
      },
      finishSync: async () => ({ ok: true }),
    },
  });
  const response = createResponseRecorder();

  await service.syncMailboxResponse(
    {
      method: 'POST',
      query: {},
      body: {
        account: 'serve290@gmail.com',
        folder: 'sent',
        campaignOnly: true,
        limit: 30,
      },
    },
    response
  );

  assert.equal(response.statusCode, 207);
  assert.equal(response.body.complete, false);
  assert.equal(response.body.results[0].code, 'MAILBOX_SYNC_SELECTION_TRUNCATED');
  const { signal: oldestLookupSignal, ...oldestLookupInput } = oldestLookup;
  assert.deepEqual(oldestLookupInput, {
    accountEmail: 'serve290@gmail.com',
    folder: 'sent',
    subjectTerms: ['Kleine vraag over jullie website', 'Nieuw webdesign'],
  });
  assert.equal(oldestLookupSignal instanceof AbortSignal, true);
  assert.equal(upsertedUids.length, CAMPAIGN_SYNC_FETCH_LIMIT);
  assert.deepEqual(upsertedUids, [118, 117, 90, 89]);
  assert.equal(client.searchQueries.length, 3);
  assert.deepEqual(client.searchQueries[0], { all: true });
  assert.deepEqual(client.searchOptions, [{ uid: true }, { uid: true }, { uid: true }]);
  assert.deepEqual(client.fetchOptions, [
    {
      query: { uid: true, flags: true, internalDate: true, envelope: true, source: true },
      options: { uid: true },
    },
  ]);
  assert.equal(response.body.results[0].historyBackfill, true);
  assert.equal(response.body.results[0].historyBeforeUid, 91);
});

test('campaign mailbox sync fetches a historical sent reply linked to an indexed incoming message', async () => {
  const sentMessages = Array.from({ length: 120 }, (_item, index) => ({
    uid: index + 1,
    flags: ['\\Seen'],
    internalDate: new Date(Date.UTC(2026, 5, 15, 8, index % 60, 0)),
    source: Buffer.from(`Subject: Re: Kleine vraag over jullie website\r\nFrom: Servé <serve290@gmail.com>\r\nTo: joey@vangestelsteigerbouw.nl\r\n\r\nTest ${index + 1}`),
  }));
  const client = createFakeImapClient({
    boxes: [{ path: 'Sent', specialUse: '\\Sent' }],
    messagesByMailbox: { Sent: sentMessages },
  });
  client.search = async (query, options) => {
    client.searchQueries.push(query);
    client.searchOptions.push(options);
    if (query.or) return [42];
    return sentMessages.map((message) => message.uid);
  };
  let upsertedUids = [];
  const historyScanRequests = [];
  const indexedInboxMessageId =
    '<BF12953B-A9DE-4A85-8F2D-F94926245967@vangestelsteigerbouw.nl>';
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve290@gmail.com',
        name: 'Servé',
        imapHost: 'imap.example.test',
        imapUser: 'serve290@gmail.com',
        imapPass: 'secret',
      },
    ]),
    createImapClient: () => client,
    parseMailSource: async (source) => ({
      subject: 'Re: Kleine vraag over jullie website',
      text: source.toString(),
      from: { value: [{ address: 'serve290@gmail.com', name: 'Servé' }] },
      to: { value: [{ address: 'joey@vangestelsteigerbouw.nl', name: 'Joey' }] },
      date: new Date('2026-06-10T08:00:00.000Z'),
      attachments: [],
    }),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      listMessageUidsForAccount: async ({ folder, limit }) => {
        assert.equal(folder, 'sent');
        assert.equal(limit, CAMPAIGN_SYNC_UID_SCAN_LIMIT);
        return Array.from({ length: 7 }, (_item, index) => 114 + index);
      },
      listMatchingMessagesForAccounts: async ({ folder, limit, subjectTerms }) => {
        historyScanRequests.push({ folder, limit });
        assert.deepEqual(subjectTerms, ['Kleine vraag over jullie website', 'Nieuw webdesign']);
        return [{
          uid: 2429,
          subject: 'Re: Kleine vraag over jullie website',
          messageId: indexedInboxMessageId,
          senderEmail: 'info@vangestelsteigerbouw.nl',
        }];
      },
      acquireSyncLock: async () => ({ ok: true, lockToken: 'lock-targeted-history' }),
      prepareUidValidity: async () => ({ ok: true, uidValidity: 777 }),
      getOldestMatchingMessageUid: async () => 91,
      upsertMessages: async ({ messages }) => {
        upsertedUids = messages.map((message) => message.uid);
        return { ok: true, upserted: messages.length };
      },
      finishSync: async () => ({ ok: true }),
    },
  });
  const response = createResponseRecorder();

  await service.syncMailboxResponse(
    {
      method: 'POST',
      query: {},
      body: {
        account: 'serve290@gmail.com',
        folder: 'sent',
        campaignOnly: true,
        limit: 20,
      },
    },
    response
  );

  assert.equal(response.statusCode, 207);
  assert.equal(response.body.complete, false);
  assert.equal(response.body.results[0].code, 'MAILBOX_SYNC_SELECTION_TRUNCATED');
  assert.deepEqual(historyScanRequests, [
    { folder: 'inbox', limit: CAMPAIGN_SYNC_INDEX_SCAN_LIMIT },
  ]);
  assert.equal(response.body.results[0].targetedThreadReferences, 1);
  assert.equal(response.body.results[0].targetedThreadRecipients, 2);
  assert.deepEqual(upsertedUids, [113, 112, 42, 90]);
  assert.deepEqual(client.searchQueries[3], {
    since: new Date('2026-05-01T00:00:00.000Z'),
    or: [
      { header: { references: indexedInboxMessageId } },
      { header: { 'in-reply-to': indexedInboxMessageId } },
    ],
  });
  assert.deepEqual(client.searchQueries[4], {
    since: new Date('2026-05-01T00:00:00.000Z'),
    or: [
      { to: 'info@vangestelsteigerbouw.nl' },
      { to: 'vangestelsteigerbouw.nl' },
    ],
  });
});

test('scheduled Sent-sync zoekt een oude SMTP intent exact op header en accepteert pas na index-upsert', async () => {
  const smtpIntent = {
    intentId: 'send:old-exact', status: 'prepared', reconcileRequired: true,
    accountEmail: 'serve@softora.nl', recipientEmail: 'klant@example.nl', owner: 'serve',
    mode: 'reply', conversationId: 'conversation:old', replyTargetMessageId: '<incoming@example.nl>',
    messageId: '<planned-old@softora.nl>', subject: 'Re: Oude vraag', body: 'Exact oud antwoord',
    cc: 'cc@example.nl', bcc: 'bcc@example.nl', createdAt: '2026-08-10T10:00:00.000Z',
    outboundGuardRequired: false,
  };
  const fingerprint = createMailboxRecipientFingerprint({
    to: smtpIntent.recipientEmail, cc: smtpIntent.cc, bcc: smtpIntent.bcc,
  });
  smtpIntent.payloadFingerprint = createMailboxPayloadFingerprint(smtpIntent);
  const messages = new Map([
    [1, {
      uid: 1, flags: ['\\Seen'], internalDate: new Date('2026-08-10T10:01:00.000Z'),
      source: Buffer.from([
        'Message-ID: <planned-old@softora.nl>', 'Date: Mon, 10 Aug 2026 12:01:00 +0200',
        'From: Servé <serve@softora.nl>', 'To: klant@example.nl', 'Cc: cc@example.nl',
        'Subject: Re: Oude vraag', 'X-Softora-Send-Intent-Id: send:old-exact',
        'X-Softora-Send-Mode: reply', 'X-Softora-Conversation-Id: conversation:old',
        'X-Softora-Reply-Target-Message-Id: <incoming@example.nl>',
        `X-Softora-Recipient-Fingerprint: ${fingerprint}`,
        `X-Softora-Payload-Fingerprint: ${smtpIntent.payloadFingerprint}`, '', 'Exact oud antwoord',
      ].join('\r\n')),
    }],
    [100, {
      uid: 100, flags: ['\\Seen'], internalDate: new Date('2026-08-10T11:00:00.000Z'),
      source: Buffer.from('Message-ID: <recent@softora.nl>\r\nSubject: Recent\r\n\r\nRecent'),
    }],
  ]);
  const searches = [];
  const client = {
    usable: true, mailbox: { uidValidity: 777 },
    async connect() {}, async list() { return [{ path: 'Sent', specialUse: '\\Sent' }]; },
    async getMailboxLock() { return { release() {} }; },
    async search(query) {
      searches.push(query);
      return query?.header?.['x-softora-send-intent-id'] ? [1] : [100];
    },
    fetch(uids) {
      return (async function* fetchMessages() {
        for (const uid of uids) if (messages.has(uid)) yield messages.get(uid);
      })();
    },
    async logout() { this.usable = false; },
  };
  const events = [];
  const store = {
    listAcceptedMessages: async () => [],
    listReconcileRequired: async ({ provider }) => {
      assert.equal(provider, 'smtp');
      return [smtpIntent];
    },
    accept: async (intentId) => { events.push(`accept:${intentId}`); },
  };
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl', name: 'Servé', imapHost: 'imap.example.test',
      imapUser: 'serve@softora.nl', imapPass: 'secret',
    }]),
    createImapClient: () => client,
    mailboxSendProvenanceStore: store,
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      acquireSyncLock: async () => ({ ok: true, lockToken: 'smtp-exact-lock' }),
      prepareUidValidity: async () => ({ ok: true, uidValidity: 777 }),
      upsertMessages: async ({ messages: synced }) => {
        events.push(`upsert:${synced.map((message) => message.uid).join(',')}`);
        return { ok: true, upserted: synced.length };
      },
      finishSync: async () => ({ ok: true }),
    },
    logger: { error() {}, warn() {} },
  });

  const result = await service.syncMailboxFolder({
    accountEmail: 'serve@softora.nl', folder: 'sent', force: true,
  });
  assert.deepEqual(searches.at(-1), { header: { 'x-softora-send-intent-id': smtpIntent.intentId } });
  assert.match(events[0], /^upsert:.*1/);
  assert.equal(events[1], `accept:${smtpIntent.intentId}`);
  assert.equal(result.reconciledSmtpSends, 1);
  assert.equal(result.remainingSmtpReconcileCount, 0);
});
