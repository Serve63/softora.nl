const test = require('node:test');
const assert = require('node:assert/strict');

const { createMailboxService } = require('../../server/services/mailbox');
const { registerMailboxRoutes } = require('../../server/routes/mailbox');

function createResponseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createFakeImapClient({ boxes = [], messagesByMailbox = {} }) {
  let activeMailbox = '';
  const appendedMessages = [];
  return {
    usable: true,
    lockedMailboxes: [],
    appendedMessages,
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
    async search() {
      return (messagesByMailbox[activeMailbox] || []).map((message) => message.uid);
    },
    fetch(uids) {
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
    async logout() {
      this.usable = false;
    },
  };
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
  assert.equal(sent[0].message.from, 'Serve <serve@softora.nl>');
  assert.equal(sent[0].message.to, 'klant@example.nl');
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

test('mailbox service returns indexed mailbox rows before touching IMAP', async () => {
  let imapTouched = false;
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
    createImapClient: () => {
      imapTouched = true;
      return createFakeImapClient({ messagesByMailbox: { INBOX: [] } });
    },
    mailboxIndexStore: {
      isAvailable: () => true,
      listMessages: async () => [
        {
          id: 'inbox:99',
          uid: 99,
          folder: 'inbox',
          from: 'Klant',
          email: 'klant@example.nl',
          subject: 'Snelle index',
          preview: 'Direct uit Supabase',
          date: '2026-05-20T10:00:00.000Z',
          unread: true,
          starred: false,
          hasBody: true,
          indexed: true,
        },
      ],
      getSyncState: async () => ({
        status: 'ok',
        last_synced_at: '2026-05-20T09:55:00.000Z',
      }),
      isSyncStateStale: () => true,
    },
  });
  const res = createResponseRecorder();

  await service.listMessagesResponse(
    { query: { account: 'serve@softora.nl', folder: 'inbox', limit: '50' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.messages[0].subject, 'Snelle index');
  assert.equal(res.body.sync.indexed, true);
  assert.equal(res.body.sync.refreshRecommended, true);
  assert.equal(imapTouched, false);
});

test('mailbox service seeds the index and falls back to live IMAP when the index is unavailable', async () => {
  const sentDate = new Date('2026-05-12T11:15:00.000Z');
  const client = createFakeImapClient({
    boxes: [{ path: 'INBOX' }],
    messagesByMailbox: {
      INBOX: [
        {
          uid: 9,
          flags: ['\\Seen'],
          internalDate: sentDate,
          source: {
            date: sentDate,
            text: 'Live body',
            subject: 'Live fallback',
            from: { value: [{ name: 'Klant', address: 'klant@example.nl' }] },
            to: { value: [{ name: 'Serve', address: 'serve@softora.nl' }] },
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
    mailboxIndexStore: {
      isAvailable: () => false,
    },
  });

  const messages = await service.listMessages({ accountEmail: 'serve@softora.nl', folder: 'inbox' });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].subject, 'Live fallback');
  assert.deepEqual(client.lockedMailboxes, ['INBOX']);
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

test('mailbox routes expose accounts, messages and send endpoints', () => {
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
      listMessagesResponse() {},
      sendMessageResponse() {},
    },
  });

  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/accounts'));
  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/messages'));
  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/message'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/sync'));
  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/sync'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/send'));
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
