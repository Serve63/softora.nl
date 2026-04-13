const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium leads keeps suppression local without storage side effects', () => {
  const root = path.join(__dirname, '../..');
  const themeSource = fs.readFileSync(path.join(root, 'assets/personnel-theme.js'), 'utf8');
  const leadsPageSource = fs.readFileSync(path.join(root, 'premium-ai-coldmailing.html'), 'utf8');

  assert.match(themeSource, /function readSuppressedLeadKeys\(\) \{/);
  assert.match(themeSource, /const leadSuppressionCookieKey = "softora_hidden_leads_v1";/);
  assert.match(themeSource, /const manualLeadSuppressionTtlMs = 1000 \* 60 \* 2;/);
  assert.match(themeSource, /const completedLeadSuppressionTtlMs = 1000 \* 60 \* 60 \* 24 \* 30;/);
  assert.match(themeSource, /const serverVisibleLeadSuppressionGraceMs = 1000 \* 60 \* 2;/);
  assert.match(themeSource, /const cookiePairs = String\(document\.cookie \|\| ""\)\.split\(\/;\\s\*\/\);/);
  assert.match(themeSource, /createdAt:\s*Math\.max\(0,\s*Math\.min\(Number\(entry\[2\]\) \|\| inferCreatedAt\(expiresAt\), expiresAt\)\)/);
  assert.match(themeSource, /ignoreServerVisibleStaleSuppression/);
  assert.match(leadsPageSource, /const MANUAL_LEAD_SUPPRESSION_TTL_MS = 1000 \* 60 \* 2;/);
  assert.match(leadsPageSource, /const COMPLETED_LEAD_SUPPRESSION_TTL_MS = 1000 \* 60 \* 60 \* 24 \* 30;/);
  assert.match(leadsPageSource, /const SERVER_VISIBLE_LEAD_SUPPRESSION_GRACE_MS = 1000 \* 60 \* 2;/);
  assert.match(leadsPageSource, /const LEAD_SUPPRESSION_COOKIE_KEY = 'softora_hidden_leads_v1';/);
  assert.match(leadsPageSource, /const suppressedLeadCreatedAtByKey = new Map\(\);/);
  assert.match(
    leadsPageSource,
    /function persistSuppressedLeadRows\(\) \{[\s\S]*getSuppressedLeadCreatedAtMs\(entry\?\.\[0\], entry\?\.\[1\]\)[\s\S]*writeCookieValue\(LEAD_SUPPRESSION_COOKIE_KEY,[\s\S]*JSON\.stringify\(entries\)/
  );
  assert.match(
    leadsPageSource,
    /function hydrateSuppressedLeadRows\(\) \{[\s\S]*const raw = readCookieValueByName\(LEAD_SUPPRESSION_COOKIE_KEY\);[\s\S]*suppressedLeadCreatedAtByKey\.set\(key, createdAt\);[\s\S]*persistSuppressedLeadRows\(\);/
  );
  assert.match(
    leadsPageSource,
    /function buildSuppressedLeadKeys\(item\) \{[\s\S]*if \(rowId !== 0\) keys\.push\(`id:\$\{rowId\}`\);[\s\S]*if \(callId\) keys\.push\(`call:\$\{callId\}`\);[\s\S]*return keys;/
  );
  assert.match(
    leadsPageSource,
    /function filterSuppressedLeadRows\(rows\) \{\s*if \(!Array\.isArray\(rows\)\) return \[\];[\s\S]*!isSuppressedLeadRow\(row\)/
  );
  assert.match(leadsPageSource, /function promoteLeadRowSuppression\(item\) \{\s*suppressLeadRowLocally\(item, COMPLETED_LEAD_SUPPRESSION_TTL_MS\);/);
  assert.match(
    leadsPageSource,
    /function reconcileServerVisibleLeadSuppressions\(rows\) \{[\s\S]*nowMs - createdAt >= SERVER_VISIBLE_LEAD_SUPPRESSION_GRACE_MS[\s\S]*clearSuppressedLeadKeys\(Array\.from\(keysToClear\)\)/
  );
  assert.match(
    leadsPageSource,
    /const mergedRows = dedupe\(\[\]\.concat\(pendingRows \|\| \[\], interestedRows \|\| \[\]\)\)[\s\S]*reconcileServerVisibleLeadSuppressions\(mergedRows\);[\s\S]*const visibleRows = filterSuppressedLeadRows\(mergedRows\);/
  );
  assert.doesNotMatch(leadsPageSource, /localStorage\./);
});
