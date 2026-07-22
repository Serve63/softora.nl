const test = require('node:test');
const assert = require('node:assert/strict');

const { createMailboxService, sanitizeMailboxDisplayText } = require('../../server/services/mailbox');
const { registerMailboxRoutes } = require('../../server/routes/mailbox');

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

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

test('mailbox service fails webdesign sends when central guard confirm updates no rows after SMTP accept', async () => {
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
      assert.equal(error.code, 'MAILBOX_WEBDESIGN_OUTBOUND_GUARD_CONFIRM_FAILED');
      assert.equal(error.status, 502);
      assert.match(error.message, /bevestigde geen bestaande reservering/);
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
  assert.equal(messages[0].bodyImages.length, 1);
  assert.equal(messages[0].bodyImages[0].alt, 'Softora Testmodus webdesign');
  assert.equal(messages[0].bodyImages[0].contentType, 'image/png');
  assert.equal(messages[0].bodyImages[0].dataUrl, TINY_PNG_DATA_URL);
  assert.equal(messages[0].inlineImages.length, 1);
  assert.equal(messages[0].inlineImages[0].alt, 'Softora Testmodus webdesign');
  assert.equal(messages[0].inlineImages[0].contentType, 'image/png');
  assert.equal(messages[0].inlineImages[0].contentBase64, TINY_PNG_DATA_URL.split(',')[1]);
});

test('mailbox service restores webdesign photos when an indexed reply is opened', async () => {
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
  assert.deepEqual(
    message.bodyImages.map((image) => image.alt),
    ['De Vyldre webdesign', 'De Vyldre device mockup']
  );
  assert.match(message.body, /\[image: De Vyldre webdesign\]/);
  assert.match(message.body, /\[image: De Vyldre device mockup\]/);
  assert.equal(message.inlineImages.length, 2);
});

test('mailbox service prioritizes the matched recipient design over stale indexed image labels', async () => {
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

  assert.deepEqual(requestedCustomerIds, [customerId]);
  assert.deepEqual(
    message.bodyImages.map((image) => image.alt),
    ['nicolevintagefashion.com-preview', 'nicolevintagefashion.com-preview-device-mockup']
  );
  assert.equal(message.bodyImages.some((image) => /dejavu/i.test(image.alt)), false);
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
  assert.deepEqual(requestedScopes, []);
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
    const captionIndex = messages[0].body.indexOf('Hieronder zie je een korte indruk van de eerste versie op verschillende schermen.');
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
    ['indexRead', { accountEmail: 'serve@softora.nl', id: 'inbox:42', folder: 'inbox', uid: 42 }],
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

  assert.equal(result.text, 'Beste klant,\n\nVerbeterde tekst.\n\nMet vriendelijke groet,\nServé Creusen');
  assert.equal(result.model, 'gpt-test');
  assert.equal(calls[0].url, 'https://api.openai.test/v1/chat/completions');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer openai-key');
  assert.equal(calls[0].options.headers['OpenAI-Organization'], 'org_softora');
  assert.equal(calls[0].options.headers['OpenAI-Project'], 'proj_softora');
  assert.equal(calls[0].timeout, 65000);
  assert.equal(calls[0].payload.model, 'gpt-test');
  assert.match(calls[0].payload.messages[0].content, /Verzin geen feiten/);
  assert.match(calls[0].payload.messages[0].content, /Je bent Malik Mailing/);
  assert.match(calls[0].payload.messages[0].content, /Schrijf namens Servé Creusen/);
  assert.match(calls[0].payload.messages[0].content, /exact één keer 😁/);
  assert.match(calls[0].payload.messages[0].content, /nooit met jullie/);
  assert.match(calls[0].payload.messages[0].content, /zonder nieuwe verkooppoging/);
  assert.match(calls[0].payload.messages[0].content, /Met vriendelijke groet,[\s\S]*Servé Creusen/);
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

  assert.match(result.text, /Martijn van de Ven/);
  assert.match(calls[0].messages[0].content, /Schrijf zelfstandig de best passende reactie/);
  assert.match(calls[0].messages[0].content, /Schrijf namens Martijn van de Ven/);
  assert.match(calls[0].messages[0].content, /Je bent Malik Mailing/);
  assert.match(calls[0].messages[0].content, /verzin geen prijs/i);
  assert.match(calls[0].messages[1].content, /stuur de online preview maar door/);
  assert.match(calls[0].messages[1].content, /"conceptAntwoord":""/);
  assert.match(calls[0].messages[1].content, /"aanhefNaam":"Lisa"/);
  assert.doesNotMatch(calls[0].messages[1].content, /afzenderProfiel/);
});

test('mailbox service laat replycontext de afzender bepalen en corrigeert een verkeerde AI-signatuur', async () => {
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

  assert.match(calls[0].messages[0].content, /Schrijf namens Martijn van de Ven/);
  assert.match(calls[0].messages[1].content, /"accountEmail":"martijn@softora.nl"/);
  assert.match(calls[0].messages[1].content, /"naam":"Martijn van de Ven"/);
  assert.equal(result.text, 'Hoi,\n\nDankjewel voor je reactie 😁\n\nMet vriendelijke groet,\nMartijn van de Ven');
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
  assert.equal(res.body.messages.length, 2);
  assert.equal(res.body.messages[0].id, 'inbox:42');
  assert.equal(res.body.messages[0].accountEmail, 'serve@softora.nl');
  assert.equal(res.body.messages[0].campaign.company, 'Studio Noord');
  assert.equal(res.body.messages[0].campaign.actionRequired, true);
  assert.equal(res.body.messages[0].outreach.customerId, 'softora-pending');
  assert.equal(res.body.messages[0].body, 'Volledige inhoud voor inbox:42');
  assert.equal(res.body.messages[1].campaign.actionRequired, false);
  assert.equal(res.body.messages[1].outreach, null);
  assert.equal(res.body.sync.source, 'campaign-replies-index');
  assert.deepEqual(customerLookup.emails.sort(), [
    'contact@dekroon.nl',
    'info@studionoord.nl',
    'klant@example.nl',
    'lead@example.nl',
  ]);
  assert.equal(customerLookup.bypassReadFailureCooldown, true);
  assert.deepEqual(hydratedReplyIds, ['inbox:42', 'inbox:77']);
  assert.equal(snapshotWrite.scope, 'premium_mailbox_campaign_snapshot');
  assert.equal(snapshotWrite.meta.source, 'mailbox-campaign-replies');
  const persistedSnapshot = JSON.parse(
    snapshotWrite.values.softora_mailbox_campaign_snapshot_v1
  );
  assert.equal(persistedSnapshot.messages[0].from, 'Studio Noord');
  assert.equal(persistedSnapshot.messages[0].body, 'Volledige inhoud voor inbox:42');
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
      campaignRepliesResponse() {},
      listMessagesResponse() {},
      markMessageReadResponse() {},
      deleteMessageResponse() {},
      sendMessageResponse() {},
      rewriteDraftResponse() {},
    },
  });

  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/accounts'));
  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/campaign-replies'));
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

test('mailbox service exposes sync response handler for cron and admin routes', async () => {
  const service = createMailboxService({ mailConfig: {} });

  assert.equal(typeof service.syncMailboxResponse, 'function');

  const response = createResponseRecorder();
  await service.syncMailboxResponse({ query: {}, body: {} }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true, results: [] });
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
