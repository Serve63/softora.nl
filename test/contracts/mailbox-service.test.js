const test = require('node:test');
const assert = require('node:assert/strict');

const { createMailboxService } = require('../../server/services/mailbox');
const { registerMailboxRoutes } = require('../../server/routes/mailbox');

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function createResponseRecorder() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
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
  assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
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

test('mailbox service can return lightweight mailbox summaries without parsing full mail bodies', async () => {
  let parseCalls = 0;
  let fetchedRange = null;
  let fetchQuery = null;
  let fetchOptions = null;
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
      mailbox: { exists: 20 },
      connect: async () => {},
      list: async () => [{ path: 'INBOX' }],
      getMailboxLock: async () => ({ release() {} }),
      search: async () => {
        throw new Error('Summary mailbox list should not search the whole mailbox.');
      },
      fetch: async function* (range, query, options) {
        fetchedRange = range;
        fetchQuery = query;
        fetchOptions = options;
        yield {
          uid: 1,
          flags: [],
          internalDate: new Date('2026-05-18T10:00:00Z'),
          envelope: {
            date: new Date('2026-05-18T10:00:00Z'),
            from: [{ name: 'Klant', address: 'klant@example.nl' }],
            to: [{ address: 'serve@softora.nl' }],
            subject: 'Snelle lijst',
          },
        };
      },
      logout: async () => {},
    }),
    parseMailSource: async () => {
      parseCalls += 1;
      throw new Error('Summary mailbox list should not parse full sources.');
    },
  });
  const res = createResponseRecorder();

  await service.listMessagesResponse(
    { query: { account: 'serve@softora.nl', folder: 'inbox', limit: '10', summary: '1' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(parseCalls, 0);
  assert.equal(fetchedRange, '11:*');
  assert.deepEqual(fetchQuery, { uid: true, flags: true, internalDate: true, envelope: true });
  assert.deepEqual(fetchOptions, { uid: false });
  assert.equal(res.body.messages[0].from, 'Klant');
  assert.equal(res.body.messages[0].email, 'klant@example.nl');
  assert.equal(res.body.messages[0].subject, 'Snelle lijst');
  assert.equal(res.body.messages[0].body, '');
  assert.deepEqual(res.body.messages[0].links, []);
  assert.deepEqual(res.body.messages[0].inlineImages, []);
});

test('mailbox service uses fresh UID windows for pull-to-refresh inbox summaries', async () => {
  let fetchedRange = null;
  let fetchOptions = null;
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
      mailbox: { exists: 900, uidNext: 1001 },
      connect: async () => {},
      list: async () => [{ path: 'INBOX' }],
      getMailboxLock: async () => ({ release() {} }),
      fetch: async function* (range, _query, options) {
        fetchedRange = range;
        fetchOptions = options;
        yield {
          uid: 980,
          flags: [],
          internalDate: new Date('2026-05-19T10:00:00Z'),
          envelope: {
            date: new Date('2026-05-19T10:00:00Z'),
            from: [{ name: 'Oude klant', address: 'oud@example.nl' }],
            to: [{ address: 'serve@softora.nl' }],
            subject: 'Oude mail',
          },
        };
        yield {
          uid: 1000,
          flags: [],
          internalDate: new Date('2026-05-20T00:54:00Z'),
          envelope: {
            date: new Date('2026-05-20T00:54:00Z'),
            from: [{ name: 'Servé test', address: 'servec321@gmail.com' }],
            to: [{ address: 'serve@softora.nl' }],
            subject: 'Testmail',
          },
        };
      },
      logout: async () => {},
    }),
  });
  const res = createResponseRecorder();

  await service.listMessagesResponse(
    { query: { account: 'serve@softora.nl', folder: 'inbox', limit: '25', summary: '1', fresh: '1' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
  assert.equal(fetchedRange, '901:*');
  assert.deepEqual(fetchOptions, { uid: true });
  assert.deepEqual(res.body.messages.map((message) => message.uid), [1000, 980]);
  assert.equal(res.body.messages[0].email, 'servec321@gmail.com');
});

test('mailbox service can fetch a single full message by uid for the reader', async () => {
  let fetchedRange = null;
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
      getMailboxLock: async () => ({ release() {} }),
      search: async () => {
        throw new Error('UID detail fetch should not search the full mailbox.');
      },
      fetch: async function* (range) {
        fetchedRange = range;
        yield {
          uid: 42,
          flags: [],
          internalDate: new Date('2026-05-18T10:00:00Z'),
          source: {
            date: new Date('2026-05-18T10:00:00Z'),
            from: { value: [{ name: 'Klant', address: 'klant@example.nl' }] },
            to: { value: [{ address: 'serve@softora.nl' }] },
            subject: 'Volledige mail',
            text: 'Dit is de volledige mail.',
          },
        };
      },
      logout: async () => {},
    }),
    parseMailSource: async (source) => source,
  });
  const res = createResponseRecorder();

  await service.listMessagesResponse(
    { query: { account: 'serve@softora.nl', folder: 'inbox', uid: '42', limit: '1' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(fetchedRange, { uid: 42 });
  assert.equal(res.body.messages[0].uid, 42);
  assert.equal(res.body.messages[0].body, 'Dit is de volledige mail.');
});

test('mailbox service never returns a different message for a requested uid', async () => {
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
      getMailboxLock: async () => ({ release() {} }),
      fetch: async function* () {
        yield {
          uid: 99,
          flags: [],
          internalDate: new Date('2026-05-20T10:00:00Z'),
          source: {
            date: new Date('2026-05-20T10:00:00Z'),
            from: { value: [{ name: 'Tester', address: 'tester@example.nl' }] },
            to: { value: [{ address: 'serve@softora.nl' }] },
            subject: 'Verkeerde testmail',
            text: 'Deze mail mag niet getoond worden voor uid 42.',
          },
        };
      },
      logout: async () => {},
    }),
    parseMailSource: async (source) => source,
  });
  const res = createResponseRecorder();

  await service.listMessagesResponse(
    { query: { account: 'serve@softora.nl', folder: 'inbox', uid: '42', limit: '1' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.messages, []);
});

test('mailbox service marks an opened message as seen in IMAP', async () => {
  let openedMailbox = '';
  let markedRange = null;
  let markedFlags = null;
  let markedOptions = null;
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
        openedMailbox = mailboxName;
        return { release() {} };
      },
      messageFlagsAdd: async (range, flags, options) => {
        markedRange = range;
        markedFlags = flags;
        markedOptions = options;
      },
      logout: async () => {},
    }),
  });
  const res = createResponseRecorder();

  await service.markMessageReadResponse(
    { body: { account: 'serve@softora.nl', folder: 'inbox', uid: 42 } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
  assert.equal(openedMailbox, 'INBOX');
  assert.deepEqual(markedRange, { uid: 42 });
  assert.deepEqual(markedFlags, ['\\Seen']);
  assert.deepEqual(markedOptions, { uid: true });
  assert.equal(res.body.ok, true);
  assert.equal(res.body.uid, 42);
  assert.equal(res.body.unread, false);
});

test('mailbox service exposes inline mail images and html links for the iOS mailbox reader', async () => {
  const imageContent = Buffer.from('fake-image-bytes');
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
      getMailboxLock: async () => ({ release() {} }),
      search: async () => [1],
      fetch: async function* () {
        yield {
          uid: 1,
          flags: [],
          internalDate: new Date('2026-05-18T10:00:00Z'),
          source: {
            date: new Date('2026-05-18T10:00:00Z'),
            from: { value: [{ name: 'Klant', address: 'klant@example.nl' }] },
            to: { value: [{ address: 'serve@softora.nl' }] },
            subject: 'Webdesign',
            text: 'Ziet er goed uit.\n[image: Softora Testmodus webdesign]\nGeen webdesign willen ontvangen? Laat het me weten!',
            html: [
              '<p>Ziet er goed uit.</p>',
              '<img src="cid:webdesign-1@softora" alt="Softora Testmodus webdesign">',
              '<p><a href="https://softora.nl/geen-webdesign">Geen webdesign willen ontvangen?</a> Laat het me weten!</p>',
            ].join(''),
            attachments: [
              {
                cid: 'webdesign-1@softora',
                filename: 'Softora Testmodus webdesign.png',
                contentType: 'image/png',
                content: imageContent,
              },
            ],
          },
        };
      },
      logout: async () => {},
    }),
    parseMailSource: async (source) => source,
  });
  const res = createResponseRecorder();

  await service.listMessagesResponse(
    { query: { account: 'serve@softora.nl', folder: 'inbox', limit: '10' } },
    res
  );

  assert.equal(res.statusCode, 200);
  const message = res.body.messages[0];
  assert.equal(message.inlineImages.length, 1);
  assert.equal(message.inlineImages[0].alt, 'Softora Testmodus webdesign');
  assert.equal(message.inlineImages[0].contentType, 'image/png');
  assert.equal(message.inlineImages[0].contentBase64, imageContent.toString('base64'));
  assert.deepEqual(message.links, [
    {
      label: 'Geen webdesign willen ontvangen?',
      href: 'https://softora.nl/geen-webdesign',
    },
  ]);
});

test('mailbox service restores quoted webdesign image placeholders from stored database photos', async () => {
  const photoKey = 'softora_database_photo_data_v1_softora_testmodus';
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
    createImapClient: () => ({
      usable: true,
      connect: async () => {},
      list: async () => [{ path: 'INBOX' }],
      getMailboxLock: async () => ({ release() {} }),
      search: async () => [1],
      fetch: async function* () {
        yield {
          uid: 1,
          flags: [],
          internalDate: new Date('2026-05-18T10:00:00Z'),
          source: {
            date: new Date('2026-05-18T10:00:00Z'),
            from: { value: [{ name: 'Klant', address: 'klant@example.nl' }] },
            to: { value: [{ address: 'serve@softora.nl' }] },
            subject: 'Webdesign',
            text: [
              'Ziet er goed uit.',
              '[image: Softora Testmodus webdesign]',
              'Geen webdesign willen ontvangen? Laat het me weten!',
            ].join('\n'),
            html: '',
            attachments: [],
          },
        };
      },
      logout: async () => {},
    }),
    parseMailSource: async (source) => source,
  });
  const res = createResponseRecorder();

  await service.listMessagesResponse(
    { query: { account: 'serve@softora.nl', folder: 'inbox', limit: '10' } },
    res
  );

  assert.equal(res.statusCode, 200);
  const message = res.body.messages[0];
  assert.equal(message.inlineImages.length, 1);
  assert.equal(message.inlineImages[0].alt, 'Softora Testmodus webdesign');
  assert.equal(message.inlineImages[0].contentType, 'image/png');
  assert.equal(message.inlineImages[0].contentBase64, TINY_PNG_DATA_URL.split(',')[1]);
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
      markMessageReadResponse() {},
      sendMessageResponse() {},
      improveDraftResponse() {},
    },
  });

  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/accounts'));
  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/messages'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/messages/read'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/send'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/improve-draft'));
});
