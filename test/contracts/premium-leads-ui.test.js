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
  assert.match(pageSource, /const SHARED_CALL_SUMMARY_CACHE_STORAGE_KEY = 'softora_shared_call_summary_cache_v7';/);
  assert.match(pageSource, /function replaceGenericSoftoraSpeakerName\(value\) \{/);
  assert.match(pageSource, /function looksLikeDirectSpeechSummary\(value\) \{/);
  assert.match(pageSource, /function buildLeadTranscriptFallbackSummary\(lead, detail, interestedLead = null, update = null, insight = null\) \{/);
  assert.match(pageSource, /Noem de medewerker van Softora bij naam als Ruben Nijhuis wanneer die in de samenvatting voorkomt\./);
  assert.match(pageSource, /Gebruik nooit het woord "agent"\./);
  assert.match(pageSource, /const freshDetailSummary = getCallBackedModalFallbackSummaryFromDetail\(lead, resolvedDetail\);/);
  assert.match(pageSource, /const immediateSummary = isCallBackedLead \|\| Boolean\(resolveLeadCallId\(recoveredLead, mergedDetail\)\)/);
  assert.match(pageSource, /void ensureCallBackedModalCopy\(normalizedTaskId, recoveredLead, effectiveDetail\)\.then\(\(summaryText\) => \{/);
  assert.match(
    pageSource,
    /if \(allLeads\.length > 0\) \{[\s\S]*console\.warn\('\[softora-leads\] Live refresh overgeslagen; zichtbare leads blijven staan\.', message\);[\s\S]*setStatusLastUpdatedNow\(new Date\(lastLeadStatusTimestamp\)\);/
  );
  assert.match(pageSource, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(pageSource, /<label class="lead-modal-label" for="leadModalDate">Datum van afspraak<\/label>/);
  assert.match(pageSource, /function formatLeadIncomingDateLabel\(lead, detail\)/);
  assert.match(pageSource, /<div class="lead-modal-meta-label">Datum<\/div>/);
});
