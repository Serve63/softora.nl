const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createPublicConversionTrackingService,
} = require('../../server/services/public-conversion-tracking');
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

test('public conversion service records sanitized first-party CTA events', () => {
  const activities = [];
  const service = createPublicConversionTrackingService({
    appendDashboardActivity: (payload, reason) => activities.push({ payload, reason }),
    now: () => new Date('2026-05-26T08:15:00.000Z'),
  });

  const result = service.recordConversion({
    event: 'click',
    conversion: 'public-cta',
    page: '/diensten?utm=seo',
    landingPage: '/blog/website-leadgeneratie-mkb-meten',
    target: 'whatsapp',
    href: 'https://wa.me/31643262792',
    label: 'WhatsApp Martijn',
  });

  assert.equal(result.ok, true);
  assert.equal(result.recorded, true);
  assert.equal(result.conversion.page, '/diensten');
  assert.equal(result.conversion.landingPage, '/blog/website-leadgeneratie-mkb-meten');
  assert.equal(result.conversion.measuredAt, '2026-05-26T08:15:00.000Z');
  assert.equal(activities.length, 1);
  assert.equal(activities[0].reason, 'dashboard_activity_public_seo_conversion');
  assert.equal(activities[0].payload.type, 'public_seo_conversion');
  assert.match(activities[0].payload.detail, /whatsapp CTA public-cta op \/diensten/);
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

  assert.ok(routes.some(([method, pathName]) => method === 'POST' && pathName === '/api/public-conversion'));
  assert.equal(typeof routes[0][2], 'function');
});

test('public conversion asset sends clicks and form submits without third-party tracking', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../..', 'assets/public-conversion-tracking.js'),
    'utf8'
  );

  assert.match(source, /navigator\.sendBeacon\(ENDPOINT, blob\)/);
  assert.match(source, /document\.addEventListener\(\s*'click'/);
  assert.match(source, /document\.addEventListener\(\s*'submit'/);
  assert.match(source, /document\.referrer/);
  assert.doesNotMatch(source, /sessionStorage|localStorage/);
  assert.doesNotMatch(source, /googletagmanager|google-analytics|facebook|meta pixel/i);
});
