'use strict';

const appHandler = require('./_app-handler');

const ONE_SHOT_TOKEN = 'nowrap-20260712-7f4c91b2';

module.exports = async function oneShotNowrapMailTest(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (String(req.query && req.query.token || '') !== ONE_SHOT_TOKEN) {
    res.status(404).json({ ok: false });
    return;
  }

  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  if (!cronSecret) {
    res.status(503).json({ ok: false, message: 'CRON_SECRET ontbreekt.' });
    return;
  }

  req.method = 'GET';
  req.url = '/api/coldmailing/autopilot/run';
  req.originalUrl = '/api/coldmailing/autopilot/run';
  req.headers = Object.assign({}, req.headers, {
    authorization: `Bearer ${cronSecret}`,
    accept: 'application/json',
    'x-softora-requested-with': 'one-shot-nowrap-test',
  });
  req.body = { force: true };

  return appHandler(req, res);
};
