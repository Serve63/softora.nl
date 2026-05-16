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
  for (const email of [
    'info@softora.nl',
    'zakelijk@softora.nl',
    'ruben@softora.nl',
    'serve@softora.nl',
    'martijn@softora.nl',
  ]) {
    assert.ok(
      res.body.accounts.some((account) => account.email === email),
      `Mailbox account ${email} should be available to the web and iOS mailbox.`
    );
  }
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

test('mailbox service improves a reply draft with mail context through OpenAI', async () => {
  const fetchCalls = [];
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Servé',
        smtpHost: 'smtp.example.test',
        smtpUser: 'serve@softora.nl',
        smtpPass: 'secret',
      },
    ]),
    getOpenAiApiKey: () => 'openai-key',
    openAiApiBaseUrl: 'https://api.openai.test/v1',
    mailboxDraftModel: 'gpt-5.5-pro',
    fetchJsonWithTimeout: async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        response: { ok: true },
        data: {
          model: 'gpt-5.5-pro',
          choices: [{ message: { content: 'Beste klant,\n\nDank voor uw bericht. Ik kom hier vandaag op terug.\n\nMet vriendelijke groet,\nServé' } }],
        },
      };
    },
    extractOpenAiTextContent: (content) => String(content || ''),
  });
  const res = createResponseRecorder();

  await service.improveDraftResponse(
    {
      body: {
        account: 'serve@softora.nl',
        to: 'klant@example.nl',
        subject: 'Re: Vraag',
        body: 'ik kom erop terug',
        context: {
          from: 'Klant',
          fromEmail: 'klant@example.nl',
          subject: 'Vraag',
          body: 'Kunnen jullie helpen met bedrijfssoftware?',
        },
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.match(res.body.draft, /Beste klant/);
  assert.equal(fetchCalls[0].url, 'https://api.openai.test/v1/chat/completions');
  const requestBody = JSON.parse(fetchCalls[0].options.body);
  assert.equal(requestBody.model, 'gpt-5.5-pro');
  assert.match(requestBody.messages[0].content, /Verbeter de conceptmail/);
  assert.match(requestBody.messages[1].content, /Kunnen jullie helpen met bedrijfssoftware/);
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

test('mailbox service filters belangrijk from flagged inbox messages', async () => {
  const openedMailboxes = [];
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        imapHost: 'imap.example.test',
        imapUser: 'serve@softora.nl',
        imapPass: 'secret',
      },
    ]),
    createImapClient: () => ({
      usable: true,
      connect: async () => {},
      list: async () => [{ path: 'INBOX' }],
      getMailboxLock: async (mailboxName) => {
        openedMailboxes.push(mailboxName);
        return { release() {} };
      },
      search: async () => [1, 2],
      fetch: async function* (uids) {
        for (const uid of uids) {
          yield {
            uid,
            flags: uid === 2 ? ['\\Flagged'] : [],
            internalDate: new Date(`2026-05-0${uid}T10:00:00Z`),
            source: {
              date: new Date(`2026-05-0${uid}T10:00:00Z`),
              from: { value: [{ name: `Klant ${uid}`, address: `klant${uid}@example.nl` }] },
              to: { value: [{ address: 'serve@softora.nl' }] },
              subject: `Mail ${uid}`,
              text: `Bericht ${uid}`,
            },
          };
        }
      },
      logout: async () => {},
    }),
    parseMailSource: async (source) => source,
  });
  const res = createResponseRecorder();

  await service.listMessagesResponse(
    { query: { account: 'serve@softora.nl', folder: 'starred', limit: '10' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(openedMailboxes[0], 'INBOX');
  assert.deepEqual(res.body.messages.map((message) => message.uid), [2]);
  assert.equal(res.body.messages[0].folder, 'starred');
});

test('mailbox service returns empty reclame folder when no matching mailbox exists', async () => {
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        imapHost: 'imap.example.test',
        imapUser: 'serve@softora.nl',
        imapPass: 'secret',
      },
    ]),
    createImapClient: () => ({
      usable: true,
      connect: async () => {},
      list: async () => [{ path: 'INBOX' }],
      getMailboxLock: async () => {
        throw new Error('Promotions folder should not be opened when it is missing.');
      },
      search: async () => [],
      logout: async () => {},
    }),
  });
  const res = createResponseRecorder();

  await service.listMessagesResponse(
    { query: { account: 'serve@softora.nl', folder: 'promotions', limit: '10' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.messages, []);
});

test('mailbox routes expose accounts, messages and send endpoints', () => {
  const routes = [];
  const app = {
    get(path, handler) {
      routes.push(['GET', path, handler]);
    },
    post(path, handler) {
      routes.push(['POST', path, handler]);
    },
  };

  registerMailboxRoutes(app, {
    coordinator: {
      accountsResponse() {},
      listMessagesResponse() {},
      sendMessageResponse() {},
      improveDraftResponse() {},
    },
  });

  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/accounts'));
  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/messages'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/send'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/improve-draft'));
});
