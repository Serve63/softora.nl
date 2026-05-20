const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const pagePath = path.join(__dirname, '../../premium-mailbox.html');
const scriptPath = path.join(__dirname, '../../assets/premium-mailbox.js');
const indexScriptPath = path.join(__dirname, '../../assets/premium-mailbox-index.js');
const displayScriptPath = path.join(__dirname, '../../assets/premium-mailbox-display.js');
const outreachScriptPath = path.join(__dirname, '../../assets/premium-mailbox-outreach.js');

function readPage() {
  return fs.readFileSync(pagePath, 'utf8');
}

function readScript() {
  return fs.readFileSync(scriptPath, 'utf8');
}

function readIndexScript() {
  return fs.readFileSync(indexScriptPath, 'utf8');
}

function readDisplayScript() {
  return fs.readFileSync(displayScriptPath, 'utf8');
}

function readOutreachScript() {
  return fs.readFileSync(outreachScriptPath, 'utf8');
}

function loadMailboxHelpersForTest(options = {}) {
  const element = {
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    dataset: {},
    addEventListener() {},
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    setAttribute() {},
    getAttribute() { return ''; },
    contains() { return false; },
    querySelector() { return null; },
    closest() { return null; },
  };
  const document = {
    readyState: 'complete',
    addEventListener() {},
    getElementById() { return element; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const window = {
    addEventListener() {},
    SoftoraMailboxOutreach: null,
    SoftoraUiStateClient: null,
    SoftoraCampaignSenderSettings: null,
    SoftoraDialogs: options.SoftoraDialogs || null,
    confirm: options.confirm || (() => false),
  };
  const context = {
    URL,
    console,
    document,
    window,
    clearTimeout() {},
    setTimeout() { return 0; },
    fetch: async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        accounts: [{ email: 'serve@softora.nl', imapConfigured: true, smtpConfigured: true }],
        messages: [],
      }),
    }),
  };
  const source = readScript().replace(
    'bindMailboxActions();',
    'window.__mailboxTest = { renderMailBody, normalizeMailboxApiMessage, requestMailboxDeleteConfirmation, display: window.SoftoraMailboxDisplay }; bindMailboxActions();'
  );
  vm.createContext(context);
  vm.runInContext(readDisplayScript(), context);
  vm.runInContext(readIndexScript(), context);
  vm.runInContext(source, context);
  return context.window.__mailboxTest;
}

function renderMailboxBodyForTest(body, images, options) {
  return loadMailboxHelpersForTest().renderMailBody(body, images, options);
}

test('premium mailbox uses a mailbox account dropdown in the topbar', () => {
  const pageSource = readPage();
  const scriptSource = readScript();
  const indexSource = readIndexScript();

  assert.doesNotMatch(pageSource, /<div class="topbar-title">Mailbox<\/div>/);
  assert.doesNotMatch(pageSource, /<span class="topbar-mailbox-account" id="topbar-mailbox-account"><\/span>/);
  assert.match(pageSource, /<button class="topbar-mailbox-switcher" id="mailbox-account-switcher" type="button" aria-haspopup="menu" aria-expanded="false">/);
  assert.match(pageSource, /<span class="topbar-mailbox-switcher-label" id="topbar-mailbox-account">info@softora\.nl<\/span>/);
  assert.match(pageSource, /<div class="topbar-mailbox-menu" id="mailbox-account-menu" role="menu" aria-label="Mailbox adressen"><\/div>/);
  assert.match(pageSource, /<div class="mail-sync-status" id="mail-sync-status" hidden><\/div>/);
  assert.match(pageSource, /\.topbar-mailbox-switcher-label \{[\s\S]*font-size:\s*14px;[\s\S]*color:\s*var\(--text-light\);[\s\S]*text-transform:\s*uppercase;/);
  assert.match(pageSource, /\.topbar-mailbox-menu \{[\s\S]*position:\s*absolute;[\s\S]*display:\s*none;/);
  assert.match(pageSource, /<script src="assets\/premium-ui-state-client\.js\?v=20260427a"><\/script><script src="assets\/premium-campaign-sender-settings\.js\?v=20260513a"><\/script><script src="assets\/premium-mailbox-outreach\.js\?v=20260519a"><\/script><script src="assets\/premium-mailbox-display\.js\?v=20260519a"><\/script><script src="assets\/premium-mailbox-index\.js\?v=20260520a"><\/script>\s*<script src="assets\/premium-mailbox\.js\?v=20260520b"><\/script>/);
  assert.match(readDisplayScript(), /global\.SoftoraMailboxDisplay =/);
  assert.match(indexSource, /window\.SoftoraMailboxIndex =/);
  assert.match(scriptSource, /const MAILBOX_ACCOUNT_DEFAULT = 'info@softora\.nl';/);
  assert.match(scriptSource, /\/api\/mailbox\/accounts/);
  assert.match(scriptSource, /\/api\/mailbox\/messages\?account=/);
  assert.match(scriptSource, /\/api\/mailbox\/messages\/delete/);
  assert.match(scriptSource, /\/api\/mailbox\/send/);
  assert.match(scriptSource, /\/api\/mailbox\/rewrite/);
  assert.match(readOutreachScript(), /\/api\/coldmailing\/outreach\/status/);
  assert.match(scriptSource, /async function loadMailboxAccounts\(\)/);
  assert.match(scriptSource, /async function loadMailboxMessages\(options = \{\}\)/);
  assert.match(scriptSource, /void hydrateMailboxOutreachContextsInBackground\(\)\.catch/);
  assert.match(scriptSource, /data\?\.sync\?\.refreshRecommended/);
  assert.match(indexSource, /\/api\/mailbox\/sync/);
  assert.match(indexSource, /\/api\/mailbox\/message/);
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

test('premium mailbox toont bij verzonden mails de ontvanger als hoofdregel', () => {
  const helpers = loadMailboxHelpersForTest();
  const mail = helpers.normalizeMailboxApiMessage({
    id: 'sent:42',
    folder: 'sent',
    from: 'Servé Creusen',
    email: 'serve@softora.nl',
    to: 'info@jagthuijs.nl',
    subject: 'Nieuw webdesign gemaakt!',
    preview: 'Goedemiddag',
    date: '2026-05-19T17:02:00.000Z',
  });

  assert.equal(mail.to, 'info@jagthuijs.nl');
  assert.equal(helpers.display.getListPrimaryText(mail), 'Aan: info@jagthuijs.nl');
  assert.equal(helpers.display.getDetailPrimaryText(mail), 'Aan: info@jagthuijs.nl');
  assert.equal(helpers.display.getDetailSecondaryText(mail), 'Van: serve@softora.nl');
  assert.equal(helpers.display.getReplyToAddress(mail), 'info@jagthuijs.nl');
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
  assert.match(scriptSource, /function openMail\(id, options = \{\}\) \{[\s\S]*const wasUnread = m\.unread;[\s\S]*m\.unread = false;[\s\S]*if \(wasUnread\) void persistMailReadState\(m\);/);
  assert.match(scriptSource, /Gelezen status opslaan mislukt/);
});

test('premium mailbox bewaart markeringen via de mailbox API', () => {
  const scriptSource = readScript();

  assert.match(scriptSource, /async function toggleStar\(id\)/);
  assert.match(scriptSource, /\/api\/mailbox\/messages\/star/);
  assert.match(scriptSource, /body: JSON\.stringify\(\{[\s\S]*account: activeMailboxAccount,[\s\S]*id: m\.id,[\s\S]*uid: m\.uid,[\s\S]*folder: m\.folder \|\| activeFolder,[\s\S]*starred: next,/);
  assert.match(scriptSource, /function renderAfterStarToggle\(mail\) \{[\s\S]*activeFolder === 'starred' && mail && !mail\.starred[\s\S]*renderList\(\);/);
  assert.match(scriptSource, /catch \(error\) \{[\s\S]*m\.starred = previous;[\s\S]*renderAfterStarToggle\(m\);[\s\S]*Markering opslaan mislukt/);
  assert.match(scriptSource, /case 'toggle-star':[\s\S]*void toggleStar\(id\);/);
  assert.match(scriptSource, /const mail = findMailById\(id\);[\s\S]*folder: \(mail && mail\.folder\) \|\| activeFolder,/);
});

test('premium mailbox vraagt bevestiging en verwijdert pas na een geslaagde mailbox API-call', async () => {
  const scriptSource = readScript();

  assert.match(scriptSource, /async function deleteMail\(id\) \{[\s\S]*\/api\/mailbox\/messages\/delete/);
  assert.match(scriptSource, /if \(!\(await requestMailboxDeleteConfirmation\(m\)\)\) return;/);
  assert.match(scriptSource, /async function requestMailboxDeleteConfirmation\(mail\)/);
  assert.match(scriptSource, /SoftoraDialogs\.confirm\(message, options\)/);
  assert.match(scriptSource, /window\.confirm\(message\)/);
  assert.match(scriptSource, /method:\s*'POST'/);
  assert.match(scriptSource, /body: JSON\.stringify\(\{[\s\S]*account: activeMailboxAccount,[\s\S]*id: m\.id,[\s\S]*uid: m\.uid,[\s\S]*folder: m\.folder \|\| activeFolder,/);
  assert.match(scriptSource, /mails = mails\.filter\(mail => String\(mail\.id\) !== String\(id\)\);/);
  assert.match(scriptSource, /catch \(error\) \{[\s\S]*toast\(String\(error\?\.message \|\| error \|\| 'Mail verwijderen mislukt'\)\);/);
  assert.match(scriptSource, /case 'delete-mail':[\s\S]*void deleteMail\(id\);/);

  const calls = [];
  const helpers = loadMailboxHelpersForTest({
    SoftoraDialogs: {
      confirm: async (message, options) => {
        calls.push({ message, options });
        return false;
      },
    },
  });
  const confirmed = await helpers.requestMailboxDeleteConfirmation({
    subject: 'Nieuw webdesign gemaakt!',
    folder: 'trash',
  });

  assert.equal(confirmed, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].message, /Nieuw webdesign gemaakt!/);
  assert.match(calls[0].message, /definitief verwijderen/);
  assert.equal(calls[0].options.title, 'Mail definitief verwijderen');
  assert.equal(calls[0].options.confirmText, 'Definitief verwijderen');
});

test('premium mailbox ruimt technische mail-links op voor weergave', () => {
  const scriptSource = readScript();

  assert.match(scriptSource, /function cleanMailboxText\(value\)/);
  assert.match(scriptSource, /function isMailboxReplyHeaderLine\(line\)/);
  assert.match(scriptSource, /function buildMailboxBodySections\(value\)/);
  assert.match(scriptSource, /function renderMailboxInlineImage\(image\)/);
  assert.match(scriptSource, /function renderMailboxTextLine\(line, options\)/);
  assert.match(scriptSource, /function isMailboxSafeOptOutUrl\(value\)/);
  assert.match(scriptSource, /function normalizeMailboxImageLabel\(value\)/);
  assert.match(scriptSource, /function isMailboxMockupImageLabel\(value\)/);
  assert.match(scriptSource, /function isMailboxWebdesignImageLabel\(value\)/);
  assert.match(scriptSource, /function sectionHasMailboxImagePlaceholder\(section\)/);
  assert.match(scriptSource, /function renderUnusedMailboxInlineImages\(imageState\)/);
  assert.match(scriptSource, /function normalizeMailboxBodyImages\(images\)/);
  assert.match(scriptSource, /function renderMailboxBodySection\(section, imageState\)/);
  assert.match(scriptSource, /function normalizeMailboxOptOutUrl\(value\)/);
  assert.match(scriptSource, /function renderMailboxOptOutLink\(url\)/);
  assert.match(scriptSource, /function renderMailBody\(value, images, options\)/);
  assert.match(scriptSource, /section\.type === 'signature'/);
  assert.match(scriptSource, /const hasImagePlaceholders = sections\.some\(sectionHasMailboxImagePlaceholder\);/);
  assert.match(scriptSource, /if \(!hasImagePlaceholders && !injectedImages && section && section\.type === 'signature'\)/);
  assert.match(scriptSource, /usedImages\.add\(imageEntry\.index\);/);
  assert.match(scriptSource, /function pushTextLine\(line\)/);
  assert.match(scriptSource, /detail-mail-line-empty/);
  assert.match(scriptSource, /renderedLines\.push\(renderMailboxInlineImage\(imageEntry\.image\)\);/);
  assert.match(scriptSource, /if \(imageAlt\) \{[\s\S]*return;/);
  assert.match(scriptSource, /detail-mail-section-images/);
  assert.match(scriptSource, /detail-mail-optout-link/);
  assert.match(scriptSource, /MAILBOX_WEBDESIGN_MOCKUP_CAPTION/);
  assert.match(scriptSource, /sendgrid\\\.net/);
  assert.match(scriptSource, /cdn\.openai\.com/);
  assert.match(scriptSource, /Eerdere mail/);
  assert.match(scriptSource, /const bodyImages = normalizeMailboxBodyImages\(message\.bodyImages\);/);
  assert.match(scriptSource, /const optOutUrl = normalizeMailboxOptOutUrl\(message\.optOutUrl\);/);
  assert.match(scriptSource, /cleanMailboxText\(message\.body \|\| message\.preview \|\| ''\)/);
  assert.match(scriptSource, /<div class="detail-body-text">\$\{renderMailBody\(detailBody, m\.bodyImages, \{ optOutUrl: m\.optOutUrl \}\)\}<\/div>/);
  assert.match(scriptSource, /imageAlt = cleaned\.trim\(\)\.match\(\/\^\\\[image:\\s\*\(\[\^\\\]\]\+\)\\\]\$\/i\)/);
});

test('premium mailbox behoudt mail-enters en vervangt image placeholders inline', () => {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgo=';
  const body = [
    'Goedemiddag,',
    '',
    'Afgelopen week kwam ik toevallig jullie website (softora.nl) tegen.',
    'Vanuit enthousiasme heb ik een nieuw webdesign voor jullie site gemaakt,',
    'gewoon omdat ik dat leuk vind. 🙂',
    '',
    'Ik ben erg benieuwd wat je ervan vindt!',
    '',
    'Als je wilt, kan ik je ook een linkje sturen, zodat je de site zelf kunt',
    'bekijken en testen.',
    '',
    'Laat me vooral weten of je dat zou willen 🤝',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
    '📍 Haaren',
    '📞 0629917185',
    '',
    '[image: softora.nl webdesign]',
    'Zo zal het design er ongeveer uit gaan zien op mobiel, tablet en laptop👇',
    '[image: Device mockup]',
    '',
    'Geen webdesign willen ontvangen? Laat het me weten!: https://www.softora.nl/afmelden?t=abc',
  ].join('\n');

  const html = renderMailboxBodyForTest(body, [
    { alt: 'Softora Testmodus webdesign.png', dataUrl: tinyPng },
    { alt: 'Softora Testmodus device mockup.png', dataUrl: tinyPng },
  ]);

  assert.equal((html.match(/detail-mail-line-empty/g) || []).length, 7);
  assert.equal((html.match(/<figure class="detail-mail-image">/g) || []).length, 2);
  assert.doesNotMatch(html, /\[image:/i);
  assert.match(html, /detail-mail-optout-link/);
  assert.match(html, /href="https:\/\/www\.softora\.nl\/afmelden\?t=abc"/);
  assert.doesNotMatch(html, />https:\/\/www\.softora\.nl\/afmelden/);
  assert.ok(html.indexOf('0629917185') < html.indexOf('<figure class="detail-mail-image">'));
  assert.ok(html.indexOf('detail-mail-optout-link') > html.lastIndexOf('<figure class="detail-mail-image">'));

  const labelOnlyHtml = renderMailboxBodyForTest(
    'Geen webdesign willen ontvangen? Laat het me weten!',
    [],
    { optOutUrl: 'https://www.softora.nl/afmelden?t=abc' }
  );

  assert.match(labelOnlyHtml, /class="detail-mail-optout-link"/);
  assert.match(labelOnlyHtml, /href="https:\/\/www\.softora\.nl\/afmelden\?t=abc"/);
  assert.doesNotMatch(labelOnlyHtml, />https:\/\/www\.softora\.nl\/afmelden/);
});

test('premium mailbox toont geen mockup als de webdesign-hoofdfoto ontbreekt', () => {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgo=';
  const html = renderMailboxBodyForTest('[image: De Jong Beton webdesign]', [
    { alt: 'De Jong Beton device mockup', dataUrl: tinyPng },
  ]);

  assert.doesNotMatch(html, /<figure class="detail-mail-image">/);
  assert.doesNotMatch(html, /De Jong Beton device mockup/);
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
  assert.match(pageSource, /\.detail-mail-lines \{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*gap:\s*0;/);
  assert.match(pageSource, /\.detail-mail-line \{[\s\S]*min-height:\s*1\.8em;[\s\S]*white-space:\s*pre-wrap;/);
  assert.match(pageSource, /\.detail-mail-line-empty \{[\s\S]*min-height:\s*1\.8em;/);
  assert.match(pageSource, /\.detail-mail-optout-link \{[\s\S]*text-decoration:\s*underline;/);
  assert.match(pageSource, /\.detail-mail-image-caption \{[\s\S]*font-weight:\s*600;/);
  assert.match(pageSource, /\.detail-mail-section-quote \{[\s\S]*background:\s*#f8f4ef;[\s\S]*border-left:\s*3px solid rgba\(155,35,85,.24\);/);
  assert.match(pageSource, /\.detail-mail-section-signature \{[\s\S]*padding-top:\s*16px;[\s\S]*color:\s*var\(--text-mid\);/);
  assert.doesNotMatch(pageSource, /\.detail-mail-section-signature \{[\s\S]*border-top:\s*1px dashed var\(--border\);/);
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
  assert.match(scriptSource, /<div class="detail-body-text">\$\{renderMailBody\(detailBody, m\.bodyImages, \{ optOutUrl: m\.optOutUrl \}\)\}<\/div>/);
});

test('premium mailbox toont webdesign outreach acties alleen via databasekoppeling', () => {
  const pageSource = readPage();
  const scriptSource = readScript();
  const indexSource = readIndexScript();
  const outreachSource = readOutreachScript();

  assert.match(pageSource, /\.outreach-quickbar/);
  assert.match(pageSource, /premium-mailbox-outreach\.js\?v=20260519a/);
  assert.match(indexSource, /SoftoraMailboxOutreach\.hydrate/);
  assert.match(scriptSource, /SoftoraMailboxOutreach\.renderQuickbar/);
  assert.match(scriptSource, /SoftoraMailboxOutreach\.handleAction/);
  assert.match(outreachSource, /window\.SoftoraMailboxOutreach/);
  assert.match(outreachSource, /isWebdesignOutreachCustomer/);
  assert.match(outreachSource, /data-mailbox-action="outreach-status"/);
  assert.match(outreachSource, /Interesse/);
  assert.match(outreachSource, /Geen interesse/);
  assert.match(outreachSource, /mailMatchesOutreachCustomer/);
  assert.match(outreachSource, /collectCustomerMessageKeys/);
  assert.match(outreachSource, /function shouldSelectFirstMailboxMatch\(value\)/);
  assert.match(outreachSource, /function mailHasEmail\(mail, email\)/);
  assert.match(outreachSource, /selectFirst: shouldSelectFirstMailboxMatch\(params\.get\('select'\) \|\| params\.get\('openFirst'\) \|\| ''\)/);
  assert.match(outreachSource, /intent\.email && mailHasEmail\(mail, intent\.email\)/);
  assert.match(outreachSource, /helpers\.toast\('Geen exacte thread gevonden, ik zoek op e-mailadres'\);/);
  assert.match(outreachSource, /helpers && helpers\.toast && !intent\.selectFirst/);
});
