const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  registerPremiumSamenvattenRoutes,
  registerPremiumSamenvattenCleanupRoute,
} = require('../../server/routes/premium-samenvatten');

test('Samenvatten API requires premium access, same-origin writes, and a cron secret for cleanup', async () => {
  const app = express();
  app.use(express.json());
  let starts = 0;
  let sweeps = 0;
  const service = {
    enabled: () => false,
    plan: async () => ({ id: 'test' }),
    start: async () => { starts += 1; return { status: 'processing' }; },
    status: async () => ({ status: 'processing' }),
    recent: async () => ({ job: null }),
    cleanup: async () => { sweeps += 1; return { removed: 0 }; },
  };
  registerPremiumSamenvattenCleanupRoute(app, { service, cronSecret: 'test-cron-secret' });
  app.use('/api', (req, res, next) => {
    if (req.get('x-test-auth') !== 'yes') return res.status(401).json({ ok: false });
    req.premiumAuth = { authenticated: true, userId: 'staff-1' };
    return next();
  });
  registerPremiumSamenvattenRoutes(app, { service });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/api/samenvatten/config`)).status, 401);
    const config = await fetch(`${base}/api/samenvatten/config`, { headers: { 'x-test-auth': 'yes' } });
    assert.equal((await config.json()).enabled, false);
    const badWrite = await fetch(`${base}/api/samenvatten/jobs/test/start`, {
      method: 'POST',
      headers: { 'x-test-auth': 'yes', 'content-type': 'application/json', origin: 'https://evil.example' },
      body: '{}',
    });
    assert.equal(badWrite.status, 403);
    assert.equal(starts, 0);
    assert.equal((await fetch(`${base}/api/samenvatten/cleanup`)).status, 401);
    const cleanup = await fetch(`${base}/api/samenvatten/cleanup`, {
      headers: { authorization: 'Bearer test-cron-secret' },
    });
    assert.equal(cleanup.status, 200);
    assert.equal(sweeps, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
