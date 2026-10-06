const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseDocument, DomUtils } = require('htmlparser2');
const sharp = require('sharp');

const root = path.resolve(__dirname, '../..');
const assetDirectory = path.join(root, 'assets/seo-login');
const html = fs.readFileSync(path.join(assetDirectory, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(assetDirectory, 'seo-login.css'), 'utf8');

test('SEO login includes its background in the initial render-blocking stylesheet', () => {
  const links = DomUtils.findAll((node) => node.name === 'link', parseDocument(html).children);
  const stylesheet = links.find((node) => node.attribs.rel === 'stylesheet');
  assert.ok(stylesheet, 'The stylesheet must be discoverable in the initial HTML');
  assert.ok(html.indexOf('rel="stylesheet"') < html.indexOf('</head>'));
  assert.equal(stylesheet.attribs.media, undefined, 'The first paint must wait for the stylesheet');
  assert.equal(stylesheet.attribs.disabled, undefined);
  assert.match(css, /url\('data:image\/webp;base64,[A-Za-z0-9+/=]+'\)/);
  assert.doesNotMatch(css, /seo-login-background[^'\s]*\.png/);
  assert.ok(Buffer.byteLength(css) < 60000, 'The complete stylesheet must remain below 60 KB');
  assert.match(stylesheet.attribs.href, /seo-login\.css\?v=/, 'Existing cached CSS must be refreshed');
});

test('SEO login keeps the complete background at its original resolution below 50 KB', async () => {
  const encoded = css.match(/data:image\/webp;base64,([A-Za-z0-9+/=]+)/)?.[1];
  assert.ok(encoded, 'The background must not require a separate image request');
  const background = Buffer.from(encoded, 'base64');
  const metadata = await sharp(background).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 1536);
  assert.equal(metadata.height, 1024);
  assert.ok(background.length < 50000, `Background grew to ${background.length} bytes`);
});
