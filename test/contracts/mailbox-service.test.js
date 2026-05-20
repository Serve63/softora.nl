const test = require('node:test');
const assert = require('node:assert/strict');

const { createMailboxService, sanitizeMailboxDisplayText } = require('../../server/services/mailbox');
const { registerMailboxRoutes } = require('../../server/routes/mailbox');

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

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
  const movedMessages = [];
  return {
    usable: true,
    lockedMailboxes: [],
    appendedMessages,
    movedMessages,
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
  assert.equal(sent[0].message.from, 'Servé Creusen <serve@softora.nl>');
  assert.equal(sent[0].message.to, 'klant@example.nl');
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
  assert.equal(messages.length, 1);
  assert.equal(messages[0].subject, 'Verzonden bericht');
  assert.equal(messages[0].from, 'Servé Creusen');
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

test('mailbox service exposes inline cid images for mail display placeholders', async () => {
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
  assert.equal(messages[0].bodyImages.length, 2);
  assert.deepEqual(
    messages[0].bodyImages.map((image) => image.alt),
    ['Softora Testmodus webdesign', 'Softora Testmodus device mockup']
  );
  assert.equal(messages[0].bodyImages[0].dataUrl, 'data:image/png;base64,d2ViZGVzaWduLXBob3Rv');
  assert.equal(messages[0].bodyImages[1].dataUrl, 'data:image/png;base64,ZGV2aWNlLW1vY2t1cC1waG90bw==');
  assert.equal(messages[0].inlineImages.length, 2);
  assert.equal(messages[0].inlineImages[0].alt, 'Softora Testmodus webdesign');
  assert.equal(messages[0].inlineImages[0].contentType, 'image/png');
  assert.equal(messages[0].inlineImages[0].contentBase64, 'd2ViZGVzaWduLXBob3Rv');
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
});

test('mailbox service restores quoted webdesign image placeholders from stored database photos', async () => {
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
    createImapClient: () => client,
    parseMailSource: async (source) => source,
  });

  const messages = await service.listMessages({ accountEmail: 'serve@softora.nl', folder: 'inbox' });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].bodyImages.length, 1);
  assert.equal(messages[0].bodyImages[0].alt, 'Softora Testmodus webdesign');
  assert.equal(messages[0].bodyImages[0].contentType, 'image/png');
  assert.equal(messages[0].bodyImages[0].dataUrl, TINY_PNG_DATA_URL);
  assert.equal(messages[0].inlineImages.length, 1);
  assert.equal(messages[0].inlineImages[0].alt, 'Softora Testmodus webdesign');
  assert.equal(messages[0].inlineImages[0].contentType, 'image/png');
  assert.equal(messages[0].inlineImages[0].contentBase64, TINY_PNG_DATA_URL.split(',')[1]);
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

test('mailbox service recovers sent webdesign images without treating Softora links as customer designs', async () => {
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
    const phoneIndex = messages[0].body.indexOf('0629917185');
    const webdesignIndex = messages[0].body.indexOf('[image: Jaghthuijs webdesign]');
    const captionIndex = messages[0].body.indexOf('Zo zal het design er ongeveer uit gaan zien op mobiel, tablet en laptop');
    const mockupIndex = messages[0].body.indexOf('[image: Jaghthuijs device mockup]');
    const optOutIndex = messages[0].body.indexOf('Geen webdesign willen ontvangen? Laat het me weten!');
    assert.ok(phoneIndex > 0);
    assert.ok(webdesignIndex > phoneIndex);
    assert.ok(captionIndex > webdesignIndex);
    assert.ok(mockupIndex > captionIndex);
    assert.ok(optOutIndex > mockupIndex);
    assert.doesNotMatch(messages[0].body, /\[image: Softora webdesign]/);
    assert.equal(messages[0].bodyImages.length, 2);
    assert.deepEqual(
      messages[0].bodyImages.map((image) => image.alt),
      ['Jaghthuijs webdesign', 'Jaghthuijs device mockup']
    );
    assert.equal(messages[0].bodyImages[0].dataUrl, 'data:image/png;base64,d2ViZGVzaWduLXBob3Rv');
    assert.equal(messages[0].bodyImages[1].dataUrl, 'data:image/png;base64,ZGV2aWNlLW1vY2t1cC1waG90bw==');
    assert.equal(messages[0].optOutUrl, 'https://www.softora.nl/afmelden?t=test');
    assert.deepEqual(fetchedUrls, [photoUrl, mockupUrl]);
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
  });
  const res = createResponseRecorder();

  await service.markMessageReadResponse(
    {
      body: {
        account: 'serve@softora.nl',
        id: 'inbox:42',
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
    unread: false,
  });
  assert.deepEqual(calls, [
    ['connect', 'serve@softora.nl'],
    ['lock', 'INBOX'],
    ['flagsAdd', [42], ['\\Seen'], { uid: true }],
    ['release', 'INBOX'],
    ['logout'],
  ]);
});

test('mailbox service moves deleted messages to the resolved trash folder', async () => {
  const client = createFakeImapClient({
    boxes: [
      { path: 'INBOX' },
      { path: 'INBOX/Prullenbak', specialUse: '\\Trash' },
    ],
    messagesByMailbox: {
      INBOX: [
        {
          uid: 42,
          flags: ['\\Seen'],
          internalDate: new Date('2026-05-20T00:00:00.000Z'),
          source: {},
        },
      ],
      'INBOX/Prullenbak': [],
    },
  });
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
  });
  const res = createResponseRecorder();

  await service.deleteMessageResponse(
    {
      body: {
        account: 'serve@softora.nl',
        id: 'inbox:42',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.result, {
    account: 'serve@softora.nl',
    folder: 'inbox',
    destinationFolder: 'trash',
    uid: 42,
    deleted: true,
    moved: true,
  });
  assert.deepEqual(client.movedMessages, [
    { mailboxName: 'INBOX', uids: [42], destination: 'INBOX/Prullenbak', options: { uid: true } },
  ]);
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
          choices: [{ message: { content: 'Beste klant,\n\nVerbeterde tekst.' } }],
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

  assert.equal(result.text, 'Beste klant,\n\nVerbeterde tekst.');
  assert.equal(result.model, 'gpt-test');
  assert.equal(calls[0].url, 'https://api.openai.test/v1/chat/completions');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer openai-key');
  assert.equal(calls[0].timeout, 65000);
  assert.equal(calls[0].payload.model, 'gpt-test');
  assert.match(calls[0].payload.messages[0].content, /Verzin geen feiten/);
  assert.match(calls[0].payload.messages[0].content, /afzenderProfiel\.aiInstructions/);
  assert.match(calls[0].payload.messages[1].content, /Kan dit voor vrijdag/);
  assert.match(calls[0].payload.messages[1].content, /hoi ik stuur dit ff/);
  assert.match(calls[0].payload.messages[1].content, /Groetjes[\s\S]*Servé/);
  assert.match(calls[0].payload.messages[1].content, /Informeel & persoonlijk/);
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

test('mailbox routes expose accounts, messages, send, delete and rewrite endpoints', () => {
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
      markMessageReadResponse() {},
      deleteMessageResponse() {},
      sendMessageResponse() {},
      rewriteDraftResponse() {},
    },
  });

  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/accounts'));
  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/messages'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/messages/read'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/messages/delete'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/send'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/rewrite'));
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
