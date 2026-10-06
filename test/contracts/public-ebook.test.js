const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { createPublicEbookService, EBOOK_DOWNLOAD_URL } = require('../../server/services/public-ebook');
const { registerPublicContactRoutes } = require('../../server/routes/public-contact');
const { renderArticleHtml, renderOverviewHtml, publishedArticles } = require('../../server/services/seo-articles-presentation');

const payload = { name: 'Test lezer', email: 'reader@example.test', page: '/blog/crm-migratie-stappenplan' };
function response() {
  return { headers: {}, statusCode: 200, set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
function fixture(send = async () => ({ accepted: ['info@example.test'], rejected: [] })) {
  const calls = [];
  const service = createPublicEbookService({ logger: { error() {} }, contactService: {
    async sendContactRequest(value) { calls.push(value); return send(value); },
  } });
  return { calls, async submit(body, headers = {}) { const res = response(); await service.submitResponse({ body, headers }, res); return res; } };
}

test('ebook download waits for accepted delivery to the existing contact inbox and keeps personal data out of responses', async () => {
  let resolve;
  const f = fixture(() => new Promise((done) => { resolve = done; }));
  let completed = false;
  const pending = f.submit({ ...payload, name: '  Test lezer  ', email: 'READER@example.test', message: 'Injected marketing consent' }).then((res) => { completed = true; return res; });
  await new Promise(setImmediate);
  assert.equal(completed, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, 'Test lezer');
  assert.equal(f.calls[0].email, 'reader@example.test');
  assert.match(f.calls[0].message, /Geen toestemming voor nieuwsbrieven/);
  assert.doesNotMatch(f.calls[0].message, /Injected/);
  resolve({ accepted: ['info@example.test'], rejected: [] });
  const res = await pending;
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.deepEqual(res.body, { ok: true, downloadUrl: EBOOK_DOWNLOAD_URL });
});

test('invalid or forged requests never reach the contact inbox', async () => {
  const f = fixture();
  for (const invalid of [
    { name: '' }, { name: 'x'.repeat(101) }, { name: 'Name\r\nBcc: injected' }, { name: ['Name'] },
    { email: 'invalid' }, { email: 'a\r\n@example.test' }, { email: 'x'.repeat(255) + '@example.test' },
    { page: '/blog' }, { page: '/blog/nonexistent-ebook-article' }, { page: 'https://evil.test/blog/crm-migratie-stappenplan' },
    { website: 'bot.example' },
  ]) {
    const res = await f.submit({ ...payload, ...invalid });
    assert.equal(res.statusCode, 400, JSON.stringify(invalid));
    assert.equal(res.body.downloadUrl, undefined);
  }
  assert.equal((await f.submit(payload, { 'sec-fetch-site': 'cross-site' })).statusCode, 403);
  assert.equal(f.calls.length, 0);
});

test('failed or rejected inbox delivery never unlocks a PDF or exposes smtp details', async () => {
  for (const send of [async () => { throw new Error('private SMTP credentials'); }, async () => ({ accepted: [], rejected: [] }),
    async () => ({ accepted: ['info@example.test'], rejected: ['info@example.test'] })]) {
    const res = await fixture(send).submit(payload);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.downloadUrl, undefined);
    assert.doesNotMatch(JSON.stringify(res.body), /private|SMTP/);
  }
});

test('public ebook route accepts a valid request and rate-limits repeated submissions', async (t) => {
  const app = express(); app.use(express.json());
  let deliveries = 0;
  registerPublicContactRoutes(app, { coordinator: { submitResponse() {}, async sendContactRequest() {
    deliveries += 1; return { accepted: ['info@example.test'], rejected: [] };
  } } });
  const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  for (let n = 0; n < 6; n++) {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/public-ebook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    assert.equal(res.status, n < 5 ? 200 : 429);
    const body = await res.json();
    if (n === 5) assert.equal(body.downloadUrl, undefined);
  }
  assert.equal(deliveries, 5);
});

test('every published article offers the ebook, while the overview stays free of the popup', () => {
  for (const item of publishedArticles(new Date('2026-10-06T12:00:00Z'))) {
    const html = renderArticleHtml(item);
    assert.match(html, /data-ebook-teaser[^>]*hidden/);
    assert.match(html, /<dialog[^>]*data-ebook-dialog/);
    assert.match(html, /ebook\.js\?v=20261006a/);
    assert.match(html, /ebook\.css\?v=20261006a/);
    assert.match(html, /name="email" type="email"[^>]*required/);
    assert.match(html, /href="\/privacybeleid"/);
    assert.doesNotMatch(html, /href="[^\"]*meer-groei-minder-handwerk\.pdf/);
  }
  assert.doesNotMatch(renderOverviewHtml(), /data-ebook|ebook\.js|ebook\.css/);
  const pdf = fs.readFileSync(path.resolve(__dirname, '../..' + EBOOK_DOWNLOAD_URL));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 20000 && pdf.length < 500000, 'The full ebook remains a lightweight download');
});
