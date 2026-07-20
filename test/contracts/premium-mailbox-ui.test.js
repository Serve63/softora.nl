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
const campaignInboxScriptPath = path.join(__dirname, '../../assets/premium-mailbox-campaign-inbox.js');
const campaignInboxModule = require('../../assets/premium-mailbox-campaign-inbox.js');

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

function readCampaignInboxScript() {
  return fs.readFileSync(campaignInboxScriptPath, 'utf8');
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
    SoftoraMailboxCampaignInbox: {
      ...campaignInboxModule,
      load: async () => null,
    },
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
    'window.__mailboxTest = { renderMailBody, normalizeMailboxApiMessage, formatMailDate, requestMailboxDeleteConfirmation, display: window.SoftoraMailboxDisplay }; bindMailboxActions();'
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

test('premium mailbox uses an owner filter in the coldmail topbar', () => {
  const pageSource = readPage();
  const scriptSource = readScript();
  const campaignInboxSource = readCampaignInboxScript();
  const indexSource = readIndexScript();

  assert.doesNotMatch(pageSource, /<div class="topbar-title">Mailbox<\/div>/);
  assert.doesNotMatch(pageSource, /<span class="topbar-mailbox-account" id="topbar-mailbox-account"><\/span>/);
  assert.match(pageSource, /<button class="topbar-mailbox-switcher" id="mailbox-account-switcher" type="button" aria-haspopup="menu" aria-expanded="false">/);
  assert.match(pageSource, /<span class="topbar-mailbox-switcher-label" id="topbar-mailbox-account">Servé &amp; Martijn<\/span>/);
  assert.match(pageSource, /<div class="topbar-mailbox-menu" id="mailbox-account-menu" role="menu" aria-label="Campagne-eigenaar"><\/div>/);
  assert.match(pageSource, /<div class="mail-sync-status" id="mail-sync-status" hidden><\/div>/);
  assert.match(pageSource, /\.topbar-mailbox-switcher-label \{[\s\S]*font-size:\s*14px;[\s\S]*color:\s*var\(--text-light\);[\s\S]*text-transform:\s*uppercase;/);
  assert.match(pageSource, /\.topbar-mailbox-menu \{[\s\S]*position:\s*absolute;[\s\S]*display:\s*none;/);
  assert.match(pageSource, /<script src="assets\/premium-ui-state-client\.js\?v=20260605a"><\/script><script src="assets\/premium-campaign-sender-settings\.js\?v=20260612a"><\/script><script src="assets\/premium-mailbox-outreach\.js\?v=20260720b"><\/script><script src="assets\/premium-mailbox-campaign-inbox\.js\?v=20260720f"><\/script><script src="assets\/premium-mailbox-display\.js\?v=20260720b"><\/script><script src="assets\/premium-mailbox-index\.js\?v=20260720a"><\/script>\s*<script src="assets\/premium-mailbox\.js\?v=20260720h"><\/script>/);
  assert.match(readDisplayScript(), /global\.SoftoraMailboxDisplay =/);
  assert.match(indexSource, /window\.SoftoraMailboxIndex =/);
  assert.match(indexSource, /const MIN_BACKGROUND_SYNC_INTERVAL_MS = 5 \* 60 \* 1000;/);
  assert.match(indexSource, /now - lastBackgroundSyncAt < MIN_BACKGROUND_SYNC_INTERVAL_MS/);
  assert.match(scriptSource, /const MAILBOX_ACCOUNT_DEFAULT = 'info@softora\.nl';/);
  assert.match(scriptSource, /\/api\/mailbox\/accounts/);
  assert.match(scriptSource, /\/api\/mailbox\/messages\?account=/);
  assert.match(scriptSource, /\/api\/mailbox\/messages\/delete/);
  assert.match(scriptSource, /\/api\/mailbox\/send/);
  assert.match(scriptSource, /\/api\/mailbox\/rewrite/);
  assert.doesNotMatch(readOutreachScript(), /\/api\/coldmailing\/outreach\/status/);
  assert.match(scriptSource, /async function loadMailboxAccounts\(\)/);
  assert.match(scriptSource, /async function loadMailboxMessages\(options = \{\}\)/);
  assert.match(scriptSource, /let mailboxSyncState = null;/);
  assert.match(scriptSource, /void hydrateMailboxOutreachContextsInBackground\(\)\.catch/);
  assert.match(scriptSource, /data\?\.sync\?\.refreshRecommended/);
  assert.match(scriptSource, /Mailbox wordt bijgewerkt/);
  assert.match(indexSource, /\/api\/mailbox\/sync/);
  assert.match(indexSource, /\/api\/mailbox\/message/);
  assert.match(scriptSource, /async function sendMail\(\)/);
  assert.match(scriptSource, /const MAILBOX_PIN_SCOPE = 'premium_mailbox_preferences';/);
  assert.match(scriptSource, /const MAILBOX_PIN_KEY = 'softora_mailbox_pinned_account_v1';/);
  assert.match(campaignInboxSource, /const OWNER_PIN_KEY_PREFIX = 'softora_mailbox_pinned_owner_v1_';/);
  assert.match(scriptSource, /window\.SoftoraUiStateClient/);
  assert.match(scriptSource, /async function initializeMailboxAccountPreference\(\)/);
  assert.match(scriptSource, /SoftoraMailboxCampaignInbox\.initializeOwnerPreference\(session, window\.SoftoraUiStateClient, mailboxAccountPreferenceIdentity\)/);
  assert.match(scriptSource, /function getMailboxAccounts\(\) \{\s*return getMailboxAccountEmails\(\);\s*\}/);
  assert.match(scriptSource, /function getMailboxAccount\(\) \{\s*return activeMailboxAccount;\s*\}/);
  assert.match(scriptSource, /SoftoraMailboxCampaignInbox\.renderOwnerMenu\(escapeHtml\)/);
  assert.match(scriptSource, /SoftoraMailboxCampaignInbox\.filterMessages\(mails\)/);
  assert.match(scriptSource, /ownerButton\.dataset\.mailboxOwner/);
  assert.match(campaignInboxSource, /data-mailbox-pin-owner/);
  assert.match(campaignInboxSource, /async function pinOwner\(value, uiStateClient\)/);
  assert.match(campaignInboxSource, /patch: \{ \[getOwnerPinKeyForIdentity\(preferenceIdentity\)\]: pinnedOwner \}/);
  assert.match(scriptSource, /function renderMailboxAccountMenu\(\) \{[\s\S]*data-mailbox-email="\$\{escapeHtml\(email\)\}"/);
  assert.match(scriptSource, /data-mailbox-pin-email="\$\{escapeHtml\(email\)\}"/);
  assert.match(scriptSource, /async function pinMailboxAccount\(email\)/);
  assert.match(scriptSource, /async function applyMailboxAccount\(email, options = \{\}\) \{[\s\S]*activeMailboxAccount = hasMailboxAccount\(normalizedEmail\)[\s\S]*applyMailboxFolderUi\(activeFolder\);[\s\S]*setMailboxAccountUi\(activeMailboxAccount\);/);
  assert.match(scriptSource, /await initializeMailboxAccountPreference\(\);[\s\S]*SoftoraMailboxOutreach\.readIntent\(\)[\s\S]*await loadMailboxAccounts\(\);/);
  assert.match(scriptSource, /mailboxAccountSwitcher\.addEventListener\('click', function\(event\) \{/);
  assert.match(scriptSource, /mailboxAccountMenu\.addEventListener\('click', function\(event\) \{[\s\S]*applyMailboxAccount\(email\);/);
  assert.match(scriptSource, /mailboxAccountMenu\.addEventListener\('click', function\(event\) \{[\s\S]*pinMailboxAccount\(email\);/);
  assert.match(scriptSource, /mailboxAccountMenu\.addEventListener\('click', function\(event\) \{[\s\S]*SoftoraMailboxCampaignInbox\.pinOwner\(ownerButton\.dataset\.mailboxPinOwner, window\.SoftoraUiStateClient\)/);
});

test('coldmail eigenaarfilter koppelt alleen de negen campagneadressen aan Servé en Martijn', () => {
  const messages = [
    { id: 'serve-softora', accountEmail: 'serve@softora.nl', receivedAt: '2026-07-20T09:00:00.000Z' },
    { id: 'serve-alias', accountEmail: 'servecreusen@softora.nl', receivedAt: '2026-07-20T08:00:00.000Z' },
    { id: 'serve-gmail', accountEmail: 'servec321@gmail.com', receivedAt: '2026-07-20T07:00:00.000Z' },
    { id: 'serve-290', accountEmail: 'serve290@gmail.com', receivedAt: '2026-07-20T06:00:00.000Z' },
    { id: 'serve-7', accountEmail: 'servecreusen7@gmail.com', receivedAt: '2026-07-20T05:00:00.000Z' },
    { id: 'martijn-softora', accountEmail: 'martijn@softora.nl', receivedAt: '2026-07-20T04:00:00.000Z' },
    { id: 'martijn-alias', accountEmail: 'martijnvandeven@softora.nl', receivedAt: '2026-07-20T03:00:00.000Z' },
    { id: 'martijn-gmail', accountEmail: 'martijnven123@gmail.com', receivedAt: '2026-07-20T02:00:00.000Z' },
    { id: 'martijn-visuals', accountEmail: 'contact.venvisuals@gmail.com', receivedAt: '2026-07-20T01:00:00.000Z' },
    { id: 'info', accountEmail: 'info@softora.nl' },
    { id: 'ruben', accountEmail: 'ruben@softora.nl' },
    { id: 'zakelijk-softora', accountEmail: 'zakelijk@softora.nl' },
    { id: 'impactbox', accountEmail: 'zakelijk@theimpactbox.co' },
  ];

  campaignInboxModule.setOwner('both');
  assert.equal(campaignInboxModule.getOwnerLabel(), 'Servé & Martijn');
  assert.deepEqual(
    campaignInboxModule.filterMessages(messages).map((message) => message.id),
    messages.slice(0, 9).map((message) => message.id)
  );

  campaignInboxModule.setOwner('servé');
  assert.equal(campaignInboxModule.getOwnerLabel(), 'Servé Creusen');
  assert.deepEqual(
    campaignInboxModule.filterMessages(messages).map((message) => message.id),
    messages.slice(0, 5).map((message) => message.id)
  );

  campaignInboxModule.setOwner('martijn');
  assert.equal(campaignInboxModule.getOwnerLabel(), 'Martijn van de Ven');
  assert.deepEqual(
    campaignInboxModule.filterMessages(messages).map((message) => message.id),
    messages.slice(5, 9).map((message) => message.id)
  );

  const ownerMenu = campaignInboxModule.renderOwnerMenu((value) => String(value));
  assert.match(ownerMenu, />Servé Creusen</);
  assert.match(ownerMenu, />Martijn van de Ven</);
  assert.match(ownerMenu, />Servé & Martijn</);
  assert.ok(ownerMenu.indexOf('Servé Creusen') < ownerMenu.indexOf('Martijn van de Ven'));
  assert.ok(ownerMenu.indexOf('Martijn van de Ven') < ownerMenu.indexOf('Servé & Martijn'));
  assert.doesNotMatch(ownerMenu, /@/);
  campaignInboxModule.setOwner('both');
});

test('coldmail eigenaar kiest per ingelogde gebruiker de eigen mailbox als standaard', () => {
  assert.equal(campaignInboxModule.resolveOwnerForSession({ email: 'serve@softora.nl' }), 'serve');
  assert.equal(campaignInboxModule.resolveOwnerForSession({ email: 'martijn@softora.nl' }), 'martijn');
  assert.equal(campaignInboxModule.resolveOwnerForSession({ displayName: 'Servé Creusen' }), 'serve');
  assert.equal(campaignInboxModule.resolveOwnerForSession({ displayName: 'Martijn van de Ven' }), 'martijn');
  assert.equal(campaignInboxModule.resolveOwnerForSession({ email: 'onbekend@softora.nl' }), 'both');

  const serveMenu = campaignInboxModule.renderOwnerMenu(String, {
    defaultOwner: 'serve',
    pinnedOwner: '',
  });
  const martijnMenu = campaignInboxModule.renderOwnerMenu(String, {
    defaultOwner: 'martijn',
    pinnedOwner: '',
  });
  assert.ok(serveMenu.indexOf('Servé Creusen') < serveMenu.indexOf('Martijn van de Ven'));
  assert.ok(martijnMenu.indexOf('Martijn van de Ven') < martijnMenu.indexOf('Servé Creusen'));
  assert.ok(serveMenu.indexOf('Servé & Martijn') > serveMenu.indexOf('Martijn van de Ven'));
  assert.ok(martijnMenu.indexOf('Servé & Martijn') > martijnMenu.indexOf('Servé Creusen'));
});

test('coldmail eigenaar kan Servé, Martijn of beide persoonlijk vastpinnen', () => {
  for (const owner of ['serve', 'martijn', 'both']) {
    const ownerMenu = campaignInboxModule.renderOwnerMenu(String, {
      defaultOwner: 'serve',
      pinnedOwner: owner,
    });
    assert.match(ownerMenu, new RegExp(`data-mailbox-pin-owner="${owner}"[^>]*[\\s\\S]*?`));
    assert.match(
      ownerMenu,
      new RegExp(`topbar-mailbox-option-row pinned[\\s\\S]*?data-mailbox-pin-owner="${owner}"`)
    );
  }

  const martijnPinnedMenu = campaignInboxModule.renderOwnerMenu(String, {
    defaultOwner: 'serve',
    pinnedOwner: 'martijn',
  });
  assert.ok(martijnPinnedMenu.indexOf('Martijn van de Ven') < martijnPinnedMenu.indexOf('Servé Creusen'));

  const bothPinnedMenu = campaignInboxModule.renderOwnerMenu(String, {
    defaultOwner: 'serve',
    pinnedOwner: 'both',
  });
  assert.ok(bothPinnedMenu.indexOf('Servé & Martijn') > bothPinnedMenu.indexOf('Martijn van de Ven'));
});

test('coldmail eigenaarpin gebruikt een aparte server-state sleutel per gebruikersaccount', () => {
  assert.notEqual(
    campaignInboxModule.getOwnerPinKeyForIdentity('usr_serve'),
    campaignInboxModule.getOwnerPinKeyForIdentity('usr_martijn')
  );
  assert.equal(
    campaignInboxModule.getOwnerPinKeyForIdentity('usr_serve'),
    'softora_mailbox_pinned_owner_v1_usr_serve'
  );
  assert.equal(
    campaignInboxModule.getOwnerPinKeyForIdentity('usr_martijn'),
    'softora_mailbox_pinned_owner_v1_usr_martijn'
  );
});

test('coldmail eigenaarpin leest en schrijft alleen de voorkeur van de actieve gebruiker', async () => {
  const values = {
    softora_mailbox_pinned_owner_v1_usr_serve: 'both',
    softora_mailbox_pinned_owner_v1_usr_martijn: 'martijn',
  };
  const writes = [];
  const client = {
    async get(scope) {
      assert.equal(scope, 'premium_mailbox_preferences');
      return { values };
    },
    async set(scope, body) {
      writes.push({ scope, body });
      Object.assign(values, body.patch);
      return { ok: true };
    },
  };

  const serveState = await campaignInboxModule.initializeOwnerPreference(
    { email: 'serve@softora.nl' },
    client,
    'usr_serve'
  );
  assert.deepEqual(serveState, {
    defaultOwner: 'serve',
    pinnedOwner: 'both',
    activeOwner: 'both',
  });
  const result = await campaignInboxModule.pinOwner('serve', client);
  assert.equal(result.saved, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], {
    scope: 'premium_mailbox_preferences',
    body: {
      patch: { softora_mailbox_pinned_owner_v1_usr_serve: 'serve' },
      source: 'premium-mailbox',
      actor: 'usr_serve',
    },
  });
  assert.equal(values.softora_mailbox_pinned_owner_v1_usr_martijn, 'martijn');
});

test('coldmail inbox sorteert na ieder eigenaarfilter op echte ontvangsttijd met nieuwste bovenaan', () => {
  const messages = [
    { id: 'oud', accountEmail: 'serve@softora.nl', receivedAt: '2026-07-18T14:00:00.000Z' },
    { id: 'nieuw', accountEmail: 'martijn@softora.nl', receivedAt: '2026-07-20T08:00:00.000Z' },
    { id: 'midden', accountEmail: 'servecreusen@softora.nl', receivedAt: '2026-07-19T18:00:00.000Z' },
  ];

  assert.deepEqual(
    campaignInboxModule.filterMessages(messages, 'both').map((message) => message.id),
    ['nieuw', 'midden', 'oud']
  );
  assert.deepEqual(
    campaignInboxModule.filterMessages(messages, 'serve').map((message) => message.id),
    ['midden', 'oud']
  );
});

test('coldmail inbox toont de ontvangsttijd vast in Europe Amsterdam', () => {
  const helpers = loadMailboxHelpersForTest();
  const mail = helpers.normalizeMailboxApiMessage({
    id: 'inbox:101',
    folder: 'inbox',
    from: 'Rijs Textiles',
    email: 'support@rijstextiles.com',
    date: '2026-07-20T06:14:13.000Z',
  });

  assert.equal(mail.receivedAt, '2026-07-20T06:14:13.000Z');
  assert.equal(mail.time, '08:14');
});

test('coldmail inbox zet relatieve datum boven de tijd en oudere mails op dag en maand', () => {
  const helpers = loadMailboxHelpersForTest();
  const now = '2026-07-20T12:00:00.000Z';
  const today = helpers.formatMailDate('2026-07-20T06:14:00.000Z', now);
  const yesterday = helpers.formatMailDate('2026-07-19T14:57:00.000Z', now);
  const dayBeforeYesterday = helpers.formatMailDate('2026-07-18T07:28:00.000Z', now);
  const older = helpers.formatMailDate('2026-07-05T08:21:00.000Z', now);

  assert.equal(today.listDate, '');
  assert.equal(today.time, '08:14');
  assert.equal(yesterday.listDate, 'Gisteren');
  assert.equal(yesterday.time, '16:57');
  assert.equal(dayBeforeYesterday.listDate, 'Eergisteren');
  assert.equal(dayBeforeYesterday.time, '09:28');
  assert.equal(older.listDate, '5 juli');
  assert.equal(older.time, '10:21');
});

test('coldmail lijst toont uitsluitend ongelezen bolletje, afzender en datum met tijd', () => {
  const pageSource = readPage();
  const scriptSource = readScript();
  const renderListSource = scriptSource.match(/function renderList\(\) \{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(renderListSource, /class="unread-dot"/);
  assert.match(renderListSource, /class="mail-from"/);
  assert.match(renderListSource, /class="mail-time"/);
  assert.match(renderListSource, /class="mail-date-label"/);
  assert.match(renderListSource, /class="mail-time-value"/);
  assert.match(renderListSource, /data-mailbox-received-at/);
  assert.doesNotMatch(renderListSource, /class="mail-subject"/);
  assert.doesNotMatch(renderListSource, /class="mail-preview"/);
  assert.doesNotMatch(renderListSource, /renderListMeta/);
  assert.doesNotMatch(pageSource, /\.mail-campaign-meta/);
  assert.match(pageSource, /\.mail-from \{[\s\S]*font-weight:\s*400;/);
  assert.match(pageSource, /\.mail-item\.unread \.mail-from \{\s*font-weight:\s*600;\s*\}/);
  assert.match(pageSource, /\.mail-item \{[\s\S]*min-height:\s*52px;/);
  assert.match(pageSource, /\.unread-dot \{[\s\S]*background:\s*var\(--crimson\);/);
  assert.match(pageSource, /\.mail-items \{[\s\S]*overflow-y:\s*auto;[\s\S]*scrollbar-width:\s*none;[\s\S]*-ms-overflow-style:\s*none;/);
  assert.match(pageSource, /\.mail-items::\-webkit\-scrollbar \{[\s\S]*display:\s*none;/);
  assert.match(pageSource, /\.mail-time \{[\s\S]*flex-direction:\s*column;[\s\S]*align-items:\s*flex-end;/);
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

test('premium mailbox toont geen interne mappen-sidebar meer', () => {
  const pageSource = readPage();

  assert.doesNotMatch(pageSource, /class="mail-sidebar"/);
  assert.doesNotMatch(pageSource, /class="folder-item/);
  assert.doesNotMatch(pageSource, /data-mailbox-folder=/);
  assert.doesNotMatch(pageSource, />Losse mailbox</);
  assert.doesNotMatch(pageSource, /\.mail-sidebar\s*\{/);
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
  assert.match(scriptSource, /body: JSON\.stringify\(\{[\s\S]*account: window\.SoftoraMailboxCampaignInbox\.getAccount\(mail, activeMailboxAccount\),[\s\S]*id: requestId,[\s\S]*uid: mail\.uid,[\s\S]*folder: window\.SoftoraMailboxCampaignInbox\.getFolder\(mail, activeFolder\),/);
  assert.match(scriptSource, /catch \(error\) \{[\s\S]*mail\.unread = true;[\s\S]*renderList\(\);[\s\S]*toast\(String\(error\?\.message/);
  assert.match(scriptSource, /function openMail\(id, options = \{\}\) \{[\s\S]*const wasUnread = m\.unread;[\s\S]*m\.unread = false;[\s\S]*renderList\(\);[\s\S]*if \(wasUnread\) void persistMailReadState\(m\);/);
  assert.match(scriptSource, /Gelezen status opslaan mislukt/);
});

test('premium mailbox vraagt bevestiging en verwijdert pas na een geslaagde mailbox API-call', async () => {
  const scriptSource = readScript();

  assert.match(scriptSource, /async function deleteMail\(id\) \{[\s\S]*\/api\/mailbox\/messages\/delete/);
  assert.match(scriptSource, /if \(!\(await requestMailboxDeleteConfirmation\(m\)\)\) return;/);
  assert.match(scriptSource, /async function requestMailboxDeleteConfirmation\(mail\)/);
  assert.match(scriptSource, /SoftoraDialogs\.confirm\(message, options\)/);
  assert.match(scriptSource, /window\.confirm\(message\)/);
  assert.match(scriptSource, /method:\s*'POST'/);
  assert.match(scriptSource, /body: JSON\.stringify\(\{[\s\S]*account: window\.SoftoraMailboxCampaignInbox\.getAccount\(m, activeMailboxAccount\),[\s\S]*id: window\.SoftoraMailboxCampaignInbox\.getRequestId\(m\),[\s\S]*uid: m\.uid,[\s\S]*folder: window\.SoftoraMailboxCampaignInbox\.getFolder\(m, activeFolder\),/);
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
  assert.match(scriptSource, /<div class="detail-body-text">\$\{renderMailBody\(detailBody, m\.bodyImages, \{ optOutUrl: m\.optOutUrl, mail: m \}\)\}<\/div>/);
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
    'Hieronder zie je een korte indruk van de eerste versie op verschillende schermen.',
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
  assert.doesNotMatch(pageSource, /data-mailbox-action="open-compose"/);
  assert.doesNotMatch(pageSource, /id="search-input"/);
  assert.doesNotMatch(pageSource, /class="topbar-search"/);
  assert.doesNotMatch(pageSource, /class="btn-compose"/);
  assert.match(pageSource, /data-mailbox-action="rewrite-compose"/);
  assert.doesNotMatch(pageSource, /data-mailbox-action="set-folder"/);
  assert.match(scriptSource, /data-mailbox-action="open-mail"/);
  assert.doesNotMatch(scriptSource, /data-mailbox-action="toggle-star"/);
  assert.doesNotMatch(scriptSource, />\s*Markeren\s*</);
  assert.match(scriptSource, /data-mailbox-action="reply-mail"/);
  assert.match(scriptSource, /function escapeHtml\(value\)/);
  assert.match(scriptSource, /function renderLinkedMailboxText\(value, options\)/);
  assert.match(scriptSource, /renderLinkedMailboxText\(value, options\)/);
  assert.match(scriptSource, /<div class="detail-body-text">\$\{renderMailBody\(detailBody, m\.bodyImages, \{ optOutUrl: m\.optOutUrl, mail: m \}\)\}<\/div>/);
});

test('geopende mail staat als één rustig mailblok met antwoordactie onderaan', () => {
  const pageSource = readPage();
  const scriptSource = readScript();

  assert.match(scriptSource, /<article class="detail-mail-block">/);
  assert.match(scriptSource, /<div class="detail-subject-row">/);
  assert.match(scriptSource, /function formatMailboxDetailSubject\(value\)/);
  assert.match(scriptSource, /replace\(\/\^email received\\s\*\-\\s\*\/i, ''\)/);
  assert.match(scriptSource, /escapeHtml\(formatMailboxDetailSubject\(m\.subject\)\)/);
  assert.doesNotMatch(scriptSource, /detail-more|Meer opties/);
  assert.doesNotMatch(pageSource, /\.detail-more/);
  assert.match(scriptSource, /<div class="detail-divider" aria-hidden="true"><\/div>/);
  assert.match(scriptSource, /<div class="detail-footer">[\s\S]*class="detail-reply"[\s\S]*Beantwoorden/);
  assert.match(scriptSource, /\$\{escapeHtml\(m\.date\)\}, \$\{escapeHtml\(m\.time\)\}/);
  assert.match(pageSource, /\.detail-mail-block \{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*background:\s*var\(--card\);/);
  assert.match(pageSource, /\.detail-mail-block \{[\s\S]*width:\s*min\(100%,\s*900px\);[\s\S]*max-width:\s*900px;[\s\S]*margin:\s*0 auto;/);
  assert.doesNotMatch(pageSource, /\.detail-mail-block \{[^}]*min-height:\s*100%/);
  assert.match(pageSource, /\.detail-body-text \{[\s\S]*background:\s*var\(--card\);[\s\S]*border:\s*0;[\s\S]*font-family:\s*var\(--premium-sidebar-font-sans, 'Inter', sans-serif\);/);
  assert.match(pageSource, /\.detail-subject \{[\s\S]*font-size:\s*clamp\(19px,\s*1\.5vw,\s*24px\);/);
  assert.match(pageSource, /\.detail-avatar \{[\s\S]*width:\s*42px;[\s\S]*height:\s*42px;/);
  assert.match(pageSource, /\.detail-body-text \{[\s\S]*font-size:\s*14px;[\s\S]*line-height:\s*1\.75;/);
  assert.match(pageSource, /\.detail-footer \{[\s\S]*border-top:\s*1px solid var\(--border\);/);
  assert.match(pageSource, /\.detail-reply \{[\s\S]*color:\s*var\(--crimson\);/);
});

test('premium mailbox maakt veilige links in mailtekst klikbaar', () => {
  const scriptSource = readScript();
  const html = renderMailboxBodyForTest([
    'Click the following link:',
    'https://dashboard.render.com/email-reset/confirm?token=fake-token-123.',
    '<script>alert("xss")</script>',
  ].join('\n'));

  assert.match(scriptSource, /const MAIL_BODY_URL_PATTERN = \/https\?:\\\/\\\/\[\^\\s<>"'\]\+\/gi;/);
  assert.match(readDisplayScript(), /const SENDER_CTA_LINKS = Object\.freeze\(\{\}\);/);
  assert.match(readDisplayScript(), /function getSenderCtaLink\(options\)/);
  assert.match(scriptSource, /function isSafeMailBodyUrl\(value\)/);
  assert.match(scriptSource, /const parsed = new URL\(value\);/);
  assert.match(scriptSource, /parsed\.protocol === 'http:' \|\| parsed\.protocol === 'https:';/);
  assert.match(html, /<a href="https:\/\/dashboard\.render\.com\/email-reset\/confirm\?token=fake-token-123" target="_blank" rel="noopener noreferrer">https:\/\/dashboard\.render\.com\/email-reset\/confirm\?token=fake-token-123<\/a>\./);
  assert.match(html, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  const linkedCtaHtml = renderMailboxBodyForTest('💼 Mijn LinkedIn 👈', [], { senderEmail: 'martijn@softora.nl' });
  assert.match(linkedCtaHtml, /💼 Mijn LinkedIn 👈/);
  assert.doesNotMatch(linkedCtaHtml, /linkedin\.com/i);
});

test('premium mailbox houdt databasekoppeling zonder interessebalk in het maildetail', () => {
  const pageSource = readPage();
  const scriptSource = readScript();
  const indexSource = readIndexScript();
  const outreachSource = readOutreachScript();
  const campaignInboxSource = readCampaignInboxScript();

  assert.doesNotMatch(pageSource, /\.outreach-quickbar/);
  assert.match(pageSource, /premium-mailbox-outreach\.js\?v=20260720b/);
  assert.match(indexSource, /SoftoraMailboxOutreach\.hydrate/);
  assert.doesNotMatch(scriptSource, /SoftoraMailboxOutreach\.renderQuickbar/);
  assert.doesNotMatch(scriptSource, /SoftoraMailboxOutreach\.handleAction/);
  assert.match(outreachSource, /global\.SoftoraMailboxOutreach = mailboxOutreachApi/);
  assert.match(outreachSource, /isWebdesignOutreachCustomer/);
  assert.doesNotMatch(outreachSource, /Webdesign-reactie/);
  assert.doesNotMatch(outreachSource, /data-mailbox-action="outreach-status"/);
  assert.doesNotMatch(outreachSource, /data-outreach-status/);
  assert.match(outreachSource, /mailMatchesOutreachCustomer/);
  assert.match(outreachSource, /collectCustomerMessageKeys/);
  assert.match(outreachSource, /function shouldSelectFirstMailboxMatch\(value\)/);
  assert.match(outreachSource, /function mailHasEmail\(mail, email\)/);
  assert.match(outreachSource, /selectFirst: shouldSelectFirstMailboxMatch\(params\.get\('select'\) \|\| params\.get\('openFirst'\) \|\| ''\)/);
  assert.match(outreachSource, /intent\.email && mailHasEmail\(mail, intent\.email\)/);
  assert.match(outreachSource, /helpers\.toast\('Geen exacte thread gevonden, ik zoek op e-mailadres'\);/);
  assert.match(outreachSource, /helpers && helpers\.toast && !intent\.selectFirst/);
});

test('premium mailbox gebruikt Softora Inter voor het onderwerp en toont alleen het campagneadres', () => {
  const pageSource = readPage();
  const campaignInboxSource = readCampaignInboxScript();
  const accountHtml = campaignInboxModule.renderDetailAccount({
    campaign: { company: 'Rijs Textiles B.V.' },
    accountEmail: 'serve@softora.nl',
  }, (value) => String(value));

  assert.match(pageSource, /\.detail-subject \{[\s\S]*font-family:\s*var\(--premium-sidebar-font-sans, 'Inter', sans-serif\);[\s\S]*font-weight:\s*700;[\s\S]*letter-spacing:\s*0;/);
  assert.doesNotMatch(pageSource, /\.detail-subject \{[^}]*Barlow Condensed/);
  assert.equal(accountHtml, '<div class="detail-campaign-account">serve@softora.nl</div>');
  assert.doesNotMatch(campaignInboxSource, /Binnengekomen via/);
});

test('coldmail inbox isoleert alleen gekoppelde eigen campagne-reacties over alle afzenderaccounts', () => {
  const pageSource = readPage();
  const scriptSource = readScript();
  const indexSource = readIndexScript();
  const outreachSource = readOutreachScript();
  const campaignInboxSource = readCampaignInboxScript();

  assert.doesNotMatch(pageSource, /class="mail-sidebar"/);
  assert.doesNotMatch(pageSource, /data-mailbox-folder=/);
  assert.match(scriptSource, /let activeFolder = 'outreach';/);
  assert.match(scriptSource, /SoftoraMailboxCampaignInbox\?\.load/);
  assert.match(campaignInboxSource, /\/api\/mailbox\/campaign-replies\?limit=100/);
  assert.match(campaignInboxSource, /function getAccount\(mail, fallbackAccount\)/);
  assert.match(campaignInboxSource, /function getRequestId\(mail\)/);
  assert.match(campaignInboxSource, /async function load\(folder, normalizeMessage, fetchImpl\)/);
  assert.match(indexSource, /id: String\(requestId \|\| id\)/);
  assert.doesNotMatch(campaignInboxSource, /ui-state-get/);
  assert.match(outreachSource, /folder: normalizeText\(params\.get\('folder'\) \|\| 'outreach'\)/);
});

test('coldmail inbox laadt echte gekoppelde mailboxberichten via de campagne-replies route', async () => {
  const calls = [];
  const messages = [
    {
      id: 'inbox:42',
      mailboxId: 'inbox:42',
      accountEmail: 'serve@softora.nl',
      folder: 'inbox',
      from: 'Studio Noord',
      email: 'info@studionoord.nl',
      subject: 'Re: Nieuw webdesign',
      preview: 'Kunnen we morgen bellen?',
      date: '2026-07-20T10:15:00.000Z',
      unread: true,
      campaign: {
        company: 'Studio Noord',
        account: 'serve@softora.nl',
        customerId: 'softora-pending',
        status: 'reactie_ontvangen',
        actionRequired: true,
      },
    },
    {
      id: 'inbox:77',
      mailboxId: 'inbox:77',
      accountEmail: 'martijn@softora.nl',
      folder: 'inbox',
      from: 'Bakkerij De Kroon',
      email: 'contact@dekroon.nl',
      subject: 'Re: Nieuw webdesign',
      preview: 'Geen interesse.',
      date: '2026-07-19T15:45:00.000Z',
      unread: false,
      campaign: {
        company: 'Bakkerij De Kroon',
        account: 'martijn@softora.nl',
        customerId: 'softora-handled',
        status: 'geen_interesse',
        actionRequired: false,
      },
    },
  ];
  const result = await campaignInboxModule.load('outreach', (message) => message, async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      json: async () => ({
        ok: true,
        messages,
        sync: {
          indexed: true,
          source: 'campaign-replies-index',
        },
      }),
    };
  });

  assert.equal(result.messages.length, 2);
  assert.deepEqual(
    Array.from(result.messages, (reply) => reply.accountEmail),
    ['serve@softora.nl', 'martijn@softora.nl']
  );
  assert.equal(result.messages[0].mailboxId, 'inbox:42');
  assert.equal(result.messages[0].campaign.actionRequired, true);
  assert.equal(result.messages[1].campaign.actionRequired, false);
  assert.equal(result.sync.source, 'campaign-replies-index');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/mailbox/campaign-replies?limit=100');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.doesNotMatch(calls[0].url, /ui-state-get/);
  assert.equal(await campaignInboxModule.load('inbox', (message) => message), null);
});
