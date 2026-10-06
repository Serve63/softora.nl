const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Parser } = require('htmlparser2');
const sharp = require('sharp');

const root = path.resolve(__dirname, '../..');
const apps = [
  { name: 'Winnen', route: '/winnen', stem: 'winnen', manifest: 'winnen.webmanifest', pages: ['live-momentum.html', 'live-momentum-access.html'] },
  { name: 'Bulk Season', route: '/logboek', stem: 'bulk-season', manifest: 'sportschool-logboek.webmanifest', pages: ['sportschool.html'] },
  { name: 'Cut Season', route: '/logboek-cut', stem: 'cut-season', manifest: 'logboek-cut.webmanifest', pages: ['logboek-cut.html'] },
];
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const localFile = (url) => path.join(root, new URL(url, 'https://www.softora.nl').pathname);

function tags(html) {
  const result = [];
  new Parser({ onopentag: (tag, attributes) => result.push({ tag, ...attributes }) }).end(html);
  return result;
}

for (const app of apps) {
  test(`${app.name} has one iPhone icon and app title on every entry page`, () => {
    for (const page of app.pages) {
      const elements = tags(read(page));
      const touchIcons = elements.filter((element) => element.tag === 'link' && element.rel === 'apple-touch-icon');
      assert.equal(touchIcons.length, 1, `${page} must not have a competing generic Softora touch icon`);
      assert.equal(touchIcons[0].sizes, '180x180');
      assert.equal(touchIcons[0].href, `/assets/${app.stem}-app-icon-180.png?v=20261006a`);
      const png = fs.readFileSync(localFile(touchIcons[0].href));
      assert.equal(png.readUInt32BE(16), 180);
      assert.equal(png.readUInt32BE(20), 180);
      assert.equal(elements.find((element) => element.name === 'apple-mobile-web-app-title')?.content, app.name);
      assert.equal(elements.find((element) => element.name === 'apple-mobile-web-app-capable')?.content, 'yes');
      const manifests = elements.filter((element) => element.tag === 'link' && element.rel === 'manifest');
      assert.equal(manifests.length, 1);
      assert.equal(manifests[0].href, `/assets/${app.manifest}?v=20261006a`);
    }
  });

  test(`${app.name} installs as its own Android app and starts on its own page`, async () => {
    const manifest = JSON.parse(read(`assets/${app.manifest}`));
    assert.equal(manifest.id, app.route);
    assert.equal(manifest.start_url, app.route);
    assert.equal(manifest.name, app.name);
    assert.equal(manifest.short_name, app.name);
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.scope, '/');
    assert.deepEqual(manifest.icons.map((icon) => [icon.sizes, icon.purpose]), [
      ['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable'],
    ]);
    for (const icon of manifest.icons) {
      assert.equal(icon.type, 'image/png');
      assert.match(icon.src, new RegExp(`^/assets/${app.stem}-app-icon-`));
      const png = fs.readFileSync(localFile(icon.src));
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      const [width, height] = icon.sizes.split('x').map(Number);
      assert.equal(png.readUInt32BE(16), width);
      assert.equal(png.readUInt32BE(20), height);
      assert.equal(png[25], 2, 'App icons must have an opaque RGB background');
      if (icon.purpose === 'maskable') {
        const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
        for (let offset = 0; offset < data.length; offset += info.channels) {
          if (data[offset] < 240 || data[offset + 1] < 240 || data[offset + 2] < 240) continue;
          const pixel = offset / info.channels;
          const x = pixel % width + 0.5 - width / 2;
          const y = Math.floor(pixel / width) + 0.5 - height / 2;
          assert.ok(Math.hypot(x, y) <= width * 0.4, 'Android masks must not crop white logo artwork');
        }
      }
    }
  });
}

test('Winnen, Bulk Season and Cut Season have separate installed-app identities', () => {
  const ids = apps.map((app) => JSON.parse(read(`assets/${app.manifest}`)).id);
  assert.equal(new Set(ids).size, 3);
});
