const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  WEBDESIGN_EMAIL_MOCKUP_CAPTION,
  WEBDESIGN_EMAIL_TEMPLATE_VERSION,
  renderWebdesignImageSection,
} = require('../../server/services/webdesign-email-renderer');

test('shared webdesign renderer keeps desktop paired and mobile explicitly stacked', () => {
  const html = renderWebdesignImageSection(
    { src: 'cid:design@softora', alt: 'Bedrijf webdesign' },
    {
      mockupImage: { src: 'cid:mockup@softora', alt: 'Bedrijf device mockup' },
    }
  );

  assert.match(html, new RegExp(WEBDESIGN_EMAIL_TEMPLATE_VERSION));
  assert.match(html, /<table class="softora-desktop-image-pair"[^>]+width="900"/);
  assert.match(html, /width="300" height="560"/);
  assert.match(html, /width="584" height="560"/);
  assert.match(html, /class="softora-mobile-image-pair"[^>]+width:100%;max-width:100%/);
  assert.match(
    html,
    /\.softora-mobile-image-pair table,\.softora-mobile-image-pair tbody,\.softora-mobile-image-pair tr,\.softora-mobile-image-pair td\{display:block!important;width:100%!important;max-width:100%!important\}/
  );
  assert.match(
    html,
    /\.softora-mobile-image-pair img\{display:block!important;width:100%!important;max-width:100%!important;height:auto!important;max-height:none!important\}/
  );

  const mobileStart = html.indexOf('class="softora-mobile-image-pair"');
  const designIndex = html.indexOf('alt="Bedrijf webdesign"', mobileStart);
  const captionIndex = html.indexOf(WEBDESIGN_EMAIL_MOCKUP_CAPTION, mobileStart);
  const mockupIndex = html.indexOf('alt="Bedrijf device mockup"', captionIndex);
  assert.ok(designIndex > mobileStart);
  assert.ok(captionIndex > designIndex);
  assert.ok(mockupIndex > captionIndex);
  assert.equal(html.indexOf(WEBDESIGN_EMAIL_MOCKUP_CAPTION), html.lastIndexOf(WEBDESIGN_EMAIL_MOCKUP_CAPTION));
});

test('shared webdesign renderer escapes image metadata and supports one image', () => {
  const html = renderWebdesignImageSection({
    src: 'https://www.softora.nl/image?a=1&b=2',
    alt: 'Design <test>',
  });

  assert.match(html, /src="https:\/\/www\.softora\.nl\/image\?a=1&amp;b=2"/);
  assert.match(html, /alt="Design &lt;test&gt;"/);
  assert.doesNotMatch(html, /softora-desktop-image-pair|softora-mobile-image-pair/);
});

test('mailbox and autopilot use the same shared webdesign image renderer', () => {
  const servicesDir = path.join(__dirname, '..', '..', 'server', 'services');
  const mailboxSource = fs.readFileSync(path.join(servicesDir, 'mailbox.js'), 'utf8');
  const campaignSource = fs.readFileSync(path.join(servicesDir, 'coldmail-campaign.js'), 'utf8');

  for (const source of [mailboxSource, campaignSource]) {
    assert.match(source, /require\('\.\/webdesign-email-renderer'\)/);
    assert.match(source, /renderWebdesignImageSection\(/);
    assert.match(source, /X-Softora-Template-Version/);
  }
  assert.doesNotMatch(mailboxSource, /function renderMailboxEmailImagePair\(/);
  assert.doesNotMatch(campaignSource, /function renderEmailImagePairTable\(/);
});
