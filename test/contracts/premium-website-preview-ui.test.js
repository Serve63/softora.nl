const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

[
  '../../premium-websitegenerator.html',
  '../../premium-websitepreview.html',
].forEach((relativePath) => {
  test(`website preview ui hides legacy scanresult panel for ${path.basename(relativePath)}`, () => {
    const filePath = path.join(__dirname, relativePath);
    const source = fs.readFileSync(filePath, 'utf8');

    assert.doesNotMatch(source, /Scanresultaat/);
    assert.doesNotMatch(source, /Nog geen website gescand/);
    assert.doesNotMatch(source, /Doelwebsite/);
    assert.doesNotMatch(source, /Pagina titel/);
    assert.doesNotMatch(source, /Meta omschrijving/);
    assert.doesNotMatch(source, /Hoofdkop/);
    assert.doesNotMatch(source, /AI brief/);
    assert.doesNotMatch(source, /Gevonden secties/);
    assert.doesNotMatch(source, /Visuele cues/);
    assert.doesNotMatch(source, /website-preview-scan/);
    assert.match(source, /\.workspace\s*\{[\s\S]*display:\s*block;/);
  });
});

test('premium websitegenerator biedt een websitelink-aanmaken flow met html input', () => {
  const filePath = path.join(__dirname, '../../premium-websitegenerator.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /Websitelink aanmaken/);
  assert.match(source, /id="website-link-html"/);
  assert.match(source, /id="website-link-slug"/);
  assert.match(source, /\/api\/website-links\/create/);
});
