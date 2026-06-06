const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
}

test('premium coldmailing lead page is its own page and uses only coldmailing follow-ups', () => {
  const pageSource = readRepoFile('premium-coldmailing-lead.html');
  const scriptSource = readRepoFile('assets/premium-coldmailing-lead.js');
  const leadsPageSource = readRepoFile('premium-ai-coldmailing.html');

  assert.match(pageSource, /<title>Softora \| Coldmailing Lead - Premium<\/title>/);
  assert.match(pageSource, /<h1>Lead<\/h1>/);
  assert.match(pageSource, /<div class="dashboard-layout" data-sidebar-shell="canonical">/);
  assert.match(pageSource, /<aside class="sidebar" data-sidebar-ready="false"/);
  assert.match(pageSource, /Positieve reacties op webdesign-mails/);
  assert.match(pageSource, /assets\/premium-coldmailing-lead\.js\?v=20260525b/);
  assert.match(scriptSource, /\/api\/coldmailing\/replies\/follow-ups\?limit=100&campaignType=webdesign/);
  assert.match(scriptSource, /Ontvangen op:/);
  assert.match(scriptSource, /Webdesign-mail/);
  assert.match(scriptSource, /window\.__softoraColdmailingLeadPageCount/);
  assert.match(scriptSource, /<span class="lead-chip confirmed">Lead<\/span>/);
  assert.doesNotMatch(scriptSource, /\/api\/agenda\/confirmation-tasks/);
  assert.doesNotMatch(scriptSource, /\/api\/agenda\/interested-leads/);
  assert.doesNotMatch(scriptSource, /localStorage|sessionStorage/);
  assert.doesNotMatch(leadsPageSource, /premium-coldmailing-lead/);
});

test('premium sidebar keeps coldmailing lead out of the sidebar', () => {
  const themeSource = readRepoFile('assets/personnel-theme.js');

  assert.doesNotMatch(themeSource, /function getColdmailingLeadSidebarLink\(\) \{/);
  assert.doesNotMatch(themeSource, /key:\s*"coldmailing_lead"/);
  assert.doesNotMatch(themeSource, /href:\s*"\/premium-coldmailing-lead"[\s\S]*label:\s*"Lead"/);
  assert.match(themeSource, /if \(p\.indexOf\("\/premium-coldmailing-lead"\) === 0\) return "coldmailing";/);
});
