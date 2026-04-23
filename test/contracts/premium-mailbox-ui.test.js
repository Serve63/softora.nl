const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium mailbox uses a mailbox account dropdown in the topbar', () => {
  const pagePath = path.join(__dirname, '../../premium-mailbox.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.doesNotMatch(pageSource, /<div class="topbar-title">Mailbox<\/div>/);
  assert.doesNotMatch(pageSource, /<span class="topbar-mailbox-account" id="topbar-mailbox-account"><\/span>/);
  assert.match(pageSource, /<button class="topbar-mailbox-switcher" id="mailbox-account-switcher" type="button" aria-haspopup="menu" aria-expanded="false">/);
  assert.match(pageSource, /<span class="topbar-mailbox-switcher-label" id="topbar-mailbox-account">info@softora\.nl<\/span>/);
  assert.match(pageSource, /<div class="topbar-mailbox-menu" id="mailbox-account-menu" role="menu" aria-label="Mailbox adressen"><\/div>/);
  assert.match(pageSource, /\.topbar-mailbox-switcher-label \{[\s\S]*font-size:\s*14px;[\s\S]*color:\s*var\(--text-light\);[\s\S]*text-transform:\s*uppercase;/);
  assert.match(pageSource, /\.topbar-mailbox-menu \{[\s\S]*position:\s*absolute;[\s\S]*display:\s*none;/);
  assert.match(pageSource, /const MAILBOX_ACCOUNT_DEFAULT = 'info@softora\.nl';/);
  assert.match(pageSource, /'zakelijk@softora\.nl': \[/);
  assert.match(pageSource, /'ruben@softora\.nl': \[/);
  assert.match(pageSource, /'info@softora\.nl': \[/);
  assert.doesNotMatch(pageSource, /'software@softora\.nl': \[/);
  assert.match(pageSource, /function getMailboxAccounts\(\) \{\s*return Object\.keys\(MAILBOX_DEMO_BY_ACCOUNT\);\s*\}/);
  assert.match(pageSource, /function getMailboxAccount\(\) \{\s*return activeMailboxAccount;\s*\}/);
  assert.match(pageSource, /function renderMailboxAccountMenu\(\) \{[\s\S]*data-mailbox-email="\$\{email\}"/);
  assert.match(pageSource, /function applyMailboxAccount\(email\) \{[\s\S]*activeMailboxAccount = email;[\s\S]*setMailboxAccountUi\(email\);/);
  assert.match(pageSource, /mailboxAccountSwitcher\.addEventListener\('click', function\(event\) \{/);
  assert.match(pageSource, /mailboxAccountMenu\.addEventListener\('click', function\(event\) \{[\s\S]*applyMailboxAccount\(email\);/);
});
