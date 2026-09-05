const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readPage(fileName) {
  return fs.readFileSync(path.join(__dirname, '../..', fileName), 'utf8');
}

test('Softora Read Archive publishes an honest purpose-limited privacy policy', () => {
  const page = readPage('whatsapp-privacy.html');

  assert.match(page, /Softora Read Archive Privacy Policy/);
  assert.match(page, /Read-only by design/);
  assert.match(page, /no tool to send, edit or delete WhatsApp messages/);
  assert.match(page, /Group conversations are not synchronized/);
  assert.match(page, /at most six months/);
  assert.match(page, /encrypted at rest/);
  assert.match(page, /Direct Meta webhooks require a valid Meta signature/);
  assert.match(page, /high-entropy provider callback address/);
  assert.match(page, /YCloud acts as the WhatsApp solution provider/);
  assert.match(page, /YCloud-Signature/);
  assert.match(page, /HMAC-SHA256 over the exact request body/);
  assert.match(page, /YCloud's provider-side (?:copy|retention)[^.]*up to six months/);
  assert.match(page, /does not sell WhatsApp data/);
  assert.match(page, /normally within 30 days/);
  assert.match(page, /serve@softora\.nl/);
  assert.doesNotMatch(page, /12345678/);
  assert.doesNotMatch(page, /YCloud API key/i);
  assert.doesNotMatch(page, /(?:send|reply|edit|delete)[ -]functionality/i);
  assert.doesNotMatch(page, /paid subscription|monthly subscription/i);
});

test('Softora Read Archive publishes specific deletion instructions and scope', () => {
  const page = readPage('whatsapp-data-deletion.html');

  assert.match(page, /Softora Read Archive deletion request/);
  assert.match(page, /complete connected archive or a specific phone number or conversation/);
  assert.match(page, /pending encrypted webhook copies/);
  assert.match(page, /YCloud is active/);
  assert.match(page, /provider deletion request/);
  assert.match(page, /normally completed within 30 days/);
  assert.match(page, /does not delete messages from either participant's WhatsApp app/);
  assert.match(page, /disable or delete the corresponding YCloud channel and webhook/);
  assert.match(page, /Revocation stops future access but may not itself remove data/);
  assert.match(page, /Verwijderverzoek Softora Read Archive/);
});

test('Softora Read Archive legal pages are registered as public canonical pages', () => {
  const {
    applyPublicSeoHeadDefaults,
    getIndexablePublicHtmlFileFromPath,
    getIndexablePublicPathFromHtmlFile,
  } = require('../../server/services/public-seo');
  const { createPremiumPublicHtmlFilesSet } = require('../../server/config/premium-public-html-files');

  assert.equal(getIndexablePublicHtmlFileFromPath('/whatsapp-privacy'), 'whatsapp-privacy.html');
  assert.equal(getIndexablePublicHtmlFileFromPath('/whatsapp-data-deletion'), 'whatsapp-data-deletion.html');
  assert.equal(getIndexablePublicPathFromHtmlFile('whatsapp-privacy.html'), '/whatsapp-privacy');
  assert.equal(getIndexablePublicPathFromHtmlFile('whatsapp-data-deletion.html'), '/whatsapp-data-deletion');
  assert.equal(createPremiumPublicHtmlFilesSet().has('whatsapp-privacy.html'), true);
  assert.equal(createPremiumPublicHtmlFilesSet().has('whatsapp-data-deletion.html'), true);

  for (const [fileName, pagePath] of [
    ['whatsapp-privacy.html', '/whatsapp-privacy'],
    ['whatsapp-data-deletion.html', '/whatsapp-data-deletion'],
  ]) {
    const rendered = applyPublicSeoHeadDefaults(readPage(fileName), fileName);
    assert.match(rendered, /href="mailto:serve@softora\.nl/);
    assert.match(rendered, new RegExp(`data-softora-conversion-page="${pagePath}"`));
    assert.match(rendered, /data-softora-conversion-target="mailto"/);
    assert.doesNotMatch(
      rendered,
      /href="https:\/\/wa\.me\/31643262792"[^>]*>serve@softora\.nl<\/a>/
    );
  }
});
