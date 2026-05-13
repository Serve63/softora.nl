const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const faviconHref = '/assets/softora-favicon.png?v=20260513';
const legacyIconHref = '/assets/D80D8A58-B985-491E-A39B-27879E4C593A.PNG?v=20260414f';

test('site pages use the centered round Softora favicon asset', () => {
  const htmlFiles = fs
    .readdirSync(repoRoot)
    .filter((file) => file.endsWith('.html'))
    .sort();

  const pagesWithIconLink = [];
  for (const file of htmlFiles) {
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    if (!source.includes('rel="icon"')) continue;
    pagesWithIconLink.push(file);

    assert.match(
      source,
      new RegExp(`<link rel="icon" type="image/png" href="${faviconHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" sizes="any">`),
      `${file} moet de ronde favicon gebruiken.`
    );
    assert.doesNotMatch(
      source,
      new RegExp(`<link rel="icon"[^>]+${legacyIconHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      `${file} mag de oude vierkante favicon niet meer als rel=icon gebruiken.`
    );
  }

  assert.ok(pagesWithIconLink.includes('index.html'), 'Homepage moet een favicon-link hebben.');
  assert.ok(pagesWithIconLink.includes('agendaapp.html'), 'Agenda app landingspagina moet een favicon-link hebben.');
  assert.ok(fs.existsSync(path.join(repoRoot, 'favicon.ico')), 'Root favicon fallback ontbreekt.');
  assert.ok(fs.existsSync(path.join(repoRoot, 'assets/softora-favicon.png')), 'Ronde favicon PNG ontbreekt.');
  assert.ok(fs.existsSync(path.join(repoRoot, 'assets/favicon-32x32.png')), '32px favicon PNG ontbreekt.');
  assert.ok(fs.existsSync(path.join(repoRoot, 'assets/favicon-16x16.png')), '16px favicon PNG ontbreekt.');
});
