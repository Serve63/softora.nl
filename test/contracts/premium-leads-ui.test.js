const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium leads page bootstraps leads before async refresh starts', () => {
  const pagePath = path.join(__dirname, '../../premium-ai-coldmailing.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /<!-- SOFTORA_LEADS_BOOTSTRAP -->/);
  assert.match(pageSource, /<div class="lead-status" id="leadStatus"><!-- SOFTORA_LEADS_STATUS --><\/div>/);
  assert.match(pageSource, /<div class="lead-list" id="leadList"(?: style="visibility:hidden;")?><!-- SOFTORA_LEADS_LIST --><\/div>/);
  assert.match(pageSource, /function readLeadsBootstrapPayload\(\)/);
  assert.match(pageSource, /document\.getElementById\('softoraLeadsBootstrap'\)/);
  assert.match(pageSource, /const leadsBootstrapPayload = readLeadsBootstrapPayload\(\);/);
  assert.match(pageSource, /const LEADS_MEMORY_CACHE_MAX_AGE_MS = 1000 \* 60 \* 60 \* 24;/);
  assert.match(pageSource, /const LEADS_POLL_INTERVAL_MS = 5000;/);
  assert.match(pageSource, /const LEADS_POST_ACTION_REFRESH_BURST_INTERVAL_MS = 1200;/);
  assert.match(pageSource, /const LEADS_POST_ACTION_REFRESH_BURST_COUNT = 6;/);
  assert.match(pageSource, /const sharedCallSummaryCacheByCallId = Object\.create\(null\);/);
  assert.match(pageSource, /const leadOverviewCacheState = \{ leads: \[\], savedAt: 0 \};/);
  assert.match(
    pageSource,
    /function loadCachedLeads\(\) \{[\s\S]*let memoryCache = \{[\s\S]*leadOverviewCacheState\.leads/
  );
  assert.doesNotMatch(pageSource, /const bootstrapLeads = Array\.isArray\(leadsBootstrapPayload\?\.leads\)/);
  assert.doesNotMatch(pageSource, /const bootstrapSavedAt = Date\.parse\(String\(leadsBootstrapPayload\?\.loadedAt \|\| ''\)\.trim\(\)\) \|\| 0;/);
  assert.doesNotMatch(pageSource, /if \(memoryCache\.leads\.length > 0 && memoryCache\.savedAt > bootstrapSavedAt\) \{/);
  assert.match(pageSource, /if \(!allLeads\.length\) \{[\s\S]*listEl\.innerHTML = '<div class="lead-empty">Nog geen leads gevonden\.<\/div>';[\s\S]*listEl\.style\.visibility = '';/);
  assert.match(pageSource, /if \(cachedLeads\.leads\.length > 0\) \{[\s\S]*setStatusLastUpdatedNow\(new Date\(cachedLeads\.savedAt\)\);[\s\S]*\} else \{[\s\S]*setStatus\('Leads laden\.\.\.', ''\);[\s\S]*\}/);
  assert.match(pageSource, /const LEADS_LOAD_RETRY_DELAY_MS = 4000;/);
  assert.match(pageSource, /const MANUAL_LEAD_SUPPRESSION_TTL_MS = 1000 \* 60 \* 2;/);
  assert.match(pageSource, /const SERVER_VISIBLE_LEAD_SUPPRESSION_GRACE_MS = 1000 \* 60 \* 2;/);
  assert.match(
    pageSource,
    /function shouldKeepVisibleLeadsOnTransientEmptySnapshot\(freshRows\) \{[\s\S]*if \(Array\.isArray\(freshRows\) && freshRows\.length > 0\) \{[\s\S]*return false;[\s\S]*if \(Array\.isArray\(freshRows\)\) \{[\s\S]*consecutiveEmptyLeadSnapshots \+= 1;[\s\S]*return false;[\s\S]*\}/
  );
  assert.doesNotMatch(pageSource, /Lege live snapshot tijdelijk genegeerd om UI-flicker te voorkomen/);
  assert.match(pageSource, /function persistSuppressedLeadRows\(\) \{[\s\S]*purgeExpiredSuppressedLeadKeys\(\);[\s\S]*JSON\.stringify\(entries\)/);
  assert.match(pageSource, /function hydrateSuppressedLeadRows\(\) \{[\s\S]*suppressedLeadCreatedAtByKey\.clear\(\);[\s\S]*purgeExpiredSuppressedLeadKeys\(\);[\s\S]*persistSuppressedLeadRows\(\);/);
  assert.match(pageSource, /function suppressLeadRowLocally\(item(?:, ttlMs = MANUAL_LEAD_SUPPRESSION_TTL_MS)?\) \{/);
  assert.match(pageSource, /function clearSuppressedLeadRow\(item\) \{/);
  assert.match(pageSource, /function reconcileServerVisibleLeadSuppressions\(rows\) \{/);
  assert.match(pageSource, /function filterSuppressedLeadRows\(rows\) \{/);
  assert.match(pageSource, /hydrateSuppressedLeadRows\(\);/);
  assert.match(
    pageSource,
    /function finalizeLeadMutation\(taskId\) \{[\s\S]*suppressLeadRowLocally\(currentLead\);[\s\S]*closeLeadModal\(\);[\s\S]*renderList\(\);[\s\S]*refreshLeadSidebarCountsSafely\(\);/
  );
  assert.match(pageSource, /function buildLeadMutationRollbackSnapshot\(taskId\) \{/);
  assert.match(
    pageSource,
    /function rollbackLeadMutation\(snapshot\) \{[\s\S]*clearSuppressedLeadRow\(safeSnapshot\.lead\);[\s\S]*allLeads = dedupe\(nextRows\)\.sort\(sortByDateDesc\);[\s\S]*renderList\(\);/
  );
  assert.match(
    pageSource,
    /async function submitLeadToAgenda\(\) \{[\s\S]*applyOptimisticLeadRemovalFromOverview\(taskId\);[\s\S]*closeLeadModal\(\);/
  );
  assert.match(
    pageSource,
    /\.lead-modal\.dismiss-locked \.lead-modal-close \{[\s\S]*display:\s*none !important;[\s\S]*pointer-events:\s*none;/
  );
  assert.match(
    pageSource,
    /function syncLeadModalDismissState\(\) \{[\s\S]*modalOverlay\.classList\.toggle\('dismiss-locked', dismissLocked\);[\s\S]*modalContainer\.classList\.toggle\('dismiss-locked', dismissLocked\);[\s\S]*modalCloseBtn\.hidden = dismissLocked;[\s\S]*modalCloseBtn\.style\.display = dismissLocked \? 'none' : '';/
  );
  assert.match(
    pageSource,
    /async function removeLead\(\) \{[\s\S]*let rollbackSnapshot = null;[\s\S]*setStatus\('Lead verwijderen\.\.\.', ''\);[\s\S]*await removeLeadRequest\(\);[\s\S]*rollbackSnapshot = buildLeadMutationRollbackSnapshot\(taskId\);[\s\S]*finalizeLeadMutation\(taskId\);[\s\S]*promoteLeadRowSuppression\(lead\);[\s\S]*removeLeadSucceeded = true;[\s\S]*closeLeadModal\(\);[\s\S]*catch \(error\) \{[\s\S]*rollbackLeadMutation\(rollbackSnapshot\);[\s\S]*setStatus\(`Lead verwijderen mislukt: \$\{String\(error\?\.message \|\| 'onbekende fout'\)\}`, 'error'\);/
  );
  assert.match(
    pageSource,
    /const mergedRows = dedupe\(\[\]\.concat\(pendingRows \|\| \[\], interestedRows \|\| \[\]\)\)[\s\S]*reconcileServerVisibleLeadSuppressions\(mergedRows\);[\s\S]*const visibleRows = filterSuppressedLeadRows\(mergedRows\);/
  );
  assert.match(
    pageSource,
    /function renderList\(\) \{[\s\S]*const filteredRows = filterSuppressedLeadRows\(Array\.isArray\(allLeads\) \? allLeads : \[\]\);[\s\S]*persistCachedLeads\(allLeads\);/
  );
  assert.match(pageSource, /function persistCachedLeads\(rows\) \{[\s\S]*leadOverviewCacheState\.savedAt = Date\.now\(\);[\s\S]*leadOverviewCacheState\.leads = safeRows;/);
  assert.match(
    pageSource,
    /loadLeadsPromise = \(async \(\) => \{[\s\S]*const freshLeads = filterSuppressedLeadRows\(await fetchLeadRows\(\)\);/
  );
  assert.match(pageSource, /function isLeadLoadTimeoutError\(error\) \{/);
  assert.match(pageSource, /function scheduleLeadRetry\(delayMs = LEADS_LOAD_RETRY_DELAY_MS\) \{/);
  assert.match(pageSource, /function clearLeadRefreshBurstTimers\(\) \{/);
  assert.match(pageSource, /function scheduleLeadRefreshBurst\(\) \{/);
  assert.match(pageSource, /\/api\/agenda\/confirmation-tasks\?fresh=1&quick=1&limit=400', timeoutMs: 7000/);
  assert.match(pageSource, /\/api\/agenda\/confirmation-tasks\?fresh=1&fast=1&limit=400', timeoutMs: 7000/);
  assert.match(pageSource, /\/api\/agenda\/confirmation-tasks\?fresh=1&limit=400', timeoutMs: 12000/);
  assert.match(pageSource, /\/api\/agenda\/interested-leads\?fresh=1&limit=500', 10000/);
  assert.doesNotMatch(pageSource, /\/api\/coldcalling\/call-updates\?limit=500', 10000/);
  assert.doesNotMatch(pageSource, /\/api\/ai\/call-insights\?limit=500', 10000/);
  assert.match(pageSource, /function leadRowsDiffer\(a, b\)/);
  assert.match(pageSource, /let lastLeadStatusTimestamp = 0;/);
  assert.match(pageSource, /lastLeadStatusTimestamp = safeDate\.getTime\(\);/);
  assert.match(pageSource, /function readSharedCallSummaryCache\(\) \{\s*return sharedCallSummaryCacheByCallId;\s*\}/);
  assert.match(pageSource, /function replaceGenericSoftoraSpeakerName\(value\) \{/);
  assert.match(pageSource, /function stripActionableFollowUpSummarySentence\(value\) \{/);
  assert.match(pageSource, /function looksLikeDirectSpeechSummary\(value\) \{/);
  assert.match(pageSource, /function buildLeadTranscriptFallbackSummary\(lead, detail, interestedLead = null, update = null, insight = null\) \{/);
  assert.match(pageSource, /bevestigingsmail sturen/);
  assert.match(pageSource, /gedetecteerde afspraak/);
  assert.match(pageSource, /afspraakbevestiging/);
  assert.match(pageSource, /agenda-item/);
  assert.match(pageSource, /Noem de medewerker van Softora bij naam als Ruben Nijhuis wanneer die in de samenvatting voorkomt\./);
  assert.match(pageSource, /Gebruik nooit het woord "agent"\./);
  assert.doesNotMatch(pageSource, /De logische vervolgstap is om de afspraak te bevestigen en intern op te volgen/);
  assert.doesNotMatch(pageSource, /pas aan het einde de vervolgstap als die er is/);
  assert.match(pageSource, /const freshDetailSummary = getCallBackedModalFallbackSummaryFromDetail\(lead, resolvedDetail\);/);
  assert.match(pageSource, /const immediateSummary = isCallBackedLead \|\| Boolean\(resolveLeadCallId\(recoveredLead, mergedDetail\)\)/);
  assert.match(pageSource, /void ensureCallBackedModalCopy\(normalizedTaskId, recoveredLead, effectiveDetail\)\.then\(\(summaryText\) => \{/);
  assert.match(
    pageSource,
    /\.catch\(\(error\) => \{[\s\S]*if \(allLeads\.length > 0\) \{[\s\S]*scheduleLeadRetry\(\);[\s\S]*return;[\s\S]*allLeads = \[\];[\s\S]*renderList\(\);[\s\S]*scheduleLeadRetry\(\);/
  );
  assert.doesNotMatch(pageSource, /Live refresh overgeslagen; zichtbare leads blijven staan/);
  assert.match(pageSource, /pollTimer = window\.setInterval\(\(\) => \{[\s\S]*refreshLeadSurfaces\(\);[\s\S]*\}, LEADS_POLL_INTERVAL_MS\);/);
  assert.match(
    pageSource,
    /if \(isLeadLoadTimeoutError\(error\)\) \{[\s\S]*setStatus\('Leads laden duurt langer dan verwacht\. We proberen automatisch opnieuw\.\.\.', ''\);[\s\S]*scheduleLeadRetry\(\);[\s\S]*return;/
  );
  assert.match(pageSource, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(pageSource, /<label class="lead-modal-label" for="leadModalDate">Datum van afspraak<span class="lead-modal-required">\*<\/span><\/label>/);
  assert.match(pageSource, /<input class="lead-modal-input" id="leadModalDate" type="date" required>/);
  assert.match(pageSource, /<label class="lead-modal-label" for="leadModalTime">Tijd<span class="lead-modal-required">\*<\/span><\/label>/);
  assert.match(pageSource, /<label class="lead-modal-label" for="leadModalLocation">Locatie<span class="lead-modal-required">\*<\/span><\/label>/);
  assert.match(pageSource, /<input class="lead-modal-input" id="leadModalLocation" type="text" placeholder="Vul de afspraaklocatie in" required>/);
  assert.match(pageSource, /<input id="leadModalWhatsappConfirm" type="checkbox" required>/);
  assert.match(pageSource, /<label for="leadModalWhatsappConfirm">Bevestigd via WhatsApp<span class="lead-modal-required">\*<\/span><\/label>/);
  assert.match(pageSource, /function formatLeadIncomingDateLabel\(lead, detail\)/);
  assert.match(pageSource, /hour: '2-digit'/);
  assert.match(pageSource, /minute: '2-digit'/);
  assert.match(pageSource, /<div class="lead-modal-meta-label">Datum<\/div>/);
  assert.match(pageSource, /const allowLocationPrefill =/);
  assert.match(pageSource, /modalLocation\.value = allowLocationPrefill \? leadLocationValue : '';/);
  assert.match(pageSource, /const allowRecoveredLocationPrefill = allowLocationPrefill && !recoveredCallId;/);
  assert.match(pageSource, /createdAt: String\(item\?\.createdAt \|\| item\?\.created_at \|\| item\?\.updatedAt \|\| item\?\.updated_at \|\| ''\)\.trim\(\),/);
  assert.doesNotMatch(pageSource, /window\.localStorage/);
  assert.doesNotMatch(pageSource, /window\.sessionStorage/);
});
