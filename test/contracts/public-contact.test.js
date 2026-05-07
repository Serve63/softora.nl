const test = require('node:test');
const assert = require('node:assert/strict');

const { createPublicContactService } = require('../../server/services/public-contact');
const { registerPublicContactRoutes } = require('../../server/routes/public-contact');

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

test('public contact service validates required website form fields', async () => {
  const service = createPublicContactService({
    logger: { error: () => null },
  });
  const res = createResponseRecorder();

  await service.submitResponse(
    {
      body: {
        name: '',
        email: 'geen-email',
        message: '',
      },
      headers: {},
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /naam/i);
});

test('public contact service sends website contact requests through server-side smtp', async () => {
  const sent = [];
  const service = createPublicContactService({
    contactToEmail: 'info@softora.nl',
    mailConfig: {
      smtpHost: 'smtp.example.test',
      smtpPort: 465,
      smtpSecure: true,
      smtpUser: 'info@softora.nl',
      smtpPass: 'secret',
      mailFromAddress: 'info@softora.nl',
      mailFromName: 'Softora',
    },
    now: () => new Date('2026-05-07T12:00:00.000Z'),
    createTransport: (config) => ({
      sendMail: async (message) => {
        sent.push({ config, message });
        return { messageId: 'contact-1', accepted: [message.to], rejected: [] };
      },
    }),
  });

  const result = await service.sendContactRequest(
    {
      name: 'Test Klant',
      email: 'klant@example.nl',
      phone: '+31 6 12345678',
      message: 'Ik wil graag meer informatie over een website.',
      page: '/premium-website',
    },
    { ip: '127.0.0.1' }
  );

  assert.equal(result.messageId, 'contact-1');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].config.host, 'smtp.example.test');
  assert.equal(sent[0].config.auth.user, 'info@softora.nl');
  assert.equal(sent[0].message.from, 'Softora <info@softora.nl>');
  assert.equal(sent[0].message.to, 'info@softora.nl');
  assert.equal(sent[0].message.replyTo, 'klant@example.nl');
  assert.match(sent[0].message.subject, /Nieuwe contactaanvraag via Softora\.nl/);
  assert.match(sent[0].message.text, /Naam: Test Klant/);
  assert.match(sent[0].message.text, /Telefoonnummer: \+31 6 12345678/);
  assert.match(sent[0].message.text, /Pagina: \/premium-website/);
  assert.match(sent[0].message.html, /Ik wil graag meer informatie/);
});

test('public contact route exposes the contact endpoint', () => {
  const routes = [];
  const coordinator = { submitResponse: () => null };
  const app = {
    post(pathname, handler) {
      routes.push(['POST', pathname, handler]);
    },
  };

  registerPublicContactRoutes(app, { coordinator });

  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/public-contact'));
  assert.equal(typeof routes[0][2], 'function');
});
