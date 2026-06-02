const test = require('node:test');
const assert = require('node:assert/strict');

const { createPublicContactService } = require('../../server/services/public-contact');
const { registerPublicContactRoutes } = require('../../server/routes/public-contact');
const { createPublicConversionService } = require('../../server/services/public-conversion');
const { registerPublicConversionRoutes } = require('../../server/routes/public-conversion');

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

test('public conversion service logs sanitized WhatsApp CTA events', () => {
  const logs = [];
  const service = createPublicConversionService({
    logger: { info: (...args) => logs.push(args) },
    now: () => new Date('2026-06-02T10:15:00.000Z'),
  });

  const event = service.recordConversion(
    {
      name: 'public-cta',
      page: '/diensten',
      target: 'WHATSAPP',
      landing: '/diensten?utm=seo',
      referrer: '/blog/website-leadgeneratie',
      path: '/diensten',
      at: '2026-06-02T10:14:59.000Z',
    },
    { ip: '127.0.0.1', userAgent: 'contract-test' }
  );

  assert.equal(event.target, 'whatsapp');
  assert.equal(event.receivedAt, '2026-06-02T10:15:00.000Z');
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], '[PublicConversion][CTA]');
  assert.equal(logs[0][1].page, '/diensten');
  assert.equal(logs[0][1].userAgent, 'contract-test');
});

test('public conversion route exposes anonymous first-party measurement endpoint', () => {
  const routes = [];
  const coordinator = { recordResponse: () => null };
  const app = {
    post(pathname, handler) {
      routes.push(['POST', pathname, handler]);
    },
  };

  registerPublicConversionRoutes(app, { coordinator });

  assert.ok(routes.some(([method, path]) => method === 'POST' && path === '/api/public-conversion'));
  assert.equal(typeof routes[0][2], 'function');
});
