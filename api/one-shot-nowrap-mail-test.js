'use strict';

const https = require('node:https');

const ONE_SHOT_TOKEN = 'nowrap-20260712-7f4c91b2';

function readJsonBody(response) {
  return new Promise((resolve, reject) => {
    let raw = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => { raw += chunk; });
    response.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error(`Ongeldige autopilotrespons: ${raw.slice(0, 300)}`));
      }
    });
    response.on('error', reject);
  });
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

  const requestBody = JSON.stringify({ force: true });
  try {
    const payload = await new Promise((resolve, reject) => {
      const internalRequest = https.request({
        hostname: 'www.softora.nl',
        port: 443,
        path: '/api/coldmailing/autopilot/run',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${cronSecret}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
          'User-Agent': 'Softora-One-Shot-Nowrap-Test/1.0',
        },
      }, async (response) => {
        try {
          const result = await readJsonBody(response);
          resolve({ status: response.statusCode || 500, result });
        } catch (error) {
          reject(error);
        }
      });
      internalRequest.on('error', reject);
      internalRequest.write(requestBody);
      internalRequest.end();
    });

    res.status(payload.status >= 200 && payload.status < 300 ? 200 : payload.status).json(payload.result);
  } catch (error) {
    res.status(500).json({ ok: false, message: String(error && error.message || error) });
  }
};
