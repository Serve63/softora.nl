const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  WEBDESIGN_EMAIL_MOCKUP_CAPTION,
  WEBDESIGN_EMAIL_TEMPLATE_VERSION,
  renderWebdesignEmailDocument,
  renderWebdesignEmailHeadStyles,
  renderWebdesignImageSection,
} = require('../../server/services/webdesign-email-renderer');

test('shared webdesign renderer is mobile-safe without CSS and progressively pairs desktop images', () => {
  const imageSection = renderWebdesignImageSection(
    { src: 'cid:design@softora', alt: 'Bedrijf webdesign' },
    {
      mockupImage: { src: 'cid:mockup@softora', alt: 'Bedrijf device mockup' },
    }
  );
  const html = renderWebdesignEmailDocument(
    `<div class="softora-webdesign-email-body">${imageSection}</div>`
  );

  assert.match(html, new RegExp(WEBDESIGN_EMAIL_TEMPLATE_VERSION));
  assert.match(html, /^<!doctype html><html lang="nl"><head>/);
  assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1\.0">/);
  assert.match(html, /<meta name="x-apple-disable-message-reformatting">/);
  assert.match(html, /<style type="text\/css">/);
  assert.ok(html.indexOf('<style type="text/css">') < html.indexOf('<body '));
  assert.equal((html.match(/<style type="text\/css">/g) || []).length, 1);
  assert.doesNotMatch(imageSection, /<style\b/i);
  const styles = renderWebdesignEmailHeadStyles();
  assert.match(styles, /html,body\{margin:0;padding:0;width:100%;-webkit-text-size-adjust:100%!important;-ms-text-size-adjust:100%!important;text-size-adjust:100%!important\}/);
  assert.match(styles, /@media only screen and \(min-width:981px\)/);
  assert.match(styles, /\.softora-mobile-image-pair[^}]+display:none!important/);
  assert.match(styles, /\.softora-desktop-image-pair\{display:table!important;width:900px!important;max-width:900px!important/);
  assert.match(html, /class="softora-mobile-image-pair" style="display:block;[^\"]+width:100%;max-width:100%/);
  assert.match(html, /class="softora-webdesign-image" width="100%" style="display:block;width:100%;max-width:100%;height:auto;max-height:none;/);
  assert.match(html, /<table class="softora-desktop-image-pair"[^>]+style="display:none;mso-hide:all;[^\"]+width:0;max-width:0;max-height:0;/);
  assert.doesNotMatch(html, /<table class="softora-desktop-image-pair"[^>]+width="900"/);
  assert.match(html, /width="300" height="560"/);
  assert.match(html, /width="584" height="560"/);

  const mobileStart = html.indexOf('class="softora-mobile-image-pair"');
  const desktopStart = html.indexOf('class="softora-desktop-image-pair"');
  const designIndex = html.indexOf('alt="Bedrijf webdesign"', mobileStart);
  const captionIndex = html.indexOf(WEBDESIGN_EMAIL_MOCKUP_CAPTION, mobileStart);
  const mockupIndex = html.indexOf('alt="Bedrijf device mockup"', captionIndex);
  assert.ok(designIndex > mobileStart);
  assert.ok(captionIndex > designIndex);
  assert.ok(mockupIndex > captionIndex);
  assert.ok(desktopStart > mockupIndex);
  assert.equal(html.indexOf(WEBDESIGN_EMAIL_MOCKUP_CAPTION), html.lastIndexOf(WEBDESIGN_EMAIL_MOCKUP_CAPTION));

  const withoutHeadCss = html.replace(/<style type="text\/css">[\s\S]*?<\/style>/, '');
  assert.match(withoutHeadCss, /class="softora-mobile-image-pair" style="display:block;/);
  assert.match(withoutHeadCss, /class="softora-desktop-image-pair"[^>]+style="display:none;/);
  assert.doesNotMatch(withoutHeadCss, /class="softora-mobile-image-pair"[^>]+display:none/);
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

test('shared webdesign renderer can enforce a mobile-safe maximum content width', () => {
  const html = renderWebdesignEmailDocument(
    '<div class="softora-webdesign-email-body">Inhoud</div>',
    { maxWidth: 600 }
  );

  assert.match(html, /class="softora-email-viewport"[^>]+width="100%"/);
  assert.match(html, /class="softora-email-shell"[^>]+width="100%"/);
  assert.match(html, /width:100%;max-width:600px;table-layout:fixed/);
  assert.match(html, /max-width:100%;min-width:0/);
  assert.match(html, /overflow-wrap:anywhere;word-break:normal/);
  assert.doesNotMatch(html, /class="softora-email-shell"[^>]+width="600"/);
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
