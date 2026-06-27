const test = require('node:test');
const assert = require('node:assert/strict');

const { registerPublicConversionRoutes } = require('../../server/routes/public-conversion');
const { createPublicConversionService } = require('../../server/services/public-conversion');

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

test('public conversion service records sanitized WhatsApp CTA events', () => {
  const logs = [];
  const service = createPublicConversionService({
    logger: { info: (...args) => logs.push(args) },
    now: () => new Date('2026-06-22T06:00:00.000Z'),
  });

  const event = service.recordConversion(
    {
      name: 'content-contact',
      page: '/blog/ai-automatisering',
      target: 'whatsapp',
      landing: '/blog',
      referrer: '/diensten\r\nx-test: nope',
      path: '/blog/ai-automatisering',
      at: '2026-06-22T05:59:00.000Z',
    },
    { ip: '127.0.0.1', userAgent: 'contract-test' }
  );

  assert.equal(event.receivedAt, '2026-06-22T06:00:00.000Z');
  assert.equal(event.referrer, '/diensten  x-test: nope');
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], '[PublicConversion][CTA]');
  assert.equal(logs[0][1].target, 'whatsapp');
  assert.equal(logs[0][1].ip, '127.0.0.1');
});

test('public conversion route validates anonymous payloads server-side', () => {
  const service = createPublicConversionService({
    logger: { info: () => null },
  });
  const invalid = createResponseRecorder();
  const valid = createResponseRecorder();

  service.recordResponse({ body: { name: '', page: '/contact', target: 'email' }, headers: {} }, invalid);
  service.recordResponse(
    {
      body: { name: 'public-cta', page: '/contact', target: 'whatsapp' },
      headers: { 'user-agent': 'contract-test' },
      ip: '127.0.0.1',
    },
    valid
  );

  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.ok, false);
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
});

test('public conversion route exposes the measurement endpoint', () => {
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
