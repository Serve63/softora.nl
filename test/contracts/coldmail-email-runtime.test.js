'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('production mail runtime uses direct source without loader monkey patches', () => {
  assert.equal(fs.existsSync(path.join(root, 'server/services/coldmail-email-hotfix.js')), false);

  for (const relativePath of ['api/index.js', 'api/[...path].js']) {
    const source = read(relativePath);
    assert.match(source, /module\.exports = require\('\.\/_app-handler'\)/);
    assert.doesNotMatch(source, /coldmail-email-hotfix|Module\._extensions/);
  }

  const source = read('server/services/coldmail-campaign.js');
  assert.match(source, /website \{\{website\}\} tegen/);
  assert.doesNotMatch(source, /website, \{\{website\}\}, tegen/);
  assert.match(source, /font-weight:400/);
  assert.match(source, /return escapeHtml\(cleanLine\)/);
  assert.match(source, /includeMockup: true/);
  assert.match(source, /attachments\.length !== 2/);
  assert.match(source, /'Mockup'/);
  assert.match(source, /'Webdesign'/);
  assert.match(source, /Je vindt het ontwerp in de bijlage bij deze e-mail\./);
  assert.match(source, /max-width:600px/);
  assert.doesNotMatch(source, /renderColdmailDomainToken|softora-desktop-nowrap|word-break:keep-all/);

  for (const relativePath of [
    'server/services/coldmail-campaign.js',
    'server/services/mailbox.js',
    'server/services/instantly-outreach.js',
    'server/services/webdesign-email-renderer.js',
    'scripts/render-webdesign-email-preview.js',
  ]) {
    const mailSource = read(relativePath);
    assert.doesNotMatch(
      mailSource,
      /max-width:900px|width:900px|white-space:nowrap|display:inline-block|word-break:keep-all|table-layout:fixed|min-device-width/,
      relativePath
    );
  }
});

test('temporary one-shot coldmail endpoint is removed from production', () => {
  assert.equal(fs.existsSync(path.join(root, 'api/one-shot-nowrap-mail-test.js')), false);
});
