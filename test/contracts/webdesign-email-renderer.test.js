const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  WEBDESIGN_EMAIL_MOCKUP_CAPTION,
  WEBDESIGN_EMAIL_TEMPLATE_VERSION,
  protectWebsiteDomainInText,
  renderTextWithUnlinkedWebsiteDomain,
  renderUnlinkedWebsiteDomain,
  renderWebdesignEmailDocument,
  renderWebdesignEmailHeadStyles,
  renderWebdesignImageSection,
} = require('../../server/services/webdesign-email-renderer');

test('website domain stays plain and indivisible while visible text remains unchanged', () => {
  const domain = 'de-rustende-jager.nl';
  const line = `Afgelopen week kwam ik jullie website ${domain} tegen.`;
  const protectedText = protectWebsiteDomainInText(line, `https://${domain}/`);
  const html = renderTextWithUnlinkedWebsiteDomain(line, domain);

  assert.equal(protectedText.replace(/\u2060/g, ''), line);
  assert.doesNotMatch(protectedText, /de-rustende-jager\.nl/);
  assert.match(
    html,
    /website <span class="softora-unlinked-website-domain" style="display:inline-block;white-space:nowrap!important;overflow-wrap:normal!important;word-break:keep-all!important;color:inherit!important;text-decoration:none!important;">de\u2060-\u2060rustende\u2060-\u2060jager\u2060\.\u2060nl<\/span> tegen\./
  );
  assert.doesNotMatch(html, /<a\b|href=|color:#0a66c2/);
  assert.equal(
    html,
    `Afgelopen week kwam ik jullie website ${renderUnlinkedWebsiteDomain(domain)} tegen.`
  );
});

test('shared webdesign renderer is width-safe without CSS and stacks each image exactly once', () => {
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
  assert.match(styles, /\.softora-webdesign-email-body\{width:100%!important;max-width:600px!important;/);
  assert.match(styles, /\.softora-coldmail-body p\{font-size:16px!important;line-height:26px!important/);
  assert.match(styles, /\.softora-mailbox-webdesign-body p\{font-size:16px!important;line-height:26px!important/);
  assert.match(html, /class="softora-webdesign-image-stack" style="display:block;[^\"]+max-width:600px/);
  assert.match(html, /class="softora-webdesign-image" width="600" style="display:block;width:100%;max-width:600px;height:auto;max-height:none;/);
  assert.match(html, /class="softora-webdesign-image softora-webdesign-image--mockup" width="600"/);
  assert.equal((html.match(/<img\b/g) || []).length, 2);
  assert.equal((html.match(/alt="Bedrijf webdesign"/g) || []).length, 1);
  assert.equal((html.match(/alt="Bedrijf device mockup"/g) || []).length, 1);

  const stackStart = html.indexOf('class="softora-webdesign-image-stack"');
  const designIndex = html.indexOf('alt="Bedrijf webdesign"', stackStart);
  const captionIndex = html.indexOf(WEBDESIGN_EMAIL_MOCKUP_CAPTION, stackStart);
  const mockupIndex = html.indexOf('alt="Bedrijf device mockup"', captionIndex);
  assert.ok(designIndex > stackStart);
  assert.ok(captionIndex > designIndex);
  assert.ok(mockupIndex > captionIndex);
  assert.equal(html.indexOf(WEBDESIGN_EMAIL_MOCKUP_CAPTION), html.lastIndexOf(WEBDESIGN_EMAIL_MOCKUP_CAPTION));
  assert.doesNotMatch(html, /900px|softora-desktop-image-pair|softora-mobile-image-pair|min-device-width|table-layout:fixed|white-space:nowrap|display:inline-block/);

  const withoutHeadCss = html.replace(/<style type="text\/css">[\s\S]*?<\/style>/, '');
  assert.match(withoutHeadCss, /class="softora-webdesign-image-stack" style="display:block;[^\"]+max-width:600px/);
  assert.equal((withoutHeadCss.match(/<img\b/g) || []).length, 2);
});

test('shared webdesign renderer escapes image metadata and supports one image', () => {
  const html = renderWebdesignImageSection({
    src: 'https://www.softora.nl/image?a=1&b=2',
    alt: 'Design <test>',
  });

  assert.match(html, /src="https:\/\/www\.softora\.nl\/image\?a=1&amp;b=2"/);
  assert.match(html, /alt="Design &lt;test&gt;"/);
  assert.doesNotMatch(html, /softora-webdesign-image-stack|softora-desktop-image-pair|softora-mobile-image-pair/);
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
