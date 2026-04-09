const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createHtmlPageCoordinator } = require('../../server/services/html-pages');

function createResponseRecorder() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    sendFilePath: null,
    sendFileCallback: null,
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    sendFile(filePath, callback) {
      this.sendFilePath = filePath;
      this.sendFileCallback = callback;
      if (typeof callback === 'function') callback(null);
      return this;
    },
  };
}

function createFixture() {
  const pagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'softora-html-pages-'));
  const knownFiles = new Set(['premium-website.html', 'premium-personeel-login.html', 'premium-personeel-agenda.html']);
  const loggerCalls = [];
  const coordinator = createHtmlPageCoordinator({
    pagesDir,
    logger: {
      error: (...args) => loggerCalls.push(args),
    },
    sanitizeKnownHtmlFileName: (value) => {
      const fileName = String(value || '').trim();
      return knownFiles.has(fileName) ? fileName : '';
    },
    normalizeString: (value) => String(value || '').trim(),
    knownPrettyPageSlugToFile: new Map([
      ['premium-personeel-login', 'premium-personeel-login.html'],
      ['premium-personeel-agenda', 'premium-personeel-agenda.html'],
    ]),
    resolvePremiumHtmlPageAccess: async () => ({
      handled: false,
      isLoginPage: false,
      isProtectedPremiumPage: false,
    }),
    getSeoConfigCached: async () => ({
      pages: {
        'premium-website.html': {
          title: 'Softora | SEO Test',
        },
      },
    }),
    applySeoOverridesToHtml: (fileName, html, config) => {
      if (fileName === 'premium-website.html' && config.pages[fileName]?.title) {
        return String(html || '').replace(/<title>.*?<\/title>/i, `<title>${config.pages[fileName].title}</title>`);
      }
      return String(html || '');
    },
    getPageBootstrapData: async (_req, fileName) => {
      if (fileName !== 'premium-personeel-agenda.html') return null;
      return {
        marker: 'SOFTORA_AGENDA_BOOTSTRAP',
        scriptId: 'softoraAgendaBootstrap',
        htmlReplacements: {
          SOFTORA_AGENDA_STATUS: '<div class="status">Klaar</div>',
        },
        data: {
          appointments: [{ id: 11, company: 'Softora', date: '2026-04-08', time: '14:00' }],
        },
      };
    },
  });

  return {
    coordinator,
    loggerCalls,
    pagesDir,
  };
}

test('html page coordinator resolves known html files from direct names and slugs', () => {
  const { coordinator } = createFixture();

  assert.equal(
    coordinator.resolveSeoPageFileFromRequest('premium-personeel-login.html', ''),
    'premium-personeel-login.html'
  );
  assert.equal(
    coordinator.resolveSeoPageFileFromRequest('', 'premium-personeel-agenda'),
    'premium-personeel-agenda.html'
  );
  assert.equal(coordinator.resolveSeoPageFileFromRequest('', '../etc/passwd'), '');
});

test('html page coordinator reads known html files and returns empty content for missing files', async () => {
  const { coordinator, pagesDir } = createFixture();
  const pagePath = path.join(pagesDir, 'premium-website.html');
  fs.writeFileSync(pagePath, '<!DOCTYPE html><html><head><title>Orig</title></head><body></body></html>');

  const html = await coordinator.readHtmlPageContent('premium-website.html');
  const missing = await coordinator.readHtmlPageContent('premium-personeel-login.html');

  assert.match(html, /<!DOCTYPE html>/i);
  assert.equal(missing, '');
});

test('html page coordinator renders SEO-managed html and respects handled premium access', async () => {
  const handledCoordinator = createHtmlPageCoordinator({
    pagesDir: process.cwd(),
    sanitizeKnownHtmlFileName: (value) => String(value || '').trim(),
    normalizeString: (value) => String(value || '').trim(),
    knownPrettyPageSlugToFile: new Map(),
    resolvePremiumHtmlPageAccess: async () => ({
      handled: true,
      isLoginPage: true,
      isProtectedPremiumPage: false,
    }),
    getSeoConfigCached: async () => ({}),
    applySeoOverridesToHtml: (fileName, html) => `${fileName}:${html}`,
  });
  const handledReq = { originalUrl: '/premium-personeel-login' };
  const handledRes = createResponseRecorder();
  let handledNextCalled = false;

  await handledCoordinator.sendSeoManagedHtmlPageResponse(
    handledReq,
    handledRes,
    () => {
      handledNextCalled = true;
    },
    'premium-personeel-login.html'
  );

  assert.equal(handledRes.body, null);
  assert.equal(handledNextCalled, false);

  const { coordinator, pagesDir } = createFixture();
  fs.writeFileSync(
    path.join(pagesDir, 'premium-website.html'),
    '<!DOCTYPE html><html><head><title>Orig</title></head><body>Hello</body></html>'
  );

  const req = { originalUrl: '/premium-website' };
  const res = createResponseRecorder();
  let nextCalled = false;

  await coordinator.sendSeoManagedHtmlPageResponse(req, res, () => {
    nextCalled = true;
  }, 'premium-website.html');

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.equal(res.headers['Cache-Control'], 'public, max-age=300, stale-while-revalidate=900');
  assert.match(res.body, /Softora \| SEO Test/);
  assert.match(res.body, /href="\/assets\/fonts\.css\?v=20260409a"/);
  assert.match(res.body, /href="\/assets\/fonts\/inter-latin\.woff2\?v=20260409a"/);
  assert.doesNotMatch(res.body, /fonts\.googleapis\.com/);
  assert.doesNotMatch(res.body, /fonts\.gstatic\.com/);
});

test('html page coordinator falls back to sendFile when rendering throws', async () => {
  const pagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'softora-html-pages-fallback-'));
  const pagePath = path.join(pagesDir, 'premium-personeel-login.html');
  fs.writeFileSync(pagePath, '<!DOCTYPE html><html><head><title>Login</title></head><body></body></html>');

  const coordinator = createHtmlPageCoordinator({
    pagesDir,
    logger: {
      error: () => {},
    },
    sanitizeKnownHtmlFileName: (value) => {
      const fileName = String(value || '').trim();
      return fileName === 'premium-personeel-login.html' ? fileName : '';
    },
    normalizeString: (value) => String(value || '').trim(),
    knownPrettyPageSlugToFile: new Map(),
    resolvePremiumHtmlPageAccess: async () => ({
      handled: false,
      isLoginPage: true,
      isProtectedPremiumPage: false,
    }),
    getSeoConfigCached: async () => {
      throw new Error('boom');
    },
    applySeoOverridesToHtml: (fileName, html) => `${fileName}:${html}`,
  });

  const req = { originalUrl: '/premium-personeel-login' };
  const res = createResponseRecorder();
  let nextCalled = false;

  await coordinator.sendSeoManagedHtmlPageResponse(req, res, () => {
    nextCalled = true;
  }, 'premium-personeel-login.html');

  assert.equal(nextCalled, false);
  assert.equal(res.headers['Cache-Control'], 'no-store, private');
  assert.equal(res.sendFilePath, pagePath);
});

test('html page coordinator injects bootstrap json into html markers for dynamic pages', async () => {
  const { coordinator, pagesDir } = createFixture();
  fs.writeFileSync(
    path.join(pagesDir, 'premium-personeel-agenda.html'),
    '<!DOCTYPE html><html><body><!-- SOFTORA_AGENDA_STATUS --><!-- SOFTORA_AGENDA_BOOTSTRAP --><main>Agenda</main></body></html>'
  );

  const req = { originalUrl: '/premium-personeel-agenda' };
  const res = createResponseRecorder();

  await coordinator.sendSeoManagedHtmlPageResponse(req, res, () => {}, 'premium-personeel-agenda.html');

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<div class="status">Klaar<\/div>/);
  assert.match(res.body, /id="softoraAgendaBootstrap"/);
  assert.match(res.body, /"appointments":\[\{"id":11,"company":"Softora"/);
});
