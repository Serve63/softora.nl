const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium leads modal submit flow has explicit timeout, error and finally handling', () => {
  const pagePath = path.join(__dirname, '../../premium-ai-coldmailing.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /const LEAD_MODAL_REQUEST_TIMEOUT_MS = 20000;/);
  assert.match(pageSource, /const LEAD_MODAL_AGENDA_SUBMIT_TIMEOUT_MS = 120000;/);
  assert.match(
    pageSource,
    /async function postJsonWithFallback\(endpoints, body, options = \{\}\) \{[\s\S]*const timeoutMs = Math\.max\([\s\S]*LEAD_MODAL_REQUEST_TIMEOUT_MS[\s\S]*const controller = typeof AbortController === 'function' \? new AbortController\(\) : null;[\s\S]*setTimeout\(\(\) => controller\.abort\(\), timeoutMs\)[\s\S]*signal: controller \? controller\.signal : undefined,[\s\S]*if \(error\?\.name === 'AbortError'\) \{[\s\S]*Server reageert niet op tijd \(timeout na[\s\S]*finally \{[\s\S]*clearTimeout\(timeout\);/s
  );
  assert.match(
    pageSource,
    /async function submitLeadToAgenda\(\) \{[\s\S]*setModalBusy\(true\);[\s\S]*setModalStatus\('Afspraak wordt in agenda gezet\.\.\. dit kan tot 2 minuten duren\.', ''\);[\s\S]*await postJsonWithFallback\([\s\S]*timeoutMs:\s*LEAD_MODAL_AGENDA_SUBMIT_TIMEOUT_MS[\s\S]*finalizeLeadMutation\(taskId\);[\s\S]*catch \(error\) \{[\s\S]*setModalStatus\(String\(error\?\.message \|\| 'Invoegen in agenda mislukt\.'\), 'error'\);[\s\S]*finally \{[\s\S]*setModalBusy\(false\);/s
  );
  assert.match(pageSource, /function finalizeLeadMutation\(taskId\) \{[\s\S]*closeLeadModal\(\);/s);
});
