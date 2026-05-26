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
  assert.match(pageSource, /<div class="mail-sync-status" id="mail-sync-status" hidden><\/div>/);
  assert.match(pageSource, /\.topbar-mailbox-switcher-label \{[\s\S]*font-size:\s*14px;[\s\S]*color:\s*var\(--text-light\);[\s\S]*text-transform:\s*uppercase;/);
  assert.match(pageSource, /\.topbar-mailbox-menu \{[\s\S]*position:\s*absolute;[\s\S]*display:\s*none;/);
  assert.match(pageSource, /<script src="assets\/premium-mailbox\.js\?v=20260522a"><\/script>/);
  assert.match(scriptSource, /const MAILBOX_ACCOUNT_DEFAULT = 'info@softora\.nl';/);
  assert.match(scriptSource, /\/api\/mailbox\/accounts/);
  assert.match(scriptSource, /\/api\/mailbox\/messages\?account=/);
  assert.match(scriptSource, /\/api\/mailbox\/message\?/);
  assert.match(scriptSource, /\/api\/mailbox\/sync/);
  assert.match(scriptSource, /\/api\/mailbox\/send/);
  assert.match(scriptSource, /\/api\/coldmailing\/outreach\/status/);
  assert.match(scriptSource, /async function loadMailboxAccounts\(options = \{\}\)/);
  assert.match(scriptSource, /const MAILBOX_LEGACY_ACCOUNT_REPLACEMENTS = Object\.freeze\(\{/);
  assert.match(scriptSource, /'zakelijk@theimpactbox\.co': 'zakelijk@softora\.nl'/);
  assert.match(scriptSource, /function resolveMailboxAccountFromSession\(session, availableEmails\)/);
  assert.match(scriptSource, /async function hydrateAuthenticatedMailboxAccount\(availableEmails\)/);
  assert.match(scriptSource, /\/api\/auth\/session/);
  assert.match(scriptSource, /identityText\.includes\('martijn'\)[\s\S]*'martijn@softora\.nl'/);
  assert.match(scriptSource, /identityText\.includes\('serve'\) \|\| identityText\.includes\('servec'\) \|\| identityText\.includes\('creusen'\)[\s\S]*'serve@softora\.nl'/);
  assert.match(scriptSource, /async function loadMailboxMessages\(options = \{\}\)/);
  assert.match(scriptSource, /void hydrateMailboxOutreachContextsInBackground\(\)\.catch/);
  assert.match(scriptSource, /data\?\.sync\?\.refreshRecommended/);
  assert.match(scriptSource, /async function sendMail\(\)/);
  assert.match(scriptSource, /function getMailboxAccounts\(\) \{\s*return mailboxAccounts\.map\(\(account\) => account\.email\);\s*\}/);
  assert.match(scriptSource, /function getMailboxAccount\(\) \{\s*return activeMailboxAccount;\s*\}/);
  assert.match(scriptSource, /function renderMailboxAccountMenu\(\) \{[\s\S]*data-mailbox-email="\$\{escapeHtml\(email\)\}"/);
  assert.match(scriptSource, /const sessionAccount = options\.preferSession === false[\s\S]*hydrateAuthenticatedMailboxAccount\(availableEmails\);/);
  assert.match(scriptSource, /async function applyMailboxAccount\(email, options = \{\}\) \{[\s\S]*activeMailboxAccount = email;[\s\S]*setMailboxAccountUi\(email\);/);
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
  assert.match(scriptSource, /function renderLinkedMailBody\(value, mail\)/);
  assert.match(scriptSource, /<div class="detail-body-text">\$\{renderLinkedMailBody\(detailBody, m\)\}<\/div>/);
  assert.doesNotMatch(scriptSource, /<div class="detail-body-text">\$\{escapeHtml\(detailBody\)\}<\/div>/);
});

test('premium mailbox maakt veilige links in mailtekst klikbaar', () => {
  const scriptSource = readScript();

  assert.match(scriptSource, /const MAIL_BODY_URL_PATTERN = \/https\?:\\\/\\\/\[\^\\s<>"'\]\+\/gi;/);
  assert.match(scriptSource, /const MAILBOX_SENDER_CTA_LINKS = Object\.freeze/);
  assert.match(scriptSource, /'martijn@softora\.nl': \{\s*text: '💼 Mijn LinkedIn 👈',\s*url: 'https:\/\/www\.linkedin\.com\/in\/martijn-van-de-ven-51a5b61ba\?utm_source=share_via&utm_content=profile&utm_medium=member_ios'/);
  assert.match(scriptSource, /function getMailboxSenderCtaLink\(mail\)/);
  assert.match(scriptSource, /function isSafeMailBodyUrl\(value\)/);
  assert.match(scriptSource, /const parsed = new URL\(value\);/);
  assert.match(scriptSource, /parsed\.protocol === 'http:' \|\| parsed\.protocol === 'https:';/);
  assert.match(scriptSource, /target="_blank" rel="noopener noreferrer"/);
  assert.match(scriptSource, /\$\{escapeHtml\(url\)\}<\/a>\$\{escapeHtml\(suffix\)\}/);
  assert.match(scriptSource, /html = html\.split\(label\)\.join\(link\);/);
  assert.match(scriptSource, /<div class="detail-body-text">\$\{renderLinkedMailBody\(detailBody, m\)\}<\/div>/);
});

test('premium mailbox toont webdesign outreach acties alleen via databasekoppeling', () => {
  const pageSource = readPage();
  const scriptSource = readScript();

  assert.match(pageSource, /\.outreach-quickbar/);
  assert.match(scriptSource, /function hydrateMailboxOutreachContexts\(\)/);
  assert.match(scriptSource, /isWebdesignOutreachCustomer/);
  assert.match(scriptSource, /data-mailbox-action="outreach-status"/);
  assert.match(scriptSource, /Interesse/);
  assert.match(scriptSource, /Geen interesse/);
  assert.match(scriptSource, /mailMatchesOutreachCustomer/);
  assert.match(scriptSource, /collectCustomerMessageKeys/);
});
