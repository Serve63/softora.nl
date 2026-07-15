'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ONE_SHOT_TOKEN = 'nowrap-20260712-7f4c91b2';

function loadOneShotAppHandler() {
  const routePath = require.resolve('../server/routes/coldmailing');
  const originalSource = fs.readFileSync(routePath, 'utf8');
  const needle = [
    "    await runColdmailAutopilotFromRoute(req, res, {",
    "      actor: 'Coldmail Autopilot Cron',",
    '      force: false,',
    '    });',
  ].join('\n');
  const replacement = needle.replace('force: false', 'force: true');
  const patchedSource = originalSource.replace(needle, replacement);
  if (patchedSource === originalSource) {
    throw new Error('Eenmalige force-patch kon niet veilig worden toegepast.');
  }

  const patchedModule = new Module(routePath, module);
  patchedModule.filename = routePath;
  patchedModule.paths = Module._nodeModulePaths(path.dirname(routePath));
  patchedModule._compile(patchedSource, routePath);
  require.cache[routePath] = patchedModule;

  return require('./_app-handler');
}

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

  const appHandler = loadOneShotAppHandler();
  req.method = 'GET';
  req.url = '/api/coldmailing/autopilot/run';
  req.originalUrl = '/api/coldmailing/autopilot/run';
  req.headers = Object.assign({}, req.headers, {
    authorization: `Bearer ${cronSecret}`,
    accept: 'application/json',
    'x-softora-requested-with': 'one-shot-nowrap-test',
  });
  req.body = {};

  return appHandler(req, res);
};
