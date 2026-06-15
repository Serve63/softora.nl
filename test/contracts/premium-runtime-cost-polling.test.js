const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium runtime polling stays cost-aware for coldmail and confirmation dashboards', () => {
  const autopilotSource = fs.readFileSync(
    path.join(__dirname, '../../assets/premium-coldmail-autopilot.js'),
    'utf8'
  );
  const confirmationPageSource = fs.readFileSync(
    path.join(__dirname, '../../premium-bevestigingsmails.html'),
    'utf8'
  );

  assert.match(autopilotSource, /cache: options && options\.method && options\.method !== "GET" \? "no-store" : "default"/);
  assert.match(autopilotSource, /global\.setInterval\(refresh, 300000\);/);
  assert.doesNotMatch(autopilotSource, /global\.setInterval\(refresh, 60000\);/);
  assert.match(confirmationPageSource, /campaignDatabaseRefreshTimer = window\.setInterval\(\(\) => \{[\s\S]*\}, 60000\);/);
  assert.match(confirmationPageSource, /coldmailReplySyncTimer = window\.setInterval\(function \(\) \{[\s\S]*\}, 300000\);/);
});
