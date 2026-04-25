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
    },
  });

  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/accounts'));
  assert.ok(routes.some(([method, path]) => method === 'GET' && path === '/api/mailbox/messages'));
  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/mailbox/send'));
});
