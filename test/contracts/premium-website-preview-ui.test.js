const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const websiteGeneratorHtmlSource = fs.readFileSync(
  path.join(__dirname, '../../premium-websitegenerator.html'),
  'utf8'
);
const websiteGeneratorScriptSource = fs.readFileSync(
  path.join(__dirname, '../../assets/premium-websitegenerator.js'),
  'utf8'
);
const websiteGeneratorSource = `${websiteGeneratorHtmlSource}\n${websiteGeneratorScriptSource}`;

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
  const source = websiteGeneratorHtmlSource;

  assert.match(source, /<title>Websitedesign – Softora\.nl<\/title>/);
  assert.match(source, /<div class="page-title">Websitedesign<\/div>/);
  assert.doesNotMatch(source, /<div class="page-title">Website Generator<\/div>/);
  assert.match(source, /Eén URL per keer\. AI genereert voor die website één homepage preview\./);
  assert.match(source, /<input class="inp" id="scan-url" type="text" placeholder="softora\.nl" spellcheck="false" value="softora\.nl">/);
  assert.match(source, /<button type="button" class="tab" data-tab="library">Bibliotheek<\/button>/);
  assert.match(source, /<button type="button" class="tab active" data-tab="scan">Website Scan & Preview<\/button>/);
  assert.match(source, /data-websitegenerator-action="scan"/);
  assert.doesNotMatch(source, /onclick=/);
  assert.doesNotMatch(source, /<textarea class="inp" id="scan-url"/);
  assert.doesNotMatch(source, />AI Photo Preview</);
  assert.doesNotMatch(source, />Website URL</);
  assert.doesNotMatch(source, /id="website-preview-url"/);
  assert.doesNotMatch(source, /id="website-preview-generate"/);
  assert.doesNotMatch(source, /id="website-link-html"/);
  assert.doesNotMatch(source, /id="website-link-slug"/);
  assert.doesNotMatch(source, /Gegenereerde websitegenerator preview/);
  assert.match(websiteGeneratorSource, /if \(\s*!urlInput \|\|[\s\S]*!websiteLinkCopyEl[\s\S]*!websiteLinkListEl[\s\S]*\) \{\s*return;\s*\}/);
  assert.match(source, /id="website-link-list"/);
  assert.match(websiteGeneratorSource, /window\.open\('about:blank', '_blank'\)/);
  assert.match(websiteGeneratorSource, /function createWebsiteLinkRow\(link\) \{/);
  assert.match(websiteGeneratorSource, /function bindWebsiteGeneratorPageActions\(\) \{/);
  assert.match(websiteGeneratorSource, /button\.addEventListener\('click', \(\) => \{[\s\S]*void switchTab\(button\.dataset\.tab \|\| 'scan', button\);/);
  assert.match(websiteGeneratorSource, /scanButton\.addEventListener\('click', \(\) => \{[\s\S]*void startScan\(\);/);
  assert.match(websiteGeneratorSource, /websiteLinkListEl\.replaceChildren\(\.\.\.normalizedLinks\.map\(\(link\) => createWebsiteLinkRow\(link\)\)\);/);
  assert.match(websiteGeneratorSource, /return url\.protocol === 'http:' \|\| url\.protocol === 'https:' \? url\.href : '';/);
  assert.doesNotMatch(websiteGeneratorSource, /websiteLinkListEl\.innerHTML/);
  assert.match(websiteGeneratorSource, /\/api\/website-links'/);
  assert.match(websiteGeneratorSource, /\/api\/website-links\/create/);
});

test('premium websitegenerator shows no recent scans section anymore', () => {
  const filePath = path.join(__dirname, '../../premium-websitegenerator.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.doesNotMatch(source, /Recente scans/);
  assert.doesNotMatch(source, /id="history-section"/);
  assert.doesNotMatch(source, /id="history-list"/);
  assert.doesNotMatch(source, /function addToHistory\(/);
  assert.doesNotMatch(source, /function reScan\(/);
  assert.doesNotMatch(source, /const scanHistory = \[\];/);
});

test('premium websitegenerator removes the legacy openen button but keeps download actions', () => {
  const source = websiteGeneratorSource;

  assert.doesNotMatch(source, />Openen</);
  assert.match(source, /Download PNG/);
  assert.match(source, /function createLibraryCardElement\(entry\) \{/);
  assert.match(source, /card\.addEventListener\('click', \(\) => openLibraryEntry\(id\)\);/);
  assert.match(source, /removeBtn\.addEventListener\('click', \(event\) => \{[\s\S]*void removeLibraryEntry\(id, event\);/);
  assert.match(source, /grid\.replaceChildren\(\.\.\.items\.map\(\(entry\) => createLibraryCardElement\(entry\)\)\);/);
  assert.doesNotMatch(source, /onclick="openLibraryEntry\(/);
  assert.doesNotMatch(source, /onclick="removeLibraryEntry\(/);
  assert.doesNotMatch(source, /onclick="downloadPreviewBlock\(/);
});

test('premium websitegenerator toont een login-fallback voor protected acties', () => {
  const source = websiteGeneratorSource;

  assert.match(source, /id="websitegenerator-auth-card"/);
  assert.match(source, /id="websitegenerator-auth-card" hidden/);
  assert.match(source, /const authLoaded = Boolean\(websiteGeneratorAuthState\.loaded\);/);
  assert.match(source, /authCard\.hidden = !authLoaded \|\| isAuthenticated;/);
  assert.doesNotMatch(source, /authCard\.hidden = Boolean\(websiteGeneratorAuthState\.authenticated\)/);
  assert.match(source, /id="websitegenerator-login-link"/);
  assert.match(source, /\/api\/auth\/session/);
  assert.match(source, /premium-personeel-login\?next=/);
  assert.match(source, /id="scan-btn"[\s\S]*disabled/);
  assert.match(source, /id="website-link-create-btn"[\s\S]*disabled/);
  assert.match(source, /Log in met je premium account om scans te genereren en websitelinks te publiceren\./);
  assert.match(source, /Log eerst in om AI previews te genereren\./);
  assert.match(source, /Log eerst in om websitelinks aan te maken\./);
  assert.match(source, /\/api\/website-preview\/batch/);
  assert.match(source, /\/api\/website-preview\/batch\/current/);
  assert.match(source, /websitePreviewActiveBatchJobId/);
  assert.match(source, /encodeURIComponent\(jobId\)/);
  assert.match(source, /resumeWebsitePreviewBatchIfAny/);
  assert.match(source, /WEBSITE_PREVIEW_BATCH_MAX_STALLED_POLLS/);
  assert.match(source, /WEBSITE_PREVIEW_BATCH_POLL_INTERVAL_MS/);
  assert.match(source, /WEBSITE_PREVIEW_BATCH_MAX_POLL_FAILURES/);
  assert.match(source, /stopScanBatchPollWithMessage/);
  assert.match(source, /function renderScanOutputMessage\(container, message\) \{/);
  assert.match(source, /renderScanOutputMessage\(out, String\(payload\.detail\)\);/);
  assert.match(source, /renderScanOutputMessage\(out, String\(e\?\.message \|\| e \|\| 'Batch mislukt'\)\);/);
  assert.doesNotMatch(source, /out\.innerHTML/);
  assert.match(source, /buildWebsitePreviewJobFingerprint/);
  assert.match(source, /Scanstatus kon niet worden opgehaald\./);
});

test('premium websitegenerator behoudt hoge full-page previews zonder portrait-crop', () => {
  const source = websiteGeneratorSource;

  assert.match(source, /const WEBSITE_PREVIEW_IMAGE_WIDTH = 1024;/);
  assert.match(source, /const WEBSITE_PREVIEW_IMAGE_HEIGHT = 1536;/);
  assert.match(source, /async function cropPreviewImageDataUrl\(dataUrl\)/);
  assert.match(source, /if \(height > width\) \{\s*return \{ dataUrl: raw, width, height \};\s*\}/);
  assert.match(source, /getPreviewReferenceMatchRatio/);
  assert.match(source, /measurePreviewRightGutterWidth/);
  assert.match(source, /async function cropPreviewImageDataUrl\(dataUrl\)/);
  assert.match(source, /const previewWidth = Number\(entry\.width\) \|\| WEBSITE_PREVIEW_IMAGE_WIDTH/);
  assert.match(source, /const frameW = Math\.min\(window\.innerWidth - 100, previewWidth\)/);
  assert.match(source, /function createPreviewZoneElement\(blockId, hostname, previewWidth, useStablePreviewImageId\) \{/);
  assert.match(source, /media\.style\.maxWidth = `\$\{frameW\}px`;/);
  assert.match(source, /img\.id = 'preview-image';/);
  assert.match(source, /img\.className = 'preview-image-pixel';/);
  assert.match(source, /downloadBtn\.addEventListener\('click', \(\) => downloadPreviewBlock\(blockId\)\);/);
  assert.match(source, /stack\.appendChild\(createPreviewZoneElement\(blockId, entry\.hostname \|\| host, w, false\)\);/);
  assert.match(source, /mountScanBatchShell\(out, 'Preview hervatten…'\);/);
  assert.doesNotMatch(source, /previewZoneHtml/);
  assert.doesNotMatch(source, /insertAdjacentHTML/);
  assert.match(source, /\/api\/website-preview-library/);
  assert.match(source, /function fetchLibraryEntryById/);
  assert.match(source, /\/api\/website-preview-library\/\$\{encodeURIComponent\(entryId\)\}/);
  assert.doesNotMatch(source, /document\.write/);
  assert.doesNotMatch(source, /softora_website_preview_library_v1/);
  assert.doesNotMatch(source, /LIBRARY_STORAGE_KEY/);
  assert.doesNotMatch(source, /readLocalLibraryEntries/);
  assert.doesNotMatch(source, /persistLocalLibraryEntries/);
  assert.doesNotMatch(source, /sessionStorage/);
  assert.doesNotMatch(source, /browseropslag/);
  assert.match(source, /data-tab="library"/);
  assert.match(source, /id="tab-library"/);
  assert.doesNotMatch(source, /Bibliotheek kon niet centraal laden/);
  assert.match(source, /Alle previews van alle accounts worden zonder vaste itemlimiet centraal opgeslagen in Supabase/);
  assert.match(source, /console\.warn\('Websitepreview-bibliotheek laden mislukt:', error\);/);
  assert.doesNotMatch(source, /function openPreviewNewTab\(/);
  assert.match(source, /SCAN_URL_BATCH_MAX = 1/);
  assert.match(source, /function tokenizeScanUrlInput/);
  assert.match(source, /showToast\('Gebruik één URL per keer\.'\);\s*return;/);
  assert.match(source, /Preview wordt gestart/);
  assert.match(source, /Preview bezig/);
  assert.doesNotMatch(source, /Maximaal 50 items per account/);
  assert.doesNotMatch(source, /gekoppeld aan je premium-account/);
  assert.doesNotMatch(source, /LIBRARY_MAX_ITEMS/);
  assert.match(source, /window\._lastPreviewImageDataUrl = previewDataUrl/);
});

test('website preview batch runs server-side and exposes poll route', () => {
  const batchSvc = fs.readFileSync(
    path.join(__dirname, '../../server/services/website-preview-batch.js'),
    'utf8'
  );
  const batchRoutes = fs.readFileSync(
    path.join(__dirname, '../../server/routes/website-preview-batch.js'),
    'utf8'
  );
  const aiTools = fs.readFileSync(path.join(__dirname, '../../server/services/ai-tools.js'), 'utf8');
  const featureRoutes = fs.readFileSync(
    path.join(__dirname, '../../server/services/feature-routes-runtime.js'),
    'utf8'
  );
  const library = fs.readFileSync(
    path.join(__dirname, '../../server/services/website-preview-library.js'),
    'utf8'
  );

  assert.match(batchSvc, /createWebsitePreviewBatchCoordinator/);
  assert.match(batchSvc, /persistPreviewLibraryEntry/);
  assert.match(batchSvc, /ITEM_TIMEOUT_MS/);
  assert.match(batchSvc, /queueJobProcessing/);
  assert.match(batchSvc, /withTimeout/);
  assert.match(batchRoutes, /app\.post\('\/api\/website-preview\/batch'/);
  assert.match(batchRoutes, /app\.get\('\/api\/website-preview\/batch\/current'/);
  assert.match(batchRoutes, /app\.get\('\/api\/website-preview\/batch\/:jobId'/);
  assert.match(batchSvc, /getCurrentBatchResponse/);
  assert.match(batchSvc, /findLatestJobForOwner/);
  assert.match(batchSvc, /findLatestRunningJobForOwner/);
  assert.match(aiTools, /runWebsitePreviewGeneratePipeline/);
  assert.match(featureRoutes, /registerWebsitePreviewBatchRoutes/);
  assert.match(library, /persistPreviewLibraryEntry/);
  assert.match(library, /getLibraryEntryResponse/);
});
