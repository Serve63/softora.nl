const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('coldmailing exposes mail-interest follow-ups outside the coldcalling leads inbox', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '../../server/routes/coldmailing.js'), 'utf8');
  const leadsPageSource = fs.readFileSync(path.join(__dirname, '../../premium-ai-coldmailing.html'), 'utf8');
  const sidebarSource = fs.readFileSync(path.join(__dirname, '../../assets/personnel-theme.js'), 'utf8');

  assert.match(routeSource, /app\.get\('\/api\/coldmailing\/replies\/follow-ups'/);
  assert.match(routeSource, /coldmailCampaignService\.listColdmailReplyFollowUps/);
  assert.match(routeSource, /campaignType:\s*req\.query\.campaignType \|\| req\.query\.campaign \|\| req\.query\.source/);
  assert.doesNotMatch(leadsPageSource, /\/api\/coldmailing\/replies\/follow-ups/);
  assert.doesNotMatch(sidebarSource, /\/api\/coldmailing\/replies\/follow-ups/);
});

test('coldmailing exposes token-protected one-click unsubscribe without admin auth', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '../../server/routes/coldmailing.js'), 'utf8');

  assert.match(routeSource, /app\.post\('\/api\/coldmailing\/unsubscribe'/);
  assert.match(routeSource, /unsubscribeColdmailRecipient/);
  assert.doesNotMatch(routeSource, /app\.post\('\/api\/coldmailing\/unsubscribe', requirePremiumAdminApiAccess/);
  assert.match(routeSource, /INVALID_UNSUBSCRIBE_TOKEN/);
});

test('coldmailing exposes token-protected open tracking pixel without admin auth', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '../../server/routes/coldmailing.js'), 'utf8');

  assert.match(routeSource, /app\.get\('\/api\/coldmailing\/open\.gif'/);
  assert.match(routeSource, /recordColdmailOpen/);
  assert.doesNotMatch(routeSource, /app\.get\('\/api\/coldmailing\/open\.gif', requirePremiumAdminApiAccess/);
  assert.match(routeSource, /Cache-Control/);
  assert.match(routeSource, /image\/gif/);
});

test('coldmailing maps overlapping campaign sends to conflict status', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '../../server/routes/coldmailing.js'), 'utf8');

  assert.match(routeSource, /COLDMAIL_SEND_IN_PROGRESS/);
  assert.match(routeSource, /\?\s*409/);
});

test('coldmailing exposes protected dispatch for due scheduled sends', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '../../server/routes/coldmailing.js'), 'utf8');

  assert.match(routeSource, /app\.post\('\/api\/coldmailing\/campaigns\/dispatch-due', requirePremiumAdminApiAccess/);
  assert.match(routeSource, /dispatchColdmailScheduledQueue/);
});
