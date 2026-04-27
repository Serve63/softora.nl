const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium pdf builder scales the live preview to the available viewport', () => {
  const pagePath = path.join(__dirname, '../../premium-pdfs.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /<title>PDF's - Softora\.nl<\/title>/);
  assert.match(pageSource, /assets\/personnel-theme\.css\?v=[^"'\\s]+/);
  assert.match(pageSource, /assets\/personnel-theme\.js\?v=[^"'\\s]+/);
  assert.match(pageSource, /family=Inter:wght@300;400;500;600;700&family=Oswald:wght@400;500;600;700/);
  assert.match(pageSource, /body \{[\s\S]*font-family:\s*'Inter', sans-serif;[\s\S]*min-height:\s*100vh;/);
  assert.match(pageSource, /<div class="dashboard-layout" data-sidebar-shell="canonical">/);
  assert.match(pageSource, /<aside class="sidebar" data-sidebar-ready="true" data-static-sidebar="1">/);
  assert.match(pageSource, /<a href="\/premium-pdfs" class="sidebar-link magnetic active" data-sidebar-key="pdfs">/);
  assert.match(pageSource, /\.main-content \{[\s\S]*margin-left:\s*280px;[\s\S]*width:\s*calc\(100% - 280px\);[\s\S]*min-width:\s*0;[\s\S]*padding:\s*0 !important;[\s\S]*overflow:\s*hidden;/);
  assert.match(pageSource, /\.pdf-builder-shell \{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*flex:\s*1 1 auto;[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;[\s\S]*min-height:\s*0;/);
  assert.match(pageSource, /\.pdf-main > \.premium-boot-shell \{[\s\S]*display:\s*flex;[\s\S]*flex:\s*1 1 auto;[\s\S]*flex-direction:\s*column;[\s\S]*min-height:\s*0;/);
  assert.match(pageSource, /\.dashboard-layout\[data-sidebar-shell="canonical"\] > \.main-content \{[\s\S]*padding:\s*0 !important;/);
  assert.match(pageSource, /<div class="topbar">/);
  assert.match(pageSource, /\.topbar-logo \{[\s\S]*font-family:\s*'Oswald', sans-serif;[\s\S]*text-transform:\s*uppercase;/);
  assert.match(pageSource, /\.btn-dl \{[\s\S]*font-family:\s*'Oswald', sans-serif;/);
  assert.match(pageSource, /<div class="pdf-download-actions">/);
  assert.match(pageSource, /href="\/assets\/algemene-voorwaarden-softora-vof\.pdf" download="algemene-voorwaarden-softora-vof\.pdf"/);
  assert.match(pageSource, /Algemene voorwaarden downloaden \(PDF\)/);
  assert.match(pageSource, /<div class="pdf-process-notice" role="note" aria-labelledby="pdf-process-notice-title">/);
  assert.match(pageSource, /Standaard werkwijze bij nieuwe opdrachten/);
  assert.match(pageSource, /Akkoord met de offerte en algemene voorwaarden\./);
  assert.match(pageSource, /--preview-scale:\s*1;/);
  assert.match(pageSource, /--preview-max-scale:\s*1\.16;/);
  assert.match(pageSource, /--a4-width:\s*595px;/);
  assert.match(pageSource, /--a4-height:\s*842px;/);
  assert.match(pageSource, /<div class="preview-panel" id="previewPanel">/);
  assert.match(pageSource, /<div class="preview-stage" id="previewStage">/);
  assert.match(pageSource, /<div class="a4-scale-shell" id="a4ScaleShell">/);
  assert.match(pageSource, /\.split \{ display: flex; flex: 1; overflow: hidden; min-width: 0; min-height: 0; \}/);
  assert.match(pageSource, /\.form-panel \{[\s\S]*width:\s*clamp\(280px, 30vw, 340px\);[\s\S]*min-width:\s*280px;/);
  assert.match(pageSource, /\.preview-panel \{[\s\S]*padding:\s*0;/);
  assert.match(pageSource, /\.preview-hint \{[\s\S]*display:\s*none;/);
  assert.match(pageSource, /\.preview-stage \{[\s\S]*overflow:\s*auto;[\s\S]*padding:\s*12px 24px 24px;[\s\S]*justify-content:\s*center;/);
  assert.match(pageSource, /\.a4-scale-shell \{[\s\S]*calc\(var\(--a4-width\) \* var\(--preview-scale\)\)[\s\S]*margin:\s*0 auto;/);
  assert.match(pageSource, /\.a4 \{[\s\S]*transform:\s*scale\(var\(--preview-scale\)\);[\s\S]*transform-origin:\s*top center;/);
  assert.match(pageSource, /@media \(max-width: 1180px\) \{[\s\S]*\.split \{[\s\S]*flex-direction:\s*column;[\s\S]*overflow:\s*auto;[\s\S]*\.form-panel \{[\s\S]*width:\s*100%;[\s\S]*max-height:\s*44vh;/);
  assert.match(pageSource, /@media \(max-width: 900px\) \{[\s\S]*\.main-content \{[\s\S]*margin-left:\s*0;[\s\S]*width:\s*100%;[\s\S]*\.pdf-builder-shell \{[\s\S]*min-height:\s*auto;[\s\S]*max-height:\s*none;[\s\S]*\.split \{[\s\S]*flex-direction:\s*column;/);
  assert.match(pageSource, /function fmtEur\(n\) \{ return '€\\u00a0'/);
  assert.match(pageSource, /function fitPreviewToViewport\(\) \{[\s\S]*const availableWidth = Math\.max\(240, stage\.clientWidth - 48\);[\s\S]*const availableHeight = Math\.max\(320, stage\.clientHeight - 36\);[\s\S]*const maxScale = Number\.parseFloat\(getComputedStyle\(document\.documentElement\)\.getPropertyValue\('--preview-max-scale'\)\) \|\| 1;[\s\S]*const scale = Math\.min\(maxScale, availableWidth \/ A4_PREVIEW_WIDTH, availableHeight \/ A4_PREVIEW_HEIGHT\);/);
  assert.match(pageSource, /const hcols\s+= \{ 1:'#d97706', 2:'#b45a00', 3:'#c0392b' \};/);
  assert.match(pageSource, /const hcols=\{1:\[217,119,6\],2:\[180,90,0\],3:\[192,57,43\]\};/);
  assert.match(pageSource, /function setupPreviewAutoFit\(\) \{[\s\S]*new ResizeObserver\(\(\) => fitPreviewToViewport\(\)\);/);
  assert.match(pageSource, /buildForm\(\);\s*setupPreviewAutoFit\(\);\s*fitPreviewToViewport\(\);/);
  assert.doesNotMatch(pageSource, /EUR /);
});

test('premium pdf builder exposes the algemene voorwaarden pdf asset', () => {
  const pdfPath = path.join(__dirname, '../../assets/algemene-voorwaarden-softora-vof.pdf');
  const pdf = fs.readFileSync(pdfPath);

  assert.equal(pdf.subarray(0, 4).toString('ascii'), '%PDF');
  assert.ok(pdf.length > 100000, 'Algemene voorwaarden PDF hoort een echte downloadbare PDF te zijn.');
});
