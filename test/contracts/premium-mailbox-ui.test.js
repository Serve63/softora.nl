const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pagePath = path.join(__dirname, '../../premium-mailbox.html');
const scriptPath = path.join(__dirname, '../../assets/premium-mailbox.js');

function readPage() {
  return fs.readFileSync(pagePath, 'utf8');
}

function readScript() {
  return fs.readFileSync(scriptPath, 'utf8');
}

test('premium mailbox uses a mailbox account dropdown in the topbar', () => {
  const pageSource = readPage();
  const scriptSource = readScript();

  assert.doesNotMatch(pageSource, /<div class="topbar-title">Mailbox<\/div>/);
  assert.doesNotMatch(pageSource, /<span class="topbar-mailbox-account" id="topbar-mailbox-account"><\/span>/);
  assert.match(pageSource, /<button class="topbar-mailbox-switcher" id="mailbox-account-switcher" type="button" aria-haspopup="menu" aria-expanded="false">/);
  assert.match(pageSource, /<span class="topbar-mailbox-switcher-label" id="topbar-mailbox-account">info@softora\.nl<\/span>/);
  assert.match(pageSource, /<div class="topbar-mailbox-menu" id="mailbox-account-menu" role="menu" aria-label="Mailbox adressen"><\/div>/);
  assert.match(pageSource, /\.topbar-mailbox-switcher-label \{[\s\S]*font-size:\s*14px;[\s\S]*color:\s*var\(--text-light\);[\s\S]*text-transform:\s*uppercase;/);
  assert.match(pageSource, /\.topbar-mailbox-menu \{[\s\S]*position:\s*absolute;[\s\S]*display:\s*none;/);
  assert.match(pageSource, /<script src="assets\/premium-mailbox\.js\?v=20260506a"><\/script>/);
  assert.match(scriptSource, /const MAILBOX_ACCOUNT_DEFAULT = 'info@softora\.nl';/);
  assert.match(scriptSource, /\/api\/mailbox\/accounts/);
  assert.match(scriptSource, /\/api\/mailbox\/messages\?account=/);
  assert.match(scriptSource, /\/api\/mailbox\/send/);
  assert.match(scriptSource, /async function loadMailboxAccounts\(\)/);
  assert.match(scriptSource, /async function loadMailboxMessages\(\)/);
  assert.match(scriptSource, /async function sendMail\(\)/);
  assert.match(scriptSource, /function getMailboxAccounts\(\) \{\s*return mailboxAccounts\.map\(\(account\) => account\.email\);\s*\}/);
  assert.match(scriptSource, /function getMailboxAccount\(\) \{\s*return activeMailboxAccount;\s*\}/);
  assert.match(scriptSource, /function renderMailboxAccountMenu\(\) \{[\s\S]*data-mailbox-email="\$\{escapeHtml\(email\)\}"/);
  assert.match(scriptSource, /async function applyMailboxAccount\(email\) \{[\s\S]*activeMailboxAccount = email;[\s\S]*setMailboxAccountUi\(email\);/);
  assert.match(scriptSource, /mailboxAccountSwitcher\.addEventListener\('click', function\(event\) \{/);
  assert.match(scriptSource, /mailboxAccountMenu\.addEventListener\('click', function\(event\) \{[\s\S]*applyMailboxAccount\(email\);/);
});

test('premium mailbox inboxbadge volgt de geladen inbox en niet een vast getal', () => {
  const pageSource = readPage();
  const scriptSource = readScript();

  assert.doesNotMatch(pageSource, /id="badge-inbox">3<\/span>/);
  assert.match(pageSource, /<span class="folder-badge" id="badge-inbox" hidden>0<\/span>/);
  assert.match(pageSource, /\.folder-badge\[hidden\] \{\s*display:\s*none;\s*\}/);
  assert.match(scriptSource, /let inboxUnreadCount = 0;/);
  assert.match(scriptSource, /function renderInboxBadge\(\) \{[\s\S]*badge\.textContent = String\(count\);[\s\S]*badge\.hidden = count === 0;/);
  assert.match(scriptSource, /function syncInboxBadgeFromCurrentFolder\(\) \{[\s\S]*if \(activeFolder === 'inbox'\) \{[\s\S]*inboxUnreadCount = mails\.filter\(m => m\.folder === 'inbox' && m\.unread\)\.length;[\s\S]*renderInboxBadge\(\);/);
  assert.match(scriptSource, /function renderList\(\) \{[\s\S]*syncInboxBadgeFromCurrentFolder\(\);[\s\S]*if \(!list\.length\)/);
  assert.match(scriptSource, /catch \(error\) \{[\s\S]*mails = \[\];[\s\S]*syncInboxBadgeFromCurrentFolder\(\);/);
});

test('premium mailbox houdt gedrag uit inline handlers', () => {
  const pageSource = readPage();
  const scriptSource = readScript();

  assert.doesNotMatch(pageSource, /\son[a-z]+=/);
  assert.doesNotMatch(scriptSource, /onclick=/);
  assert.match(pageSource, /data-mailbox-action="open-compose"/);
  assert.match(pageSource, /data-mailbox-action="set-folder" data-mailbox-folder="inbox"/);
  assert.match(scriptSource, /data-mailbox-action="open-mail"/);
  assert.match(scriptSource, /data-mailbox-action="toggle-star"/);
  assert.match(scriptSource, /data-mailbox-action="reply-mail"/);
  assert.match(scriptSource, /function escapeHtml\(value\)/);
  assert.match(scriptSource, /<div class="detail-body-text">\$\{escapeHtml\(m\.body\)\}<\/div>/);
});
