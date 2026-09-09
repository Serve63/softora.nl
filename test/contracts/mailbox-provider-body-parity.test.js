const test = require('node:test');
const assert = require('node:assert/strict');
const { simpleParser } = require('mailparser');
const { parseProviderHtml } = require('../../server/services/mailbox-provider-rich-body');
const { sanitizeMailboxDisplayText, createMailboxService } = require('../../server/services/mailbox');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const scope = { URL };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../assets/premium-mailbox-display.js'), 'utf8'), scope);
const script = fs.readFileSync(path.join(__dirname, '../../assets/premium-mailbox.js'), 'utf8');
const renderer = { URL, window: { SoftoraMailboxDisplay: scope.SoftoraMailboxDisplay } };
vm.runInNewContext(script.slice(script.indexOf('"use strict";'), script.indexOf('function normalizeMailboxEmail')) + '\nthis.render = renderLinkedMailboxText;', renderer);

const html = '<p>Lees <a href="https://example.nl/handleiding?a=1&amp;b=2">de handleiding</a>.</p><p>Met vriendelijke groet,<br>Jos&#233; Voorbeeld<br>Tel: &#48;612345678<br><a href="https://example.nl"><img alt="Website" src="https://example.nl/logo.png"></a></p>';
const source = (body, contentType = 'text/html; charset=utf-8') => Buffer.from(`From: Jose <jose@example.nl>\r\nTo: serve@softora.nl\r\nSubject: Vraag\r\nMessage-ID: <body-parity@example.nl>\r\nMIME-Version: 1.0\r\nContent-Type: ${contentType}\r\n\r\n${body}`);

test('actual MIME HTML conversion preserves ordinary hrefs, linked image labels and numeric entities like Instantly', async () => {
  const parsed = await simpleParser(source(html), { skipHtmlToText: true });
  assert.equal(parsed.text, '');
  const imap = sanitizeMailboxDisplayText(parsed.text || parsed.html);
  assert.equal(imap, parseProviderHtml(html).body);
  assert.match(imap, /José Voorbeeld/);
  assert.match(imap, /Tel: 0612345678/);
  assert.match(imap, /\[Website\]\(https:\/\/example.nl\)/);
  const rendered = renderer.render(imap);
  assert.match(rendered, /href="https:\/\/example.nl\/handleiding\?a=1&amp;b=2"[^>]*>de handleiding<\/a>/);
});

test('default IMAP service uses the shared HTML converter for actual MIME instead of mailparser footnotes', async () => {
  const client = {
    connect: async () => {}, logout: async () => {}, close: () => {},
    list: async () => [{ path: 'INBOX', specialUse: '\\Inbox' }],
    getMailboxLock: async () => ({ release() {} }),
    mailbox: { exists: 1, uidValidity: 1 },
    search: async () => [1],
    async *fetch() { yield { uid: 1, source: source(html), flags: new Set(), internalDate: new Date() }; },
  };
  const service = createMailboxService({
    mailboxAccountsRaw: JSON.stringify([{ email: 'serve@softora.nl', imapHost: 'imap.example.nl', imapUser: 'serve@softora.nl', imapPass: 'test' }]),
    createImapClient: () => client,
  });
  const [message] = await service.listMessages({ accountEmail: 'serve@softora.nl', folder: 'inbox' });
  assert.equal(message.body, parseProviderHtml(html).body);
  assert.doesNotMatch(message.body, /Links:\n/);
});

test('plain MIME preserves angle-bracket addresses and authored text, including when an HTML alternative exists', async () => {
  const plain = 'Akkoord. Mail <robin@example.nl>. Tel: 0612345678. 2 < 3.';
  const parsed = await simpleParser(source(plain, 'text/plain; charset=utf-8'), { skipHtmlToText: true });
  assert.equal(sanitizeMailboxDisplayText(parsed.text), plain);
  const multipart = await simpleParser(source(`--parity\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${plain}\r\n--parity\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Kortere HTML-versie.</p>\r\n--parity--`, 'multipart/alternative; boundary="parity"'), { skipHtmlToText: true });
  assert.equal(sanitizeMailboxDisplayText(multipart.text || multipart.html), plain);
  assert.equal(sanitizeMailboxDisplayText('Jos&#233; &amp; &#x31;'), 'José & 1');
});

test('body links escape markup and retain CTA evidence checks and nested legacy annotations', () => {
  assert.match(renderer.render('[*Handleiding*](https://example.nl/doc)'), /<em><a[^>]*>Handleiding<\/a><\/em>/);
  assert.doesNotMatch(renderer.render('[Klik](javascript:alert%281%29)'), /<a/);
  assert.doesNotMatch(parseProviderHtml('<a href="javascript:alert(1)">onveilig</a><script>evil()</script>').body, /javascript|evil/);
  assert.match(renderer.render('[<img src=x onerror=evil>](https://example.nl)'), /&lt;img/);
  const url = 'https://www.softora.nl/webdesign/test';
  assert.doesNotMatch(renderer.render(`[hier](${url})`), /<a/);
  const options = { mail: { webdesignLinkEvidenceKnown: true, webdesignLinkUrl: url } };
  assert.match(renderer.render(`hier [[${url}](${url})]`, options), /class="detail-mail-cta-link"/);
  assert.doesNotMatch(renderer.render(`hier [[https://bad.example](${url})]`, options), /<a/);
});
