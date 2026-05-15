const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium agenda klantreminder opent de database direct op benaderd met zoeknaam', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /id="wsKlantenLink" href="\/premium-database\?status=benaderd"/);
  assert.doesNotMatch(pageSource, /id="wsKlantenLink" href="\/premium-klanten"/);
  assert.match(pageSource, /Database openen bij Benaderd/);
  assert.match(pageSource, /const wsKlantenLink = document\.getElementById\('wsKlantenLink'\);/);
  assert.match(pageSource, /function buildCustomerDatabaseReminderUrl\(name\)/);
  assert.match(pageSource, /params\.set\('status', 'benaderd'\);/);
  assert.match(pageSource, /if \(customerName\) params\.set\('q', customerName\);/);
  assert.match(pageSource, /wsKlantenLink\.href = buildCustomerDatabaseReminderUrl\(name\);/);
});

test('premium database leest agenda-url en activeert filter plus zoekveld', () => {
  const pagePath = path.join(__dirname, '../../premium-database.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /function applyDatabaseUrlIntent\(\)/);
  assert.match(pageSource, /new URLSearchParams\(window\.location\.search \|\| ""\)/);
  assert.match(pageSource, /\["status", "filter", "tab"\]/);
  assert.match(pageSource, /\["q", "zoek", "search", "customer", "klant", "naam"\]/);
  assert.match(pageSource, /state\.activeStatus = requestedStatus;/);
  assert.match(pageSource, /nodes\.query\.value = requestedQuery;/);
  assert.match(pageSource, /applyDatabaseUrlIntent\(\);\s*renderPage\(\);/);
});
