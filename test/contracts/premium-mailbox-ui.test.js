const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pagePath = path.join(__dirname, '../../premium-mailbox.html');
const scriptPath = path.join(__dirname, '../../assets/premium-mailbox.js');
const outreachScriptPath = path.join(__dirname, '../../assets/premium-mailbox-outreach.js');

function readPage() {
  return fs.readFileSync(pagePath, 'utf8');
}

function readScript() {
  return fs.readFileSync(scriptPath, 'utf8');
}

function readOutreachScript() {
  return fs.readFileSync(outreachScriptPath, 'utf8');
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
  assert.match(pageSource, /<script src="assets\/premium-ui-state-client\.js\?v=20260427a"><\/script><script src="assets\/premium-campaign-sender-settings\.js\?v=20260513a"><\/script><script src="assets\/premium-mailbox-outreach\.js\?v=20260516a"><\/script>\s*<script src="assets\/premium-mailbox\.js\?v=20260518d"><\/script>/);
  assert.match(scriptSource, /const MAILBOX_ACCOUNT_DEFAULT = 'info@softora\.nl';/);
  assert.match(scriptSource, /\/api\/mailbox\/accounts/);
  assert.match(scriptSource, /\/api\/mailbox\/messages\?account=/);
  assert.match(scriptSource, /\/api\/mailbox\/send/);
  assert.match(scriptSource, /\/api\/mailbox\/rewrite/);
  assert.match(readOutreachScript(), /\/api\/coldmailing\/outreach\/status/);
  assert.match(scriptSource, /async function loadMailboxAccounts\(\)/);
  assert.match(scriptSource, /async function loadMailboxMessages\(\)/);
  assert.match(scriptSource, /async function sendMail\(\)/);
  assert.match(scriptSource, /const MAILBOX_PIN_SCOPE = 'premium_mailbox_preferences';/);
  assert.match(scriptSource, /const MAILBOX_PIN_KEY = 'softora_mailbox_pinned_account_v1';/);
  assert.match(scriptSource, /window\.SoftoraUiStateClient/);
  assert.match(scriptSource, /async function initializeMailboxAccountPreference\(\)/);
  assert.match(scriptSource, /function getMailboxAccounts\(\) \{\s*return getMailboxAccountEmails\(\);\s*\}/);
  assert.match(scriptSource, /function getMailboxAccount\(\) \{\s*return activeMailboxAccount;\s*\}/);
  assert.match(scriptSource, /function renderMailboxAccountMenu\(\) \{[\s\S]*data-mailbox-email="\$\{escapeHtml\(email\)\}"/);
  assert.match(scriptSource, /data-mailbox-pin-email="\$\{escapeHtml\(email\)\}"/);
  assert.match(scriptSource, /async function pinMailboxAccount\(email\)/);
  assert.match(scriptSource, /async function applyMailboxAccount\(email, options = \{\}\) \{[\s\S]*activeMailboxAccount = hasMailboxAccount\(normalizedEmail\)[\s\S]*applyMailboxFolderUi\(activeFolder\);[\s\S]*setMailboxAccountUi\(activeMailboxAccount\);/);
  assert.match(scriptSource, /await initializeMailboxAccountPreference\(\);[\s\S]*SoftoraMailboxOutreach\.readIntent\(\)[\s\S]*await loadMailboxAccounts\(\);/);
  assert.match(scriptSource, /mailboxAccountSwitcher\.addEventListener\('click', function\(event\) \{/);
  assert.match(scriptSource, /mailboxAccountMenu\.addEventListener\('click', function\(event\) \{[\s\S]*applyMailboxAccount\(email\);/);
  assert.match(scriptSource, /mailboxAccountMenu\.addEventListener\('click', function\(event\) \{[\s\S]*pinMailboxAccount\(email\);/);
});

test('premium mailbox houdt account-dropdown zichtbaar boven de inbox-layout', () => {
  const pageSource = readPage();

  assert.match(pageSource, /\.topbar \{[\s\S]*overflow:\s*visible;[\s\S]*position:\s*relative;[\s\S]*z-index:\s*40;/);
  assert.match(pageSource, /\.topbar-title-wrap \{[\s\S]*position:\s*relative;[\s\S]*z-index:\s*45;/);
  assert.match(pageSource, /\.topbar-mailbox-menu \{[\s\S]*max-height:\s*min\(320px,\s*calc\(100vh - 90px\)\);[\s\S]*overflow-y:\s*auto;[\s\S]*z-index:\s*60;/);
  assert.match(pageSource, /\.topbar-mailbox-option-row \{[\s\S]*display:\s*flex;[\s\S]*align-items:\s*center;/);
  assert.match(pageSource, /\.topbar-mailbox-pin\.active \{[\s\S]*color:\s*var\(--crimson\);/);
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

test('premium mailbox compose gebruikt Softora styling zonder dubbele verwijderknop', () => {
  const pageSource = readPage();

  assert.match(pageSource, /\.compose-head \{[\s\S]*background:\s*var\(--crimson\);/);
  assert.match(pageSource, /\.compose-footer \{[\s\S]*justify-content:\s*space-between;/);
  assert.match(pageSource, /\.btn-rewrite-compose \{[\s\S]*color:\s*var\(--crimson\);/);
  assert.match(pageSource, /data-mailbox-action="rewrite-compose">Verwoord dit beter<\/button>/);
  assert.match(pageSource, /<button class="compose-x" type="button" data-mailbox-action="close-compose" aria-label="Sluiten">×<\/button>/);
  assert.doesNotMatch(pageSource, /class="btn-discard"/);
  assert.doesNotMatch(pageSource, />Verwijderen<\/button>/);
});

test('premium mailbox kan conceptantwoord met mailcontext laten herschrijven', () => {
  const pageSource = readPage();
  const scriptSource = readScript();

  assert.match(pageSource, /data-mailbox-action="rewrite-compose">Verwoord dit beter<\/button>/);
  assert.match(scriptSource, /let composeReplyContext = null;/);
  assert.match(scriptSource, /function buildComposeRewriteContext\(\)/);
  assert.match(scriptSource, /async function rewriteComposeBody\(\)/);
  assert.match(scriptSource, /\/api\/mailbox\/rewrite/);
  assert.match(scriptSource, /function loadMailboxSenderProfile\(\)/);
  assert.match(scriptSource, /SoftoraCampaignSenderSettings\.loadProfileForSender/);
  assert.match(scriptSource, /const senderProfile = await loadMailboxSenderProfile\(\);/);
  assert.match(scriptSource, /senderProfile,/);
  assert.match(scriptSource, /context: buildComposeRewriteContext\(\)/);
  assert.match(scriptSource, /case 'rewrite-compose':[\s\S]*void rewriteComposeBody\(\);/);
  assert.match(scriptSource, /function replyMail\(mail\) \{[\s\S]*setComposeReplyContext\(mail\);/);
  assert.match(scriptSource, /bodyField\.value = rewritten;/);
});

test('premium mailbox bewaart gelezen status via de mailbox API', () => {
  const scriptSource = readScript();

  assert.match(scriptSource, /uid: message\.uid,/);
  assert.match(scriptSource, /async function persistMailReadState\(mail\) \{[\s\S]*\/api\/mailbox\/messages\/read/);
  assert.match(scriptSource, /body: JSON\.stringify\(\{[\s\S]*account: activeMailboxAccount,[\s\S]*id: mail\.id,[\s\S]*uid: mail\.uid,[\s\S]*folder: mail\.folder \|\| activeFolder,/);
  assert.match(scriptSource, /catch \(error\) \{[\s\S]*mail\.unread = true;[\s\S]*renderList\(\);[\s\S]*toast\(String\(error\?\.message/);
  assert.match(scriptSource, /function openMail\(id\) \{[\s\S]*const wasUnread = m\.unread;[\s\S]*m\.unread = false;[\s\S]*if \(wasUnread\) void persistMailReadState\(m\);/);
  assert.match(scriptSource, /Gelezen status opslaan mislukt/);
});

test('premium mailbox ruimt technische mail-links op voor weergave', () => {
  const scriptSource = readScript();

  assert.match(scriptSource, /function cleanMailboxText\(value\)/);
  assert.match(scriptSource, /function isMailboxReplyHeaderLine\(line\)/);
  assert.match(scriptSource, /function buildMailboxBodySections\(value\)/);
  assert.match(scriptSource, /function renderMailboxInlineImage\(image\)/);
  assert.match(scriptSource, /function renderMailboxTextLine\(line\)/);
  assert.match(scriptSource, /function isMailboxSafeOptOutUrl\(value\)/);
  assert.match(scriptSource, /function normalizeMailboxImageLabel\(value\)/);
  assert.match(scriptSource, /function isMailboxMockupImageLabel\(value\)/);
  assert.match(scriptSource, /function isMailboxWebdesignImageLabel\(value\)/);
  assert.match(scriptSource, /function sectionHasMailboxImagePlaceholder\(section\)/);
  assert.match(scriptSource, /function renderUnusedMailboxInlineImages\(imageState\)/);
  assert.match(scriptSource, /function normalizeMailboxBodyImages\(images\)/);
  assert.match(scriptSource, /function renderMailboxBodySection\(section, imageState\)/);
  assert.match(scriptSource, /function renderMailBody\(value, images\)/);
  assert.match(scriptSource, /section\.type === 'signature'/);
  assert.match(scriptSource, /const hasImagePlaceholders = sections\.some\(sectionHasMailboxImagePlaceholder\);/);
  assert.match(scriptSource, /if \(!hasImagePlaceholders && !injectedImages && section && section\.type === 'signature'\)/);
  assert.match(scriptSource, /usedImages\.add\(imageEntry\.index\);/);
  assert.match(scriptSource, /if \(imageAlt\) \{[\s\S]*flushParagraph\(\);[\s\S]*return;/);
  assert.match(scriptSource, /detail-mail-section-images/);
  assert.match(scriptSource, /detail-mail-optout-link/);
  assert.match(scriptSource, /MAILBOX_WEBDESIGN_MOCKUP_CAPTION/);
  assert.match(scriptSource, /sendgrid\\\.net/);
  assert.match(scriptSource, /cdn\.openai\.com/);
  assert.match(scriptSource, /Eerdere mail/);
  assert.match(scriptSource, /const bodyImages = normalizeMailboxBodyImages\(message\.bodyImages\);/);
  assert.match(scriptSource, /cleanMailboxText\(message\.body \|\| message\.preview \|\| ''\)/);
  assert.match(scriptSource, /<div class="detail-body-text">\$\{renderMailBody\(m\.body, m\.bodyImages\)\}<\/div>/);
  assert.match(scriptSource, /imageAlt = cleaned\.trim\(\)\.match\(\/\^\\\[image:\\s\*\(\[\^\\\]\]\+\)\\\]\$\/i\)/);
});

test('premium mailbox voorkomt horizontale overflow door brede e-mails', () => {
  const pageSource = readPage();

  assert.match(pageSource, /html, body \{[\s\S]*overflow-x:\s*hidden;/);
  assert.match(pageSource, /\.dashboard-layout \{[\s\S]*min-width:\s*0;[\s\S]*overflow:\s*hidden;/);
  assert.match(pageSource, /\.main-content \{[\s\S]*min-width:\s*0;[\s\S]*overflow:\s*hidden;/);
  assert.match(pageSource, /\.mail-page-shell \{[\s\S]*min-width:\s*0;[\s\S]*overflow:\s*hidden;/);
  assert.match(pageSource, /\.layout \{[\s\S]*min-width:\s*0;[\s\S]*overflow:\s*hidden;/);
  assert.match(pageSource, /\.mail-detail \{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/);
  assert.match(pageSource, /\.detail-body \{[\s\S]*overflow-x:\s*hidden;/);
  assert.match(pageSource, /\.detail-body-text \{[\s\S]*overflow-wrap:\s*anywhere;[\s\S]*word-break:\s*break-word;[\s\S]*display:\s*flex;/);
  assert.match(pageSource, /\.detail-mail-optout-link \{[\s\S]*text-decoration:\s*underline;/);
  assert.match(pageSource, /\.detail-mail-image-caption \{[\s\S]*font-weight:\s*600;/);
  assert.match(pageSource, /\.detail-mail-section-quote \{[\s\S]*background:\s*#f8f4ef;[\s\S]*border-left:\s*3px solid rgba\(155,35,85,.24\);/);
  assert.match(pageSource, /\.detail-mail-section-signature \{[\s\S]*border-top:\s*1px dashed var\(--border\);/);
});

test('premium mailbox houdt gedrag uit inline handlers', () => {
  const pageSource = readPage();
  const scriptSource = readScript();

  assert.doesNotMatch(pageSource, /\son[a-z]+=/);
  assert.doesNotMatch(scriptSource, /onclick=/);
  assert.match(pageSource, /data-mailbox-action="open-compose"/);
  assert.match(pageSource, /data-mailbox-action="rewrite-compose"/);
  assert.match(pageSource, /data-mailbox-action="set-folder" data-mailbox-folder="inbox"/);
  assert.match(scriptSource, /data-mailbox-action="open-mail"/);
  assert.match(scriptSource, /data-mailbox-action="toggle-star"/);
  assert.match(scriptSource, /data-mailbox-action="reply-mail"/);
  assert.match(scriptSource, /function escapeHtml\(value\)/);
  assert.match(scriptSource, /<div class="detail-body-text">\$\{renderMailBody\(m\.body, m\.bodyImages\)\}<\/div>/);
});

test('premium mailbox toont webdesign outreach acties alleen via databasekoppeling', () => {
  const pageSource = readPage();
  const scriptSource = readScript();
  const outreachSource = readOutreachScript();

  assert.match(pageSource, /\.outreach-quickbar/);
  assert.match(pageSource, /premium-mailbox-outreach\.js\?v=20260516a/);
  assert.match(scriptSource, /SoftoraMailboxOutreach\.hydrate/);
  assert.match(scriptSource, /SoftoraMailboxOutreach\.renderQuickbar/);
  assert.match(scriptSource, /SoftoraMailboxOutreach\.handleAction/);
  assert.match(outreachSource, /window\.SoftoraMailboxOutreach/);
  assert.match(outreachSource, /isWebdesignOutreachCustomer/);
  assert.match(outreachSource, /data-mailbox-action="outreach-status"/);
  assert.match(outreachSource, /Interesse/);
  assert.match(outreachSource, /Geen interesse/);
  assert.match(outreachSource, /mailMatchesOutreachCustomer/);
  assert.match(outreachSource, /collectCustomerMessageKeys/);
});
