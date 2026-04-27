const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pagePath = path.join(__dirname, '../../ai-lead-generator.html');

test('publieke ai lead generator gebruikt delegated campagne startknop', () => {
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /id="launchBtn" data-campaign-toggle type="button"/);
  assert.match(pageSource, /launchBtn\.addEventListener\('click', toggleCampaign\);/);
  assert.doesNotMatch(pageSource, /\son(?:click|input|change|keydown|submit)=/i);
  assert.doesNotMatch(pageSource, /onclick="toggleCampaign\(\)"/);
});
