const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('sidebar leads badge mirrors the leads page virtual id logic for suppressed ghost leads', () => {
  const root = path.join(__dirname, '../..');
  const themeSource = fs.readFileSync(path.join(root, 'assets/personnel-theme.js'), 'utf8');
  const leadsPageSource = fs.readFileSync(path.join(root, 'premium-ai-coldmailing.html'), 'utf8');

  assert.match(leadsPageSource, /function buildLeadVirtualSeed\(item\) \{/);
  assert.match(leadsPageSource, /function resolveLeadListId\(item\) \{/);
  assert.match(leadsPageSource, /if \(rowId !== 0\) keys\.push\(`id:\$\{rowId\}`\);/);

  assert.match(themeSource, /function buildLeadVirtualSeedForCount\(item\) \{/);
  assert.match(themeSource, /const isLiveLeadsPage = isLeadsPagePath\(pathName\);/);
  assert.match(themeSource, /const callId = resolveLeadCallIdForCount\(item\);/);
  assert.match(themeSource, /const phoneDigits = String\(\(item && item\.phone\) \|\| ""\)\.replace\(\/\\D\/g, ""\);/);
  assert.match(themeSource, /if \(companyKey \|\| contactKey\) return `name:\$\{companyKey\}\|\$\{contactKey\}`;/);
  assert.match(themeSource, /function resolveLeadListIdForCount\(item\) \{[\s\S]*if \(explicitId > 0\) return explicitId;[\s\S]*return -\(Math\.abs\(hash \|\| 1\)\);/);
  assert.match(themeSource, /id: resolveLeadListIdForCount\(item\),/);
  assert.match(themeSource, /if \(rowId !== 0 && suppressedKeys\.has\("id:" \+ rowId\)\) return true;/);
  assert.match(themeSource, /if \(callId && suppressedKeys\.has\("call:" \+ callId\)\) return true;/);
  assert.match(themeSource, /if \(!isLiveLeadsPage && total <= 0 && Number\.isFinite\(cachedLeadCount\) && cachedLeadCount > 0\) \{/);
  assert.match(themeSource, /const key = buildLeadMatchKeyForCount\(row\) \|\| \([\s\S]*callId[\s\S]*`call:\$\{callId\}`[\s\S]*rowId > 0[\s\S]*`id:\$\{rowId\}`/);
});
