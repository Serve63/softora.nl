const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAILBOX_COMPOSE_EMAIL_TEMPLATE_VERSION,
  renderMailboxComposeEmailHtml,
} = require('../../server/services/mailbox-compose-email-renderer');

test('manual mailbox email uses the coldmail typography and constrained responsive width', () => {
  const html = renderMailboxComposeEmailHtml('Beste,\n\nDankjewel voor je reactie 😁\nTweede regel.');

  assert.match(html, /^<!doctype html><html lang="nl"><head>/);
  assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1\.0">/);
  assert.match(html, new RegExp(MAILBOX_COMPOSE_EMAIL_TEMPLATE_VERSION));
  assert.match(html, /width="600"[^>]+width:100%;max-width:600px/);
  assert.match(html, /font-family:Arial,sans-serif;font-size:16px;line-height:26px/);
  assert.match(html, /<p style="margin:0 0 18px 0;[^\"]+font-size:16px;line-height:26px/);
  assert.match(html, /Dankjewel voor je reactie 😁<br>Tweede regel\./);
  assert.equal((html.match(/<p\b/g) || []).length, 2);
});

test('manual mailbox email preserves exact safe links and escapes raw user HTML', () => {
  const html = renderMailboxComposeEmailHtml(
    'Bekijk [het ontwerp](https://www.softora.nl/webdesign/test?x=1&y=2) of https://example.nl/pad.\n\n<script>alert(1)</script> 😁'
  );

  assert.match(html, /href="https:\/\/www\.softora\.nl\/webdesign\/test\?x=1&amp;y=2"[^>]+>het ontwerp<\/a>/);
  assert.match(html, /href="https:\/\/example\.nl\/pad"[^>]+>https:\/\/example\.nl\/pad<\/a>\./);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; 😁/);
  assert.doesNotMatch(html, /href="(?:javascript|data):/i);
});
