'use strict';

const appHandler = require('./_app-handler');

const ONE_SHOT_TOKEN = 'nowrap-20260712-7f4c91b2';

module.exports = async function oneShotNowrapMailTest(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (String(req.query && req.query.token || '') !== ONE_SHOT_TOKEN) {
    res.status(404).json({ ok: false });
    return;
  }

  req.method = 'POST';
  req.url = '/api/coldmailing/autopilot/run';
  req.originalUrl = '/api/coldmailing/autopilot/run';
  req.headers = Object.assign({}, req.headers, {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-softora-requested-with': 'one-shot-nowrap-test',
  });
  req.premiumAuth = {
    configured: true,
    authenticated: true,
    isAdmin: true,
    role: 'admin',
    email: 'serve@softora.nl',
    displayName: 'Servé',
  };
  req.body = { force: true };

  return appHandler(req, res);
};
