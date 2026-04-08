const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium leads page bootstraps leads before async refresh starts', () => {
  const pagePath = path.join(__dirname, '../../premium-ai-coldmailing.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /<!-- SOFTORA_LEADS_BOOTSTRAP -->/);
  assert.match(pageSource, /<div class="lead-status" id="leadStatus"><!-- SOFTORA_LEADS_STATUS --><\/div>/);
  assert.match(pageSource, /<div class="lead-list" id="leadList"><!-- SOFTORA_LEADS_LIST --><\/div>/);
  assert.match(pageSource, /function readLeadsBootstrapPayload\(\)/);
  assert.match(pageSource, /document\.getElementById\('softoraLeadsBootstrap'\)/);
  assert.match(pageSource, /const leadsBootstrapPayload = readLeadsBootstrapPayload\(\);/);
  assert.match(
    pageSource,
    /function loadCachedLeads\(\) \{[\s\S]*const bootstrapLeads = Array\.isArray\(leadsBootstrapPayload\?\.leads\)/
  );
  assert.match(pageSource, /window\.localStorage\.setItem\(\s*LEADS_CACHE_KEY,/);
  assert.match(pageSource, /function leadRowsDiffer\(a, b\)/);
  assert.match(pageSource, /let lastLeadStatusTimestamp = 0;/);
  assert.match(pageSource, /lastLeadStatusTimestamp = safeDate\.getTime\(\);/);
  assert.match(
    pageSource,
    /if \(allLeads\.length > 0\) \{[\s\S]*console\.warn\('\[softora-leads\] Live refresh overgeslagen; zichtbare leads blijven staan\.', message\);[\s\S]*setStatusLastUpdatedNow\(new Date\(lastLeadStatusTimestamp\)\);/
  );
});
