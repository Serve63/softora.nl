const test = require('node:test');
const assert = require('node:assert/strict');

const { createMailboxService: createRawMailboxService, sanitizeMailboxDisplayText } = require('../../server/services/mailbox');
const {
  CAMPAIGN_GMAIL_ALL_MAIL_FETCH_LIMIT,
  CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
  CAMPAIGN_GMAIL_LABEL_FOLDER,
  CAMPAIGN_SYNC_FETCH_LIMIT,
  CAMPAIGN_SYNC_INDEX_SCAN_LIMIT,
  CAMPAIGN_SYNC_UID_SCAN_LIMIT,
  createMailboxSyncService: createRawMailboxSyncService,
  getMailboxSyncFoldersForAccount,
} = require('../../server/services/mailbox-campaign-sync');
const { registerMailboxRoutes } = require('../../server/routes/mailbox');
const { closeMailboxClientQuietly } = require('../../server/services/mailbox-imap-fetch');
const { MAILBOX_VISIBILITY_PROTOCOL } = require('../../server/services/mailbox-delete-message');
const {
  MAILBOX_CAMPAIGN_SNAPSHOT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
  parseMailboxCampaignSnapshot,
  serializeMailboxCampaignSnapshot,
} = require('../../server/services/mailbox-campaign-snapshot');
const {
  createMailboxSyncLegacyStore,
} = require('../testlib/mailbox-sync-legacy');

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

let provenanceSequence = 0;
function createMailboxService(deps = {}) {
  const intents = new Map();
  const outboundRecipientGuardStore = Object.prototype.hasOwnProperty.call(
    deps,
    'outboundRecipientGuardStore'
  )
    ? deps.outboundRecipientGuardStore
    : { findRecipientSuppressionConflict: async () => ({ ok: true, conflict: null }) };
  const mailboxSendProvenanceStore = deps.mailboxSendProvenanceStore || {
    findByIdempotencyKey: async () => null,
    reserve: async (payload) => {
      const existing = intents.get(payload.idempotencyKey);
      if (existing) return { created: false, intent: existing };
      const intent = { ...payload, status: 'prepared' };
      intents.set(payload.idempotencyKey, intent);
      return { created: true, intent };
    },
    accept: async (intentId, payload) => {
      const intent = Array.from(intents.values()).find((candidate) => candidate.intentId === intentId) || {};
      const accepted = { ...intent, ...payload, intentId, status: 'accepted' };
      if (intent.idempotencyKey) intents.set(intent.idempotencyKey, accepted);
      return accepted;
    },
    fail: async () => null,
    listAcceptedMessages: async () => [],
  };
  const mailboxComposeThreadContext = deps.mailboxComposeThreadContext || {
    resolveReplyIdentity: async ({ body = {}, accountEmail, provider, mode }) => {
      const resolvedAccount = body.replyIdentity?.accountEmail || body.context?.accountEmail || accountEmail;
      const owner = body.owner || (/martijn|venvisuals/i.test(resolvedAccount) ? 'martijn' : 'serve');
      return {
        version: 1,
        provider: String(provider || body.provider || 'smtp').toLowerCase(),
        owner,
        senderName: owner === 'martijn' ? 'Martijn van de Ven' : 'Servé Creusen',
        accountEmail: resolvedAccount,
        mode,
      };
    },
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
  return createRawMailboxService({
    ...deps,
    ...(deps.mailboxIndexStore
      ? { mailboxIndexStore: createMailboxSyncLegacyStore(deps.mailboxIndexStore) }
      : {}),
    mailboxSendProvenanceStore,
    mailboxComposeThreadContext,
    outboundRecipientGuardStore,
  });
}

function createMailboxSyncService(options = {}) {
  return createRawMailboxSyncService({
    ...options,
    mailboxIndexStore: createMailboxSyncLegacyStore(options.mailboxIndexStore),
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

function createOutboundGuardStore(calls = [], overrides = {}) {
  return {
    findRecipientSuppressionConflict: async () =>
      overrides.suppressionResult || { ok: true, conflict: null },
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

test('mailbox service excludes automated delivery failures from list and detail without touching human replies', async () => {
  const automated = {
    id: 'inbox:1',
    uid: 1,
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
    }),
    { status: 404 }
  );
  assert.equal((await service.getMessage({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    id: 'inbox:2',
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

test('selected owner response stays isolated while durable snapshot retains both Instantly owners', async () => {
  let savedSnapshot = '';
  let localReplyOptions = null;
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
      listOwnerConversations: async (owner) => messagesByOwner[owner],
    },
    setUiStateValues: async (_scope, values) => {
      savedSnapshot = values[MAILBOX_CAMPAIGN_SNAPSHOT_KEY];
    },
  });
  const res = createResponseRecorder();

  await service.campaignRepliesResponse({
    query: { limit: '100', owner: 'serve', refreshInstantly: '0' },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(localReplyOptions, { limit: 100, owner: 'serve' });
  assert.deepEqual(res.body.messages.map((message) => message.id), ['ramon']);
  const persisted = parseMailboxCampaignSnapshot(savedSnapshot);
  assert.deepEqual(
    persisted.messages.map((message) => [message.id, message.providerOwner]),
    [['martijn-thread', 'martijn'], ['ramon', 'serve']]
  );
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
  assert.equal(res.headers['x-softora-message-id'], res.body.result.messageId);
  assert.equal(res.headers['x-softora-send-intent-id'], res.body.result.intentId);
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
    outboundRecipientGuardStore: null,
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
      assert.equal(error.code, 'OUTBOUND_SUPPRESSION_GUARD_UNAVAILABLE');
      assert.equal(error.status, 503);
      return true;
    }
  );

  assert.equal(sent.length, 0);
});

test('mailbox service marks provider acceptance as reconcile-required when guard finalization fails', async () => {
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

  await assert.rejects(
    () =>
      service.sendMessage({
        accountEmail: 'serve@softora.nl',
        to: 'info@confirm-empty.example',
        subject: 'Kleine vraag over jullie website',
        text: 'Beste collega-ondernemer,\n\nIk heb een nieuw webdesign gemaakt voor confirm-empty.example.',
      }),
    (error) => {
      assert.equal(error.code, 'MAILBOX_SEND_RECONCILE_REQUIRED');
      assert.equal(error.status, 409);
      assert.match(error.message, /provideruitkomst/i);
      return true;
    }
  );

  assert.equal(sent.length, 1);
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

test('mailbox service resolves Gmail All Mail through IMAP special-use metadata', async () => {
  const receivedDate = new Date('2026-05-28T11:15:00.000Z');
  const client = createFakeImapClient({
    boxes: [
      { path: 'INBOX' },
      { path: '[Gmail]/Alle berichten', specialUse: '\\All' },
    ],
    messagesByMailbox: {
      '[Gmail]/Alle berichten': [{
        uid: 84,
        flags: ['\\Seen'],
        internalDate: receivedDate,
        source: {
          date: receivedDate,
          text: 'Historisch antwoord',
          subject: 'Re: Nieuw webdesign',
          from: { value: [{ name: 'Klant', address: 'klant@example.nl' }] },
          to: { value: [{ name: 'Martijn', address: 'martijnven123@gmail.com' }] },
        },
      }],
    },
  });
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([{
      email: 'martijnven123@gmail.com',
      name: 'Martijn',
      imapHost: 'imap.gmail.com',
      imapUser: 'martijnven123@gmail.com',
      imapPass: 'secret',
    }]),
    createImapClient: () => client,
    parseMailSource: async (source) => source,
  });

  const messages = await service.listMessages({
    accountEmail: 'martijnven123@gmail.com',
    folder: CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
  });

  assert.deepEqual(client.lockedMailboxes, ['[Gmail]/Alle berichten']);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].folder, CAMPAIGN_GMAIL_ALL_MAIL_FOLDER);
  assert.equal(messages[0].subject, 'Re: Nieuw webdesign');
});

test('mailbox service herkent een eigen Gmail All Mail-campagnekopie als verzonden MIME-bewijs', async () => {
  const exactUrl = 'https://www.softora.nl/webdesign/ruud-bos?cid=ruud-1&sender=martijn';
  const sentDate = new Date('2026-08-20T12:49:00.000Z');
  const body = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website ruudbosdesign.nl tegen.',
    '',
    'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
    '',
    'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link bekijken.',
  ].join('\n');
  const client = createFakeImapClient({
    boxes: [{ path: '[Gmail]/Alle berichten', specialUse: '\\All' }],
    messagesByMailbox: {
      '[Gmail]/Alle berichten': [{
        uid: 912,
        flags: ['\\Seen'],
        internalDate: sentDate,
        source: {
          date: sentDate,
          text: body,
          html: [
            '<p>Goedendag,</p>',
            '<p>Afgelopen week kwam ik jullie website ruudbosdesign.nl tegen.</p>',
            '<p>Uit enthousiasme heb ik een fris webdesign gemaakt.</p>',
            `<p>Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze <a href="${exactUrl.replaceAll('&', '&amp;')}">link</a> bekijken.</p>`,
          ].join(''),
          subject: 'Kleine vraag over jullie website',
          messageId: '<ruud-root@gmail.com>',
          from: { value: [{ name: 'Martijn van de Ven', address: 'martijnven123@gmail.com' }] },
          to: { value: [{ name: 'Ruud Bos', address: 'info@ruudbosdesign.nl' }] },
          attachments: [{
            filename: 'webdesign-ruud-bos.pdf',
            contentType: 'application/pdf',
            content: Buffer.from('pdf'),
          }],
        },
      }],
    },
  });
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([{
      email: 'martijnven123@gmail.com',
      name: 'Martijn',
      imapHost: 'imap.gmail.com',
      imapUser: 'martijnven123@gmail.com',
      imapPass: 'secret',
    }]),
    createImapClient: () => client,
    parseMailSource: async (source) => source,
  });

  const [message] = await service.listMessages({
    accountEmail: 'martijnven123@gmail.com',
    folder: CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
  });

  assert.equal(message.folder, CAMPAIGN_GMAIL_ALL_MAIL_FOLDER);
  assert.equal(message.originalCampaignOutbound, true);
  assert.equal(message.webdesignLinkEvidenceKnown, true);
  assert.equal(message.webdesignLinkUrl, exactUrl);
  assert.deepEqual(message.attachments, [{
    filename: 'webdesign-ruud-bos.pdf',
    contentType: 'application/pdf',
    size: 3,
  }]);
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
      throw new Error('De volledige mailbox hoeft niet opnieuw via IMAP te worden opgehaald');
    },
  });

  const message = await service.getMessage({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    id: 'inbox:44',
  });

  assert.equal(imapCalls, 0);
  assert.deepEqual(message.bodyImages || [], []);
  assert.deepEqual(message.inlineImages || [], []);
  assert.doesNotMatch(message.body, /\[image:/);
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
    createImapClient: () => {
      throw new Error('De volledige mailbox hoeft niet opnieuw via IMAP te worden opgehaald');
    },
  });

  const message = await service.getMessage({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    id: 'inbox:45',
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
    createImapClient: () => {
      throw new Error('De volledige mailbox hoeft niet opnieuw via IMAP te worden opgehaald');
    },
  });

  const message = await service.getMessage({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    id: 'inbox:46',
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

test('mailbox service herstelt de exacte MIME-link zonder een ongefencete indexwrite', async () => {
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
      applyStateMutation: async (input) => {
        calls.push(['indexRead', input]);
        return { ok: true, row: { unread: false, reply_dismissed_at: null, current_revision: input.revision } };
      },
    },
  });
  const res = createResponseRecorder();

  await service.markMessageReadResponse(
    {
      body: {
        account: 'serve@softora.nl',
        id: 'inbox:42',
        messageKey: 'serve@softora.nl|inbox|gen:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|42',
        messageId: '<message-42@example.test>',
        mutationId: '00000000-0000-4000-8000-000000000042',
        revision: 42001,
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.result.account, 'serve@softora.nl');
  assert.equal(res.body.result.folder, 'inbox');
  assert.equal(res.body.result.uid, 42);
  assert.equal(res.body.result.unread, false);
  assert.equal(res.body.result.mutationId, '00000000-0000-4000-8000-000000000042');
  assert.equal(res.body.result.revision, 42001);
  assert.equal(calls[0][0], 'indexRead');
  assert.equal(calls[0][1].accountEmail, 'serve@softora.nl');
  assert.equal(calls[0][1].folder, 'inbox');
  assert.equal(calls[0][1].uid, 42);
  assert.equal(calls[0][1].messageKey, 'serve@softora.nl|inbox|gen:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|42');
  assert.equal(calls[0][1].messageId, '<message-42@example.test>');
  assert.equal(calls[0][1].revision, 42001);
  assert.match(calls[0][1].mutationKey, /^[a-f0-9]{64}$/);
  assert.deepEqual(calls.slice(1), [
    ['connect', 'serve@softora.nl'],
    ['lock', 'INBOX'],
    ['flagsAdd', [42], ['\\Seen'], { uid: true }],
    ['release', 'INBOX'],
    ['logout'],
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
      connect: async () => calls.push(['connect']),
      list: async () => [{ path: 'INBOX' }],
      getMailboxLock: async () => ({ release: () => calls.push(['release']) }),
      messageFlagsAdd: async () => calls.push(['seen']),
      logout: async () => calls.push(['logout']),
    }),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      applyStateMutation: async (input) => {
        calls.push(['dismiss', input]);
        return { ok: true, row: { unread: false, reply_dismissed_at: dismissedAt, current_revision: input.revision } };
      },
    },
  });
  const res = createResponseRecorder();

  await service.markMessageReadResponse({
    body: {
      account: 'serve@softora.nl', id: 'inbox:42', dismissReply: true,
      messageKey: 'serve@softora.nl|inbox|gen:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|42',
      messageId: '<message-42@example.test>',
      mutationId: '00000000-0000-4000-8000-000000000043', revision: 43001,
    },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.result.replyDismissedAt, dismissedAt);
  assert.equal(calls[0][0], 'dismiss');
  assert.equal(calls[0][1].dismissReply, true);
  assert.equal(calls[0][1].revision, 43001);
  assert.match(calls[0][1].mutationKey, /^[a-f0-9]{64}$/);
  assert.deepEqual(calls.slice(1), [
    ['connect'],
    ['seen'],
    ['release'],
    ['logout'],
  ]);
});

test('mailbox service maakt een tijdelijke Supabasefout retryable zonder raw fouttekst', async () => {
  const service = createMailboxService({
    logger: { error() {}, warn() {} },
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve290@gmail.com',
      name: 'Servé',
      imapHost: 'imap.example.test',
      imapUser: 'serve290@gmail.com',
      imapPass: 'secret',
    }]),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      async applyStateMutation() {
        const error = new Error('Supabase REST tijdelijk overgeslagen na timeout/504 (59s cooldown)');
        error.name = 'AbortError';
        return { ok: false, error };
      },
    },
  });
  const res = createResponseRecorder();

  await service.markMessageReadResponse({
    body: {
      account: 'serve290@gmail.com',
      id: 'inbox:259',
      uid: 259,
      messageKey: 'serve290@gmail.com|inbox|gen:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|259',
      messageId: '<message-259@example.test>',
      mutationId: '00000000-0000-4000-8000-000000000259',
      revision: 259001,
      dismissReply: true,
    },
  }, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.retryable, true);
  assert.equal(res.body.code, 'MAILBOX_STATE_TEMPORARY');
  assert.doesNotMatch(JSON.stringify(res.body), /Supabase|REST|504|cooldown|59s/i);
});

test('mailbox statusresponse bevestigt exact dezelfde idempotente mutatie zonder provider-effect', async () => {
  let expectedMutationKey = '';
  const service = createMailboxService({
    logger: { error() {}, warn() {} },
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve290@gmail.com',
      name: 'Servé',
      imapHost: 'imap.example.test',
      imapUser: 'serve290@gmail.com',
      imapPass: 'secret',
    }]),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      async applyStateMutation(input) {
        expectedMutationKey = input.mutationKey;
        return { ok: true, row: { unread: false, current_revision: input.revision } };
      },
      async getStateMutationStatus() {
        return {
          ok: true,
          row: {
            state_revision: 259001,
            state_mutation_key: expectedMutationKey,
            unread: false,
            reply_dismissed_at: '2026-08-14T14:52:02.000Z',
          },
        };
      },
    },
    createImapClient: () => ({
      usable: false,
      async connect() {},
      async list() { return [{ path: 'INBOX' }]; },
      async getMailboxLock() { return { release() {} }; },
      async messageFlagsAdd() {},
    }),
  });
  const payload = {
    account: 'serve290@gmail.com', id: 'inbox:259', uid: 259,
    messageKey: 'serve290@gmail.com|inbox|gen:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|259',
    messageId: '<message-259@example.test>',
    mutationId: '00000000-0000-4000-8000-000000000259', revision: 259001,
    dismissReply: true,
  };
  await service.markMessageReadResponse({ body: payload }, createResponseRecorder());
  const statusRes = createResponseRecorder();
  await service.getMessageReadStatusResponse({ body: payload }, statusRes);

  assert.equal(statusRes.statusCode, 200);
  assert.equal(statusRes.body.result.confirmed, true);
  assert.equal(statusRes.body.result.currentRevision, 259001);
});

test('mailbox service verbergt en herstelt een gesprek alleen in Softora zonder bronmailmutatie', async () => {
  const persistenceCalls = [];
  let savedSnapshot = '';
  const initialSnapshot = serializeMailboxCampaignSnapshot({
    ok: true,
    messages: [
      { id: 'inbox:42', uid: 42, folder: 'inbox', accountEmail: 'serve@softora.nl' },
      { id: 'inbox:43', uid: 43, folder: 'inbox', accountEmail: 'serve@softora.nl' },
    ],
  });
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
      throw new Error('bronmailclient mag niet worden aangemaakt');
    },
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      markMessageDeleted: async (input) => {
        persistenceCalls.push(['index-delete', input]);
        return { ok: true };
      },
      restoreMessage: async (input) => {
        persistenceCalls.push(['index-restore', input]);
        return { ok: true };
      },
    },
    getUiStateValues: async (scope) => {
      persistenceCalls.push(['snapshot-read', scope]);
      return { values: { [MAILBOX_CAMPAIGN_SNAPSHOT_KEY]: initialSnapshot } };
    },
    setUiStateValues: async (scope, values, meta) => {
      persistenceCalls.push(['snapshot-write', scope, meta]);
      savedSnapshot = values[MAILBOX_CAMPAIGN_SNAPSHOT_KEY];
    },
  });
  const res = createResponseRecorder();
  const expectedResolvedMessages = [{
    account: 'serve@softora.nl',
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    uid: 42,
    id: 'inbox:42',
    messageId: '',
    messageKey: '',
  }, {
    account: 'serve@softora.nl',
    accountEmail: 'serve@softora.nl',
    folder: 'sent',
    uid: 7,
    id: 'sent:7',
    messageId: '',
    messageKey: '',
  }];

  await service.hideConversationResponse(
    {
      body: {
        visibilityProtocol: MAILBOX_VISIBILITY_PROTOCOL,
        account: 'serve@softora.nl',
        id: 'inbox:42',
        messages: [
          { account: 'serve@softora.nl', id: 'inbox:42', uid: 42, folder: 'inbox' },
          { account: 'serve@softora.nl', id: 'sent:7', uid: 7, folder: 'sent' },
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
    resolvedMessageCount: 2,
    resolvedMessages: expectedResolvedMessages,
    snapshotUpdated: true,
  });
  assert.equal(imapClientCreations, 0);
  assert.deepEqual(persistenceCalls, [
    ['index-delete', {
      accountEmail: 'serve@softora.nl',
      id: 'inbox:42',
      folder: 'inbox',
      uid: 42,
    }],
    ['index-delete', {
      accountEmail: 'serve@softora.nl',
      id: 'sent:7',
      folder: 'sent',
      uid: 7,
    }],
    ['snapshot-read', MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE],
    ['snapshot-write', MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE, {
      source: 'mailbox-view-hide',
      actor: 'serve@softora.nl',
    }],
  ]);
  assert.deepEqual(
    parseMailboxCampaignSnapshot(savedSnapshot).messages.map((message) => message.uid),
    [43]
  );

  const restoreRes = createResponseRecorder();
  await service.restoreConversationResponse(
    {
      body: {
        visibilityProtocol: MAILBOX_VISIBILITY_PROTOCOL,
        account: 'serve@softora.nl',
        id: 'inbox:42',
        messages: [
          { account: 'serve@softora.nl', id: 'inbox:42', uid: 42, folder: 'inbox' },
          { account: 'serve@softora.nl', id: 'sent:7', uid: 7, folder: 'sent' },
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
    resolvedMessageCount: 2,
    resolvedMessages: expectedResolvedMessages,
  });
  assert.equal(imapClientCreations, 0);
  assert.deepEqual(persistenceCalls.slice(-2), [
    ['index-restore', {
      accountEmail: 'serve@softora.nl',
      id: 'inbox:42',
      folder: 'inbox',
      uid: 42,
    }],
    ['index-restore', {
      accountEmail: 'serve@softora.nl',
      id: 'sent:7',
      folder: 'sent',
      uid: 7,
    }],
  ]);
});

test('mailbox service weigert meer dan honderd gesprekberichten vóór elke gedeeltelijke tombstone-write', async () => {
  const persistenceCalls = [];
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl',
      name: 'Servé',
      imapHost: 'imap.example.test',
      imapUser: 'serve@softora.nl',
      imapPass: 'secret',
    }]),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      markMessageDeleted: async (input) => {
        persistenceCalls.push(input);
        return { ok: true };
      },
    },
  });
  const res = createResponseRecorder();
  const messages = Array.from({ length: 101 }, (_value, index) => ({
    account: 'serve@softora.nl',
    id: `inbox:${index + 1}`,
    uid: index + 1,
    folder: 'inbox',
  }));

  await service.hideConversationResponse({ body: {
    visibilityProtocol: MAILBOX_VISIBILITY_PROTOCOL,
    messages,
  } }, res);

  assert.equal(res.statusCode, 413);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'Gesprek verbergen mislukt');
  assert.deepEqual(persistenceCalls, []);
});

test('mailbox service weigert oude hide- en restoreclients vóór iedere zichtbaarheidwrite', async () => {
  let writes = 0;
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl',
      name: 'Servé',
      imapHost: 'imap.example.test',
      imapUser: 'serve@softora.nl',
      imapPass: 'secret',
    }]),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      markMessageDeleted: async () => { writes += 1; return { ok: true }; },
      restoreMessage: async () => { writes += 1; return { ok: true }; },
    },
  });
  const request = {
    body: {
      owner: 'serve', account: 'serve@softora.nl',
      id: 'inbox:42', uid: 42, folder: 'inbox',
      messages: [{ account: 'serve@softora.nl', id: 'inbox:42', uid: 42, folder: 'inbox' }],
    },
  };

  for (const operation of ['hideConversationResponse', 'restoreConversationResponse']) {
    const res = createResponseRecorder();
    await service[operation](request, res);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.detail, /verouderd.*vernieuw/i);
  }
  assert.equal(writes, 0);
});

test('mailbox service verbergt een outreachcontact atomisch over uitsluitend server-bepaalde owneraccounts', async () => {
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
      {
        email: 'servec321@gmail.com',
        name: 'Servé',
        imapHost: 'imap.example.test',
        imapUser: 'servec321@gmail.com',
        imapPass: 'secret',
      },
    ]),
    mailboxOutreachScope: {
      getScopedAccounts(owner) {
        calls.push(['scope', owner]);
        return ['servec321@gmail.com', 'serve@softora.nl'];
      },
      filterConversations: async ({ messages }) => messages,
    },
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      async setContactVisibility(input, hidden) {
        calls.push(['contact-visibility', input, hidden]);
        return {
          ok: true,
          data: [
            {
              message_key: 'serve@softora.nl|inbox|42',
              account_email: 'serve@softora.nl', folder: 'inbox', uid: 42,
              provider_id: '', message_id: '<grow@example.test>',
            },
            {
              message_key: 'servec321@gmail.com|inbox|88',
              account_email: 'servec321@gmail.com', folder: 'inbox', uid: 88,
              provider_id: '', message_id: '<grow@example.test>',
            },
          ],
        };
      },
    },
  });
  const res = createResponseRecorder();

  await service.hideConversationResponse({ body: {
    visibilityProtocol: MAILBOX_VISIBILITY_PROTOCOL,
    owner: 'serve',
    visibilityScope: 'outreach-contact',
    contactEmail: 'serve@growsocialmedia.nl',
    expectedMessageCount: 1,
    account: 'serve@softora.nl',
    id: 'inbox:42', uid: 42, folder: 'inbox',
    messages: [{ account: 'serve@softora.nl', id: 'inbox:42', uid: 42, folder: 'inbox' }],
  } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, [
    ['scope', 'serve'],
    ['scope', ''],
    ['contact-visibility', {
      accountEmails: ['serve@softora.nl', 'servec321@gmail.com'],
      contactEmail: 'serve@growsocialmedia.nl',
      accountEmail: 'serve@softora.nl',
      id: 'inbox:42', folder: 'inbox', uid: 42,
      expectedMessageCount: 1,
    }, true],
  ]);
  assert.equal(res.body.result.messageCount, 1);
  assert.equal(res.body.result.resolvedMessageCount, 2);
  assert.equal(res.body.result.sourceMailboxMutated, false);
});

test('mailbox service weigert een outreachdoel buiten de server-bepaalde eigenaarsscope vóór writes', async () => {
  let writes = 0;
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([{
      email: 'martijn@softora.nl', name: 'Martijn', imapHost: 'imap.example.test',
      imapUser: 'martijn@softora.nl', imapPass: 'secret',
    }]),
    mailboxOutreachScope: {
      getScopedAccounts: () => ['serve@softora.nl', 'servec321@gmail.com'],
      filterConversations: async ({ messages }) => messages,
    },
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      setContactVisibility: async () => { writes += 1; return { ok: true, data: [] }; },
    },
  });
  const res = createResponseRecorder();

  await service.hideConversationResponse({ body: {
    visibilityProtocol: MAILBOX_VISIBILITY_PROTOCOL,
    owner: 'serve', visibilityScope: 'outreach-contact',
    contactEmail: 'contact@example.nl', expectedMessageCount: 1,
    messages: [{ account: 'martijn@softora.nl', id: 'inbox:7', uid: 7, folder: 'inbox' }],
  } }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(writes, 0);
  assert.match(res.body.detail, /buiten de gekozen persoonlijke mailbox/i);
});

test('mailbox service behandelt een account van de andere eigenaar nooit als extern contactdossier', async () => {
  let writes = 0;
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl', name: 'Servé', imapHost: 'imap.example.test',
      imapUser: 'serve@softora.nl', imapPass: 'secret',
    }]),
    mailboxOutreachScope: {
      getScopedAccounts: (owner) => owner === 'serve'
        ? ['serve@softora.nl']
        : ['serve@softora.nl', 'martijn@softora.nl'],
      filterConversations: async ({ messages }) => messages,
    },
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      setContactVisibility: async () => { writes += 1; return { ok: true, data: [] }; },
    },
  });
  const res = createResponseRecorder();

  await service.hideConversationResponse({ body: {
    visibilityProtocol: MAILBOX_VISIBILITY_PROTOCOL,
    owner: 'serve', visibilityScope: 'outreach-contact',
    contactEmail: 'martijn@softora.nl', expectedMessageCount: 1,
    messages: [{ account: 'serve@softora.nl', id: 'inbox:8', uid: 8, folder: 'inbox' }],
  } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(writes, 0);
  assert.match(res.body.detail, /eigen mailbox/i);
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
        messageKey: 'serve@softora.nl|inbox|gen:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|42',
      },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'Mailboxbericht niet gevonden.');
});

test('mailbox service weigert een oud UID-only readrecord vóór iedere index- of providerwrite', async () => {
  let writes = 0;
  const service = createMailboxService({
    logger: { error() {} },
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl', name: 'Servé',
      imapHost: 'imap.example.test', imapUser: 'serve@softora.nl', imapPass: 'secret',
    }]),
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      applyStateMutation: async () => {
        writes += 1;
        return { ok: true, row: {} };
      },
    },
    createImapClient: () => {
      writes += 1;
      return {};
    },
  });
  const res = createResponseRecorder();

  await service.markMessageReadResponse({
    body: { account: 'serve@softora.nl', id: 'inbox:42', uid: 42 },
  }, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'MAILBOX_STATE_IDENTITY_REQUIRED');
  assert.equal(res.body.retryable, false);
  assert.equal(writes, 0);
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

test('mailbox list response returns a warming index response without live IMAP when the index is empty', async () => {
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
      listMessages: async () => [],
      getSyncState: async () => null,
      isSyncStateStale: () => true,
    },
    createImapClient: () => {
      imapCalls += 1;
      throw new Error('IMAP mag de mailboxlijst niet blokkeren');
    },
  });
  const res = createResponseRecorder();

  await service.listMessagesResponse(
    { query: { account: 'serve@softora.nl', folder: 'inbox', limit: '50' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.messages, []);
  assert.equal(res.body.sync.source, 'index-empty');
  assert.equal(res.body.sync.warming, true);
  assert.equal(res.body.sync.refreshRecommended, true);
  assert.equal(res.body.sync.indexAvailable, true);
  assert.equal(typeof res.body.sync.durationMs, 'number');
  assert.match(String(res.headers['server-timing'] || ''), /^mailbox;dur=/);
  assert.equal(imapCalls, 0);
});

test('mailbox list response returns stale indexed messages immediately without live IMAP', async () => {
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
        status: 'ok',
      }),
      isSyncStateStale: () => true,
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
    mailboxOutreachScope: { filterConversations: async ({ messages }) => messages },
    setUiStateValues: async (scope, values, meta) => {
      snapshotWrite = { scope, values, meta };
      return { values };
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
  assert.equal(snapshotWrite.scope, 'premium_mailbox_campaign_snapshot');
  assert.equal(snapshotWrite.meta.source, 'mailbox-campaign-replies');
  const persistedSnapshot = JSON.parse(
    snapshotWrite.values.softora_mailbox_campaign_snapshot_v2
  );
  assert.equal(persistedSnapshot.messages[0].from, 'Marie-José');
  assert.equal(persistedSnapshot.messages[1].from, 'Studio Noord');
  assert.equal(persistedSnapshot.messages[1].body, '');
  assert.equal(persistedSnapshot.messages[1].hasBody, false);
});

test('mailbox routes expose accounts, messages, send, attachments, local hide restore, rewrite and spelling endpoints', () => {
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
      searchMailboxResponse() {},
      contactTimelineResponse() {},
      listMessagesResponse() {},
      getMessageResponse() {},
      getMessageBodiesResponse() {},
      getMessageImageResponse() {},
      markMessageReadResponse() {},
      hideConversationResponse() {},
      restoreConversationResponse() {},
      preflightMessageResponse() {},
      attachmentUploadResponse() {},
      attachmentCleanupResponse() {},
      sendMessageResponse() {},
      rewriteDraftResponse() {},
    },
  });

  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/accounts'));
  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/campaign-replies'));
  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/search'));
  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/contact-timeline'));
  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/messages'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/messages/bodies'));
  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/message-image'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/messages/read'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/messages/hide'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/messages/restore'));
  assert.ok(!routes.some(([, path]) => path === '/api/mailbox/messages/delete'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/send/preflight'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/attachments/upload-url'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/attachments/cleanup'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/send'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/rewrite'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/spelling'));
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
    query: { account: 'serve@softora.nl', folder: 'inbox', id: 'inbox:42', index: '0' },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'image/png');
  assert.equal(response.headers['cache-control'], 'private, max-age=31536000, immutable');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(Buffer.isBuffer(response.body), true);
  assert.equal(response.body.toString(), 'mailbox-image');
});

test('mailbox cron sync route requires CRON_SECRET before attachment sweep and sweeps only GET sync', async () => {
  let cronCalled = 0;
  let sweepCalled = 0;
  const callOrder = [];
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
      async sweepExpiredAttachments(options) {
        sweepCalled += 1;
        callOrder.push('sweep');
        assert.deepEqual(options, { totalTimeoutMs: 5_000 });
      },
      syncMailboxResponse(_req, res) {
        cronCalled += 1;
        callOrder.push('sync');
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
  assert.equal(sweepCalled, 0);

  const allowed = createResponseRecorder();
  await route[2][0]({ headers: { authorization: 'Bearer cron-secret' } }, allowed, () => (
    route[2][1]({ method: 'GET' }, allowed)
  ));
  assert.equal(allowed.statusCode, 200);
  assert.equal(cronCalled, 1);
  assert.equal(sweepCalled, 1);
  assert.deepEqual(callOrder, ['sweep', 'sync']);

  const postRoute = routes.find(([method, path]) => method === 'POST' && path === '/api/mailbox/sync');
  const postResponse = createResponseRecorder();
  await postRoute[2][0]({ method: 'POST' }, postResponse, () => (
    postRoute[2][1]({ method: 'POST' }, postResponse)
  ));
  assert.equal(postResponse.statusCode, 200);
  assert.equal(cronCalled, 2);
  assert.equal(sweepCalled, 1);
});

test('mailbox cron sync skips safely during Supabase outage pause before attachment sweep', async () => {
  let cronCalled = 0;
  let sweepCalled = 0;
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
      async sweepExpiredAttachments() { sweepCalled += 1; },
      syncMailboxResponse(_req, res) {
        cronCalled += 1;
        res.status(200).json({ ok: true });
      },
      sendMessageResponse() {},
    },
  });

  const route = routes.find(([method, path]) => method === 'GET' && path === '/api/mailbox/sync');
  const paused = createResponseRecorder();
  await route[2][0]({ headers: { authorization: 'Bearer cron-secret' } }, paused, () => (
    route[2][1]({ method: 'GET' }, paused)
  ));

  assert.equal(paused.statusCode, 200);
  assert.equal(paused.body.ok, true);
  assert.equal(paused.body.skipped, true);
  assert.equal(paused.body.code, 'SUPABASE_OUTAGE_CRON_PAUSED');
  assert.equal(cronCalled, 0);
  assert.equal(sweepCalled, 0);
});

test('mailbox cron sweep is hard begrensd en een timeout laat de gewone sync doorgaan', async () => {
  const routes = [];
  const warnings = [];
  let syncCalled = 0;
  const app = {
    get(path, ...handlers) { routes.push(['GET', path, handlers]); },
    post() {},
  };
  registerMailboxRoutes(app, {
    cronSecret: 'cron-secret',
    attachmentSweepTimeoutMs: 15,
    logger: { warn: (...args) => warnings.push(args) },
    coordinator: {
      sweepExpiredAttachments: async () => new Promise(() => {}),
      syncMailboxResponse(_req, res) {
        syncCalled += 1;
        return res.status(200).json({ ok: true });
      },
    },
  });
  const route = routes.find(([method, path]) => method === 'GET' && path === '/api/mailbox/sync');
  const response = createResponseRecorder();
  const startedAt = Date.now();

  await route[2][0]({ headers: { authorization: 'Bearer cron-secret' } }, response, () => (
    route[2][1]({ method: 'GET' }, response)
  ));

  assert.ok(Date.now() - startedAt < 250);
  assert.equal(syncCalled, 1);
  assert.equal(response.statusCode, 200);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], '[MailboxAttachment][CronSweep]');
  assert.match(String(warnings[0][1]), /timeout na 15ms/);
});

test('mailbox cron sweep failure never overwrites the ordinary sync response', async () => {
  const routes = [];
  const warnings = [];
  const app = {
    get(path, ...handlers) { routes.push(['GET', path, handlers]); },
    post() {},
  };
  registerMailboxRoutes(app, {
    cronSecret: 'cron-secret',
    logger: { warn: (...args) => warnings.push(args) },
    coordinator: {
      async sweepExpiredAttachments() { throw new Error('storage down'); },
      syncMailboxResponse(_req, res) {
        return res.status(207).json({ ok: false, partial: true });
      },
    },
  });
  const route = routes.find(([method, path]) => method === 'GET' && path === '/api/mailbox/sync');
  const response = createResponseRecorder();

  await route[2][0]({ headers: { authorization: 'Bearer cron-secret' } }, response, () => (
    route[2][1]({ method: 'GET' }, response)
  ));

  assert.equal(response.statusCode, 207);
  assert.deepEqual(response.body, { ok: false, partial: true });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], '[MailboxAttachment][CronSweep]');
});

test('mailbox service exposes sync response handler for cron and admin routes', async () => {
  const sweepOptions = [];
  const service = createMailboxService({
    mailConfig: {},
    mailboxAttachmentService: {
      async sweepExpiredAttachments(options) {
        sweepOptions.push(options);
        return { batches: 1, removed: 2, timedOut: false };
      },
    },
  });

  assert.equal(typeof service.syncMailboxResponse, 'function');
  assert.equal(typeof service.syncInstantlyMailboxResponse, 'function');
  assert.equal(typeof service.sweepExpiredAttachments, 'function');
  assert.deepEqual(await service.sweepExpiredAttachments({ totalTimeoutMs: 4321 }), {
    batches: 1, removed: 2, timedOut: false,
  });
  assert.deepEqual(sweepOptions, [{ totalTimeoutMs: 4321 }]);

  const response = createResponseRecorder();
  await service.syncMailboxResponse({ query: {}, body: {} }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true, results: [] });
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
        return { ok: false, locked: true };
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

  assert.equal(response.statusCode, 200);
  assert.deepEqual(requestedAccounts, ['serve@softora.nl', 'serve@softora.nl']);
});

test('campaign mailbox sync keeps the shared coldmail folder for STRATO and Gmail accounts', () => {
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
      account: { email: 'servec321@gmail.com', imapHost: 'imap.gmail.com' },
      folders: ['inbox', 'sent'],
      campaignOnly: true,
      incrementalOnly: true,
      normalizeFolder,
    }),
    ['inbox', 'sent', CAMPAIGN_GMAIL_LABEL_FOLDER, CAMPAIGN_GMAIL_ALL_MAIL_FOLDER]
  );
  assert.deepEqual(
    getMailboxSyncFoldersForAccount({
      account: { email: 'serve@softora.nl', imapHost: 'imap.strato.com' },
      folders: ['inbox', 'sent', CAMPAIGN_GMAIL_LABEL_FOLDER, CAMPAIGN_GMAIL_ALL_MAIL_FOLDER],
      campaignOnly: true,
      normalizeFolder,
    }),
    ['inbox', 'sent', CAMPAIGN_GMAIL_LABEL_FOLDER]
  );
});

test('mailbox cron supplements normal folders with campaign inbox recovery and the Gmail label', async () => {
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
        return { ok: false, locked: true, contention: 'active_lock' };
      },
    },
  });
  const response = createResponseRecorder();

  await service.syncMailboxResponse({
    method: 'GET',
    query: {},
    body: {},
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(requestedFolders, [
    'sent',
    'inbox',
    'inbox',
    CAMPAIGN_GMAIL_LABEL_FOLDER,
    CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
  ]);
});

test('incremental Gmail All Mail recovery fetches only exact missing references and then stops', async () => {
  const fetches = [];
  const upserts = [];
  const selected = {
    email: 'martijnven123@gmail.com',
    imapHost: 'imap.gmail.com',
    imapConfigured: true,
  };
  let seeds = [{
    folder: 'inbox',
    accountEmail: selected.email,
    email: 'info@praktijkkaroena.nl',
    messageId: '<known-inbound@example.nl>',
  }, {
    folder: 'sent',
    accountEmail: selected.email,
    email: selected.email,
    to: 'info@praktijkkaroena.nl',
    messageId: '<known-outbound@example.nl>',
    inReplyTo: '<missing-inbound@example.nl>',
  }];
  const service = createMailboxSyncService({
    mailboxIndexStore: {
      acquireSyncLock: async () => ({ ok: true, lockToken: 'allmail-lock' }),
      finishSync: async () => ({ ok: true }),
      listMessageUidsForAccount: async () => [],
      listCampaignSeedMessagesForAccount: async () => seeds,
      upsertMessages: async (input) => { upserts.push(input); return { ok: true, upserted: 0 }; },
    },
    assertReadableAccount: () => selected,
    canUseMailboxIndex: () => true,
    fetchMessagesFromImap: async (input) => { fetches.push(input); return []; },
    getSafeLimit: (value) => Number(value) || 50,
    getAccounts: () => [selected],
    normalizeEmail: (value) => String(value || '').toLowerCase(),
    normalizeFolder: (value) => String(value || '').toLowerCase(),
    logger: { error() {} },
  });

  await service.syncMailboxFolder({
    accountEmail: selected.email,
    folder: CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
    limit: 30,
    campaignOnly: true,
    incrementalOnly: true,
  });

  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].limit, CAMPAIGN_GMAIL_ALL_MAIL_FETCH_LIMIT);
  assert.deepEqual(fetches[0].threadReferenceIds, ['<missing-inbound@example.nl>']);
  assert.deepEqual(fetches[0].threadRecipientTerms, []);
  assert.equal(fetches[0].prioritizeTargetedUids, true);

  seeds = [{ messageId: '<known-only@example.nl>' }];
  await service.syncMailboxFolder({
    accountEmail: selected.email,
    folder: CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
    limit: 30,
    campaignOnly: true,
    incrementalOnly: true,
  });

  assert.equal(fetches.length, 1);
  assert.equal(upserts.length, 2);
  assert.deepEqual(upserts[1].messages, []);
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
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      acquireSyncLock: async () => ({ ok: true, lockToken: 'gmail-label-lock' }),
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

test('campaign mailbox sync imports a STRATO reply from the Coldmail - Delivery folder', async () => {
  const client = createFakeImapClient({
    boxes: [{ path: 'INBOX/Coldmail - Delivery' }],
    messagesByMailbox: {
      'INBOX/Coldmail - Delivery': [{
        uid: 92,
        flags: [],
        internalDate: new Date('2026-08-13T10:00:00.000Z'),
        source: Buffer.from(
          'Message-ID: <strato-filtered-reply@example.nl>\r\n' +
          'In-Reply-To: <softora-outbound@example.nl>\r\n' +
          'Subject: Re: Kleine vraag over jullie website\r\n' +
          'From: Klant <klant@example.nl>\r\n' +
          'To: serve@softora.nl\r\n\r\n' +
          'Neem volgende week contact op.'
        ),
      }],
    },
  });
  const upserts = [];
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl',
      name: 'Servé',
      imapHost: 'imap.strato.com',
      imapUser: 'serve@softora.nl',
      imapPass: 'app-password',
    }]),
    createImapClient: () => client,
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      acquireSyncLock: async () => ({ ok: true, lockToken: 'strato-folder-lock' }),
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
      account: 'serve@softora.nl',
      folder: CAMPAIGN_GMAIL_LABEL_FOLDER,
      campaignOnly: true,
      force: true,
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(client.lockedMailboxes, ['INBOX/Coldmail - Delivery']);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].folder, CAMPAIGN_GMAIL_LABEL_FOLDER);
  assert.equal(upserts[0].messages[0].messageId, '<strato-filtered-reply@example.nl>');
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

  assert.deepEqual(result, { ok: true, results: [] });
  assert.equal(lockCalls, 0);
});

test('campaign Gmail label sync records a failure and succeeds on the next forced retry', async () => {
  let attempts = 0;
  const finished = [];
  const service = createMailboxSyncService({
    mailboxIndexStore: {
      acquireSyncLock: async () => ({ ok: true, lockToken: `lock-${attempts + 1}` }),
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
      return [{ uid: 91, id: 'coldmail:91' }];
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

test('mailbox sync aborts a hanging IMAP operation before its database lease can expire', async () => {
  const calls = [];
  const finished = [];
  let rejectSearch = null;
  const client = {
    usable: true,
    async connect() {
      calls.push('connect');
    },
    async list() {
      return [{ path: 'INBOX' }];
    },
    async getMailboxLock() {
      calls.push('lock');
      return { release: () => calls.push('release') };
    },
    search() {
      calls.push('search');
      return new Promise((_resolve, reject) => {
        rejectSearch = reject;
      });
    },
    close() {
      calls.push('close');
      this.usable = false;
      rejectSearch?.(new Error('connection closed by deadline'));
    },
    async logout() {
      calls.push('logout');
    },
  };
  const service = createMailboxService({
    mailConfig: {},
    runMailboxImapOperationWithDeadline: async ({
      client: deadlineClient,
      operation,
      accountEmail,
      folder,
    }) => {
      const operationPromise = Promise.resolve().then(operation);
      operationPromise.catch(() => null);
      await new Promise((resolve) => setImmediate(resolve));
      const error = new Error(
        `IMAP-operatie timeout na 70000ms voor ${accountEmail} (${folder}).`
      );
      error.code = 'MAILBOX_IMAP_OPERATION_TIMEOUT';
      error.status = 504;
      deadlineClient.close();
      throw error;
    },
    mailboxAccountsRaw: JSON.stringify([{
      email: 'martijnven123@gmail.com',
      name: 'Martijn',
      imapHost: 'imap.gmail.com',
      imapUser: 'martijnven123@gmail.com',
      imapPass: 'app-password',
    }]),
    createImapClient: () => client,
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [],
      acquireSyncLock: async () => ({ ok: true, lockToken: 'deadline-lock' }),
      upsertMessages: async () => {
        throw new Error('timed-out IMAP data mag niet worden opgeslagen');
      },
      finishSync: async (options) => {
        finished.push(options);
        return { ok: true };
      },
    },
    logger: { error() {}, info() {}, warn() {} },
  });
  const response = createResponseRecorder();

  await service.syncMailboxResponse({
    method: 'POST',
    query: {},
    body: {
      account: 'martijnven123@gmail.com',
      folder: 'inbox',
    },
  }, response);

  assert.equal(response.statusCode, 207);
  assert.equal(response.body.ok, false);
  assert.match(response.body.results[0].error, /IMAP-operatie timeout/i);
  assert.deepEqual(calls, ['connect', 'lock', 'search', 'close', 'release']);
  assert.equal(finished.length, 1);
  assert.equal(finished[0].lockToken, 'deadline-lock');
  assert.match(finished[0].error, /IMAP-operatie timeout/i);
});

test('mailbox IMAP deadline absorbs an async close rejection', async () => {
  await assert.doesNotReject(() => closeMailboxClientQuietly({
    close: async () => { throw new Error('Connection not available'); },
  }));
});

test('mailbox cron sync indexes a lightweight sent batch by default', async () => {
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

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.deepEqual(upsertedCounts, [30]);
  assert.equal(response.body.results[0].synced, 30);
});

test('regular mailbox sync reuses and advances the durable UID cursor', async () => {
  const fetches = [];
  const finished = [];
  const selected = {
    email: 'martijnven123@gmail.com',
    imapHost: 'imap.gmail.com',
    imapConfigured: true,
  };
  const service = createMailboxSyncService({
    mailboxIndexStore: {
      acquireSyncLock: async () => ({ ok: true, lockToken: 'incremental-lock' }),
      getSyncState: async () => ({ status: 'ok', last_uid: 118 }),
      upsertMessages: async ({ messages }) => ({ ok: true, upserted: messages.length }),
      finishSync: async (options) => {
        finished.push(options);
        return { ok: true };
      },
    },
    assertReadableAccount: () => selected,
    canUseMailboxIndex: () => true,
    fetchMessagesFromImap: async (options) => {
      fetches.push(options);
      return [{ uid: 120 }, { uid: 119 }];
    },
    getSafeLimit: (value) => Number(value) || 30,
    getAccounts: () => [selected],
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeFolder: (value) => String(value || '').trim().toLowerCase(),
    logger: { error() {} },
  });

  const result = await service.syncMailboxFolder({
    accountEmail: selected.email,
    folder: 'sent',
    limit: 30,
  });

  assert.equal(result.ok, true);
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].lastSyncedUid, 118);
  assert.equal(fetches[0].syncCursorOverlap, 3);
  assert.equal(finished[0].lastUid, 120);
});

test('regular mailbox sync preserves its durable UID cursor when no new mail exists', async () => {
  const finished = [];
  const selected = {
    email: 'martijnven123@gmail.com',
    imapHost: 'imap.gmail.com',
    imapConfigured: true,
  };
  const service = createMailboxSyncService({
    mailboxIndexStore: {
      acquireSyncLock: async () => ({ ok: true, lockToken: 'no-new-mail-lock' }),
      getSyncState: async () => ({ status: 'ok', last_uid: 120 }),
      upsertMessages: async () => ({ ok: true, upserted: 0 }),
      finishSync: async (options) => {
        finished.push(options);
        return { ok: true };
      },
    },
    assertReadableAccount: () => selected,
    canUseMailboxIndex: () => true,
    fetchMessagesFromImap: async () => [],
    getSafeLimit: (value) => Number(value) || 30,
    getAccounts: () => [selected],
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeFolder: (value) => String(value || '').trim().toLowerCase(),
    logger: { error() {} },
  });

  await service.syncMailboxFolder({
    accountEmail: selected.email,
    folder: 'sent',
    limit: 30,
  });

  assert.equal(finished[0].lastUid, 120);
});

test('regular mailbox sync restores a zeroed cursor from the newest indexed UID', async () => {
  const fetches = [];
  const uidLookups = [];
  const selected = {
    email: 'martijnven123@gmail.com',
    imapHost: 'imap.gmail.com',
    imapConfigured: true,
  };
  const service = createMailboxSyncService({
    mailboxIndexStore: {
      acquireSyncLock: async () => ({ ok: true, lockToken: 'cursor-bootstrap-lock' }),
      getSyncState: async () => ({ status: 'error', last_uid: 0 }),
      listMessageUidsForAccount: async (options) => {
        uidLookups.push(options);
        return [806];
      },
      upsertMessages: async () => ({ ok: true, upserted: 0 }),
      finishSync: async () => ({ ok: true }),
    },
    assertReadableAccount: () => selected,
    canUseMailboxIndex: () => true,
    fetchMessagesFromImap: async (options) => {
      fetches.push(options);
      return [];
    },
    getSafeLimit: (value) => Number(value) || 30,
    getAccounts: () => [selected],
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeFolder: (value) => String(value || '').trim().toLowerCase(),
    logger: { error() {} },
  });

  await service.syncMailboxFolder({
    accountEmail: selected.email,
    folder: 'sent',
    limit: 30,
  });

  assert.deepEqual(uidLookups, [{
    accountEmail: selected.email,
    folder: 'sent',
    limit: 1,
  }]);
  assert.equal(fetches[0].lastSyncedUid, 806);
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
      getOldestMatchingMessageUid: async (options) => {
        oldestLookup = options;
        return 91;
      },
      listMessageUidsForAccount: async (options) => {
        assert.equal(options.limit, CAMPAIGN_SYNC_UID_SCAN_LIMIT);
        assert.equal(options.priorityRead, true);
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

  assert.equal(response.statusCode, 200);
  assert.deepEqual(oldestLookup, {
    accountEmail: 'serve290@gmail.com',
    folder: 'sent',
    subjectTerms: ['Kleine vraag over jullie website', 'Nieuw webdesign'],
    priorityRead: true,
  });
  assert.equal(upsertedUids.length, CAMPAIGN_SYNC_FETCH_LIMIT);
  assert.deepEqual(upsertedUids, [118, 117, 90, 89]);
  assert.equal(client.searchQueries.length, 3);
  assert.deepEqual(client.searchQueries[0], { all: true });
  assert.deepEqual(client.searchOptions, [{ uid: true }, { uid: true }, { uid: true }]);
  assert.deepEqual(client.fetchOptions, [
    {
      query: { uid: true, flags: true, internalDate: true, source: true },
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

  assert.equal(response.statusCode, 200);
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
      { header: { 'message-id': indexedInboxMessageId } },
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
