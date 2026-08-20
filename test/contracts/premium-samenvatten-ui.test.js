const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const pageSource = fs.readFileSync(path.join(repoRoot, 'premium-samenvatten.html'), 'utf8');
const scriptSource = fs.readFileSync(path.join(repoRoot, 'assets/premium-samenvatten.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(repoRoot, 'assets/premium-samenvatten.css'), 'utf8');

test('Samenvatten toont de complete audio-upload en lege resultaatinterface', () => {
  assert.match(pageSource, /<h1>Samenvatten<\/h1>/);
  assert.match(pageSource, /id="audioFileInput"[\s\S]*accept="audio\/\*,\.mp3,\.m4a,\.wav,\.aac,\.ogg"/);
  assert.match(pageSource, /Sleep je audiobestand hierheen/);
  assert.match(pageSource, /id="summarizeButton"[^>]*disabled/);
  assert.match(pageSource, /Nog geen samenvatting/);
  assert.match(pageSource, /je bestand verlaat de browser niet/);
  assert.match(pageSource, /assets\/premium-samenvatten\.css\?v=20260820a/);
  assert.match(pageSource, /assets\/premium-samenvatten\.js\?v=20260820a/);
});

test('Samenvatten ondersteunt lokale bestandsselectie zonder upload of AI-aanroep', () => {
  assert.match(scriptSource, /fileInput\.addEventListener\("change"/);
  assert.match(scriptSource, /dropzone\.addEventListener\("drop"/);
  assert.match(scriptSource, /summarizeButton\.disabled = !hasFile/);
  assert.match(scriptSource, /samenvattingsfunctie wordt later gekoppeld/);
  assert.doesNotMatch(scriptSource, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|\/api\//);
});

test('Samenvatten heeft een responsieve tweekolomsinterface met toegankelijke focusstates', () => {
  assert.match(styleSource, /\.summarize-grid\s*\{[\s\S]*grid-template-columns:/);
  assert.match(styleSource, /\.audio-dropzone:focus-visible/);
  assert.match(styleSource, /@media \(max-width: 1040px\)[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(styleSource, /@media \(max-width: 900px\)/);
  assert.match(styleSource, /@media \(prefers-reduced-motion: reduce\)/);
});
