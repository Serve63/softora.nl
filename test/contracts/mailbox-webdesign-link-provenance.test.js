const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMailboxWebdesignLinkProvenance,
} = require('../../server/services/mailbox-webdesign-link-provenance');

function createProvenance() {
  return createMailboxWebdesignLinkProvenance({
    getHtmlAttribute: (html, name) => {
      const match = String(html || '').match(new RegExp(`${name}=["']([^"']+)["']`, 'i'));
      return match ? match[1] : '';
    },
    getPublicBaseUrl: () => 'https://www.softora.nl',
    htmlToReadableText: (html) => String(html || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    normalizeString: (value) => String(value || '').trim(),
    safeUrl: (value) => {
      try {
        return new URL(String(value || '').trim());
      } catch (_) {
        return null;
      }
    },
  });
}

test('mailbox webdesign-linkprovenance bewijst legacy Open het via hier uit exacte MIME-HTML', () => {
  const exactUrl =
    'https://www.softora.nl/webdesign/bizzylizzy?cid=manual-import-bizzylizzy-nl-0645';
  const provenance = createProvenance();
  const html = [
    '<p>PS: Wordt het webdesign niet zichtbaar?</p>',
    `<p>Open het via <a href="${exactUrl}">hier</a> 👈</p>`,
  ].join('');
  const plainText = [
    'PS: Wordt het webdesign niet zichtbaar?',
    'Open het via hier 👈',
  ].join('\n');

  assert.equal(provenance.extractExactLinkFromHtml(html), exactUrl);
  assert.equal(
    provenance.attachExactLinkToText(plainText, exactUrl),
    plainText.replace('hier', `hier [${exactUrl}]`)
  );
  assert.equal(provenance.needsHydration({
    originalCampaignOutbound: true,
    webdesignLinkEvidenceKnown: false,
    body: plainText,
  }), true);
});

test('mailbox webdesign-linkprovenance verzint geen legacy link zonder juiste Softora-MIME-context', () => {
  const provenance = createProvenance();
  const unrelatedHtml =
    '<p>Bekijk onze planning via <a href="https://www.softora.nl/webdesign/verkeerd">hier</a>.</p>';
  const externalHtml =
    '<p>Open het webdesign via <a href="https://evil.example/webdesign/verkeerd">hier</a>.</p>';

  assert.equal(provenance.extractExactLinkFromHtml(unrelatedHtml), '');
  assert.equal(provenance.extractExactLinkFromHtml(externalHtml), '');
});
