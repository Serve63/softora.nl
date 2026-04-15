const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium pdf builder scales the live preview to the available viewport', () => {
  const pagePath = path.join(__dirname, '../../premium-pdfs.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /<title>PDF's - Softora\.nl<\/title>/);
  assert.match(pageSource, /body \{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;/);
  assert.match(pageSource, /<div class="topbar">/);
  assert.match(pageSource, /--preview-scale:\s*1;/);
  assert.match(pageSource, /--a4-width:\s*595px;/);
  assert.match(pageSource, /--a4-height:\s*842px;/);
  assert.match(pageSource, /<div class="preview-panel" id="previewPanel">/);
  assert.match(pageSource, /<div class="preview-stage" id="previewStage">/);
  assert.match(pageSource, /<div class="a4-scale-shell" id="a4ScaleShell">/);
  assert.match(pageSource, /\.split \{ display: flex; flex: 1; overflow: hidden; min-width: 0; min-height: 0; \}/);
  assert.match(pageSource, /\.form-panel \{[\s\S]*width:\s*clamp\(280px, 30vw, 340px\);[\s\S]*min-width:\s*280px;/);
  assert.match(pageSource, /\.preview-stage \{[\s\S]*overflow:\s*auto;[\s\S]*justify-content:\s*center;/);
  assert.match(pageSource, /\.a4-scale-shell \{[\s\S]*calc\(var\(--a4-width\) \* var\(--preview-scale\)\)/);
  assert.match(pageSource, /\.a4 \{[\s\S]*transform:\s*scale\(var\(--preview-scale\)\);[\s\S]*transform-origin:\s*top center;/);
  assert.match(pageSource, /@media \(max-width: 900px\) \{[\s\S]*\.split \{[\s\S]*flex-direction:\s*column;/);
  assert.match(pageSource, /function fmtEur\(n\) \{ return '€\\u00a0'/);
  assert.match(pageSource, /function fitPreviewToViewport\(\) \{[\s\S]*const availableWidth = Math\.max\(240, stage\.clientWidth\);[\s\S]*const availableHeight = Math\.max\(240, stage\.clientHeight\);[\s\S]*const scale = Math\.min\(1, availableWidth \/ A4_PREVIEW_WIDTH, availableHeight \/ A4_PREVIEW_HEIGHT\);/);
  assert.match(pageSource, /function setupPreviewAutoFit\(\) \{[\s\S]*new ResizeObserver\(\(\) => fitPreviewToViewport\(\)\);/);
  assert.match(pageSource, /buildForm\(\);\s*setupPreviewAutoFit\(\);\s*fitPreviewToViewport\(\);/);
  assert.doesNotMatch(pageSource, /data-sidebar-shell="canonical"/);
  assert.doesNotMatch(pageSource, /personnel-theme/);
  assert.doesNotMatch(pageSource, /EUR /);
});
