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
  assert.match(pageSource, /<script src="assets\/premium-mailbox\.js\?v=20260427a"><\/script>/);
  assert.match(scriptSource, /const MAILBOX_ACCOUNT_DEFAULT = 'info@softora\.nl';/);
  assert.match(scriptSource, /\/api\/mailbox\/accounts/);
  assert.match(scriptSource, /\/api\/mailbox\/messages\?account=/);
  assert.match(scriptSource, /\/api\/mailbox\/messages\/read/);
  assert.match(scriptSource, /\/api\/mailbox\/send/);
  assert.match(scriptSource, /async function loadMailboxAccounts\(\)/);
  assert.match(scriptSource, /async function loadMailboxMessages\(\)/);
  assert.match(scriptSource, /async function markMailRead\(m\) \{/);
  assert.match(scriptSource, /async function sendMail\(\)/);
  assert.match(scriptSource, /function getMailboxAccounts\(\) \{\s*return mailboxAccounts\.map\(\(account\) => account\.email\);\s*\}/);
  assert.match(scriptSource, /function getMailboxAccount\(\) \{\s*return activeMailboxAccount;\s*\}/);
  assert.match(scriptSource, /function renderMailboxAccountMenu\(\) \{[\s\S]*data-mailbox-email="\$\{escapeHtml\(email\)\}"/);
  assert.match(scriptSource, /async function applyMailboxAccount\(email\) \{[\s\S]*activeMailboxAccount = email;[\s\S]*setMailboxAccountUi\(email\);/);
  assert.match(scriptSource, /mailboxAccountSwitcher\.addEventListener\('click', function\(event\) \{/);
  assert.match(scriptSource, /mailboxAccountMenu\.addEventListener\('click', function\(event\) \{[\s\S]*applyMailboxAccount\(email\);/);
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
  assert.match(scriptSource, /uid: Number\(message\.uid\) \|\| 0/);
  assert.match(scriptSource, /const wasUnread = m\.unread;/);
  assert.match(scriptSource, /void markMailRead\(m\)\.catch/);
  assert.match(scriptSource, /body: JSON\.stringify\(\{\s*account: activeMailboxAccount,\s*folder: m\.folder \|\| activeFolder,\s*uid: m\.uid,/);
  assert.match(scriptSource, /<div class="detail-body-text">\$\{escapeHtml\(m\.body\)\}<\/div>/);
});
