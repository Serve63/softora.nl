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

  assert.doesNotMatch(source, />AI Photo Preview</);
  assert.doesNotMatch(source, />Website URL</);
  assert.doesNotMatch(source, /id="website-preview-url"/);
  assert.doesNotMatch(source, /id="website-preview-generate"/);
  assert.doesNotMatch(source, /id="website-link-html"/);
  assert.doesNotMatch(source, /id="website-link-slug"/);
  assert.doesNotMatch(source, /Gegenereerde websitegenerator preview/);
  assert.match(source, /if \(\s*!urlInput \|\|[\s\S]*!websiteLinkCopyEl[\s\S]*\) \{\s*return;\s*\}/);
  assert.match(source, /\/api\/website-links\/create/);
});

test('premium websitegenerator toont een login-fallback voor protected acties', () => {
  const filePath = path.join(__dirname, '../../premium-websitegenerator.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /id="websitegenerator-auth-card"/);
  assert.match(source, /id="websitegenerator-login-link"/);
  assert.match(source, /\/api\/auth\/session/);
  assert.match(source, /premium-personeel-login\?next=/);
  assert.match(source, /id="scan-btn"[\s\S]*disabled/);
  assert.match(source, /id="website-link-create-btn"[\s\S]*disabled/);
  assert.match(source, /Log in met je premium account om scans te genereren en websitelinks te publiceren\./);
  assert.match(source, /Log eerst in om AI previews te genereren\./);
  assert.match(source, /Log eerst in om websitelinks aan te maken\./);
  assert.match(source, /const errorParts = \[data\?\.detail, data\?\.upstreamDetail\]/);
});

test('premium websitegenerator trimt lege witte randen uit gegenereerde previews', () => {
  const filePath = path.join(__dirname, '../../premium-websitegenerator.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const WEBSITE_PREVIEW_IMAGE_WIDTH = 1536;/);
  assert.match(source, /const WEBSITE_PREVIEW_IMAGE_HEIGHT = 1024;/);
  assert.match(source, /async function cropPreviewImageDataUrl\(dataUrl\)/);
  assert.match(source, /measurePreviewSideCrop/);
  assert.match(source, /hasPreviewContentBreak/);
  assert.match(source, /const croppedPreview = await cropPreviewImageDataUrl\(imageDataUrl\)/);
  assert.match(source, /const previewWidth = Number\(croppedPreview\?\.width \|\| WEBSITE_PREVIEW_IMAGE_WIDTH\)/);
  assert.match(source, /const frameW = Math\.round\(previewWidth \* scaleX\)/);
  assert.match(source, /browser-frame" style="width:\$\{frameW\}px;max-width:100%;"/);
  assert.match(source, /scale-wrap" style="width:\$\{frameW\}px;height:\$\{frameH\}px"/);
  assert.match(source, /width:\$\{previewWidth\}px;height:\$\{previewHeight\}px/);
  assert.match(source, /window\._lastPreviewImageDataUrl = previewDataUrl/);
});
