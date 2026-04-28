const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pagePath = path.join(__dirname, '../../ai-lead-generator.html');
const dashboardCorePath = path.join(__dirname, '../../assets/coldcalling-dashboard-core.js');

test('publieke ai lead generator gebruikt delegated campagne startknop', () => {
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const dashboardCoreSource = fs.readFileSync(dashboardCorePath, 'utf8');

  assert.match(pageSource, /id="launchBtn" data-campaign-toggle type="button"/);
  assert.match(
    pageSource,
    /<script src="assets\/coldcalling-conversation-summary\.js\?v=20260427a" defer><\/script>\s*<script src="assets\/coldcalling-regio-radius\.js\?v=20260427a" defer><\/script>\s*<script src="assets\/coldcalling-manual-lead-prompt\.js\?v=20260427a" defer><\/script>\s*<script src="assets\/coldcalling-dashboard-core\.js\?v=20260428e" defer><\/script>\s*<script src="assets\/coldcalling-dashboard-config\.js\?v=20260428a" defer><\/script>\s*<script src="assets\/coldcalling-dashboard-modes\.js\?v=20260428a" defer><\/script>\s*<script src="assets\/coldcalling-dashboard\.js\?v=20260428g" defer><\/script>/
  );
  assert.match(dashboardCoreSource, /function bindCampaignToggleControl\(rootDocument = global\.document\) \{/);
  assert.match(dashboardCoreSource, /rootDocument\.addEventListener\('click', \(event\) => \{/);
  assert.match(dashboardCoreSource, /\[data-campaign-toggle\]/);
  assert.doesNotMatch(pageSource, /\son(?:click|input|change|keydown|submit)=/i);
  assert.doesNotMatch(pageSource, /onclick="toggleCampaign\(\)"/);
});
