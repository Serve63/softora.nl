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
const quotedThreadScriptPath = path.join(__dirname, '../../assets/premium-mailbox-quoted-thread.js');
const signatureScriptPath = path.join(__dirname, '../../assets/premium-mailbox-signature.js');
const messagePresentationScriptPath = path.join(__dirname, '../../assets/premium-mailbox-message-presentation.js');
const logicalDeleteScriptPath = path.join(__dirname, '../../assets/premium-mailbox-logical-delete.js');
const campaignInboxScriptPath = path.join(__dirname, '../../assets/premium-mailbox-campaign-inbox.js');
const imagesScriptPath = path.join(__dirname, '../../assets/premium-mailbox-images.js');
const refreshScriptPath = path.join(__dirname, '../../assets/premium-mailbox-refresh.js');
const composeScriptPath = path.join(__dirname, '../../assets/premium-mailbox-compose.js');
const composeWindowScriptPath = path.join(__dirname, '../../assets/premium-mailbox-compose-window.js');
const composeControllerScriptPath = path.join(__dirname, '../../assets/premium-mailbox-compose-controller.js');
const ownerSessionScriptPath = path.join(__dirname, '../../assets/premium-mailbox-owner-session.js');
const toastScriptPath = path.join(__dirname, '../../assets/premium-mailbox-toast.js');
const listScriptPath = path.join(__dirname, '../../assets/premium-mailbox-list.js');
const deleteScriptPath = path.join(__dirname, '../../assets/premium-mailbox-delete.js');
const readScriptPath = path.join(__dirname, '../../assets/premium-mailbox-read.js');
const uiStateScriptPath = path.join(__dirname, '../../assets/premium-mailbox-ui-state.js');
const detailStabilityScriptPath = path.join(__dirname, '../../assets/premium-mailbox-detail-stability.js');
const ownerSessionModule = require('../../assets/premium-mailbox-owner-session.js');
const provenanceModule = require('../../assets/premium-mailbox-message-provenance.js');
global.SoftoraMailboxMessageProvenance = provenanceModule;
const quotedThreadModule = require('../../assets/premium-mailbox-quoted-thread.js');
const signatureModule = require('../../assets/premium-mailbox-signature.js');
const messagePresentationModule = require('../../assets/premium-mailbox-message-presentation.js');
const logicalDeleteModule = require('../../assets/premium-mailbox-logical-delete.js');
delete global.SoftoraMailboxQuotedThread;
const campaignInboxModule = require('../../assets/premium-mailbox-campaign-inbox.js');
const commonJsCanonicalQuoteBody = campaignInboxModule.stripQuotedReply([
  'Nieuw menselijk antwoord.',
  '',
  'Op 19-08-2026 12:59 schreef Servé Creusen: Geciteerd bericht.',
].join('\n'));
global.SoftoraMailboxQuotedThread = quotedThreadModule;
global.SoftoraMailboxCampaignInbox = campaignInboxModule;
const imagesModule = require('../../assets/premium-mailbox-images.js');
const refreshModule = require('../../assets/premium-mailbox-refresh.js');
const composeModule = require('../../assets/premium-mailbox-compose.js');
const composeWindowModule = require('../../assets/premium-mailbox-compose-window.js');
const composeControllerModule = require('../../assets/premium-mailbox-compose-controller.js');
const toastModule = require('../../assets/premium-mailbox-toast.js');
const listModule = require('../../assets/premium-mailbox-list.js');
const deleteModule = require('../../assets/premium-mailbox-delete.js');
const readModule = require('../../assets/premium-mailbox-read.js');
const uiStateModule = require('../../assets/premium-mailbox-ui-state.js');
const bodySectionModule = require('../../assets/premium-mailbox-body-section.js');
const detailStateModule = require('../../assets/premium-mailbox-detail-state.js');
const detailStabilityModule = require('../../assets/premium-mailbox-detail-stability.js');
const discoveryModule = require('../../assets/premium-mailbox-discovery.js');

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

function readQuotedThreadScript() {
  return fs.readFileSync(quotedThreadScriptPath, 'utf8');
}

function readSignatureScript() {
  return fs.readFileSync(signatureScriptPath, 'utf8');
}

function readMessagePresentationScript() {
  return fs.readFileSync(messagePresentationScriptPath, 'utf8');
}

function readLogicalDeleteScript() {
  return fs.readFileSync(logicalDeleteScriptPath, 'utf8');
}

function readImagesScript() {
  return fs.readFileSync(imagesScriptPath, 'utf8');
}

function readRefreshScript() {
  return fs.readFileSync(refreshScriptPath, 'utf8');
}

function readComposeScript() {
  return fs.readFileSync(composeScriptPath, 'utf8');
}

function readComposeWindowScript() {
  return fs.readFileSync(composeWindowScriptPath, 'utf8');
}

function readComposeControllerScript() {
  return fs.readFileSync(composeControllerScriptPath, 'utf8');
}

function readOwnerSessionScript() {
  return fs.readFileSync(ownerSessionScriptPath, 'utf8');
}

function readToastScript() {
  return fs.readFileSync(toastScriptPath, 'utf8');
}

function readListScript() {
  return fs.readFileSync(listScriptPath, 'utf8');
}

function readDeleteScript() {
  return fs.readFileSync(deleteScriptPath, 'utf8');
}

function readReadScript() {
  return fs.readFileSync(readScriptPath, 'utf8');
}

function readUiStateScript() {
  return fs.readFileSync(uiStateScriptPath, 'utf8');
}

function readDetailStabilityScript() {
  return fs.readFileSync(detailStabilityScriptPath, 'utf8');
}

function loadMailboxImagesModuleForTest(options = {}) {
  const window = {
    Image: options.Image,
    clearTimeout: options.clearTimeout || (() => {}),
    setTimeout: options.setTimeout || (() => 0),
    SoftoraMailboxCampaignInbox: {
      isSafeImageSource: (value) => Boolean(String(value || '').trim()),
    },
  };
  const previousWindow = global.window;
  delete require.cache[require.resolve(imagesScriptPath)];
  global.window = window;
  try {
    return require(imagesScriptPath);
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    delete require.cache[require.resolve(imagesScriptPath)];
  }
}

test('mailbox gebruikt de juiste browsertitel', () => {
  const page = readPage();
  assert.match(page, /<title>Mailbox – Softora\.nl<\/title>/);
  assert.doesNotMatch(page, /Coldmail Inbox/);
  assert.match(page, /assets\/premium-mailbox-quoted-thread\.js\?v=20260822a/);
  assert.match(page, /assets\/premium-mailbox-signature\.js\?v=20260825a/);
  assert.match(page, /assets\/premium-mailbox-message-presentation\.js\?v=20260820b/);
  assert.match(page, /assets\/premium-mailbox-logical-delete\.js\?v=20260820a/);
  assert.match(page, /assets\/premium-mailbox-images\.js\?v=20260821a/);
  assert.match(page, /assets\/premium-mailbox\.js\?v=20260826a/);
  assert.match(page, /assets\/premium-mailbox-discovery\.js\?v=20260826a/);
  assert.match(page, /assets\/premium-browser-storage\.js\?v=20260814a/);
  assert.match(page, /assets\/premium-mailbox-state-outbox\.js\?v=20260826a/);
  assert.match(page, /assets\/premium-mailbox-read\.js\?v=20260826a/);
  assert.match(page, /assets\/premium-mailbox-ui-state\.js\?v=20260826a/);
  assert.match(page, /assets\/premium-mailbox-delete\.js\?v=20260820a/);
  assert.match(page, /assets\/premium-mailbox-body-section\.js\?v=20260818c/);
  assert.match(page, /assets\/premium-mailbox-refresh\.js\?v=20260821a/);
  assert.match(page, /assets\/premium-mailbox-owner-session\.js\?v=20260826a/);
  assert.match(page, /assets\/premium-mailbox-owner-preference\.js\?v=20260822a/);
  assert.match(page, /assets\/premium-mailbox-reply-identity\.js\?v=20260812a/);
  assert.match(page, /assets\/premium-mailbox-campaign-inbox\.js\?v=20260826a/);
  assert.match(page, /assets\/premium-mailbox-error\.js\?v=20260818a/);
  assert.match(page, /assets\/premium-mailbox-compose\.js\?v=20260818b/);
  assert.match(page, /assets\/premium-mailbox-index\.js\?v=20260826a/);
  assert.match(page, /assets\/premium-mailbox-detail-state\.js\?v=20260821a/);
  assert.match(page, /assets\/premium-mailbox-detail-stability\.js\?v=20260826a/);
  assert.ok(page.indexOf('premium-mailbox-quoted-thread.js?v=20260822a') < page.indexOf('premium-mailbox-signature.js?v=20260825a'));
  assert.ok(page.indexOf('premium-mailbox-signature.js?v=20260825a') < page.indexOf('premium-mailbox-message-presentation.js?v=20260820b'));
  assert.ok(page.indexOf('premium-mailbox-message-presentation.js?v=20260820b') < page.indexOf('premium-mailbox-logical-delete.js?v=20260820a'));
  assert.ok(page.indexOf('premium-mailbox-logical-delete.js?v=20260820a') < page.indexOf('premium-mailbox-campaign-inbox.js?v=20260826a'));
  assert.ok(page.indexOf('premium-mailbox-detail-state.js?v=20260821a') < page.indexOf('premium-mailbox-detail-stability.js?v=20260826a'));
  assert.ok(page.indexOf('premium-mailbox-detail-stability.js?v=20260826a') < page.indexOf('premium-mailbox-index.js?v=20260826a'));
  assert.match(readSignatureScript(), /renderContactCard/);
  assert.match(readMessagePresentationScript(), /getSourceSafeMessagePresentation/);
  assert.match(readDetailStabilityScript(), /function create\(\)/);
});

test('bewaarde contactgegevens lopen zonder een geneste kaart mee in het mailbericht', () => {
  const page = readPage();
  const contactStyle = page.match(/\.detail-mail-contact-card\s*\{([^}]*)\}/);
  const summaryLabelStyle = page.match(/\.mail-contact-summary strong\s*\{([^}]*)\}/);

  assert.ok(contactStyle, 'contactstijl ontbreekt');
  assert.match(contactStyle[1], /padding:\s*0;/);
  assert.match(contactStyle[1], /border:\s*0;/);
  assert.match(contactStyle[1], /border-radius:\s*0;/);
  assert.match(contactStyle[1], /background:\s*transparent;/);
  assert.match(contactStyle[1], /box-shadow:\s*none;/);
  assert.doesNotMatch(contactStyle[1], /border:\s*1px|rgba\(255,255,255/);
  assert.ok(summaryLabelStyle, 'contactdossierlabelstijl ontbreekt');
  assert.match(summaryLabelStyle[1], /color:\s*var\(--text-dark\);/);
  assert.doesNotMatch(summaryLabelStyle[1], /var\(--crimson\)/);
});

test('bewaarde telefoon- en adresregels gebruiken exact de typografie en woordafstand van de mailtekst', () => {
  const page = readPage();
  const rowStyle = page.match(/\.detail-mail-contact-item\s*\{([^}]*)\}/);
  const textStyle = page.match(/\.detail-mail-contact-item dt,\s*\.detail-mail-contact-item dd\s*\{([^}]*)\}/);
  const linkStyle = page.match(/\.detail-mail-contact-item \.detail-mail-contact-link\s*\{([^}]*)\}/);
  const gridStyle = page.match(/\.detail-mail-contact-grid\s*\{([^}]*)\}/);

  assert.ok(rowStyle, 'gedeelde contactrijstijl ontbreekt');
  assert.match(rowStyle[1], /display:\s*flex;/);
  assert.match(rowStyle[1], /align-items:\s*baseline;/);
  assert.match(rowStyle[1], /gap:\s*0 \.35em;/);
  assert.match(rowStyle[1], /min-height:\s*1\.8em;/);
  assert.ok(textStyle, 'gedeelde label- en waardestijl ontbreekt');
  assert.match(textStyle[1], /color:\s*inherit;/);
  assert.match(textStyle[1], /font:\s*inherit;/);
  assert.match(textStyle[1], /line-height:\s*inherit;/);
  assert.ok(linkStyle, 'gedeelde telefoonlinkstijl ontbreekt');
  assert.match(linkStyle[1], /color:\s*inherit;/);
  assert.match(linkStyle[1], /font:\s*inherit;/);
  assert.ok(gridStyle, 'contactregelafstand ontbreekt');
  assert.match(gridStyle[1], /gap:\s*0;/);
  assert.doesNotMatch(page, /detail-mail-contact-item-phone|grid-template-columns:\s*72px/);
});

test('campaign inbox laadt de canonieke quoteparser ook zelfstandig via CommonJS', () => {
  assert.equal(commonJsCanonicalQuoteBody, 'Nieuw menselijk antwoord.');
});

test('mailbox-extractiemodules behouden presentatie en verwijderen mapkopieen op RFC Message-ID', () => {
  assert.equal(typeof messagePresentationModule.create, 'function');
  const removed = [];
  const changed = logicalDeleteModule.removeResolvedMessageCaches({
    accountEmail: 'serve@softora.nl', folder: 'inbox', uid: 1,
  }, {
    result: {
      resolvedMessages: [
        { accountEmail: 'serve@softora.nl', folder: 'inbox', uid: 1, messageId: '<same@example.test>' },
        { accountEmail: 'serve@softora.nl', folder: 'allmail', uid: 2, messageId: '<same@example.test>' },
      ],
    },
  }, (message) => { removed.push(message); return true; });

  assert.equal(changed, true);
  assert.equal(removed.length, 1);
  const nested = logicalDeleteModule.withoutDeletedMessages([{
    id: 'conversation',
    accountEmail: 'serve@softora.nl',
    threadMessages: [{ accountEmail: 'serve@softora.nl', folder: 'allmail', uid: 2, messageId: '<same@example.test>' }],
  }], {
    accountEmail: 'serve@softora.nl', folder: 'inbox', uid: 1, messageId: '<same@example.test>',
  }, campaignInboxModule.matchesMessageIdentity);
  assert.equal(nested.changed, true);
  assert.equal(nested.messages[0].threadMessages.length, 0);
});

test('mailbox toont de gekozen eigenaar zwart in de topbar', () => {
  assert.match(readPage(), /\.topbar-mailbox-switcher-label\s*\{[^}]*color:\s*var\(--text-dark\)/s);
});

test('mailbox initialiseert met de opgeslagen eigenaar en toont geen verkeerde scope tijdens boot', () => {
  const pageSource = readPage();
  const scriptSource = readScript();
  const stabilitySource = readDetailStabilityScript();
  const campaignSource = readCampaignInboxScript();
  assert.match(campaignSource, /SoftoraMailboxOwnerPreference/);
  assert.match(pageSource, /assets\/premium-mailbox-owner-preference\.js\?v=20260822a/);
  assert.match(scriptSource, /SoftoraMailboxBoot\?\.markReady\?\.\(\);/);
  assert.doesNotMatch(scriptSource, /mailboxBootDetailPromise|await firstDetail/);
  assert.match(scriptSource, /finally \{\s*window\.SoftoraMailboxBoot\?\.markReady\?\.\(\);\s*mailboxRefreshController\?\.start\?\.\(\);/);
  assert.match(stabilitySource, /setAttribute\?\.\('inert', ''\)/);
  assert.match(pageSource, /\.mail-detail\.is-detail-pending::after \{ content: 'E-mail laden…';/);
  assert.match(readOwnerSessionScript(), /if \(campaignResult\.fromBootstrap && canApply\(candidate\)\) \{\s*void load\(\{/);
  assert.match(fs.readFileSync(path.join(__dirname, '../../assets/premium-mailbox-boot.js'), 'utf8'), /if \(!ready\) return;/);
  assert.match(pageSource, /main\.is-premium-boot-host > \.premium-boot-shell\.is-booting \{ visibility: hidden; \}/);
});

test('detailstabiliteit hergebruikt dezelfde loader-run en commit pas na hydrate en prepare', async () => {
  const stability = detailStabilityModule.create();
  const identity = {};
  const events = [];
  let releaseHydration;
  const hydration = new Promise((resolve) => { releaseHydration = resolve; });
  const options = {
    id: 'contact:serve:test',
    key: '1|outreach|serve||contact:serve:test',
    identity,
    isCurrent: () => true,
    hydrate: async () => { events.push('hydrate'); await hydration; return identity; },
    prepare: async () => {
      events.push('prepare');
      return { release: () => events.push('release') };
    },
    commit: () => { events.push('commit'); return true; },
  };

  const first = stability.run(options);
  await Promise.resolve();
  const reused = stability.run({ ...options, commit: () => { throw new Error('dubbele commit'); } });
  assert.strictEqual(reused, first);
  assert.deepEqual(events, ['hydrate']);

  releaseHydration();
  const result = await first;
  assert.equal(result.committed, true);
  assert.deepEqual(events, ['hydrate', 'prepare', 'commit', 'release']);
});

test('detailstabiliteit laat A naar B naar A en reset nooit een stale run committen', async () => {
  const stability = detailStabilityModule.create();
  const commits = [];
  let releaseFirstA;
  let releaseB;
  let releaseDeleted;
  const firstAWait = new Promise((resolve) => { releaseFirstA = resolve; });
  const bWait = new Promise((resolve) => { releaseB = resolve; });
  const deletedWait = new Promise((resolve) => { releaseDeleted = resolve; });
  const firstA = stability.run({
    id: 'a', key: 'scope|a', identity: {}, isCurrent: () => true,
    hydrate: () => firstAWait, commit: () => { commits.push('stale-a'); return true; },
  });
  await Promise.resolve();
  const b = stability.run({
    id: 'b', key: 'scope|b', identity: {}, isCurrent: () => true,
    hydrate: () => bWait, commit: () => { commits.push('stale-b'); return true; },
  });
  await Promise.resolve();
  const finalA = stability.run({
    id: 'a', key: 'scope|a', identity: {}, isCurrent: () => true,
    hydrate: async () => 'final-a', commit: () => { commits.push('final-a'); return true; },
  });
  assert.equal((await finalA).committed, true);
  releaseFirstA();
  releaseB();
  assert.equal((await firstA).committed, false);
  assert.equal((await b).committed, false);

  const deleted = stability.run({
    id: 'deleted', key: 'scope|deleted', identity: {}, isCurrent: () => true,
    hydrate: () => deletedWait, commit: () => { commits.push('deleted'); return true; },
  });
  await Promise.resolve();
  stability.invalidate();
  releaseDeleted();
  assert.equal((await deleted).committed, false);
  assert.deepEqual(commits, ['final-a']);
});

test('detailstabiliteit ruimt een stale laadlaag op zonder een nieuwere run te raken', async () => {
  const classes = new Set();
  const attributes = new Map();
  const detail = {
    dataset: {},
    innerHTML: '',
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    querySelector() { return null; },
  };
  const mail = { id: 'a' };
  let currentToken = { generation: 1, signal: new AbortController().signal };
  let releasePreparation;
  const preparation = new Promise((resolve) => { releasePreparation = resolve; });
  const controller = detailStabilityModule.createController({
    getMail: (id) => id === mail.id ? mail : null,
    ensureToken: () => currentToken,
    isTokenCurrent: (token) => token === currentToken,
    getScope: () => ({ folder: 'inbox', account: 'serve@softora.nl' }),
    getActiveMail: () => mail.id,
    setActiveMail() {},
    select() {},
    renderList() {},
    getDetailElement: () => detail,
    renderHtml: () => '<p>A</p>',
    prepare: () => preparation,
  });

  const pending = controller.open(mail.id);
  await Promise.resolve();
  assert.equal(detail.classList.contains('is-detail-pending'), true);
  currentToken = { generation: 2, signal: new AbortController().signal };
  releasePreparation();
  assert.equal((await pending).stale, true);
  assert.equal(detail.classList.contains('is-detail-pending'), false);
  assert.equal(attributes.has('inert'), false);
});

test('contacttijdlijn heeft een harde deadline zodat maildetail altijd kan committen', async () => {
  const mail = {
    id: 'contact:deadline',
    accountEmail: 'serve@softora.nl',
    externalContactEmail: 'klant@example.nl',
    canonicalOwner: 'serve',
  };
  const discovery = discoveryModule.create({
    document: { getElementById() { return null; } },
    fetch: () => new Promise(() => {}),
    timelineTimeoutMs: 20,
    getActiveMail: () => mail.id,
    getAccountEmails: () => ['serve@softora.nl'],
    getMessageOwner: () => 'serve',
  });
  const startedAt = Date.now();
  const loaded = await discovery.loadContactTimeline(mail, { deferRender: true });
  assert.equal(loaded, false);
  assert.ok(Date.now() - startedAt < 250);
  assert.equal(mail.contactTimelineLoading, false);
  assert.match(mail.contactTimelineError, /volgende poging/);
});

function loadMailboxHelpersForTest(options = {}) {
  const elements = new Map();
  const documentListeners = new Map();
  function getElement(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      const attributes = Object.create(null);
      const element = {
        _innerHTML: '',
        innerHTMLWrites: 0,
        textContent: '',
        value: '',
        hidden: false,
        dataset: {},
        addEventListener() {},
        appendChild() {},
        classList: {
          add(...names) { names.forEach((name) => classes.add(name)); },
          remove(...names) { names.forEach((name) => classes.delete(name)); },
          contains(name) { return classes.has(name); },
          toggle(name, force) { const enabled = force == null ? !classes.has(name) : Boolean(force); if (enabled) classes.add(name); else classes.delete(name); return enabled; },
        },
        setAttribute(name, value) { attributes[name] = String(value); },
        getAttribute(name) { return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null; },
        hasAttribute(name) { return Object.prototype.hasOwnProperty.call(attributes, name); },
        removeAttribute(name) { delete attributes[name]; },
        contains() { return false; },
        querySelector() { return null; },
        closest() { return null; },
      };
      Object.defineProperty(element, 'innerHTML', {
        configurable: true,
        get() { return this._innerHTML; },
        set(value) { this._innerHTML = String(value); this.innerHTMLWrites += 1; },
      });
      elements.set(id, element);
    }
    return elements.get(id);
  }
  const document = {
    readyState: 'complete',
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(handler);
    },
    getElementById(id) { return getElement(id); },
    createElement(tagName) {
      return {
        tagName: String(tagName || '').toUpperCase(),
        textContent: '',
        className: '',
        type: '',
        disabled: false,
        addEventListener() {},
        appendChild() {},
      };
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const window = {
    addEventListener() {},
    SoftoraMailboxOutreach: null,
    SoftoraMailboxCampaignInbox: {
      ...campaignInboxModule,
      load: options.campaignInboxLoad || (async () => null),
    },
    SoftoraMailboxQuotedThread: quotedThreadModule,
    SoftoraMailboxSignature: signatureModule,
    SoftoraMailboxMessageProvenance: provenanceModule,
    SoftoraMailboxOwnerSession: ownerSessionModule,
    SoftoraMailboxCompose: composeModule,
    SoftoraMailboxComposeWindow: composeWindowModule,
    SoftoraMailboxComposeController: composeControllerModule,
    SoftoraMailboxToast: toastModule,
    SoftoraMailboxDelete: deleteModule,
    SoftoraMailboxLogicalDelete: logicalDeleteModule,
    SoftoraMailboxRead: readModule,
    SoftoraMailboxUiState: uiStateModule,
    SoftoraMailboxList: listModule,
    SoftoraMailboxImages: options.SoftoraMailboxImages || imagesModule,
    SoftoraMailboxBodySection: bodySectionModule,
    SoftoraUiStateClient: null,
    SoftoraMailboxDetailState: options.SoftoraMailboxDetailState || detailStateModule.createMailboxDetailState(),
    SoftoraMailboxDetailStability: detailStabilityModule,
    SoftoraMailboxDiscovery: options.SoftoraMailboxDiscovery || discoveryModule,
    SoftoraCampaignSenderSettings: null,
    SoftoraDialogs: options.SoftoraDialogs || null,
    confirm: options.confirm || (() => false),
  };
  const fetchImpl = options.fetch || (async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      accounts: [{ email: 'serve@softora.nl', imapConfigured: true, smtpConfigured: true }],
      messages: [],
    }),
  }));
  window.fetch = fetchImpl;
  const context = {
    URL,
    URLSearchParams,
    AbortController,
    console,
    document,
    documentListeners,
    window,
    clearTimeout: options.clearTimeout || (() => {}),
    setTimeout: options.setTimeout || (() => 0),
    fetch: fetchImpl,
  };
  const source = readScript()
    .replace('(async function initMailboxAccount() {', 'window.__mailboxInitPromise = (async function initMailboxAccount() { return;')
    .replace(
      'bindMailboxActions();',
      'window.__mailboxTest = { renderMailBody, renderMailboxRootIncomingMeta, normalizeMailboxApiMessage, formatMailDate, getMailboxConversationVisibilityKey: window.SoftoraMailboxCampaignInbox.getConversationVisibilityKey, display: window.SoftoraMailboxDisplay, index: window.SoftoraMailboxIndex, openMail, deleteMail, loadMailboxMessageBody, loadMailboxMessages, switchCampaignMailboxOwner, setMails(value) { mails = value; }, setActiveFolder(value) { activeFolder = value; }, getMails() { return mails; }, getActiveMail() { return activeMail; }, getDiscoveryController() { return mailboxDiscoveryController; }, getElement(id) { return document.getElementById(id); }, dispatchDocumentEvent(type, event) { (documentListeners.get(type) || []).forEach((handler) => handler(event)); } }; bindMailboxActions();'
    );
  vm.createContext(context);
  vm.runInContext(readDisplayScript(), context);
  vm.runInContext(readIndexScript(), context);
  if (options.SoftoraMailboxIndex) Object.assign(context.window.SoftoraMailboxIndex, options.SoftoraMailboxIndex);
  vm.runInContext(source, context);
  context.window.__mailboxTest.ready = context.window.__mailboxInitPromise || Promise.resolve();
  return context.window.__mailboxTest;
}

function renderMailboxBodyForTest(body, images, options) {
  return loadMailboxHelpersForTest().renderMailBody(body, images, options);
}

test('mailbox detailzichtbaarheid gebruikt conversation, RFC Message-ID en fysieke id in vaste scopevolgorde', async () => {
  const mailbox = loadMailboxHelpersForTest();
  await mailbox.ready;
  const key = mailbox.getMailboxConversationVisibilityKey;
  const conversationBase = {
    accountEmail: 'serve@softora.nl',
    conversationId: 'Thread-Peakboom',
  };
  const conversationFirst = key({
    ...conversationBase,
    id: 'inbox:42',
    messageId: '<first-copy@example.test>',
  });
  const conversationSecond = key({
    ...conversationBase,
    id: 'allmail:991',
    messageId: '<second-copy@example.test>',
  });
  assert.equal(conversationFirst, conversationSecond);
  assert.equal(conversationFirst, 'serve|serve@softora.nl|conversation:thread-peakboom');

  assert.notEqual(conversationFirst, key({
    ...conversationBase,
    accountEmail: 'martijn@softora.nl',
    id: 'inbox:42',
  }));
  assert.notEqual(conversationFirst, key({
    ...conversationBase,
    accountEmail: 'serve290@gmail.com',
    id: 'inbox:42',
  }));

  const messageFirst = key({
    id: 'inbox:100',
    accountEmail: 'serve@softora.nl',
    messageId: '<UPPER@ID.TEST>',
    references: '<shared-parent@example.test>',
  });
  const messageCopy = key({
    id: 'allmail:200',
    accountEmail: 'serve@softora.nl',
    messageId: 'upper@id.test',
    references: '<shared-parent@example.test>',
  });
  assert.equal(messageFirst, messageCopy);
  assert.equal(messageFirst, 'serve|serve@softora.nl|message:upper@id.test');
  assert.notEqual(messageFirst, key({
    id: 'inbox:300',
    accountEmail: 'serve290@gmail.com',
    messageId: '<UPPER@ID.TEST>',
  }), 'dezelfde RFC Message-ID mag nooit twee accountscopes samenvoegen');
  assert.notEqual(messageFirst, key({
    id: 'inbox:101',
    accountEmail: 'serve@softora.nl',
    messageId: '<different@id.test>',
    references: '<shared-parent@example.test>',
  }), 'gedeelde References zijn geen visibility-identiteit');

  const syntheticCampaignBase = {
    accountEmail: 'serve@softora.nl',
    email: 'prospect@example.test',
    campaign: { account: 'serve@softora.nl' },
    subject: 'Kleine vraag over jullie website',
  };
  assert.notEqual(key({
    ...syntheticCampaignBase,
    id: 'campaign-copy:1',
    messageId: '<campaign-one@example.test>',
  }), key({
    ...syntheticCampaignBase,
    id: 'campaign-copy:2',
    messageId: '<campaign-two@example.test>',
  }), 'een synthetische campaign-key mag verschillende RFC-berichten niet samenvoegen');
  assert.equal(key({
    ...syntheticCampaignBase,
    id: 'campaign-copy:3',
    conversationId: 'Explicit-Thread',
    messageId: '<campaign-three@example.test>',
  }), 'serve|serve@softora.nl|conversation:explicit-thread');

  assert.equal(key({
    id: 'physical:1',
    accountEmail: 'serve@softora.nl',
    messageId: '   ',
  }), 'serve|serve@softora.nl|mailbox:physical:1');
  assert.notEqual(key({ id: 'physical:1', accountEmail: 'serve@softora.nl' }), key({
    id: 'physical:1', accountEmail: 'martijn@softora.nl',
  }));
});

test('mailbox toont een canoniek verzonden antwoord exact eenmaal en niet nog als afgeleid citaat', () => {
  const html = renderMailboxBodyForTest(
    'Hoi Martijn,\n\nWelke techniek gebruik je?\n\nOp 22 juli 2026 schreef Martijn van de Ven:\n> Eerdere mail',
    [],
    {
      replyMailId: 'inbox:91',
      mail: {
        accountEmail: 'martijnven123@gmail.com',
        receivedAt: '2026-07-22T15:36:03.000Z',
        threadMessages: [{
          id: 'sent:102',
          folder: 'sent',
          accountEmail: 'martijnven123@gmail.com',
          date: '2026-07-23T09:21:00.000Z',
          body: 'Hoi Helma,\n\nIk bouw onze websites met maatwerk.\n\nOn Wed, Jul 22, 2026 wrote:\n> Welke techniek gebruik je?',
        }],
      },
    }
  );

  assert.match(html, /Jouw bericht/);
  assert.match(html, /Martijn van de Ven/);
  assert.match(html, /Ik bouw onze websites met maatwerk\./);
  const sentSection = html.match(
    /<section class="detail-mail-section detail-mail-section-sent">([\s\S]*?)<\/section>/
  );
  assert.ok(sentSection);
  assert.doesNotMatch(sentSection[1], /Welke techniek gebruik je/);
  assert.match(html, /class="detail-mail-section detail-mail-section-sent"/);
  assert.ok(html.indexOf('Nieuw bericht sturen') < html.indexOf('Jouw bericht'));
  assert.doesNotMatch(html, /Beantwoorden/);
  assert.equal((html.match(/detail-mail-section detail-mail-section-sent/g) || []).length, 1);
  assert.doesNotMatch(html, /Eerdere mail|citaat · niet ontvangen/i);
});

test('mailbox bepaalt de actie uitsluitend uit de nieuwste echte threadmessage', () => {
  const inboundLatest = {
    id: 'inbox:latest',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    date: '2026-07-24T16:30:00.000Z',
    body: 'Kun je iets meer vertellen?\n\nOp 24 juli schreef Servé:\n> Oud antwoord',
    threadMessages: [{
      id: 'sent:older',
      folder: 'sent',
      accountEmail: 'serve@softora.nl',
      date: '2026-07-24T16:00:00.000Z',
    }],
  };
  assert.equal(campaignInboxModule.getConversationAction(inboundLatest).kind, 'reply');

  const outboundLatest = {
    ...inboundLatest,
    date: '2026-07-24T16:00:00.000Z',
    threadMessages: [{
      id: 'sent:latest',
      folder: 'sent',
      accountEmail: 'serve@softora.nl',
      date: '2026-07-24T16:30:00.000Z',
    }],
  };
  const outboundAction = campaignInboxModule.getConversationAction(outboundLatest);
  assert.equal(outboundAction.kind, 'new-message');
  assert.equal(outboundAction.message.id, 'sent:latest');

  const bccCopy = {
    ...inboundLatest,
    accountEmail: 'serve@softora.nl',
    copyContext: {
      evidenceKnown: true,
      kind: 'bcc',
      sourceAccountEmail: 'martijn@softora.nl',
      recipientEmail: 'sandra@example.nl',
    },
    threadMessages: [],
  };
  assert.equal(campaignInboxModule.getConversationAction(bccCopy).kind, 'new-message');
});

test('BCC en CC verschijnen alleen met exacte provenance in lijst en detail', () => {
  const baseOptions = {
    escapeHtml: (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    display: {
      getListPrimaryText: () => 'martijn@softora.nl',
    },
    activeMail: '',
  };
  const bccMail = {
    id: 'copy',
    accountEmail: 'serve@softora.nl',
    time: '18:15',
    copyContext: {
      evidenceKnown: true,
      kind: 'bcc',
      sourceName: 'Martijn van de Ven',
      sourceEmail: 'martijn@softora.nl',
      recipientName: 'Sandra van Berkel',
      recipientEmail: 'sandra@example.nl',
      copyAccountEmail: 'serve@softora.nl',
    },
  };
  assert.match(listModule.renderItem(bccMail, baseOptions), /mail-copy-badge">BCC</);
  const detail = campaignInboxModule.renderMessageRouting(bccMail, baseOptions.escapeHtml);
  assert.match(detail, /Van:<\/span><strong>Martijn van de Ven &lt;martijn@softora\.nl&gt;/);
  assert.match(detail, /Aan:<\/span><strong>Sandra van Berkel &lt;sandra@example\.nl&gt;/);
  assert.match(detail, /BCC:<\/span><strong>Servé Creusen &lt;serve@softora\.nl&gt;/);

  const ccMail = { ...bccMail, copyContext: { ...bccMail.copyContext, kind: 'cc' } };
  assert.match(listModule.renderItem(ccMail, baseOptions), /mail-copy-badge">CC</);
  assert.match(campaignInboxModule.renderMessageRouting(ccMail, baseOptions.escapeHtml), /CC:<\/span>/);

  const direct = {
    ...bccMail,
    from: 'Salon TOF',
    email: 'info@salontof.nl',
    copyContext: null,
  };
  assert.doesNotMatch(listModule.renderItem(direct, baseOptions), /mail-copy-badge/);
  assert.match(campaignInboxModule.renderMessageRouting(direct, baseOptions.escapeHtml), /Van:<\/span>/);
  const uncertain = { ...bccMail, copyContext: { kind: 'bcc', evidenceKnown: false } };
  assert.doesNotMatch(listModule.renderItem(uncertain, baseOptions), /mail-copy-badge/);

  const instantly = {
    ...direct,
    id: 'instantly:reply-1',
    provider: 'instantly',
    receivedAt: '2026-07-29T12:00:00.000Z',
  };
  const instantlyHtml = listModule.renderItem(instantly, baseOptions);
  assert.match(instantlyHtml, /mail-source-badge-instantly">INSTANTLY/);
  assert.doesNotMatch(listModule.renderItem(direct, baseOptions), /mail-source-badge/);

  const pageSource = readPage();
  assert.match(
    pageSource,
    /\.detail-routing \{[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;/
  );
  assert.doesNotMatch(
    pageSource,
    /\.detail-routing \{[^}]*(?:background:\s*rgba|border:\s*1px)/
  );
});

test('bewezen BCC- en CC-rootkopieën houden hun routing in de eigen contactdossierkaart', () => {
  for (const kind of ['bcc', 'cc']) {
    const body = `Bewezen ${kind.toUpperCase()}-kopie voor Sandra.`;
    const html = renderMailboxBodyForTest(body, [], {
      contactDossierMode: true,
      mail: {
        id: `serve@softora.nl|inbox:${kind}-copy-root`,
        folder: 'inbox',
        accountEmail: 'serve@softora.nl',
        date: '24 juli',
        time: '18:15',
        body,
        contactTimelineLoaded: true,
        copyContext: {
          evidenceKnown: true,
          kind,
          sourceAccountEmail: 'martijn@softora.nl',
          sourceName: 'Martijn van de Ven',
          sourceEmail: 'martijn@softora.nl',
          recipientName: 'Sandra van Berkel',
          recipientEmail: 'sandra@example.nl',
          copyAccountEmail: 'serve@softora.nl',
        },
        threadMessages: [],
      },
    });
    const copyCard = html.match(/<section class="detail-mail-section detail-mail-section-sent">([\s\S]*?)<\/section>/)?.[1] || '';

    assert.match(copyCard, /<span>Van:<\/span><strong>Martijn van de Ven &lt;martijn@softora\.nl&gt;<\/strong>/, kind);
    assert.match(copyCard, /<span>Aan:<\/span><strong>Sandra van Berkel &lt;sandra@example\.nl&gt;<\/strong>/, kind);
    assert.match(copyCard, new RegExp(`<span>${kind.toUpperCase()}:<\\/span><strong>Servé Creusen &lt;serve@softora\\.nl&gt;<\\/strong>`), kind);
    assert.match(copyCard, new RegExp(`Bewezen ${kind.toUpperCase()}-kopie voor Sandra\\.`), kind);
    assert.equal((html.match(/<span>Van:<\/span>/g) || []).length, 1, kind);
    assert.equal((html.match(/<span>Aan:<\/span>/g) || []).length, 1, kind);
  }
});

test('lijst toont een roze omgevouwen hoek alleen wanneer het nieuwste echte bericht inkomend is', () => {
  const baseOptions = {
    escapeHtml: (value) => String(value),
    display: { getListPrimaryText: () => 'Prospect' },
    activeMail: '',
  };
  const waitingForReply = {
    id: 'inbox:latest',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    receivedAt: '2026-08-03T12:00:00.000Z',
    threadMessages: [{
      id: 'sent:older',
      folder: 'sent',
      accountEmail: 'serve@softora.nl',
      date: '2026-08-03T11:00:00.000Z',
    }],
  };
  const answered = {
    ...waitingForReply,
    threadMessages: [{
      id: 'sent:latest',
      folder: 'sent',
      accountEmail: 'serve@softora.nl',
      date: '2026-08-03T13:00:00.000Z',
    }],
  };

  assert.match(listModule.renderItem(waitingForReply, baseOptions), /mail-reply-corner/);
  assert.match(listModule.renderItem(waitingForReply, baseOptions), /Wacht op jouw antwoord/);
  assert.doesNotMatch(listModule.renderItem({
    ...waitingForReply,
    replyDismissedAt: '2026-08-04T15:10:00.000Z',
  }, baseOptions), /mail-reply-corner/);
  assert.match(listModule.renderItem({
    ...waitingForReply,
    replyDismissedAt: '2026-08-04T15:10:00.000Z',
    receivedAt: '2026-08-03T10:00:00.000Z',
    threadMessages: [{
      id: 'inbox:new-reply',
      folder: 'inbox',
      accountEmail: 'serve@softora.nl',
      date: '2026-08-04T09:00:00.000Z',
      replyDismissedAt: '',
    }],
  }, baseOptions), /mail-reply-corner/);
  assert.doesNotMatch(listModule.renderItem({
    ...waitingForReply,
    receivedAt: '2026-08-03T10:00:00.000Z',
    threadMessages: [{
      id: 'inbox:handled-reply',
      folder: 'inbox',
      accountEmail: 'serve@softora.nl',
      date: '2026-08-04T09:00:00.000Z',
      replyDismissedAt: '2026-08-04T09:05:00.000Z',
    }],
  }, baseOptions), /mail-reply-corner/);
  assert.doesNotMatch(listModule.renderItem(answered, baseOptions), /mail-reply-corner/);
  assert.match(readPage(), /\.mail-reply-corner \{[^}]*var\(--crimson\)/);
});

test('ieder gesprek toont bewezen Van en Aan zonder dubbele adresregels onder de avatar', () => {
  const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const directInbound = campaignInboxModule.renderMessageRouting({
    folder: 'inbox',
    from: 'Info | Salon TOF',
    email: 'info@salontof.nl',
    to: 'serve@softora.nl',
    toDisplay: 'Servé Creusen <serve@softora.nl>',
    recipientRoutingEvidenceKnown: true,
  }, escapeHtml);
  assert.match(directInbound, /data-mailbox-routing-kind="direct"/);
  assert.match(directInbound, /Van:<\/span><strong>Info \| Salon TOF &lt;info@salontof\.nl&gt;/);
  assert.match(directInbound, /Aan:<\/span><strong>Servé Creusen &lt;serve@softora\.nl&gt;/);
  assert.doesNotMatch(directInbound, />CC:|>BCC:/);

  const directOutbound = campaignInboxModule.renderMessageRouting({
    folder: 'sent',
    from: 'Servé Creusen',
    email: 'serve@softora.nl',
    to: 'info@salontof.nl',
    toDisplay: 'Info | Salon TOF <info@salontof.nl>',
    cc: 'Martijn van de Ven <martijn@softora.nl>',
    bcc: 'archief@example.nl',
    recipientRoutingEvidenceKnown: true,
  }, escapeHtml);
  assert.match(directOutbound, /Van:<\/span><strong>Servé Creusen &lt;serve@softora\.nl&gt;/);
  assert.match(directOutbound, /Aan:<\/span><strong>Info \| Salon TOF &lt;info@salontof\.nl&gt;/);
  assert.match(directOutbound, /CC:<\/span><strong>Martijn van de Ven &lt;martijn@softora\.nl&gt;/);
  assert.match(directOutbound, /BCC:<\/span><strong>archief@example\.nl/);

  const unknownRecipient = campaignInboxModule.renderMessageRouting({
    from: 'Salon TOF',
    email: 'info@salontof.nl',
    to: 'mogelijk@example.nl',
    recipientRoutingEvidenceKnown: false,
  }, escapeHtml);
  assert.match(unknownRecipient, /Van:<\/span>/);
  assert.match(unknownRecipient, /Van:<\/span>/);
  assert.doesNotMatch(unknownRecipient, /Aan:<\/span>|Niet beschikbaar in bronbericht/);

  const instantly = campaignInboxModule.renderMessageRouting({
    provider: 'instantly',
    from: 'Bestuur MHCBE',
    email: 'bestuur@mhcbe.nl',
    to: 'servecreusen@websoftora.com',
    toDisplay: 'Servé Creusen <servecreusen@websoftora.com>',
    recipientRoutingEvidenceKnown: true,
  }, escapeHtml);
  assert.match(instantly, /Van:<\/span><strong>Bestuur MHCBE &lt;bestuur@mhcbe\.nl&gt;/);
  assert.match(instantly, /Aan:<\/span><strong>Servé Creusen &lt;servecreusen@websoftora\.com&gt;/);

  const scriptSource = readScript();
  assert.match(scriptSource, /const rootHeaderRouting = isMailboxRootIncoming\(m\) \|\| contactDossierMode[\s\S]*?\? ''[\s\S]*?: window\.SoftoraMailboxCampaignInbox\.renderMessageRouting\(m, escapeHtml\)/);
  assert.match(scriptSource, /\$\{rootHeaderRouting\}\$\{contactDossier\.newMessageAction/);
  assert.doesNotMatch(scriptSource, /<div class="detail-email">\$\{escapeHtml\(detailSecondary\)\}<\/div>/);
  assert.doesNotMatch(scriptSource, /renderDetailAccount\(m, escapeHtml\)/);
});

test('historische inkomende en uitgaande kaarten tonen hun eigen bewezen Aan-route', () => {
  const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  const html = campaignInboxModule.renderThreadMessages({
    id: 'inbox:root',
    accountEmail: 'serve@softora.nl',
    receivedAt: '2026-08-05T10:00:00.000Z',
    threadMessages: [{
      id: 'sent:41',
      folder: 'sent',
      accountEmail: 'serve@softora.nl',
      from: 'Servé Creusen',
      email: 'serve@softora.nl',
      to: 'klant@example.nl',
      toDisplay: 'Klant <klant@example.nl>',
      recipientRoutingEvidenceKnown: true,
      date: '2026-08-05T09:30:00.000Z',
      body: 'Mijn eerdere antwoord.',
      hasBody: true,
      bodyLoaded: true,
    }, {
      id: 'inbox:40',
      folder: 'inbox',
      accountEmail: 'serve@softora.nl',
      from: 'Klant',
      email: 'klant@example.nl',
      to: 'serve@softora.nl',
      toDisplay: 'Servé Creusen <serve@softora.nl>',
      cc: 'team@example.nl',
      recipientRoutingEvidenceKnown: true,
      date: '2026-08-05T09:00:00.000Z',
      body: 'De eerdere reactie.',
      hasBody: true,
      bodyLoaded: true,
    }, {
      id: 'sent:39',
      folder: 'sent',
      accountEmail: 'serve@softora.nl',
      from: 'Servé Creusen',
      email: 'serve@softora.nl',
      date: '2026-08-05T08:30:00.000Z',
      body: 'Oud bronbericht zonder ontvangerheaders.',
      hasBody: true,
      bodyLoaded: true,
      recipientRoutingEvidenceKnown: false,
    }],
  }, escapeHtml, () => ({ date: 'Vandaag', time: '12:00' }), {
    newestFirst: true,
  });

  assert.match(html, /Aan:<\/span><strong>Klant &lt;klant@example\.nl&gt;/);
  assert.match(html, /Aan:<\/span><strong>Servé Creusen &lt;serve@softora\.nl&gt;/);
  assert.match(html, /CC:<\/span><strong>team@example\.nl/);
  assert.doesNotMatch(html, /Niet beschikbaar in bronbericht/);
  assert.equal((html.match(/Aan:<\/span>/g) || []).length, 2);
  assert.equal((html.match(/data-mailbox-routing-kind="direct"/g) || []).length, 3);
});

test('roze threadkaarten tonen Vandaag en de echte verzendtijd uit canonieke timestamps', () => {
  const formattedInputs = [];
  const formattedByTimestamp = new Map([
    ['2026-08-25T13:01:00.000Z', { date: 'Vandaag', time: '15:01' }],
    ['2026-08-18T09:23:00.000Z', { date: '18 augustus', time: '11:23' }],
    ['2026-08-20T12:42:00.000Z', { date: '20 augustus', time: '14:42' }],
  ]);
  const html = campaignInboxModule.renderThreadMessages({
    id: 'inbox:date-root',
    accountEmail: 'serve@softora.nl',
    threadMessages: [{
      id: 'sent:today-normalized',
      folder: 'sent',
      accountEmail: 'serve@softora.nl',
      receivedAt: '2026-08-25T13:01:00.000Z',
      date: 'Vandaag',
      time: '15:01',
      body: 'Eigen bericht van vandaag.',
      hasBody: true,
      bodyLoaded: true,
    }, {
      id: 'sent:older-normalized',
      folder: 'sent',
      accountEmail: 'serve@softora.nl',
      receivedAt: 'ongeldige-oude-weergave',
      internalDate: '2026-08-18T09:23:00.000Z',
      date: '18 augustus',
      time: '00:00',
      body: 'Ouder eigen bericht.',
      hasBody: true,
      bodyLoaded: true,
    }, {
      id: 'sent:raw-iso',
      folder: 'sent',
      accountEmail: 'serve@softora.nl',
      date: '2026-08-20T12:42:00.000Z',
      body: 'Ruwe ISO-fallback.',
      hasBody: true,
      bodyLoaded: true,
    }, {
      id: 'sent:legacy-display',
      folder: 'sent',
      accountEmail: 'serve@softora.nl',
      date: '17 augustus',
      time: '09:17',
      body: 'Legacy weergavefallback.',
      hasBody: true,
      bodyLoaded: true,
    }, {
      id: 'sent:date-only-display',
      folder: 'sent',
      accountEmail: 'serve@softora.nl',
      date: '2026-08-16',
      body: 'Datum zonder bewezen verzendtijd.',
      hasBody: true,
      bodyLoaded: true,
    }],
  }, String, (value) => {
    formattedInputs.push(value);
    return formattedByTimestamp.get(value) || { date: '', time: '' };
  });

  assert.deepEqual(formattedInputs, [
    '2026-08-25T13:01:00.000Z',
    '2026-08-18T09:23:00.000Z',
    '2026-08-20T12:42:00.000Z',
  ]);
  assert.match(html, /Vandaag, 15:01 · Servé Creusen/);
  assert.match(html, /18 augustus, 11:23 · Servé Creusen/);
  assert.match(html, /20 augustus, 14:42 · Servé Creusen/);
  assert.match(html, /17 augustus, 09:17 · Servé Creusen/);
  assert.match(html, /2026-08-16 · Servé Creusen/);
  assert.doesNotMatch(html, /2026-08-16, 02:00/);
  assert.doesNotMatch(html, /18 augustus, 00:00/);
  assert.equal((html.match(/detail-mail-section-sent/g) || []).length, 5);
});

test('premium mailbox rendert meerdere opgeslagen Karoena-berichten als losse kaarten', () => {
  const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  const sentMessages = [1, 2, 3, 4].map((index) => ({
    id: `sent:karoena-${index}`,
    folder: 'sent',
    accountEmail: 'martijnven123@gmail.com',
    from: 'Martijn van de Ven',
    email: 'martijnven123@gmail.com',
    to: 'info@praktijkkaroena.nl',
    date: `2026-05-${String(26 + index).padStart(2, '0')}T10:00:00.000Z`,
    body: `Afzonderlijk antwoord ${index}.\n\n> Geciteerde vorige tekst ${index}.`,
    hasBody: true,
    bodyLoaded: true,
    messageId: `<karoena-sent-${index}@example.nl>`,
  }));
  const html = campaignInboxModule.renderThreadMessages({
    id: 'inbox:karoena',
    accountEmail: 'martijnven123@gmail.com',
    receivedAt: '2026-04-27T10:05:28.000Z',
    threadMessages: [
      ...sentMessages,
      {
        id: 'inbox:karoena-follow-up',
        folder: 'inbox',
        accountEmail: 'martijnven123@gmail.com',
        from: 'Praktijk Karoena',
        email: 'info@praktijkkaroena.nl',
        to: 'martijnven123@gmail.com',
        date: '2026-05-30T11:00:00.000Z',
        body: 'Afzonderlijke ontvangen vervolgreactie.',
        hasBody: true,
        bodyLoaded: true,
        messageId: '<karoena-inbound-follow-up@example.nl>',
      },
    ],
  }, escapeHtml, () => ({ date: '30 mei', time: '11:00' }), { chronological: true });

  assert.equal((html.match(/detail-mail-section detail-mail-section-sent/g) || []).length, 4);
  assert.equal((html.match(/detail-mail-section detail-mail-section-received/g) || []).length, 1);
  [1, 2, 3, 4].forEach((index) => assert.match(html, new RegExp(`Afzonderlijk antwoord ${index}`)));
  assert.match(html, /Afzonderlijke ontvangen vervolgreactie/);
  assert.doesNotMatch(html, /Geciteerde vorige tekst/);
});

test('gerichte threadhydratie vult Aan uit exacte indexprovenance zonder de body te verbergen', async () => {
  const helpers = loadMailboxHelpersForTest();
  const message = {
    id: 'instantly:sent-route-1',
    uid: 0,
    folder: 'sent',
    storageFolder: 'instantly',
    accountEmail: 'servecreusen@websoftora.com',
    provider: 'instantly',
    from: 'Servé Creusen',
    email: 'servecreusen@websoftora.com',
    date: '2026-08-05T08:00:00.000Z',
    body: 'Volledig bestaand bericht.',
    hasBody: true,
    bodyLoaded: true,
    recipientRoutingEvidenceKnown: false,
  };
  const mail = {
    id: 'instantly:root-route-1',
    accountEmail: 'servecreusen@websoftora.com',
    threadMessages: [message],
  };

  await helpers.index.loadThreadBodies({
    mail,
    getActiveMail: () => '',
    openMail() {},
    fetchImpl: async (url) => {
      assert.equal(String(url), '/api/mailbox/messages/bodies');
      return {
        ok: true,
        json: async () => ({
          ok: true,
          messages: [{
            id: message.id,
            uid: 0,
            folder: 'instantly',
            accountEmail: message.accountEmail,
            body: message.body,
            hasBody: true,
            bodyTruncated: false,
            bodyImageEvidenceKnown: true,
            embeddedImageCount: 0,
            to: 'bestuur@mhcbe.nl',
            toDisplay: 'Bestuur MHCBE <bestuur@mhcbe.nl>',
            recipientRoutingEvidenceKnown: true,
          }],
        }),
      };
    },
  });

  assert.equal(message.body, 'Volledig bestaand bericht.');
  assert.equal(message.to, 'bestuur@mhcbe.nl');
  assert.equal(message.toDisplay, 'Bestuur MHCBE <bestuur@mhcbe.nl>');
  assert.equal(message.recipientRoutingEvidenceKnown, true);
  assert.equal(helpers.index.needsThreadRoutingHydration(message), false);
});

test('BCC-thread blijft bij Martijn, toont zijn hoofdmail roze en houdt de chronologie compleet', () => {
  const html = renderMailboxBodyForTest('Dit is mijn inhoudelijke antwoord aan Sandra.', [], {
    replyMailId: 'serve@softora.nl|inbox:107',
    mail: {
      id: 'serve@softora.nl|inbox:107',
      folder: 'inbox',
      accountEmail: 'serve@softora.nl',
      from: 'Martijn van de Ven',
      email: 'martijn@softora.nl',
      subject: 'Re: Kleine vraag over jullie website',
      date: '24 jul',
      time: '18:15',
      receivedAt: '2026-07-24T16:15:00.000Z',
      copyContext: {
        evidenceKnown: true,
        kind: 'bcc',
        sourceAccountEmail: 'martijn@softora.nl',
        sourceName: 'Martijn van de Ven',
        sourceEmail: 'martijn@softora.nl',
        recipientName: 'Sandra van Berkel',
        recipientEmail: 'sandra@example.nl',
        copyAccountEmail: 'serve@softora.nl',
      },
      threadMessages: [{
        id: 'sent:original',
        folder: 'sent',
        accountEmail: 'martijn@softora.nl',
        body: 'Oorspronkelijke coldmail.',
        date: '2026-07-24T07:44:00.000Z',
      }, {
        id: 'inbox:sandra',
        folder: 'inbox',
        accountEmail: 'martijn@softora.nl',
        from: 'Sandra van Berkel',
        body: 'Wat kost dit?',
        date: '2026-07-24T08:58:00.000Z',
      }],
    },
  });

  assert.ok(html.indexOf('Nieuw bericht sturen') < html.indexOf('Dit is mijn inhoudelijke antwoord'));
  assert.ok(html.indexOf('Dit is mijn inhoudelijke antwoord') < html.indexOf('Wat kost dit?'));
  assert.ok(html.indexOf('Wat kost dit?') < html.indexOf('Oorspronkelijke coldmail.'));
  assert.equal((html.match(/Nieuw bericht sturen/g) || []).length, 1);
  assert.doesNotMatch(html, /Beantwoorden|Jouw eerdere mail|detail-mail-section-quote/);
  assert.match(html, /detail-mail-section-sent/);
  assert.match(html, /Jouw bericht/);
});

test('CC-kopie plaatst nieuw bericht sturen één keer vóór de volledige tijdlijn', () => {
  const html = renderMailboxBodyForTest('Mijn laatste antwoord aan de klant.', [], {
    replyMailId: 'serve@softora.nl|inbox:cc-copy',
    mail: {
      id: 'serve@softora.nl|inbox:cc-copy',
      folder: 'inbox',
      accountEmail: 'serve@softora.nl',
      receivedAt: '2026-07-24T17:15:00.000Z',
      copyContext: {
        evidenceKnown: true,
        kind: 'cc',
        sourceName: 'Martijn van de Ven',
        sourceEmail: 'martijn@softora.nl',
        recipientName: 'Sandra van Berkel',
        recipientEmail: 'sandra@example.nl',
        copyAccountEmail: 'serve@softora.nl',
      },
      threadMessages: [{
        id: 'sent:cc-original',
        folder: 'sent',
        accountEmail: 'martijn@softora.nl',
        date: '2026-07-24T15:00:00.000Z',
        body: 'Eerste bericht aan Sandra.',
      }, {
        id: 'inbox:cc-reply',
        folder: 'inbox',
        accountEmail: 'martijn@softora.nl',
        date: '2026-07-24T15:30:00.000Z',
        body: 'Sandra antwoordt.',
      }],
    },
  });

  assert.equal((html.match(/Nieuw bericht sturen/g) || []).length, 1);
  assert.ok(html.indexOf('Nieuw bericht sturen') < html.indexOf('Mijn laatste antwoord aan de klant.'));
  assert.ok(html.indexOf('Mijn laatste antwoord aan de klant.') < html.indexOf('Sandra antwoordt.'));
  assert.ok(html.indexOf('Sandra antwoordt.') < html.indexOf('Eerste bericht aan Sandra.'));
});

test('standaard multi-turn gesprek toont echte berichten nieuwste eerst', () => {
  const html = renderMailboxBodyForTest('Sandra antwoordt op het eerste bericht.', [], {
    replyMailId: 'inbox:standard-middle',
    mail: {
      id: 'inbox:standard-middle',
      folder: 'inbox',
      accountEmail: 'serve@softora.nl',
      receivedAt: '2026-07-24T08:58:00.000Z',
      threadMessages: [{
        id: 'sent:latest',
        folder: 'sent',
        accountEmail: 'serve@softora.nl',
        date: '2026-07-24T16:15:00.000Z',
        body: 'Mijn nieuwste antwoord aan Sandra.',
      }, {
        id: 'sent:original',
        folder: 'sent',
        accountEmail: 'serve@softora.nl',
        date: '2026-07-24T07:44:00.000Z',
        body: 'Mijn oorspronkelijke bericht aan Sandra.',
      }],
    },
  });

  assert.equal((html.match(/Nieuw bericht sturen/g) || []).length, 1);
  assert.ok(html.indexOf('Nieuw bericht sturen') < html.indexOf('Mijn nieuwste antwoord aan Sandra.'));
  assert.ok(html.indexOf('Mijn nieuwste antwoord aan Sandra.') < html.indexOf('Sandra antwoordt op het eerste bericht.'));
  assert.ok(html.indexOf('Sandra antwoordt op het eerste bericht.') < html.indexOf('Mijn oorspronkelijke bericht aan Sandra.'));
});

test('elk inkomend bericht toont datum tijd en bewezen Van en Aan direct boven de eigen inhoud', () => {
  const helpers = loadMailboxHelpersForTest();
  const rootMeta = helpers.renderMailboxRootIncomingMeta({
    id: 'inbox:bosque',
    folder: 'inbox',
    date: '17 juli',
    time: '12:20',
    from: 'Bosque Den Bosch',
    email: 'info@bosque.example',
    toDisplay: 'Servé Creusen <serve@softora.nl>',
    recipientRoutingEvidenceKnown: true,
  });
  assert.match(rootMeta, /detail-message-meta/);
  assert.ok(rootMeta.indexOf('17 juli, 12:20') < rootMeta.indexOf('Van:'));
  assert.ok(rootMeta.indexOf('Van:') < rootMeta.indexOf('Aan:'));
  assert.match(rootMeta, /aria-label="Ontvangen 17 juli, 12:20"/);
  assert.match(rootMeta, /Van:<\/span><strong>Bosque Den Bosch &lt;info@bosque\.example&gt;/);
  assert.match(rootMeta, /Aan:<\/span><strong>Servé Creusen &lt;serve@softora\.nl&gt;/);
  assert.doesNotMatch(rootMeta, /detail-message-sender/);
  assert.equal(helpers.renderMailboxRootIncomingMeta({
    folder: 'inbox',
    date: '17 juli',
    time: '12:20',
    copyContext: { evidenceKnown: true, kind: 'bcc' },
  }, 'Martijn van de Ven'), '');

  const scriptSource = readScript();
  const pageSource = readPage();
  assert.match(
    scriptSource,
    /renderMailBody\(detailBody, m\.bodyImages, \{[\s\S]*rootIncomingMeta,[\s\S]*threadImagesReady: true/
  );
  assert.doesNotMatch(scriptSource, /detail-body-text">\$\{rootIncomingMeta\}/);
  assert.doesNotMatch(scriptSource, /<div class="detail-date">/);
  assert.match(scriptSource, /const rootIncomingMeta = renderMailboxRootIncomingMeta\(m\);/);
  assert.match(pageSource, /\.detail-message-meta \{[\s\S]*font-size:\s*12px;/);
  assert.match(
    pageSource,
    /\.detail-message-time \{\s*font-weight:\s*400;\s*color:\s*var\(--text-light\);\s*\}/
  );
});

test('inkomende metadata blijft bij de eigen inhoud en nooit boven nieuw bericht sturen', () => {
  const helpers = loadMailboxHelpersForTest();
  const onsHagjeMail = {
    id: 'inbox:ons-hagje',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    receivedAt: '2026-06-24T15:35:00.000Z',
    date: '24 juni',
    time: '17:35',
    from: 'Ons Hagje',
    email: 'info@onshagje.nl',
    toDisplay: 'Servé Creusen <serve@softora.nl>',
    recipientRoutingEvidenceKnown: true,
    threadMessages: [{
      id: 'sent:reply',
      folder: 'sent',
      accountEmail: 'serve@softora.nl',
      date: '2026-06-25T10:20:00.000Z',
      body: 'Hoi Erik,\n\nBedankt voor je duidelijke reactie.',
    }, {
      id: 'sent:original',
      folder: 'sent',
      accountEmail: 'serve@softora.nl',
      date: '2026-06-02T15:21:00.000Z',
      body: 'Goedendag,\n\nAfgelopen week kwam ik jullie website tegen.',
    }],
  };
  const rootIncomingMeta = helpers.renderMailboxRootIncomingMeta(onsHagjeMail);
  const newMessageHtml = helpers.renderMailBody(
    'Hoi Servé,\n\nBedankt voor je bericht, maar we pakken dit intern op.',
    [],
    {
      replyMailId: onsHagjeMail.id,
      rootIncomingMeta,
      mail: onsHagjeMail,
    }
  );

  assert.ok(newMessageHtml.indexOf('Nieuw bericht sturen') < newMessageHtml.indexOf('Bedankt voor je duidelijke reactie.'));
  assert.ok(newMessageHtml.indexOf('Bedankt voor je duidelijke reactie.') < newMessageHtml.indexOf('24 juni, 17:35'));
  const rootDateIndex = newMessageHtml.indexOf('24 juni, 17:35');
  const rootFromIndex = newMessageHtml.indexOf('Van:', rootDateIndex);
  const rootToIndex = newMessageHtml.indexOf('Aan:', rootFromIndex);
  assert.ok(rootDateIndex < rootFromIndex);
  assert.ok(rootFromIndex < rootToIndex);
  assert.ok(rootToIndex < newMessageHtml.indexOf('Hoi Servé', rootToIndex));
  assert.match(
    newMessageHtml,
    /<section class="detail-mail-section detail-mail-section-received"[^>]*>\s*<section class="detail-mail-section">\s*<div class="detail-message-meta"[\s\S]*?24 juni, 17:35[\s\S]*?Van:<\/span><strong>Ons Hagje[\s\S]*?Aan:<\/span><strong>Servé Creusen[\s\S]*?Hoi Servé/
  );

  const replyMail = {
    ...onsHagjeMail,
    id: 'inbox:reply-latest',
    threadMessages: [onsHagjeMail.threadMessages[1]],
  };
  const replyMeta = helpers.renderMailboxRootIncomingMeta(replyMail);
  const replyHtml = helpers.renderMailBody(
    'Hoi Servé,\n\nKun je iets meer vertellen?',
    [],
    {
      replyMailId: replyMail.id,
      rootIncomingMeta: replyMeta,
      mail: replyMail,
    }
  );
  assert.ok(replyHtml.indexOf('24 juni, 17:35') < replyHtml.indexOf('Kun je iets meer vertellen?'));
  assert.ok(replyHtml.indexOf('Kun je iets meer vertellen?') < replyHtml.indexOf('Beantwoorden'));
  assert.doesNotMatch(replyHtml, /Nieuw bericht sturen/);
});

test('Salon TOF toont geen standalone kaart voor een uit de inkomende body afgeleid eigen citaat', () => {
  const html = renderMailboxBodyForTest([
    'Met welk programma werk je? Wij hebben nu Webflow.',
    '',
    'Op 24 juli 2026 schreef Servé Creusen:',
    'Goedendag,',
    'Afgelopen week kwam ik jullie website salontof.nl tegen.',
  ].join('\n'), [], {
    replyMailId: 'inbox:salon-tof',
    rootIncomingMeta: '<div class="detail-message-meta">Vandaag, 13:54 · Info | Salon TOF</div>',
    mail: {
      id: 'inbox:salon-tof',
      folder: 'inbox',
      accountEmail: 'serve@softora.nl',
      receivedAt: '2026-07-24T11:54:00.000Z',
      threadMessages: [],
    },
  });

  assert.equal((html.match(/data-mailbox-message-direction="incoming"/g) || []).length, 1);
  assert.match(html, /detail-mail-section-received/);
  assert.match(html, /Met welk programma werk je\? Wij hebben nu Webflow\./);
  assert.doesNotMatch(html, /detail-mail-section-history-sent/);
  assert.doesNotMatch(html, /Jouw bericht \(citaat · niet ontvangen\)|Eerder verzonden bericht, niet ontvangen/);
  assert.doesNotMatch(html, /Afgelopen week kwam ik jullie website salontof\.nl tegen\./);
  assert.equal((html.match(/data-mailbox-message-direction="incoming"/g) || []).length, 1);
  assert.equal((html.match(/data-mailbox-action="reply-mail"/g) || []).length, 1);

  const pageSource = readPage();
  assert.match(
    pageSource,
    /\.detail-mail-section-received \{[^}]*padding:\s*18px;[^}]*background:\s*rgba\(82,86,99,\.065\);[^}]*border-left:\s*3px solid rgba\(82,86,99,\.34\);/
  );
  assert.doesNotMatch(
    pageSource,
    /\.detail-mail-section-received \{[^}]*rgba\(155,35,85/
  );
});

test('contactdossier telt een geneste eigen quote niet als bericht en muteert de bronbody niet', () => {
  const sourceBody = [
    'Bedankt voor je bericht.',
    '',
    'Op 18 aug 2026 schreef Martijn van de Ven:',
    '> Dit is alleen geciteerde eerdere uitgaande tekst.',
    '> ----- Doorgestuurd bericht -----',
    '> Nested quote blijft onderdeel van de bronmail.',
  ].join('\n');
  const root = {
    id: 'inbox:nested-quote',
    messageId: '<nested-quote@example.test>',
    folder: 'inbox',
    accountEmail: 'martijn@softora.nl',
    email: 'contact@example.test',
    to: 'martijn@softora.nl',
    body: sourceBody,
    threadMessages: [],
  };

  discoveryModule.mergeContactTimeline(root, [root], 'contact@example.test', 1, {
    accountEmails: ['martijn@softora.nl'],
  });
  const html = renderMailboxBodyForTest(root.body, [], {
    contactDossierMode: true,
    replyMailId: root.id,
    mail: root,
  });
  const summary = discoveryModule.renderTimelineSummary(root, String);

  assert.equal(root.body, sourceBody);
  assert.equal(root.threadMessages.length, 0);
  assert.equal(root.contactTimelineTotal, 1);
  assert.match(summary, /<strong>Contactdossier:<\/strong>/);
  assert.match(summary, /1 berichten/);
  assert.match(html, /Bedankt voor je bericht\./);
  assert.doesNotMatch(html, /Dit is alleen geciteerde|Nested quote|Doorgestuurd bericht/);
  assert.doesNotMatch(html, /detail-mail-section-history-sent|citaat · niet ontvangen/i);
});

test('onbewezen citaat in een inkomend bericht wordt evenmin een standalone timelinekaart', () => {
  const html = renderMailboxBodyForTest([
    'Dit is de nieuwe ontvangen tekst.',
    '',
    'On 20 Jul 2026, John Example wrote:',
    '',
    'Original message.',
  ].join('\n'), [], {
    replyMailId: 'inbox:neutral-quote',
    mail: {
      id: 'inbox:neutral-quote',
      folder: 'inbox',
      accountEmail: 'serve@softora.nl',
      receivedAt: '2026-07-24T11:54:00.000Z',
      threadMessages: [],
    },
  });

  assert.match(html, /data-mailbox-message-direction="incoming"/);
  assert.match(html, /Dit is de nieuwe ontvangen tekst\./);
  assert.doesNotMatch(html, /detail-mail-section-history/);
  assert.doesNotMatch(html, /Original message\.|John Example wrote/);
  assert.doesNotMatch(html, /niet ontvangen|Ingesloten berichtgeschiedenis/i);
});

test('beantwoorden staat in de nieuwste inkomende grijze threadkaart en nergens los eronder', () => {
  const html = renderMailboxBodyForTest('Ouder ontvangen bericht.', [], {
    replyMailId: 'inbox:root-older',
    mail: {
      id: 'inbox:root-older',
      folder: 'inbox',
      accountEmail: 'serve@softora.nl',
      receivedAt: '2026-07-24T08:58:00.000Z',
      threadMessages: [{
        id: 'inbox:latest',
        folder: 'inbox',
        accountEmail: 'serve@softora.nl',
        date: '2026-07-24T16:15:00.000Z',
        from: 'Sandra van Berkel',
        body: 'Nieuwste ontvangen vraag.',
      }],
    },
  });

  assert.equal((html.match(/data-mailbox-action="reply-mail"/g) || []).length, 1);
  assert.ok(html.indexOf('Nieuwste ontvangen vraag.') < html.indexOf('Ouder ontvangen bericht.'));
  assert.match(
    html,
    /<section class="detail-mail-section detail-mail-section-received">[\s\S]*?Nieuwste ontvangen vraag\.[\s\S]*?<div class="detail-footer">[\s\S]*?Beantwoorden[\s\S]*?<\/div>\s*<\/section>/
  );
  assert.doesNotMatch(html, /<\/section>\s*<div class="detail-footer">[\s\S]*?Beantwoorden/);
});

test('mailbox hydrateert elk afgekapt threadbericht wanneer een oud gesprek opent', async () => {
  const helpers = loadMailboxHelpersForTest();
  const requests = [];
  const rerenders = [];
  const mail = {
    id: 'serve@softora.nl|inbox:65',
    accountEmail: 'serve@softora.nl',
    threadMessages: [
      {
        id: 'sent:87',
        uid: 87,
        folder: 'sent',
        accountEmail: 'serve@softora.nl',
        preview: 'Beste Lenneke, bedankt voor je reactie en de lijst met potentiële kan...',
        body: '',
        hasBody: true,
        bodyTruncated: true,
      },
      {
        id: 'sent:83',
        uid: 83,
        folder: 'sent',
        accountEmail: 'serve@softora.nl',
        preview: 'Goedendag, afgelopen week kwam ik jullie website tegen...',
        body: 'Gedeeltelijke inhoud',
        hasBody: true,
        bodyTruncated: true,
      },
      {
        id: 'sent:90',
        uid: 90,
        folder: 'sent',
        accountEmail: 'serve@softora.nl',
        to: 'klant@example.nl',
        toDisplay: 'Klant <klant@example.nl>',
        recipientRoutingEvidenceKnown: true,
        body: 'Dit bericht was al volledig.',
        hasBody: true,
        bodyTruncated: false,
      },
      {
        id: 'sent:91',
        uid: 91,
        folder: 'sent',
        accountEmail: 'serve@softora.nl',
        preview: 'Deze veilige preview blijft staan als de volledige body nog niet beschikbaar is...',
        body: '',
        hasBody: true,
        bodyTruncated: true,
      },
    ],
  };
  const fullBodies = {
    'sent:87': 'Beste Lenneke,\n\nFijn dat jullie mij meenemen in de lijst met potentiële kandidaten.',
    'sent:83': 'Goedendag,\n\nHier staat de volledige oorspronkelijke mail.',
  };

  const updated = await helpers.index.loadThreadBodies({
    mail,
    normalizeBodyImages: (images) => images || [],
    normalizeOptOutUrl: (value) => String(value || ''),
    getActiveMail: () => mail.id,
    openMail: (id, options) => rerenders.push({ id, options }),
    fetchImpl: async (url, options = {}) => {
      if (String(url) === '/api/mailbox/messages/bodies') {
        const body = JSON.parse(options.body);
        requests.push({
          kind: 'batch',
          ids: body.messages.map((message) => message.id),
        });
        return {
          ok: true,
          json: async () => ({
            ok: true,
            messages: body.messages
              .filter((message) => message.id !== 'sent:91')
              .map((message) => ({
                ...message,
                accountEmail: message.account,
                body: fullBodies[message.id],
                hasBody: true,
                bodyTruncated: false,
                bodyImageEvidenceKnown: true,
                embeddedImageCount: 0,
                originalCampaignOutbound: message.id === 'sent:83',
                to: 'klant@example.nl',
                toDisplay: 'Klant <klant@example.nl>',
                recipientRoutingEvidenceKnown: true,
              })),
          }),
        };
      }
      const parsed = new URL(String(url), 'https://www.softora.nl');
      const requestId = parsed.searchParams.get('id');
      requests.push({
        kind: 'detail',
        account: parsed.searchParams.get('account'),
        folder: parsed.searchParams.get('folder'),
        id: requestId,
      });
      return {
        ok: true,
        json: async () => ({
          ok: true,
          message: {
            body: fullBodies[requestId],
            hasBody: true,
            bodyTruncated: false,
            bodyImages: [],
            to: 'klant@example.nl',
            toDisplay: 'Klant <klant@example.nl>',
            recipientRoutingEvidenceKnown: true,
          },
        }),
      };
    },
  });

  assert.equal(updated, true);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], {
    kind: 'batch',
    ids: ['sent:87', 'sent:83', 'sent:91'],
  });
  assert.equal(requests[1].id, 'sent:91');
  assert.ok(requests.filter((request) => request.kind === 'detail').every((request) => (
    request.account === 'serve@softora.nl' && request.folder === 'sent'
  )));
  assert.equal(mail.threadMessages[0].body, fullBodies['sent:87']);
  assert.equal(mail.threadMessages[1].body, fullBodies['sent:83']);
  assert.equal(mail.threadMessages[0].bodyTruncated, false);
  assert.equal(mail.threadMessages[1].bodyTruncated, false);
  assert.equal(mail.threadMessages[2].body, 'Dit bericht was al volledig.');
  assert.equal(mail.threadMessages[3].body, '');
  assert.equal(mail.threadMessages[3].bodyTruncated, true);
  assert.equal(rerenders.length, 1);
  assert.ok(rerenders.every((entry) => entry.id === mail.id));
  assert.ok(rerenders.every((entry) => (
    entry.options.skipBodyFetch === true && entry.options.skipThreadBodyFetch === true
  )));
});

test('mailbox houdt geïndexeerde oude verzonden tekst zichtbaar als optionele media-verrijking faalt', async () => {
  const helpers = loadMailboxHelpersForTest();
  const mail = {
    id: 'serve@softora.nl|inbox:35',
    accountEmail: 'serve@softora.nl',
    threadMessages: [{
      id: 'sent:39',
      uid: 39,
      folder: 'sent',
      accountEmail: 'serve@softora.nl',
      body: '',
      hasBody: true,
      bodyTruncated: true,
      originalCampaignOutbound: true,
      webdesignLinkEvidenceKnown: true,
    }],
  };

  await helpers.index.loadThreadBodies({
    mail,
    normalizeBodyImages: (images) => images || [],
    normalizeOptOutUrl: (value) => String(value || ''),
    getActiveMail: () => mail.id,
    openMail: () => {},
    fetchImpl: async (url) => {
      if (String(url) === '/api/mailbox/messages/bodies') {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            messages: [{
              id: 'sent:39',
              uid: 39,
              folder: 'sent',
              accountEmail: 'serve@softora.nl',
              body: 'Volledige oude verzonden mail.',
              hasBody: true,
              bodyTruncated: false,
              bodyImageEvidenceKnown: false,
              embeddedImageCount: 0,
              originalCampaignOutbound: true,
              webdesignLinkEvidenceKnown: true,
            }],
          }),
        };
      }
      return { ok: false, json: async () => ({ detail: 'Oude IMAP-media niet beschikbaar' }) };
    },
  });

  assert.equal(mail.threadMessages[0].body, 'Volledige oude verzonden mail.');
  assert.equal(mail.threadMessages[0].bodyLoadError, '');
  assert.equal(mail.threadMessages[0].bodyLoading, false);
});

test('mailbox toont tijdens bodyhydratie een eerlijke laadstatus in plaats van een afgekorte preview', () => {
  const html = campaignInboxModule.renderThreadMessages(
    {
      receivedAt: '2026-07-24T12:00:00.000Z',
      threadMessages: [{
        id: 'sent:87',
        folder: 'sent',
        accountEmail: 'serve@softora.nl',
        date: '2026-07-24T11:00:00.000Z',
        preview: 'Beste Lenneke, lijst met potentiële kan...',
        bodyLoading: true,
      }],
    },
    (value) => String(value || ''),
    () => ({ date: '24 juli', time: '13:00' })
  );

  assert.match(html, /Volledig bericht laden…/);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /potentiële kan\.\.\./);
});

test('mailbox hydrateert een Instantly-threadbericht via providerfolder zonder IMAP-fallback', async () => {
  const helpers = loadMailboxHelpersForTest();
  const requests = [];
  const mail = {
    id: 'instantly:incoming-1',
    accountEmail: 'serve@websoftora.com',
    provider: 'instantly',
    receivedAt: '2026-07-29T07:31:00.000Z',
    threadMessages: [{
      id: 'instantly:sent-1',
      uid: 0,
      folder: 'sent',
      storageFolder: 'instantly',
      accountEmail: 'serve@websoftora.com',
      provider: 'instantly',
      date: '2026-07-29T07:30:00.000Z',
      body: '',
      hasBody: true,
      bodyTruncated: true,
    }],
  };

  const updated = await helpers.index.loadThreadBodies({
    mail,
    getActiveMail: () => '',
    openMail() {},
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      assert.equal(String(url), '/api/mailbox/messages/bodies');
      const body = JSON.parse(options.body);
      assert.deepEqual(body.messages, [{
        account: 'serve@websoftora.com',
        folder: 'instantly',
        id: 'instantly:sent-1',
        uid: 0,
      }]);
      return {
        ok: true,
        json: async () => ({
          ok: true,
          messages: [{
            id: 'instantly:sent-1',
            uid: 0,
            folder: 'instantly',
            accountEmail: 'serve@websoftora.com',
            body: 'Volledige exacte Instantly-mail.',
            hasBody: true,
            bodyTruncated: false,
            bodyImageEvidenceKnown: true,
            embeddedImageCount: 0,
          }],
        }),
      };
    },
  });

  assert.equal(updated, true);
  assert.equal(requests.length, 1);
  assert.equal(mail.threadMessages[0].body, 'Volledige exacte Instantly-mail.');
  assert.equal(mail.threadMessages[0].bodyLoadError, '');
});

test('mailbox toont een Gmail-dot-alias outbound altijd als roze Jouw bericht', () => {
  const html = campaignInboxModule.renderThreadMessages(
    {
      id: 'inbox:reply',
      accountEmail: 'servecreusen7@gmail.com',
      receivedAt: '2026-07-28T16:00:00.000Z',
      threadMessages: [{
        id: 'coldmail:243',
        folder: 'coldmail',
        storageFolder: 'coldmail',
        sourceFolders: ['coldmail'],
        accountEmail: 'servecreusen7@gmail.com',
        email: 'serve.creusen7@gmail.com',
        to: 'info@altiflexpersoneelsdiensten.nl',
        date: '2026-07-28T14:51:59.000Z',
        body: 'Volledige echte uitgaande mail.',
        hasBody: true,
        bodyLoaded: true,
      }],
    },
    (value) => String(value || ''),
    () => ({ date: 'Vandaag', time: '16:51' })
  );

  assert.match(html, /Jouw bericht/);
  assert.match(html, /detail-mail-section-sent/);
  assert.doesNotMatch(html, /Eerder ontvangen/);
  assert.doesNotMatch(html, /detail-mail-section-received/);
});

test('threadhydratie begrenst werk en geeft elk niet geladen bericht een retry in plaats van een eeuwige loader', async () => {
  const helpers = loadMailboxHelpersForTest();
  const threadMessages = Array.from({ length: 45 }, (_item, index) => ({
    id: `sent:${index + 1}`,
    uid: index + 1,
    folder: 'sent',
    accountEmail: 'serve@softora.nl',
    date: new Date(Date.UTC(2026, 6, 28, 12, index)).toISOString(),
    body: '',
    hasBody: true,
    bodyTruncated: true,
  }));
  const mail = { id: 'inbox:bounded', accountEmail: 'serve@softora.nl', threadMessages };
  const batches = [];
  const fetchImpl = async (_url, options) => {
    const references = JSON.parse(options.body).messages;
    batches.push(references);
    return {
      ok: true,
      json: async () => ({
        ok: true,
        messages: references.map((reference) => ({
          ...reference,
          accountEmail: reference.account,
          body: `Volledig ${reference.id}`,
          hasBody: true,
          bodyTruncated: false,
          bodyImageEvidenceKnown: true,
        })),
      }),
    };
  };

  await helpers.index.loadThreadBodies({ mail, fetchImpl, getActiveMail: () => '', openMail() {} });

  assert.equal(batches.length, 2);
  assert.deepEqual(batches.map((batch) => batch.length), [20, 20]);
  assert.equal(threadMessages.slice(0, 40).every((message) => message.bodyLoaded === true), true);
  assert.equal(threadMessages.slice(40).every((message) => /losse laadpoging/.test(message.bodyLoadError)), true);
  const html = campaignInboxModule.renderThreadMessages(
    mail,
    (value) => String(value || ''),
    () => ({ date: 'Vandaag', time: '12:00' })
  );
  assert.doesNotMatch(html, /Volledig bericht laden…/);
  assert.equal((html.match(/Opnieuw proberen/g) || []).length, 5);

  await helpers.index.loadThreadBodies({
    mail,
    targetMessages: [threadMessages[44]],
    retryFailed: true,
    fetchImpl,
    getActiveMail: () => '',
    openMail() {},
  });
  assert.equal(threadMessages[44].body, 'Volledig sent:45');
  assert.equal(threadMessages[44].bodyLoadError, '');
});

test('mailbox lekt geen previews uit gesorteerde inkomende en uitgaande threadkaarten voor of na hydratatie', async () => {
  const mailbox = loadMailboxHelpersForTest();
  const outgoing = mailbox.normalizeMailboxApiMessage({
    id: 'sent:301',
    uid: 301,
    folder: 'sent',
    accountEmail: 'serve@softora.nl',
    from: 'Servé Creusen',
    to: 'info@voorbeeld.nl',
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik d...',
    body: '',
    hasBody: true,
    bodyTruncated: false,
    receivedAt: '2026-07-24T13:00:00.000Z',
  });
  const incoming = mailbox.normalizeMailboxApiMessage({
    id: 'inbox:302',
    uid: 302,
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    from: 'Voorbeeldbedrijf',
    email: 'info@voorbeeld.nl',
    to: 'serve@softora.nl',
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Op vr 24 jul 2026 om ...',
    body: '',
    hasBody: true,
    bodyTruncated: false,
    receivedAt: '2026-07-24T14:00:00.000Z',
  });
  const mail = {
    id: 'serve@softora.nl|inbox:303',
    accountEmail: 'serve@softora.nl',
    receivedAt: '2026-07-24T15:00:00.000Z',
    threadMessages: [outgoing, incoming],
  };
  const renderSortedThread = () => campaignInboxModule.renderThreadMessages(
    mail,
    (value) => String(value || ''),
    (value) => ({
      date: value === incoming.receivedAt ? '24 juli' : '23 juli',
      time: value === incoming.receivedAt ? '14:00' : '13:00',
    }),
    { newestFirst: true }
  );

  const initialHtml = renderSortedThread();
  assert.equal((initialHtml.match(/Volledig bericht laden…/g) || []).length, 2);
  assert.doesNotMatch(initialHtml, /gemaakt, gewoon omdat ik d\.\.\./);
  assert.doesNotMatch(initialHtml, /Op vr 24 jul 2026 om \.\.\./);

  const batchRequests = [];
  const fullBodies = {
    'sent:301': 'Volledige uitgaande mail zonder afkorting.',
    'inbox:302': 'Volledige ontvangen mail zonder afkorting.',
  };
  await mailbox.index.loadThreadBodies({
    mail,
    normalizeBodyImages: (images) => images || [],
    normalizeOptOutUrl: (value) => String(value || ''),
    getActiveMail: () => '',
    openMail() {},
    fetchImpl: async (url, options = {}) => {
      assert.equal(String(url), '/api/mailbox/messages/bodies');
      const references = JSON.parse(options.body).messages;
      batchRequests.push(references);
      return {
        ok: true,
        json: async () => ({
          ok: true,
          messages: references.map((message) => ({
            ...message,
            accountEmail: message.account,
            body: fullBodies[message.id],
            hasBody: true,
            bodyTruncated: false,
            bodyImageEvidenceKnown: true,
            embeddedImageCount: 0,
          })),
        }),
      };
    },
  });

  assert.equal(batchRequests.length, 1);
  assert.deepEqual(batchRequests[0].map((message) => message.id), ['sent:301', 'inbox:302']);
  const hydratedHtml = renderSortedThread();
  assert.doesNotMatch(hydratedHtml, /Volledig bericht laden…/);
  assert.doesNotMatch(hydratedHtml, /\.\.\./);
  assert.match(hydratedHtml, /Volledige ontvangen mail zonder afkorting\./);
  assert.match(hydratedHtml, /Volledige uitgaande mail zonder afkorting\./);
  assert.ok(
    hydratedHtml.indexOf('Volledige ontvangen mail zonder afkorting.') <
      hydratedHtml.indexOf('Volledige uitgaande mail zonder afkorting.')
  );
});

test('mailbox toont legacy snapshotmedia nooit kort voordat de exacte body geladen is', async () => {
  const mailbox = loadMailboxHelpersForTest({
    fetch: async () => new Promise(() => {}),
  });
  await mailbox.ready;
  const legacyCaption =
    'Hieronder zie je een korte indruk van de eerste versie op verschillende schermen.';
  const mail = mailbox.normalizeMailboxApiMessage({
    id: 'inbox:2478',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    from: 'Salon TOF',
    email: 'info@salontof.nl',
    subject: 'Re: Kleine vraag over jullie website',
    preview: 'Met welk programma werk je?',
    body: [
      'Met welk programma werk je?',
      '',
      '[image: salontof.nl-preview]',
      legacyCaption,
      '[image: salontof.nl-preview-device-mockup-v8]',
    ].join('\n'),
    hasBody: true,
    bodyTruncated: false,
    bodyImagesTruncated: false,
    bodyImageEvidenceKnown: false,
    receivedAt: '2026-07-24T13:54:00.000Z',
  });

  assert.equal(mail.bodyLoaded, false);
  mailbox.setMails([mail]);
  mailbox.openMail(mail.id);

  const detail = mailbox.getElement('mail-detail');
  const html = detail.innerHTML;
  assert.equal(detail.classList.contains('is-detail-pending'), true);
  assert.equal(detail.hasAttribute('inert'), true);
  assert.doesNotMatch(html, /korte indruk van de eerste versie/);
  assert.doesNotMatch(html, /salontof\.nl-preview/);
});

test('Salon TOF contactdossier toont contacttitel en één nieuwe-berichtactie boven twaalf berichten', async () => {
  const mailbox = loadMailboxHelpersForTest();
  await mailbox.ready;
  const contact = 'info@salontof.nl';
  const account = 'serve@softora.nl';
  const messages = Array.from({ length: 12 }, (_unused, index) => {
    const sent = index % 2 === 1;
    return {
      id: `${sent ? 'sent' : 'inbox'}:salon-${index + 1}`,
      mailboxId: `${sent ? 'sent' : 'inbox'}:salon-${index + 1}`,
      messageId: `<salon-${index + 1}@test>`,
      messageKey: `${account}|${sent ? 'sent' : 'inbox'}|${index + 1}`,
      accountEmail: account,
      folder: sent ? 'sent' : 'inbox',
      from: sent ? 'Servé Creusen' : 'Salon TOF',
      email: sent ? account : contact,
      to: sent ? contact : account,
      toDisplay: sent ? 'Salon TOF <info@salontof.nl>' : 'Servé Creusen <serve@softora.nl>',
      recipientRoutingEvidenceKnown: true,
      subject: index < 6 ? 'Re: Kleine vraag over jullie website' : 'Fwd: Nieuw onderwerp',
      body: `Berichtinhoud ${index + 1}`,
      preview: `Berichtinhoud ${index + 1}`,
      hasBody: true,
      bodyLoaded: true,
      bodyTruncated: false,
      date: new Date(Date.UTC(2026, 7, 1, index)).toISOString(),
      receivedAt: new Date(Date.UTC(2026, 7, 1, index)).toISOString(),
      technicalThreadKey: index < 6 ? 'thread-a' : 'thread-b',
      externalContactEmail: contact,
    };
  });
  const root = mailbox.normalizeMailboxApiMessage({
    ...messages[11],
    id: 'contact:salon-tof',
    mailboxId: 'contact:salon-tof',
    contactTimelineLoaded: true,
    contactTimelineTotal: 12,
    contactTimelineThreadCount: 2,
    threadMessages: messages.slice(0, 11),
  });
  root.contactTimelineLoaded = true;
  root.contactTimelineTotal = 12;
  root.contactTimelineThreadCount = 2;
  root.externalContactEmail = contact;
  root.threadMessages = messages.slice(0, 11);
  mailbox.setMails([root]);
  await mailbox.openMail(root.id, {
    skipBodyFetch: true,
    skipThreadBodyFetch: true,
    skipContactTimeline: true,
  });

  const html = mailbox.getElement('mail-detail').innerHTML;
  const detailHeader = html.slice(0, html.indexOf('<div class="detail-divider"'));
  const rootCard = html.match(/<section class="detail-mail-section detail-mail-section-sent"[^>]*data-mailbox-root-message="true">([\s\S]*?)<\/section>/)?.[1] || '';
  assert.match(html, /<div class="detail-subject">Salon TOF<\/div>/);
  assert.match(html, /<strong>Contactdossier:<\/strong>/);
  assert.match(html, /12 berichten · 2 onderwerpen/);
  assert.equal((html.match(/Nieuw bericht sturen/g) || []).length, 1);
  assert.equal((html.match(/detail-contact-action/g) || []).length, 1);
  assert.ok(html.indexOf('detail-contact-action') < html.indexOf('detail-divider'));
  assert.ok(html.indexOf('detail-contact-action') < html.indexOf('Berichtinhoud 12'));
  assert.doesNotMatch(html, /mail-contact-thread-boundary/);
  assert.doesNotMatch(html, /Re: Kleine vraag over jullie website|Fwd: Nieuw onderwerp/);
  assert.ok((html.match(/detail-mail-section/g) || []).length >= 12);
  assert.equal((html.match(/<span>Van:<\/span>/g) || []).length, 12);
  assert.equal((html.match(/<span>Aan:<\/span>/g) || []).length, 12);
  assert.match(rootCard, /<span>Van:<\/span><strong>Servé Creusen &lt;serve@softora\.nl&gt;<\/strong>/);
  assert.match(rootCard, /<span>Aan:<\/span><strong>Salon TOF &lt;info@salontof\.nl&gt;<\/strong>/);
  assert.match(rootCard, /Berichtinhoud 12/);
  assert.doesNotMatch(detailHeader, /class="detail-routing"/);
  assert.match(html, /data-mailbox-action="reply-mail"/);
  assert.doesNotMatch(readPage(), /\.mail-contact-thread-boundary/);
  assert.match(readPage(), /\.detail-contact-action \{ padding: 14px 0 2px; \}/);
  assert.match(
    fs.readFileSync(path.join(__dirname, '../../assets/premium-mailbox-mobile.css'), 'utf8'),
    /\.detail-contact-action \.detail-reply \{ width: 100%; justify-content: center; \}/
  );
});

test('mailbox hydrateert een oorspronkelijke webdesignlink uit exact MIME-bewijs', async () => {
  const helpers = loadMailboxHelpersForTest();
  const exactUrl =
    'https://www.softora.nl/webdesign/salon-tof?cid=safe-row-247&sender=serve';
  const plainBody = [
    'Goedendag,',
    '',
    'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link bekijken 🎨',
  ].join('\n');
  const linkedBody = plainBody.replace('deze link', `deze link [${exactUrl}]`);
  const mail = {
    id: 'serve@softora.nl|inbox:2478',
    accountEmail: 'serve@softora.nl',
    threadMessages: [{
      id: 'sent:247',
      uid: 247,
      folder: 'sent',
      accountEmail: 'serve@softora.nl',
      body: plainBody,
      hasBody: true,
      bodyTruncated: false,
      bodyImageEvidenceKnown: true,
      embeddedImageCount: 0,
      originalCampaignOutbound: true,
      webdesignLinkEvidenceKnown: false,
    }],
  };
  const requests = [];

  await helpers.index.loadThreadBodies({
    mail,
    normalizeBodyImages: (images) => images || [],
    normalizeOptOutUrl: (value) => String(value || ''),
    getActiveMail: () => mail.id,
    openMail: () => {},
    fetchImpl: async (url) => {
      requests.push(String(url));
      if (String(url) === '/api/mailbox/messages/bodies') {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            messages: [{
              id: 'sent:247',
              uid: 247,
              folder: 'sent',
              accountEmail: 'serve@softora.nl',
              body: plainBody,
              hasBody: true,
              bodyTruncated: false,
              bodyImageEvidenceKnown: true,
              embeddedImageCount: 0,
              originalCampaignOutbound: true,
              webdesignLinkEvidenceKnown: false,
              webdesignLinkUrl: '',
            }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          ok: true,
          message: {
            body: linkedBody,
            hasBody: true,
            bodyTruncated: false,
            bodyImages: [],
            bodyImageEvidenceKnown: true,
            embeddedImageCount: 0,
            originalCampaignOutbound: true,
            webdesignLinkEvidenceKnown: true,
            webdesignLinkUrl: exactUrl,
          },
        }),
      };
    },
  });

  assert.deepEqual(requests, [
    '/api/mailbox/messages/bodies',
    '/api/mailbox/message?account=serve%40softora.nl&folder=sent&id=sent%3A247',
  ]);
  assert.equal(mail.threadMessages[0].body, linkedBody);
  assert.equal(mail.threadMessages[0].webdesignLinkUrl, exactUrl);

  const html = renderMailboxBodyForTest('Bedankt voor je mail.', [], {
    replyMailId: 'inbox:2478',
    mail: {
      receivedAt: '2026-07-24T13:54:00.000Z',
      threadMessages: mail.threadMessages,
    },
  });
  assert.match(
    html,
    /deze <a class="detail-mail-cta-link" href="https:\/\/www\.softora\.nl\/webdesign\/salon-tof\?cid=safe-row-247&amp;sender=serve" target="_blank" rel="noopener noreferrer">link<\/a>/
  );
});

test('mailbox houdt een bewezen outboundbody zichtbaar als alleen optionele linkverrijking faalt', async () => {
  const helpers = loadMailboxHelpersForTest();
  const exactBody = [
    'Goedendag,',
    '',
    'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link bekijken 🎨',
  ].join('\n');
  const mail = {
    id: 'instantly:mhc-received',
    accountEmail: 'servecreusen@websoftora.com',
    threadMessages: [{
      id: 'instantly:mhc-sent',
      folder: 'sent',
      storageFolder: 'instantly',
      accountEmail: 'servecreusen@websoftora.com',
      provider: 'instantly',
      body: exactBody,
      bodyLoaded: true,
      hasBody: true,
      bodyTruncated: false,
      bodyImageEvidenceKnown: true,
      embeddedImageCount: 0,
      originalCampaignOutbound: true,
      webdesignLinkEvidenceKnown: false,
    }],
  };
  const requests = [];

  await helpers.index.loadThreadBodies({
    mail,
    getActiveMail: () => mail.id,
    openMail() {},
    fetchImpl: async (url) => {
      requests.push(String(url));
      if (String(url) === '/api/mailbox/messages/bodies') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            messages: [{
              id: 'instantly:mhc-sent',
              folder: 'instantly',
              accountEmail: 'servecreusen@websoftora.com',
              body: exactBody,
              hasBody: true,
              bodyTruncated: false,
              bodyImageEvidenceKnown: true,
              embeddedImageCount: 0,
              originalCampaignOutbound: true,
              webdesignLinkEvidenceKnown: false,
            }],
          }),
        };
      }
      return {
        ok: false,
        status: 403,
        json: async () => ({ error: 'Linkbron niet beschikbaar' }),
      };
    },
  });

  assert.equal(requests.length, 2);
  assert.equal(mail.threadMessages[0].body, exactBody);
  assert.equal(mail.threadMessages[0].bodyLoaded, true);
  assert.equal(mail.threadMessages[0].bodyLoadError, '');
  assert.equal(mail.threadMessages[0].bodyLoading, false);
  assert.equal(mail.threadMessages[0].webdesignLinkHydrationAttempted, true);
  assert.equal(helpers.index.needsThreadLinkHydration(mail.threadMessages[0]), false);
});

test('MHC quote staat alleen in de bewezen roze outboundkaart en niet dubbel in grijs', () => {
  const exactUrl = 'https://www.softora.nl/webdesign/mhc-berkel-enschot?cid=safe-dedupe-20260615-row-830-5ee1bc4e3b&sender=serve';
  const outboundBody = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website mhcbe.nl tegen.',
    '',
    'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening 😁',
    '',
    `Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link [${exactUrl}] bekijken 🎨`,
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
    '',
    '📍 Berkel-Enschot',
  ].join('\n');
  const incomingBody = [
    'Beste Servé, bedankt voor je bericht.',
    '',
    'Op vr 24 jul 2026 om 07:33 schreef Servé Creusen <servecreusen@websoftora.com>:',
    ...outboundBody.replace(` [${exactUrl}]`, '').split('\n').map((line) => `> ${line}`),
  ].join('\n');
  const html = renderMailboxBodyForTest(incomingBody, [], {
    replyMailId: 'instantly:mhc-received',
    mail: {
      accountEmail: 'servecreusen@websoftora.com',
      provider: 'instantly',
      receivedAt: '2026-08-05T08:26:16.000Z',
      threadMessages: [{
        id: 'instantly:mhc-sent',
        folder: 'sent',
        storageFolder: 'instantly',
        accountEmail: 'servecreusen@websoftora.com',
        provider: 'instantly',
        providerOwner: 'serve',
        to: 'bestuur@mhcbe.nl',
        date: '2026-07-24T05:33:08.000Z',
        body: outboundBody,
        hasBody: true,
        bodyLoaded: true,
        originalCampaignOutbound: true,
        webdesignLinkEvidenceKnown: true,
        webdesignLinkUrl: exactUrl,
      }],
    },
  });

  assert.equal((html.match(/Afgelopen week kwam ik jullie website mhcbe\.nl tegen\./g) || []).length, 1);
  assert.match(html, /Jouw bericht/);
  assert.doesNotMatch(html, /Ingesloten berichtgeschiedenis/);
  assert.doesNotMatch(html, /Volledig bericht is niet beschikbaar/);
});

test('mailbox verwijdert alleen een exacte dubbele URL-annotatie op de volgende regel', () => {
  const url = 'https://www.festivalcement.nl/over-cement';
  const html = renderMailboxBodyForTest([
    `Bekijk onze contactgegevens op de website: ${url}`,
    `[${url}]`,
    '',
    'Dit is de echte vervolgregel.',
  ].join('\n'), []);

  assert.equal((html.match(/festivalcement\.nl\/over-cement/g) || []).length, 2);
  assert.doesNotMatch(html, /\[https:\/\/www\.festivalcement\.nl\/over-cement\]/);
  assert.match(html, /Dit is de echte vervolgregel\./);
});

test('mailbox vraagt voor legacy Open het via hier eerst exact MIME-bewijs op', () => {
  const helpers = loadMailboxHelpersForTest();
  const message = {
    id: 'sent:62',
    folder: 'sent',
    originalCampaignOutbound: true,
    webdesignLinkEvidenceKnown: false,
    body: [
      'PS: Wordt het webdesign niet zichtbaar?',
      'Open het via hier 👈',
    ].join('\n'),
  };

  assert.equal(helpers.index.needsThreadLinkHydration(message), true);
  message.webdesignLinkEvidenceKnown = true;
  assert.equal(helpers.index.needsThreadLinkHydration(message), false);
});

test('mailbox koppelt coldmail-afbeeldingen aan het eigen verzonden bericht en niet aan de ontvangen reactie', () => {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgo=';
  const html = renderMailboxBodyForTest(
    'Hoi Servé,\n\nMooi wat je hebt gemaakt, maar wij hebben geen interesse.\n\nSucces verder!',
    [],
    {
      replyMailId: 'inbox:stamhoeve',
      mail: {
        folder: 'inbox',
        accountEmail: 'servec321@gmail.com',
        receivedAt: '2026-07-23T20:17:00.000Z',
        threadMessages: [
          {
            id: 'sent:stamhoeve-followup',
            folder: 'sent',
            accountEmail: 'servec321@gmail.com',
            date: '2026-07-23T19:00:00.000Z',
            originalCampaignOutbound: false,
            bodyImageEvidenceKnown: true,
            embeddedImageCount: 2,
            bodyImages: [
              { alt: 'stamhoeve.nl webdesign', dataUrl: tinyPng },
              { alt: 'stamhoeve.nl device mockup', dataUrl: tinyPng },
            ],
            body: [
              'Hoi,',
              '',
              'Bedankt voor je reactie.',
              '',
              'Op 23 jul 2026 om 11:00 schreef Servé Creusen:',
              '> [image: stamhoeve.nl webdesign]',
              '> [image: stamhoeve.nl device mockup]',
            ].join('\n'),
          },
          {
            id: 'sent:stamhoeve',
            folder: 'sent',
            accountEmail: 'servec321@gmail.com',
            date: '2026-07-23T09:00:00.000Z',
            originalCampaignOutbound: true,
            bodyImageEvidenceKnown: true,
            embeddedImageCount: 2,
            bodyImages: [
              { alt: 'stamhoeve.nl webdesign', dataUrl: tinyPng },
              { alt: 'stamhoeve.nl device mockup', dataUrl: tinyPng },
            ],
            body: [
              'Goedendag,',
              '',
              'Uit enthousiasme heb ik een fris webdesign gemaakt.',
              '[image: stamhoeve.nl webdesign]',
              'Hieronder zie je de eerste versie op verschillende schermen.',
              '[image: stamhoeve.nl device mockup]',
            ].join('\n'),
          },
        ],
      },
    }
  );

  const ownMessageStart = html.indexOf('Jouw bericht');
  assert.ok(ownMessageStart > html.indexOf('Succes verder!'));
  assert.doesNotMatch(html.slice(0, ownMessageStart), /<figure class="detail-mail-image">/);
  assert.equal((html.match(/<figure class="detail-mail-image">/g) || []).length, 2);
  assert.ok(html.indexOf('Uit enthousiasme heb ik een fris webdesign gemaakt.') < html.indexOf('<figure class="detail-mail-image">'));
  assert.doesNotMatch(html, /\[image:/i);
});

test('mailbox toont geen designbeeld voor een link-only coldmail of vervuild vervolgbericht', () => {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgo=';
  const html = renderMailboxBodyForTest(
    'Dank voor uw bericht.',
    [],
    {
      replyMailId: 'inbox:kbo',
      mail: {
        folder: 'inbox',
        accountEmail: 'servec321@gmail.com',
        receivedAt: '2026-07-24T12:00:00.000Z',
        threadMessages: [{
          id: 'sent:kbo-followup',
          folder: 'sent',
          accountEmail: 'servec321@gmail.com',
          date: '2026-07-24T11:00:00.000Z',
          originalCampaignOutbound: false,
          bodyImageEvidenceKnown: true,
          embeddedImageCount: 0,
          body: 'Hoi, ik kom nog even terug op mijn eerdere bericht.',
          bodyImages: [{
            alt: 'www.softora.nl-preview',
            dataUrl: tinyPng,
            owner: 'sent-campaign',
          }],
        }, {
          id: 'sent:kbo-original',
          folder: 'sent',
          accountEmail: 'servec321@gmail.com',
          date: '2026-07-23T09:00:00.000Z',
          originalCampaignOutbound: true,
          bodyImageEvidenceKnown: true,
          embeddedImageCount: 0,
          body: [
            'Goedendag,',
            'Afgelopen week kwam ik jullie website kbo-heikant.nl tegen.',
            'Je kunt het webdesign hier bekijken.',
          ].join('\n'),
          bodyImages: [],
        }],
      },
    }
  );

  assert.match(html, /kbo-heikant\.nl/);
  assert.doesNotMatch(html, /<figure class="detail-mail-image">/);
  assert.doesNotMatch(html, /www\.softora\.nl-preview/);
});

test('mailbox toont een oudere inkomende reactie als onderdeel van dezelfde conversatie', () => {
  const html = renderMailboxBodyForTest(
    'Dank voor je antwoord. Kun je ons daar meer over vertellen?',
    [],
    {
      replyMailId: 'inbox:37476',
      mail: {
        accountEmail: 'martijnven123@gmail.com',
        receivedAt: '2026-07-23T09:21:00.000Z',
        threadMessages: [{
          id: 'inbox:37467',
          folder: 'inbox',
          accountEmail: 'martijnven123@gmail.com',
          date: '2026-07-22T15:36:03.000Z',
          body: 'Mag ik vragen waar jij het liefst je sites mee bouwt?',
        }],
      },
    }
  );

  assert.match(html, /Eerder ontvangen/);
  assert.match(html, /Mag ik vragen waar jij het liefst je sites mee bouwt\?/);
  assert.doesNotMatch(html, /Jouw bericht/);
  assert.match(html, /class="detail-mail-section detail-mail-section-received"/);
  assert.doesNotMatch(html, /detail-mail-section-received[^>]*detail-mail-section-sent/);
  assert.ok(html.indexOf('Beantwoorden') < html.indexOf('Eerder ontvangen'));
});

test('mailbox houdt Outlook-citaten buiten Jouw bericht en bouwt Ralphs tijdlijn nieuwste eerst op', () => {
  const html = renderMailboxBodyForTest(
    [
      'Hi Martijn,',
      '',
      'Dank voor je bericht.',
      'Ik heb via Claude Design zelf mijn website vernieuwd.',
      '',
      'Op ma 15 jun 2026 om 15:48 schreef Martijn van de Ven:',
      '> Goededag,',
    ].join('\n'),
    [],
    {
      replyMailId: 'inbox:23',
      mail: {
        accountEmail: 'martijn@softora.nl',
        receivedAt: '2026-06-15T13:58:18.000Z',
        threadMessages: [
          {
            id: 'sent:149',
            folder: 'sent',
            accountEmail: 'martijn@softora.nl',
            date: '2026-06-23T11:32:58.000Z',
            body: [
              'Hoi Ralph,',
              '',
              'Misschien heb je mijn mailtje gemist.',
              '',
              '________________________________',
              'Van: Martijn van de Ven',
              'Verzonden: dinsdag 16 juni 2026 14:31',
              'Aan: Ralph Ruyters',
              'Onderwerp: Re: Kleine vraag over jullie website',
              '',
              'Hoi Ralph,',
              'Dankjewel voor je reactie.',
            ].join('\n'),
          },
          {
            id: 'sent:111',
            folder: 'sent',
            accountEmail: 'martijn@softora.nl',
            date: '2026-06-16T12:31:32.000Z',
            body: [
              'Hoi Ralph,',
              '',
              'Dankjewel voor je reactie! Dat klinkt goed 😁',
              '',
              '________________________________',
              'Van: Ralph Ruyters',
              'Verzonden: maandag 15 juni 2026 15:58',
              'Aan: martijn@softora.nl',
              'Onderwerp: Re: Kleine vraag over jullie website',
              '',
              'Hi Martijn,',
              'Ik heb via Claude Design zelf mijn website vernieuwd.',
            ].join('\n'),
          },
        ],
      },
    }
  );

  const sentSections = Array.from(html.matchAll(
    /<section class="detail-mail-section detail-mail-section-sent">([\s\S]*?)<\/section>/g
  )).map((match) => match[1]);
  assert.equal(sentSections.length, 2);
  assert.match(sentSections[0], /Misschien heb je mijn mailtje gemist\./);
  assert.match(sentSections[1], /Dankjewel voor je reactie! Dat klinkt goed/);
  sentSections.forEach((section) => {
    assert.doesNotMatch(section, /Van: Ralph Ruyters|Verzonden:|Claude Design/);
  });
  assert.ok(html.indexOf('Misschien heb je mijn mailtje gemist.') < html.indexOf('Dankjewel voor je reactie!'));
  assert.ok(html.indexOf('Dankjewel voor je reactie!') < html.indexOf('Hi Martijn,'));
  assert.ok(html.indexOf('Nieuw bericht sturen') < html.indexOf('Misschien heb je mijn mailtje gemist.'));
  assert.doesNotMatch(html, /Beantwoorden/);
});

test('mailbox toont een gestructureerd antwoord niet nogmaals als Gmail-citaat', () => {
  const html = renderMailboxBodyForTest(
    [
      'Hoi Martijn,',
      '',
      'Wij werken met Bricks en zijn daar tevreden over.',
      '',
      'Op do 23 jul 2026 om 11:08 schreef Martijn van de Ven:',
      '> Hoi Helma,',
      '>',
      '> Dankjewel voor je antwoord.',
      '> Wij bouwen onze websites met maatwerk.',
      '>',
      '> Op wo 22 jul 2026 om 17:36 schreef Helma Schellen:',
      '>> Mag ik vragen waar jij je sites mee bouwt?',
    ].join('\n'),
    [],
    {
      replyMailId: 'inbox:37476',
      mail: {
        accountEmail: 'martijnven123@gmail.com',
        receivedAt: '2026-07-23T09:31:00.000Z',
        threadMessages: [
          {
            id: 'sent:37475',
            folder: 'sent',
            accountEmail: 'martijnven123@gmail.com',
            date: '2026-07-23T09:08:00.000Z',
            body: [
              'Hoi Helma,',
              '',
              'Dankjewel voor je antwoord.',
              'Wij bouwen onze websites met maatwerk.',
              '',
              'Op wo 22 jul 2026 om 17:36 schreef Helma Schellen:',
              '> Mag ik vragen waar jij je sites mee bouwt?',
            ].join('\n'),
          },
          {
            id: 'inbox:37467',
            folder: 'inbox',
            accountEmail: 'martijnven123@gmail.com',
            date: '2026-07-22T15:36:03.000Z',
            body: 'Mag ik vragen waar jij je sites mee bouwt?',
          },
        ],
      },
    }
  );

  assert.match(html, /Wij werken met Bricks en zijn daar tevreden over\./);
  assert.match(html, /Jouw bericht/);
  assert.equal((html.match(/Wij bouwen onze websites met maatwerk\./g) || []).length, 1);
  assert.doesNotMatch(html, /Jouw eerdere mail/);
  assert.doesNotMatch(html, /detail-mail-section-quote/);
  assert.match(html, /Eerder ontvangen/);
});

test('mailbox herkent Gmail-citaten met een auteursnaam na schreef als dezelfde conversatie', () => {
  const sentBody = [
    'Hoi Helma,',
    '',
    'Dankjewel voor je reactie, en leuk om te horen dat je het design mooi vindt!',
    'Wij bouwen onze websites volledig met code.',
    '',
    'Met vriendelijke groet,',
    'Martijn van de Ven',
    '',
    'Op wo 22 jul 2026 om 17:36 schreef Seats 2 Meet Station Den Bosch :',
    '> Hoi Martijn',
    '>',
    '> Mag ik vragen waar jij het liefst je sites mee bouwt?',
  ].join('\n');
  const html = renderMailboxBodyForTest(
    [
      'hoi Martijn',
      '',
      'Dank je wel voor het aanbod, maar we hebben al een team van experts.',
      '',
      'Op do 23 jul 2026 om 11:08 schreef Martijn Van De Ven :',
      '> Hoi Helma,',
      '>',
      '> Dankjewel voor je reactie, en leuk om te horen dat je het design mooi vindt!',
      '> Wij bouwen onze websites volledig met code.',
      '>',
      '> Met vriendelijke groet,',
      '> Martijn van de Ven',
      '>',
      '> Op wo 22 jul 2026 om 17:36 schreef Seats 2 Meet Station Den Bosch info@seats2meetstationdenbosch.nl>:',
      '>> Hoi Martijn',
      '>>',
      '>> Mag ik vragen waar jij het liefst je sites mee bouwt?',
    ].join('\n'),
    [],
    {
      replyMailId: 'inbox:37476',
      mail: {
        accountEmail: 'martijnven123@gmail.com',
        receivedAt: '2026-07-23T09:31:11.000Z',
        threadMessages: [
          {
            id: 'sent:656',
            folder: 'sent',
            accountEmail: 'martijnven123@gmail.com',
            date: '2026-07-23T09:08:10.000Z',
            body: sentBody,
          },
          {
            id: 'inbox:37467',
            folder: 'inbox',
            accountEmail: 'martijnven123@gmail.com',
            date: '2026-07-22T15:36:03.000Z',
            body: 'Hoi Martijn\n\nMag ik vragen waar jij het liefst je sites mee bouwt?',
          },
        ],
      },
    }
  );

  assert.match(html, /Dank je wel voor het aanbod, maar we hebben al een team van experts\./);
  assert.equal((html.match(/Wij bouwen onze websites volledig met code\./g) || []).length, 1);
  assert.equal((html.match(/Mag ik vragen waar jij het liefst je sites mee bouwt\?/g) || []).length, 1);
  assert.doesNotMatch(html, /Jouw eerdere mail/);
  assert.doesNotMatch(html, /Op do 23 jul 2026 om 11:08 schreef Martijn Van De Ven/);
});

test('mailbox toont een Gmail-citaat zonder afsluitende dubbele punt niet naast hetzelfde bewezen uitgaande bericht', () => {
  const sentBody = [
    'Goedemiddag,',
    '',
    'Dankjewel voor je reactie! Wij werken niet met een standaard programma zoals Webflow, maar bouwen websites met code op maat 😁',
    '',
    'Daardoor zijn we niet gebonden aan vaste templates en is er eigenlijk ontzettend veel mogelijk.',
    '',
    'Hoe bevalt Webflow je op dit moment? Zijn er dingen waar je tegenaan loopt of die je graag anders zou willen?',
    '',
    'Met vriendelijke groet,',
    '',
    'Servé Creusen',
  ].join('\n');
  const html = renderMailboxBodyForTest(
    [
      'En dan blijf ik gewoon met Webflow werken?',
      '',
      'Met vriendelijke groet,',
      'Salon TOF',
      '',
      'Op za 1 aug 2026 om 11:42 schreef Servé Creusen',
      ...sentBody.split('\n').map((line) => `> ${line}`),
    ].join('\n'),
    [],
    {
      replyMailId: 'inbox:salon-tof',
      mail: {
        accountEmail: 'serve290@gmail.com',
        receivedAt: '2026-08-03T10:35:00.000Z',
        threadMessages: [{
          id: 'sent:salon-tof',
          folder: 'sent',
          accountEmail: 'serve290@gmail.com',
          date: '2026-08-01T09:42:00.000Z',
          body: sentBody,
        }],
      },
    }
  );

  assert.match(html, /En dan blijf ik gewoon met Webflow werken\?/);
  assert.match(html, /Jouw bericht/);
  assert.equal((html.match(/Dankjewel voor je reactie!/g) || []).length, 1);
  assert.doesNotMatch(html, /Op za 1 aug 2026 om 11:42 schreef Servé Creusen/);
  assert.doesNotMatch(html, /Ingesloten berichtgeschiedenis|detail-mail-section-history/);
});

test('mailbox toont Neelis zonder emoji-variantquote en zonder WhatsApp-autoreply', () => {
  const sentBody = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website neelisstikwerken.com tegen.',
    '',
    'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind. Je vindt het ontwerp in de bijlage bij deze e-mail.',
    '',
    'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening',
    '',
    'Ik kan ook de online preview doorsturen, zodat je zelf door het ontwerp kunt scrollen.',
    '',
    'Mocht je er niets mee willen doen, dan is dat natuurlijk ook prima! Wel lijkt het me tof om te horen wat je van het design vindt en wat er eventueel beter kan. Daar leer ik dan weer van!',
    '',
    'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link bekijken',
    '',
    'Met vriendelijke groet,',
    'Martijn van de Ven',
    '',
    'Tilburg',
  ].join('\n');
  const quotedSentBody = sentBody
    .replace('eerlijke mening', 'eerlijke mening 😁')
    .replace('link bekijken', 'link bekijken 🎨')
    .replace('\nTilburg', '\n📍 Tilburg');
  const replyBody = [
    'Helaas met website is prima zo',
    '',
    'Op di 28 jul 2026 om 08:28 schreef Martijn van de Ven <martijnven@websoftora.com>',
    '',
    quotedSentBody,
  ].join('\n');
  const html = renderMailboxBodyForTest(replyBody, [], {
    replyMailId: 'instantly:neelis-human-reply',
    mail: {
      id: 'instantly:neelis-human-reply',
      folder: 'instantly',
      direction: 'received',
      provider: 'instantly',
      providerOwner: 'martijn',
      accountEmail: 'martijnven@websoftora.com',
      receivedAt: '2026-07-28T13:56:13.000Z',
      threadMessages: [{
        id: 'instantly:neelis-whatsapp-auto',
        folder: 'instantly',
        direction: 'received',
        provider: 'instantly',
        providerOwner: 'martijn',
        accountEmail: 'martijnven@websoftora.com',
        subject: 'Whatsapp Re: Kleine vraag over jullie website',
        date: '2026-07-28T06:28:31.000Z',
        body: 'Welkom bij Neelis Stikwerken. Als u een foto met de globale maten naar whatsapp stuurt, dan krijgt u van mij zo snel mogelijk een richtprijs.',
      }, {
        id: 'instantly:neelis-sent',
        folder: 'sent',
        direction: 'sent',
        provider: 'instantly',
        providerOwner: 'martijn',
        accountEmail: 'martijnven@websoftora.com',
        date: '2026-07-28T06:28:27.000Z',
        body: sentBody,
      }],
    },
  });

  assert.match(html, /Helaas met website is prima zo/);
  assert.equal((html.match(/Afgelopen week kwam ik jullie website neelisstikwerken\.com tegen\./g) || []).length, 1);
  assert.equal((html.match(/>Jouw bericht</g) || []).length, 1);
  assert.doesNotMatch(html, /Op di 28 jul 2026 om 08:28 schreef Martijn/);
  assert.doesNotMatch(html, /Welkom bij Neelis Stikwerken|Eerder ontvangen/);
  assert.doesNotMatch(html, /detail-mail-section-history/);
});

test('mailbox toont een gestructureerd antwoord niet nogmaals na Outlook-headervelden', () => {
  const sentBody = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website censorbestuur.nl tegen.',
    'Uit enthousiasme heb ik een fris webdesign gemaakt.',
    '',
    'Met vriendelijke groet,',
    'Martijn van de Ven',
  ].join('\n');
  const html = renderMailboxBodyForTest(
    [
      'Jammer, Martijn, we hebben net een nieuwe website.',
      '',
      'Van: Martijn van de Ven',
      'Datum: vrijdag, 17 juli 2026 om 09:54',
      'Aan: Censor Bestuur',
      'Onderwerp: Kleine vraag over jullie website',
      '',
      sentBody,
    ].join('\n'),
    [],
    {
      replyMailId: 'inbox:400',
      mail: {
        accountEmail: 'martijnvandeven@softora.nl',
        receivedAt: '2026-07-23T11:54:00.000Z',
        threadMessages: [
          {
            id: 'sent:399',
            folder: 'sent',
            accountEmail: 'martijnvandeven@softora.nl',
            date: '2026-07-17T07:54:00.000Z',
            body: sentBody,
          },
        ],
      },
    }
  );

  assert.match(html, /Jammer, Martijn, we hebben net een nieuwe website\./);
  assert.match(html, /Jouw bericht/);
  assert.equal((html.match(/Afgelopen week kwam ik jullie website censorbestuur\.nl tegen\./g) || []).length, 1);
  assert.doesNotMatch(html, /Jouw eerdere mail/);
  assert.doesNotMatch(html, /detail-mail-section-quote/);
});

test('grijze threadkaart verbergt alleen exact bewezen geciteerd Martijn-bericht', () => {
  const sentBody = [
    'Goedemiddag,',
    '',
    'Ik heb een fris webdesign voor je gemaakt.',
    '',
    'Met vriendelijke groet,',
    'Martijn van de Ven',
  ].join('\n');
  const incomingBody = [
    'Hoi Martijn,',
    '',
    'Dank voor je bericht. Ik bespreek het intern.',
    '',
    'Op 3 aug 2026 om 14:10 schreef Martijn van de Ven:',
    ...sentBody.split('\n').map((line) => `> ${line}`),
  ].join('\n');
  const html = renderMailboxBodyForTest('De nieuwste hoofdmail.', [], {
    mail: {
      id: 'inbox:quote-root',
      folder: 'inbox',
      accountEmail: 'martijnvandeven@softora.nl',
      receivedAt: '2026-08-03T13:00:00.000Z',
      threadMessages: [{
        id: 'inbox:quoted-reply',
        folder: 'inbox',
        accountEmail: 'martijnvandeven@softora.nl',
        date: '2026-08-03T12:15:00.000Z',
        body: incomingBody,
      }, {
        id: 'sent:proven-parent',
        folder: 'sent',
        accountEmail: 'martijnvandeven@softora.nl',
        date: '2026-08-03T12:10:00.000Z',
        messageId: '<proven-parent@softora.nl>',
        body: sentBody,
      }],
    },
  });

  assert.match(html, /Dank voor je bericht\. Ik bespreek het intern\./);
  assert.equal((html.match(/Ik heb een fris webdesign voor je gemaakt\./g) || []).length, 1);
  assert.doesNotMatch(html, /Op 3 aug 2026 om 14:10 schreef Martijn van de Ven/);
  assert.match(html, /Jouw bericht/);
});

test('grijze threadkaart verbergt een duidelijke quote-tail zonder bewezen parent en bewaart canonieke doorgestuurde inhoud', () => {
  const sentBody = 'Hoi,\n\nDit is de echte bewezen uitgaande tekst.';
  const unmatchedIncoming = [
    'Mijn nieuwe antwoord.',
    '',
    'On 3 Aug 2026, Martijn van de Ven wrote:',
    '> Dit is andere tekst die niet als outbound is bewezen.',
  ].join('\n');
  const unmatchedHtml = renderMailboxBodyForTest('Hoofdmail.', [], {
    mail: {
      folder: 'inbox',
      accountEmail: 'martijn@softora.nl',
      receivedAt: '2026-08-03T13:00:00.000Z',
      threadMessages: [{
        id: 'inbox:unmatched', folder: 'inbox', accountEmail: 'martijn@softora.nl',
        date: '2026-08-03T12:30:00.000Z', body: unmatchedIncoming,
      }, {
        id: 'sent:other', folder: 'sent', accountEmail: 'martijn@softora.nl',
        date: '2026-08-03T12:00:00.000Z', body: sentBody,
      }],
    },
  });
  assert.match(unmatchedHtml, /Mijn nieuwe antwoord\./);
  assert.doesNotMatch(unmatchedHtml, /Dit is andere tekst die niet als outbound is bewezen\.|Martijn van de Ven wrote/);

  const forwardedHtml = renderMailboxBodyForTest([
    'Hierbij stuur ik de mail door.',
    '',
    'On 3 Aug 2026, Martijn van de Ven wrote:',
    `> ${sentBody.replace(/\n/g, '\n> ')}`,
  ].join('\n'), [], {
    mail: {
      folder: 'inbox',
      subject: 'Fwd: Belangrijke doorgestuurde mail',
      accountEmail: 'martijn@softora.nl',
      threadMessages: [{
        id: 'sent:forwarded-match', folder: 'sent', accountEmail: 'martijn@softora.nl', body: sentBody,
      }],
    },
  });
  assert.match(forwardedHtml, /Dit is de echte bewezen uitgaande tekst\./);
  assert.equal((forwardedHtml.match(/Dit is de echte bewezen uitgaande tekst\./g) || []).length, 1);
  assert.doesNotMatch(forwardedHtml, /Ingesloten berichtgeschiedenis/);
});

test('mailbox stript Jolandas geneste markdown-Outlookcitaat via exact In-Reply-To uit grijs', () => {
  const originalBody = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website bogaerstalen.nl tegen.',
    '',
    'Met vriendelijke groet,',
    'Martijn van de Ven',
  ].join('\n');
  const sentAuthoredBody = [
    'Beste Jolanda,',
    '',
    'Dankjewel voor je reactie. Hieronder staat de juiste uitleg over het ontwerp.',
    '',
    'Met vriendelijke groet,',
    'Martijn van de Ven',
  ].join('\n');
  const sentBody = [
    sentAuthoredBody,
    '',
    'Op 17 juni 2026 schreef Jolanda:',
    '> Dank je wel voor je bericht en je interesse.',
    '>',
    '> Op 17 juni 2026 schreef Martijn:',
    ...originalBody.split('\n').map((line) => `> > ${line}`),
  ].join('\n');
  const incomingBody = [
    'https://benbacacia.nl/ excuses!',
    '',
    '*Van:* Martijn Van De Ven',
    '*Verzonden:* vrijdag 19 juni 2026 09:44',
    '*Aan:* jolanda.meijden@bogaerstalen.nl',
    '*Onderwerp:* Re: Kleine vraag over jullie website',
    '',
    sentBody,
  ].join('\r\n');
  const html = renderMailboxBodyForTest(incomingBody, [], {
    replyMailId: 'inbox:jolanda',
    mail: {
      id: 'inbox:jolanda',
      folder: 'inbox',
      accountEmail: 'martijnven123@gmail.com',
      receivedAt: '2026-06-26T12:39:36.000Z',
      inReplyTo: '<jolanda-direct-parent@gmail.com>',
      threadMessages: [{
        id: 'sent:jolanda-parent',
        folder: 'sent',
        accountEmail: 'martijnven123@gmail.com',
        messageId: '<jolanda-direct-parent@gmail.com>',
        date: '2026-06-19T07:44:00.000Z',
        body: sentBody,
      }, {
        id: 'sent:jolanda-ancestor',
        folder: 'sent',
        accountEmail: 'martijnven123@gmail.com',
        messageId: '<jolanda-ancestor@gmail.com>',
        date: '2026-06-17T08:02:00.000Z',
        body: originalBody,
      }],
    },
  });

  assert.match(html, /https:\/\/benbacacia\.nl\//);
  assert.match(html, /excuses!/);
  assert.doesNotMatch(html, /\*Van:\*|Verzonden: vrijdag 19 juni/);
  assert.equal((html.match(/Dankjewel voor je reactie\. Hieronder staat de juiste uitleg/g) || []).length, 1);
  assert.equal((html.match(/Afgelopen week kwam ik jullie website bogaerstalen\.nl tegen\./g) || []).length, 1);
  assert.match(html, /Jouw bericht/);
});

test('geneste bewezen quote blijft fail-closed zonder unieke directe Message-ID-parent', () => {
  const ancestorBody = 'Afgelopen week kwam ik jullie website bogaerstalen.nl tegen met een volledig eigen ontwerp.';
  const parentBody = [
    'Goedemorgen Jolanda,',
    'Hierbij de preview en mijn toelichting op het ontwerp.',
    '',
    'Op 17 juni 2026 schreef Martijn:',
    `> ${ancestorBody}`,
  ].join('\n');
  const incomingBody = [
    'https://benbacacia.nl/ excuses!',
    '',
    '*Van:* Martijn Van De Ven',
    '*Verzonden:* vrijdag 19 juni 2026 09:44',
    '*Aan:* jolanda.meijden@bogaerstalen.nl',
    '*Onderwerp:* Re: Kleine vraag over jullie website',
    '',
    parentBody,
  ].join('\n');
  const candidates = [{
    id: 'sent:parent',
    messageId: '<parent@example.com>',
    accountEmail: 'martijnven123@gmail.com',
    body: parentBody,
  }, {
    id: 'sent:ancestor',
    messageId: '<ancestor@example.com>',
    accountEmail: 'martijnven123@gmail.com',
    body: ancestorBody,
  }];

  const ambiguous = quotedThreadModule.stripProvenQuotedOutbound(incomingBody, candidates);
  assert.equal(ambiguous.body, incomingBody);
  assert.deepEqual(ambiguous.removed, []);

  const proven = quotedThreadModule.stripProvenQuotedOutbound(incomingBody, candidates, {
    directParentMessageIds: ['<parent@example.com>'],
  });
  assert.equal(proven.body, 'https://benbacacia.nl/ excuses!');
  assert.deepEqual(proven.matchedMessages.map((message) => message.id), ['sent:parent']);
});

test('emoji-normalisatie verwijdert nooit een quote bij twee inhoudelijk gelijke outbound-kandidaten', () => {
  const baseBody = 'Dit is een voldoende lange campagneboodschap met dezelfde bewezen tekst voor één ontvanger, maar zonder unieke parentidentiteit.';
  const incomingBody = [
    'Dit is mijn menselijke antwoord.',
    '',
    'Op 28 juli 2026 schreef Martijn van de Ven:',
    `${baseBody} 😁`,
  ].join('\n');
  const result = quotedThreadModule.stripProvenQuotedOutbound(incomingBody, [{
    id: 'sent:emoji-a',
    accountEmail: 'martijnven@websoftora.com',
    body: `${baseBody} 🎨`,
  }, {
    id: 'sent:emoji-b',
    accountEmail: 'martijnven@websoftora.com',
    body: `${baseBody} 📍`,
  }]);

  assert.equal(result.body, incomingBody);
  assert.deepEqual(result.removed, []);
});

test('mailbox bewaart Moniques eigen tekst en zet telefoon uit de suffix in een contactkaart', () => {
  const sentBody = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website dierenkliniektspoor.nl tegen.',
    'Uit enthousiasme heb ik een fris webdesign gemaakt.',
    '',
    'Met vriendelijke groet,',
    'Martijn van de Ven',
  ].join('\n');
  const incomingBody = [
    'Beste Martijn,',
    '',
    'Bedankt voor je enthousiasme,',
    'Maar ik houd het graag bij mijn eigen ontwerp!',
    '',
    'Hartelijke Groeten Monique',
    '',
    'Op di 4 aug 2026 om 16:37 schreef Martijn van de Ven :',
    ...sentBody.split('\n').map((line) => `> ${line}`),
    '',
    '--',
    'Dierenkliniek ’t Spoor',
    'T 073 123 45 67',
  ].join('\n');
  const html = renderMailboxBodyForTest(incomingBody, [], {
    replyMailId: 'inbox:dierenkliniek',
    mail: {
      id: 'inbox:dierenkliniek',
      folder: 'inbox',
      from: 'Dierenkliniek ’t Spoor',
      email: 'info@dierenkliniektspoor.nl',
      accountEmail: 'contact.venvisuals@gmail.com',
      receivedAt: '2026-08-04T15:17:03.000Z',
      threadMessages: [{
        id: 'sent:dierenkliniek',
        folder: 'sent',
        accountEmail: 'contact.venvisuals@gmail.com',
        messageId: '<dierenkliniek-sent@gmail.com>',
        date: '2026-08-04T14:37:24.000Z',
        body: sentBody,
      }],
    },
  });

  assert.match(html, /Maar ik houd het graag bij mijn eigen ontwerp!/);
  assert.match(html, /Hartelijke Groeten Monique/);
  assert.doesNotMatch(html, /Dierenkliniek ’t Spoor|T 073 123 45 67/);
  assert.match(html, /detail-mail-contact-card/);
  assert.match(html, /href="tel:0731234567"/);
  assert.doesNotMatch(html, /Op di 4 aug 2026 om 16:37 schreef/);
  assert.equal((html.match(/Afgelopen week kwam ik jullie website dierenkliniektspoor\.nl tegen\./g) || []).length, 1);
});

test('mailbox rendert Lia haar antwoord en contactgegevens correct met en zonder bewezen Sent-parent', () => {
  const sentBody = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website stroomvantaal-popup.nl tegen.',
    'Uit enthousiasme heb ik een fris webdesign gemaakt.',
    '',
    'Met vriendelijke groet,',
    'Martijn van de Ven',
  ].join('\n');
  const incomingBody = [
    'Dag Martijn,',
    '',
    'dank voor je mail, ik reageer later!',
    '',
    'groet,',
    'Lia',
    '',
    'Op di 25 aug 2026 om 12:59 schreef Martijn van de Ven :',
    ...sentBody.split('\n').map((line) => `> ${line}`),
    '',
    '--',
    '---',
    '*LIA HESEMANS redactie & training*',
    'eindredactie | auteursbegeleiding | schrijftraining',
    'Haarensteijnstraat 23 | 5076 CM Haaren',
    'M 06 33688506',
    'I [www.stroomvantaal-popup.nl](http://www.stroomvantaal-popup.nl)',
  ].join('\n');
  const provenSent = {
    id: 'sent:285',
    folder: 'sent',
    accountEmail: 'martijn@softora.nl',
    messageId: '<lia-parent@softora.nl>',
    date: '2026-08-25T10:59:00.000Z',
    body: sentBody,
  };

  for (const [label, threadMessages, expectedColdmailOccurrences] of [
    ['zonder Sent-parent', [], 0],
    ['met Sent-parent', [provenSent], 1],
  ]) {
    const html = renderMailboxBodyForTest(incomingBody, [], {
      replyMailId: 'inbox:162',
      mail: {
        id: 'inbox:162',
        folder: 'inbox',
        from: 'Lia Hesemans',
        email: 'lia@example.nl',
        accountEmail: 'martijn@softora.nl',
        receivedAt: '2026-08-25T11:10:00.000Z',
        inReplyTo: '<lia-parent@softora.nl>',
        body: incomingBody,
        threadMessages,
      },
    });

    assert.match(html, /Dag Martijn,/, label);
    assert.match(html, /dank voor je mail, ik reageer later!/, label);
    assert.match(html, /groet,<\/div>\s*<div class="detail-mail-line">Lia<\/div>/, label);
    assert.doesNotMatch(html, /Op di 25 aug 2026 om 12:59 schreef/, label);
    assert.doesNotMatch(html, /detail-mail-section-quote/, label);
    assert.equal(
      (html.match(/Afgelopen week kwam ik jullie website stroomvantaal-popup\.nl tegen\./g) || []).length,
      expectedColdmailOccurrences,
      label
    );
    assert.doesNotMatch(html, /LIA HESEMANS|eindredactie|auteursbegeleiding|schrijftraining|www\.stroomvantaal-popup\.nl/, label);
    assert.equal((html.match(/<dt>Telefoon:<\/dt>/g) || []).length, 1, label);
    assert.equal((html.match(/<dt>Adres:<\/dt>/g) || []).length, 1, label);
    assert.match(html, /class="detail-mail-contact-card"/, label);
    assert.match(html, /class="detail-mail-contact-grid"/, label);
    assert.match(html, /class="detail-mail-contact-item"/, label);
    assert.match(html, /href="tel:0633688506">06 33688506<\/a>/, label);
    assert.match(html, /Haarensteijnstraat 23, 5076 CM Haaren/, label);
  }
});

test('mailbox bewaart Lia haar persoonlijke afsluiting en onbewezen post-quote footer atomair', () => {
  const incomingBody = [
    'Dag Martijn,',
    '',
    'dank voor je mail, ik reageer later!',
    '',
    'groet,',
    'Lia',
    '',
    'Op di 25 aug 2026 om 12:59 schreef Martijn van de Ven:',
    '> Dit is een voldoende duidelijke geciteerde coldmailregel.',
    '',
    '--',
    'LIA HESEMANS redactie & training',
    'Haarensteijnstraat 23 | 5076 CM Haaren',
    'M 06 33688506',
  ].join('\n');

  for (const [label, senderContext] of [
    ['lege context', {}],
    ['alleen e-mail zonder footermatch', { email: 'lia@example.nl' }],
    ['enkelvoudige afzendernaam', { fromName: 'Lia' }],
  ]) {
    const presentation = campaignInboxModule.getSourceSafeMessagePresentation(
      senderContext,
      senderContext,
      incomingBody
    );

    assert.equal(presentation.signatureMatched, false, label);
    assert.equal(presentation.body, incomingBody, label);
    assert.deepEqual(presentation.contact, { phone: '', phoneHref: '', addressLines: [] }, label);
    assert.match(presentation.body, /groet,\nLia/, label);
    assert.match(presentation.body, /--\nLIA HESEMANS[\s\S]*M 06 33688506/, label);
  }
});

test('mailbox vindt een sterke post-quote footer vóór een latere From-regel die op een quoteheader lijkt', () => {
  const incomingBody = [
    'Dag Martijn,',
    '',
    'dank voor je mail, ik reageer later!',
    '',
    'groet,',
    'Lia',
    '',
    'Op di 25 aug 2026 om 12:59 schreef Martijn van de Ven:',
    '> Dit is een voldoende duidelijke geciteerde coldmailregel.',
    '',
    '--',
    'LIA HESEMANS redactie & training',
    'From: lia@example.nl',
    'Haarensteijnstraat 23 | 5076 CM Haaren',
    'M 06 33688506',
  ].join('\n');
  const html = renderMailboxBodyForTest(incomingBody, [], {
    replyMailId: 'inbox:lia-from-footer',
    mail: {
      id: 'inbox:lia-from-footer',
      folder: 'inbox',
      from: 'Lia Hesemans',
      email: 'lia@example.nl',
      accountEmail: 'martijn@softora.nl',
      receivedAt: '2026-08-25T11:10:00.000Z',
      body: incomingBody,
      threadMessages: [],
    },
  });

  assert.match(html, /groet,<\/div>\s*<div class="detail-mail-line">Lia<\/div>/);
  assert.doesNotMatch(html, /lia@example\.nl|LIA HESEMANS/);
  assert.equal((html.match(/<dt>Telefoon:<\/dt>/g) || []).length, 1);
  assert.equal((html.match(/<dt>Adres:<\/dt>/g) || []).length, 1);
  assert.match(html, /href="tel:0633688506">06 33688506<\/a>/);
  assert.match(html, /Haarensteijnstraat 23, 5076 CM Haaren/);
});

test('mailbox maakt van een gedeeltelijk geprefixte quote zonder -- geen contactkaart', () => {
  const incomingBody = [
    'Dit is mijn eigen antwoord.',
    '',
    'Op di 25 aug 2026 om 12:59 schreef Martijn van de Ven:',
    '> Dit is de eerste regel van het geciteerde bericht.',
    'Met vriendelijke groet,',
    'M. de Vries',
    'M 06 12345678',
  ].join('\n');
  const html = renderMailboxBodyForTest(incomingBody, [], {
    replyMailId: 'inbox:mixed-quote-signoff',
    mail: {
      id: 'inbox:mixed-quote-signoff',
      folder: 'inbox',
      accountEmail: 'martijn@softora.nl',
      receivedAt: '2026-08-25T11:10:00.000Z',
      body: incomingBody,
      threadMessages: [],
    },
  });

  assert.match(html, /Dit is mijn eigen antwoord\./);
  assert.doesNotMatch(html, /detail-mail-contact-card|<dt>Telefoon:<\/dt>|href="tel:0612345678"/);
});

test('mailbox schrijft na bewezen quoteverwijdering een oude Martijn-footer nooit aan Anna toe', () => {
  const sentBody = 'Dit is een voldoende lange bewezen uitgaande mail van Martijn met een concrete toelichting.';
  const incomingBody = [
    'Dank voor je bericht.',
    '',
    'Groet,',
    'Anna',
    '',
    'Op di 25 aug 2026 om 12:59 schreef Martijn van de Ven:',
    `> ${sentBody}`,
    '',
    '--',
    'Martijn van de Ven',
    'M 06 12345678',
  ].join('\n');
  const mail = {
    id: 'inbox:anna-old-martijn-footer',
    folder: 'inbox',
    direction: 'received',
    from: 'Anna Jansen',
    email: 'anna@example.nl',
    accountEmail: 'martijn@softora.nl',
    receivedAt: '2026-08-25T11:10:00.000Z',
    inReplyTo: '<anna-parent@softora.nl>',
    body: incomingBody,
    threadMessages: [{
      id: 'sent:anna-parent',
      folder: 'sent',
      direction: 'sent',
      accountEmail: 'martijn@softora.nl',
      messageId: '<anna-parent@softora.nl>',
      date: '2026-08-25T10:59:00.000Z',
      body: sentBody,
    }],
  };
  const presentation = campaignInboxModule.getSourceSafeMessagePresentation(mail, mail);
  const html = renderMailboxBodyForTest(incomingBody, [], {
    replyMailId: mail.id,
    mail,
  });

  assert.deepEqual(presentation.contact, { phone: '', phoneHref: '', addressLines: [] });
  assert.doesNotMatch(html, /detail-mail-contact-card|<dt>Telefoon:<\/dt>|href="tel:0612345678"/);
  assert.match(html, /Dank voor je bericht\./);
});

test('mailbox verwijdert JT inline Gmail-citaat uit grijs en toont de bewezen Servé-mail eenmaal roze', () => {
  const sentBody = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website jt-voorbeeld.nl tegen.',
    'Vanuit enthousiasme heb ik een fris webdesign gemaakt.',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
  ].join('\n');
  const incomingBody = [
    'Dank voor je bericht, maar we hebben op dit moment geen interesse.',
    '',
    'Op 19-08-2026 12:59 schreef Servé Creusen: Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website jt-voorbeeld.nl tegen.',
    'Vanuit enthousiasme heb ik een fris webdesign gemaakt.',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
  ].join('\n');
  const html = renderMailboxBodyForTest(incomingBody, [], {
    replyMailId: 'inbox:jt-inline',
    mail: {
      id: 'inbox:jt-inline',
      folder: 'inbox',
      accountEmail: 'serve@softora.nl',
      receivedAt: '2026-08-19T11:03:00.000Z',
      inReplyTo: '<jt-parent@softora.nl>',
      threadMessages: [{
        id: 'sent:jt-parent',
        folder: 'sent',
        accountEmail: 'serve@softora.nl',
        messageId: '<jt-parent@softora.nl>',
        date: '2026-08-19T10:59:00.000Z',
        body: sentBody,
        originalCampaignOutbound: true,
      }],
    },
  });

  assert.match(html, /Dank voor je bericht, maar we hebben op dit moment geen interesse\./);
  assert.doesNotMatch(html, /Op 19-08-2026 12:59 schreef Servé Creusen/);
  assert.equal((html.match(/Afgelopen week kwam ik jullie website jt-voorbeeld\.nl tegen\./g) || []).length, 1);
  assert.match(html, /detail-mail-section-sent/);
  assert.match(html, /Jouw bericht/);

  const noParentHtml = renderMailboxBodyForTest(incomingBody, [], {
    replyMailId: 'inbox:jt-inline-without-parent',
    mail: {
      id: 'inbox:jt-inline-without-parent',
      folder: 'inbox',
      accountEmail: 'serve@softora.nl',
      receivedAt: '2026-08-19T11:03:00.000Z',
      threadMessages: [],
    },
  });
  assert.match(noParentHtml, /Dank voor je bericht, maar we hebben op dit moment geen interesse\./);
  assert.doesNotMatch(noParentHtml, /Op 19-08-2026|jt-voorbeeld\.nl/);
});

test('quoteparent mag een ander alias van dezelfde eigenaar gebruiken maar kruist Servé en Martijn nooit', () => {
  const sentBody = [
    'Goedendag,',
    '',
    'Dit is een lang genoeg exact campagnebericht voor dezelfde eigenaar en een ander afzenderalias.',
  ].join('\n');
  const incomingBody = [
    'Dit is de menselijke reactie.',
    '',
    'Op 19 aug 2026 om 12:59 schreef Servé Creusen <serve290@gmail.com>:',
    ...sentBody.split('\n').map((line) => `> ${line}`),
  ].join('\n');
  const baseMail = {
    id: 'inbox:same-owner-alias',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    receivedAt: '2026-08-19T11:03:00.000Z',
  };
  const serveAlias = {
    id: 'sent:serve-alias',
    folder: 'sent',
    accountEmail: 'serve290@gmail.com',
    date: '2026-08-19T10:59:00.000Z',
    body: sentBody,
  };

  assert.equal(
    campaignInboxModule.stripProvenQuotedOutbound(incomingBody, {
      ...baseMail,
      threadMessages: [serveAlias],
    }),
    'Dit is de menselijke reactie.'
  );
  assert.equal(
    campaignInboxModule.stripProvenQuotedOutbound(incomingBody, {
      ...baseMail,
      threadMessages: [{
        ...serveAlias,
        id: 'sent:martijn-alias',
        accountEmail: 'martijnven123@gmail.com',
      }],
    }),
    incomingBody
  );
});

test('quoteparent moet ouder zijn dan de reactie en een gewone Van-zin blijft zichtbaar', () => {
  const sentBody = 'Dit is een lang genoeg identiek uitgaand bericht dat nooit vanuit de toekomst als parent mag worden gekozen.';
  const incomingBody = [
    'Dit is de menselijke reactie.',
    '',
    'Op 19 aug 2026 om 12:59 schreef Servé Creusen:',
    `> ${sentBody}`,
  ].join('\n');
  const future = quotedThreadModule.stripProvenQuotedOutbound(incomingBody, [{
    id: 'sent:future',
    folder: 'sent',
    accountEmail: 'serve@softora.nl',
    date: '2026-08-19T13:30:00.000Z',
    body: sentBody,
  }], {
    incomingAt: '2026-08-19T11:03:00.000Z',
  });
  const past = quotedThreadModule.stripProvenQuotedOutbound(incomingBody, [{
    id: 'sent:past',
    folder: 'sent',
    accountEmail: 'serve@softora.nl',
    date: '2026-08-19T10:59:00.000Z',
    body: sentBody,
  }], {
    incomingAt: '2026-08-19T11:03:00.000Z',
  });

  assert.equal(future.body, incomingBody);
  assert.deepEqual(future.matchedMessages, []);
  assert.equal(past.body, 'Dit is de menselijke reactie.');

  const legitimateBody = [
    'Mijn echte antwoord bevat onderstaande afspraak.',
    'Van: onze kant is dit akkoord.',
    'Daarmee kunnen jullie verder.',
  ].join('\n');
  const html = renderMailboxBodyForTest(legitimateBody, [], {
    replyMailId: 'inbox:legitimate-van',
    mail: {
      id: 'inbox:legitimate-van',
      folder: 'inbox',
      accountEmail: 'serve@softora.nl',
      receivedAt: '2026-08-19T11:03:00.000Z',
      threadMessages: [],
    },
  });
  assert.match(html, /Van: onze kant is dit akkoord\./);
  assert.match(html, /Daarmee kunnen jullie verder\./);
});

test('normale schreef-zinnen worden nooit citaatheaders en houden autoreplydetectie intact', () => {
  const dutchBody = [
    'Op basis hiervan schreef ik: de klant krijgt vandaag antwoord.',
    'Dit bericht is automatisch gegenereerd.',
  ].join('\n');
  const englishBody = [
    'On Tuesday we wrote: this internal note together.',
    'This is an automated message.',
  ].join('\n');

  assert.deepEqual(quotedThreadModule.findQuotedSegments(dutchBody).segments, []);
  assert.deepEqual(quotedThreadModule.findQuotedSegments(englishBody).segments, []);
  assert.equal(campaignInboxModule.stripQuotedReply(dutchBody), dutchBody);
  assert.equal(campaignInboxModule.stripQuotedReply(englishBody), englishBody);
  assert.equal(campaignInboxModule.isAutomatedCampaignReply({ body: dutchBody }), true);
  assert.equal(campaignInboxModule.isAutomatedCampaignReply({ body: englishBody }), true);

  const html = renderMailboxBodyForTest(dutchBody, [], {
    replyMailId: 'inbox:natural-wrote-sentence',
    mail: {
      id: 'inbox:natural-wrote-sentence',
      folder: 'inbox',
      accountEmail: 'serve@softora.nl',
      receivedAt: '2026-08-19T11:03:00.000Z',
      threadMessages: [],
    },
  });
  assert.match(html, /Op basis hiervan schreef ik: de klant krijgt vandaag antwoord\./);
  assert.match(html, /Dit bericht is automatisch gegenereerd\./);
});

test('kort bewezen citaat verdwijnt uit grijs en blijft exact eenmaal roze', () => {
  const sentBody = 'Kunnen we bellen?';
  const incomingBody = [
    'Ja, morgenmiddag past goed.',
    '',
    'Op 19 aug 2026 om 12:59 schreef Servé Creusen:',
    `> ${sentBody}`,
  ].join('\n');
  const html = renderMailboxBodyForTest(incomingBody, [], {
    replyMailId: 'inbox:short-proven-quote',
    mail: {
      id: 'inbox:short-proven-quote',
      folder: 'inbox',
      accountEmail: 'serve@softora.nl',
      receivedAt: '2026-08-19T11:03:00.000Z',
      threadMessages: [{
        id: 'sent:short-proven-quote',
        folder: 'sent',
        accountEmail: 'serve@softora.nl',
        date: '2026-08-19T10:59:00.000Z',
        body: sentBody,
        originalCampaignOutbound: true,
      }],
    },
  });

  assert.match(html, /Ja, morgenmiddag past goed\./);
  assert.doesNotMatch(html, /Op 19 aug 2026 om 12:59 schreef/);
  assert.equal((html.match(/Kunnen we bellen\?/g) || []).length, 1);
  assert.match(html, /detail-mail-section-sent/);
});

test('ongeldige receivedAt valt terug op internalDate en laat geen toekomstige quoteparent toe', () => {
  const sentBody = 'Dit is een lang genoeg bewezen uitgaand bericht dat nooit vanuit de volgende dag als quoteparent mag worden gekozen.';
  const incomingBody = [
    'Dit antwoord moet volledig zichtbaar blijven.',
    '',
    'Op 19 aug 2026 om 12:59 schreef Servé Creusen:',
    `> ${sentBody}`,
  ].join('\n');
  const mail = {
    id: 'inbox:invalid-received-at',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    receivedAt: 'geen-geldige-datum',
    internalDate: '2026-08-19T11:03:00.000Z',
    threadMessages: [{
      id: 'sent:future-invalid-received-at',
      folder: 'sent',
      accountEmail: 'serve@softora.nl',
      date: '2026-08-20T11:03:00.000Z',
      body: sentBody,
      originalCampaignOutbound: true,
    }],
  };

  assert.equal(campaignInboxModule.stripProvenQuotedOutbound(incomingBody, mail), incomingBody);
});

test('mailbox toont TTV Irene als nieuwe reactie zonder standaardhandtekening plus één bewezen roze coldmail', () => {
  const sentBody = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website ttvirene.nl tegen.',
    'Uit enthousiasme heb ik een fris webdesign gemaakt.',
    '',
    'Met vriendelijke groet,',
    'Martijn van de Ven',
  ].join('\n');
  const incomingBody = [
    'Beste Martijn,',
    '',
    'Bedankt voor je voorstel. Ik ontvang graag een offerte voor de nieuwe website.',
    '',
    'Met vriendelijke groet,',
    'Steven van den Brink',
    'Webmaster TTV Irene',
    '',
    'From: secretaris@ttvirene.nl',
    'Sent: donderdag 16 juli 2026 19:35',
    'To: webmaster@ttvirene.nl',
    'Subject: Fwd: Kleine vraag over jullie website',
    '',
    'Verstuurd vanaf mijn iPhone',
    'Begin doorgestuurd bericht:',
    'Van: Martijn van de Ven',
    'Datum: 16 juli 2026 om 11:56:48 CEST',
    'Aan: info@ttvirene.nl',
    'Onderwerp: Kleine vraag over jullie website',
    'Antwoord aan: martijn@softora.nl',
    '',
    sentBody,
  ].join('\n');
  const html = renderMailboxBodyForTest(incomingBody, [], {
    replyMailId: 'inbox:ttv-irene',
    mail: {
      id: 'inbox:ttv-irene',
      folder: 'inbox',
      accountEmail: 'martijn@softora.nl',
      receivedAt: '2026-07-16T18:12:01.000Z',
      threadMessages: [{
        id: 'sent:242',
        folder: 'sent',
        accountEmail: 'martijn@softora.nl',
        messageId: '<ttv-original@softora.nl>',
        originalCampaignOutbound: true,
        to: 'info@ttvirene.nl',
        date: '2026-07-16T09:56:41.000Z',
        body: sentBody,
      }],
    },
  });

  assert.match(html, /Ik ontvang graag een offerte voor de nieuwe website\./);
  assert.doesNotMatch(html, /Steven van den Brink|Webmaster TTV Irene/);
  assert.doesNotMatch(html, /From: secretaris@ttvirene\.nl|Begin doorgestuurd bericht/);
  assert.equal((html.match(/Afgelopen week kwam ik jullie website ttvirene\.nl tegen\./g) || []).length, 1);
  assert.match(html, /Jouw bericht/);
});

test('quotegrens blijft fail-closed wanneer geen unieke bewezen outbound bestaat', () => {
  const headerLikeBody = [
    'Mijn echte antwoord bevat onderstaande administratieve gegevens:',
    'Van: onze secretaris',
    'Verzonden: vandaag',
    'Aan: ons bestuur',
    'Onderwerp: interne notitie',
  ].join('\n');
  const duplicateOutbound = {
    folder: 'sent',
    accountEmail: 'martijn@softora.nl',
    body: 'Deze tekst is niet aanwezig in het ontvangen bericht en mag niets verwijderen.',
  };
  const result = quotedThreadModule.stripProvenQuotedOutbound(headerLikeBody, [
    { ...duplicateOutbound, id: 'sent:a' },
    { ...duplicateOutbound, id: 'sent:b' },
  ]);

  assert.equal(result.body, headerLikeBody);
  assert.deepEqual(result.removed, []);
  assert.match(result.body, /Van: onze secretaris/);
});

test('mailbox toont dezelfde coldmail met afbeeldingsplaceholders niet dubbel', () => {
  const quotedColdmail = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website nicolevintagefashion\u2060.\u2060com tegen.',
    '',
    'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
    '',
    'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening 😁',
    '',
    'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link',
    '[https://www.softora.nl/webdesign/nicole-vintage-fashion?sender=serve] bekijken 🎨',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
    '',
    'Hieronder zie je een korte indruk van de eerste versie op verschillende schermen.',
  ].join('\n');
  const sentColdmail = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website nicolevintagefashion.com tegen.',
    '',
    'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
    '',
    'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening 😁',
    '',
    'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link',
    'https://www.softora.nl/webdesign/nicole-vintage-fashion?sender=serve bekijken 🎨',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
    '',
    '[image: nicolevintagefashion.com-preview]',
    'Hieronder zie je een korte indruk van de eerste versie op verschillende schermen.',
    '[image: nicolevintagefashion.com-preview-device-mockup-v8]',
  ].join('\n');
  const html = renderMailboxBodyForTest(
    [
      'Bedankt voor je bericht, maar we hebben geen interesse.',
      '',
      'Op 21 jul 2026 om 11:52 heeft Servé Creusen het volgende geschreven:',
      '',
      quotedColdmail,
    ].join('\n'),
    [],
    {
      replyMailId: 'inbox:500',
      mail: {
        accountEmail: 'servecreusen7@gmail.com',
        receivedAt: '2026-07-22T09:21:00.000Z',
        threadMessages: [{
          id: 'sent:499',
          folder: 'sent',
          accountEmail: 'servecreusen7@gmail.com',
          date: '2026-07-21T09:52:00.000Z',
          body: sentColdmail,
        }],
      },
    }
  );

  assert.match(html, /Jouw bericht/);
  assert.equal((html.match(/Afgelopen week kwam ik jullie website nicolevintagefashion\.com tegen\./g) || []).length, 1);
  assert.doesNotMatch(html, /Jouw eerdere mail/);
  assert.doesNotMatch(html, /detail-mail-section-quote/);
});

test('mailbox dedupliceert coldmail generiek ondanks Gmail-linkopmaak en templateverschillen', () => {
  const quotedColdmail = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website thechamomilecollective\u2060.\u2060nl tegen.',
    '',
    'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
    'Je vindt het ontwerp in de bijlage bij deze e-mail.',
    '',
    'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening 😁',
    '',
    'Ik kan ook de online preview doorsturen, zodat je zelf door het ontwerp kunt scrollen.',
    '',
    'Mocht je er niets mee willen doen, dan is dat natuurlijk ook prima! Wel lijkt het me tof om te horen wat je van het design vindt en wat er eventueel beter kan. Daar leer ik dan weer van!',
    '',
    'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link',
    '(https://www.softora.nl/webdesign/the-chamomile-collective?cid=safe-dedupe-20260615-row-2149-6137264c438&sender=serve) bekijken 🎨',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
    '',
    '📍 Tilburg',
  ].join('\n');
  const sentColdmail = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website thechamomilecollective.nl tegen.',
    '',
    'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind. Je vindt het ontwerp in de bijlage bij deze e-mail.',
    '',
    'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening 😁',
    '',
    'Ik kan ook de online preview doorsturen, zodat je zelf door het ontwerp kunt scrollen.',
    '',
    'Mocht je er niets mee willen doen, dan is dat natuurlijk ook prima! Wel lijkt het me tof om te horen wat je van het design vindt en wat er eventueel beter kan. Daar leer ik dan weer van!',
    '',
    'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link bekijken 🎨',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
    '',
    '📍 Tilburg',
    '',
    '[image: thechamomilecollective.nl-preview]',
    'Hieronder zie je een korte indruk van de eerste versie op verschillende schermen.',
    '[image: thechamomilecollective.nl-preview-device-mockup-v8]',
  ].join('\n');
  const html = renderMailboxBodyForTest(
    [
      'Hoi Servé, bedankt voor het ontwerp. Wij hebben op dit moment geen interesse.',
      '',
      'Op do., jul. 23, 2026 om 10:13, Servé Creusen schreef:',
      '',
      quotedColdmail,
    ].join('\n'),
    [],
    {
      replyMailId: 'inbox:elise',
      mail: {
        accountEmail: 'servecreusen7@gmail.com',
        receivedAt: '2026-07-23T09:01:00.000Z',
        threadMessages: [{
          id: 'sent:elise',
          folder: 'sent',
          accountEmail: 'servecreusen7@gmail.com',
          date: '2026-07-23T08:13:00.000Z',
          body: sentColdmail,
        }],
      },
    }
  );

  assert.match(html, /Hoi Servé, bedankt voor het ontwerp\./);
  assert.match(html, /Jouw bericht/);
  assert.equal((html.match(/Afgelopen week kwam ik jullie website thechamomilecollective\.nl tegen\./g) || []).length, 1);
  assert.doesNotMatch(html, /Jouw eerdere mail/);
  assert.doesNotMatch(html, /detail-mail-section-quote/);
});

test('mailbox filtert een bewezen Bossche Brouwers origineel met reply- en linkartefacten alleen uit het grijze antwoord', () => {
  const sentBody = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website bosschebrouwers.nl tegen.',
    '',
    'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind. Je vindt het ontwerp in de bijlage bij deze e-mail.',
    '',
    'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening 😁',
    '',
    'Ik kan ook de online preview doorsturen, zodat je zelf door het ontwerp kunt scrollen.',
    '',
    'Mocht je er niets mee willen doen, dan is dat natuurlijk ook prima! Wel lijkt het me tof om te horen wat je van het design vindt en wat er eventueel beter kan. Daar leer ik dan weer van!',
    '',
    'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link bekijken 🎨',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
    "📍 's-Hertogenbosch",
  ].join('\n');
  const incomingBody = [
    'Hallo Servé',
    '',
    'Leuk dat je aandacht schenkt aan ons bedrijf.',
    'Je design ziet er netjes uit. We gaan het echter niet gebruiken :)',
    '',
    'Vriendelijke groet;',
    'Leonard Hamers',
    '',
    '-------- Oorspronkelijke bericht --------',
    'ONDERWERP:',
    'Kleine vraag over jullie website',
    'DATUM:',
    '2026-07-16 07:34',
    'AFZENDER:',
    'Servé Creusen',
    'ONTVANGER:',
    'arie@bosschebrouwers.nl',
    'ANTWOORD-AAN:',
    'servec321@gmail.com',
    'Goedendag,',
    'Afgelopen week kwam ik jullie website bosschebrouwers.nl tegen.',
    'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat > leuk vind. Je vindt het ontwerp in de bijlage bij deze e-mail.',
    'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke > mening 😁',
    'Ik kan ook de online preview doorsturen, zodat je zelf door het ontwerp > kunt scrollen.',
    'Mocht je er niets mee willen doen, dan is dat natuurlijk ook prima! Wel > lijkt het me tof om te horen wat je van het design vindt en wat er > eventueel beter kan. Daar leer ik dan weer van!',
    'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via > deze link [1] bekijken 🎨',
    'Met vriendelijke groet,',
    'Servé Creusen',
    "📍 's-Hertogenbosch",
    '',
    'Links:',
    '------',
    '[1] https://www.softora.nl/webdesign/bossche-brouwers-aan-de-vaart?cid=safe-dedupe-20260615-row-2855-2fe7929a08&sender=serve',
    '[2] http://www.bosschebrouwers.nl/',
  ].join('\n');
  const html = renderMailboxBodyForTest(incomingBody, [], {
    replyMailId: 'inbox:bossche-brouwers',
    mail: {
      id: 'inbox:bossche-brouwers',
      folder: 'inbox',
      accountEmail: 'servec321@gmail.com',
      receivedAt: '2026-07-25T07:25:00.000Z',
      threadMessages: [{
        id: 'sent:bossche-brouwers',
        messageId: '<bossche-brouwers-original@gmail.com>',
        folder: 'sent',
        accountEmail: 'servec321@gmail.com',
        date: '2026-07-16T05:34:00.000Z',
        body: sentBody,
        originalCampaignOutbound: true,
      }],
    },
  });

  assert.match(html, /Leuk dat je aandacht schenkt aan ons bedrijf\./);
  assert.match(html, /Jouw bericht/);
  assert.equal((html.match(/Afgelopen week kwam ik jullie website bosschebrouwers\.nl tegen\./g) || []).length, 1);
  assert.doesNotMatch(html, /Oorspronkelijke bericht|ONDERWERP:|ANTWOORD-AAN:|detail-mail-section-quote/);
});

test('mailbox dedupliceert een coldmail wanneer Gmail alleen het campagneadres in de citaatkop zet', () => {
  const coldmail = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website studiochristinejetten.nl tegen.',
    '',
    'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
    '',
    'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening 😁',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
  ].join('\n');
  const html = renderMailboxBodyForTest(
    [
      'Hoi Servé, bedankt voor je bericht.',
      '',
      'Van: servecreusen7@gmail.com',
      '',
      coldmail,
    ].join('\n'),
    [],
    {
      replyMailId: 'inbox:christine',
      mail: {
        accountEmail: 'servecreusen7@gmail.com',
        receivedAt: '2026-07-23T09:27:00.000Z',
        threadMessages: [{
          id: 'sent:christine',
          folder: 'sent',
          accountEmail: 'servecreusen7@gmail.com',
          date: '2026-07-23T08:13:00.000Z',
          body: coldmail,
        }],
      },
    }
  );

  assert.match(html, /Hoi Servé, bedankt voor je bericht\./);
  assert.match(html, /Jouw bericht/);
  assert.equal((html.match(/Afgelopen week kwam ik jullie website studiochristinejetten\.nl tegen\./g) || []).length, 1);
  assert.doesNotMatch(html, /Jouw eerdere mail|Eerdere mail/);
  assert.doesNotMatch(html, /detail-mail-section-quote/);
});

test('mailbox voegt vergelijkbare coldmails voor verschillende websites nooit samen of als inferred kaart toe', () => {
  const html = renderMailboxBodyForTest(
    [
      'Bedankt voor je bericht.',
      '',
      'Op 23 jul 2026 om 10:13 heeft Servé Creusen het volgende geschreven:',
      '',
      'Goedendag,',
      '',
      'Afgelopen week kwam ik jullie website ander-bedrijf.nl tegen.',
      '',
      'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
      '',
      'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening.',
      '',
      'Met vriendelijke groet,',
      'Servé Creusen',
    ].join('\n'),
    [],
    {
      replyMailId: 'inbox:other-domain',
      mail: {
        accountEmail: 'servecreusen7@gmail.com',
        receivedAt: '2026-07-23T09:21:00.000Z',
        threadMessages: [{
          id: 'sent:current-domain',
          folder: 'sent',
          accountEmail: 'servecreusen7@gmail.com',
          date: '2026-07-23T08:52:00.000Z',
          body: [
            'Goedendag,',
            '',
            'Afgelopen week kwam ik jullie website huidig-bedrijf.nl tegen.',
            '',
            'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
            '',
            'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening.',
            '',
            'Met vriendelijke groet,',
            'Servé Creusen',
          ].join('\n'),
        }],
      },
    }
  );

  assert.doesNotMatch(html, /detail-mail-section-history-sent|citaat · niet ontvangen/i);
  assert.doesNotMatch(html, /Afgelopen week kwam ik jullie website ander-bedrijf\.nl tegen\./);
  assert.match(html, /Afgelopen week kwam ik jullie website huidig-bedrijf\.nl tegen\./);
  assert.equal((html.match(/detail-mail-section detail-mail-section-sent/g) || []).length, 1);
});

test('mailbox maakt ook van een inhoudelijk andere onbewezen eigen quote geen timelinekaart', () => {
  const html = renderMailboxBodyForTest(
    [
      'Bedankt voor de uitleg.',
      '',
      'Op 21 jul 2026 om 11:52 heeft Servé Creusen het volgende geschreven:',
      '',
      'Hoi Nicole,',
      '',
      'Hierbij stuur ik een nieuw voorstel met een andere prijs en planning.',
    ].join('\n'),
    [],
    {
      replyMailId: 'inbox:501',
      mail: {
        accountEmail: 'servecreusen7@gmail.com',
        receivedAt: '2026-07-22T09:21:00.000Z',
        threadMessages: [{
          id: 'sent:500',
          folder: 'sent',
          accountEmail: 'servecreusen7@gmail.com',
          date: '2026-07-21T09:52:00.000Z',
          body: [
            'Goedendag,',
            '',
            'Afgelopen week kwam ik jullie website nicolevintagefashion.com tegen.',
            'Uit enthousiasme heb ik een fris webdesign gemaakt.',
          ].join('\n'),
        }],
      },
    }
  );

  assert.match(html, /Jouw bericht/);
  assert.doesNotMatch(html, /detail-mail-section-history-sent|citaat · niet ontvangen/i);
  assert.doesNotMatch(html, /Hierbij stuur ik een nieuw voorstel met een andere prijs en planning\./);
  assert.match(html, /Afgelopen week kwam ik jullie website nicolevintagefashion\.com tegen\./);
  assert.equal((html.match(/detail-mail-section detail-mail-section-sent/g) || []).length, 1);
});

test('mailbox knipt een normale Van-regel zonder Outlook-headercluster niet af', () => {
  const html = campaignInboxModule.renderThreadMessages(
    {
      receivedAt: '2026-06-15T13:58:18.000Z',
      accountEmail: 'martijn@softora.nl',
      threadMessages: [{
        folder: 'sent',
        accountEmail: 'martijn@softora.nl',
        date: '2026-06-16T12:31:32.000Z',
        body: 'Hoi Ralph,\n\nVan: onze kant ziet het voorstel er goed uit.',
      }],
    },
    (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    () => ({ date: '16 juni', time: '14:31' }),
    { position: 'newer' }
  );

  assert.match(html, /Van: onze kant ziet het voorstel er goed uit\./);
});

test('premium mailbox ververst owner-scoped, snel en met eerlijke provider-freshness', async () => {
  assert.match(readPage(), /assets\/premium-mailbox\.js\?v=20260826a/);
  assert.match(readPage(), /assets\/premium-mailbox-quoted-thread\.js\?v=20260822a/);
  assert.match(readPage(), /assets\/premium-mailbox-campaign-inbox\.js\?v=20260826a/);
  assert.match(readPage(), /assets\/premium-mailbox-index\.js\?v=20260826a/);
  let nowMs = Date.parse('2026-07-22T17:30:00.000Z');
  const requests = [];
  const loads = [];
  const toasts = [];
  const intervals = [];
  const timeouts = [];
  const ageLabel = {
    textContent: '',
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  const button = {
    disabled: false,
    classList: { toggle() {} },
    setAttribute() {},
    addEventListener(_event, handler) { this.clickHandler = handler; },
  };
  const controller = refreshModule.create({
    autoStart: false,
    button,
    ageLabel,
    now: () => nowMs,
    getAccount: () => 'serve@softora.nl',
    getFolder: () => 'outreach',
    getOwner: () => 'both',
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ ok: true }) };
    },
    loadMessages: async (options) => loads.push(options),
    toast: (message) => toasts.push(message),
    setTimeout: (handler, delay) => { timeouts.push({ handler, delay }); return timeouts.length; },
    clearTimeout() {},
    setInterval: (handler, delay) => { intervals.push({ handler, delay }); return 1; },
    clearInterval() {},
  });

  assert.equal(intervals.length, 0);
  assert.equal(ageLabel.textContent, 'Nog niet gecontroleerd');
  assert.equal(await controller.refresh({ manual: true }), true);
  assert.equal(ageLabel.textContent, 'Zojuist gecontroleerd');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, '/api/mailbox/sync');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    owner: 'both', folder: 'inbox', limit: 4, campaignOnly: true, incrementalOnly: true, fastRefresh: true,
  });
  assert.equal(requests[1].url, '/api/mailbox/instantly/sync');
  assert.deepEqual(JSON.parse(requests[1].options.body), { owner: 'both', fastRefresh: true });
  assert.equal(loads.length, 2);
  assert.deepEqual(loads[0], {
    showLoader: false, skipBackgroundSync: true, skipProviderRefresh: true, skipPageBootstrap: true, openLatest: false, preserveOnError: true,
  });
  assert.deepEqual(loads[1], loads[0]);
  assert.deepEqual(toasts, ['Mailbox volledig bijgewerkt']);

  controller.start();
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].delay, 1000);
  assert.equal(timeouts.at(-1).delay, 0);
  nowMs += 1 * 1000;
  intervals[0].handler();
  assert.equal(ageLabel.textContent, 'Zojuist gecontroleerd');
  nowMs += 28 * 1000;
  intervals[0].handler();
  assert.equal(ageLabel.textContent, 'Zojuist gecontroleerd');
  nowMs += 91 * 1000;
  intervals[0].handler();
  assert.equal(ageLabel.textContent, '2 min geleden gecontroleerd');
  assert.equal(typeof button.clickHandler, 'function');
  controller.destroy();
});

test('premium mailbox uses an owner filter in the coldmail topbar', () => {
  const pageSource = readPage();
  const scriptSource = readScript();
  const campaignInboxSource = readCampaignInboxScript();
  const refreshSource = readRefreshScript();
  const indexSource = readIndexScript();
  const deleteSource = readDeleteScript();
  const composeControllerSource = readComposeControllerScript();
  const ownerSessionSource = readOwnerSessionScript();
  const ownerPreferenceSource = fs.readFileSync(path.join(__dirname, '../../assets/premium-mailbox-owner-preference.js'), 'utf8');

  assert.doesNotMatch(pageSource, /<div class="topbar-title">Mailbox<\/div>/);
  assert.doesNotMatch(pageSource, /<span class="topbar-mailbox-account" id="topbar-mailbox-account"><\/span>/);
  assert.match(pageSource, /<button class="topbar-mailbox-switcher" id="mailbox-account-switcher" type="button" aria-haspopup="menu" aria-expanded="false">/);
  assert.match(pageSource, /<span class="topbar-mailbox-switcher-label" id="topbar-mailbox-account">Servé Creusen<\/span>/);
  assert.match(pageSource, /<div class="topbar-mailbox-menu" id="mailbox-account-menu" role="menu" aria-label="Campagne-eigenaar"><\/div>/);
  assert.match(pageSource, /<button class="topbar-refresh is-refreshing" id="mailbox-refresh" type="button" data-mailbox-action="refresh-mailbox" aria-label="Mailboxproviders worden gecontroleerd\."[^>]*aria-busy="true" disabled>/);
  assert.match(pageSource, /<span class="topbar-refresh-age" id="mailbox-refresh-age" aria-live="polite" aria-label="Mailboxproviders worden gecontroleerd\.">Controleren…<\/span>/);
  assert.match(pageSource, /<div class="mail-sync-status" id="mail-sync-status" hidden><\/div>/);
  assert.match(pageSource, /\.topbar-mailbox-switcher-label \{[\s\S]*font-size:\s*14px;[\s\S]*color:\s*var\(--text-dark\);[\s\S]*text-transform:\s*uppercase;/);
  assert.match(pageSource, /\.topbar-mailbox-menu \{[\s\S]*position:\s*absolute;[\s\S]*display:\s*none;/);
  assert.match(pageSource, /assets\/premium-mailbox-refresh\.js\?v=20260821a/);
  assert.match(pageSource, /assets\/premium-mailbox\.js\?v=20260826a/);
  assert.match(readDisplayScript(), /global\.SoftoraMailboxDisplay =/);
  assert.match(indexSource, /window\.SoftoraMailboxIndex =/);
  assert.match(indexSource, /const MIN_BACKGROUND_SYNC_INTERVAL_MS = 5 \* 60 \* 1000;/);
  assert.match(indexSource, /now - lastBackgroundSyncAt < MIN_BACKGROUND_SYNC_INTERVAL_MS/);
  assert.match(scriptSource, /const MAILBOX_ACCOUNT_DEFAULT = 'info@softora\.nl';/);
  assert.match(scriptSource, /\/api\/mailbox\/accounts/);
  assert.match(ownerSessionSource, /\/api\/mailbox\/messages\?account=/);
  assert.match(deleteSource, /\/api\/mailbox\/messages\/\$\{action\}/);
  assert.match(composeControllerSource, /\/api\/mailbox\/send/);
  assert.match(composeControllerSource, /\/api\/mailbox\/rewrite/);
  assert.match(readComposeWindowScript(), /data-mailbox-compose-drag-handle/);
  assert.match(readComposeWindowScript(), /data-mailbox-compose-resize-zone/);
  assert.match(readComposeWindowScript(), /resizeZones\.forEach/);
  assert.match(readComposeWindowScript(), /resize\.edge\.includes\('w'\)/);
  assert.match(readComposeWindowScript(), /resize\.edge\.includes\('n'\)/);
  assert.match(readComposeWindowScript(), /closeButton\?\.addEventListener\?\.\('pointerdown', \(event\) => event\.stopPropagation\?\.\(\)\)/);
  assert.match(readComposeWindowScript(), /elementFromPoint/);
  assert.doesNotMatch(readOutreachScript(), /\/api\/coldmailing\/outreach\/status/);
  assert.match(scriptSource, /async function loadMailboxAccounts\(\)/);
  assert.match(scriptSource, /async function loadMailboxMessages\(options = \{\}\)/);
  assert.match(scriptSource, /window\.SoftoraMailboxRefresh\?\.create\(/);
  assert.match(scriptSource, /SoftoraMailboxRefresh\?\.create\(\{ autoStart: false, initiallyChecking: true,/);
  assert.match(scriptSource, /\} catch \(error\) \{[\s\S]*\} finally \{\s*window\.SoftoraMailboxBoot\?\.markReady\?\.\(\);\s*mailboxRefreshController\?\.start\?\.\(\);/);
  assert.equal((scriptSource.match(/mailboxRefreshController\?\.start\?\.\(\)/g) || []).length, 1);
  assert.match(refreshSource, /const VISIBLE_REFRESH_INTERVAL_MS = 60 \* 1000;/);
  assert.match(refreshSource, /const HIDDEN_REFRESH_INTERVAL_MS = 5 \* 60 \* 1000;/);
  assert.match(refreshSource, /const REFRESH_AGE_UPDATE_INTERVAL_MS = 1000;/);
  assert.match(refreshSource, /function formatRefreshAge\(lastRefreshAt, currentTime = Date\.now\(\)\)/);
  assert.match(refreshSource, /function buildRefreshRequestBatches\(scope, signal\)/);
  assert.match(refreshSource, /for \(const batch of buildRefreshRequestBatches\(scope, signal\)\)/);
  assert.match(refreshSource, /function refresh\(\{ manual = false \} = \{\}\)/);
  assert.match(refreshSource, /function start\(\)/);
  assert.match(refreshSource, /button\.addEventListener\('click',[\s\S]*refresh\(\{ manual: true \}\)/);
  assert.match(refreshSource, /owner: scope\.owner,[\s\S]*folder: 'inbox',[\s\S]*incrementalOnly: true,[\s\S]*fastRefresh: true/);
  assert.match(refreshSource, /\/api\/mailbox\/instantly\/sync/);
  assert.match(refreshSource, /skipPageBootstrap: true/);
  assert.match(refreshSource, /addEventListener\?\.\('visibilitychange'/);
  assert.match(refreshSource, /addEventListener\?\.\('focus'/);
  assert.match(refreshSource, /addEventListener\?\.\('online'/);
  assert.match(scriptSource, /getOwner: \(\) => window\.SoftoraMailboxCampaignInbox\.getOwner\(\)/);
  assert.match(scriptSource, /activeFolder === 'outreach'[\s\S]*skipProviderRefresh: true/);
  assert.match(scriptSource, /mailboxRefreshController\?\.scopeChanged\?\.\(\)/);
  assert.match(scriptSource, /let mailboxSyncState = null;/);
  assert.match(ownerSessionSource, /void hydrateOutreachContexts\(candidate, loadOptions\)\.catch/);
  assert.match(ownerSessionSource, /loadOptions\.showLoader === false[\s\S]*preserveVisibleDetail = true/);
  assert.match(ownerSessionSource, /skipPageBootstrap: true,[\s\S]*skipProviderRefresh: true/);
  assert.match(ownerSessionSource, /sync\?\.refreshRecommended/);
  assert.match(ownerSessionSource, /Mailbox wordt bijgewerkt/);
  assert.match(indexSource, /\/api\/mailbox\/sync/);
  assert.match(indexSource, /\/api\/mailbox\/message/);
  assert.match(composeControllerSource, /async function send\(\)/);
  assert.match(scriptSource, /const MAILBOX_PIN_SCOPE = 'premium_mailbox_preferences';/);
  assert.match(scriptSource, /const MAILBOX_PIN_KEY = 'softora_mailbox_pinned_account_v1';/);
  assert.match(ownerPreferenceSource, /const PIN_KEY_PREFIX = 'softora_mailbox_pinned_owner_v1_';/);
  assert.match(scriptSource, /window\.SoftoraUiStateClient/);
  assert.match(scriptSource, /async function initializeMailboxAccountPreference\(\)/);
  assert.match(scriptSource, /let bootstrappedPreferences = null;[\s\S]*?SoftoraUiStateClient\?\.peek\?\.\(MAILBOX_PIN_SCOPE\)[\s\S]*?readMailboxPinPreferences\(bootstrappedPreferences\)/);
  assert.match(scriptSource, /const payload = preloadedPayload \|\| \(typeof client\.peek === 'function'[\s\S]*?client\.peek\(MAILBOX_PIN_SCOPE\)[\s\S]*?: await client\.get\(MAILBOX_PIN_SCOPE\)\)/);
  assert.match(scriptSource, /SoftoraMailboxCampaignInbox\.initializeOwnerPreference\(session, window\.SoftoraUiStateClient, mailboxAccountPreferenceIdentity\)/);
  assert.match(scriptSource, /function getMailboxAccounts\(\) \{\s*return getMailboxAccountEmails\(\);\s*\}/);
  assert.match(scriptSource, /function getMailboxAccount\(\) \{\s*return activeMailboxAccount;\s*\}/);
  assert.match(scriptSource, /SoftoraMailboxCampaignInbox\.renderOwnerMenu\(escapeHtml\)/);
  assert.match(scriptSource, /SoftoraMailboxCampaignInbox\.filterMessages\(mails\)/);
  assert.match(scriptSource, /ownerButton\.dataset\.mailboxOwner/);
  assert.match(campaignInboxSource, /data-mailbox-pin-owner/);
  assert.match(campaignInboxSource, /async function pinOwner\(value, uiStateClient\)/);
  assert.match(ownerPreferenceSource, /const OWNER_HISTORY_STATE_KEY = 'softoraMailboxOwnerViewV1';/);
  assert.match(ownerPreferenceSource, /normalizeIdentity\(view\.identity\) !== normalizeIdentity\(nextIdentity\)/);
  assert.match(ownerPreferenceSource, /history\.replaceState\(\{[\s\S]*?OWNER_HISTORY_STATE_KEY[\s\S]*?identity: viewIdentity, owner[\s\S]*?\}, ''\)/);
  assert.match(ownerPreferenceSource, /const patch = \{ \[getSelectionKey\(writeIdentity\)\]: owner \};/);
  assert.match(ownerPreferenceSource, /if \(includePin\) patch\[getPinKey\(writeIdentity\)\] = owner/);
  assert.match(ownerPreferenceSource, /enqueueWrite\(writer, identity, owner, true\)/);
  assert.doesNotMatch(ownerPreferenceSource, /localStorage|sessionStorage|indexedDB/);
  assert.match(ownerPreferenceSource, /\}, \{ keepalive: true \}\)/);
  assert.match(scriptSource, /function renderMailboxAccountMenu\(\) \{[\s\S]*data-mailbox-email="\$\{escapeHtml\(email\)\}"/);
  assert.match(scriptSource, /data-mailbox-pin-email="\$\{escapeHtml\(email\)\}"/);
  assert.match(scriptSource, /async function pinMailboxAccount\(email\)/);
  assert.match(scriptSource, /async function applyMailboxAccount\(email, options = \{\}\) \{[\s\S]*activeMailboxAccount = hasMailboxAccount\(normalizedEmail\)[\s\S]*applyMailboxFolderUi\(activeFolder\);[\s\S]*setMailboxAccountUi\(activeMailboxAccount\);/);
  assert.match(scriptSource, /await initializeMailboxAccountPreference\(\);[\s\S]*SoftoraMailboxOutreach\.readIntent\(\)[\s\S]*await loadMailboxAccounts\(\);/);
  assert.match(scriptSource, /mailboxAccountSwitcher\.addEventListener\('click', function\(event\) \{/);
  assert.match(scriptSource, /mailboxAccountMenu\.addEventListener\('click', function\(event\) \{[\s\S]*applyMailboxAccount\(email\);/);
  assert.match(scriptSource, /mailboxAccountMenu\.addEventListener\('click', function\(event\) \{[\s\S]*pinMailboxAccount\(email\);/);
  assert.match(scriptSource, /mailboxAccountMenu\.addEventListener\('click', function\(event\) \{[\s\S]*const selectedOwner = switchCampaignMailboxOwner\(pinOwner \|\| ownerButton\.dataset\.mailboxOwner, \{ persist: !pinOwner \}\);[\s\S]*SoftoraMailboxCampaignInbox[\s\S]*\.pinOwner\(selectedOwner, window\.SoftoraUiStateClient\)/);
});

test('coldmail eigenaarfilter houdt de negen campagneadressen gescheiden tussen Servé en Martijn', () => {
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

  campaignInboxModule.setOwner('both');
  assert.equal(campaignInboxModule.getOwnerLabel(), 'Martijn & Servé');
  assert.deepEqual(
    campaignInboxModule.filterMessages(messages).map((message) => message.id),
    messages.slice(0, 9).map((message) => message.id)
  );

  const ownerMenu = campaignInboxModule.renderOwnerMenu((value) => String(value));
  assert.match(ownerMenu, />Servé Creusen</);
  assert.match(ownerMenu, />Martijn van de Ven</);
  assert.match(ownerMenu, />Martijn & Servé</);
  assert.doesNotMatch(ownerMenu, /@/);
  campaignInboxModule.setOwner('serve');
});

test('coldmail eigenaarfilter lekt een bewezen Martijn-kopie nooit naar Servé', () => {
  const copy = {
    id: 'serve@softora.nl|inbox:107',
    accountEmail: 'serve@softora.nl',
    email: 'martijn@softora.nl',
    receivedAt: '2026-07-24T16:15:00.000Z',
    copyContext: {
      evidenceKnown: true,
      kind: 'bcc',
      sourceAccountEmail: 'martijn@softora.nl',
    },
  };

  assert.deepEqual(campaignInboxModule.filterMessages([copy], 'serve'), []);
  assert.deepEqual(
    campaignInboxModule.filterMessages([copy], 'martijn').map((message) => message.id),
    ['serve@softora.nl|inbox:107']
  );
  assert.equal(campaignInboxModule.getMessageOwner(copy), 'martijn');
  assert.deepEqual(campaignInboxModule.filterMessages([{
    ...copy,
    id: 'unproven-colleague-copy',
    copyContext: null,
  }], 'serve'), []);
});

test('coldmail lijst toont geen automatische antwoorden uit bootstrap- of sessiecache', () => {
  const messages = [
    {
      id: 'human',
      accountEmail: 'martijn@softora.nl',
      subject: 'Re: Kleine vraag over jullie website',
      body: 'Dank voor je ontwerp, maar wij hebben geen interesse.',
      receivedAt: '2026-07-23T09:00:00.000Z',
    },
    {
      id: 'impressioni-summer-closure',
      accountEmail: 'serve@softora.nl',
      provider: 'instantly',
      providerOwner: 'serve',
      subject: 'zomersluiting Re: Kleine vraag over jullie website',
      preview: 'Beste mailer, Tot 1 juli is impressioni gesloten. Daarna helpen we u graag weer!',
      body: 'Beste mailer,\n\nTot 1 juli is impressioni gesloten.\nDaarna helpen we u graag weer!',
      receivedAt: '2026-07-23T09:30:00.000Z',
    },
    {
      id: 'qccs-away',
      accountEmail: 'martijn@softora.nl',
      subject: 'Afwezigheidmelding Re: Kleine vraag over jullie website',
      body: 'Vanaf 2 juli tot en met 3 augustus 2026 is ons kantoor gesloten.',
      receivedAt: '2026-07-23T10:00:00.000Z',
    },
    {
      id: 'body-only-auto',
      accountEmail: 'martijn@softora.nl',
      subject: 'Nieuw e-mailadres Re: Kleine vraag over jullie website',
      preview: 'Beste lezer, wij hebben een nieuw e-mailadres.',
      body: 'Dit bericht is automatisch gegenereerd.',
      receivedAt: '2026-07-23T11:00:00.000Z',
    },
    {
      id: 'sushi-auto',
      accountEmail: 'servecreusen7@gmail.com',
      subject: 'Re: Kleine vraag over jullie website',
      preview: 'Dit is een automatisch email van info@sushidetoren.com.',
      body: 'We hebben uw email in goede orde ontvangen en proberen uw email binnen 24 uur te beantwoorden.',
      receivedAt: '2026-07-23T12:00:00.000Z',
    },
    {
      id: 'human-about-automation',
      accountEmail: 'martijn@softora.nl',
      subject: 'Re: Kleine vraag over jullie website',
      body: 'Dank voor je mail. De automatische e-mail op onze website werkt inderdaad nog niet goed.',
      receivedAt: '2026-07-23T13:00:00.000Z',
    },
    {
      id: 'dietist-auto',
      accountEmail: 'serve@softora.nl',
      subject: 'Automatisch antwoorden: Nieuw webdesign gemaakt!',
      body: 'Hartelijk dank voor je email. Ik streef er naar om deze binnen 2 werkdagen te beantwoorden.',
      receivedAt: '2026-07-23T14:00:00.000Z',
    },
    {
      id: 'human-automation-question',
      accountEmail: 'martijn@softora.nl',
      subject: 'Vraag over automatisch antwoorden in Gmail',
      body: 'Kun je uitleggen hoe ik dit zelf instel?',
      receivedAt: '2026-07-23T15:00:00.000Z',
    },
  ];

  assert.equal(campaignInboxModule.isAutomatedCampaignReply(messages[0]), false);
  assert.equal(campaignInboxModule.isAutomatedCampaignReply(messages[1]), true);
  assert.equal(campaignInboxModule.isAutomatedCampaignReply(messages[2]), true);
  assert.equal(campaignInboxModule.isAutomatedCampaignReply(messages[3]), true);
  assert.equal(campaignInboxModule.isAutomatedCampaignReply(messages[4]), true);
  assert.equal(campaignInboxModule.isAutomatedCampaignReply(messages[5]), false);
  assert.equal(campaignInboxModule.isAutomatedCampaignReply(messages[6]), true);
  assert.equal(campaignInboxModule.isAutomatedCampaignReply(messages[7]), false);
  assert.deepEqual(
    campaignInboxModule.filterMessages(messages, 'martijn').map((message) => message.id),
    ['human-automation-question', 'human-about-automation', 'human']
  );
  assert.deepEqual(campaignInboxModule.filterMessages(messages, 'serve'), []);
});

test('coldmail lijst verbergt Cafe Bar le Duc en out-of-office maar bewaart echte menselijke reactie', () => {
  const messages = [
    {
      id: 'cafe-bar-le-duc-autoack',
      accountEmail: 'serve@softora.nl',
      subject: 'Bedankt voor je bericht! Re: Kleine vraag over jullie website',
      body: 'Bedankt voor je bericht! We streven ernaar jouw mail de eerstvolgende werkdag te beantwoorden. Op woensdag wordt de mail beperkt gelezen.',
    },
    {
      id: 'rens-ooo',
      accountEmail: 'serve@softora.nl',
      subject: 'Out of the office Re: Kleine vraag over jullie website',
      body: 'I am currently out of the office. For urgent matters, please contact my colleague.',
      autoSubmitted: 'auto-replied',
      automatedReplyEvidence: true,
    },
    {
      id: 'human-price-question',
      accountEmail: 'serve@softora.nl',
      subject: 'Bedankt voor je bericht',
      body: 'Het ontwerp spreekt me aan. Kun je aangeven wat een nieuwe website ongeveer kost?',
      autoSubmitted: 'no',
    },
  ];

  assert.equal(campaignInboxModule.isAutomatedCampaignReply(messages[0]), true);
  assert.equal(campaignInboxModule.isAutomatedCampaignReply(messages[1]), true);
  assert.equal(campaignInboxModule.isAutomatedCampaignReply(messages[2]), false);
  assert.deepEqual(
    campaignInboxModule.filterMessages(messages, 'serve').map((message) => message.id),
    ['human-price-question']
  );
});

test('coldmail lijst groepeert een nieuw antwoord direct in het bestaande gespreksvak', () => {
  const originalMessageId = '<campaign-start@example.test>';
  const firstReplyMessageId = '<first-reply@example.test>';
  const messages = [
    {
      id: 'martijnven123@gmail.com|inbox:37476',
      mailboxId: 'inbox:37476',
      folder: 'inbox',
      accountEmail: 'martijnven123@gmail.com',
      from: 'Seats 2 Meet Station Den Bosch',
      email: 'info@seats2meetstationdenbosch.nl',
      subject: 'Re: Kleine vraag over jullie website',
      messageId: '<latest-reply@example.test>',
      inReplyTo: '<martijn-answer@example.test>',
      references: `${originalMessageId} ${firstReplyMessageId} <martijn-answer@example.test>`,
      receivedAt: '2026-07-23T09:31:11.000Z',
      unread: true,
      campaign: { account: 'martijnven123@gmail.com' },
    },
    {
      id: 'martijnven123@gmail.com|inbox:37467',
      mailboxId: 'inbox:37467',
      folder: 'inbox',
      accountEmail: 'martijnven123@gmail.com',
      from: 'Seats 2 Meet Station Den Bosch',
      email: 'info@seats2meetstationdenbosch.nl',
      subject: 'Re: Kleine vraag over jullie website',
      messageId: firstReplyMessageId,
      inReplyTo: originalMessageId,
      references: originalMessageId,
      receivedAt: '2026-07-22T15:36:03.000Z',
      campaign: { account: 'martijnven123@gmail.com' },
    },
  ];

  const grouped = campaignInboxModule.filterMessages(messages, 'martijn');

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].mailboxId, 'inbox:37476');
  assert.equal(grouped[0].unread, true);
  assert.equal(grouped[0].threadMessages.length, 1);
  assert.equal(grouped[0].threadMessages[0].mailboxId, 'inbox:37467');
  assert.equal(grouped[0].threadMessages[0].folder, 'inbox');
});

test('eigen uitgaand antwoord werkt de lijstpositie bij op de nieuwste activiteit', () => {
  const rosmalen = {
    id: 'serve@softora.nl|inbox:rosmalen',
    mailboxId: 'inbox:rosmalen',
    conversationId: 'conversation:serve@softora.nl|rosmalen',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    email: 'info@heemkundekringrosmalen.nl',
    subject: 'Re: Kleine vraag over jullie website',
    receivedAt: '2026-07-07T09:00:00.000Z',
    campaign: { account: 'serve@softora.nl' },
    threadMessages: [{
      id: 'sent:rosmalen-reply',
      folder: 'sent',
      accountEmail: 'serve@softora.nl',
      to: 'info@heemkundekringrosmalen.nl',
      date: '2026-08-05T16:39:00.000Z',
      messageId: '<rosmalen-reply@softora.nl>',
    }],
  };
  const newerInbound = {
    id: 'serve@softora.nl|inbox:newer',
    mailboxId: 'inbox:newer',
    conversationId: 'conversation:serve@softora.nl|newer',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    email: 'newer@example.nl',
    subject: 'Re: Kleine vraag over jullie website',
    receivedAt: '2026-07-08T09:00:00.000Z',
    campaign: { account: 'serve@softora.nl' },
  };

  let grouped = campaignInboxModule.filterMessages([rosmalen, newerInbound], 'serve');
  assert.deepEqual(grouped.map((mail) => mail.mailboxId), ['inbox:rosmalen', 'inbox:newer']);
  assert.equal(grouped[0].activityAt, '2026-08-05T16:39:00.000Z');
  assert.equal(grouped[0].latestOutboundAt, '2026-08-05T16:39:00.000Z');
  assert.equal(grouped[0].threadMessages[0].id, 'sent:rosmalen-reply');

  grouped = campaignInboxModule.filterMessages([{
    ...rosmalen,
    id: 'serve@softora.nl|inbox:rosmalen-new',
    mailboxId: 'inbox:rosmalen-new',
    receivedAt: '2026-08-06T08:00:00.000Z',
  }, newerInbound], 'serve');
  assert.equal(grouped[0].mailboxId, 'inbox:rosmalen-new');
  assert.equal(grouped[0].activityAt, '2026-08-06T08:00:00.000Z');
});

test('coldmail UI herstelt één gesprek bij gesplitste backend-ids met exact account contact en campagneonderwerp', () => {
  const shared = {
    folder: 'coldmail',
    accountEmail: 'serve290@gmail.com',
    from: 'Info | Salon TOF',
    email: 'info@salontof.nl',
    subject: 'Re: Kleine vraag over jullie website',
    campaign: { account: 'serve290@gmail.com' },
  };
  const grouped = campaignInboxModule.filterMessages([
    {
      ...shared,
      id: 'serve290@gmail.com|coldmail:237',
      mailboxId: 'coldmail:237',
      conversationId: 'conversation:serve290@gmail.com|salon-follow-up@gmail.com',
      receivedAt: '2026-08-01T12:35:00.000Z',
      unread: true,
      threadMessages: [{
        id: 'sent:salon-follow-up',
        folder: 'sent',
        accountEmail: 'serve290@gmail.com',
        to: 'info@salontof.nl',
        subject: 'Re: Kleine vraag over jullie website',
        date: '2026-08-01T11:42:00.000Z',
        messageId: '<salon-follow-up@gmail.com>',
      }],
    },
    {
      ...shared,
      id: 'serve290@gmail.com|coldmail:4',
      mailboxId: 'coldmail:4',
      conversationId: 'conversation:serve290@gmail.com|salon-original@gmail.com',
      receivedAt: '2026-07-24T13:54:00.000Z',
      threadMessages: [{
        id: 'sent:salon-original',
        folder: 'sent',
        accountEmail: 'serve290@gmail.com',
        to: 'info@salontof.nl',
        subject: 'Kleine vraag over jullie website',
        date: '2026-07-24T12:59:00.000Z',
        messageId: '<salon-original@gmail.com>',
      }],
    },
  ], 'serve');

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].mailboxId, 'coldmail:237');
  assert.equal(grouped[0].unread, true);
  assert.deepEqual(
    grouped[0].threadMessages.map((message) => message.id),
    ['sent:salon-follow-up', 'serve290@gmail.com|coldmail:4', 'sent:salon-original']
  );
});

test('coldmail UI fallback mengt geen andere accounts contacten onderwerpen of providers', () => {
  const base = {
    folder: 'inbox',
    accountEmail: 'serve290@gmail.com',
    email: 'info@salontof.nl',
    subject: 'Re: Kleine vraag over jullie website',
    receivedAt: '2026-08-01T12:35:00.000Z',
    campaign: { account: 'serve290@gmail.com' },
  };
  const grouped = campaignInboxModule.filterMessages([
    { ...base, id: 'base', mailboxId: 'base', conversationId: 'conversation:base' },
    { ...base, id: 'other-account', mailboxId: 'other-account', accountEmail: 'servecreusen7@gmail.com', conversationId: 'conversation:other-account' },
    { ...base, id: 'other-contact', mailboxId: 'other-contact', email: 'boekhouding@salontof.nl', conversationId: 'conversation:other-contact' },
    { ...base, id: 'other-subject', mailboxId: 'other-subject', subject: 'Re: Nieuw webdesign', conversationId: 'conversation:other-subject' },
    { ...base, id: 'instantly', mailboxId: 'instantly', provider: 'instantly', providerOwner: 'serve', conversationId: 'instantly:serve:salon' },
  ], 'serve');

  assert.equal(grouped.length, 5);
  assert.equal(campaignInboxModule.getStableCampaignConversationId({
    ...base,
    folder: 'coldmail',
    email: 'serve.290@gmail.com',
  }), '');
});

test('coldmail lijst bewaart meer dan tien berichten in dezelfde conversatie', () => {
  const threadMessages = Array.from({ length: 12 }, (_, index) => ({
    id: `sent:${index + 1}`,
    uid: index + 1,
    folder: 'sent',
    accountEmail: 'martijn@softora.nl',
    to: 'rruyters@road2value.com',
    date: new Date(Date.UTC(2026, 5, 23, 12, 0, 0) - index * 60_000).toISOString(),
    messageId: `<sent-${index + 1}@example.test>`,
  }));
  const grouped = campaignInboxModule.filterMessages([{
    id: 'inbox:23',
    mailboxId: 'inbox:23',
    folder: 'inbox',
    accountEmail: 'martijn@softora.nl',
    email: 'rruyters@road2value.com',
    conversationId: 'conversation:martijn@softora.nl|contact:rruyters@road2value.com',
    receivedAt: '2026-06-15T13:58:18.000Z',
    campaign: { account: 'martijn@softora.nl' },
    threadMessages,
  }], 'martijn');

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].threadMessages.length, 12);
  assert.deepEqual(
    grouped[0].threadMessages.map((message) => message.id),
    threadMessages.map((message) => message.id)
  );
});

test('coldmail berichten met hetzelfde IMAP-id blijven per mailboxaccount uniek', () => {
  const serveMail = campaignInboxModule.decorateMessage(
    { id: 'inbox:42' },
    {
      id: 'inbox:42',
      accountEmail: 'servecreusen@softora.nl',
      date: '2026-07-20T07:34:00.000Z',
    }
  );
  const martijnMail = campaignInboxModule.decorateMessage(
    { id: 'inbox:42' },
    {
      id: 'inbox:42',
      accountEmail: 'martijn@softora.nl',
      date: '2026-07-20T08:11:00.000Z',
    }
  );

  assert.equal(serveMail.id, 'servecreusen@softora.nl|inbox:42');
  assert.equal(martijnMail.id, 'martijn@softora.nl|inbox:42');
  assert.notEqual(serveMail.id, martijnMail.id);
  assert.equal(campaignInboxModule.getRequestId(serveMail), 'inbox:42');
  assert.equal(campaignInboxModule.getRequestId(martijnMail), 'inbox:42');
  assert.deepEqual(
    campaignInboxModule.filterMessages([serveMail, martijnMail], 'martijn').map((mail) => mail.id),
    ['martijn@softora.nl|inbox:42']
  );
});

test('coldmail eigenaar kiest per ingelogde gebruiker de eigen mailbox als standaard', () => {
  assert.equal(campaignInboxModule.resolveOwnerForSession({ email: 'serve@softora.nl' }), 'serve');
  assert.equal(campaignInboxModule.resolveOwnerForSession({ email: 'martijn@softora.nl' }), 'martijn');
  assert.equal(campaignInboxModule.resolveOwnerForSession({ displayName: 'Servé Creusen' }), 'serve');
  assert.equal(campaignInboxModule.resolveOwnerForSession({ displayName: 'Martijn van de Ven' }), 'martijn');
  assert.equal(campaignInboxModule.resolveOwnerForSession({ email: 'onbekend@softora.nl' }), 'serve');

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
  assert.match(serveMenu, /Martijn & Servé/);
  assert.match(martijnMenu, /Martijn & Servé/);
});

test('coldmail eigenaar kan Servé Martijn of de gecombineerde inbox vastpinnen', () => {
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

  const combinedMenu = campaignInboxModule.renderOwnerMenu(String, {
    defaultOwner: 'serve',
    pinnedOwner: 'both',
  });
  assert.match(combinedMenu, /Martijn & Servé/);
  assert.match(combinedMenu, /topbar-mailbox-option-row pinned[\s\S]*data-mailbox-pin-owner="both"/);
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
    async set(scope, body, options) {
      writes.push({ scope, body, options });
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
  const pinWrite = writes.find((entry) => entry.body?.patch?.softora_mailbox_pinned_owner_v1_usr_serve === 'serve');
  assert.ok(pinWrite);
  assert.deepEqual(pinWrite, {
    scope: 'premium_mailbox_preferences',
    body: {
      patch: {
        softora_mailbox_pinned_owner_v1_usr_serve: 'serve',
        softora_mailbox_active_owner_v1_usr_serve: 'serve',
      },
      source: 'premium-mailbox',
      actor: 'usr_serve',
    },
    options: { keepalive: true },
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
    campaignInboxModule.filterMessages(messages, 'serve').map((message) => message.id),
    ['midden', 'oud']
  );
  assert.deepEqual(
    campaignInboxModule.filterMessages(messages, 'martijn').map((message) => message.id),
    ['nieuw']
  );
});

test('mailbox opent bij eerste paginalaad automatisch de meest recente zichtbare mail', () => {
  const scriptSource = readScript();
  const renderListSource = scriptSource.match(/function renderList\(options = \{\}\) \{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(renderListSource, /const hasVisibleActiveMail = activeMail != null && list\.some/);
  assert.match(renderListSource, /if \(!hasVisibleActiveMail\) activeMail = null;/);
  assert.match(renderListSource, /if \(!activeMail && options\.openLatest !== false\) return openMail\(list\[0\]\.id\);/);
  assert.match(readOwnerSessionScript(), /renderList\?\.\(\{ openLatest: loadOptions\.openLatest !== false \}\)/);
  assert.match(scriptSource, /openLatest: !\(intent\.message \|\| intent\.email \|\| intent\.query\)/);
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

test('coldmail rij gebruikt de laatste inkomende of uitgaande activiteit', () => {
  const helpers = loadMailboxHelpersForTest();
  const mail = helpers.normalizeMailboxApiMessage({
    id: 'inbox:ralph',
    folder: 'inbox',
    from: 'Ralph Ruyters',
    email: 'rruyters@road2value.com',
    receivedAt: '2026-06-15T13:58:18.000Z',
    activityAt: '2026-06-23T11:32:58.000Z',
    latestOutboundAt: '2026-06-23T11:32:58.000Z',
  });
  const row = listModule.renderItem(mail, {
    activeMail: '',
    escapeHtml: String,
    display: helpers.display,
    displayOptions: { activeFolder: 'outreach', account: 'martijn@softora.nl' },
  });

  assert.equal(mail.date, '15 juni');
  assert.equal(mail.time, '15:58');
  assert.equal(mail.activityDate, '23 juni');
  assert.equal(mail.activityTime, '13:32');
  assert.match(row, /<span class="mail-date-label">23 juni<\/span>/);
  assert.match(row, /<span class="mail-time-value">13:32<\/span>/);
});

test('coldmail rij combineert een activiteit van vandaag nooit met de oude ontvangstdatum', () => {
  const helpers = loadMailboxHelpersForTest();
  const row = listModule.renderItem({
    id: 'martijn@softora.nl|inbox:58',
    from: 'Inkoop Seniorenwinkel',
    email: 'inkoop.seniorenwinkel@gmail.com',
    accountEmail: 'martijn@softora.nl',
    receivedAt: '2026-08-08T10:12:00.000Z',
    activityAt: '2026-08-18T11:14:16.000Z',
    listDate: '8 augustus',
    time: '12:12',
    activityListDate: '',
    activityTime: '13:14',
  }, {
    activeMail: '',
    escapeHtml: String,
    display: helpers.display,
    displayOptions: { activeFolder: 'outreach', account: 'martijn@softora.nl' },
  });

  assert.doesNotMatch(row, /mail-date-label/);
  assert.doesNotMatch(row, /8 augustus/);
  assert.match(row, /<span class="mail-time-value">13:14<\/span>/);
});

test('coldmail tabcache behoudt de echte ontvangsttijd en valt niet terug op middernacht', () => {
  const helpers = loadMailboxHelpersForTest();
  const mail = helpers.normalizeMailboxApiMessage({
    id: 'servecreusen@softora.nl|inbox:42',
    mailboxId: 'inbox:42',
    accountEmail: 'servecreusen@softora.nl',
    date: '20 juli',
    receivedAt: '2026-07-20T07:34:00.000Z',
  });

  assert.equal(mail.id, 'servecreusen@softora.nl|inbox:42');
  assert.equal(mail.mailboxId, 'inbox:42');
  assert.equal(mail.receivedAt, '2026-07-20T07:34:00.000Z');
  assert.equal(mail.time, '09:34');
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
  const renderListSource = scriptSource.match(/function renderList\(options = \{\}\) \{[\s\S]*?\n\}/)?.[0] || '';
  const listSource = readListScript();

  assert.match(renderListSource, /SoftoraMailboxList\.renderItem/);
  assert.match(listSource, /class="unread-dot"/);
  assert.match(listSource, /class="mail-from"/);
  assert.match(listSource, /class="mail-time"/);
  assert.match(listSource, /class="mail-date-label"/);
  assert.match(listSource, /class="mail-time-value"/);
  assert.match(listSource, /data-mailbox-received-at/);
  assert.doesNotMatch(listSource, /class="mail-subject"/);
  assert.doesNotMatch(listSource, /class="mail-preview"/);
  assert.doesNotMatch(renderListSource, /renderListMeta/);
  assert.doesNotMatch(pageSource, /\.mail-campaign-meta/);
  assert.match(pageSource, /\.mail-from \{[\s\S]*font-weight:\s*400;/);
  assert.match(pageSource, /\.mail-item\.unread \.mail-from \{\s*font-weight:\s*600;\s*\}/);
  assert.match(pageSource, /\.mail-item \{[\s\S]*min-height:\s*52px;/);
  assert.match(pageSource, /\.unread-dot \{[\s\S]*background:\s*var\(--crimson\);/);
  assert.match(pageSource, /\.mail-results-scroll \{[\s\S]*overflow-y:\s*auto;[\s\S]*scrollbar-width:\s*none;[\s\S]*-ms-overflow-style:\s*none;/);
  assert.match(pageSource, /\.mail-results-scroll::\-webkit\-scrollbar \{[\s\S]*display:\s*none;/);
  assert.match(pageSource, /\.mail-time \{[\s\S]*flex-direction:\s*column;[\s\S]*align-items:\s*flex-end;/);
});

test('geopend gesprek toont verbergen alleen in de detailkop en niet in de mailboxrij', () => {
  const pageSource = readPage();
  const scriptSource = readScript();
  const readSource = readReadScript();
  const uiStateSource = readUiStateScript();
  const listSource = fs.readFileSync(listScriptPath, 'utf8');

  assert.match(pageSource, /assets\/premium-mailbox-list\.js/);
  assert.match(scriptSource, /SoftoraMailboxList\.renderItem/);
  assert.match(listSource, /class="mail-item-open"[\s\S]*data-mailbox-action="open-mail"/);
  assert.doesNotMatch(listSource, /data-mailbox-action="delete-mail"|mail-item-delete/);
  assert.match(scriptSource, /class="detail-hide-conversation"[\s\S]*data-mailbox-action="delete-mail"/);
  assert.match(uiStateSource, /class="detail-mark-read[\s\S]*data-mailbox-action="mark-read"[\s\S]*Als gelezen afhandelen/);
  assert.match(scriptSource, /case 'mark-read':[\s\S]*SoftoraMailboxUiState\.handleReadAction\(action,/);
  assert.match(readSource, /dismissReply:\s*persistOptions\.dismissReply === true/);
  assert.match(scriptSource, /aria-label="Gesprek alleen uit Softora verbergen"/);
  assert.match(pageSource, /\.detail-mark-read[\s\S]*color:\s*var\(--crimson\)/);
  assert.match(pageSource, /\.detail-hide-conversation \{[\s\S]*color:\s*var\(--crimson\);[\s\S]*cursor:\s*pointer;/);
  assert.match(pageSource, /\.mail-item-open:focus-visible \{[\s\S]*outline:/);

  const escaped = (value) => String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const baseOptions = {
    display: { getListPrimaryText: () => 'Noortje Vogels' },
    displayOptions: { account: 'serve@softora.nl' },
    escapeHtml: escaped,
  };
  const activeRow = listModule.renderItem({ id: 'inbox:42', time: '13:41' }, { ...baseOptions, activeMail: 'inbox:42' });
  const inactiveRow = listModule.renderItem({ id: 'inbox:43', time: '13:42' }, { ...baseOptions, activeMail: 'inbox:42' });

  assert.doesNotMatch(activeRow, /data-mailbox-action="delete-mail"/);
  assert.doesNotMatch(inactiveRow, /data-mailbox-action="delete-mail"/);
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
  assert.match(pageSource, /\.btn-rewrite-compose,\s*\.btn-spellcheck-compose \{[\s\S]*color:\s*var\(--crimson\);/);
  assert.match(pageSource, /data-mailbox-action="rewrite-compose">Voorgestelde reactie<\/button>/);
  assert.match(pageSource, /<button class="compose-x" type="button" data-mailbox-action="close-compose" data-mailbox-compose-no-drag aria-label="Sluiten" title="Sluiten">×<\/button>/);
  assert.match(pageSource, /\.compose-x \{[^}]*z-index:\s*12;[^}]*width:\s*44px;[^}]*height:\s*44px;/);
  assert.match(pageSource, /\.compose-box \{[^}]*height:\s*min\(700px,\s*calc\(100vh - 28px\)\);[^}]*min-height:\s*min\(480px,\s*calc\(100vh - 28px\)\);/);
  assert.equal((pageSource.match(/data-mailbox-compose-resize-zone="(?:n|ne|e|se|s|sw|w|nw)"/g) || []).length, 8);
  assert.match(pageSource, /\.compose-resize-zone--n \{[^}]*cursor:\s*ns-resize;/);
  assert.match(pageSource, /\.compose-resize-zone--e \{[^}]*cursor:\s*ew-resize;/);
  assert.match(pageSource, /\.compose-resize-zone--nw,\.compose-resize-zone--se \{[^}]*cursor:\s*nwse-resize;/);
  assert.match(pageSource, /\.compose-resize-zone--ne,\.compose-resize-zone--sw \{[^}]*cursor:\s*nesw-resize;/);
  assert.doesNotMatch(pageSource, /compose-resize-grip|data-mailbox-compose-resize-handle|compose-resize-zone::/);
  assert.match(pageSource, /assets\/premium-mailbox-compose-window\.js\?v=20260817c/);
  assert.match(pageSource, /assets\/premium-mailbox-compose-controller\.js\?v=20260826a/);
  assert.doesNotMatch(pageSource, /class="btn-discard"/);
  assert.doesNotMatch(pageSource, />Verwijderen<\/button>/);
});

test('premium mailbox kan vanuit de mailcontext een voorgestelde reactie schrijven', () => {
  const pageSource = readPage();
  const scriptSource = readScript();
  const composeControllerSource = readComposeControllerScript();

  assert.match(pageSource, /data-mailbox-action="rewrite-compose">Voorgestelde reactie<\/button>/);
  assert.match(composeControllerSource, /let replyContext = null;/);
  assert.match(composeControllerSource, /function buildRewriteContext\(\)/);
  assert.match(composeControllerSource, /async function rewrite\(\)/);
  assert.match(composeControllerSource, /\/api\/mailbox\/rewrite/);
  assert.match(scriptSource, /function loadMailboxSenderProfile\(senderEmail = getMailboxAccount\(\)\)/);
  assert.match(scriptSource, /SoftoraCampaignSenderSettings\.loadProfileForSender/);
  assert.match(composeControllerSource, /const replyAccount = options\.normalizeEmail\(replyContext && replyContext\.accountEmail\) \|\| options\.getAccount\(\);/);
  assert.match(composeControllerSource, /const senderProfile = await options\.loadSenderProfile\(replyAccount\);/);
  assert.match(composeControllerSource, /account: replyAccount,/);
  assert.match(composeControllerSource, /senderProfile,/);
  assert.match(composeControllerSource, /context: buildRewriteContext\(\)/);
  assert.match(composeControllerSource, /action === 'rewrite-compose'[\s\S]*void rewrite\(\)/);
  assert.match(composeControllerSource, /function setReplyContext\(mail\) \{[\s\S]*options\.compose\.buildReplyContext/);
  assert.match(composeControllerSource, /function reply\(mail, requestedMessageKey = ''\) \{[\s\S]*resolveReplySource\(mail, requestedMessageKey\)[\s\S]*setReplyContext\(replySource\);/);
  assert.match(composeControllerSource, /if \(!draft && !isSuggestedReply\)/);
  assert.match(composeControllerSource, /Reactie voorgesteld/);
  assert.match(composeControllerSource, /bodyField\.value = rewritten;/);
  assert.match(composeControllerSource, /options\.compose\.reset\(Boolean\(replyContext && replyContext\.mode !== 'new-message'\)\)/);
  assert.match(composeControllerSource, /options\.compose\.complete\(rewriteBtn\)/);
  assert.match(composeControllerSource, /options\.compose\.finish\(/);
  assert.match(composeControllerSource, /options\.compose\.isUsed\(\)/);
  assert.match(readComposeScript(), /let rewriteUsed = false;/);
  assert.match(readComposeScript(), /rewriteUsed = true;[\s\S]*button\.hidden = true;/);
  assert.match(readComposeScript(), /function getOriginalSentMail\(mail\)/);
  assert.match(readComposeScript(), /originalCampaignOutbound === true/);
  assert.match(readComposeScript(), /originalSentMail: getOriginalSentMail\(mail\)/);
});

test('voorgestelde reactie is per composevenster maar één keer beschikbaar', () => {
  const button = { hidden: true, disabled: true, textContent: '' };
  const documentRef = { querySelector: () => button };

  composeModule.reset(true, documentRef);
  assert.equal(button.hidden, false);
  assert.equal(button.textContent, 'Voorgestelde reactie');
  assert.equal(composeModule.isUsed(), false);

  composeModule.complete(button);
  composeModule.finish(button, 'Voorgestelde reactie');
  assert.equal(button.hidden, true);
  assert.equal(button.disabled, true);
  assert.equal(composeModule.isUsed(), true);

  composeModule.reset(true, documentRef);
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
  assert.equal(composeModule.isUsed(), false);
});

test('voorgestelde reactie geeft ontvangen én oorspronkelijke verzonden mail als context mee', () => {
  const context = composeModule.buildReplyContext({
    id: 'inbox:salon-tof',
    from: 'Salon TOF',
    email: 'info@salontof.nl',
    subject: 'Re: Kleine vraag',
    body: 'Met welk programma werk je? Wij hebben nu Webflow.',
    folder: 'inbox',
    threadMessages: [
      {
        id: 'sent:follow-up',
        folder: 'sent',
        date: '2026-06-08T10:00:00.000Z',
        body: 'Korte follow-up.',
      },
      {
        id: 'sent:original',
        folder: 'sent',
        date: '2026-06-04T10:00:00.000Z',
        subject: 'Kleine vraag over je website',
        body: 'Ik heb een fris webdesign voor je gemaakt.',
        originalCampaignOutbound: true,
      },
    ],
  }, {
    activeFolder: 'outreach',
    fallbackAccount: 'serve@softora.nl',
    getAccount: (_mail, fallback) => fallback,
  });

  assert.equal(context.body, 'Met welk programma werk je? Wij hebben nu Webflow.');
  assert.equal(context.originalSentMail.id, 'sent:original');
  assert.equal(context.originalSentMail.body, 'Ik heb een fris webdesign voor je gemaakt.');
  assert.equal(context.accountEmail, 'serve@softora.nl');
  assert.equal(context.mode, 'reply');
});

test('nieuw bericht vanuit BCC-context gebruikt de bewezen afzender en echte ontvanger zonder antwoordprompt', () => {
  const context = composeModule.buildNewMessageContext({
    id: 'serve@softora.nl|inbox:107',
    accountEmail: 'serve@softora.nl',
    subject: 'Re: Kleine vraag over jullie website',
    copyContext: {
      evidenceKnown: true,
      kind: 'bcc',
      sourceAccountEmail: 'martijn@softora.nl',
      recipientEmail: 'sandra@example.nl',
    },
  }, {
    latestMessage: {
      accountEmail: 'serve@softora.nl',
      subject: 'Re: Kleine vraag over jullie website',
    },
    fallbackAccount: 'serve@softora.nl',
  });

  assert.deepEqual(context, {
    id: 'serve@softora.nl|inbox:107',
    mailboxId: 'serve@softora.nl|inbox:107',
    conversationId: '',
    accountEmail: 'martijn@softora.nl',
    to: 'sandra@example.nl',
    subject: 'Re: Kleine vraag over jullie website',
    mode: 'new-message',
  });
});

test('compose voegt uitsluitend gekozen veilige bijlagen toe en kan ze verwijderen', async () => {
  const elements = new Map([
    ['c-attachment-list', { innerHTML: '' }],
    ['c-copy-fields', { hidden: false }],
    ['c-cc', { value: 'cc@example.nl' }],
    ['c-bcc', { value: 'bcc@example.nl' }],
    ['c-attachments', { value: 'selected' }],
  ]);
  const documentRef = {
    getElementById: (id) => elements.get(id) || null,
  };
  composeModule.resetOptionalFields(documentRef);
  const result = await composeModule.addAttachments([{
    name: 'voorstel.pdf',
    type: 'application/pdf',
    size: 8,
    arrayBuffer: async () => Uint8Array.from([100, 111, 99, 117, 109, 101, 110, 116]).buffer,
  }], documentRef);

  assert.equal(result.ok, true);
  assert.equal(composeModule.getAttachments().length, 1);
  assert.equal(composeModule.getAttachments()[0].filename, 'voorstel.pdf');
  assert.match(elements.get('c-attachment-list').innerHTML, /voorstel\.pdf/);
  composeModule.removeAttachment(0, documentRef);
  assert.deepEqual(composeModule.getAttachments(), []);

  const blocked = await composeModule.addAttachments([{
    name: 'factuur.exe',
    type: 'application/octet-stream',
    size: 4,
    arrayBuffer: async () => new ArrayBuffer(4),
  }], documentRef);
  assert.equal(blocked.ok, false);
  assert.deepEqual(composeModule.getAttachments(), []);
});

test('compose toont optionele CC BCC en bijlagen maar verstuurt niets automatisch', () => {
  const pageSource = readPage();
  const composeControllerSource = readComposeControllerScript();
  assert.match(pageSource, /data-mailbox-action="toggle-copy-fields"/);
  assert.match(pageSource, /id="c-cc"/);
  assert.match(pageSource, /id="c-bcc"/);
  assert.match(pageSource, /id="c-attachments" multiple hidden/);
  assert.match(pageSource, /data-mailbox-action="choose-attachments"/);
  assert.match(pageSource, /\.compose-attach-button \{[^}]*display:\s*inline-flex;[^}]*flex:\s*0 0 auto;[^}]*align-items:\s*center;[^}]*gap:\s*8px;[^}]*border:\s*0;[^}]*background:\s*transparent;/);
  assert.match(pageSource, /\.compose-attach-button svg \{[^}]*width:\s*15px;[^}]*stroke:\s*currentColor/);
  assert.match(pageSource, /<button class="compose-attach-button"[^>]*>[\s\S]*<svg[^>]*aria-hidden="true"[\s\S]*<span>Bijlage toevoegen<\/span>/);
  assert.doesNotMatch(pageSource, /📎 Bijlage toevoegen/);
  assert.doesNotMatch(pageSource, /\.compose-attach-button:hover\s*\{/);
  assert.match(composeControllerSource, /cc: fieldValue\('c-cc'\)/);
  assert.match(composeControllerSource, /bcc: fieldValue\('c-bcc'\)/);
  assert.match(composeControllerSource, /const attachments = options\.compose\.getAttachments\(\)/);
  assert.match(composeControllerSource, /attachments,/);
  assert.match(composeControllerSource, /action === 'send-mail'[\s\S]*void send\(\)/);
});

test('geaccepteerde reply verschijnt direct roze en dedupliceert met vertraagde providersync', async () => {
  const productionMailbox = loadMailboxHelpersForTest();
  await productionMailbox.ready;
  const elements = new Map();
  function element(id, value = '') {
    const node = {
      id,
      value,
      textContent: id === 'send-button' ? 'Versturen' : '',
      disabled: false,
      hidden: false,
      attributes: {},
      classList: { add() {}, remove() {} },
      setAttribute(name, attrValue) { this.attributes[name] = attrValue; },
      removeAttribute(name) { delete this.attributes[name]; },
      addEventListener() {},
    };
    elements.set(id, node);
    return node;
  }
  element('c-to', 'ontvanger@example.nl');
  element('c-subject', 'Re: Kleine vraag over jullie website');
  element('c-body', 'Dankjewel voor je reactie 😁');
  element('c-cc', '');
  element('c-bcc', '');
  element('compose-overlay');
  const sendButton = element('send-button');
  const documentRef = {
    getElementById: (id) => elements.get(id) || null,
    querySelector: (selector) => selector === '.btn-send' ? sendButton : null,
  };
  let resolveSend;
  const fetchImpl = () => new Promise((resolve) => { resolveSend = resolve; });
  const rootMail = {
    id: 'serve@softora.nl|inbox:blue-monkey',
    mailboxId: 'inbox:blue-monkey',
    conversationId: 'conversation:serve@softora.nl|blue-monkey',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    email: 'ontvanger@example.nl',
    subject: 'Re: Kleine vraag over jullie website',
    messageId: '<blue-monkey-inbound@example.nl>',
    receivedAt: '2026-08-05T10:00:00.000Z',
    activityAt: '2026-08-05T10:00:00.000Z',
    unread: false,
    threadMessages: [],
  };
  const accepted = [];
  const composeStub = {
    buildReplyContext: (mail) => ({ ...mail, mode: 'reply' }),
    resetOptionalFields() {}, reset() {}, getAttachments: () => [], isUsed: () => false,
  };
  const controller = composeControllerModule.create({
    document: documentRef,
    fetch: fetchImpl,
    compose: composeStub,
    campaignInbox: {
      getMessageOwner: () => 'serve',
      getOwnerLabel: () => 'Servé Creusen',
      isPersonalOwner: (owner) => owner === 'serve' || owner === 'martijn',
    },
    display: {
      getReplyToAddress: () => 'ontvanger@example.nl',
      formatDetailSubject: (value) => value,
    },
    getActiveFolder: () => 'outreach',
    getAccount: () => 'serve@softora.nl',
    getOwner: () => 'serve',
    findMail: () => rootMail,
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeAcceptedMessage: (message) => productionMailbox.normalizeMailboxApiMessage(message, {
      folder: 'sent',
      skipAcceptedReconcile: true,
    }),
    onAcceptedSend: (record) => accepted.push(record),
    composeWindow: { reset() {} },
    toast() {},
  });
  controller.reply(rootMail);
  elements.get('c-body').value = 'Dankjewel voor je reactie 😁';
  const pending = controller.send();
  assert.equal(sendButton.disabled, true);
  assert.equal(sendButton.textContent, 'Versturen…');
  assert.equal(sendButton.attributes['aria-busy'], 'true');

  resolveSend({
    ok: true,
    json: async () => ({
      ok: true,
      result: {
        messageId: '<accepted-blue-monkey@softora.nl>',
        sentMessage: {
          messageId: '<accepted-blue-monkey@softora.nl>',
          receivedAt: '2026-08-05T10:01:00.000Z',
        },
      },
    }),
  });
  await pending;
  assert.equal(accepted.length, 1);
  assert.equal(sendButton.disabled, false);
  assert.equal(sendButton.textContent, 'Versturen');
  controller.reconcile(rootMail);
  assert.equal(rootMail.threadMessages.length, 1);
  assert.equal(rootMail.threadMessages[0].folder, 'sent');
  assert.equal(rootMail.threadMessages[0].body, 'Dankjewel voor je reactie 😁');
  assert.equal(rootMail.threadMessages[0].localAcceptedSend, true);
  assert.ok(rootMail.threadMessages[0].softoraClientSendIdempotencyKey);
  assert.equal(rootMail.replyDismissedAt, accepted[0].acceptedAt);
  assert.equal(rootMail.activityAt, '2026-08-05T10:01:00.000Z');
  assert.equal(rootMail.latestOutboundAt, '2026-08-05T10:01:00.000Z');

  const refreshed = {
    ...rootMail,
    threadMessages: [{
      ...rootMail.threadMessages[0],
      id: 'sent:provider-import',
      mailboxId: 'sent:provider-import',
      localAcceptedSend: false,
    }],
  };
  controller.reconcile(refreshed);
  assert.equal(refreshed.threadMessages.length, 1);

  const otherOwner = {
    ...rootMail,
    id: 'martijn@softora.nl|inbox:blue-monkey',
    mailboxId: 'inbox:martijn-blue-monkey',
    conversationId: rootMail.conversationId,
    accountEmail: 'martijn@softora.nl',
    threadMessages: [],
  };
  controller.reconcile(otherOwner);
  assert.equal(otherOwner.threadMessages.length, 0);

  controller.reply(rootMail);
  elements.get('c-body').value = 'Tweede providerbevestiging.';
  const malformedPending = controller.send();
  resolveSend({
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return ({
          'x-softora-send-intent-id': 'send:production-normalizer',
          'x-softora-message-id': '<provider-production-normalizer@example.nl>',
        })[String(name).toLowerCase()] || null;
      },
    },
    json: async () => { throw new SyntaxError('onleesbare productiebody'); },
  });
  await malformedPending;
  controller.reconcile(rootMail);
  const localAccepted = rootMail.threadMessages.find(
    (message) => message.softoraSendIntentId === 'send:production-normalizer'
  );
  assert.ok(localAccepted, 'de productie-normalizer moet de responseheaderidentiteit bewaren');
  assert.equal(localAccepted.localAcceptedSend, true);
  assert.equal(localAccepted.localAcceptedSendFallback, false);
  assert.equal(localAccepted.messageId, '<provider-production-normalizer@example.nl>');
  assert.ok(localAccepted.softoraClientSendIdempotencyKey);
  assert.equal(localAccepted.softoraConversationId, rootMail.conversationId);
  assert.equal(localAccepted.softoraReplyTargetMessageId, rootMail.messageId);

  const providerCopy = productionMailbox.normalizeMailboxApiMessage({
    id: 'sent:provider-production-normalizer',
    mailboxId: 'sent:provider-production-normalizer',
    folder: 'sent', storageFolder: 'sent', direction: 'sent',
    accountEmail: rootMail.accountEmail,
    from: 'Servé Creusen', email: rootMail.accountEmail,
    to: rootMail.email, subject: rootMail.subject,
    body: 'Tweede providerbevestiging.',
    receivedAt: localAccepted.receivedAt,
    messageId: '<provider-production-normalizer@example.nl>',
    conversationId: rootMail.conversationId,
    softoraConversationId: rootMail.conversationId,
    softoraSendMode: 'reply',
    softoraSendIntentId: 'send:production-normalizer',
    softoraReplyTargetMessageId: rootMail.messageId,
    recipientRoutingEvidenceKnown: true,
  }, { folder: 'sent', skipAcceptedReconcile: true });
  rootMail.threadMessages.push(providerCopy);
  controller.reconcile(rootMail);
  assert.equal(rootMail.threadMessages.includes(providerCopy), true);
  assert.equal(rootMail.threadMessages.some((message) => (
    message.localAcceptedSend === true &&
    message.softoraSendIntentId === 'send:production-normalizer'
  )), false);
});

test('send-ack werkt contacttijdlijn, lijstactiviteit en exact replytarget atomisch bij', async () => {
  const order = [];
  const writes = [];
  const inbound = {
    id: 'martijn@softora.nl|inbox:58', mailboxId: 'inbox:58', uid: 58,
    folder: 'inbox', accountEmail: 'martijn@softora.nl', owner: 'martijn',
    messageKey: 'martijn@softora.nl|inbox|gen:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|58',
    messageId: '<inbound-58@example.test>',
    receivedAt: '2026-08-08T10:12:00.000Z', unread: false, replyDismissedAt: '',
  };
  const root = {
    id: 'contact:both:inkoop-seniorenwinkel', accountEmail: 'martijn@softora.nl', owner: 'martijn',
    activityAt: inbound.receivedAt, latestInboundAt: inbound.receivedAt,
    threadMessages: [inbound],
  };
  const getConversationAction = (mail) => {
    const latest = [mail, ...(mail.threadMessages || [])]
      .filter((message) => message.receivedAt)
      .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))[0];
    return latest?.direction === 'sent'
      ? { kind: 'new-message', message: latest, isRoot: latest === mail }
      : { kind: 'reply', message: latest, isRoot: latest === mail };
  };
  const outbox = {
    subscribe() {},
    async enqueue(payload, metadata) {
      order.push('handled-outbox');
      writes.push({ payload, metadata });
      return { ok: true, pending: true, record: { mutationId: 'accepted-send-handled-1' } };
    },
  };
  const readController = readModule.create({
    outbox,
    getAccount: (message) => message.accountEmail,
    getFolder: (message) => message.folder,
    getOwner: (message) => message.owner,
    getRequestId: (message) => message.id,
    getConversationAction,
  });
  const composeController = {
    reconcile(mail) {
      order.push('optimistic-card');
      if (!mail.threadMessages.some((message) => message.messageId === '<accepted-inkoop@softora.nl>')) {
        mail.threadMessages.push({
          id: 'accepted-sent:inkoop', folder: 'sent', direction: 'sent',
          accountEmail: 'martijn@softora.nl', owner: 'martijn',
          messageId: '<accepted-inkoop@softora.nl>', receivedAt: '2026-08-18T11:14:16.000Z',
        });
      }
      mail.latestOutboundAt = '2026-08-18T11:14:16.000Z';
      mail.activityAt = mail.latestOutboundAt;
      return mail;
    },
  };
  let renderCount = 0;
  let openCount = 0;
  const completion = uiStateModule.completeAcceptedSend({
    record: {
      mode: 'reply', sourceMailId: root.id,
      replyTarget: { ...inbound },
    },
    mails: [root],
    composeController,
    readController,
    findMail: (id) => id === root.id ? root : null,
    renderList: () => { renderCount += 1; },
    getActiveMail: () => root.id,
    openMail: () => { openCount += 1; },
  });

  assert.deepEqual(order, ['handled-outbox', 'optimistic-card']);
  assert.equal(root.threadMessages.length, 2);
  assert.equal(root.threadMessages.filter((message) => message.direction === 'sent').length, 1);
  assert.equal(root.activityAt, '2026-08-18T11:14:16.000Z');
  assert.ok(inbound.replyDismissedAt);
  assert.equal(inbound.replyDismissPending, true);
  assert.equal(renderCount, 1);
  assert.equal(openCount, 1);
  assert.equal((await completion.handledPromise).pending, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].payload.id, inbound.id);
  assert.equal(writes[0].payload.uid, 58);
  assert.equal(writes[0].payload.messageKey, inbound.messageKey);
  assert.equal(writes[0].payload.messageId, inbound.messageId);
  assert.equal(writes[0].payload.dismissReply, true);
});

test('gecombineerde mailbox verstuurt via het concrete account en niet met owner both', async () => {
  const elements = new Map();
  function element(id, value = '') {
    const node = {
      id,
      value,
      textContent: id === 'send-button' ? 'Versturen' : '',
      disabled: false,
      attributes: {},
      classList: { add() {}, remove() {} },
      setAttribute(name, next) { this.attributes[name] = next; },
      removeAttribute(name) { delete this.attributes[name]; },
    };
    elements.set(id, node);
    return node;
  }
  element('c-to', 'lead@example.nl');
  element('c-subject', 'Re: Vraag');
  element('c-body', 'Antwoord');
  element('c-cc', '');
  element('c-bcc', '');
  element('compose-overlay');
  const sendButton = element('send-button');
  const requests = [];
  const mail = {
    id: 'serve@softora.nl|inbox:owner-canonical',
    accountEmail: 'serve@softora.nl',
    email: 'lead@example.nl',
    subject: 'Vraag',
    threadMessages: [],
  };
  const controller = composeControllerModule.create({
    document: {
      getElementById: (id) => elements.get(id) || null,
      querySelector: (selector) => selector === '.btn-send' ? sendButton : null,
    },
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ ok: true, result: { messageId: '<owner-canonical@softora.nl>' } }) };
    },
    compose: {
      buildReplyContext: (value) => ({ id: value.id, accountEmail: value.accountEmail, mode: 'reply' }),
      resetOptionalFields() {}, reset() {}, getAttachments: () => [], isUsed: () => false,
    },
    campaignInbox: {
      getAccount: (value) => value.accountEmail,
      getOwnerByAccount: (value) => value === 'serve@softora.nl' ? 'serve' : '',
      getMessageOwner: () => '',
      getOwnerLabel: () => 'Servé Creusen',
      isPersonalOwner: (value) => value === 'serve' || value === 'martijn',
    },
    display: { getReplyToAddress: () => mail.email, formatDetailSubject: (value) => value },
    getActiveFolder: () => 'outreach',
    getAccount: () => 'serve@softora.nl',
    getOwner: () => 'both',
    findMail: () => mail,
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    composeWindow: { reset() {} },
    toast() {},
  });

  controller.reply(mail);
  await controller.send();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].owner, 'serve');
  assert.equal(requests[0].account, 'serve@softora.nl');
});

test('reply normaliseert een stale sender naar de bewezen thread-account en weigert een verkeerde owner', async () => {
  assert.equal(
    campaignInboxModule.resolveReplyAccount(
      { accountEmail: 'serve@softora.nl', email: 'bestuur@example.nl' },
      'martijn@softora.nl',
      'both'
    ),
    'serve@softora.nl'
  );
  assert.equal(
    campaignInboxModule.resolveReplyAccount(
      { accountEmail: 'serve@softora.nl', email: 'bestuur@example.nl' },
      'martijn@softora.nl',
      'serve'
    ),
    'serve@softora.nl'
  );
  assert.equal(
    campaignInboxModule.resolveReplyAccount(
      { accountEmail: 'martijn@softora.nl', email: 'bestuur@example.nl' },
      'serve@softora.nl',
      'serve'
    ),
    ''
  );
  assert.equal(
    campaignInboxModule.resolveReplyAccount(
      { providerOwner: 'serve', email: 'bestuur@example.nl' },
      'martijn@softora.nl',
      'both'
    ),
    ''
  );
  assert.equal(
    campaignInboxModule.resolveReplyAccount(
      {
        provider: 'instantly',
        providerOwner: 'serve',
        providerAccountEmail: 'servecreusen@websoftora.com',
        accountEmail: 'serve@softora.nl',
        email: 'bestuur@mhcbe.nl',
      },
      'martijn@softora.nl',
      'both'
    ),
    'servecreusen@websoftora.com'
  );
  assert.equal(
    campaignInboxModule.resolveReplyAccount(
      {
        provider: 'instantly',
        providerOwner: 'serve',
        providerAccountEmail: 'servecreusen@websoftora.com',
        accountEmail: 'serve@softora.nl',
      },
      'serve@softora.nl',
      'martijn'
    ),
    ''
  );
  assert.equal(
    campaignInboxModule.resolveReplyAccount(
      { provider: 'instantly', providerOwner: 'serve', accountEmail: 'serve@softora.nl' },
      'serve@softora.nl',
      'both'
    ),
    ''
  );
});

test('voorgestelde Instantly-reactie gebruikt providerprovenance zonder een send-effect', async () => {
  const fields = new Map();
  ['c-to', 'c-subject', 'c-body', 'compose-overlay'].forEach((id) => {
    fields.set(id, {
      value: '', textContent: '', disabled: false,
      classList: { add() {}, remove() {} },
      setAttribute() {}, removeAttribute() {}, addEventListener() {},
    });
  });
  const rewriteButton = { textContent: 'Voorgestelde reactie', disabled: false };
  const sendButton = { disabled: false };
  const requests = [];
  const loadedProfiles = [];
  const mail = {
    id: 'servecreusen@websoftora.com|instantly:message-1',
    mailboxId: 'instantly:message-1',
    accountEmail: 'serve@softora.nl',
    provider: 'instantly',
    providerOwner: 'serve',
    providerAccountEmail: 'servecreusen@websoftora.com',
    providerMessageId: 'message-1',
    providerThreadId: 'thread-1',
    email: 'bestuur@mhcbe.nl',
    from: 'Bestuur MHCBE',
    subject: 'Re: Kleine vraag over jullie website',
    body: 'Bedankt voor jullie bericht.',
    folder: 'instantly',
  };
  const controller = composeControllerModule.create({
    document: {
      getElementById: (id) => fields.get(id) || null,
      querySelector: (selector) => selector === '[data-mailbox-action="rewrite-compose"]'
        ? rewriteButton
        : (selector === '.btn-send' ? sendButton : null),
    },
    fetch: async (url, options) => {
      requests.push({ url, payload: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ ok: true, text: 'Veilige voorgestelde reactie.' }) };
    },
    loadSenderProfile: async (account) => {
      loadedProfiles.push(account);
      return { name: 'Servé Creusen' };
    },
    compose: {
      buildReplyContext: composeModule.buildReplyContext,
      resetOptionalFields() {}, reset() {}, getAttachments: () => [], isUsed: () => false,
      complete() {}, finish() {},
    },
    campaignInbox: campaignInboxModule,
    display: {
      getReplyToAddress: () => mail.email,
      formatDetailSubject: (value) => value,
    },
    getActiveFolder: () => 'outreach',
    getAccount: () => 'martijn@softora.nl',
    getOwner: () => 'both',
    findMail: () => mail,
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    composeWindow: { reset() {} },
    toast() {},
  });

  controller.reply(mail);
  await controller.rewrite();

  assert.deepEqual(loadedProfiles, ['servecreusen@websoftora.com']);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/mailbox/rewrite');
  assert.equal(requests.some((request) => request.url === '/api/mailbox/send'), false);
  assert.equal(requests[0].payload.account, 'servecreusen@websoftora.com');
  assert.equal(requests[0].payload.context.accountEmail, 'servecreusen@websoftora.com');
  assert.equal(requests[0].payload.context.providerAccountEmail, 'servecreusen@websoftora.com');
  assert.equal(requests[0].payload.context.providerOwner, 'serve');
  assert.equal(requests[0].payload.context.providerMessageId, 'message-1');
  assert.equal(requests[0].payload.context.providerThreadId, 'thread-1');
  assert.equal(fields.get('c-body').value, 'Veilige voorgestelde reactie.');
});

test('mislukte reply voegt geen roze bericht toe en herstelt de composer exact', async () => {
  const fields = new Map();
  ['c-to', 'c-subject', 'c-body', 'c-cc', 'c-bcc', 'compose-overlay'].forEach((id) => {
    fields.set(id, {
      value: id === 'c-to' ? 'ontvanger@example.nl' : id === 'c-subject' ? 'Re: Vraag' : id === 'c-body' ? 'Antwoord' : '',
      textContent: '', disabled: false, attributes: {}, hidden: false,
      classList: { add() {}, remove() {} }, setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; }, addEventListener() {},
    });
  });
  const sendButton = { textContent: 'Versturen', disabled: false, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; } };
  const accepted = [];
  const mail = { id: 'inbox:failed', accountEmail: 'serve@softora.nl', email: 'ontvanger@example.nl', subject: 'Re: Vraag', threadMessages: [] };
  const controller = composeControllerModule.create({
    document: { getElementById: (id) => fields.get(id), querySelector: (selector) => selector === '.btn-send' ? sendButton : null },
    fetch: async () => ({ ok: false, status: 503, json: async () => ({ error: 'Tijdelijk niet bereikbaar' }) }),
    compose: { buildReplyContext: () => ({ id: mail.id, accountEmail: mail.accountEmail, mode: 'reply' }), resetOptionalFields() {}, reset() {}, getAttachments: () => [] },
    campaignInbox: { getMessageOwner: () => 'serve', getOwnerLabel: () => 'Servé Creusen', isPersonalOwner: () => true },
    display: { getReplyToAddress: () => mail.email, formatDetailSubject: (value) => value },
    getActiveFolder: () => 'outreach', getAccount: () => mail.accountEmail, getOwner: () => 'serve',
    findMail: () => mail, normalizeEmail: (value) => String(value || '').toLowerCase(),
    onAcceptedSend: (record) => accepted.push(record), composeWindow: { reset() {} }, toast() {},
  });
  controller.reply(mail);
  fields.get('c-body').value = 'Antwoord';
  await controller.send();
  assert.equal(accepted.length, 0);
  assert.equal(mail.threadMessages.length, 0);
  assert.equal(sendButton.disabled, false);
  assert.equal(sendButton.textContent, 'Versturen');
  assert.equal(fields.get('c-body').value, 'Antwoord');
});

test('premium mailbox bewaart gelezen status optimistisch zonder mailboxreload', () => {
  const scriptSource = readScript();
  const stabilitySource = readDetailStabilityScript();
  const readSource = readReadScript();
  const uiStateSource = readUiStateScript();

  assert.match(scriptSource, /uid: message\.uid,/);
  assert.match(readSource, /async function persist\(mail, persistOptions = \{\}\) \{[\s\S]*\/api\/mailbox\/messages\/read/);
  assert.match(readSource, /const payload = \{[\s\S]*account,[\s\S]*id: requestId,[\s\S]*uid: mail\.uid,[\s\S]*folder:/);
  assert.match(readSource, /stateOutbox\.enqueue\(payload,\s*\{/);
  assert.match(readSource, /async function markRead\(mail, hooks = \{\}\) \{[\s\S]*const targets = getConversationTargets\(mail\)[\s\S]*target\.unread = false;[\s\S]*target\.readPending = true;[\s\S]*const outcome = await persist\(mail, \{/);
  assert.match(readSource, /function setFailure\([\s\S]*target\.unread = previous\.unread;[\s\S]*target\.readError =/);
  assert.match(readSource, /function applyConfirmedState\(mail\)[\s\S]*mail\.unread = false/);
  assert.doesNotMatch(readSource, /loadMailboxMessages|campaign-replies/);
  assert.match(scriptSource, /onSelect: \(mail, openOptions\) => \{ if \(mail\.unread\) window\.SoftoraMailboxUiState\.markReadOnOpen\(/);
  assert.match(scriptSource, /const scrollWrap = document\.getElementById\('mail-results-scroll'\) \|\| wrap;[\s\S]*const listScrollTop = Number\.isFinite\(Number\(scrollWrap\.scrollTop\)\)/);
  assert.match(stabilitySource, /const scrollTop = previousBody && Number\.isFinite\(Number\(previousBody\.scrollTop\)\)/);
  assert.match(uiStateSource, /class="detail-mark-read[\s\S]*is-pending[\s\S]*aria-busy=/);
  assert.match(uiStateSource, /data-mailbox-action="retry-read"/);
  assert.match(readSource, /Gelezen status opslaan mislukt/);
});

test('All Mail-root verstuurt na contacttijdlijnmerge nooit een half-Inbox gelezenpayload', async () => {
  const writes = [];
  const outbox = {
    subscribe() {},
    async enqueue(payload, metadata) {
      writes.push({ payload, metadata });
      return { ok: true, pending: true, record: { mutationId: 'allmail-413-read' } };
    },
  };
  const root = {
    id: 'allmail:413', mailboxId: 'allmail:413', uid: 413,
    folder: 'allmail', storageFolder: 'allmail', accountEmail: 'contact.venvisuals@gmail.com',
    owner: 'martijn', canonicalOwner: 'martijn',
    messageKey: 'contact.venvisuals@gmail.com|allmail|gen:9460a489-cfec-4dbd-aea2-512f74ed755a|413',
    messageId: '<same-message@example.test>', email: 'praktijk@example.nl',
    to: 'contact.venvisuals@gmail.com', externalContactEmail: 'praktijk@example.nl', unread: true,
  };
  discoveryModule.mergeContactTimeline(root, [{
    ...root,
    id: 'inbox:151', mailboxId: 'inbox:151', uid: 151, folder: 'inbox', storageFolder: 'inbox',
    messageKey: 'contact.venvisuals@gmail.com|inbox|gen:af529f3c-36f9-4a70-afba-938186189917|151',
  }], 'praktijk@example.nl', 1, {
    accountEmails: ['contact.venvisuals@gmail.com'], canonicalOwner: 'martijn',
    getMessageOwner: () => 'martijn',
  });
  const controller = readModule.create({
    outbox,
    getAccount: (mail) => mail.accountEmail,
    getFolder: (mail) => mail.folder,
    getOwner: (mail) => mail.owner,
    getRequestId: (mail) => mail.id,
  });

  const result = await controller.markRead(root, { render() {} });

  assert.equal(result.pending, true);
  assert.equal(writes.length, 1);
  assert.deepEqual({
    id: writes[0].payload.id,
    folder: writes[0].payload.folder,
    uid: writes[0].payload.uid,
    messageKey: writes[0].payload.messageKey,
  }, {
    id: 'allmail:413',
    folder: 'allmail',
    uid: 413,
    messageKey: 'contact.venvisuals@gmail.com|allmail|gen:9460a489-cfec-4dbd-aea2-512f74ed755a|413',
  });
});

test('gelezen status blijft direct stabiel bij traag succes, stale cache en paginaverversing', async () => {
  let resolveRequest;
  const renders = [];
  const createController = (fetchImpl) => readModule.create({
    fetch: fetchImpl,
    getAccount: (mail) => mail.accountEmail,
    getFolder: (mail) => mail.folder,
    getOwner: (mail) => mail.owner,
    getRequestId: (mail) => mail.id,
  });
  const controller = createController(() => new Promise((resolve) => { resolveRequest = resolve; }));
  const mail = {
    id: 'instantly:reply-1',
    folder: 'instantly',
    accountEmail: 'servecreusen@websoftora.com',
    owner: 'serve',
    messageKey: 'instantly|reply-1',
    messageId: '<reply-1@example.test>',
    provider: 'instantly',
    providerMessageId: 'reply-1',
    unread: true,
  };

  const request = controller.markRead(mail, { render: () => renders.push({ unread: mail.unread, pending: mail.readPending }) });
  assert.equal(mail.unread, false);
  assert.equal(mail.readPending, true);
  assert.deepEqual(renders[0], { unread: false, pending: true });
  const rapidOwnerSwitch = { ...mail, owner: 'martijn', unread: true, readPending: false };
  controller.reconcile(rapidOwnerSwitch);
  assert.equal(rapidOwnerSwitch.unread, true);
  resolveRequest({ ok: true, json: async () => ({ ok: true, result: { unread: false } }) });
  assert.equal((await request).ok, true);
  assert.equal(mail.readPending, false);
  assert.equal(mail.unread, false);
  controller.reconcile(rapidOwnerSwitch);
  assert.equal(rapidOwnerSwitch.unread, true);

  const staleRefresh = { ...mail, unread: true, readPending: false, softoraReadConfirmed: false };
  controller.reconcile(staleRefresh);
  assert.equal(staleRefresh.unread, false);
  assert.equal(staleRefresh.softoraReadConfirmed, true);

  const afterPageRefresh = { ...mail, unread: false, softoraReadAt: new Date().toISOString(), softoraReadConfirmed: false };
  createController(async () => ({ ok: true, json: async () => ({ ok: true }) })).reconcile(afterPageRefresh);
  assert.equal(afterPageRefresh.unread, false);
  assert.equal(afterPageRefresh.softoraReadConfirmed, true);
});

test('duurzame serverstaat wint exact van een terminal outboxfout zonder dismiss te raden', () => {
  function createFailedCase({ dismissReply }) {
    let listener = null;
    const confirmations = [];
    const identity = {
      id: 'inbox:151', owner: 'martijn', account: 'contact.venvisuals@gmail.com', folder: 'inbox',
      messageKey: 'contact.venvisuals@gmail.com|inbox|gen:af529f3c-36f9-4a70-afba-938186189917|151',
      messageId: '<same-message@example.test>', provider: 'imap', providerMessageId: 'inbox:151',
    };
    const record = {
      mutationId: `failed-${dismissReply ? 'dismiss' : 'read'}`,
      resourceKey: `message-key:martijn|${identity.account}|${identity.messageKey}`,
      identity, identities: [identity], unread: false, dismissReply,
      previous: { unread: true, replyDismissedAt: '' },
      errorMessage: 'Deze mailboxstatus kan niet worden opgeslagen.',
    };
    const outbox = {
      subscribe(next) { listener = next; },
      confirmDurable(failedRecord, result) {
        confirmations.push({ failedRecord, result });
        return Promise.resolve(true);
      },
    };
    const controller = readModule.create({
      outbox,
      getAccount: (mail) => mail.accountEmail,
      getFolder: (mail) => mail.folder,
      getOwner: (mail) => mail.owner,
      getRequestId: (mail) => mail.id,
    });
    listener({ type: 'failed', record, message: record.errorMessage });
    const mail = {
      id: identity.id, owner: identity.owner, accountEmail: identity.account, folder: identity.folder,
      messageKey: identity.messageKey, messageId: identity.messageId,
      provider: identity.provider, providerMessageId: identity.providerMessageId,
      unread: true, replyDismissedAt: '',
    };
    return { confirmations, controller, mail, record };
  }

  const readCase = createFailedCase({ dismissReply: false });
  readCase.mail.readAt = '2026-08-18T14:46:48.499Z';
  readCase.controller.reconcile(readCase.mail);
  assert.equal(readCase.mail.unread, false);
  assert.equal(readCase.mail.readError, '');
  assert.equal(readCase.mail.softoraReadConfirmed, true);
  assert.equal(readCase.confirmations.length, 1);

  const dismissCase = createFailedCase({ dismissReply: true });
  dismissCase.mail.replyDismissedAt = '2026-08-18T14:46:48.499Z';
  dismissCase.controller.reconcile(dismissCase.mail);
  assert.equal(dismissCase.mail.unread, false);
  assert.equal(dismissCase.mail.readError, '');
  assert.equal(dismissCase.mail.replyDismissedAt, '2026-08-18T14:46:48.499Z');
  assert.equal(dismissCase.confirmations.length, 1);

  const unconfirmedDismiss = createFailedCase({ dismissReply: true });
  unconfirmedDismiss.mail.readAt = '2026-08-18T14:46:48.499Z';
  unconfirmedDismiss.controller.reconcile(unconfirmedDismiss.mail);
  assert.equal(unconfirmedDismiss.mail.unread, true);
  assert.match(unconfirmedDismiss.mail.readError, /niet worden opgeslagen/i);
  assert.equal(unconfirmedDismiss.mail.replyDismissedAt, '');
  assert.equal(unconfirmedDismiss.confirmations.length, 0);
});

test('afhandelen blijft optimistic op gesprek en reply bij stale poll en vertraagde backend', async () => {
  let resolveRequest;
  let requestCount = 0;
  const latestReply = {
    id: 'inbox:reply-43', uid: 43, folder: 'inbox', accountEmail: 'serve@softora.nl', owner: 'serve',
    messageKey: 'serve@softora.nl|inbox|gen:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|43',
    messageId: '<reply-43@example.test>',
    date: '2026-08-04T15:00:00.000Z', unread: true, replyDismissedAt: '',
  };
  const mail = {
    id: 'inbox:conversation-42', uid: 42, folder: 'inbox', accountEmail: 'serve@softora.nl', owner: 'serve',
    messageKey: 'serve@softora.nl|inbox|gen:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|42',
    messageId: '<conversation-42@example.test>',
    date: '2026-08-04T14:00:00.000Z', unread: false, threadMessages: [latestReply],
  };
  const controller = readModule.create({
    getAccount: (message) => message.accountEmail,
    getFolder: (message) => message.folder,
    getOwner: (message) => message.owner,
    getRequestId: (message) => message.id,
    getConversationAction: (conversation) => ({ kind: 'reply', isRoot: false, message: conversation.threadMessages[0] }),
    fetch: async () => {
      requestCount += 1;
      return new Promise((resolve) => { resolveRequest = resolve; });
    },
  });

  const request = controller.dismissReply(mail, { render() {} });
  assert.equal(requestCount, 1);
  assert.equal(mail.unread, false);
  assert.equal(mail.readPending, true);
  assert.equal(latestReply.unread, false);
  assert.equal(latestReply.readPending, true);
  assert.equal(latestReply.replyDismissPending, true);
  const optimisticTimestamp = latestReply.replyDismissedAt;
  assert.ok(optimisticTimestamp);
  assert.equal((await controller.dismissReply(mail)).ok, false);
  assert.equal(requestCount, 1);

  const stale = {
    ...mail,
    unread: true,
    readPending: false,
    threadMessages: [{ ...latestReply, unread: true, readPending: false, replyDismissedAt: '' }],
  };
  controller.reconcile(stale);
  assert.equal(stale.unread, false);
  assert.equal(stale.readPending, true);
  assert.equal(stale.threadMessages[0].unread, false);
  assert.equal(stale.threadMessages[0].readPending, true);
  assert.equal(stale.threadMessages[0].replyDismissPending, true);
  assert.equal(stale.threadMessages[0].replyDismissedAt, optimisticTimestamp);

  resolveRequest({ ok: true, json: async () => ({ ok: true, result: { replyDismissedAt: '2026-08-04T15:10:00.000Z' } }) });
  assert.equal((await request).ok, true);
  assert.equal(mail.unread, false);
  assert.equal(mail.readPending, false);
  assert.equal(latestReply.readPending, false);
  assert.equal(latestReply.replyDismissPending, false);
  assert.equal(latestReply.replyDismissedAt, '2026-08-04T15:10:00.000Z');
  controller.reconcile(stale);
  assert.equal(stale.unread, false);
  assert.equal(stale.readPending, false);
  assert.equal(stale.threadMessages[0].replyDismissedAt, '2026-08-04T15:10:00.000Z');
  assert.equal(stale.threadMessages[0].replyDismissPending, false);
});

test('afhandelen rolt gesprek en reply eenmalig terug bij backendfout', async () => {
  const toasts = [];
  const latestReply = {
    id: 'inbox:reply-failed', uid: 51, folder: 'inbox', accountEmail: 'serve@softora.nl', owner: 'serve',
    messageKey: 'serve@softora.nl|inbox|gen:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|51',
    messageId: '<reply-failed@example.test>',
    unread: true, replyDismissedAt: '',
  };
  const mail = {
    id: 'inbox:conversation-failed', uid: 50, folder: 'inbox', accountEmail: 'serve@softora.nl', owner: 'serve',
    messageKey: 'serve@softora.nl|inbox|gen:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|50',
    messageId: '<conversation-failed@example.test>',
    unread: false, threadMessages: [latestReply],
  };
  const controller = readModule.create({
    getAccount: (message) => message.accountEmail,
    getFolder: (message) => message.folder,
    getOwner: (message) => message.owner,
    getRequestId: (message) => message.id,
    getConversationAction: (conversation) => ({ kind: 'reply', isRoot: false, message: conversation.threadMessages[0] }),
    fetch: async () => ({ ok: false, json: async () => ({ detail: 'Mailbox tijdelijk niet bereikbaar' }) }),
    toast: (message) => toasts.push(message),
  });

  const result = await controller.dismissReply(mail, { render() {} });
  assert.equal(result.ok, false);
  assert.equal(mail.unread, false);
  assert.equal(mail.readPending, false);
  assert.match(mail.readError, /Mailbox tijdelijk niet bereikbaar/);
  assert.equal(latestReply.unread, true);
  assert.equal(latestReply.readPending, false);
  assert.equal(latestReply.replyDismissPending, false);
  assert.equal(latestReply.replyDismissedAt, '');
  assert.match(latestReply.readError, /Mailbox tijdelijk niet bereikbaar/);
  assert.equal(toasts.filter((message) => /probeer opnieuw/.test(message)).length, 1);
});

test('late gelezen reactie opent geen oude mail opnieuw na navigatie', async () => {
  let activeMail = 'inbox:42';
  const opened = [];
  const rendered = [];
  const mail = { id: 'inbox:42' };
  let lateRender;

  const result = await uiStateModule.handleReadAction('mark-read', {
    mail,
    dismissReply: async (_mail, hooks) => {
      hooks.render();
      lateRender = hooks.render;
      activeMail = 'inbox:43';
      lateRender();
      return { ok: true };
    },
    renderList: () => rendered.push(activeMail),
    getActiveMail: () => activeMail,
    openMail: (id) => opened.push(id),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(opened, ['inbox:42']);
  assert.deepEqual(rendered, ['inbox:42', 'inbox:43']);
});

test('mislukte gelezen actie rolt exact terug en biedt een zichtbare retry', async () => {
  const toasts = [];
  const controller = readModule.create({
    fetch: async () => ({
      ok: false,
      json: async () => ({ detail: 'Database tijdelijk niet bereikbaar' }),
    }),
    getAccount: (mail) => mail.accountEmail,
    getFolder: (mail) => mail.folder,
    getOwner: (mail) => mail.owner,
    getRequestId: (mail) => mail.id,
    toast: (message) => toasts.push(message),
  });
  const mail = {
    id: 'inbox:42',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    owner: 'serve',
    messageKey: 'serve@softora.nl|inbox|gen:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|42',
    messageId: '<read-failed@example.test>',
    unread: true,
    replyDismissedAt: '',
  };

  const result = await controller.markRead(mail, { render() {} });

  assert.equal(result.ok, false);
  assert.equal(mail.unread, true);
  assert.equal(mail.readPending, false);
  assert.equal(mail.replyDismissedAt, '');
  assert.match(mail.readError, /Database tijdelijk niet bereikbaar/);
  assert.match(toasts[0], /probeer opnieuw/);
});

test('gelezen status is eigenaargebonden en synchroniseert bevestigd tussen tabs', async () => {
  const channels = new Set();
  class FakeBroadcastChannel {
    constructor(name) { this.name = name; this.listener = null; channels.add(this); }
    addEventListener(type, listener) { if (type === 'message') this.listener = listener; }
    postMessage(data) {
      channels.forEach((channel) => {
        if (channel !== this && channel.name === this.name && channel.listener) channel.listener({ data });
      });
    }
  }
  const baseOptions = {
    BroadcastChannel: FakeBroadcastChannel,
    getAccount: (mail) => mail.accountEmail,
    getFolder: (mail) => mail.folder,
    getOwner: (mail) => mail.owner,
    getRequestId: (mail) => mail.id,
  };
  let externalUpdates = 0;
  const second = readModule.create({ ...baseOptions, fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }), onExternalState: () => { externalUpdates += 1; } });
  const first = readModule.create({
    ...baseOptions,
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, result: { unread: false } }) }),
  });
  const serve = { id: 'instantly:same-id', folder: 'instantly', accountEmail: 'shared@example.nl', owner: 'serve', messageKey: 'instantly|same-id', messageId: '<same-id@example.test>', provider: 'instantly', providerMessageId: 'same-id', unread: true };
  const martijn = { ...serve, owner: 'martijn', unread: true };

  assert.equal((await first.markRead(serve, { render() {} })).ok, true);
  assert.equal(externalUpdates, 2);
  const staleServe = { ...serve, unread: true, softoraReadConfirmed: false };
  second.reconcile(staleServe);
  second.reconcile(martijn);
  assert.equal(staleServe.unread, false);
  assert.equal(martijn.unread, true);
});

test('premium mailbox verbergt alleen in Softora, biedt herstel en raakt geen bronmail-API', async () => {
  const scriptSource = readScript();
  const deleteSource = readDeleteScript();
  const logicalDeleteSource = readLogicalDeleteScript();

  assert.match(scriptSource, /mailboxDeleteController\.remove\(m,/);
  assert.match(scriptSource, /fetch: \(\.\.\.args\) => window\.fetch\(\.\.\.args\),/);
  assert.match(scriptSource, /optimistic\(\) \{[\s\S]*mails = mailboxDeleteController\.filterMessages\([\s\S]*mails\.filter\(mail => String\(mail\.id\) !== String\(id\)\)/);
  assert.match(scriptSource, /rollback\(_mail, transaction\) \{/);
  assert.match(scriptSource, /mails = mailboxDeleteController\.filterMessages\(/);
  assert.match(logicalDeleteSource, /return resolved\.reduce\(\(changed, message\) => \{[\s\S]*removeAndPublish\(message\)/);
  assert.match(scriptSource, /commit\(_mail, transaction\) \{ mailboxLogicalDeleteBridge\.commit\(\);/);
  assert.match(logicalDeleteSource, /const messages = options\.filterMessages\(options\.getMessages\(\)\);/);
  assert.match(scriptSource, /bindMessageDeletionSync\?\.\(\{/);
  assert.match(deleteSource, /hiddenMessageKeys\.add\(messageKey\);[\s\S]*hooks\.optimistic/);
  assert.match(deleteSource, /requestVisibility\(mail, 'hide'\)/);
  assert.match(deleteSource, /requestVisibility\(mail, 'restore'\)/);
  assert.doesNotMatch(deleteSource, /\/api\/mailbox\/messages\/delete|messageMove|\\\\Deleted|archive|instantly/i);
  assert.match(scriptSource, /label: 'Ongedaan maken'/);
  assert.match(scriptSource, /case 'delete-mail':[\s\S]*void deleteMail\(id\);/);

  let resolveRequest;
  const events = [];
  const requests = [];
  const deleted = {
    id: 'inbox:42',
    uid: 42,
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    threadMessages: [{ id: 'sent:7', uid: 7, folder: 'sent', accountEmail: 'serve@softora.nl' }],
  };
  const logicalSibling = { id: 'allmail:142', uid: 142, folder: 'allmail', accountEmail: 'serve@softora.nl' };
  const keptThread = { id: 'sent:8', uid: 8, folder: 'sent', accountEmail: 'serve@softora.nl' };
  const kept = {
    id: 'inbox:43', uid: 43, folder: 'inbox', accountEmail: 'serve@softora.nl',
    threadMessages: [logicalSibling, keptThread],
  };
  const controller = deleteModule.create({
    dialogs: { confirm: async () => true },
    fetch: async (url, options) => {
      requests.push([url, JSON.parse(options.body)]);
      if (url.endsWith('/hide')) return new Promise((resolve) => { resolveRequest = resolve; });
      return {
        ok: true,
        json: async () => ({
          ok: true,
          result: {
            resolvedMessages: [{
              accountEmail: 'serve@softora.nl', id: 'inbox:42', uid: 42, folder: 'inbox',
            }, {
              accountEmail: 'serve@softora.nl', id: 'allmail:142', uid: 142, folder: 'allmail',
            }],
          },
        }),
      };
    },
    getAccount: (mail) => mail.accountEmail,
    getFolder: (mail) => mail.folder,
    getRequestId: (mail) => mail.id,
    removeCached: () => events.push('cache'),
    toast: () => {},
  });
  const removal = controller.remove(deleted, {
    optimistic: () => events.push('optimistic'),
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['optimistic']);
  assert.deepEqual(controller.filterMessages([deleted, kept]), [kept]);

  resolveRequest({
    ok: true,
    json: async () => ({
      ok: true,
      result: {
        resolvedMessages: [{
          accountEmail: 'serve@softora.nl', id: 'inbox:42', uid: 42, folder: 'inbox',
        }, {
          accountEmail: 'serve@softora.nl', id: 'allmail:142', uid: 142, folder: 'allmail',
        }],
      },
    }),
  });
  assert.equal((await removal).ok, true);
  assert.deepEqual(events, ['optimistic', 'cache']);
  assert.deepEqual(controller.filterMessages([deleted, kept]), [{ ...kept, threadMessages: [keptThread] }]);
  assert.equal(requests[0][0], '/api/mailbox/messages/hide');
  assert.equal(requests[0][1].visibilityProtocol, 'atomic-contact-v1');
  assert.deepEqual(requests[0][1].messages, [
    { account: 'serve@softora.nl', folder: 'inbox', uid: 42, id: 'inbox:42' },
    { account: 'serve@softora.nl', folder: 'sent', uid: 7, id: 'sent:7' },
  ]);

  assert.equal((await controller.restore(deleted)).ok, true);
  assert.equal(requests[1][0], '/api/mailbox/messages/restore');
  assert.equal(requests[1][1].visibilityProtocol, 'atomic-contact-v1');
  assert.deepEqual(controller.filterMessages([deleted, kept]), [deleted, kept]);
});

test('premium mailbox gebruikt de nette dialoog ook wanneer die pas na de mailboxscripts initialiseert', async () => {
  const events = [];
  const mail = { id: 'inbox:42', uid: 42, folder: 'inbox', accountEmail: 'serve@softora.nl' };
  let dialogs;
  const controller = deleteModule.create({
    getDialogs: () => dialogs,
    confirm: () => {
      events.push('native-confirm');
      return false;
    },
    fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }),
    getAccount: (item) => item.accountEmail,
    getFolder: (item) => item.folder,
    getRequestId: (item) => item.id,
    toast: () => {},
  });
  dialogs = {
    confirm: async () => {
      events.push('softora-confirm');
      return true;
    },
  };

  const result = await controller.remove(mail, {
    optimistic: () => events.push('optimistic'),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(events, ['softora-confirm', 'optimistic']);
});

test('premium mailbox herstelt een optimistische verwijdering als de API faalt', async () => {
  const events = [];
  const mail = { id: 'inbox:42', uid: 42, folder: 'inbox', accountEmail: 'serve@softora.nl' };
  const controller = deleteModule.create({
    dialogs: { confirm: async () => true },
    fetch: async () => ({ ok: false, json: async () => ({ detail: 'Opslaan mislukt' }) }),
    getAccount: (item) => item.accountEmail,
    getFolder: (item) => item.folder,
    getRequestId: (item) => item.id,
    toast: () => {},
  });

  const result = await controller.remove(mail, {
    optimistic: () => events.push('optimistic'),
    rollback: () => events.push('rollback'),
  });

  assert.equal(result.ok, false);
  assert.deepEqual(events, ['optimistic', 'rollback']);
  assert.deepEqual(controller.filterMessages([mail]), [mail]);
});

test('premium mailbox ruimt technische mail-links op voor weergave', () => {
  const scriptSource = readScript();
  const imagesScriptSource = readImagesScript();

  assert.match(scriptSource, /function cleanMailboxText\(value\)/);
  assert.match(readDisplayScript(), /function isCidArtifactLine\(value\)/);
  assert.match(scriptSource, /function isMailboxReplyHeaderLine\(line\)/);
  assert.match(scriptSource, /function isMailboxOwnReplyHeaderLine\(line\)/);
  assert.match(scriptSource, /function buildMailboxBodySections\(value\)/);
  assert.match(scriptSource, /function renderMailboxInlineImage\(image\)/);
  assert.match(scriptSource, /function renderMailboxTextLine\(line, options\)/);
  assert.match(readDisplayScript(), /function isGeneratedImageDescriptionLine\(value\)/);
  assert.match(scriptSource, /function isMailboxSafeOptOutUrl\(value\)/);
  assert.match(scriptSource, /function normalizeMailboxImageLabel\(value\)/);
  assert.match(scriptSource, /function isMailboxMockupImageLabel\(value\)/);
  assert.match(scriptSource, /function isMailboxWebdesignImageLabel\(value\)/);
  assert.match(imagesScriptSource, /function sectionHasPlaceholder\(section\)/);
  assert.match(scriptSource, /function normalizeMailboxBodyImages\(images\)/);
  assert.match(imagesScriptSource, /function renderUnused\(imageState, renderImage, options = \{\}\)/);
  assert.match(imagesScriptSource, /function getSentImageOwner\(mail\)/);
  assert.match(imagesScriptSource, /function renderThreadMessageBody\(payload, context, renderers\)/);
  assert.match(imagesScriptSource, /function createOwnershipPlan\(mail, mainImages, hasMainPlaceholders, options = \{\}\)/);
  assert.match(imagesScriptSource, /function isOwnQuoteSection\(section, isReplyHeaderLine, isOwnReplyHeaderLine\)/);
  assert.match(imagesScriptSource, /function renderOwnQuoteSection\(images, baseState, renderImage\)/);
  assert.match(scriptSource, /function renderMailboxBodySection\(section, imageState, leadingHtml = '', options = \{\}\)/);
  assert.match(scriptSource, /function normalizeMailboxOptOutUrl\(value\)/);
  assert.match(scriptSource, /function renderMailboxOptOutLink\(url\)/);
  assert.match(scriptSource, /function renderMailBody\(value, images, options\)/);
  assert.match(scriptSource, /section\.type === 'signature'/);
  assert.match(scriptSource, /const hasImagePlaceholders = sections\.some\(window\.SoftoraMailboxImages\.sectionHasPlaceholder\);/);
  assert.match(scriptSource, /if \(!hasImagePlaceholders && !injectedImages && section && section\.type === 'signature'\)/);
  assert.match(scriptSource, /usedImages\.add\(imageEntry\.index\);/);
  assert.match(scriptSource, /function pushTextLine\(line\)/);
  assert.match(scriptSource, /detail-mail-line-empty/);
  assert.match(scriptSource, /renderedLines\.push\(renderMailboxInlineImage\(imageEntry\.image\)\);/);
  assert.match(scriptSource, /if \(imageAlt\) \{[\s\S]*return;/);
  assert.match(imagesScriptSource, /detail-mail-section-images/);
  assert.match(scriptSource, /detail-mail-optout-link/);
  assert.match(scriptSource, /MAILBOX_WEBDESIGN_MOCKUP_CAPTION/);
  assert.match(scriptSource, /sendgrid\\\.net/);
  assert.match(scriptSource, /cdn\.openai\.com/);
  assert.match(readDisplayScript(), /function isGmailSignatureAssetUrl\(value\)/);
  assert.match(readDisplayScript(), /function collapseDuplicateAnnotations\(line\)/);
  assert.match(readDisplayScript(), /function removeDuplicateSignatureLeadLines\(lines\)/);
  assert.match(scriptSource, /Eerdere mail/);
  assert.doesNotMatch(scriptSource, /Jouw eerdere mail/);
  assert.match(scriptSource, /const bodyImages = normalizeMailboxBodyImages\(message\.bodyImages\);/);
  assert.match(scriptSource, /const optOutUrl = normalizeMailboxOptOutUrl\(message\.optOutUrl\);/);
  assert.match(scriptSource, /cleanMailboxText\(message\.body \|\| ''\)/);
  assert.doesNotMatch(scriptSource, /cleanMailboxText\(message\.body \|\| message\.preview/);
  assert.match(readDisplayScript(), /function renderDetailBody\(mail, content\)[\s\S]*Volledige inhoud wordt opgehaald…/);
  assert.match(scriptSource, /renderMailBody\(detailBody, m\.bodyImages, \{[\s\S]*rootIncomingMeta,[\s\S]*threadImagesReady: true/);
  assert.match(scriptSource, /imageAlt = cleaned\.trim\(\)\.match\(\/\^\\\[image:\\s\*\(\[\^\\\]\]\+\)\\\]\$\/i\)/);
});

test('premium mailbox verbergt losse cid-handtekeningartefacten maar bewaart echte tekst', () => {
  const html = renderMailboxBodyForTest([
    'Met vriendelijke groet,',
    '[cid:d81b82a0-5366-4160-9f38-923713a1dc2c]',
    '<cid:09359096-9030-4fe1-b660-aa972965067f>',
    'cid:d35a555a-6921-4eb5-bef8-44a4e78d9e6d',
    'Gubbels B.V.',
  ].join('\n'), []);

  assert.doesNotMatch(html, /cid:/i);
  assert.match(html, /Met vriendelijke groet,/);
  assert.match(html, /Gubbels B\.V\./);
});

test('premium mailbox verbergt automatisch gegenereerde afbeeldingsbeschrijvingen in elke conversatielaag', () => {
  const generatedDescription = '[Afbeelding met Lettertype, Graphics, logo, tekst Automatisch gegenereerde beschrijving]';
  const html = renderMailboxBodyForTest([
    'Dank je wel!',
    '',
    generatedDescription,
    '',
    'Burgemeester Stekelenburgplein 199',
  ].join('\n'), [], {
    replyMailId: 'inbox:generated-description',
    mail: {
      receivedAt: '2026-07-23T13:54:00.000Z',
      threadMessages: [
        {
          id: 'sent:generated-description',
          folder: 'sent',
          accountEmail: 'martijnvandeven@softora.nl',
          date: '2026-07-23T13:30:00.000Z',
          body: [
            'Goedendag,',
            '',
            '[Image met Font, Graphics, logo, text Automatically generated description]',
            '',
            '[Interne notitie blijft zichtbaar]',
          ].join('\n'),
        },
      ],
    },
  });

  assert.doesNotMatch(html, /Automatisch gegenereerde beschrijving/i);
  assert.doesNotMatch(html, /Automatically generated description/i);
  assert.match(html, /Burgemeester Stekelenburgplein 199/);
  assert.match(html, /\[Interne notitie blijft zichtbaar\]/);
});

test('premium mailbox zet een eerdere eigen mail in een roze Eerdere mail-blok', () => {
  const html = renderMailboxBodyForTest([
    'Bedankt voor je bericht, maar we hebben geen interesse.',
    '',
    'Op 20 jul 2026 om 07:12 heeft Servé Creusen het volgende geschreven:',
    '',
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website devyldre.com tegen.',
  ].join('\n'));

  assert.equal((html.match(/detail-mail-section-history-sent/g) || []).length, 1);
  assert.match(html, /<div class="detail-mail-section-label">Eerdere mail<\/div>/);
  assert.doesNotMatch(html, /Jouw eerdere mail|detail-mail-section-quote/);
  assert.match(html, /Op 20 jul 2026 om 07:12 heeft Servé Creusen het volgende geschreven:/);
  assert.ok(html.indexOf('Bedankt voor je bericht') < html.indexOf('detail-mail-section-history-sent'));
  assert.ok(html.indexOf('Goedendag') > html.indexOf('detail-mail-section-history-sent'));
});

test('premium mailbox maakt uit geciteerde campagnebeelden geen berichtmedia', () => {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgo=';
  const html = renderMailboxBodyForTest([
    'Hoi Servé,',
    '',
    'Bedankt voor je mail. Leuk gedaan, maar geen interesse.',
    '',
    'Op 2 jul 2026 om 11:00 schreef Servé Creusen:',
    '',
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website dirvenschoenen.nl tegen.',
    '',
    'Vanuit enthousiasme heb ik een fris webdesign gemaakt.',
  ].join('\n'), [
    { alt: 'dirvenschoenen.nl-preview', dataUrl: tinyPng, owner: 'sent-campaign' },
    { alt: 'dirvenschoenen.nl-preview-device-mockup-v8', dataUrl: tinyPng, owner: 'sent-campaign' },
  ], {
    mail: {
      threadMessages: [{
        id: 'sent:195',
        folder: 'sent',
        body: 'Hoi,\n\nDankjewel voor je reactie.',
      }],
    },
  });

  const replyIndex = html.indexOf('Bedankt voor je mail');
  assert.ok(replyIndex >= 0);
  assert.equal((html.match(/<figure class="detail-mail-image">/g) || []).length, 0);
  assert.equal((html.match(/Afgelopen week kwam ik jullie website dirvenschoenen\.nl tegen\./g) || []).length, 0);
  assert.doesNotMatch(html, /detail-mail-section-history-sent|citaat · niet ontvangen/i);
});

test('premium mailbox toont geen handtekening van de ontvanger in Eerdere mail', () => {
  const html = renderMailboxBodyForTest([
    'Bedankt voor je bericht, maar we hebben geen interesse.',
    '',
    'Op di 30 jun 2026 om 07:18 schreef Servé Creusen:',
    '',
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website denbosch.wereldwinkels.nl tegen.',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
    '📍 ’s-Hertogenbosch',
    '',
    '--',
    'Met vriendelijke groet,',
    'Wereldwinkel ’s-Hertogenbosch',
    'Hinthamerstraat 105',
    '5211 MH',
    'tel 073 689 40 68',
    '*www.wereldwinkel-webshop.nl*',
  ].join('\n'));

  assert.match(html, /<div class="detail-mail-section-label">Eerdere mail<\/div>/);
  assert.doesNotMatch(html, /Jouw eerdere mail/);
  assert.match(html, /detail-mail-section-history-sent/);
  assert.match(html, /Servé Creusen/);
  assert.match(html, /📍 ’s-Hertogenbosch/);
  assert.doesNotMatch(html, /Wereldwinkel ’s-Hertogenbosch/);
  assert.doesNotMatch(html, /Hinthamerstraat 105/);
  assert.doesNotMatch(html, /wereldwinkel-webshop\.nl/);
});

test('premium mailbox zet beantwoorden direct onder de ontvangen mail en voor de eerdere mail', () => {
  const html = renderMailboxBodyForTest([
    'Bedankt voor je bericht, maar we hebben geen interesse.',
    '',
    'Kind regards,',
    'Daffy de Vyldre',
    '',
    'Op 20 jul 2026 om 07:12 heeft Servé Creusen het volgende geschreven:',
    '',
    'Goedendag,',
  ].join('\n'), [], { replyMailId: 'mail-123' });

  assert.equal((html.match(/data-mailbox-action="reply-mail"/g) || []).length, 1);
  assert.ok(html.indexOf('Daffy de Vyldre') < html.indexOf('data-mailbox-action="reply-mail"'));
  assert.ok(html.indexOf('data-mailbox-action="reply-mail"') < html.indexOf('detail-mail-section-history-sent'));
  assert.match(html, /data-mailbox-id="mail-123"/);
});

test('premium mailbox herstelt een samengeplakte Samsung-reactie van Martijn', () => {
  const html = renderMailboxBodyForTest([
    'Dag Martijn,We zijn het als bestuur aan het overleggen wat wenselijk is.Mochten we van je diensten gebruik willen maken, dan laten we je dat weten.GroetGerard Schellekens Verzonden vanaf mijn Galaxy',
    '-------- Oorspronkelijk bericht --------Van: Martijn van de Ven Datum: 25-06-2026 11:17 (GMT+01:00) Aan: gschellekens@home.nl Onderwerp: Kleine vraag over jullie website Goedendag,',
    'Afgelopen week kwam ik jullie website (bchelvoirt.nl) tegen.',
    'Met vriendelijke groet,Martijn van de Ven',
    '📍 Helvoirt',
  ].join('\n'), [], { replyMailId: 'martijnvandeven@softora.nl|inbox:17' });

  assert.equal((html.match(/detail-mail-section-history-sent/g) || []).length, 1);
  assert.match(html, /<div class="detail-mail-section-label">Eerdere mail<\/div>/);
  assert.doesNotMatch(html, /Jouw eerdere mail|detail-mail-section-quote/);
  assert.match(html, /<div class="detail-mail-quote-meta">Van: Martijn van de Ven<\/div>/);
  assert.doesNotMatch(html, /Oorspronkelijk bericht/i);
  assert.match(html, /Dag Martijn,<\/div>\s*<div class="detail-mail-line detail-mail-line-empty"[^>]*>&nbsp;<\/div>\s*<div class="detail-mail-line">We zijn het als bestuur/);
  assert.ok(html.indexOf('Gerard Schellekens') < html.indexOf('data-mailbox-action="reply-mail"'));
  assert.ok(html.indexOf('data-mailbox-action="reply-mail"') < html.indexOf('detail-mail-section-history-sent'));
  assert.ok(html.indexOf('Onderwerp: Kleine vraag over jullie website') < html.indexOf('Goedendag,'));
});

test('premium mailbox zet beantwoorden onderaan als er geen eerdere mail is', () => {
  const html = renderMailboxBodyForTest('Alleen het ontvangen bericht.', [], { replyMailId: 'mail-456' });

  assert.ok(html.indexOf('Alleen het ontvangen bericht.') < html.indexOf('data-mailbox-action="reply-mail"'));
  assert.doesNotMatch(html, /detail-mail-section-quote/);
});

test('premium mailbox houdt een geciteerde mail van een andere afzender neutraal', () => {
  const html = renderMailboxBodyForTest([
    'Mijn antwoord staat hierboven.',
    '',
    'On 20 Jul 2026, John Example wrote:',
    '',
    'Original message.',
  ].join('\n'));

  assert.doesNotMatch(html, /detail-mail-section-label/);
  assert.doesNotMatch(html, /Jouw eerdere mail|Eerdere mail/);
  assert.match(html, /detail-mail-section-history/);
  assert.doesNotMatch(html, /detail-mail-section-history-sent/);
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
  ], {
    mail: {
      folder: 'sent',
      originalCampaignOutbound: true,
      bodyImageEvidenceKnown: true,
      embeddedImageCount: 2,
    },
  });

  assert.equal((html.match(/detail-mail-line-empty/g) || []).length, 7);
  assert.equal((html.match(/<figure class="detail-mail-image">/g) || []).length, 2);
  assert.doesNotMatch(html, /\[image:/i);
  assert.match(html, /detail-mail-optout-link/);
  assert.match(html, /href="https:\/\/www\.softora\.nl\/afmelden\?t=abc"/);
  assert.doesNotMatch(html, />https:\/\/www\.softora\.nl\/afmelden/);
  assert.ok(html.indexOf('0629917185') < html.indexOf('<figure class="detail-mail-image">'));
  assert.ok(html.indexOf('detail-mail-optout-link') > html.lastIndexOf('<figure class="detail-mail-image">'));

  const proxiedImageHtml = renderMailboxBodyForTest('[image: Ontwerp]', [{
    alt: 'Ontwerp',
    dataUrl: '/api/mailbox/message-image?account=serve%40softora.nl&folder=inbox&id=inbox%3A42&index=0',
  }]);
  assert.match(proxiedImageHtml, /src="\/api\/mailbox\/message-image\?account=serve%40softora\.nl&amp;folder=inbox&amp;id=inbox%3A42&amp;index=0"/);
  assert.match(proxiedImageHtml, /loading="eager" decoding="async" fetchpriority="high"/);
  assert.match(proxiedImageHtml, /data-mailbox-inline-image/);

  const labelOnlyHtml = renderMailboxBodyForTest(
    'Geen webdesign willen ontvangen? Laat het me weten!',
    [],
    { optOutUrl: 'https://www.softora.nl/afmelden?t=abc' }
  );

  assert.match(labelOnlyHtml, /class="detail-mail-optout-link"/);
  assert.match(labelOnlyHtml, /href="https:\/\/www\.softora\.nl\/afmelden\?t=abc"/);
  assert.doesNotMatch(labelOnlyHtml, />https:\/\/www\.softora\.nl\/afmelden/);
});

test('beeldvoorbereiding reserveert de exacte verhouding en sluit mislukte bronnen voor de detailcommit uit', async () => {
  let loadedImage;
  let decodeCalls = 0;
  class LoadedImage {
    constructor() {
      loadedImage = this;
      this.complete = false;
      this.naturalWidth = 0;
      this.naturalHeight = 0;
    }
    set src(value) { this.source = value; }
    async decode() { decodeCalls += 1; }
  }
  const loadedApi = loadMailboxImagesModuleForTest({ Image: LoadedImage });
  const loaded = { alt: 'Stabiel beeld', dataUrl: '/api/mailbox/message-image?case=loaded' };
  const loadedPending = loadedApi.prepare([loaded]);
  loadedImage.complete = true;
  loadedImage.naturalWidth = 1600;
  loadedImage.naturalHeight = 900;
  loadedImage.onload();
  await loadedPending;
  const loadedHtml = loadedApi.renderInlineImage(loaded, String);
  assert.equal(decodeCalls, 1);
  assert.match(loadedHtml, /width="1600" height="900"/);

  let failedImage;
  class FailedImage {
    constructor() {
      failedImage = this;
      this.complete = false;
      this.naturalWidth = 0;
      this.naturalHeight = 0;
    }
    set src(value) { this.source = value; }
  }
  const failedApi = loadMailboxImagesModuleForTest({ Image: FailedImage });
  const failed = { alt: 'Defect beeld', dataUrl: '/api/mailbox/message-image?case=failed' };
  const failedPending = failedApi.prepare([failed]);
  failedImage.onerror();
  await failedPending;
  assert.equal(failedApi.renderInlineImage(failed, String), '');
});

test('beeldtimeout blijft definitief buiten de DOM wanneer een late load alsnog arriveert', async () => {
  let delayedImage;
  let timeoutHandler;
  class DelayedImage {
    constructor() {
      delayedImage = this;
      this.complete = false;
      this.naturalWidth = 0;
      this.naturalHeight = 0;
    }
    set src(value) { this.source = value; }
    async decode() {}
  }
  const api = loadMailboxImagesModuleForTest({
    Image: DelayedImage,
    setTimeout(handler, delay) {
      assert.equal(delay, 15_000);
      timeoutHandler = handler;
      return 1;
    },
  });
  const delayed = { alt: 'Te laat beeld', dataUrl: '/api/mailbox/message-image?case=timeout' };
  const pending = api.prepare([delayed]);
  const lateLoad = delayedImage.onload;
  timeoutHandler();
  await pending;
  assert.equal(api.renderInlineImage(delayed, String), '');

  delayedImage.complete = true;
  delayedImage.naturalWidth = 1200;
  delayedImage.naturalHeight = 800;
  lateLoad();
  await Promise.resolve();
  assert.equal(api.renderInlineImage(delayed, String), '');
});

test('premium mailbox toont een beeldmail pas nadat de afbeelding is voorbereid', () => {
  const script = readScript();
  const stability = readDetailStabilityScript();
  assert.match(readOwnerSessionScript(), /options\.prewarm\?\.\(messages\)/);
  assert.match(script, /prepare: \(mail, openOptions\) => openOptions\.imagesPrepared \? null : window\.SoftoraMailboxImages\?\.prepareForCommit\?\./);
  assert.match(stability, /await options\.prepare\(value, context\)/);
  assert.match(stability, /if \(!isCurrent\(candidate\)\) return \{ committed: false, stale: true, error \};[\s\S]*options\.commit/);
});

test('premium mailbox houdt het oude detail stabiel tot de nieuwe mail volledig kan committen', async () => {
  let releaseImages;
  const imagePreparation = new Promise((resolve) => { releaseImages = resolve; });
  const mailbox = loadMailboxHelpersForTest({
    SoftoraMailboxImages: {
      ...imagesModule,
      getConversationImages: () => [{ alt: 'Voorbereiden', dataUrl: 'data:image/png;base64,AA==' }],
      prepareForCommit: () => imagePreparation,
    },
  });
  await mailbox.ready;
  const previous = mailbox.normalizeMailboxApiMessage({
    id: 'serve:inbox:1',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    from: 'Vorige afzender',
    email: 'vorige@example.com',
    subject: 'Vorige mail',
    body: 'Dit is de oude mail.',
    receivedAt: '2026-07-23T12:00:00.000Z',
  });
  const next = mailbox.normalizeMailboxApiMessage({
    id: 'serve:inbox:2',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    from: 'Nieuwe afzender',
    email: 'nieuw@example.com',
    subject: 'Nieuwe mail',
    preview: 'Dit is alvast de nieuwe mail.',
    receivedAt: '2026-07-23T12:05:00.000Z',
  });
  mailbox.setMails([previous, next]);

  await mailbox.openMail(previous.id, {
    skipBodyFetch: true,
    skipThreadBodyFetch: true,
    skipContactTimeline: true,
    imagesPrepared: true,
  });
  assert.match(mailbox.getElement('mail-detail').innerHTML, /Vorige afzender/);
  assert.doesNotMatch(mailbox.getElement('mail-detail').innerHTML, /Vorige mail/);

  const detail = mailbox.getElement('mail-detail');
  const writesBefore = detail.innerHTMLWrites;
  const pending = mailbox.openMail(next.id, {
    skipBodyFetch: true,
    skipThreadBodyFetch: true,
    skipContactTimeline: true,
  });
  await Promise.resolve();

  assert.equal(mailbox.getActiveMail(), next.id);
  assert.match(detail.innerHTML, /Vorige afzender/);
  assert.doesNotMatch(detail.innerHTML, /Nieuwe afzender/);
  assert.equal(detail.innerHTMLWrites, writesBefore);
  assert.equal(detail.classList.contains('is-detail-pending'), true);
  assert.equal(detail.hasAttribute('inert'), true);

  releaseImages();
  assert.equal((await pending).committed, true);
  assert.match(detail.innerHTML, /Nieuwe afzender/);
  assert.match(detail.innerHTML, /Dit is alvast de nieuwe mail\./);
  assert.doesNotMatch(detail.innerHTML, /Vorige afzender|Dit is de oude mail\./);
  assert.equal(detail.innerHTMLWrites, writesBefore + 1);
  assert.equal(detail.classList.contains('is-detail-pending'), false);
  assert.equal(detail.hasAttribute('inert'), false);
});

test('premium mailbox herschrijft identieke detailhtml niet opnieuw', async () => {
  const mailbox = loadMailboxHelpersForTest();
  await mailbox.ready;
  const mail = mailbox.normalizeMailboxApiMessage({
    id: 'serve:inbox:stable',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    from: 'Stabiele afzender',
    email: 'stabiel@example.nl',
    subject: 'Stabiel detail',
    body: 'Deze inhoud verandert niet.',
    receivedAt: '2026-08-20T12:00:00.000Z',
  });
  mailbox.setMails([mail]);
  const detail = mailbox.getElement('mail-detail');

  const first = await mailbox.openMail(mail.id, {
    skipBodyFetch: true,
    skipThreadBodyFetch: true,
    skipContactTimeline: true,
    imagesPrepared: true,
  });
  assert.equal(first.committed, true);
  const writesAfterFirstCommit = detail.innerHTMLWrites;

  const repeated = await mailbox.openMail(mail.id, {
    skipBodyFetch: true,
    skipThreadBodyFetch: true,
    skipContactTimeline: true,
    imagesPrepared: true,
  });
  assert.equal(repeated.stale, false);
  assert.equal(detail.innerHTMLWrites, writesAfterFirstCommit);
  assert.equal(detail.classList.contains('is-detail-pending'), false);
  assert.equal(detail.hasAttribute('inert'), false);
});

test('achtergrondrefresh houdt hetzelfde gecommitte detail zichtbaar tijdens verrijking', async () => {
  let releasePreparation;
  const preparation = new Promise((resolve) => { releasePreparation = resolve; });
  const mailbox = loadMailboxHelpersForTest({
    SoftoraMailboxImages: {
      ...imagesModule,
      getConversationImages: () => [],
      prepareForCommit: () => preparation,
    },
  });
  await mailbox.ready;
  const mail = mailbox.normalizeMailboxApiMessage({
    id: 'serve:inbox:focus-stable',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    from: 'Stabiele afzender',
    email: 'stabiel@example.nl',
    subject: 'Focus blijft stabiel',
    body: 'Reeds zichtbare inhoud.',
    receivedAt: '2026-08-21T13:00:00.000Z',
  });
  mailbox.setMails([mail]);
  await mailbox.openMail(mail.id, {
    skipBodyFetch: true,
    skipThreadBodyFetch: true,
    skipContactTimeline: true,
    imagesPrepared: true,
  });
  const detail = mailbox.getElement('mail-detail');
  const htmlBefore = detail.innerHTML;
  const writesBefore = detail.innerHTMLWrites;

  mail.body = 'Bijgewerkte inhoud na achtergrondcontrole.';
  const pending = mailbox.openMail(mail.id, {
    preserveVisibleDetail: true,
    skipBodyFetch: true,
    skipThreadBodyFetch: true,
    skipContactTimeline: true,
  });
  await Promise.resolve();

  assert.equal(detail.innerHTML, htmlBefore);
  assert.equal(detail.innerHTMLWrites, writesBefore);
  assert.equal(detail.classList.contains('is-detail-pending'), false);
  assert.equal(detail.hasAttribute('inert'), false);
  assert.notEqual(detail.getAttribute('aria-busy'), 'true');

  releasePreparation();
  assert.equal((await pending).committed, true);
  assert.match(detail.innerHTML, /Bijgewerkte inhoud na achtergrondcontrole\./);
  assert.equal(detail.innerHTMLWrites, writesBefore + 1);
  assert.equal(detail.classList.contains('is-detail-pending'), false);
});

test('zelfde logische gesprek houdt detail zichtbaar wanneer de fysieke mailboxkopie wisselt', async () => {
  const classes = new Set();
  const attributes = new Map();
  let detailHtml = '';
  let detailBody = { scrollTop: 0 };
  const detail = {
    dataset: {},
    get innerHTML() { return detailHtml; },
    set innerHTML(value) {
      detailHtml = String(value);
      detailBody = { scrollTop: 0 };
    },
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      contains(name) { return classes.has(name); },
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    querySelector(selector) { return selector === '.detail-body' ? detailBody : null; },
  };
  const conversationId = 'conversation:serve@softora.nl|same-contact';
  let current = { id: 'serve@softora.nl|inbox:42', conversationId, body: 'Zelfde gesprek.' };
  let activeId = '';
  let releasePreparation;
  const preparation = new Promise((resolve) => { releasePreparation = resolve; });
  const controller = detailStabilityModule.createController({
    getMail: (id) => String(id) === String(current.id) ? current : null,
    ensureToken: () => ({ generation: 1 }),
    isTokenCurrent: () => true,
    getScope: () => ({ folder: 'inbox', account: 'serve@softora.nl' }),
    getVisibilityKey: (mail) => mail.conversationId,
    getActiveMail: () => activeId,
    setActiveMail(id) { activeId = id; },
    select() {}, renderList() {}, getDetailElement: () => detail,
    renderHtml: (mail) => `<p>${mail.body}</p>`,
    prepare: (mail) => mail.wait || null,
  });

  assert.equal((await controller.open(current.id)).committed, true);
  const htmlBefore = detail.innerHTML;
  detailBody.scrollTop = 384;
  current = {
    id: 'serve@softora.nl|allmail:991', conversationId,
    body: 'Zelfde gesprek.', wait: preparation,
  };
  const pending = controller.open(current.id, { preserveVisibleDetail: true });
  await Promise.resolve();

  assert.equal(detail.innerHTML, htmlBefore);
  assert.equal(detail.classList.contains('is-detail-pending'), false);
  assert.equal(attributes.get('aria-busy'), 'false');
  assert.equal(attributes.has('inert'), false);
  assert.equal(detail.dataset.mailboxPendingId, current.id);
  releasePreparation();
  assert.equal((await pending).committed, true);
  assert.equal(detail.dataset.mailboxCommittedId, current.id);
  assert.equal(detail.dataset.mailboxCommittedVisibilityKey, conversationId);
  assert.equal(detail.dataset.mailboxPendingId, undefined);
  assert.equal(detailBody.scrollTop, 384);
});

test('behoud-zichtbaar geldt nooit voor een andere nieuw geselecteerde mail', async () => {
  let releasePreparation;
  const preparation = new Promise((resolve) => { releasePreparation = resolve; });
  const mailbox = loadMailboxHelpersForTest({
    SoftoraMailboxImages: {
      ...imagesModule,
      getConversationImages: () => [],
      prepareForCommit: () => preparation,
    },
  });
  await mailbox.ready;
  const first = mailbox.normalizeMailboxApiMessage({
    id: 'serve:inbox:visible-a', folder: 'inbox', accountEmail: 'serve@softora.nl',
    from: 'Afzender A', email: 'a@example.nl', subject: 'A', body: 'Mail A.',
    receivedAt: '2026-08-21T13:00:00.000Z',
  });
  const second = mailbox.normalizeMailboxApiMessage({
    id: 'serve:inbox:visible-b', folder: 'inbox', accountEmail: 'serve@softora.nl',
    from: 'Afzender B', email: 'b@example.nl', subject: 'B', body: 'Mail B.',
    receivedAt: '2026-08-21T13:01:00.000Z',
  });
  mailbox.setMails([first, second]);
  await mailbox.openMail(first.id, {
    skipBodyFetch: true, skipThreadBodyFetch: true,
    skipContactTimeline: true, imagesPrepared: true,
  });
  const detail = mailbox.getElement('mail-detail');

  const pending = mailbox.openMail(second.id, {
    preserveVisibleDetail: true,
    skipBodyFetch: true,
    skipThreadBodyFetch: true,
    skipContactTimeline: true,
  });
  await Promise.resolve();

  assert.equal(detail.classList.contains('is-detail-pending'), true);
  assert.equal(detail.hasAttribute('inert'), true);
  assert.equal(detail.dataset.mailboxPendingId, second.id);
  releasePreparation();
  assert.equal((await pending).committed, true);
  assert.match(detail.innerHTML, /Afzender B/);
});

test('stale stille A-refresh kan de laadlaag van een nieuwere B-selectie niet wissen', async () => {
  let releaseA;
  let releaseB;
  const waitA = new Promise((resolve) => { releaseA = resolve; });
  const waitB = new Promise((resolve) => { releaseB = resolve; });
  const mailbox = loadMailboxHelpersForTest({
    SoftoraMailboxImages: {
      ...imagesModule,
      getConversationImages: (mail) => [{ id: mail.id }],
      prepareForCommit: (images) => images[0]?.id === 'serve:inbox:race-a' ? waitA : waitB,
    },
  });
  await mailbox.ready;
  const first = mailbox.normalizeMailboxApiMessage({
    id: 'serve:inbox:race-a', folder: 'inbox', accountEmail: 'serve@softora.nl',
    from: 'Afzender A', email: 'a@example.nl', subject: 'A', body: 'Mail A.',
    receivedAt: '2026-08-21T13:00:00.000Z',
  });
  const second = mailbox.normalizeMailboxApiMessage({
    id: 'serve:inbox:race-b', folder: 'inbox', accountEmail: 'serve@softora.nl',
    from: 'Afzender B', email: 'b@example.nl', subject: 'B', body: 'Mail B.',
    receivedAt: '2026-08-21T13:01:00.000Z',
  });
  mailbox.setMails([first, second]);
  await mailbox.openMail(first.id, {
    skipBodyFetch: true, skipThreadBodyFetch: true,
    skipContactTimeline: true, imagesPrepared: true,
  });
  first.body = 'A wordt stil verrijkt.';
  const silentA = mailbox.openMail(first.id, {
    preserveVisibleDetail: true,
    skipBodyFetch: true,
    skipThreadBodyFetch: true,
    skipContactTimeline: true,
  });
  await Promise.resolve();
  const pendingB = mailbox.openMail(second.id, {
    skipBodyFetch: true,
    skipThreadBodyFetch: true,
    skipContactTimeline: true,
  });
  await Promise.resolve();
  const detail = mailbox.getElement('mail-detail');
  assert.equal(detail.dataset.mailboxPendingId, second.id);
  assert.equal(detail.classList.contains('is-detail-pending'), true);

  releaseA();
  assert.equal((await silentA).stale, true);
  assert.equal(detail.dataset.mailboxPendingId, second.id);
  assert.equal(detail.classList.contains('is-detail-pending'), true);
  assert.equal(detail.hasAttribute('inert'), true);

  releaseB();
  assert.equal((await pendingB).committed, true);
  assert.match(detail.innerHTML, /Afzender B/);
  assert.equal(detail.classList.contains('is-detail-pending'), false);
});

test('stille same-ID refresh bindt tokenvervanging en objectvervanging elk zelfstandig', async () => {
  async function runScenario({ label, replaceToken, replaceObject }) {
    const classes = new Set();
    const attributes = new Map();
    const loaderActivations = [];
    const detail = {
      dataset: {},
      innerHTML: '',
      classList: {
        add(...names) {
          if (names.includes('is-detail-pending')) loaderActivations.push('class');
          names.forEach((name) => classes.add(name));
        },
        remove(...names) { names.forEach((name) => classes.delete(name)); },
        contains(name) { return classes.has(name); },
      },
      setAttribute(name, value) {
        if ((name === 'aria-busy' && String(value) === 'true') || name === 'inert') {
          loaderActivations.push(name);
        }
        attributes.set(name, String(value));
      },
      removeAttribute(name) { attributes.delete(name); },
      querySelector() { return null; },
    };
    let activeId = '';
    let token = { generation: 1, signal: new AbortController().signal };
    let mail = { id: `serve:inbox:same-id-${label}`, body: 'Oude zichtbare inhoud.' };
    const controller = detailStabilityModule.createController({
      getMail: (id) => String(id) === mail.id ? mail : null,
      ensureToken: () => token,
      isTokenCurrent: (candidate) => candidate === token,
      getScope: () => ({ folder: 'inbox', account: 'serve@softora.nl' }),
      getActiveMail: () => activeId,
      setActiveMail: (id) => { activeId = id; },
      select() {},
      renderList() {},
      getDetailElement: () => detail,
      renderHtml: (current) => `<p>${current.body}</p>`,
      prepare: (current) => current.preparation,
    });

    assert.equal((await controller.open(mail.id, { skipContactTimeline: true })).committed, true, label);
    loaderActivations.length = 0;
    let releaseStalePreparation;
    mail.preparation = new Promise((resolve) => { releaseStalePreparation = resolve; });
    const staleRun = controller.open(mail.id, {
      preserveVisibleDetail: true,
      skipContactTimeline: true,
    });
    assert.deepEqual(loaderActivations, [], label);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(controller.snapshot().pending, true, label);

    if (replaceToken) token = { generation: 2, signal: new AbortController().signal };
    if (replaceObject) {
      mail = { id: mail.id, body: 'Actuele inhoud na refresh.', preparation: Promise.resolve() };
    } else {
      mail.body = 'Actuele inhoud na refresh.';
      mail.preparation = Promise.resolve();
    }
    const currentRun = controller.open(mail.id, {
      preserveVisibleDetail: true,
      skipContactTimeline: true,
    });
    assert.deepEqual(loaderActivations, [], label);
    assert.equal((await currentRun).committed, true, label);
    assert.equal(detail.innerHTML, '<p>Actuele inhoud na refresh.</p>', label);
    assert.equal(detail.classList.contains('is-detail-pending'), false, label);

    releaseStalePreparation();
    assert.equal((await staleRun).stale, true, label);
    assert.equal(detail.innerHTML, '<p>Actuele inhoud na refresh.</p>', label);
    assert.deepEqual(loaderActivations, [], label);
  }

  await runScenario({ label: 'new-token-same-object', replaceToken: true, replaceObject: false });
  await runScenario({ label: 'same-token-new-object', replaceToken: false, replaceObject: true });
});

test('handmatige rootretry supersedeert een lopende stille same-key refresh', async () => {
  const classes = new Set();
  const attributes = new Map();
  const detail = {
    dataset: {},
    innerHTML: '',
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      contains(name) { return classes.has(name); },
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    querySelector() { return null; },
  };
  const token = { generation: 1, signal: new AbortController().signal };
  const mail = { id: 'serve:inbox:manual-root-retry', body: 'Zichtbare inhoud.', bodyLoaded: true };
  let activeId = '';
  let hydrateRootCalls = 0;
  let releaseSilentPreparation;
  const silentPreparation = new Promise((resolve) => { releaseSilentPreparation = resolve; });
  const controller = detailStabilityModule.createController({
    getMail: (id) => String(id) === mail.id ? mail : null,
    ensureToken: () => token,
    isTokenCurrent: (candidate) => candidate === token,
    getScope: () => ({ folder: 'inbox', account: 'serve@softora.nl' }),
    getActiveMail: () => activeId,
    setActiveMail: (id) => { activeId = id; },
    select() {},
    renderList() {},
    getDetailElement: () => detail,
    renderHtml: (current) => `<p>${current.body}</p>`,
    needsRootHydration: (current, openOptions) => Boolean(
      openOptions.forceRootHydration || !current.bodyLoaded
    ),
    hydrateRoot: async () => {
      hydrateRootCalls += 1;
      mail.body = 'Handmatig opnieuw geladen.';
      mail.bodyLoaded = true;
    },
    prepare: (current) => current.preparation,
  });

  assert.equal((await controller.open(mail.id, { skipContactTimeline: true })).committed, true);
  mail.preparation = silentPreparation;
  const silentRun = controller.open(mail.id, {
    preserveVisibleDetail: true,
    skipBodyFetch: true,
    skipContactTimeline: true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  const generationBeforeManualRetry = controller.snapshot().generation;

  mail.bodyLoaded = false;
  mail.preparation = Promise.resolve();
  const manualRetry = controller.open(mail.id, {
    forceRootHydration: true,
    skipContactTimeline: true,
  });
  assert.equal(detail.classList.contains('is-detail-pending'), true);
  assert.equal(attributes.has('inert'), true);
  assert.ok(controller.snapshot().generation > generationBeforeManualRetry);
  assert.equal((await manualRetry).committed, true);
  assert.equal(hydrateRootCalls, 1);
  assert.equal(detail.innerHTML, '<p>Handmatig opnieuw geladen.</p>');
  assert.equal(detail.classList.contains('is-detail-pending'), false);

  releaseSilentPreparation();
  assert.equal((await silentRun).stale, true);
  assert.equal(detail.innerHTML, '<p>Handmatig opnieuw geladen.</p>');
});

test('premium mailbox herstelt bewust gemuteerde detail-DOM ook bij identieke HTML', async () => {
  const mailbox = loadMailboxHelpersForTest();
  await mailbox.ready;
  const mail = mailbox.normalizeMailboxApiMessage({
    id: 'serve:inbox:image-recovery', folder: 'inbox', accountEmail: 'serve@softora.nl',
    from: 'Beeldafzender', email: 'beeld@example.nl', subject: 'Beeldherstel',
    body: 'Ongewijzigde inhoud.', receivedAt: '2026-08-20T12:00:00.000Z',
  });
  mailbox.setMails([mail]);
  const detail = mailbox.getElement('mail-detail');
  await mailbox.openMail(mail.id, {
    skipBodyFetch: true, skipThreadBodyFetch: true, skipContactTimeline: true, imagesPrepared: true,
  });
  const writesAfterFirstCommit = detail.innerHTMLWrites;
  detail.dataset.mailboxDomDirty = 'true';

  const recovered = await mailbox.openMail(mail.id, {
    skipBodyFetch: true, skipThreadBodyFetch: true, skipContactTimeline: true, imagesPrepared: true,
  });
  assert.equal(recovered.committed, true);
  assert.equal(detail.innerHTMLWrites, writesAfterFirstCommit + 1);
  assert.equal(detail.dataset.mailboxDomDirty, undefined);
});

test('mailbox afbeeldingsfout invalidereert de exacte bron en forceert zichtbaar herstel', async () => {
  const invalidated = [];
  const source = '/api/mailbox/message-image?mail=recovery&index=0';
  let releaseRecovery;
  const recoveryWait = new Promise((resolve) => { releaseRecovery = resolve; });
  const mailbox = loadMailboxHelpersForTest({
    SoftoraMailboxImages: {
      ...imagesModule,
      getConversationImages: (mail) => mail.bodyImages,
      prepareForCommit: () => null,
      invalidate(value) { invalidated.push(value); return true; },
    },
    SoftoraMailboxIndex: {
      async loadBody({ id, getMail }) {
        await recoveryWait;
        const mail = getMail(id);
        mail.bodyLoaded = true;
        mail.bodyImagesTruncated = false;
      },
    },
  });
  await mailbox.ready;
  const mail = mailbox.normalizeMailboxApiMessage({
    id: 'serve:inbox:image-error', folder: 'inbox', accountEmail: 'serve@softora.nl',
    from: 'Beeldafzender', email: 'beeld@example.nl', subject: 'Beeldfout', body: 'Met afbeelding.',
    bodyImages: [{ alt: 'Herstelbeeld', dataUrl: source }], bodyImageEvidenceKnown: true,
    receivedAt: '2026-08-20T12:00:00.000Z',
  });
  mailbox.setMails([mail]);
  const detail = mailbox.getElement('mail-detail');
  await mailbox.openMail(mail.id, {
    skipBodyFetch: true, skipThreadBodyFetch: true, skipContactTimeline: true, imagesPrepared: true,
  });
  const writesBeforeRecovery = detail.innerHTMLWrites;
  assert.match(detail.innerHTML, /data-mailbox-inline-image/);
  const figure = { classList: { add() {} } };
  const image = {
    style: {},
    currentSrc: `https://www.softora.nl${source}`,
    src: `https://www.softora.nl${source}`,
    getAttribute(name) { return name === 'src' ? source : null; },
    matches(selector) { return selector === '[data-mailbox-inline-image]'; },
    closest(selector) {
      if (selector === '.mail-detail') return detail;
      if (selector === '.detail-mail-image') return figure;
      return null;
    },
  };

  mailbox.dispatchDocumentEvent('error', { target: image });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(invalidated, [source]);
  assert.equal(detail.innerHTMLWrites, writesBeforeRecovery);
  assert.equal(detail.classList.contains('is-detail-pending'), false);
  assert.equal(detail.hasAttribute('inert'), false);
  assert.notEqual(detail.getAttribute('aria-busy'), 'true');
  assert.equal(detail.dataset.mailboxPendingId, mail.id);

  releaseRecovery();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(detail.innerHTMLWrites, writesBeforeRecovery + 1);
  assert.equal(detail.dataset.mailboxDomDirty, undefined);
  assert.equal(detail.classList.contains('is-detail-pending'), false);
});

test('afgevuurde automatische bodyretry heropent het zichtbare detail zonder loader', async () => {
  let selectedTarget = '';
  let generation = 0;
  let scheduledRetry = null;
  const detailState = {
    select(target) {
      const next = String(target || '');
      if (next !== selectedTarget) {
        selectedTarget = next;
        generation += 1;
      }
      return this.snapshot();
    },
    snapshot() { return { selectedTarget, generation, state: selectedTarget ? 'ready' : 'idle' }; },
    begin(target) {
      this.select(target);
      return { target: String(target), generation, attempt: 0, controller: new AbortController() };
    },
    isCurrent(flight) {
      return Boolean(flight && flight.target === selectedTarget && flight.generation === generation);
    },
    finish() {},
    scheduleRetry(_flight, callback) {
      scheduledRetry = callback;
      return true;
    },
  };
  let retrySucceeds = false;
  const mailbox = loadMailboxHelpersForTest({
    SoftoraMailboxDetailState: detailState,
    setTimeout,
    clearTimeout,
    fetch: async (url) => {
      if (!retrySucceeds) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ ok: false, detail: 'tijdelijk niet bereikbaar' }),
        };
      }
      if (String(url) === '/api/mailbox/messages/bodies') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            messages: [{
              id: 'inbox:auto-retry',
              body: 'Automatisch herstelde inhoud.',
              hasBody: true,
              bodyLoaded: true,
              recipientRoutingEvidenceKnown: true,
            }],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({ ok: false }) };
    },
  });
  await mailbox.ready;
  const mail = mailbox.normalizeMailboxApiMessage({
    id: 'inbox:auto-retry',
    mailboxId: 'inbox:auto-retry',
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    body: 'Reeds zichtbare preview.',
    bodyLoaded: true,
    recipientRoutingEvidenceKnown: true,
    receivedAt: '2026-08-26T08:00:00.000Z',
  });
  mailbox.setMails([mail]);
  await mailbox.openMail(mail.id, {
    skipBodyFetch: true,
    skipThreadBodyFetch: true,
    skipContactTimeline: true,
    imagesPrepared: true,
  });
  const detail = mailbox.getElement('mail-detail');
  const loaderActivations = [];
  const originalAdd = detail.classList.add.bind(detail.classList);
  const originalSetAttribute = detail.setAttribute.bind(detail);
  detail.classList.add = (...names) => {
    if (names.includes('is-detail-pending')) loaderActivations.push('class');
    originalAdd(...names);
  };
  detail.setAttribute = (name, value) => {
    if ((name === 'aria-busy' && String(value) === 'true') || name === 'inert') {
      loaderActivations.push(name);
    }
    originalSetAttribute(name, value);
  };
  const reopenOptions = [];
  const reopen = (id, openOptions) => {
    reopenOptions.push(openOptions);
    return mailbox.openMail(id, {
      ...openOptions,
      skipContactTimeline: true,
      skipThreadBodyFetch: true,
      imagesPrepared: true,
    });
  };

  mail.bodyLoaded = false;
  await mailbox.index.loadBody({
    id: mail.id,
    requestId: mail.mailboxId,
    getMail: () => mail,
    account: mail.accountEmail,
    folder: mail.folder,
    normalizeBodyImages: (images) => images || [],
    normalizeOptOutUrl: (value) => String(value || ''),
    getActiveMail: mailbox.getActiveMail,
    openMail: reopen,
    bodyFetchTimeoutMs: 50,
    bodyFetchRetryDelayMs: 1,
    bodyLoadDeadlineMs: 500,
  });
  assert.equal(typeof scheduledRetry, 'function');
  assert.deepEqual(loaderActivations, []);
  assert.ok(reopenOptions.every((options) => options.preserveVisibleDetail === true));

  retrySucceeds = true;
  scheduledRetry();
  for (let attempt = 0; attempt < 20 && !mail.bodyLoaded; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(mail.bodyLoaded, true);
  assert.equal(mail.body, 'Automatisch herstelde inhoud.');
  assert.ok(reopenOptions.length >= 2);
  assert.ok(reopenOptions.every((options) => options.preserveVisibleDetail === true));
  assert.deepEqual(loaderActivations, []);
  assert.equal(detail.classList.contains('is-detail-pending'), false);
});

test('afbeeldingsfout tijdens pending A muteert geen mail en forceert de ene eindcommit', async () => {
  let releaseImages;
  const imageWait = new Promise((resolve) => { releaseImages = resolve; });
  const mailbox = loadMailboxHelpersForTest({
    SoftoraMailboxImages: {
      ...imagesModule,
      getConversationImages: () => [{ alt: 'A', dataUrl: '/api/mailbox/message-image?mail=a' }],
      prepareForCommit: () => imageWait,
    },
  });
  await mailbox.ready;
  const mail = mailbox.normalizeMailboxApiMessage({
    id: 'serve:inbox:a-again', folder: 'inbox', accountEmail: 'serve@softora.nl',
    from: 'A', email: 'a@example.nl', subject: 'A opnieuw', body: 'A blijft intact.',
    receivedAt: '2026-08-20T12:00:00.000Z',
  });
  mailbox.setMails([mail]);
  const detail = mailbox.getElement('mail-detail');
  await mailbox.openMail(mail.id, {
    skipBodyFetch: true, skipThreadBodyFetch: true, skipContactTimeline: true, imagesPrepared: true,
  });
  const writesBeforePending = detail.innerHTMLWrites;

  const pending = mailbox.openMail(mail.id, {
    skipBodyFetch: true, skipThreadBodyFetch: true, skipContactTimeline: true,
  });
  assert.equal(detail.dataset.mailboxPendingId, mail.id);
  let figureMarked = false;
  const figure = { classList: { add() { figureMarked = true; } } };
  const oldImage = {
    style: {},
    matches(selector) { return selector === '[data-mailbox-inline-image]'; },
    closest(selector) {
      if (selector === '.mail-detail') return detail;
      if (selector === '.detail-mail-image') return figure;
      return null;
    },
  };
  mailbox.dispatchDocumentEvent('error', { target: oldImage });
  assert.equal(figureMarked, false);
  assert.equal(oldImage.style.visibility, undefined);
  assert.equal(Boolean(mail.imageRecoveryAttempted), false);
  assert.equal(mail.bodyLoaded, true);

  releaseImages();
  await pending;
  assert.equal(detail.innerHTMLWrites, writesBeforePending + 1);
  assert.equal(detail.dataset.mailboxDomDirty, undefined);
});

test('optimistische verwijdering neutraliseert oude detailacties voordat de volgende mail klaar is', async () => {
  let releaseNextImages;
  let nextPreparationStarted = false;
  const nextImagesReady = new Promise((resolve) => { releaseNextImages = resolve; });
  const mailbox = loadMailboxHelpersForTest({
    SoftoraDialogs: { confirm: async () => true },
    SoftoraMailboxDiscovery: {
      ...discoveryModule,
      create() {
        return {
          canOpenResult: () => true,
          isSearchActive: () => false,
          prepareCompleteContactTimelineForHide: async () => true,
          refreshActiveTimeline: async () => true,
          resetForScopeChange() {},
          loadContactTimeline: async () => true,
        };
      },
    },
    SoftoraMailboxImages: {
      ...imagesModule,
      getConversationImages(mail) {
        return String(mail?.id || '').endsWith('|serve:inbox:delete-next')
          ? [{ alt: 'Volgende afbeelding', dataUrl: 'data:image/png;base64,AA==' }]
          : [];
      },
      prepareForCommit(images) {
        if (!Array.isArray(images) || !images.length) return null;
        nextPreparationStarted = true;
        return nextImagesReady;
      },
    },
    fetch: async (url) => {
      if (String(url) === '/api/mailbox/messages/hide') {
        return { ok: true, json: async () => ({ ok: true, result: { resolvedMessages: [] } }) };
      }
      return {
        ok: true,
        json: async () => ({
          ok: true,
          accounts: [{ email: 'serve@softora.nl', imapConfigured: true, smtpConfigured: true }],
          messages: [],
        }),
      };
    },
  });
  await mailbox.ready;
  mailbox.setActiveFolder('inbox');
  const previous = mailbox.normalizeMailboxApiMessage({
    id: 'serve:inbox:delete-current',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    from: 'Te verwijderen afzender',
    email: 'verwijderen@example.nl',
    subject: 'Verwijderen',
    body: 'Oude mail met acties.',
    receivedAt: '2026-08-20T12:00:00.000Z',
  });
  const next = mailbox.normalizeMailboxApiMessage({
    id: 'serve:inbox:delete-next',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    from: 'Volgende afzender',
    email: 'volgende@example.nl',
    subject: 'Volgende mail',
    body: 'Nieuwe stabiele inhoud.',
    receivedAt: '2026-08-20T12:05:00.000Z',
  });
  mailbox.setMails([previous, next]);
  await mailbox.openMail(previous.id, {
    skipBodyFetch: true,
    skipThreadBodyFetch: true,
    skipContactTimeline: true,
    imagesPrepared: true,
  });
  const detail = mailbox.getElement('mail-detail');
  assert.match(detail.innerHTML, /data-mailbox-action="delete-mail"/);

  const deletion = mailbox.deleteMail(previous.id);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(nextPreparationStarted, true);
  assert.equal(mailbox.getActiveMail(), next.id);
  assert.equal(detail.dataset.mailboxPendingId, next.id);
  assert.equal(detail.classList.contains('is-detail-pending'), true);
  assert.equal(detail.hasAttribute('inert'), true);
  assert.match(detail.innerHTML, /Te verwijderen afzender/);
  assert.doesNotMatch(detail.innerHTML, /Volgende afzender/);

  let oldFigureMarkedFailed = false;
  const oldFigure = {
    classList: { add() { oldFigureMarkedFailed = true; } },
  };
  const oldImage = {
    style: {},
    matches(selector) { return selector === '[data-mailbox-inline-image]'; },
    closest(selector) {
      if (selector === '.mail-detail') return detail;
      if (selector === '.detail-mail-image') return oldFigure;
      return null;
    },
  };
  const nextBodyLoadedBeforeLateError = next.bodyLoaded;
  mailbox.dispatchDocumentEvent('error', { target: oldImage });
  assert.equal(next.bodyLoaded, nextBodyLoadedBeforeLateError);
  assert.equal(Boolean(next.imageRecoveryAttempted), false);
  assert.equal(oldFigureMarkedFailed, false);
  assert.equal(oldImage.style.visibility, undefined);

  releaseNextImages();
  await deletion;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(detail.classList.contains('is-detail-pending'), false);
  assert.equal(detail.hasAttribute('inert'), false);
  assert.match(detail.innerHTML, /Volgende afzender/);
  assert.doesNotMatch(detail.innerHTML, /Te verwijderen afzender/);
});

test('premium mailbox commit gecombineerde body timeline thread en images exact eenmaal', async () => {
  const events = [];
  let releaseBody;
  let releaseTimeline;
  let releaseThread;
  let releaseImages;
  const bodyWait = new Promise((resolve) => { releaseBody = resolve; });
  const timelineWait = new Promise((resolve) => { releaseTimeline = resolve; });
  const threadWait = new Promise((resolve) => { releaseThread = resolve; });
  const imagesWait = new Promise((resolve) => { releaseImages = resolve; });
  const atomicDiscovery = {
    ...discoveryModule,
    create() {
      return {
        canOpenResult: () => true,
        isSearchActive: () => false,
        prepareCompleteContactTimelineForHide: async () => true,
        refreshActiveTimeline: async () => true,
        resetForScopeChange() {},
        async loadContactTimeline(mail, options = {}) {
          assert.equal(options.deferRender, true);
          events.push('timeline:start');
          await timelineWait;
          mail.contactTimelineLoaded = true;
          mail.threadMessages = [{
            id: 'sent:atomic', mailboxId: 'sent:atomic', uid: 22, folder: 'sent',
            accountEmail: 'serve@softora.nl', from: 'Servé Creusen', to: 'klant@example.nl',
            body: '', preview: 'Oude preview', hasBody: true, bodyLoaded: false, bodyTruncated: true,
            recipientRoutingEvidenceKnown: true, date: '2026-08-20T09:00:00.000Z',
          }];
          events.push('timeline:end');
          return true;
        },
      };
    },
  };
  const mailbox = loadMailboxHelpersForTest({
    SoftoraMailboxDiscovery: atomicDiscovery,
    SoftoraMailboxIndex: {
      async loadBody({ id, getMail, openMail }) {
        events.push('body:start');
        await bodyWait;
        const mail = getMail(id);
        mail.body = 'Volledige ontvangen inhoud.';
        mail.bodyLoaded = true;
        mail.bodyLoading = false;
        mail.bodyTruncated = false;
        events.push('body:end');
        openMail(id, { skipBodyFetch: true, skipReadPersist: true });
      },
      async loadThreadBodies({ mail, openMail }) {
        events.push('thread:start');
        await threadWait;
        mail.threadMessages[0].body = 'Volledige eerdere mail.';
        mail.threadMessages[0].bodyLoaded = true;
        mail.threadMessages[0].bodyLoading = false;
        mail.threadMessages[0].bodyTruncated = false;
        events.push('thread:end');
        openMail(mail.id, { skipBodyFetch: true, skipThreadBodyFetch: true, skipReadPersist: true });
        return true;
      },
    },
    SoftoraMailboxImages: {
      ...imagesModule,
      getConversationImages: () => [{ alt: 'Atomisch', dataUrl: 'data:image/png;base64,AA==' }],
      async prepareForCommit() { events.push('images:start'); await imagesWait; events.push('images:end'); },
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const mail = mailbox.normalizeMailboxApiMessage({
    id: 'serve@softora.nl|inbox:atomic', mailboxId: 'inbox:atomic', folder: 'inbox',
    accountEmail: 'serve@softora.nl', from: 'Klant', email: 'klant@example.nl',
    to: 'serve@softora.nl', subject: 'Atomische conversatie', preview: 'Veilige preview',
    body: '', hasBody: true, bodyTruncated: true, recipientRoutingEvidenceKnown: true,
    receivedAt: '2026-08-20T10:00:00.000Z',
  });
  mail.body = '';
  mail.bodyLoaded = false;
  mail.hasBody = true;
  mailbox.setMails([mail]);
  const detail = mailbox.getElement('mail-detail');
  const writesBefore = detail.innerHTMLWrites;

  const pending = mailbox.openMail(mail.id);
  await Promise.resolve();
  assert.deepEqual(events, ['body:start', 'timeline:start']);
  assert.equal(detail.innerHTMLWrites, writesBefore);

  releaseBody();
  await Promise.resolve();
  assert.doesNotMatch(events.join('|'), /thread:start/);
  releaseTimeline();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.at(-1), 'thread:start');
  assert.equal(detail.innerHTMLWrites, writesBefore);

  releaseThread();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.at(-1), 'images:start');
  releaseImages();
  assert.equal((await pending).committed, true);
  assert.equal(detail.innerHTMLWrites, writesBefore + 1);
  assert.match(detail.innerHTML, /Volledige ontvangen inhoud\./);
  assert.match(detail.innerHTML, /Volledige eerdere mail\./);
  assert.deepEqual(events, [
    'body:start', 'timeline:start', 'body:end', 'timeline:end',
    'thread:start', 'thread:end', 'images:start', 'images:end',
  ]);
});

test('trage detailresponse houdt preview zichtbaar en verrijkt daarna automatisch naar ready', async () => {
  let releaseBody;
  const slowBody = new Promise((resolve) => { releaseBody = resolve; });
  const mailbox = loadMailboxHelpersForTest({
    setTimeout,
    clearTimeout,
    fetch: async (url) => {
      if (String(url) === '/api/mailbox/messages/bodies') {
        await slowBody;
        return {
          ok: true,
          json: async () => ({ ok: true, messages: [{
            id: 'coldmail:415', uid: 415, folder: 'coldmail', accountEmail: 'servec321@gmail.com',
            resolved: true, body: 'Volledige Equans-inhoud.', hasBody: true, bodyTruncated: false,
            recipientRoutingEvidenceKnown: true,
          }] }),
        };
      }
      throw new Error(`Onverwachte fallback: ${url}`);
    },
  });
  const mail = {
    id: 'servec321@gmail.com|coldmail:415', preview: 'Equans preview blijft zichtbaar.',
    body: '', hasBody: true, bodyLoaded: false, bodyLoading: false,
  };
  const loading = mailbox.index.loadBody({
    id: mail.id, requestId: 'coldmail:415', getMail: () => mail,
    account: 'servec321@gmail.com', folder: 'coldmail',
    normalizeBodyImages: (value) => value || [], normalizeOptOutUrl: String,
    getActiveMail: () => mail.id, openMail() {}, bodyFetchTimeoutMs: 100, bodyLoadDeadlineMs: 150,
  });

  assert.match(mailbox.display.renderDetailBody(mail, 'Equans preview blijft zichtbaar.'), /Equans preview blijft zichtbaar/);
  assert.match(mailbox.display.renderDetailBody(mail, 'Equans preview blijft zichtbaar.'), /Volledige inhoud wordt opgehaald/);
  releaseBody();
  await loading;
  assert.equal(mail.body, 'Volledige Equans-inhoud.');
  assert.equal(mail.bodyLoaded, true);
  assert.equal(mail.bodyLoadState, 'ready');
  assert.doesNotMatch(mailbox.display.renderDetailBody(mail, mail.body), /Laden duurde te lang|wordt opgehaald/);
});

test('premium mailbox opent oude ontvangen tekst direct uit de index zonder trage IMAP-detailvraag', async () => {
  const requests = [];
  const mailbox = loadMailboxHelpersForTest({
    fetch: async (url) => {
      if (String(url) === '/api/mailbox/messages/bodies') {
        requests.push(String(url));
        return {
          ok: true,
          json: async () => ({
            ok: true,
            messages: [{
              id: 'inbox:20',
              uid: 20,
              folder: 'inbox',
              accountEmail: 'serve@softora.nl',
              body: 'Volledige oude reactie van Leseman.',
              hasBody: true,
              bodyTruncated: false,
              bodyImageEvidenceKnown: false,
              embeddedImageCount: 0,
              originalCampaignOutbound: false,
              webdesignLinkEvidenceKnown: false,
              to: 'serve@softora.nl',
              toDisplay: 'Servé Creusen <serve@softora.nl>',
              recipientRoutingEvidenceKnown: true,
            }],
          }),
        };
      }
      if (String(url).startsWith('/api/mailbox/message?')) {
        throw new Error('De IMAP-detailroute hoort voor deze opgeslagen tekst niet nodig te zijn.');
      }
      return {
        ok: true,
        json: async () => ({
          ok: true,
          session: { authenticated: false },
          accounts: [],
          messages: [],
        }),
      };
    },
  });
  const mail = {
    id: 'serve@softora.nl|inbox:20',
    body: '',
    bodyLoading: false,
    hasBody: true,
  };

  await mailbox.index.loadBody({
    id: mail.id,
    requestId: 'inbox:20',
    getMail: () => mail,
    account: 'serve@softora.nl',
    folder: 'inbox',
    normalizeBodyImages: (images) => images || [],
    normalizeOptOutUrl: (value) => String(value || ''),
    getActiveMail: () => mail.id,
    openMail: () => {},
  });

  assert.deepEqual(requests, ['/api/mailbox/messages/bodies']);
  assert.equal(mail.body, 'Volledige oude reactie van Leseman.');
  assert.equal(mail.bodyLoaded, true);
  assert.equal(mail.bodyLoadError, '');
});

test('mailbox bodyhydratie herstelt in-place na een tijdelijke serverfout', async () => {
  let bodyCalls = 0;
  const mailbox = loadMailboxHelpersForTest({
    setTimeout,
    clearTimeout,
    fetch: async (url) => {
      if (String(url) === '/api/mailbox/messages/bodies') {
        bodyCalls += 1;
        if (bodyCalls === 1) {
          return { ok: false, status: 503, json: async () => ({ error: 'Koude auth-hydratie' }) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            messages: [{
              id: 'inbox:retry', folder: 'inbox', accountEmail: 'serve@softora.nl',
              body: 'Volledige body na veilige retry.', hasBody: true, bodyTruncated: false,
              recipientRoutingEvidenceKnown: true, to: 'serve@softora.nl',
            }],
          }),
        };
      }
      throw new Error(`Onverwachte request: ${url}`);
    },
  });
  const mail = { id: 'serve@softora.nl|inbox:retry', body: '', hasBody: true, bodyLoaded: false };
  let renderCount = 0;
  await mailbox.index.loadBody({
    id: mail.id,
    requestId: 'inbox:retry',
    getMail: () => mail,
    account: 'serve@softora.nl',
    folder: 'inbox',
    normalizeBodyImages: (images) => images || [],
    normalizeOptOutUrl: (value) => String(value || ''),
    getActiveMail: () => mail.id,
    openMail: () => { renderCount += 1; },
    bodyFetchTimeoutMs: 50,
    bodyFetchRetryDelayMs: 1,
  });

  assert.equal(bodyCalls, 2);
  assert.equal(mail.body, 'Volledige body na veilige retry.');
  assert.equal(mail.bodyLoaded, true);
  assert.equal(mail.bodyLoadError, '');
  assert.equal(mail.bodyLoading, false);
  assert.equal(renderCount, 1);
});

test('top-level body blijft zichtbaar wanneer alleen campagne-linkverrijking definitief faalt', async () => {
  const exactBody = [
    'Goedendag,',
    '',
    'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link bekijken 🎨',
  ].join('\n');
  const requests = [];
  const mailbox = loadMailboxHelpersForTest({
    fetch: async (url) => {
      requests.push(String(url));
      if (String(url) === '/api/mailbox/messages/bodies') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            messages: [{
              id: 'instantly:mhc-sent',
              folder: 'instantly',
              accountEmail: 'servecreusen@websoftora.com',
              body: exactBody,
              hasBody: true,
              bodyTruncated: false,
              bodyImageEvidenceKnown: true,
              embeddedImageCount: 0,
              originalCampaignOutbound: true,
              webdesignLinkEvidenceKnown: false,
              recipientRoutingEvidenceKnown: true,
              to: 'bestuur@mhcbe.nl',
            }],
          }),
        };
      }
      return {
        ok: false,
        status: 403,
        json: async () => ({ error: 'Linkbron niet beschikbaar' }),
      };
    },
  });
  const mail = {
    id: 'instantly:mhc-sent',
    body: '',
    hasBody: true,
    bodyLoaded: false,
  };

  await mailbox.index.loadBody({
    id: mail.id,
    requestId: mail.id,
    getMail: () => mail,
    account: 'servecreusen@websoftora.com',
    folder: 'instantly',
    normalizeBodyImages: (images) => images || [],
    normalizeOptOutUrl: (value) => String(value || ''),
    getActiveMail: () => mail.id,
    openMail() {},
  });

  assert.equal(requests.filter((url) => url === '/api/mailbox/messages/bodies').length, 1);
  assert.equal(requests.filter((url) => url.startsWith('/api/mailbox/message?')).length, 1);
  assert.equal(mail.body, exactBody);
  assert.equal(mail.bodyLoaded, true);
  assert.equal(mail.bodyLoadError, '');
  assert.equal(mail.webdesignLinkHydrationAttempted, true);
});

test('top-level bodyloader plant automatisch herstel zonder bekende inhoud te wissen', async () => {
  let calls = 0;
  const mailbox = loadMailboxHelpersForTest({
    setTimeout,
    clearTimeout,
    fetch: async (url) => {
      const requestUrl = String(url);
      if (!requestUrl.startsWith('/api/mailbox/messages/bodies') && !requestUrl.startsWith('/api/mailbox/message?')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            accounts: [{ email: 'serve@softora.nl', imapConfigured: true, smtpConfigured: true }],
            messages: [],
          }),
        };
      }
      calls += 1;
      return new Promise(() => {});
    },
  });
  const mail = { id: 'serve@softora.nl|inbox:bogaers', body: '', hasBody: true, bodyLoaded: false };
  const startedAt = Date.now();
  await mailbox.index.loadBody({
    id: mail.id,
    requestId: 'inbox:bogaers',
    getMail: () => mail,
    account: 'serve@softora.nl',
    folder: 'inbox',
    normalizeBodyImages: (images) => images || [],
    normalizeOptOutUrl: (value) => String(value || ''),
    getActiveMail: () => mail.id,
    openMail() {},
    bodyFetchTimeoutMs: 1000,
    bodyFetchRetryDelayMs: 1,
    bodyLoadDeadlineMs: 25,
  });

  assert.ok(Date.now() - startedAt < 250);
  assert.equal(calls, 1);
  assert.equal(mail.bodyLoading, false);
  assert.equal(mail.bodyLoaded, false);
  assert.equal(mail.bodyLoadError, '');
  assert.equal(mail.bodyLoadState, 'retryScheduled');
});

test('client- en providerdeadline zijn gecoördineerd en tonen vroeg een partialstatus', () => {
  assert.match(readIndexScript(), /const MAILBOX_BODY_FETCH_TIMEOUT_MS = 75_000;/);
  assert.match(readIndexScript(), /const MAILBOX_BODY_REQUEST_DEADLINE_MS = 80_000;/);
  assert.match(readIndexScript(), /const MAILBOX_BODY_PARTIAL_STATUS_DELAY_MS = 1200;/);
});

test('zichtbare body blijft partial tijdens bootstrap-tokenvervanging zonder terminale fout', async () => {
  const timers = [];
  let nextTimerId = 0;
  const mailbox = loadMailboxHelpersForTest({
    setTimeout(callback, delayMs) {
      const timer = { id: ++nextTimerId, callback, delayMs, cancelled: false };
      timers.push(timer);
      return timer.id;
    },
    clearTimeout(timerId) {
      const timer = timers.find((candidate) => candidate.id === timerId);
      if (timer) timer.cancelled = true;
    },
  });
  await mailbox.ready;
  const makePendingMail = () => mailbox.normalizeMailboxApiMessage({
    id: 'serve@softora.nl|inbox:bootstrap-slow',
    mailboxId: 'inbox:bootstrap-slow',
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    subject: 'RE: Kleine vraag over jullie website',
    hasBody: true,
    body: '',
    bodyLoaded: false,
  });

  mailbox.setMails([makePendingMail()]);
  await mailbox.openMail('serve@softora.nl|inbox:bootstrap-slow', {
    skipBodyFetch: true,
    skipThreadBodyFetch: true,
  });
  assert.match(mailbox.getElement('mail-detail').innerHTML, /Volledige inhoud wordt opgehaald…/);

  const firstDeadline = timers.find((timer) => timer.delayMs === 1200 && !timer.cancelled);
  assert.ok(firstDeadline, 'de partialstatus moet vroeg zichtbaar worden');

  const refreshedMail = makePendingMail();
  mailbox.setMails([refreshedMail]);
  await mailbox.openMail(refreshedMail.id, {
    skipBodyFetch: true,
    skipThreadBodyFetch: true,
  });
  assert.equal(
    timers.filter((timer) => timer.delayMs === 1200 && !timer.cancelled).length,
    1,
    'een refresh mag het reeds lopende zichtbare budget niet opnieuw starten'
  );

  const detail = mailbox.getElement('mail-detail');
  const loaderActivations = [];
  const originalAdd = detail.classList.add.bind(detail.classList);
  const originalSetAttribute = detail.setAttribute.bind(detail);
  detail.classList.add = (...names) => {
    if (names.includes('is-detail-pending')) loaderActivations.push('class');
    originalAdd(...names);
  };
  detail.setAttribute = (name, value) => {
    if ((name === 'aria-busy' && String(value) === 'true') || name === 'inert') {
      loaderActivations.push(name);
    }
    originalSetAttribute(name, value);
  };
  firstDeadline.callback();
  await Promise.resolve();
  await Promise.resolve();
  const html = detail.innerHTML;
  assert.match(html, /Volledige inhoud wordt opgehaald…/);
  assert.doesNotMatch(html, /Laden duurde te lang/);
  assert.equal(refreshedMail.bodyLoadError || '', '');
  assert.equal(refreshedMail.bodyLoadState, 'partial');
  assert.deepEqual(loaderActivations, []);
  assert.equal(detail.classList.contains('is-detail-pending'), false);
  assert.equal(detail.hasAttribute('inert'), false);
});

test('geaborteerde same-mail bodyflight blokkeert de directe actuele vervanger niet', async () => {
  let resolveStaleRequest;
  let bodyFetches = 0;
  const mailbox = loadMailboxHelpersForTest({
    setTimeout,
    clearTimeout,
    fetch: async (url) => {
      if (String(url) !== '/api/mailbox/messages/bodies') {
        throw new Error(`Onverwachte fallback: ${url}`);
      }
      bodyFetches += 1;
      if (bodyFetches === 1) {
        return new Promise((resolve) => { resolveStaleRequest = resolve; });
      }
      return {
        ok: true,
        json: async () => ({
          ok: true,
          messages: [{
            resolved: true,
            body: 'Actuele volledige inhoud.',
            hasBody: true,
            bodyTruncated: false,
            bodyImageEvidenceKnown: true,
            embeddedImageCount: 0,
            originalCampaignOutbound: false,
            webdesignLinkEvidenceKnown: true,
            recipientRoutingEvidenceKnown: true,
          }],
        }),
      };
    },
  });
  const mail = {
    id: 'serve@softora.nl|inbox:same-flight',
    body: '',
    hasBody: true,
    bodyLoaded: false,
  };
  const staleOwner = new AbortController();
  const currentOwner = new AbortController();
  const base = {
    id: mail.id,
    requestId: 'inbox:same-flight',
    getMail: () => mail,
    account: 'serve@softora.nl',
    folder: 'inbox',
    normalizeBodyImages: (images) => images || [],
    normalizeOptOutUrl: (value) => String(value || ''),
    getActiveMail: () => mail.id,
    openMail() {},
    bodyFetchTimeoutMs: 1000,
    bodyLoadDeadlineMs: 2000,
  };

  const staleLoad = mailbox.index.loadBody({
    ...base,
    signal: staleOwner.signal,
    isCurrent: () => !staleOwner.signal.aborted,
  });
  await Promise.resolve();
  staleOwner.abort();
  const currentLoad = mailbox.index.loadBody({
    ...base,
    signal: currentOwner.signal,
    isCurrent: () => !currentOwner.signal.aborted,
  });
  await currentLoad;

  assert.equal(bodyFetches, 2);
  assert.equal(mail.body, 'Actuele volledige inhoud.');
  assert.equal(mail.bodyLoaded, true);
  assert.equal(mail.bodyLoading, false);
  assert.equal(mail.bodyLoadState, 'ready');
  assert.equal(Boolean(mail.bodyLoadToken), false);

  resolveStaleRequest({
    ok: true,
    json: async () => ({ ok: true, messages: [{ resolved: true, body: 'Stale inhoud.' }] }),
  });
  await staleLoad;
  assert.equal(mail.body, 'Actuele volledige inhoud.');
  assert.equal(mail.bodyLoadState, 'ready');
});

test('bootstrapachtergrondrefresh annuleert een direct gestarte bodyhydratie niet', async () => {
  let messages = [];
  let campaignLoadCalls = 0;
  let resolveFreshLoad;
  let resolveBodyAttempt;
  let bodyTokenWasCurrent = null;
  const freshLoad = new Promise((resolve) => { resolveFreshLoad = resolve; });
  const bodyAttempted = new Promise((resolve) => { resolveBodyAttempt = resolve; });
  const bootstrapMail = {
    id: 'serve@softora.nl|inbox:bootstrap-body',
    body: '',
    hasBody: true,
    bodyLoaded: false,
  };
  let ownerView;
  const openMail = () => {
    const bodyToken = ownerView.getToken();
    queueMicrotask(() => {
      bodyTokenWasCurrent = ownerView.isCurrent(bodyToken);
      resolveBodyAttempt();
    });
  };
  ownerView = ownerSessionModule.createView({
    getScope: () => ({ owner: 'serve', folder: 'outreach' }),
    campaignInbox: {
      async load() {
        campaignLoadCalls += 1;
        if (campaignLoadCalls === 1) {
          return { fromBootstrap: true, messages: [bootstrapMail], sync: {} };
        }
        return freshLoad;
      },
      filterMessages(value) { return value; },
    },
    filterDeleted: (value) => value,
    getMessages: () => messages,
    setMessages: (value) => { messages = value; },
    getActiveMail: () => bootstrapMail.id,
    setActiveMail() {},
    renderList({ openLatest }) {
      if (openLatest && messages[0]) openMail(messages[0].id);
    },
    openMail,
    setStatus() {},
    getListElement: () => ({ setAttribute() {} }),
  });

  await ownerView.load();
  await bodyAttempted;

  assert.equal(campaignLoadCalls, 2);
  assert.equal(bodyTokenWasCurrent, true);
  resolveFreshLoad({ fromBootstrap: false, messages: [bootstrapMail], sync: {} });
});

test('verse mailboxlijst behoudt de reeds gehydrateerde actieve body en objectreferentie', async () => {
  let messages = [];
  let campaignLoadCalls = 0;
  let setMessagesCalls = 0;
  let resolveFreshLoad;
  let resolveFreshCommit;
  const opens = [];
  const freshLoad = new Promise((resolve) => { resolveFreshLoad = resolve; });
  const freshCommitted = new Promise((resolve) => { resolveFreshCommit = resolve; });
  const bootstrapMail = {
    id: 'serve@softora.nl|inbox:stable-body',
    body: '',
    hasBody: true,
    bodyLoaded: false,
    threadMessages: [],
  };
  const ownerView = ownerSessionModule.createView({
    getScope: () => ({ owner: 'serve', folder: 'outreach' }),
    campaignInbox: {
      async load() {
        campaignLoadCalls += 1;
        if (campaignLoadCalls === 1) {
          return { fromBootstrap: true, messages: [bootstrapMail], sync: {} };
        }
        return freshLoad;
      },
      filterMessages(value) { return value; },
    },
    filterDeleted: (value) => value,
    getMessages: () => messages,
    setMessages(value) {
      messages = value;
      setMessagesCalls += 1;
      if (setMessagesCalls === 2) resolveFreshCommit();
    },
    getActiveMail: () => bootstrapMail.id,
    setActiveMail() {},
    renderList() {},
    openMail(id, openOptions) { opens.push({ id, openOptions }); },
    setStatus() {},
    getListElement: () => ({ setAttribute() {} }),
  });

  await ownerView.load();
  bootstrapMail.body = 'Exact geladen bericht.';
  bootstrapMail.bodyLoaded = true;
  bootstrapMail.bodyLoading = false;
  resolveFreshLoad({
    fromBootstrap: false,
    messages: [{
      id: bootstrapMail.id,
      body: '',
      hasBody: true,
      bodyLoaded: false,
      threadMessages: [],
    }],
    sync: {},
  });
  await freshCommitted;

  assert.strictEqual(messages[0], bootstrapMail);
  assert.equal(messages[0].body, 'Exact geladen bericht.');
  assert.equal(messages[0].bodyLoaded, true);
  assert.deepEqual(opens, [{
    id: bootstrapMail.id,
    openOptions: { preserveVisibleDetail: true },
  }]);
});

test('ownerrefresh geeft de no-loader-intentie door aan alle behouden detailpaden', async () => {
  const current = {
    id: 'serve@softora.nl|inbox:focus-owner',
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    body: 'Bestaande inhoud.',
    bodyLoaded: true,
  };
  let messages = [current];
  const opens = [];
  const ownerView = ownerSessionModule.createView({
    getScope: () => ({ account: 'serve@softora.nl', folder: 'inbox' }),
    campaignInbox: { async load() { return null; } },
    index: {
      async hydrateOutreachContexts({ getActiveMail, openMail }) {
        openMail(getActiveMail(), { skipBodyFetch: true, skipReadPersist: true });
      },
    },
    fetch: async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [{ ...current }],
        sync: {},
      }),
    }),
    normalizeMessage: (message) => message,
    filterDeleted: (value) => value,
    getMessages: () => messages,
    setMessages: (value) => { messages = value; },
    getActiveMail: () => current.id,
    setActiveMail() {},
    renderList() {},
    openMail(id, openOptions) { opens.push({ id, openOptions }); },
    setStatus() {},
    getListElement: () => ({ setAttribute() {} }),
  });

  await ownerView.load({
    showLoader: false,
    openLatest: false,
    skipBackgroundSync: true,
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(opens.length, 2);
  assert.deepEqual(opens[0], {
    id: current.id,
    openOptions: { preserveVisibleDetail: true },
  });
  assert.deepEqual(opens[1], {
    id: current.id,
    openOptions: {
      skipBodyFetch: true,
      skipReadPersist: true,
      preserveVisibleDetail: true,
    },
  });

  const errorOpens = [];
  const errorView = ownerSessionModule.createView({
    getScope: () => ({ account: 'serve@softora.nl', folder: 'inbox' }),
    campaignInbox: { async load() { return null; } },
    fetch: async () => { throw new Error('Tijdelijke lijstfout'); },
    filterDeleted: (value) => value,
    getMessages: () => [current],
    setMessages() {},
    getActiveMail: () => current.id,
    setActiveMail() {},
    renderList() {},
    openMail(id, openOptions) { errorOpens.push({ id, openOptions }); },
    setStatus() {},
    getListElement: () => ({ setAttribute() {} }),
  });
  assert.equal(await errorView.load({
    showLoader: false,
    openLatest: false,
    preserveOnError: true,
  }), false);
  assert.deepEqual(errorOpens, [{
    id: current.id,
    openOptions: { skipReadPersist: true, preserveVisibleDetail: true },
  }]);
});

test('focus en visibilitychange verversen dezelfde zichtbare mail zonder enige laadlaagactivatie', async () => {
  const mailbox = loadMailboxHelpersForTest();
  await mailbox.ready;
  const current = mailbox.normalizeMailboxApiMessage({
    id: 'serve:inbox:lifecycle-stable',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    from: 'Stabiele afzender',
    email: 'stabiel@example.nl',
    subject: 'Zelfde mail blijft staan',
    body: 'Deze inhoud is al volledig zichtbaar.',
    bodyLoaded: true,
    receivedAt: '2026-08-21T13:00:00.000Z',
  });
  let messages = [current];
  mailbox.setMails(messages);
  await mailbox.openMail(current.id, {
    skipBodyFetch: true,
    skipThreadBodyFetch: true,
    skipContactTimeline: true,
    imagesPrepared: true,
  });

  const detail = mailbox.getElement('mail-detail');
  const loaderActivations = [];
  const originalAdd = detail.classList.add.bind(detail.classList);
  const originalSetAttribute = detail.setAttribute.bind(detail);
  detail.classList.add = (...names) => {
    if (names.includes('is-detail-pending')) loaderActivations.push('class');
    originalAdd(...names);
  };
  detail.setAttribute = (name, value) => {
    if ((name === 'aria-busy' && String(value) === 'true') || name === 'inert') {
      loaderActivations.push(name);
    }
    originalSetAttribute(name, value);
  };
  Object.defineProperty(detail, 'offsetHeight', { configurable: true, value: 877 });

  const htmlBefore = detail.innerHTML;
  const writesBefore = detail.innerHTMLWrites;
  const heightBefore = detail.offsetHeight;
  const ownerView = ownerSessionModule.createView({
    getScope: () => ({ account: 'serve@softora.nl', folder: 'inbox' }),
    campaignInbox: { async load() { return null; } },
    fetch: async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [{ ...messages[0] }],
        sync: {},
      }),
    }),
    normalizeMessage: (message) => mailbox.normalizeMailboxApiMessage(message),
    filterDeleted: (value) => value,
    getMessages: () => messages,
    setMessages: (value) => {
      messages = value;
      mailbox.setMails(value);
    },
    getActiveMail: mailbox.getActiveMail,
    setActiveMail() {},
    renderList() {},
    openMail(id, openOptions) {
      return mailbox.openMail(id, {
        ...openOptions,
        skipBodyFetch: true,
        skipThreadBodyFetch: true,
        skipContactTimeline: true,
        imagesPrepared: true,
      });
    },
    setStatus() {},
    getListElement: () => ({ setAttribute() {} }),
  });

  const documentListeners = new Map();
  const windowListeners = new Map();
  const documentRef = {
    visibilityState: 'visible',
    addEventListener(type, handler) { documentListeners.set(type, handler); },
    removeEventListener(type) { documentListeners.delete(type); },
    getElementById() { return null; },
  };
  const windowRef = {
    addEventListener(type, handler) { windowListeners.set(type, handler); },
    removeEventListener(type) { windowListeners.delete(type); },
  };
  let nextTimerId = 0;
  const timers = new Map();
  const scheduleTimeout = (handler, delay) => {
    const id = ++nextTimerId;
    timers.set(id, { delay, handler });
    return id;
  };
  const cancelTimeout = (id) => { timers.delete(id); };
  const loadOptionsSeen = [];
  let resolveNextLoad = null;
  const refreshController = refreshModule.create({
    autoStart: false,
    document: documentRef,
    window: windowRef,
    button: {
      disabled: false,
      classList: { toggle() {} },
      setAttribute() {},
      addEventListener() {},
    },
    ageLabel: { textContent: '', setAttribute() {} },
    getAccount: () => 'serve@softora.nl',
    getFolder: () => 'inbox',
    fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }),
    loadMessages: async (loadOptions) => {
      loadOptionsSeen.push(loadOptions);
      const result = await ownerView.load(loadOptions);
      resolveNextLoad?.();
      resolveNextLoad = null;
      return result;
    },
    setTimeout: scheduleTimeout,
    clearTimeout: cancelTimeout,
    setInterval: () => 1,
    clearInterval() {},
  });

  async function triggerLifecycle(handler) {
    const loaded = new Promise((resolve) => { resolveNextLoad = resolve; });
    handler();
    const scheduled = Array.from(timers.entries()).find(([, timer]) => timer.delay === 0);
    assert.ok(scheduled, 'lifecycle-event moet een directe achtergrondcontrole plannen');
    timers.delete(scheduled[0]);
    scheduled[1].handler();
    await loaded;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(refreshController.snapshot().inFlight, 0);
  }

  refreshController.start();
  await triggerLifecycle(windowListeners.get('focus'));
  documentRef.visibilityState = 'visible';
  await triggerLifecycle(documentListeners.get('visibilitychange'));

  assert.equal(loadOptionsSeen.length, 2);
  assert.ok(loadOptionsSeen.every((options) => options.showLoader === false));
  assert.deepEqual(loaderActivations, []);
  assert.equal(detail.innerHTML, htmlBefore);
  assert.equal(detail.innerHTMLWrites, writesBefore);
  assert.equal(detail.offsetHeight, heightBefore);
  assert.equal(mailbox.getActiveMail(), current.id);
  assert.equal(detail.dataset.mailboxCommittedId, current.id);
  assert.equal(detail.classList.contains('is-detail-pending'), false);
  assert.equal(detail.hasAttribute('inert'), false);
  assert.notEqual(detail.getAttribute('aria-busy'), 'true');
  refreshController.destroy();
});

test('externe gelezenstatus heropent hetzelfde detail altijd zonder laadlaag', () => {
  const mail = { id: 'serve:inbox:external-state', threadMessages: [] };
  const opens = [];
  const changed = uiStateModule.refresh({
    mails: [mail],
    controller: { reconcile(message) { return message; } },
    renderList() {},
    getActiveMail: () => mail.id,
    openMail(id, openOptions) { opens.push({ id, openOptions }); },
  });

  assert.equal(changed, false);
  assert.deepEqual(opens, [{
    id: mail.id,
    openOptions: {
      skipBodyFetch: true,
      skipThreadBodyFetch: true,
      skipReadPersist: true,
      preserveVisibleDetail: true,
    },
  }]);
});

test('achtergrondrefresh remapt een fysieke kopiewissel naar hetzelfde logische gesprek', async () => {
  const previous = {
    id: 'serve@softora.nl|inbox:42', accountEmail: 'serve@softora.nl',
    conversationId: 'conversation:serve@softora.nl|same-contact',
  };
  const unrelated = {
    id: 'serve@softora.nl|inbox:88', accountEmail: 'serve@softora.nl',
    conversationId: 'conversation:serve@softora.nl|other-contact',
  };
  const replacement = {
    id: 'serve@softora.nl|allmail:991', accountEmail: 'serve@softora.nl',
    conversationId: previous.conversationId,
  };
  let messages = [previous];
  let activeId = previous.id;
  const opens = [];
  const view = ownerSessionModule.createView({
    getScope: () => ({ account: 'serve@softora.nl', folder: 'inbox' }),
    campaignInbox: { async load() { return null; } },
    fetch: async () => ({
      ok: true,
      json: async () => ({ ok: true, messages: [unrelated, replacement], sync: {} }),
    }),
    normalizeMessage: (message) => ({ ...message }),
    getConversationKey: (message) => message?.conversationId || '',
    filterDeleted: (value) => value,
    getMessages: () => messages,
    setMessages(value) { messages = value; },
    getActiveMail: () => activeId,
    setActiveMail(value) { activeId = value; },
    renderList() {
      if (!messages.some((message) => message.id === activeId)) activeId = null;
    },
    openMail(id, openOptions) {
      activeId = id;
      opens.push({ id, openOptions });
    },
    setStatus() {},
    getListElement: () => ({ setAttribute() {} }),
  });

  assert.equal(await view.load({ showLoader: false, openLatest: false }), true);
  assert.equal(activeId, replacement.id);
  assert.deepEqual(opens, [{
    id: replacement.id,
    openOptions: { preserveVisibleDetail: true },
  }]);
});

test('legacy achtergrondsync remapt een fysieke kopiewissel zonder eerste mail of laadlaag', async () => {
  const accountEmail = 'info@softora.nl';
  const conversationId = 'conversation:info@softora.nl|peak-boom';
  const sharedMessage = {
    accountEmail,
    folder: 'inbox',
    conversationId,
    messageId: '<peak-boom@example.test>',
    from: 'Peak Boom',
    email: 'contact@peak-boom.example',
    to: accountEmail,
    subject: 'Zelfde logische gesprek',
    body: 'Deze reeds geladen inhoud blijft exact zichtbaar.',
    hasBody: true,
    recipientRoutingEvidenceKnown: true,
    receivedAt: '2026-08-26T08:00:00.000Z',
  };
  const currentRaw = { ...sharedMessage, id: 'inbox:42', mailboxId: 'inbox:42', storageFolder: 'inbox' };
  const replacementRaw = { ...sharedMessage, id: 'allmail:991', mailboxId: 'allmail:991', storageFolder: 'allmail' };
  const unrelatedRaw = {
    ...sharedMessage,
    id: 'inbox:1',
    mailboxId: 'inbox:1',
    messageId: '<unrelated@example.test>',
    conversationId: 'conversation:info@softora.nl|unrelated',
    from: 'Onverwachte eerste mail',
    email: 'unrelated@example.test',
    subject: 'Deze mag niet openen',
    body: 'Onverwante inhoud.',
    receivedAt: '2026-08-26T09:00:00.000Z',
  };
  const fetchUrls = [];
  const mailbox = loadMailboxHelpersForTest({
    fetch: async (url) => {
      const requestUrl = String(url);
      fetchUrls.push(requestUrl);
      if (requestUrl === '/api/mailbox/sync') {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      if (requestUrl.startsWith('/api/mailbox/messages?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, messages: [unrelatedRaw, replacementRaw], sync: {} }),
        };
      }
      throw new Error(`Onverwachte testrequest: ${requestUrl}`);
    },
  });
  await mailbox.ready;
  mailbox.setActiveFolder('inbox');
  const current = mailbox.normalizeMailboxApiMessage(currentRaw, { folder: 'inbox' });
  const replacement = mailbox.normalizeMailboxApiMessage(replacementRaw, { folder: 'inbox' });
  mailbox.setMails([current]);
  await mailbox.openMail(current.id, {
    skipBodyFetch: true,
    skipThreadBodyFetch: true,
    skipReadPersist: true,
    imagesPrepared: true,
  });

  const detail = mailbox.getElement('mail-detail');
  const list = mailbox.getElement('mail-results-scroll');
  list.scrollTop = 431;
  const loaderActivations = [];
  const originalAdd = detail.classList.add.bind(detail.classList);
  const originalSetAttribute = detail.setAttribute.bind(detail);
  detail.classList.add = (...names) => {
    if (names.includes('is-detail-pending')) loaderActivations.push('class');
    originalAdd(...names);
  };
  detail.setAttribute = (name, value) => {
    if ((name === 'aria-busy' && String(value) === 'true') || name === 'inert') loaderActivations.push(name);
    originalSetAttribute(name, value);
  };
  const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(detail, 'innerHTML');
  const renderedDetails = [];
  Object.defineProperty(detail, 'innerHTML', {
    configurable: true,
    get: innerHtmlDescriptor.get,
    set(value) {
      renderedDetails.push(String(value));
      innerHtmlDescriptor.set.call(this, value);
    },
  });
  const loadOptionsSeen = [];

  await mailbox.index.syncInBackground({
    account: accountEmail,
    folder: 'inbox',
    loadMessages(loadOptions) {
      loadOptionsSeen.push(loadOptions);
      return mailbox.loadMailboxMessages(loadOptions);
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(JSON.parse(JSON.stringify(loadOptionsSeen)), [{
    showLoader: false,
    skipBackgroundSync: true,
    openLatest: false,
    preserveOnError: true,
  }]);
  assert.deepEqual(fetchUrls, [
    '/api/mailbox/sync',
    '/api/mailbox/messages?account=info%40softora.nl&folder=inbox&limit=50',
  ]);
  assert.equal(mailbox.getActiveMail(), replacement.id);
  assert.equal(detail.dataset.mailboxCommittedId, replacement.id);
  assert.equal(renderedDetails.length, 1);
  assert.match(renderedDetails[0], /Deze reeds geladen inhoud blijft exact zichtbaar\./);
  assert.doesNotMatch(renderedDetails[0], /Deze mag niet openen|Onverwante inhoud/);
  assert.deepEqual(loaderActivations, []);
  assert.equal(detail.classList.contains('is-detail-pending'), false);
  assert.equal(detail.hasAttribute('inert'), false);
  assert.notEqual(detail.getAttribute('aria-busy'), 'true');
  assert.equal(list.scrollTop, 431);
});

test('focus en visibilitychange houden outreach stabiel door beide providerbatches', async () => {
  const mailbox = loadMailboxHelpersForTest();
  await mailbox.ready;
  const current = mailbox.normalizeMailboxApiMessage({
    id: 'contact:serve:lifecycle-outreach',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    owner: 'serve',
    canonicalOwner: 'serve',
    externalContactEmail: 'stabiel@example.nl',
    from: 'Stabiele outreachreactie',
    email: 'stabiel@example.nl',
    subject: 'Zelfde outreachgesprek blijft staan',
    body: 'Deze outreachinhoud is al volledig zichtbaar.',
    bodyLoaded: true,
    receivedAt: '2026-08-21T13:00:00.000Z',
  });
  let messages = [current];
  mailbox.setMails(messages);
  await mailbox.openMail(current.id, {
    skipBodyFetch: true,
    skipThreadBodyFetch: true,
    skipContactTimeline: true,
    imagesPrepared: true,
  });

  const detail = mailbox.getElement('mail-detail');
  const loaderActivations = [];
  const originalAdd = detail.classList.add.bind(detail.classList);
  const originalSetAttribute = detail.setAttribute.bind(detail);
  detail.classList.add = (...names) => {
    if (names.includes('is-detail-pending')) loaderActivations.push('class');
    originalAdd(...names);
  };
  detail.setAttribute = (name, value) => {
    if ((name === 'aria-busy' && String(value) === 'true') || name === 'inert') {
      loaderActivations.push(name);
    }
    originalSetAttribute(name, value);
  };
  Object.defineProperty(detail, 'offsetHeight', { configurable: true, value: 877 });
  const htmlBefore = detail.innerHTML;
  const writesBefore = detail.innerHTMLWrites;
  const heightBefore = detail.offsetHeight;
  const campaignLoads = [];
  const ownerView = ownerSessionModule.createView({
    getScope: () => ({ owner: 'serve', folder: 'outreach' }),
    campaignInbox: {
      async load(folder, normalizeMessage, _fetch, options) {
        campaignLoads.push({ folder, owner: options.owner });
        return {
          fromBootstrap: false,
          fromCache: false,
          messages: [{ ...messages[0] }].map(normalizeMessage),
          sync: {},
        };
      },
      filterMessages: (value) => value,
    },
    normalizeMessage: (message) => mailbox.normalizeMailboxApiMessage(message),
    filterDeleted: (value) => value,
    getMessages: () => messages,
    setMessages: (value) => { messages = value; mailbox.setMails(value); },
    getActiveMail: mailbox.getActiveMail,
    setActiveMail() {},
    renderList() {},
    openMail(id, openOptions) {
      return mailbox.openMail(id, {
        ...openOptions,
        skipBodyFetch: true,
        skipThreadBodyFetch: true,
        skipContactTimeline: true,
        imagesPrepared: true,
      });
    },
    setStatus() {},
    getListElement: () => ({ setAttribute() {} }),
  });

  const documentListeners = new Map();
  const windowListeners = new Map();
  const documentRef = {
    visibilityState: 'visible',
    addEventListener(type, handler) { documentListeners.set(type, handler); },
    removeEventListener(type) { documentListeners.delete(type); },
    getElementById() { return null; },
  };
  const windowRef = {
    addEventListener(type, handler) { windowListeners.set(type, handler); },
    removeEventListener(type) { windowListeners.delete(type); },
  };
  let nextTimerId = 0;
  const timers = new Map();
  const loadOptionsSeen = [];
  const providerUrls = [];
  const refreshController = refreshModule.create({
    autoStart: false,
    document: documentRef,
    window: windowRef,
    button: { disabled: false, classList: { toggle() {} }, setAttribute() {}, addEventListener() {} },
    ageLabel: { textContent: '', setAttribute() {} },
    getFolder: () => 'outreach',
    getOwner: () => 'serve',
    fetch: async (url) => {
      providerUrls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
    loadMessages: async (loadOptions) => {
      loadOptionsSeen.push(loadOptions);
      return ownerView.load(loadOptions);
    },
    setTimeout(handler, delay) {
      const id = ++nextTimerId;
      timers.set(id, { delay, handler });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    setInterval: () => 1,
    clearInterval() {},
  });

  async function triggerLifecycle(handler) {
    const expectedLoads = loadOptionsSeen.length + 2;
    const expectedRequests = providerUrls.length + 2;
    handler();
    const scheduled = Array.from(timers.entries()).find(([, timer]) => timer.delay === 0);
    assert.ok(scheduled, 'outreach-lifecycle moet een directe achtergrondcontrole plannen');
    timers.delete(scheduled[0]);
    scheduled[1].handler();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (
        loadOptionsSeen.length === expectedLoads &&
        providerUrls.length === expectedRequests &&
        refreshController.snapshot().inFlight === 0
      ) break;
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(loadOptionsSeen.length, expectedLoads);
    assert.equal(providerUrls.length, expectedRequests);
    assert.equal(refreshController.snapshot().inFlight, 0);
  }

  refreshController.start();
  await triggerLifecycle(windowListeners.get('focus'));
  documentRef.visibilityState = 'hidden';
  documentListeners.get('visibilitychange')();
  documentRef.visibilityState = 'visible';
  await triggerLifecycle(documentListeners.get('visibilitychange'));

  assert.deepEqual(providerUrls, [
    '/api/mailbox/sync', '/api/mailbox/instantly/sync',
    '/api/mailbox/sync', '/api/mailbox/instantly/sync',
  ]);
  assert.equal(campaignLoads.length, 4);
  assert.ok(campaignLoads.every((load) => load.folder === 'outreach' && load.owner === 'serve'));
  assert.ok(loadOptionsSeen.every((options) => options.showLoader === false && options.openLatest === false));
  assert.deepEqual(loaderActivations, []);
  assert.equal(detail.innerHTML, htmlBefore);
  assert.equal(detail.innerHTMLWrites, writesBefore);
  assert.equal(detail.offsetHeight, heightBefore);
  assert.equal(mailbox.getActiveMail(), current.id);
  assert.equal(detail.dataset.mailboxCommittedId, current.id);
  assert.equal(detail.classList.contains('is-detail-pending'), false);
  assert.equal(detail.hasAttribute('inert'), false);
  assert.notEqual(detail.getAttribute('aria-busy'), 'true');
  refreshController.destroy();
});

test('threadbody-spinner eindigt eveneens binnen het gedeelde laadbudget', async () => {
  let calls = 0;
  const mailbox = loadMailboxHelpersForTest({
    setTimeout,
    clearTimeout,
    fetch: async (url) => {
      const requestUrl = String(url);
      if (requestUrl === '/api/mailbox/messages/bodies' || requestUrl.startsWith('/api/mailbox/message?')) {
        calls += 1;
        return new Promise(() => {});
      }
      return {
        ok: true,
        json: async () => ({ ok: true, accounts: [], messages: [] }),
      };
    },
  });
  const threadMessage = {
    id: 'inbox:slow-thread',
    mailboxId: 'inbox:slow-thread',
    accountEmail: 'serve@softora.nl',
    storageFolder: 'inbox',
    hasBody: true,
    body: '',
    bodyLoaded: false,
    recipientRoutingEvidenceKnown: true,
  };
  const mail = {
    id: 'serve@softora.nl|inbox:root',
    accountEmail: 'serve@softora.nl',
    threadMessages: [threadMessage],
  };
  const startedAt = Date.now();

  await mailbox.index.loadThreadBodies({
    mail,
    normalizeBodyImages: (images) => images || [],
    normalizeOptOutUrl: (value) => String(value || ''),
    getActiveMail: () => mail.id,
    openMail() {},
    bodyFetchTimeoutMs: 1000,
    bodyFetchRetryDelayMs: 1,
    bodyLoadDeadlineMs: 25,
  });

  assert.ok(Date.now() - startedAt < 250);
  assert.equal(calls, 1);
  assert.equal(mail.threadBodiesLoading, false);
  assert.equal(threadMessage.bodyLoading, false);
  assert.equal(threadMessage.bodyLoadError, 'Laden duurde te lang. Opnieuw proberen.');
});

test('top-level bodyfout vervangt de spinner en kan het bericht opnieuw laden', async () => {
  const mailbox = loadMailboxHelpersForTest({
    fetch: async (url) => {
      if (String(url) === '/api/mailbox/messages/bodies') {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            messages: [{
              id: 'inbox:retry-root',
              body: 'Hersteld volledig bericht.',
              hasBody: true,
              bodyLoaded: true,
            }],
          }),
        };
      }
      if (String(url).startsWith('/api/mailbox/messages?')) return new Promise(() => {});
      return { ok: true, json: async () => ({ ok: true, messages: [] }) };
    },
  });
  await mailbox.ready;
  const mail = mailbox.normalizeMailboxApiMessage({
    id: 'inbox:retry-root',
    mailboxId: 'inbox:retry-root',
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    hasBody: true,
    bodyLoaded: false,
  });
  mail.bodyLoadError = 'Laden duurde te lang. Opnieuw proberen.';
  mailbox.setMails([mail]);
  await mailbox.openMail(mail.id, { skipBodyFetch: true, skipContactTimeline: true });

  const failedHtml = mailbox.getElement('mail-detail').innerHTML;
  assert.match(failedHtml, /data-mailbox-action="retry-mail-body"/);
  assert.doesNotMatch(failedHtml, /Volledige inhoud wordt opgehaald…/);

  assert.equal(mailbox.index.retryBody({
    id: mail.id,
    getMail: () => mail,
    loadMessageBody: (id) => mailbox.openMail(id, { skipContactTimeline: true, skipReadPersist: true }),
    openMail: mailbox.openMail,
  }), true);
  assert.equal(mailbox.getElement('mail-detail').classList.contains('is-detail-pending'), true);
  assert.equal(mailbox.getElement('mail-detail').hasAttribute('inert'), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mail.body, 'Hersteld volledig bericht.');
  assert.equal(mail.bodyLoaded, true);
  const recoveredHtml = mailbox.getElement('mail-detail').innerHTML;
  assert.match(recoveredHtml, /Hersteld volledig bericht\./);
  assert.doesNotMatch(recoveredHtml, /detail-mail-load-error|Volledige inhoud wordt opgehaald…/);
});

test('ownerwissel annuleert bodyhydratie zonder foutkaart of late render', async () => {
  const mailbox = loadMailboxHelpersForTest({
    setTimeout,
    clearTimeout,
    fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
  });
  const mail = { id: 'serve@softora.nl|inbox:cancel', body: '', hasBody: true, bodyLoaded: false };
  const controller = new AbortController();
  let current = true;
  let renders = 0;
  const loading = mailbox.index.loadBody({
    id: mail.id,
    requestId: 'inbox:cancel',
    getMail: () => mail,
    account: 'serve@softora.nl',
    folder: 'inbox',
    normalizeBodyImages: (images) => images || [],
    normalizeOptOutUrl: (value) => String(value || ''),
    getActiveMail: () => mail.id,
    openMail: () => { renders += 1; },
    isCurrent: () => current,
    signal: controller.signal,
    bodyFetchTimeoutMs: 50,
    bodyFetchRetryDelayMs: 1,
  });
  current = false;
  controller.abort();
  await loading;
  assert.equal(mail.bodyLoading, false);
  assert.equal(mail.bodyLoadError || '', '');
  assert.equal(renders, 0);
});

test('premium mailbox laat een late body-response nooit een nieuwere selectie overschrijven', async () => {
  let resolveResponse;
  const response = new Promise((resolve) => { resolveResponse = resolve; });
  const mailbox = loadMailboxHelpersForTest({
    fetch: async (url) => String(url).startsWith('/api/mailbox/message?')
      ? response
      : {
          ok: true,
          json: async () => ({
            ok: true,
            accounts: [{ email: 'serve@softora.nl', imapConfigured: true, smtpConfigured: true }],
            messages: [],
          }),
        },
  });
  const mail = {
    id: 'serve:inbox:1',
    preview: 'Voorbeeld',
    body: '',
    bodyImages: [],
    optOutUrl: '',
    bodyLoading: false,
  };
  let activeMail = mail.id;
  const opened = [];
  const loading = mailbox.index.loadBody({
    id: mail.id,
    requestId: '1',
    getMail: () => mail,
    account: 'serve@softora.nl',
    folder: 'inbox',
    normalizeBodyImages: (images) => images,
    normalizeOptOutUrl: (value) => value,
    getActiveMail: () => activeMail,
    openMail: (id) => opened.push(id),
  });

  activeMail = 'serve:inbox:2';
  resolveResponse({
    ok: true,
    json: async () => ({
      ok: true,
      message: { body: 'Volledig bericht', bodyImages: [], optOutUrl: '' },
    }),
  });
  await loading;

  assert.equal(mail.body, 'Volledig bericht');
  assert.deepEqual(opened, []);
});

test('premium mailbox ruimt Martijns Gmail-handtekening net zo schoon op als Servés mail', () => {
  const html = renderMailboxBodyForTest([
    '[https://ci3.googleusercontent.com/mail-sig/AIorK4xO039AXHNmO6ZlXuH8i0cEctngV0Ftl-cF9usjh8mD9halM4-1NEbcTR5bMI4_9hVevZAMmacdAxt5]',
    '',
    'Muziekschool Pedro van Meel',
    '',
    '--',
    '',
    'Muziekschool Pedro van Meel',
    'Piano & Keyboarddocent',
    '[https://ci3.googleusercontent.com/mail-sig/AIorK4xD5yVpdOdHdlYOPUiaBdnN7zb6OBxpDoq6jOp8n3vcDIsyFUcejkDgWeaiviNV0rt7OOXeynE]',
    'E-mail: keyboardpianoleraar@gmail.com [keyboardpianoleraar@gmail.com]',
    'Website: www.pianokeyboardleraar.nl [http://www.pianokeyboardleraar.nl]',
    'Tel: 06-54967032',
  ].join('\n'));

  assert.doesNotMatch(html, /googleusercontent\.com/i);
  assert.doesNotMatch(html, /keyboardpianoleraar@gmail\.com\s*\[keyboardpianoleraar@gmail\.com\]/i);
  assert.equal((html.match(/Muziekschool Pedro van Meel/g) || []).length, 1);
  assert.doesNotMatch(html, />--</);
  assert.match(
    html,
    /Website: <a href="http:\/\/www\.pianokeyboardleraar\.nl" target="_blank" rel="noopener noreferrer">www\.pianokeyboardleraar\.nl<\/a>/
  );
  assert.doesNotMatch(html, /\[http:\/\/www\.pianokeyboardleraar\.nl\]/);
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
  assert.doesNotMatch(pageSource, /\.detail-mail-section-quote|background:\s*#f8f4ef/);
  assert.match(pageSource, /\.detail-mail-section-history-sent \{[\s\S]*background:\s*rgba\(155,35,85,\.055\);[\s\S]*border-left:\s*3px solid rgba\(155,35,85,\.42\);/);
  assert.match(pageSource, /\.detail-mail-section-signature \{[\s\S]*padding-top:\s*16px;[\s\S]*color:\s*var\(--text-mid\);/);
  assert.doesNotMatch(pageSource, /\.detail-mail-section-signature \{[\s\S]*border-top:\s*1px dashed var\(--border\);/);
});

test('premium mailbox search heeft geen kruisjes en pagineert pas onder de resultaten', () => {
  const pageSource = readPage();
  const discoverySource = fs.readFileSync(
    path.resolve(__dirname, '../../assets/premium-mailbox-discovery.js'),
    'utf8'
  );
  assert.equal((pageSource.match(/id="mailbox-search-input"/g) || []).length, 1);
  assert.doesNotMatch(pageSource, /mailbox-search-clear|mail-search-clear|Zoekopdracht wissen/);
  assert.match(pageSource, /input\[type="search"\]::\-webkit-search-cancel-button[\s\S]*display:\s*none/);
  assert.match(pageSource, /input\[type="search"\]::\-ms-clear[\s\S]*display:\s*none/);
  assert.ok(
    pageSource.indexOf('id="mail-items"') < pageSource.indexOf('id="mailbox-search-more"'),
    'de vervolgknop hoort na de resultatenlijst te staan'
  );
  assert.match(pageSource, /class="mail-results-scroll" id="mail-results-scroll"/);
  assert.match(pageSource, /premium-mailbox-discovery\.js\?v=20260826a/);
  assert.match(pageSource, /premium-mailbox\.js\?v=20260826a/);
  assert.doesNotMatch(discoverySource, /clearButton|mailbox-search-clear/);
  assert.match(discoverySource, /if \(searchLoading && append\) return false/);
  assert.match(discoverySource, /moreButton\.disabled = loading/);
  assert.match(discoverySource, /setMoreState\(\{ visible: Boolean\(nextCursor\) \}\)/);
});

test('ownerwissel wist actieve zoekscope en houdt geldige Martijnresultaten zichtbaar bij HTTP 207', async () => {
  campaignInboxModule.setOwner('serve', { persist: false });
  const martijnMessage = {
    id: 'inbox:martijn-owner-switch',
    mailboxId: 'inbox:martijn-owner-switch',
    accountEmail: 'martijn@softora.nl',
    folder: 'inbox',
    from: 'Nieuwe Martijnreactie',
    email: 'contact@example.nl',
    subject: 'Re: Nieuw webdesign',
    preview: 'Dit gesprek hoort zichtbaar te blijven.',
    body: 'Dit gesprek hoort zichtbaar te blijven.',
    hasBody: true,
    bodyLoaded: true,
    bodyTruncated: false,
    bodyImages: [],
    bodyImagesTruncated: false,
    threadMessages: [],
    receivedAt: '2026-08-24T14:00:00.000Z',
    campaign: {
      account: 'martijn@softora.nl',
      company: 'Voorbeeldbedrijf',
      actionRequired: true,
    },
  };
  let campaignLoads = 0;
  let refreshController = null;
  const mailbox = loadMailboxHelpersForTest({
    fetch: async (url) => {
      if (String(url).startsWith('/api/mailbox/search?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            totalCount: 2,
            nextCursor: '',
            messages: [1, 2].map((index) => ({
              id: `inbox:serve-search-${index}`,
              mailboxId: `inbox:serve-search-${index}`,
              accountEmail: 'serve@softora.nl',
              folder: 'inbox',
              from: `Oud zoekresultaat ${index}`,
              email: `zoekresultaat-${index}@example.nl`,
              subject: 'Bestaande zoekopdracht',
              preview: 'Zoekresultaat uit de mailbox van Servé.',
              receivedAt: `2026-08-24T13:0${index}:00.000Z`,
              canonicalOwner: 'serve',
              externalContactEmail: `zoekresultaat-${index}@example.nl`,
              campaign: { account: 'serve@softora.nl', company: `Zoekbedrijf ${index}` },
            })),
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, messages: [] }),
      };
    },
    campaignInboxLoad: async (_folder, normalizeMessage, _fetch, options) => {
      campaignLoads += 1;
      assert.equal(options.owner, 'martijn');
      return {
        fromBootstrap: false,
        fromCache: false,
        messages: [normalizeMessage({ ...martijnMessage })],
        sync: { warming: false, stale: false },
      };
    },
  });

  try {
    await mailbox.ready;
    const searchInput = mailbox.getElement('mailbox-search-input');
    const searchStatus = mailbox.getElement('mailbox-search-status');
    searchInput.value = 'bestaande zoekopdracht';
    assert.equal(await mailbox.getDiscoveryController().runSearch(), true);
    assert.equal(mailbox.getDiscoveryController().isSearchActive(), true);
    assert.equal(searchStatus.textContent, '2 gesprekken gevonden');
    assert.equal(mailbox.getMails().length, 2);

    assert.equal(mailbox.switchCampaignMailboxOwner('martijn', { persist: false }), 'martijn');
    for (let attempt = 0; attempt < 10 && mailbox.getMails().length !== 1; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    assert.equal(mailbox.getDiscoveryController().isSearchActive(), false);
    assert.equal(searchInput.value, '');
    assert.equal(searchStatus.hidden, true);
    assert.equal(searchStatus.textContent, '');
    assert.equal(mailbox.getMails().length, 1);
    assert.equal(mailbox.getMails()[0].accountEmail, 'martijn@softora.nl');
    assert.doesNotMatch(mailbox.getElement('mail-items').innerHTML, /Mailbox wordt bijgewerkt/);

    const ageLabel = {
      textContent: '',
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
    };
    refreshController = refreshModule.create({
      autoStart: false,
      ageLabel,
      getFolder: () => 'outreach',
      getOwner: () => campaignInboxModule.getOwner(),
      fetch: async (url) => String(url) === '/api/mailbox/sync'
        ? {
            ok: true,
            status: 207,
            json: async () => ({ ok: false, results: [{ account: 'martijn@softora.nl', ok: false }] }),
          }
        : { ok: true, status: 200, json: async () => ({ ok: true }) },
      loadMessages: mailbox.loadMailboxMessages,
      setTimeout: () => 1,
      clearTimeout() {},
    });

    assert.equal(await refreshController.refresh(), false);
    assert.equal(ageLabel.textContent, 'Deels bijgewerkt');
    assert.equal(mailbox.getMails().length, 1);
    assert.equal(mailbox.getMails()[0].accountEmail, 'martijn@softora.nl');
    assert.doesNotMatch(mailbox.getElement('mail-items').innerHTML, /Mailbox wordt bijgewerkt/);
    assert.equal(campaignLoads, 3);
  } finally {
    refreshController?.destroy();
    campaignInboxModule.setOwner('serve', { persist: false });
  }
});

test('premium mailbox houdt gedrag uit inline handlers', () => {
  const pageSource = readPage();
  const scriptSource = readScript();
  const listSource = readListScript();
  const composeControllerSource = readComposeControllerScript();

  assert.doesNotMatch(pageSource, /\son[a-z]+=/);
  assert.doesNotMatch(scriptSource, /onclick=/);
  assert.doesNotMatch(pageSource, /data-mailbox-action="open-compose"/);
  assert.doesNotMatch(pageSource, /id="search-input"/);
  assert.doesNotMatch(pageSource, /class="topbar-search"/);
  assert.doesNotMatch(pageSource, /class="btn-compose"/);
  assert.match(pageSource, /data-mailbox-action="rewrite-compose"/);
  assert.doesNotMatch(pageSource, /data-mailbox-action="set-folder"/);
  assert.match(listSource, /data-mailbox-action="open-mail"/);
  assert.doesNotMatch(scriptSource, /data-mailbox-action="toggle-star"/);
  assert.doesNotMatch(scriptSource, />\s*Markeren\s*</);
  assert.match(scriptSource, /data-mailbox-action="\$\{command\}"/);
  assert.match(scriptSource, /mailboxComposeController\.handleAction/);
  assert.match(composeControllerSource, /action === 'new-message'/);
  assert.match(scriptSource, /function escapeHtml\(value\)/);
  assert.match(readIndexScript(), /function bindImageRecovery\([\s\S]*document\.addEventListener\('error',[\s\S]*\[data-mailbox-inline-image\][\s\S]*mail\.imageRecoveryAttempted = true;[\s\S]*void loadMessageBody\(mail\.id, \{ preserveVisibleDetail: true \}\);[\s\S]*, true\);/);
  assert.match(scriptSource, /SoftoraMailboxIndex\?\.bindImageRecovery\(\{ getActiveMail: \(\) => activeMail, getMail: findMailById, loadMessageBody: \(id, loadOptions = \{\}\) => openMail\(id, \{ \.\.\.loadOptions, skipReadPersist: true \}\), openMail \}\)/);
  assert.match(scriptSource, /function renderLinkedMailboxText\(value, options\)/);
  assert.match(scriptSource, /renderLinkedMailboxText\(value, options\)/);
  assert.match(scriptSource, /renderMailBody\(detailBody, m\.bodyImages, \{[\s\S]*rootIncomingMeta,[\s\S]*threadImagesReady: true/);
});

test('geopende mail staat als één rustig mailblok met antwoordactie na het ontvangen bericht', () => {
  const pageSource = readPage();
  const scriptSource = readScript();
  const stabilitySource = readDetailStabilityScript();

  assert.match(stabilitySource, /options\.setActiveMail\?\.\(mail\.id\);[\s\S]*options\.select\?\.\(mail\.id\);[\s\S]*options\.onSelect\?\.\(mail, openOptions\);[\s\S]*options\.renderList\?\.\(\{ openLatest: false \}\);[\s\S]*setPending\(mail\.id, \{ keepVisible: keepDetailVisible \}\);/);
  assert.match(scriptSource, /onSelect: \(mail, openOptions\) => \{ if \(mail\.unread\) window\.SoftoraMailboxUiState\.markReadOnOpen\(/);
  assert.match(scriptSource, /needsRootHydration: \(mail, openOptions\) => \(openOptions\.forceRootHydration \|\| !mail\.bodyLoaded \|\| mail\.recipientRoutingNeedsHydration\) && !openOptions\.skipBodyFetch/);
  assert.match(readIndexScript(), /function hasUnverifiedLegacyMedia\(message\)/);
  assert.match(readIndexScript(), /bodyLoaded:[\s\S]*Boolean\(message\.body\)[\s\S]*!legacyMediaNeedsHydration/);
  assert.match(readIndexScript(), /mail\.bodyImagesTruncated = false;/);
  assert.match(readIndexScript(), /String\(getActiveMail\(\)\) === String\(id\)/);
  assert.match(readIndexScript(), /function loadThreadBodies\(/);
  assert.match(scriptSource, /shouldHydrateThread: \(mail, openOptions\) => !openOptions\.skipThreadBodyFetch && activeFolder === 'outreach'/);
  assert.match(scriptSource, /const detailBody = m\.safeBodyPreviewOnly \? \(m\.preview \|\| ''\) : \(m\.body \|\| m\.preview \|\| ''\);/);
  assert.match(readDisplayScript(), /Volledige inhoud wordt opgehaald…/);

  assert.match(scriptSource, /<article class="detail-mail-block">/);
  assert.match(scriptSource, /<div class="detail-subject-row">/);
  assert.match(readDisplayScript(), /function formatDetailSubject\(value\)/);
  assert.match(readDisplayScript(), /replace\(\/\^email received\\s\*\-\\s\*\/i, ''\)/);
  assert.match(scriptSource, /SoftoraMailboxDiscovery\.getContactDossier\(m,/);
  assert.match(scriptSource, /<div class="detail-subject">\$\{escapeHtml\(detailTitle\)\}<\/div>/);
  assert.doesNotMatch(scriptSource, /detail-more|Meer opties/);
  assert.doesNotMatch(pageSource, /\.detail-more/);
  assert.match(scriptSource, /<div class="detail-divider" aria-hidden="true"><\/div>/);
  assert.match(scriptSource, /function renderMailboxConversationAction\(action, mailId, options = \{\}\)[\s\S]*const label = isNewMessage \? 'Nieuw bericht sturen' : 'Beantwoorden'/);
  assert.match(scriptSource, /const conversationAction = options && options\.mail[\s\S]*getConversationAction/);
  assert.match(scriptSource, /data-mailbox-message-key="\$\{escapeHtml\(messageKey\)\}"/);
  assert.match(scriptSource, /mailboxComposeController\.handleAction\(action, composeActionId, \{[\s\S]*messageKey: actionEl\.getAttribute\('data-mailbox-message-key'\)/);
  assert.match(fs.readFileSync(composeControllerScriptPath, 'utf8'), /resolveReplySource\(mail, requestedMessageKey[\s\S]*normalizeRequestedMessageKey\(requestedMessageKey\)[\s\S]*getActionMessageKey\(message\) === requested[\s\S]*exactAction\?\.kind !== 'reply'[\s\S]*open het bericht opnieuw/);
  assert.match(scriptSource, /section && section\.type === 'quote'[\s\S]*renderedSections\.push\(rootActionHtml\)/);
  assert.match(scriptSource, /renderMailboxRootIncomingMeta\(m\)/);
  assert.match(scriptSource, /class="detail-hide-conversation"[\s\S]*Alleen uit Softora verbergen/);
  assert.match(pageSource, /\.detail-mail-block \{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*background:\s*var\(--card\);/);
  assert.match(pageSource, /\.detail-mail-block \{[\s\S]*width:\s*min\(100%,\s*900px\);[\s\S]*max-width:\s*900px;[\s\S]*margin:\s*0 auto;/);
  assert.match(pageSource, /\.detail-mail-block \{[^}]*min-height:\s*min\(620px,\s*calc\(100vh - 92px\)\)/);
  assert.match(pageSource, /@media \(max-width:\s*920px\) \{[\s\S]*\.detail-mail-block \{ min-height:\s*min\(560px,\s*calc\(100vh - 68px\)\); \}/);
  assert.match(pageSource, /\.detail-body-text \{[\s\S]*background:\s*var\(--card\);[\s\S]*border:\s*0;[\s\S]*font-family:\s*var\(--premium-sidebar-font-sans, 'Inter', sans-serif\);/);
  assert.match(pageSource, /\.detail-subject \{[\s\S]*font-size:\s*clamp\(19px,\s*1\.5vw,\s*24px\);/);
  assert.match(pageSource, /\.detail-avatar \{[\s\S]*width:\s*42px;[\s\S]*height:\s*42px;/);
  assert.match(pageSource, /\.detail-body-text \{[\s\S]*font-size:\s*14px;[\s\S]*line-height:\s*1\.75;/);
  assert.match(pageSource, /\.detail-footer \{[^}]*margin:\s*0;[^}]*padding:\s*2px 0 16px;[^}]*border-bottom:\s*0;/);
  assert.match(pageSource, /\.detail-mail-section-received > \.detail-footer \{[^}]*margin-top:\s*2px;[^}]*padding:\s*8px 0 0;/);
  assert.doesNotMatch(pageSource, /\.detail-footer \{[^}]*border-bottom:\s*1px/);
  assert.match(pageSource, /\.detail-reply \{[^}]*border:\s*1px solid rgba\(155,35,85,\.34\);[^}]*border-radius:\s*6px;[^}]*padding:\s*8px 14px;[^}]*background:\s*var\(--card\);[^}]*color:\s*var\(--crimson\);/);
  assert.match(pageSource, /\.detail-reply:hover \{[^}]*border-color:\s*var\(--crimson\);[^}]*background:\s*rgba\(155,35,85,\.06\);/);
  assert.match(pageSource, /\.detail-reply:focus-visible \{[^}]*outline:\s*2px solid rgba\(155,35,85,\.32\);/);
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

test('premium mailbox verbergt een technische webdesign-url achter alleen het woord link', () => {
  const url = 'https://www.softora.nl/webdesign/de-vyldre?cid=safe-dedupe-20260615-row-1891-d84e3e0cb2&sender=serve';
  const html = renderMailboxBodyForTest(
    `Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link [${url}] bekijken 🎨`,
    [],
    { mail: { webdesignLinkEvidenceKnown: true, webdesignLinkUrl: url } }
  );

  assert.match(
    html,
    /via deze <a class="detail-mail-cta-link" href="https:\/\/www\.softora\.nl\/webdesign\/de-vyldre\?cid=safe-dedupe-20260615-row-1891-d84e3e0cb2&amp;sender=serve" target="_blank" rel="noopener noreferrer">link<\/a> bekijken 🎨/
  );
  assert.match(readPage(), /\.detail-mail-cta-link,\s*\.detail-mail-cta-link:visited\s*\{[^}]*color:\s*#0563c1;[^}]*text-decoration:\s*underline;/s);
  assert.match(readPage(), /\.detail-mail-cta-link:hover\s*\{[^}]*color:\s*#004b91;[^}]*text-decoration-thickness:\s*2px;/s);
  assert.match(readPage(), /\.detail-mail-cta-link:focus-visible\s*\{[^}]*outline:\s*2px solid rgba\(5,99,193,.45\);[^}]*outline-offset:\s*2px;/s);
  assert.doesNotMatch(html, />deze link<\/a>/);
  assert.doesNotMatch(html, />https:\/\/www\.softora\.nl\/webdesign\/de-vyldre/);
  assert.doesNotMatch(html, /\[https:\/\//);
});

test('premium mailbox houdt bekijken direct achter een afgebroken deze-link-verwijzing', () => {
  const url = 'https://www.softora.nl/webdesign/seats2meet?cid=mail-row&sender=serve';
  const html = renderMailboxBodyForTest([
    'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via',
    `deze link [${url}]`,
    '',
    'bekijken 🎨',
  ].join('\n'), [], {
    mail: { webdesignLinkEvidenceKnown: true, webdesignLinkUrl: url },
  });

  assert.match(
    html,
    /via deze <a class="detail-mail-cta-link" href="https:\/\/www\.softora\.nl\/webdesign\/seats2meet\?cid=mail-row&amp;sender=serve" target="_blank" rel="noopener noreferrer">link<\/a> bekijken 🎨<\/div>/
  );
  assert.doesNotMatch(html, /detail-mail-line-empty[^]*bekijken 🎨/);
});

test('premium mailbox lijnt Gmail-citaten links uit en verbergt een losse Softora-webdesign-url', () => {
  const url = 'https://www.softora.nl/webdesign/the-chamomile-collective?cid=safe-dedupe-20260615-row-2149-6137264c438&sender=serve';
  const parentBody = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website thechamomilecollective.nl tegen.',
    '',
    `Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link [${url}] bekijken 🎨`,
  ].join('\n');
  const html = renderMailboxBodyForTest([
    'Bedankt voor je bericht.',
    '',
    'Op do., jul. 23, 2026 om 10:13, Servé Creusen schreef:',
    '',
    '\tGoedendag,',
    '',
    '    Afgelopen week kwam ik jullie website thechamomilecollective.nl tegen.',
    '',
    '\tLukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link',
    '',
    `    (${url}) bekijken 🎨`,
  ].join('\n'), [], {
    replyMailId: 'inbox:2149',
    mail: {
      receivedAt: '2026-07-23T10:13:00.000Z',
      threadMessages: [{
        id: 'sent:2149',
        uid: 2149,
        folder: 'sent',
        accountEmail: 'serve@softora.nl',
        date: '2026-07-23T09:13:00.000Z',
        body: parentBody,
        originalCampaignOutbound: true,
        webdesignLinkEvidenceKnown: true,
        webdesignLinkUrl: url,
      }],
    },
  });

  assert.doesNotMatch(html, /<div class="detail-mail-line">[\t ]+/);
  assert.match(
    html,
    /via deze <a class="detail-mail-cta-link" href="https:\/\/www\.softora\.nl\/webdesign\/the-chamomile-collective\?cid=safe-dedupe-20260615-row-2149-6137264c438&amp;sender=serve" target="_blank" rel="noopener noreferrer">link<\/a> bekijken 🎨<\/div>/
  );
  assert.doesNotMatch(html, />https:\/\/www\.softora\.nl\/webdesign\/the-chamomile-collective/);
});

test('premium mailbox toont Brigit, Karlien en Marjolein hun exacte oude Sent-parent één keer roze', () => {
  const fixtures = [
    ['Brigit', 'bizzylizzy.nl', 'bizzylizzy'],
    ['Karlien Vis', 'misverstant.nl', 'misverstant'],
    ['Marjolein de Kroon', 'dekroonopjewerk.eu', 'de-kroon-op-je-werk'],
  ];

  fixtures.forEach(([name, website, slug], index) => {
    const url = `https://www.softora.nl/webdesign/${slug}?cid=legacy-${index + 1}`;
    const parentBody = [
      'Goedendag,',
      '',
      `Afgelopen week kwam ik jullie website (${website}) tegen.`,
      '',
      'Vanuit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
      '',
      `PS: Wordt het webdesign niet zichtbaar? Open het via hier [[${url}](${url})] 👈`,
      '',
      'Met vriendelijke groet,',
      'Servé Creusen',
    ].join('\n');
    const replyBody = [
      `Bedankt voor je reactie, ${name}.`,
      '',
      'Op 2 jun 2026 om 07:17 heeft Servé Creusen het volgende geschreven:',
      ...parentBody.split('\n').map((line) => `> ${line}`),
    ].join('\n');
    const html = renderMailboxBodyForTest(replyBody, [], {
      replyMailId: `inbox:${index + 59}`,
      mail: {
        receivedAt: '2026-06-02T08:00:00.000Z',
        threadMessages: [{
          id: `sent:${index + 60}`,
          uid: index + 60,
          folder: 'sent',
          accountEmail: 'serve@softora.nl',
          date: '2026-06-02T07:00:00.000Z',
          body: parentBody,
          originalCampaignOutbound: true,
          webdesignLinkEvidenceKnown: true,
          webdesignLinkUrl: url,
        }],
      },
    });

    assert.equal((html.match(/detail-mail-section-sent/g) || []).length, 1);
    assert.equal((html.match(/>Jouw bericht</g) || []).length, 1);
    assert.doesNotMatch(html, /Jouw eerdere mail/);
    assert.doesNotMatch(html, /detail-mail-section-quote/);
    assert.match(
      html,
      new RegExp(`<a class="detail-mail-cta-link" href="${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, '&amp;')}" target="_blank" rel="noopener noreferrer">hier</a>`)
    );
    assert.doesNotMatch(html, new RegExp(`>${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`));
  });
});

test('premium mailbox houdt de oude Sent-parent zichtbaar naast een latere uitgaande reactie', () => {
  const url = 'https://www.softora.nl/webdesign/bizzylizzy?cid=legacy-parent';
  const parentBody = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website (bizzylizzy.nl) tegen.',
    '',
    `PS: Wordt het webdesign niet zichtbaar? Open het via hier [[${url}](${url})] 👈`,
  ].join('\n');
  const laterReply = 'Hoi Brigit,\n\nDankjewel voor je reactie.';
  const html = renderMailboxBodyForTest(
    'Hoi Servé,\n\nBedankt voor het ontwerp.',
    [],
    {
      replyMailId: 'inbox:60',
      mail: {
        id: 'inbox:60',
        accountEmail: 'serve@softora.nl',
        folder: 'inbox',
        receivedAt: '2026-06-01T14:46:00.000Z',
        date: '2026-06-01T14:46:00.000Z',
        threadMessages: [
          {
            id: 'sent:71',
            folder: 'sent',
            accountEmail: 'serve@softora.nl',
            date: '2026-06-02T11:12:14.000Z',
            body: laterReply,
            originalCampaignOutbound: false,
          },
          {
            id: 'sent:62',
            folder: 'sent',
            accountEmail: 'serve@softora.nl',
            date: '2026-06-01T10:33:11.000Z',
            body: parentBody,
            originalCampaignOutbound: true,
            webdesignLinkEvidenceKnown: true,
            webdesignLinkUrl: url,
          },
        ],
      },
    }
  );

  assert.equal((html.match(/detail-mail-section-sent/g) || []).length, 2);
  assert.equal((html.match(/>Jouw bericht</g) || []).length, 2);
  assert.equal((html.match(/Nieuw bericht sturen/g) || []).length, 1);
  assert.match(html, /Dankjewel voor je reactie/);
  assert.match(
    html,
    new RegExp(`<a class="detail-mail-cta-link" href="${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, '&amp;')}" target="_blank" rel="noopener noreferrer">hier</a>`)
  );
  assert.doesNotMatch(html, /Jouw eerdere mail|detail-mail-section-quote/);
});

test('contactdossier zet de bewezen Van- en Aan-route van de uitgaande beginmail in de eigen kaart', () => {
  const body = 'Goedendag Hans,\n\nIk zag jullie website en had een korte vraag.';
  const html = renderMailboxBodyForTest(body, [], {
    contactDossierMode: true,
    mail: {
      id: 'serve@softora.nl|sent:hans-root',
      messageId: '<hans-root@example.test>',
      folder: 'sent',
      direction: 'sent',
      accountEmail: 'serve@softora.nl',
      from: 'Servé Creusen',
      email: 'serve@softora.nl',
      to: 'hansvandoorn54@gmail.com',
      toDisplay: 'hansvandoorn54@gmail.com',
      recipientRoutingEvidenceKnown: true,
      date: '19 augustus',
      time: '16:02',
      body,
      contactTimelineLoaded: true,
      threadMessages: [],
    },
  });
  const rootCard = html.match(/<section class="detail-mail-section detail-mail-section-sent"[^>]*data-mailbox-root-message="true">([\s\S]*?)<\/section>/)?.[1] || '';

  assert.match(rootCard, /19 augustus · 16:02 · Servé Creusen/);
  assert.match(rootCard, /<span>Van:<\/span><strong>Servé Creusen &lt;serve@softora\.nl&gt;<\/strong>/);
  assert.match(rootCard, /<span>Aan:<\/span><strong>hansvandoorn54@gmail\.com<\/strong>/);
  assert.match(rootCard, /Ik zag jullie website en had een korte vraag\./);
  assert.equal((html.match(/<span>Van:<\/span>/g) || []).length, 1);
  assert.equal((html.match(/<span>Aan:<\/span>/g) || []).length, 1);
});

test('contactdossier rendert van het geselecteerde uitgaande bericht alleen de eigen tekst roze', () => {
  const body = [
    'Beste secretariaat,',
    '',
    'Dit volledige uitgaande bericht hoort in één kaart.',
    '',
    'Op 27 juli schreef Secretariaat:',
    '> Geciteerde ontvangen tekst.',
  ].join('\n');
  const html = renderMailboxBodyForTest(body, [], {
    contactDossierMode: true,
    mail: {
      id: 'martijn@softora.nl|sent:senioren-1',
      messageId: '<senioren-1@example.test>',
      folder: 'sent',
      direction: 'sent',
      accountEmail: 'martijn@softora.nl',
      email: 'martijn@softora.nl',
      to: 'secretariaat@seniorenhaaren.nl',
      date: '28 jul',
      time: '16:19',
      body,
      contactTimelineLoaded: true,
      threadMessages: [],
    },
  });

  assert.equal((html.match(/data-mailbox-root-message="true"/g) || []).length, 1);
  assert.equal((html.match(/detail-mail-section detail-mail-section-sent/g) || []).length, 1);
  assert.equal((html.match(/>Jouw bericht</g) || []).length, 1);
  const card = html.match(/<section class="detail-mail-section detail-mail-section-sent"[^>]*data-mailbox-root-message="true">([\s\S]*?)<\/section>/);
  assert.ok(card);
  assert.match(card[1], /Dit volledige uitgaande bericht hoort in één kaart/);
  assert.doesNotMatch(html.replace(card[0], ''), /Dit volledige uitgaande bericht hoort in één kaart/);
  assert.doesNotMatch(html, /Op 27 juli schreef Secretariaat|Geciteerde ontvangen tekst/);
  assert.ok(html.startsWith('<section class="detail-mail-section detail-mail-section-sent"'));
  assert.ok(html.endsWith('</section>'));
});

test('contactdossier verwijdert Tessa en geneste Outlook-historie uit Martijns uitgaande hoofdkaart', () => {
  const authored = 'Dank voor je reactie; ik stuur je graag meer informatie.';
  const body = [
    'Hoi Tessa,',
    '',
    authored,
    '',
    'Op wo 24 jun 2026 om 18:53 schreef Tessa Mensink:',
    'Bedankt voor je bericht. Kun je meer vertellen?',
    '',
    'Verzonden vanaf Outlook voor Android',
    '',
    '________________________________',
    '*Van:* Martijn van de Ven <martijn@softora.nl>',
    '*Verstuurd:* woensdag 24 juni 2026 10:00',
    '*Aan:* Tessa Mensink <tessa@example.nl>',
    '*Onderwerp:* Kleine vraag over jullie website',
    '',
    'Goedendag,',
    'Afgelopen week kwam ik jullie website tessamensink.nl tegen.',
  ].join('\n');
  const root = {
    id: 'martijn@softora.nl|sent:tessa-root',
    messageId: '<tessa-root@example.test>',
    folder: 'sent',
    direction: 'sent',
    accountEmail: 'martijn@softora.nl',
    email: 'martijn@softora.nl',
    to: 'tessa@example.nl',
    date: '24 jun',
    time: '19:04',
    body,
    contactTimelineLoaded: true,
    threadMessages: [],
  };

  const rootHtml = renderMailboxBodyForTest(body, [], {
    contactDossierMode: true,
    mail: root,
  });
  const threadHtml = campaignInboxModule.renderThreadMessages({
    id: 'inbox:tessa-thread',
    accountEmail: 'martijn@softora.nl',
    threadMessages: [{ ...root, id: 'sent:tessa-thread', contactTimelineLoaded: false }],
  }, String, () => ({ date: '24 juni', time: '19:04' }));

  [rootHtml, threadHtml].forEach((html) => {
    assert.equal((html.match(new RegExp(authored, 'g')) || []).length, 1);
    assert.match(html, /Hoi Tessa,/);
    assert.doesNotMatch(html, /Tessa Mensink:|Kun je meer vertellen|Outlook voor Android|Verstuurd:|Onderwerp:|tessamensink\.nl/);
  });
  assert.equal((rootHtml.match(/data-mailbox-root-message="true"/g) || []).length, 1);
  assert.equal((rootHtml.match(/>Jouw bericht</g) || []).length, 1);
});

test('sent bronweergave bewaart echte tekst en een eigen naschrift rond losse quote-prefixen', () => {
  const sentMessage = {
    id: 'sent:authored-tail',
    folder: 'sent',
    direction: 'sent',
    accountEmail: 'martijn@softora.nl',
    body: [
      'Op woensdag schreef ik: dit is mijn eigen samenvatting.',
      '',
      '> Los geciteerd detail.',
      '',
      'P.S. Dit eigen naschrift moet zichtbaar blijven.',
    ].join('\n'),
  };
  const visible = campaignInboxModule.getSourceSafeMessageBody(sentMessage, {
    accountEmail: 'martijn@softora.nl',
  });

  assert.match(visible, /Op woensdag schreef ik: dit is mijn eigen samenvatting\./);
  assert.doesNotMatch(visible, /Los geciteerd detail/);
  assert.match(visible, /P\.S\. Dit eigen naschrift moet zichtbaar blijven\./);
});

test('Outlook Verstuurd-header telt als verzendveld in een markdown-headercluster', () => {
  const lines = [
    '*Van:* Martijn van de Ven <martijn@softora.nl>',
    '*Verstuurd:* woensdag 24 juni 2026 10:00',
    '*Aan:* Tessa Mensink <tessa@example.nl>',
  ];
  const fields = quotedThreadModule.extractHeaderFields(lines);

  assert.equal(quotedThreadModule.isHeaderClusterAt(lines, 0), true);
  assert.deepEqual(fields.sent, ['woensdag 24 juni 2026 10:00']);
});

test('JT Performance signature wordt in hoofdmail en inkomende thread een veilige contactkaart', () => {
  const body = [
    'Ziet er zeker gaaf uit!',
    '',
    'Best regards/Met vriendelijke groet.',
    'Jeroen Sterke',
    '',
    '*JT-performance',
    '- http://www.jt-performance.nl [1]',
    'service@jt-performance.nl [2]',
    'Phone: +31 97010269099',
    'Street: Nieuwe Baan 1',
    'Postcode:5076 SV',
    'City:',
    'Haaren',
    'Country:',
    'Nederland',
    'Chamber off commerce:',
    '17122606',
    'Tax Number',
    'NL001751168B24',
  ].join('\n');
  const root = {
    id: 'inbox:jt-signature',
    folder: 'inbox',
    direction: 'received',
    accountEmail: 'serve@softora.nl',
    email: 'service@jt-performance.nl',
    date: '2026-08-20T12:41:00.000Z',
    body,
    threadMessages: [],
  };
  const rootHtml = renderMailboxBodyForTest(body, [], { replyMailId: root.id, mail: root });
  const threadHtml = campaignInboxModule.renderThreadMessages({
    id: 'inbox:jt-thread-root',
    accountEmail: 'serve@softora.nl',
    threadMessages: [{ ...root, id: 'inbox:jt-thread-message' }],
  }, String, () => ({ date: '20 augustus', time: '14:41' }));

  for (const html of [rootHtml, threadHtml]) {
    assert.match(html, /Ziet er zeker gaaf uit!/);
    assert.equal((html.match(/class="detail-mail-contact-card"/g) || []).length, 1);
    assert.match(html, /<dt>Telefoon:<\/dt>/);
    assert.match(html, /href="tel:\+3197010269099"/);
    assert.match(html, /<dt>Adres:<\/dt>/);
    const contactBlock = html.match(/<address class="detail-mail-contact-card"[\s\S]*?<\/address>/)?.[0] || '';
    assert.match(contactBlock, /Nieuwe Baan 1, 5076 SV Haaren, Nederland/);
    assert.doesNotMatch(contactBlock, /detail-mail-contact-title|>\s*Contactgegevens\s*<|<br>/i);
    assert.doesNotMatch(html, /Best regards|Jeroen Sterke|JT-performance|Chamber|17122606|Tax Number|NL001751168B24/);
  }
  assert.doesNotMatch(rootHtml, /jt-performance\.nl|service@jt-performance\.nl/);
  assert.equal((threadHtml.match(/service@jt-performance\.nl/g) || []).length, 1);
  assert.match(rootHtml, /detail-mail-section-received[\s\S]*detail-mail-contact-card[\s\S]*<\/section>/);
  assert.equal(root.body, body);
});

test('Niels-signature verdwijnt in hoofdmail en thread terwijl Telefoon in de normale mailstijl blijft', () => {
  const authoredBody = [
    'Hallo Serve,',
    '',
    'Thanks voor je mailtje. Het idee ziet er leuk uit, stuur de online preview maar, ben wel benieuwd.',
    'Wat zouden alle voordelen zijn tov mijn huidige website?',
    '',
    'De huidige website heb ik nooit helemaal afgemaakt. Wel vind ik het belangrijk dat ik zelf alles kan aanpassen,',
    'onderhouden en de SEO kan regelen zoals nu in Wordpress.',
  ].join('\n');
  const body = [
    authoredBody,
    '',
    'Muzikale groet,',
    '',
    'Niels van Kollenburg',
    '',
    'T. 06 - 29 03 73 59',
    'E. info@nielsvankollenburg.nl',
    'W. nielsvankollenburg.nl',
    '',
    'Klik hier voor meer info',
  ].join('\n');
  const sentReply = {
    id: 'sent:niels-reply',
    mailboxId: 'sent:niels-reply',
    messageId: '<niels-reply@softora.nl>',
    folder: 'sent',
    direction: 'sent',
    accountEmail: 'servecreusen@softora.nl',
    from: 'Servé Creusen',
    email: 'servecreusen@softora.nl',
    recipientRoutingEvidenceKnown: true,
    toDisplay: 'Niels van Kollenburg <info@nielsvankollenburg.nl>',
    date: '2026-08-24T12:30:00.000Z',
    body: 'Hoi Niels,\n\nDank voor je reactie. Ik stuur je de online preview en licht de voordelen graag toe.',
  };
  const root = {
    id: 'inbox:niels-signature',
    folder: 'inbox',
    direction: 'received',
    accountEmail: 'servecreusen@softora.nl',
    canonicalOwner: 'serve',
    from: 'Niels van Kollenburg',
    email: 'info@nielsvankollenburg.nl',
    recipientRoutingEvidenceKnown: true,
    toDisplay: 'Servé Creusen <servecreusen@softora.nl>',
    date: '2026-08-24T12:00:00.000Z',
    body,
    threadMessages: [sentReply],
  };
  const presentation = campaignInboxModule.getSourceSafeMessagePresentation(root, root);
  const mailbox = loadMailboxHelpersForTest();
  const rootHtml = mailbox.renderMailBody(body, [], {
    replyMailId: root.id,
    mail: root,
    rootIncomingMeta: mailbox.renderMailboxRootIncomingMeta(root),
  });
  const threadHtml = campaignInboxModule.renderThreadMessages({
    id: 'inbox:niels-thread-root',
    accountEmail: 'servecreusen@softora.nl',
    canonicalOwner: 'serve',
    threadMessages: [{ ...root, id: 'inbox:niels-thread-message', threadMessages: [] }, sentReply],
  }, String, () => ({ date: '24 augustus', time: '14:00' }));

  assert.equal(presentation.body, authoredBody);
  assert.equal(presentation.signatureMatched, true);
  assert.deepEqual(presentation.contact, {
    phone: '06 - 29 03 73 59',
    phoneHref: 'tel:0629037359',
    addressLines: [],
  });
  for (const html of [rootHtml, threadHtml]) {
    assert.match(html, /Hallo Serve,/);
    assert.match(html, /Wat zouden alle voordelen zijn tov mijn huidige website\?/);
    assert.equal((html.match(/class="detail-mail-contact-card"/g) || []).length, 1);
    assert.equal((html.match(/class="detail-mail-contact-item"/g) || []).length, 1);
    assert.equal((html.match(/>Jouw bericht<\/div>/g) || []).length, 1);
    assert.equal((html.match(/Dank voor je reactie\. Ik stuur je de online preview en licht de voordelen graag toe\./g) || []).length, 1);
    assert.match(html, /<dt>Telefoon:<\/dt><dd><a class="detail-mail-contact-link" href="tel:0629037359">06 - 29 03 73 59<\/a><\/dd>/);
    assert.doesNotMatch(html, /<dt>Adres:<\/dt>|Muzikale groet|T\. 06 - 29 03 73 59|E\. info@nielsvankollenburg\.nl|W\. nielsvankollenburg\.nl|Klik hier voor meer info/i);
    assert.match(html, /<span>Van:<\/span><strong>Niels van Kollenburg[\s\S]*?info@nielsvankollenburg\.nl[\s\S]*?<\/strong>/);
    assert.match(html, /<span>Aan:<\/span><strong>[\s\S]*?Servé Creusen[\s\S]*?servecreusen@softora\.nl[\s\S]*?<\/strong>/);
    assert.match(html, /<span>Van:<\/span><strong>Servé Creusen[\s\S]*?servecreusen@softora\.nl[\s\S]*?<\/strong>/);
    assert.match(html, /<span>Aan:<\/span><strong>[\s\S]*?Niels van Kollenburg[\s\S]*?info@nielsvankollenburg\.nl[\s\S]*?<\/strong>/);
  }
  for (const html of [rootHtml, threadHtml]) {
    assert.equal((html.match(/Niels van Kollenburg/g) || []).length, 2);
    assert.equal((html.match(/info@nielsvankollenburg\.nl/g) || []).length, 2);
    assert.equal((html.match(/servecreusen@softora\.nl/g) || []).length, 2);
    assert.doesNotMatch(html, /Martijn van de Ven|martijn@softora\.nl/);
  }
  assert.match(rootHtml, /detail-mail-section-received[\s\S]*detail-mail-contact-card[\s\S]*<\/section>/);
  assert.equal(campaignInboxModule.getMessageOwner(root), 'serve');
  assert.equal(campaignInboxModule.getMessageOwner(sentReply), 'serve');
  assert.equal(root.body, body);
});

test('Resin Art JR reverse-header en References-footer verdwijnen alleen bij één bewezen parent', () => {
  const sentBody = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website resinartjr.nl tegen.',
    'Uit enthousiasme heb ik een fris webdesign gemaakt.',
    'Bekijk het ontwerp via deze link [1].',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
  ].join('\n');
  const incomingBody = [
    'Hoi Servé,',
    '',
    'Dank voor het ontwerp, maar we gaan er niet mee verder.',
    '',
    'Met vriendelijke groet,',
    'Resin Art JR',
    '',
    'Servé Creusen schreef op 2026-08-19 10:10:',
    ...sentBody.split('\n').map((line) => `> ${line}`),
    '',
    'References:',
    '----------',
    '[1] [https://www.softora.nl/webdesign/resin-art-jr?sender=serve](https://www.softora.nl/webdesign/resin-art-jr?sender=serve)',
    '[2] https://www.resinartjr.nl/',
  ].join('\n');
  const incoming = {
    id: 'inbox:resin-art-jr',
    folder: 'inbox',
    direction: 'received',
    accountEmail: 'serve@softora.nl',
    email: 'info@resinartjr.nl',
    receivedAt: '2026-08-19T10:30:00.000Z',
    inReplyTo: '<resin-parent@softora.nl>',
    body: incomingBody,
    threadMessages: [{
      id: 'sent:resin-parent',
      messageId: '<resin-parent@softora.nl>',
      folder: 'sent',
      direction: 'sent',
      accountEmail: 'serve@softora.nl',
      date: '2026-08-19T10:10:00.000Z',
      body: sentBody,
    }],
  };
  const presentation = campaignInboxModule.getSourceSafeMessagePresentation(incoming, incoming);
  const html = renderMailboxBodyForTest(incomingBody, [], { replyMailId: incoming.id, mail: incoming });

  assert.equal(presentation.body, 'Hoi Servé,\n\nDank voor het ontwerp, maar we gaan er niet mee verder.');
  assert.equal(presentation.signatureMatched, true);
  assert.match(html, /Dank voor het ontwerp, maar we gaan er niet mee verder\./);
  assert.doesNotMatch(html, /Resin Art JR|schreef op 2026-08-19|References:|softora\.nl\/webdesign\/resin-art-jr/);
  assert.equal((html.match(/Afgelopen week kwam ik jullie website resinartjr\.nl tegen\./g) || []).length, 1);
  assert.equal(incoming.body, incomingBody);

  const linksVariant = campaignInboxModule.stripProvenQuotedOutbound(
    incomingBody.replace('References:', 'Links:'),
    incoming
  );
  assert.doesNotMatch(linksVariant, /Links:|\[1\].*softora\.nl/);

  const noParent = campaignInboxModule.stripProvenQuotedOutbound(incomingBody, {
    ...incoming,
    inReplyTo: '',
    threadMessages: [],
  });
  assert.match(noParent, /Servé Creusen schreef op 2026-08-19 10:10:/);
  assert.match(noParent, /References:/);
  assert.match(noParent, /\[2\] https:\/\/www\.resinartjr\.nl\//);
});

test('Tessa quote blijft bewezen bij formatteringsdrift en verliest ook de gekoppelde Links-footer', () => {
  const sentAuthoredBody = [
    'Hoi Tessa,',
    '',
    'Dankjewel voor je leuke reactie!',
    'Fijn om te horen dat de sfeerimpressie goed overkomt. Ik denk graag even met je mee over de indeling en wat er mogelijk is binnen het budget.',
    'Is het een idee dat ik volgende week maandag of donderdag met een collega kort langskom?',
    '',
    'Met vriendelijke groet,',
    'Martijn van de Ven',
    '________________________________',
  ].join('\n');
  const sentBody = [
    sentAuthoredBody,
    'From: Tessa de Backer <communicatie@schakel-nu.nl>',
    'Sent: Tuesday, July 7, 2026 9:41 PM',
    'To: martijnvandeven@softora.nl',
    'Subject: Re: Fwd: Kleine vraag over jullie website',
    '',
    'Goedenavond Martijn,',
    'Dankjewel voor je leuke sfeerimpressie.',
  ].join('\n');
  const incomingBody = [
    'Hoi Martijn,',
    '',
    'De vakantie loopt ten einde, dus we starten weer op.',
    'Komt donderdag in De Schalm voor jou uit?',
    '',
    'martijnvandeven@softora.nl schreef op 2026-07-08 13:45:',
    '> Hoi Tessa,',
    '> > Dankjewel voor je leuke reactie!',
    '> > Fijn om te horen dat de sfeerimpressie goed overkomt. Ik denk graag > even met je mee over de indeling en wat er mogelijk is binnen het > budget.',
    '> > Is het een idee dat ik volgende week maandag of donderdag met een > collega kort langskom?',
    '> >',
    '> > Met vriendelijke groet,',
    '> > Martijn van de Ven',
    '> > -------------------------',
    '> > From: Tessa de Backer',
    '> Sent: Tuesday, July 7, 2026 9:41 PM',
    '> To: martijnvandeven@softora.nl',
    '> Subject: Re: Fwd: Kleine vraag over jullie website',
    '> > Goedenavond Martijn,',
    '> > Dankjewel voor je leuke sfeerimpressie [1].',
    '',
    'Links:',
    '------',
    '[1] http://www.schakel-nu.nl',
  ].join('\n');
  const parent = {
    id: 'sent:tessa-145',
    messageId: '<tessa-145@softora.nl>',
    folder: 'sent',
    direction: 'sent',
    accountEmail: 'martijnvandeven@softora.nl',
    date: '2026-07-08T11:45:00.000Z',
    body: sentBody,
  };
  const incoming = {
    id: 'inbox:tessa-39',
    messageId: '<tessa-39@schakel-nu.nl>',
    inReplyTo: '<tessa-145@softora.nl>',
    folder: 'inbox',
    direction: 'received',
    accountEmail: 'martijnvandeven@softora.nl',
    email: 'communicatie@schakel-nu.nl',
    receivedAt: '2026-08-18T10:14:00.000Z',
    body: incomingBody,
  };
  const direct = quotedThreadModule.stripProvenQuotedOutbound(incomingBody, [parent], {
    directParentMessageIds: ['<tessa-145@softora.nl>'],
    incomingAt: incoming.receivedAt,
    stripReferenceAppendixWhenSingleMatch: true,
  });
  const html = renderMailboxBodyForTest('Nieuwste hoofdbericht.', [], {
    mail: {
      id: 'inbox:tessa-root',
      folder: 'inbox',
      accountEmail: 'martijnvandeven@softora.nl',
      receivedAt: '2026-08-20T12:26:00.000Z',
      threadMessages: [incoming, parent],
    },
  });

  assert.equal(direct.body, [
    'Hoi Martijn,',
    '',
    'De vakantie loopt ten einde, dus we starten weer op.',
    'Komt donderdag in De Schalm voor jou uit?',
  ].join('\n'));
  assert.deepEqual(direct.matchedMessages.map((message) => message.id), ['sent:tessa-145']);
  assert.equal(direct.removedReferenceAppendix, true);
  assert.match(html, /De vakantie loopt ten einde, dus we starten weer op\./);
  assert.equal((html.match(/Dankjewel voor je leuke reactie!/g) || []).length, 1);
  assert.doesNotMatch(html, /schreef op 2026-07-08|Goedenavond Martijn|Links:|http:\/\/www\.schakel-nu\.nl/);
  assert.match(html, /detail-mail-section-sent/);
});

test('korte exacte In-Reply-To-parent verdwijnt ook uit de root zonder eigenaar- of parentgok', () => {
  const parentBody = 'Tot zo.';
  assert.ok(quotedThreadModule.normalizeMatchText(parentBody).length < 8);
  const incomingBody = [
    'Hoi Martijn,',
    '',
    'Half elf staat genoteerd.',
    '',
    'martijnvandeven@softora.nl schreef op 2026-08-19 10:10:',
    '> Tot zo.',
    '> > Oudere afspraaktekst [1].',
    '',
    'Links:',
    '------',
    '[1] https://www.softora.nl/webdesign/oude-afspraak',
  ].join('\n');
  const parent = {
    id: 'sent:tessa-short-parent',
    messageId: '<tessa-short-parent@softora.nl>',
    folder: 'sent',
    direction: 'sent',
    accountEmail: 'martijnvandeven@softora.nl',
    date: '2026-08-19T08:10:00.000Z',
    body: parentBody,
  };
  const incoming = {
    id: 'inbox:tessa-short-root',
    messageId: '<tessa-short-root@schakel-nu.nl>',
    inReplyTo: '<tessa-short-parent@softora.nl>',
    folder: 'inbox',
    direction: 'received',
    accountEmail: 'martijnvandeven@softora.nl',
    receivedAt: '2026-08-19T08:20:00.000Z',
    body: incomingBody,
    threadMessages: [parent],
  };

  const presentation = campaignInboxModule.getSourceSafeMessagePresentation(incoming, incoming);
  assert.equal(presentation.body, 'Hoi Martijn,\n\nHalf elf staat genoteerd.');

  const wrongParent = campaignInboxModule.getSourceSafeMessagePresentation(
    { ...incoming, inReplyTo: '<ander-parent@softora.nl>' },
    { ...incoming, inReplyTo: '<ander-parent@softora.nl>' }
  );
  assert.equal(wrongParent.body, incomingBody);

  const wrongOwnerParent = { ...parent, accountEmail: 'serve@softora.nl' };
  const wrongOwner = campaignInboxModule.getSourceSafeMessagePresentation(
    { ...incoming, threadMessages: [wrongOwnerParent] },
    { ...incoming, threadMessages: [wrongOwnerParent] }
  );
  assert.equal(wrongOwner.body, incomingBody);
});

test('inkomende threadkaarten tonen alleen de nieuwe tekst bij expliciete en samengeplakte quote-tails', () => {
  const explicitQuote = [
    'Goedenavond Martijn,',
    '',
    'Dankjewel voor je leuke sfeerimpressie.',
    '',
    '> www.schakel-nu.nl [1]',
    '>> -------- Oorspronkelijke bericht --------',
    '>> Goedendag, dit is het oude coldmailbericht [2].',
    '',
    'Links:',
    '------',
    '[1] http://www.schakel-nu.nl',
    '[2] https://www.softora.nl/webdesign/weekblad-de-schakel',
  ].join('\n');
  const collapsedQuote = [
    'Hoi Martijn,Half 11 is prima. Hoofdredacteur Noortje sluit ook aan. Met vriendelijke groet,Tessa de Backer',
    '-------- Oorspronkelijk bericht --------Van: Martijn van de Ven Datum: 18-08-2026 16:13 (GMT+01:00) Aan: communicatie@schakel-nu.nl Onderwerp: Re: Kleine vraag Hoi Tessa,',
    'Dit is het oude antwoord van Martijn.',
  ].join('\n');
  const html = campaignInboxModule.renderThreadMessages({
    id: 'inbox:tessa-thread-root',
    accountEmail: 'martijnvandeven@softora.nl',
    threadMessages: [{
      id: 'inbox:tessa-explicit-quote',
      folder: 'inbox',
      accountEmail: 'martijnvandeven@softora.nl',
      date: '2026-07-07T19:41:00.000Z',
      body: explicitQuote,
    }, {
      id: 'inbox:tessa-collapsed-quote',
      folder: 'inbox',
      accountEmail: 'martijnvandeven@softora.nl',
      date: '2026-08-19T09:00:00.000Z',
      body: collapsedQuote,
    }],
  }, String, () => ({ date: '19 augustus', time: '11:00' }));

  assert.match(html, /Dankjewel voor je leuke sfeerimpressie\./);
  assert.match(html, /Half 11 is prima/);
  assert.match(html, /Hoofdredacteur Noortje sluit ook aan/);
  assert.doesNotMatch(html, /Oorspronkelijk|oude coldmailbericht|oude antwoord van Martijn|Links:|softora\.nl\/webdesign/);
});

test('inline original-message-termen en ongekoppelde eigen Links-inhoud blijven gewone tekst', () => {
  const naturalBodies = [
    'Let op: schrijf -- original message -- alleen als Engelse term in deze handleiding.',
    'De knopnaam -------- oorspronkelijk bericht -------- hoort letterlijk in deze uitleg.',
  ];
  naturalBodies.forEach((body) => {
    const parsed = quotedThreadModule.splitQuotedThread(body);
    assert.equal(parsed.authored, body);
    assert.deepEqual(parsed.segments, []);
  });

  const twoDashCollapsed = [
    'Nieuw inhoudelijk antwoord.',
    '-- Original Message --From: Martijn van de Ven Sent: 20-08-2026 10:10 To: Tessa Subject: Re: afspraak Oude tekst.',
  ].join('');
  const parsedCollapsed = quotedThreadModule.splitQuotedThread(twoDashCollapsed);
  assert.equal(parsedCollapsed.authored, 'Nieuw inhoudelijk antwoord.');
  assert.equal(parsedCollapsed.segments[0] && parsedCollapsed.segments[0].marker, 'forward-separator');

  const ownLinksBody = [
    'Dit is mijn nieuwe antwoord.',
    '> Een oud los detail zonder verwijzingsmarker.',
    '',
    'Links:',
    '------',
    '[1] https://voorbeeld.nl/eigen-agenda',
  ].join('\n');
  const parsedLinks = quotedThreadModule.splitQuotedThread(ownLinksBody);
  assert.equal(parsedLinks.removedReferenceAppendix, false);
  assert.match(parsedLinks.authored, /Links:/);
  assert.match(parsedLinks.authored, /https:\/\/voorbeeld\.nl\/eigen-agenda/);
});

test('gewone Links-inhoud met een eigen URL blijft staan nadat één bewezen parent is verwijderd', () => {
  const sentBody = 'Dit is één exact bewezen uitgaand bericht met voldoende eigen inhoud.';
  const incomingBody = [
    'Hier is mijn inhoudelijke reactie.',
    '',
    'Servé Creusen schreef op 2026-08-19 10:10:',
    `> ${sentBody}`,
    '',
    'Links:',
    '------',
    '[1] https://voorbeeld.nl/eigen-agenda',
  ].join('\n');
  const cleaned = campaignInboxModule.stripProvenQuotedOutbound(incomingBody, {
    id: 'inbox:legitimate-links',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    receivedAt: '2026-08-19T10:20:00.000Z',
    threadMessages: [{
      id: 'sent:legitimate-links-parent',
      folder: 'sent',
      accountEmail: 'serve@softora.nl',
      date: '2026-08-19T10:10:00.000Z',
      body: sentBody,
    }],
  });

  assert.doesNotMatch(cleaned, /exact bewezen uitgaand bericht/);
  assert.match(cleaned, /Links:/);
  assert.match(cleaned, /------/);
  assert.match(cleaned, /\[1\]/);
  assert.match(cleaned, /https:\/\/voorbeeld\.nl\/eigen-agenda/);
});

test('NL en EN reverse-replyheaders zijn conservatief en natuurlijke ik-wij-zinnen blijven inhoud', () => {
  assert.equal(quotedThreadModule.isReplyHeaderLine('Servé Creusen schreef op 2026-08-19 10:10:'), true);
  assert.equal(quotedThreadModule.isReplyHeaderLine('John Example wrote on 19 August 2026 at 10:10:'), true);
  for (const line of [
    'Ik schreef op 2026-08-19 10:10: dit is mijn notitie.',
    'We wrote on 2026-08-19 10:10: this is our internal note.',
    'Volgens Servé schreef op 2026-08-19 10:10: de planning dit voor.',
    'De klant schreef op maandag dat dit goed was:',
  ]) {
    assert.equal(quotedThreadModule.isReplyHeaderLine(line), false, line);
  }
  const naturalSentBody = [
    'De klant schreef op maandag dat dit goed was:',
    'Daarom houden we deze volledige inhoud zichtbaar.',
  ].join('\n');
  assert.equal(campaignInboxModule.getSourceSafeMessageBody({
    folder: 'sent', direction: 'sent', accountEmail: 'serve@softora.nl', body: naturalSentBody,
  }, { accountEmail: 'serve@softora.nl' }), naturalSentBody);
});

test('bewezen mailboxkopie gebruikt sent-prefixfilter en toont geen geciteerde Tessa-reactie', () => {
  const body = [
    'Hoi Tessa,',
    '',
    'Dank voor je reactie; ik stuur je graag meer informatie.',
    '',
    'On Wednesday, 19 August 2026 at 10:10, Tessa Mensink wrote:',
    '> Bedankt voor je bericht. Kun je meer vertellen?',
  ].join('\n');
  const copy = {
    id: 'copy:martijn-tessa',
    folder: 'inbox',
    direction: 'received',
    accountEmail: 'martijn@softora.nl',
    email: 'tessa@example.nl',
    body,
    copyContext: {
      evidenceKnown: true,
      sourceAccountEmail: 'martijn@softora.nl',
      sourceName: 'Martijn van de Ven',
    },
    threadMessages: [],
  };
  const html = renderMailboxBodyForTest(body, [], { mail: copy });

  assert.match(html, /Hoi Tessa,/);
  assert.match(html, /ik stuur je graag meer informatie\./);
  assert.doesNotMatch(html, /Tessa Mensink wrote|Kun je meer vertellen/);
  assert.match(html, /detail-mail-section-sent/);
  assert.doesNotMatch(html, /detail-mail-contact-card/);
  assert.equal(copy.body, body);
});

test('uitgaande signature blijft volledig ongemoeid en wordt nooit een contactkaart', () => {
  const body = [
    'Mijn uitgaande tekst.',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
    'Softora',
    'Phone: 0612345678',
    'Street: Teststraat 1',
  ].join('\n');
  const message = {
    id: 'sent:signature-preserved',
    folder: 'sent',
    direction: 'sent',
    accountEmail: 'serve@softora.nl',
    body,
  };
  const presentation = campaignInboxModule.getSourceSafeMessagePresentation(message, message);

  assert.equal(presentation.body, body);
  assert.equal(presentation.signatureMatched, false);
  assert.deepEqual(presentation.contact, { phone: '', phoneHref: '', addressLines: [] });
});

test('contactdossier rendert ieder onderscheiden uitgaand bericht één keer roze naast inkomend', () => {
  const aliases = [
    ['martijnvandeven@softora.nl', 'secretariaat@seniorenhaaren.nl'],
    ['serve290@gmail.com', 'contact@example.nl'],
  ];
  aliases.forEach(([accountEmail, contact], fixtureIndex) => {
    const html = renderMailboxBodyForTest(`Uitgaand hoofdbericht ${fixtureIndex}.`, [], {
      contactDossierMode: true,
      mail: {
        id: `sent:root-${fixtureIndex}`,
        messageId: `<root-${fixtureIndex}@example.test>`,
        folder: 'sent', accountEmail, email: accountEmail, to: contact,
        body: `Uitgaand hoofdbericht ${fixtureIndex}.`,
        contactTimelineLoaded: true,
        threadMessages: [{
          id: `inbox:${fixtureIndex}`, messageId: `<in-${fixtureIndex}@example.test>`,
          folder: 'inbox', accountEmail, email: contact, to: accountEmail,
          date: '2026-07-27T10:00:00.000Z', body: `Inkomend bericht ${fixtureIndex}.`,
        }, {
          id: `sent:older-${fixtureIndex}`, messageId: `<out-${fixtureIndex}@example.test>`,
          folder: 'sent', accountEmail, email: accountEmail, to: contact,
          date: '2026-07-26T10:00:00.000Z', body: `Tweede uitgaand bericht ${fixtureIndex}.`,
        }],
      },
    });

    assert.equal((html.match(/detail-mail-section detail-mail-section-sent/g) || []).length, 2);
    assert.equal((html.match(/detail-mail-section detail-mail-section-received/g) || []).length, 1);
    assert.equal((html.match(/>Jouw bericht</g) || []).length, 2);
    assert.equal((html.match(new RegExp(`Uitgaand hoofdbericht ${fixtureIndex}`, 'g')) || []).length, 1);
    assert.equal((html.match(new RegExp(`Tweede uitgaand bericht ${fixtureIndex}`, 'g')) || []).length, 1);
    assert.equal((html.match(new RegExp(`Inkomend bericht ${fixtureIndex}`, 'g')) || []).length, 1);
    assert.ok(html.indexOf(`Uitgaand hoofdbericht ${fixtureIndex}`) < html.indexOf(`Inkomend bericht ${fixtureIndex}`));
    assert.ok(html.indexOf(`Inkomend bericht ${fixtureIndex}`) < html.indexOf(`Tweede uitgaand bericht ${fixtureIndex}`));
  });
});

test('premium mailbox maakt een legacy hier-url zonder exact MIME-bewijs niet klikbaar', () => {
  const url = 'https://www.softora.nl/webdesign/bizzylizzy?cid=onbewezen';
  const html = renderMailboxBodyForTest(
    `PS: Wordt het webdesign niet zichtbaar? Open het via hier [${url}] 👈`,
    [],
    {
      mail: {
        webdesignLinkEvidenceKnown: false,
        webdesignLinkUrl: '',
      },
    }
  );

  assert.doesNotMatch(html, /detail-mail-cta-link/);
  assert.doesNotMatch(html, /<a\b/);
  assert.match(html, /hier \[https:\/\/www\.softora\.nl\/webdesign\/bizzylizzy\?cid=onbewezen\]/);
});

test('premium mailbox houdt databasekoppeling zonder interessebalk in het maildetail', () => {
  const pageSource = readPage();
  const scriptSource = readScript();
  const indexSource = readIndexScript();
  const outreachSource = readOutreachScript();
  const campaignInboxSource = readCampaignInboxScript();
  const ownerSessionSource = readOwnerSessionScript();

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
  const ownerSessionSource = readOwnerSessionScript();

  assert.doesNotMatch(pageSource, /class="mail-sidebar"/);
  assert.doesNotMatch(pageSource, /data-mailbox-folder=/);
  assert.match(scriptSource, /let activeFolder = 'outreach';/);
  assert.match(ownerSessionSource, /options\.campaignInbox\?\.load/);
  assert.match(campaignInboxSource, /\/api\/mailbox\/campaign-replies\?\$\{params\.toString\(\)\}/);
  assert.match(campaignInboxSource, /owner: activeOwner/);
  assert.match(campaignInboxSource, /refreshInstantly: options && options\.refreshInstantly === false \? '0' : '1'/);
  assert.match(campaignInboxSource, /function getAccount\(mail, fallbackAccount\)/);
  assert.match(campaignInboxSource, /function getRequestId\(mail\)/);
  assert.match(campaignInboxSource, /async function load\(folder, normalizeMessage, fetchImpl, options\)/);
  assert.match(indexSource, /id: String\(requestId \|\| id\)/);
  assert.doesNotMatch(campaignInboxSource, /ui-state-get/);
  assert.match(outreachSource, /folder: normalizeText\(params\.get\('folder'\) \|\| 'outreach'\)/);
});

test('coldmail inbox laadt alleen gekoppelde mailboxberichten van de gekozen eigenaar', async () => {
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

  assert.equal(result.messages.length, 1);
  assert.deepEqual(
    Array.from(result.messages, (reply) => reply.accountEmail),
    ['serve@softora.nl']
  );
  assert.equal(result.messages[0].mailboxId, 'inbox:42');
  assert.equal(result.messages[0].campaign.actionRequired, true);
  assert.equal(result.sync.source, 'campaign-replies-index');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/mailbox/campaign-replies?limit=200&owner=serve&refreshInstantly=1');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.doesNotMatch(calls[0].url, /ui-state-get/);
  assert.equal(await campaignInboxModule.load('inbox', (message) => message), null);

  calls.length = 0;
  await campaignInboxModule.load('outreach', (message) => message, async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      json: async () => ({ ok: true, messages: [], sync: { indexed: true } }),
    };
  }, { owner: 'serve', refreshInstantly: false });
  assert.equal(calls[0].url, '/api/mailbox/campaign-replies?limit=200&owner=serve&refreshInstantly=0');
});

test('mailbox gebruikt server-bootstrap zonder zichtbare laadtekst of eerste client-request', async () => {
  const previousDocument = globalThis.document;
  let fetchCalls = 0;
  globalThis.document = {
    getElementById(id) {
      if (id !== 'softoraPageStateBootstrap') return null;
      return {
        textContent: JSON.stringify({
          session: {
            authenticated: true,
            email: 'serve@softora.nl',
            displayName: 'Servé Creusen',
          },
          mailbox: {
            ok: true,
            owner: 'serve',
            messages: [{ id: 'reply-bootstrap', accountEmail: 'serve@softora.nl', from: 'Direct zichtbaar' }],
            sync: { source: 'campaign-replies-index' },
          },
        }),
      };
    },
  };
  try {
    assert.equal(campaignInboxModule.hasPageBootstrap('outreach'), true);
    assert.equal(campaignInboxModule.getPageBootstrapSession().email, 'serve@softora.nl');
    const result = await campaignInboxModule.load('outreach', (message) => message, async () => {
      fetchCalls += 1;
      throw new Error('bootstrap hoort de request over te slaan');
    });
    assert.equal(result.messages[0].id, 'reply-bootstrap');
    assert.equal(result.fromBootstrap, true);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.document = previousDocument;
  }

  assert.doesNotMatch(readScript(), />Mailbox laden…</);
  assert.match(readOwnerSessionScript(), /preserveOnError:\s*true/);
  assert.match(readScript(), /getPageBootstrapSession/);
});

test('mailbox leest complete unicode gespreksdata uit de veilige base64-bootstrap', async () => {
  const previousDocument = globalThis.document;
  const previousApi = globalThis.SoftoraMailboxCampaignInbox;
  const modulePath = require.resolve('../../assets/premium-mailbox-campaign-inbox.js');
  const payload = {
    session: {
      authenticated: true,
      email: 'martijn@softora.nl',
      displayName: 'Martijn van de Ven',
    },
    mailbox: {
      ok: true,
      owner: 'martijn',
      messages: [{
        id: 'ralph-conversation',
        accountEmail: 'martijn@softora.nl',
        from: 'Ralph Ruyters',
        threadMessages: [
          { id: 'sent-1', folder: 'sent', body: 'Eerste antwoord' },
          { id: 'sent-2', folder: 'sent', body: 'Vervolg met € en emoji 😁' },
        ],
      }],
      sync: { source: 'campaign-replies-index' },
    },
  };
  globalThis.document = {
    getElementById(id) {
      if (id !== 'softoraPageStateBootstrap') return null;
      return {
        textContent: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
        getAttribute(name) {
          return name === 'data-softora-encoding' ? 'base64' : null;
        },
      };
    },
  };
  delete require.cache[modulePath];
  const freshCampaignInboxModule = require(modulePath);

  try {
    const result = await freshCampaignInboxModule.load(
      'outreach',
      (message) => message,
      null,
      { owner: 'martijn' }
    );
    assert.equal(result.messages[0].threadMessages.length, 2);
    assert.equal(result.messages[0].threadMessages[1].body, 'Vervolg met € en emoji 😁');
    assert.equal(freshCampaignInboxModule.getPageBootstrapSession().displayName, 'Martijn van de Ven');
  } finally {
    delete require.cache[modulePath];
    globalThis.document = previousDocument;
    globalThis.SoftoraMailboxCampaignInbox = previousApi;
  }
});

test('mailbox toont de laatst bekende tabdata direct wanneer de server koud start', async () => {
  const previousDocument = globalThis.document;
  const previousBootstrapSession = globalThis.SoftoraPageBootstrapSession;
  const previousApi = globalThis.SoftoraMailboxCampaignInbox;
  const modulePath = require.resolve('../../assets/premium-mailbox-campaign-inbox.js');
  globalThis.document = { getElementById() { return null; } };
  globalThis.SoftoraPageBootstrapSession = {
    get() { return { authenticated: true, userId: 'usr_serve', email: 'serve@softora.nl' }; },
    cache: {
      read(key) {
        assert.equal(key, 'mailbox_campaign_replies_v17:usr_serve:serve');
        return {
          ok: true,
          owner: 'serve',
          messages: [{ id: 'reply-session-cache', accountEmail: 'serve@softora.nl', from: 'Direct uit tabcache' }],
          sync: { source: 'tab-session-cache' },
        };
      },
      write() { return true; },
    },
  };
  delete require.cache[modulePath];
  const freshCampaignInboxModule = require(modulePath);
  let fetchCalls = 0;

  try {
    const result = await freshCampaignInboxModule.load('outreach', (message) => message, async () => {
      fetchCalls += 1;
      throw new Error('tabcache hoort de eerste request over te slaan');
    });
    assert.equal(result.messages[0].id, 'reply-session-cache');
    assert.equal(result.fromBootstrap, true);
    assert.equal(fetchCalls, 0);
  } finally {
    delete require.cache[modulePath];
    globalThis.document = previousDocument;
    globalThis.SoftoraPageBootstrapSession = previousBootstrapSession;
    globalThis.SoftoraMailboxCampaignInbox = previousApi;
  }
});

test('mailbox valt tijdens een tijdelijke indexstoring terug op de laatst bekende tabdata', async () => {
  const previousDocument = globalThis.document;
  const previousBootstrapSession = globalThis.SoftoraPageBootstrapSession;
  const previousApi = globalThis.SoftoraMailboxCampaignInbox;
  const modulePath = require.resolve('../../assets/premium-mailbox-campaign-inbox.js');
  globalThis.document = { getElementById() { return null; } };
  globalThis.SoftoraPageBootstrapSession = {
    get() { return { authenticated: true, userId: 'usr_serve', email: 'serve@softora.nl' }; },
    cache: {
      read() {
        return {
          ok: true,
          owner: 'serve',
          messages: [{ id: 'reply-session-recovery', accountEmail: 'serve@softora.nl', from: 'Bewaarde reactie' }],
          sync: { source: 'campaign-replies-index' },
        };
      },
      write() { return true; },
    },
  };
  delete require.cache[modulePath];
  const freshCampaignInboxModule = require(modulePath);

  try {
    const result = await freshCampaignInboxModule.load(
      'outreach',
      (message) => message,
      async () => ({
        ok: false,
        status: 504,
        json: async () => ({ error: 'Mailbox-index tijdelijk niet leesbaar' }),
      }),
      { owner: 'serve', skipBootstrap: true }
    );
    assert.equal(result.messages[0].id, 'reply-session-recovery');
    assert.equal(result.fromCache, true);
    assert.equal(result.sync.stale, true);
    assert.equal(result.sync.refreshRecommended, true);
    assert.equal(result.sync.source, 'campaign-replies-session-cache');
  } finally {
    delete require.cache[modulePath];
    globalThis.document = previousDocument;
    globalThis.SoftoraPageBootstrapSession = previousBootstrapSession;
    globalThis.SoftoraMailboxCampaignInbox = previousApi;
  }
});

test('mailbox verkiest de serverbootstrap boven een nieuwere maar verouderde tabcache', async () => {
  const previousDocument = globalThis.document;
  const previousBootstrapSession = globalThis.SoftoraPageBootstrapSession;
  const previousApi = globalThis.SoftoraMailboxCampaignInbox;
  const modulePath = require.resolve('../../assets/premium-mailbox-campaign-inbox.js');
  let cachedSnapshot = {
    ok: true,
    savedAt: '2026-07-23T08:00:00.000Z',
    messages: [
      { id: 'reply-delete', mailboxId: 'inbox:42', uid: 42, folder: 'inbox', accountEmail: 'serve@softora.nl' },
      { id: 'reply-keep', mailboxId: 'inbox:43', uid: 43, folder: 'inbox', accountEmail: 'serve@softora.nl' },
    ],
    sync: { source: 'tab-session-cache' },
  };
  globalThis.document = {
    getElementById(id) {
      if (id !== 'softoraPageStateBootstrap') return null;
      return {
        textContent: JSON.stringify({
          mailbox: {
            ok: true,
            savedAt: '2026-07-23T07:00:00.000Z',
            messages: [
              { id: 'reply-keep', mailboxId: 'inbox:43', uid: 43, folder: 'inbox', accountEmail: 'serve@softora.nl' },
            ],
          },
        }),
      };
    },
  };
  globalThis.SoftoraPageBootstrapSession = {
    get() { return { authenticated: true, userId: 'usr_serve', email: 'serve@softora.nl' }; },
    cache: {
      read() { return cachedSnapshot; },
      write(_key, value) {
        cachedSnapshot = value;
        return true;
      },
    },
  };
  delete require.cache[modulePath];
  const freshCampaignInboxModule = require(modulePath);

  try {
    const authoritativeResult = await freshCampaignInboxModule.load('outreach', (message) => message);
    assert.deepEqual(authoritativeResult.messages.map((message) => message.id), ['reply-keep']);

    assert.equal(freshCampaignInboxModule.removeCachedMessage({
      mailboxId: 'inbox:42',
      uid: 42,
      folder: 'inbox',
      accountEmail: 'serve@softora.nl',
    }), false);
    assert.deepEqual(cachedSnapshot.messages.map((message) => message.id), ['reply-keep']);

    const result = await freshCampaignInboxModule.load('outreach', (message) => message);
    assert.deepEqual(result.messages.map((message) => message.id), ['reply-keep']);
  } finally {
    delete require.cache[modulePath];
    globalThis.document = previousDocument;
    globalThis.SoftoraPageBootstrapSession = previousBootstrapSession;
    globalThis.SoftoraMailboxCampaignInbox = previousApi;
  }
});

test('mailbox deelt een bevestigde verwijdering direct met andere open tabs', () => {
  const previousDocument = globalThis.document;
  const previousBootstrapSession = globalThis.SoftoraPageBootstrapSession;
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const previousApi = globalThis.SoftoraMailboxCampaignInbox;
  const modulePath = require.resolve('../../assets/premium-mailbox-campaign-inbox.js');
  const openChannels = new Set();
  let cachedSnapshot = {
    ok: true,
    savedAt: '2026-07-23T08:00:00.000Z',
    messages: [
      { id: 'reply-delete', mailboxId: 'inbox:42', uid: 42, folder: 'inbox', accountEmail: 'serve@softora.nl' },
      { id: 'reply-keep', mailboxId: 'inbox:43', uid: 43, folder: 'inbox', accountEmail: 'serve@softora.nl' },
    ],
  };
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.listener = null;
      openChannels.add(this);
    }
    addEventListener(type, listener) {
      if (type === 'message') this.listener = listener;
    }
    removeEventListener(type, listener) {
      if (type === 'message' && this.listener === listener) this.listener = null;
    }
    postMessage(data) {
      openChannels.forEach((channel) => {
        if (channel !== this && channel.name === this.name && channel.listener) {
          channel.listener({ data });
        }
      });
    }
    close() {
      openChannels.delete(this);
    }
  }
  globalThis.document = {
    getElementById(id) {
      if (id !== 'softoraPageStateBootstrap') return null;
      return { textContent: JSON.stringify({ session: { authenticated: true, userId: 'usr_serve' } }) };
    },
  };
  globalThis.SoftoraPageBootstrapSession = {
    get() { return { authenticated: true, userId: 'usr_serve', email: 'serve@softora.nl' }; },
    cache: {
      read() { return cachedSnapshot; },
      write(_key, value) {
        cachedSnapshot = value;
        return true;
      },
    },
  };
  globalThis.BroadcastChannel = FakeBroadcastChannel;
  delete require.cache[modulePath];
  const freshCampaignInboxModule = require(modulePath);
  const received = [];
  const unsubscribe = freshCampaignInboxModule.subscribeToMessageDeletions((identity) => {
    received.push(identity);
  });

  try {
    assert.equal(freshCampaignInboxModule.publishMessageDeletion({
      mailboxId: 'inbox:42',
      uid: 42,
      folder: 'inbox',
      accountEmail: 'serve@softora.nl',
    }), true);
    assert.deepEqual(cachedSnapshot.messages.map((message) => message.id), ['reply-keep']);
    assert.deepEqual(received, [{
      accountEmail: 'serve@softora.nl',
      folder: 'inbox',
      uid: 42,
      id: 'inbox:42',
    }]);
  } finally {
    unsubscribe();
    delete require.cache[modulePath];
    globalThis.document = previousDocument;
    globalThis.SoftoraPageBootstrapSession = previousBootstrapSession;
    globalThis.BroadcastChannel = previousBroadcastChannel;
    globalThis.SoftoraMailboxCampaignInbox = previousApi;
  }
});

test('cross-tab verwijdering van een andere mail heropent het actieve detail zonder laadlaag', () => {
  const previousDocument = globalThis.document;
  const previousAddEventListener = globalThis.addEventListener;
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const openChannels = new Set();
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.listener = null;
      openChannels.add(this);
    }
    addEventListener(type, listener) {
      if (type === 'message') this.listener = listener;
    }
    removeEventListener(type, listener) {
      if (type === 'message' && this.listener === listener) this.listener = null;
    }
    postMessage(data) {
      openChannels.forEach((channel) => {
        if (channel !== this && channel.name === this.name) channel.listener?.({ data });
      });
    }
    close() { openChannels.delete(this); }
  }
  globalThis.document = { getElementById() { return null; } };
  globalThis.addEventListener = () => {};
  globalThis.BroadcastChannel = FakeBroadcastChannel;
  let messages = [{
    id: 'reply-delete', mailboxId: 'inbox:42', uid: 42,
    folder: 'inbox', accountEmail: 'serve@softora.nl',
  }, {
    id: 'reply-active', mailboxId: 'inbox:43', uid: 43,
    folder: 'inbox', accountEmail: 'serve@softora.nl',
  }];
  let activeId = 'reply-active';
  const opens = [];
  const unsubscribe = campaignInboxModule.bindMessageDeletionSync({
    getMessages: () => messages,
    setMessages: (value) => { messages = value; },
    getActiveId: () => activeId,
    setActiveId: (value) => { activeId = value; },
    filterMessages: (value) => value,
    renderList() {},
    openMail: (id, openOptions) => opens.push({ id, openOptions }),
    resetDetail() { throw new Error('het actieve detail mag niet worden gereset'); },
  });

  try {
    assert.equal(campaignInboxModule.publishMessageDeletion(messages[0]), true);
    assert.deepEqual(messages.map((message) => message.id), ['reply-active']);
    assert.equal(activeId, 'reply-active');
    assert.deepEqual(opens, [{
      id: 'reply-active',
      openOptions: {
        skipBodyFetch: true,
        preserveVisibleDetail: true,
      },
    }]);
  } finally {
    unsubscribe();
    globalThis.document = previousDocument;
    globalThis.addEventListener = previousAddEventListener;
    globalThis.BroadcastChannel = previousBroadcastChannel;
  }
});
