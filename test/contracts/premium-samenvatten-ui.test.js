const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const pageSource = fs.readFileSync(path.join(repoRoot, 'premium-samenvatten.html'), 'utf8');
const scriptSource = fs.readFileSync(path.join(repoRoot, 'assets/premium-samenvatten.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(repoRoot, 'assets/premium-samenvatten.css'), 'utf8');
const baseStyleSource = fs.readFileSync(path.join(repoRoot, 'assets/personnel-page-base.css'), 'utf8');

test('Samenvatten toont audio-upload en resultaatinterface', () => {
  assert.match(pageSource, /<h1 class="page-title">Samenvatten<\/h1>/);
  assert.match(pageSource, /<p class="page-subtitle">Zet een audiogesprek/);
  assert.match(pageSource, /assets\/fonts\.css/);
  assert.match(pageSource, /assets\/personnel-page-base\.css\?v=20260923a/);
  assert.match(pageSource, /id="audioFileInput"[\s\S]*accept="audio\/\*,\.mp3,\.m4a,\.wav,\.aac,\.ogg,\.webm"/);
  assert.match(pageSource, /Sleep je audiobestand hierheen/);
  assert.match(pageSource, /id="summarizeButton"[^>]*disabled/);
  assert.match(pageSource, /Nog geen samenvatting/);
  assert.match(pageSource, /resultaat na maximaal 24 uur/);
  assert.match(pageSource, /id="summaryResult" hidden/);
  assert.match(pageSource, /id="summaryTranscript"/);
  assert.match(pageSource, /assets\/premium-samenvatten\.css\?v=20260923a/);
  assert.match(pageSource, /assets\/premium-samenvatten\.js\?v=20260923b/);
});

test('Samenvatten gebruikt de gedeelde titel, lettertypen en achtergrond van personeelspagina’s', () => {
  const themeSource = fs.readFileSync(path.join(repoRoot, 'assets/personnel-theme.css'), 'utf8');
  assert.match(themeSource, /--sidebar-page-title-size:\s*2rem/);
  assert.match(themeSource, /\.dashboard-layout\[data-sidebar-shell="canonical"\][^\{]*:is\(\.page-title,[^\{]*\{[^}]*font-size:\s*var\(--sidebar-page-title-size\)/s);
  assert.match(pageSource, /<body data-summarize-page data-personnel-page>/);
  assert.match(baseStyleSource, /body\[data-personnel-page\]\s*\{[^}]*background:\s*var\(--bg-primary\) !important/s);
  assert.match(styleSource, /\.summarize-shell\s*\{[^}]*width:\s*min\(var\(--sidebar-shell-max-width\), 100%\)/s);
  assert.doesNotMatch(styleSource, /\.summarize-header\s+h1\s*\{|summarize-eyebrow|radial-gradient|background:\s*var\(--bg-primary\)/);
});

test('Samenvatten gebruikt privé-upload, serverstatus en veilige tekstweergave', () => {
  assert.match(scriptSource, /fileInput\.addEventListener\('change'/);
  assert.match(scriptSource, /dropzone\.addEventListener\('drop'/);
  assert.match(scriptSource, /\/api\/samenvatten\/plan/);
  assert.match(scriptSource, /\/api\/samenvatten\/jobs\/\$\{encodeURIComponent\(plan\.id\)\}\/start/);
  assert.match(scriptSource, /textContent = part\.text/);
  assert.doesNotMatch(scriptSource, /innerHTML/);
});

test('Samenvatten heeft een responsieve tweekolomsinterface met toegankelijke focusstates', () => {
  assert.match(styleSource, /\.summarize-grid\s*\{[\s\S]*grid-template-columns:/);
  assert.match(styleSource, /\.audio-dropzone:focus-visible/);
  assert.match(styleSource, /@media \(max-width: 1040px\)[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(styleSource, /@media \(max-width: 900px\)/);
  assert.match(styleSource, /@media \(prefers-reduced-motion: reduce\)/);
});
