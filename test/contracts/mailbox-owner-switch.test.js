const test = require('node:test');
const assert = require('node:assert/strict');

const ownerSession = require('../../assets/premium-mailbox-owner-session.js');
const ownerPreferenceApi = require('../../assets/premium-mailbox-owner-preference.js');
const campaignInbox = require('../../assets/premium-mailbox-campaign-inbox.js');
const {
  getMailboxMessageOwner,
  mergeCampaignReplies,
} = require('../../server/services/mailbox-instantly-integration');

function response(payload) {
  return {
    ok: true,
    json: async () => payload,
  };
}

function createUrlState(initialUrl = 'https://www.softora.nl/premium-mailbox') {
  const location = new URL(initialUrl);
  const replacements = [];
  const history = {
    state: null,
    replaceState(state, _title, nextUrl) {
      this.state = state;
      replacements.push(nextUrl === undefined ? null : String(nextUrl));
      if (nextUrl !== undefined) location.href = new URL(String(nextUrl), location.href).href;
    },
  };
  return { history, location, replacements };
}

test('mailbox owner session annuleert een oude request en accepteert alleen de nieuwste scope', () => {
  const session = ownerSession.create();
  const serve = session.begin({ owner: 'serve', folder: 'outreach' });
  assert.equal(session.isCurrent(serve), true);

  const martijn = session.begin({ owner: 'martijn', folder: 'outreach' });
  assert.equal(serve.signal.aborted, true);
  assert.equal(session.isCurrent(serve), false);
  assert.equal(session.isCurrent(martijn), true);

  let staleCommitted = false;
  let currentCommitted = false;
  assert.equal(session.commit(serve, serve.scope, () => { staleCommitted = true; }), false);
  assert.equal(session.commit(martijn, martijn.scope, () => { currentCommitted = true; }), true);
  assert.equal(staleCommitted, false);
  assert.equal(currentCommitted, true);
});

test('mailbox owner session behandelt account, folder en owner als een atomische scope', () => {
  const session = ownerSession.create();
  const token = session.begin({ owner: 'serve', account: '', folder: 'outreach' });
  assert.equal(session.isCurrent(token, { owner: 'serve', account: '', folder: 'outreach' }), true);
  assert.equal(session.isCurrent(token, { owner: 'martijn', account: '', folder: 'outreach' }), false);
  assert.equal(session.isCurrent(token, { owner: 'serve', account: '', folder: 'sent' }), false);
});

test('late normale inboxload kan een actieve zoekresultaatlijst niet overschrijven', async () => {
  let messages = [{ id: 'zoekresultaat-jenny' }];
  let searchActive = false;
  let resolveLoad;
  let renderCalls = 0;
  const pendingLoad = new Promise((resolve) => { resolveLoad = resolve; });
  const view = ownerSession.createView({
    getScope: () => ({ owner: 'both', folder: 'outreach' }),
    campaignInbox: {
      load: () => pendingLoad,
      filterMessages: (value) => value,
    },
    getMessages: () => messages,
    setMessages: (value) => { messages = value; },
    filterDeleted: (value) => value,
    getActiveMail: () => null,
    setActiveMail() {},
    getListElement: () => ({ setAttribute() {} }),
    renderList: () => { renderCalls += 1; },
    setSync() {},
    setStatus() {},
    shouldApplyMessages: () => !searchActive,
  });

  const normalLoad = view.load();
  searchActive = true;
  resolveLoad({
    messages: [{ id: 'normale-inbox-1' }, { id: 'normale-inbox-2' }],
    sync: {},
  });

  assert.equal(await normalLoad, false);
  assert.deepEqual(messages.map((message) => message.id), ['zoekresultaat-jenny']);
  assert.equal(renderCalls, 0);
});

test('achtergrondrefresh behoudt een geladen contactdossier buiten de smalle RFC-thread', () => {
  const current = [{
    id: 'root-message',
    contactTimelineLoaded: true,
    contactTimelineTotal: 8,
    contactTimelineThreadCount: 2,
    externalContactEmail: 'contact@example.test',
    threadMessages: [
      { id: 'standalone-in', messageId: '<standalone-in@example.test>', subject: 'Afspraak', body: 'Nieuw los bericht', bodyLoaded: true },
      { id: 'standalone-out', messageId: '<standalone-out@example.test>', subject: 'Re: Afspraak', body: 'Nieuw los antwoord', bodyLoaded: true },
      { id: 'timeline-old-reply', messageId: '<old-reply@example.test>', subject: 'Re: Oude vraag', body: 'Volledig oud antwoord', bodyLoaded: true },
    ],
  }];
  const refresh = [{
    id: 'root-message',
    contactTimelineLoaded: false,
    contactTimelineTotal: 1,
    threadMessages: [
      { id: 'snapshot-old-reply', messageId: 'old-reply@example.test', subject: 'Re: Oude vraag', body: 'Korte preview', bodyLoaded: false },
      { id: 'older-in', messageId: '<older-in@example.test>', subject: 'Oude vraag', body: 'Ouder bericht', bodyLoaded: true },
    ],
  }];

  const reconciled = ownerSession.reconcileMessages(current, refresh);

  assert.equal(reconciled[0], current[0]);
  assert.equal(reconciled[0].contactTimelineLoaded, true);
  assert.equal(reconciled[0].contactTimelineTotal, 8);
  assert.equal(reconciled[0].contactTimelineThreadCount, 2);
  assert.equal(reconciled[0].externalContactEmail, 'contact@example.test');
  assert.equal(reconciled[0].contactTimelineNeedsRefresh, true);
  assert.deepEqual(reconciled[0].threadMessages.map((message) => message.id), [
    'standalone-in', 'standalone-out', 'snapshot-old-reply',
  ]);
  assert.equal(reconciled[0].threadMessages[2].body, 'Volledig oud antwoord');
  assert.equal(reconciled[0].threadMessages[2].bodyLoaded, true);
});

test('gekozen campagne-eigenaar schrijft de servervoorkeur met keepalive', async () => {
  const writes = [];
  const client = {
    async get() { return { values: {} }; },
    async set(scope, payload, options) { writes.push({ scope, payload, options }); },
  };
  await campaignInbox.initializeOwnerPreference(
    { authenticated: true, email: 'serve@softora.nl' },
    client,
    'serve@softora.nl'
  );

  assert.equal(campaignInbox.setOwner('both'), 'both');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(writes, [{
    scope: 'premium_mailbox_preferences',
    payload: {
      patch: { 'softora_mailbox_active_owner_v1_serve@softora.nl': 'both' },
      source: 'premium-mailbox',
      actor: 'serve@softora.nl',
    },
    options: { keepalive: true },
  }]);
  assert.equal(campaignInbox.getOwner(), 'both');
});

test('op een verse pagina blijft de pin de initiële default boven een oude serverselectie', async () => {
  const writes = [];
  let liveReads = 0;
  const client = {
    peek(scope) {
      assert.equal(scope, 'premium_mailbox_preferences');
      return {
        values: {
          softora_mailbox_pinned_owner_v1_usr_serve: 'serve',
          softora_mailbox_active_owner_v1_usr_serve: 'martijn',
        },
      };
    },
    async get() {
      liveReads += 1;
      return new Promise(() => {});
    },
    async set(scope, payload, options) { writes.push({ scope, payload, options }); },
  };

  const state = await campaignInbox.initializeOwnerPreference(
    { authenticated: true, email: 'serve@softora.nl' },
    client,
    'usr_serve'
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(state, {
    defaultOwner: 'serve',
    pinnedOwner: 'serve',
    activeOwner: 'serve',
  });
  assert.equal(liveReads, 0);
  assert.deepEqual(writes, []);
});

test('de identiteitsgebonden tabkeuze wint bij refresh van de pin en herstelt de serverselectie', async () => {
  const urlState = createUrlState();
  urlState.history.state = {
    softoraMailboxOwnerViewV1: { identity: 'usr_serve', owner: 'martijn' },
  };
  const previousLocation = global.location;
  const previousHistory = global.history;
  global.location = urlState.location;
  global.history = urlState.history;
  const writes = [];
  let liveReads = 0;

  try {
    const state = await campaignInbox.initializeOwnerPreference(
      { authenticated: true, email: 'serve@softora.nl' },
      {
        peek() {
          return {
            values: {
              softora_mailbox_pinned_owner_v1_usr_serve: 'serve',
              softora_mailbox_active_owner_v1_usr_serve: 'serve',
            },
          };
        },
        async get() { liveReads += 1; return new Promise(() => {}); },
        async set(scope, payload, options) { writes.push({ scope, payload, options }); return { ok: true }; },
      },
      'usr_serve'
    );
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(state, {
      defaultOwner: 'serve',
      pinnedOwner: 'serve',
      activeOwner: 'martijn',
    });
    assert.equal(liveReads, 0);
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].payload.patch, {
      softora_mailbox_active_owner_v1_usr_serve: 'martijn',
    });
    assert.deepEqual(writes[0].options, { keepalive: true });
  } finally {
    if (previousLocation === undefined) delete global.location;
    else global.location = previousLocation;
    if (previousHistory === undefined) delete global.history;
    else global.history = previousHistory;
  }
});

test('vastgepinde eigenaar blijft de initiële fallback als geen tabkeuze bestaat', async () => {
  const state = await campaignInbox.initializeOwnerPreference(
    { authenticated: true, email: 'martijn@softora.nl' },
    {
      async get() {
        return { values: { softora_mailbox_pinned_owner_v1_usr_martijn: 'serve' } };
      },
      async set() { throw new Error('initialisatie mag nooit schrijven'); },
    },
    'usr_martijn'
  );

  assert.deepEqual(state, {
    defaultOwner: 'martijn',
    pinnedOwner: 'serve',
    activeOwner: 'serve',
  });
});

test('voorkeurinitialisatie gebruikt een aanwezige bootstrap direct en start geen blokkerende liveread', async () => {
  let liveReads = 0;
  const preference = ownerPreferenceApi.create();
  const saved = await preference.initialize({
    peek() {
      return {
        values: {
          softora_mailbox_pinned_owner_v1_usr_serve: 'serve',
          softora_mailbox_active_owner_v1_usr_serve: 'martijn',
        },
      };
    },
    async get() { liveReads += 1; return new Promise(() => {}); },
    async set() { throw new Error('initialisatie mag nooit schrijven'); },
  }, 'usr_serve');

  assert.deepEqual(saved, { pinnedOwner: 'serve', selectedOwner: 'martijn', currentOwner: '' });
  assert.equal(liveReads, 0);
});

test('voorkeurinitialisatie met productie-peek wacht bij ontbrekende bootstrap nooit op de live timeout', async () => {
  let liveReads = 0;
  const preference = ownerPreferenceApi.create();
  const saved = await preference.initialize({
    peek() { return null; },
    async get() { liveReads += 1; return new Promise(() => {}); },
    async set() { return { ok: true }; },
  }, 'usr_serve');

  assert.deepEqual(saved, { pinnedOwner: '', selectedOwner: '', currentOwner: '' });
  assert.equal(liveReads, 0);
});

test('vertraagde eigenaarwrite blijft aan het oorspronkelijke gebruikersaccount gebonden', async () => {
  const urlState = createUrlState();
  const writes = [];
  const client = {
    async get() { return { values: {} }; },
    async set(scope, payload, options) { writes.push({ scope, payload, options }); },
  };
  const preference = ownerPreferenceApi.create(urlState);

  await preference.initialize(client, 'usr_serve');
  const serveWrite = preference.persist('martijn');
  urlState.location.href = 'https://www.softora.nl/premium-mailbox';
  await preference.initialize(client, 'usr_martijn');
  await serveWrite;

  assert.deepEqual(writes, [{
    scope: 'premium_mailbox_preferences',
    payload: {
      patch: { softora_mailbox_active_owner_v1_usr_serve: 'martijn' },
      source: 'premium-mailbox',
      actor: 'usr_serve',
    },
    options: { keepalive: true },
  }]);
});

test('identiteitsgebonden tab-viewstate geeft read-your-write terwijl de oude paginawrite nog niet is gecommit', async () => {
  const urlState = createUrlState();
  const serverValues = {
    softora_mailbox_pinned_owner_v1_usr_serve: 'serve',
    softora_mailbox_active_owner_v1_usr_serve: 'serve',
  };
  let releaseOldWrite;
  const oldWriteGate = new Promise((resolve) => { releaseOldWrite = resolve; });
  const oldPage = ownerPreferenceApi.create(urlState);
  const oldClient = {
    peek: () => ({ values: { ...serverValues } }),
    async get() { throw new Error('bootstrap is aanwezig'); },
    async set(_scope, payload) {
      await oldWriteGate;
      Object.assign(serverValues, payload.patch);
      return { ok: true };
    },
  };
  await oldPage.initialize(oldClient, 'usr_serve');
  const oldWrite = oldPage.persist('martijn');
  assert.deepEqual(urlState.history.state, {
    softoraMailboxOwnerViewV1: { identity: 'usr_serve', owner: 'martijn' },
  });
  await new Promise((resolve) => setImmediate(resolve));

  let newPageLiveReads = 0;
  const repairWrites = [];
  const newPage = ownerPreferenceApi.create(urlState);
  const duringHardRefresh = await newPage.initialize({
    peek: () => ({ values: { ...serverValues } }),
    async get() { newPageLiveReads += 1; return new Promise(() => {}); },
    async set(_scope, payload, options) {
      repairWrites.push({ payload, options });
      Object.assign(serverValues, payload.patch);
      return { ok: true };
    },
  }, 'usr_serve');

  assert.deepEqual(duringHardRefresh, {
    pinnedOwner: 'serve',
    selectedOwner: 'serve',
    currentOwner: 'martijn',
  });
  assert.equal(newPageLiveReads, 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(repairWrites.length, 1);
  assert.deepEqual(repairWrites[0].payload.patch, {
    softora_mailbox_active_owner_v1_usr_serve: 'martijn',
  });
  assert.deepEqual(repairWrites[0].options, { keepalive: true });

  releaseOldWrite();
  await oldWrite;
});

test('mislukte ownerwrite blijft via de tabgeschiedenis actief en wordt bij refresh hersteld', async () => {
  const urlState = createUrlState('https://www.softora.nl/premium-mailbox?message=abc#detail');
  const staleValues = { softora_mailbox_active_owner_v1_usr_serve: 'serve' };
  const firstPage = ownerPreferenceApi.create(urlState);
  await firstPage.initialize({
    peek: () => ({ values: staleValues }),
    async get() { throw new Error('bootstrap is aanwezig'); },
    async set() { throw new Error('offline'); },
  }, 'usr_serve');

  await assert.rejects(firstPage.persist('martijn'), /offline/);
  assert.equal(urlState.location.search, '?message=abc');
  assert.equal(urlState.location.hash, '#detail');
  assert.deepEqual(urlState.history.state, {
    softoraMailboxOwnerViewV1: { identity: 'usr_serve', owner: 'martijn' },
  });

  const retries = [];
  const nextPage = ownerPreferenceApi.create(urlState);
  const restored = await nextPage.initialize({
    peek: () => ({ values: staleValues }),
    async get() { throw new Error('bootstrap is aanwezig'); },
    async set(_scope, payload, options) { retries.push({ payload, options }); return { ok: true }; },
  }, 'usr_serve');

  assert.equal(restored.currentOwner, 'martijn');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(retries.length, 1);
  assert.equal(retries[0].payload.patch.softora_mailbox_active_owner_v1_usr_serve, 'martijn');
  assert.deepEqual(retries[0].options, { keepalive: true });
});

test('tab-viewstate van Servé wordt na accountwissel niet voor Martijn gelezen of opgeslagen', async () => {
  const urlState = createUrlState('https://www.softora.nl/premium-mailbox?message=abc#detail');
  const writes = [];
  const preference = ownerPreferenceApi.create(urlState);
  const client = {
    peek() {
      return {
        values: {
          softora_mailbox_pinned_owner_v1_usr_serve: 'serve',
          softora_mailbox_active_owner_v1_usr_serve: 'serve',
          softora_mailbox_pinned_owner_v1_usr_martijn: 'serve',
          softora_mailbox_active_owner_v1_usr_martijn: 'serve',
        },
      };
    },
    async get() { throw new Error('bootstrap is aanwezig'); },
    async set(scope, payload, options) { writes.push({ scope, payload, options }); return { ok: true }; },
  };

  await preference.initialize(client, 'usr_serve');
  await preference.persist('martijn');
  writes.length = 0;

  const afterAccountSwitch = await preference.initialize(client, 'usr_martijn');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(afterAccountSwitch, {
    pinnedOwner: 'serve',
    selectedOwner: 'serve',
    currentOwner: '',
  });
  assert.deepEqual(writes, []);
  assert.equal(urlState.location.search, '?message=abc');
  assert.equal(urlState.location.hash, '#detail');
  assert.deepEqual(urlState.history.state, {
    softoraMailboxOwnerViewV1: { identity: 'usr_serve', owner: 'martijn' },
  });
});

test('ownerpin schrijft pin en selectie in exact één atomische keepalive-request', async () => {
  const urlState = createUrlState('https://www.softora.nl/premium-mailbox?q=senioren#mail');
  const writes = [];
  const preference = ownerPreferenceApi.create(urlState);
  await preference.initialize({
    peek: () => ({ values: {} }),
    async get() { throw new Error('bootstrap is aanwezig'); },
    async set(scope, payload, options) { writes.push({ scope, payload, options }); return { ok: true }; },
  }, 'usr_serve');

  assert.equal(await preference.pin('martijn'), true);
  assert.equal(urlState.location.search, '?q=senioren');
  assert.equal(urlState.location.hash, '#mail');
  assert.deepEqual(urlState.history.state, {
    softoraMailboxOwnerViewV1: { identity: 'usr_serve', owner: 'martijn' },
  });
  assert.deepEqual(writes, [{
    scope: 'premium_mailbox_preferences',
    payload: {
      patch: {
        softora_mailbox_active_owner_v1_usr_serve: 'martijn',
        softora_mailbox_pinned_owner_v1_usr_serve: 'martijn',
      },
      source: 'premium-mailbox',
      actor: 'usr_serve',
    },
    options: { keepalive: true },
  }]);
});

test('bootstrapverversing hervat exact het actieve gesprek en ruimt een verdwenen nepthread op', async () => {
  async function runScenario(liveMessages) {
    let calls = 0;
    let messages = [];
    let activeMail = 'altiflex-thread';
    let opened = 0;
    let reset = 0;
    const refreshInstantly = [];
    const view = ownerSession.createView({
      getScope: () => ({ owner: 'serve', folder: 'outreach' }),
      campaignInbox: {
        async load(_folder, _normalize, _fetch, options) {
          refreshInstantly.push(options.refreshInstantly);
          calls += 1;
          return calls === 1
            ? { fromBootstrap: true, messages: [{ id: 'altiflex-thread', owner: 'serve' }], sync: {} }
            : { fromBootstrap: false, messages: liveMessages, sync: {} };
        },
        filterMessages: (value) => value,
      },
      getMessages: () => messages,
      setMessages: (value) => { messages = value; },
      filterDeleted: (value) => value,
      getActiveMail: () => activeMail,
      setActiveMail: (value) => { activeMail = value; },
      getListElement: () => ({ setAttribute() {} }),
      renderList() {},
      openMail: () => { opened += 1; },
      resetDetail: () => { reset += 1; },
      setSync() {},
      setStatus() {},
    });

    await view.load();
    await new Promise((resolve) => setImmediate(resolve));
    return { activeMail, calls, opened, refreshInstantly, reset };
  }

  const retained = await runScenario([{ id: 'altiflex-thread', owner: 'serve' }]);
  assert.deepEqual(retained, {
    activeMail: 'altiflex-thread',
    calls: 2,
    opened: 1,
    refreshInstantly: [true, false],
    reset: 0,
  });

  const removed = await runScenario([]);
  assert.deepEqual(removed, {
    activeMail: null,
    calls: 2,
    opened: 0,
    refreshInstantly: [true, false],
    reset: 1,
  });
});

test('tijdelijke indexfout bewaart de huidige mailbox en hervat afgebroken detailhydratie', async () => {
  const messages = [{
    id: 'actieve-reactie',
    bodyLoading: true,
    threadBodiesLoading: true,
    threadMessages: [{ id: 'sent-1', bodyLoading: true, imageLoading: true }],
  }];
  let activeMail = 'actieve-reactie';
  const opened = [];
  const rendered = [];
  const toasts = [];
  const listElement = { innerHTML: 'bestaande lijst', setAttribute() {} };
  const view = ownerSession.createView({
    getScope: () => ({ owner: 'serve', folder: 'outreach' }),
    campaignInbox: {
      async load() { throw new Error('Mailbox-index tijdelijk niet leesbaar'); },
      filterMessages: (value) => value,
    },
    getMessages: () => messages,
    setMessages() { throw new Error('bestaande berichten mogen niet worden vervangen'); },
    getActiveMail: () => activeMail,
    setActiveMail: (value) => { activeMail = value; },
    getListElement: () => listElement,
    renderList: (options) => rendered.push(options),
    openMail: (id, options) => opened.push({ id, options }),
    setSync() {},
    setStatus() {},
    toast: (message) => toasts.push(message),
  });

  assert.equal(await view.load({ preserveOnError: true, openLatest: false }), false);
  assert.equal(listElement.innerHTML, 'bestaande lijst');
  assert.equal(messages[0].bodyLoading, false);
  assert.equal(messages[0].threadBodiesLoading, false);
  assert.equal(messages[0].threadMessages[0].bodyLoading, false);
  assert.equal(messages[0].threadMessages[0].imageLoading, false);
  assert.deepEqual(rendered, [{ openLatest: false }]);
  assert.deepEqual(opened, [{ id: 'actieve-reactie', options: { skipReadPersist: true } }]);
  assert.deepEqual(toasts, []);
});

test('eerste tijdelijke indexfout toont nooit een technische foutmelding', async () => {
  let messages = [];
  const statuses = [];
  const toasts = [];
  const listElement = { innerHTML: '', setAttribute() {} };
  const view = ownerSession.createView({
    getScope: () => ({ owner: 'serve', folder: 'outreach' }),
    campaignInbox: {
      async load() { throw new Error('Mailbox-index voor campagnereacties kon niet worden gelezen.'); },
      filterMessages: (value) => value,
    },
    getMessages: () => messages,
    setMessages: (value) => { messages = value; },
    getListElement: () => listElement,
    setSync() {},
    setStatus: (status) => statuses.push(status),
    syncInboxBadge() {},
    toast: (message) => toasts.push(message),
  });

  assert.equal(await view.load(), false);
  assert.match(listElement.innerHTML, /Mailbox wordt opnieuw verbonden…/);
  assert.doesNotMatch(listElement.innerHTML, /Mailbox-index|mislukt|fout/i);
  assert.equal(statuses.at(-1), 'Opnieuw verbinden…');
  assert.deepEqual(toasts, []);
});

test('eigenaarwissel leegt de oude view direct en een late response kan nooit terugschrijven', async () => {
  let owner = 'serve';
  let messages = [{ id: 'oude-serve-mail' }];
  let activeMail = 'oude-serve-mail';
  let composeClosed = 0;
  const opened = [];
  const pending = new Map();
  const requestedOptions = new Map();
  const campaignInboxStub = {
    setOwner(value) { owner = value; return owner; },
    filterMessages(value, selectedOwner) {
      return value.filter((message) => message.owner === selectedOwner);
    },
    load(_folder, _normalize, _fetch, options) {
      requestedOptions.set(options.owner, options);
      return new Promise((resolve) => pending.set(options.owner, resolve));
    },
  };
  const listElement = { setAttribute() {}, innerHTML: '' };
  const view = ownerSession.createView({
    getScope: () => ({ owner, folder: 'outreach' }),
    campaignInbox: campaignInboxStub,
    fetch: async () => { throw new Error('niet verwacht'); },
    getMessages: () => messages,
    setMessages: (value) => { messages = value; },
    filterDeleted: (value) => value,
    getActiveMail: () => activeMail,
    setActiveMail: (value) => { activeMail = value; },
    getListElement: () => listElement,
    renderList() {},
    openMail: (id) => { opened.push(id); activeMail = id; },
    setSync() {},
    setStatus() {},
    closeCompose: () => { composeClosed += 1; },
    resetDetail() {},
    closeMenu() {},
    updateAccountUi() {},
  });

  const staleServeLoad = view.load();
  assert.equal(pending.has('serve'), true);
  view.switchOwner('martijn');
  assert.deepEqual(messages, []);
  assert.equal(activeMail, null);
  assert.equal(composeClosed, 1);
  assert.equal(pending.has('martijn'), true);
  assert.notEqual(requestedOptions.get('martijn').skipBootstrap, true);
  assert.equal(requestedOptions.get('martijn').refreshInstantly, false);

  pending.get('serve')({ messages: [{ id: 'stale', owner: 'serve' }], sync: {} });
  assert.equal(await staleServeLoad, false);
  assert.deepEqual(messages, []);

  pending.get('martijn')({ messages: [{ id: 'actueel', owner: 'martijn' }], sync: {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(messages.map((message) => message.id), ['actueel']);
  assert.deepEqual(opened, ['actueel']);
  assert.equal(activeMail, 'actueel');
});

test('een eigenaarloze serverbootstrap levert elke eigenaar exact zijn eigen berichten bij wisselen', async () => {
  const previousDocument = globalThis.document;
  const previousBootstrapSession = globalThis.SoftoraPageBootstrapSession;
  const previousApi = globalThis.SoftoraMailboxCampaignInbox;
  const modulePath = require.resolve('../../assets/premium-mailbox-campaign-inbox.js');
  globalThis.document = {
    getElementById(id) {
      if (id !== 'softoraPageStateBootstrap') return null;
      return {
        textContent: JSON.stringify({
          session: { authenticated: true, userId: 'user-1', email: 'serve@softora.nl' },
          mailbox: {
            ok: true,
            messages: [
              { id: 'serve-imap', accountEmail: 'serve@softora.nl' },
              { id: 'martijn-imap', accountEmail: 'martijn@softora.nl' },
              { id: 'serve-instantly', provider: 'instantly', providerOwner: 'serve' },
              { id: 'martijn-instantly', provider: 'instantly', providerOwner: 'martijn' },
            ],
            sync: { source: 'campaign-replies-snapshot' },
          },
        }),
      };
    },
  };
  globalThis.SoftoraPageBootstrapSession = {
    get: () => ({ authenticated: true, userId: 'user-1', email: 'serve@softora.nl' }),
    cache: { read: () => null, write: () => true },
  };
  delete require.cache[modulePath];
  const freshCampaignInbox = require(modulePath);

  try {
    const unexpectedFetch = async () => {
      throw new Error('de gedeelde bootstrap hoort beide eigenaarwissels te dragen');
    };
    const serve = await freshCampaignInbox.load(
      'outreach',
      (message) => message,
      unexpectedFetch,
      { owner: 'serve' }
    );
    const martijn = await freshCampaignInbox.load(
      'outreach',
      (message) => message,
      unexpectedFetch,
      { owner: 'martijn' }
    );
    const both = await freshCampaignInbox.load(
      'outreach',
      (message) => message,
      unexpectedFetch,
      { owner: 'both' }
    );

    assert.equal(serve.fromBootstrap, true);
    assert.equal(martijn.fromBootstrap, true);
    assert.deepEqual(serve.messages.map((message) => message.id), [
      'serve-imap',
      'serve-instantly',
    ]);
    assert.deepEqual(martijn.messages.map((message) => message.id), [
      'martijn-imap',
      'martijn-instantly',
    ]);
    assert.deepEqual(both.messages.map((message) => message.id), [
      'serve-imap',
      'martijn-imap',
      'serve-instantly',
      'martijn-instantly',
    ]);
  } finally {
    delete require.cache[modulePath];
    globalThis.document = previousDocument;
    globalThis.SoftoraPageBootstrapSession = previousBootstrapSession;
    globalThis.SoftoraMailboxCampaignInbox = previousApi;
  }
});

test('campaign tabcache is per ingelogde identiteit en per gekozen eigenaar gescheiden', () => {
  const previousSession = global.SoftoraPageBootstrapSession;
  global.SoftoraPageBootstrapSession = {
    get: () => ({ authenticated: true, userId: 'user-1', email: 'serve@softora.nl' }),
  };
  try {
    assert.equal(
      campaignInbox.getMailboxTabCacheKey('serve'),
      'mailbox_campaign_replies_v17:user-1:serve'
    );
    assert.equal(
      campaignInbox.getMailboxTabCacheKey('martijn'),
      'mailbox_campaign_replies_v17:user-1:martijn'
    );
    assert.equal(
      campaignInbox.getMailboxTabCacheKey('both'),
      'mailbox_campaign_replies_v17:user-1:both'
    );
  } finally {
    global.SoftoraPageBootstrapSession = previousSession;
  }
});

test('gecombineerde eigenaar haalt beide bewezen mailboxen op zonder server-owner te vervalsen', async () => {
  const requested = [];
  const result = await campaignInbox.load(
    'outreach',
    (message) => message,
    async (url) => {
      requested.push(url);
      return response({
        ok: true,
        owner: '',
        messages: [
          { id: 'serve-1', accountEmail: 'serve@softora.nl' },
          { id: 'martijn-1', accountEmail: 'martijn@softora.nl' },
          { id: 'unknown-1', accountEmail: 'info@softora.nl' },
        ],
      });
    },
    { owner: 'both', skipBootstrap: true }
  );

  assert.match(requested[0], /owner=&/);
  assert.deepEqual(result.messages.map((message) => message.id), ['serve-1', 'martijn-1']);
  assert.equal(result.owner, 'both');
});

test('campaign load houdt de aangevraagde eigenaar vast als de globale selectie tussentijds wijzigt', async () => {
  let resolveFetch;
  const requested = [];
  const pending = campaignInbox.load(
    'outreach',
    (message) => message,
    (url, options) => new Promise((resolve) => {
      requested.push({ url, options });
      resolveFetch = () => resolve(response({
        ok: true,
        owner: 'serve',
        messages: [
          { id: 'serve-1', accountEmail: 'serve@softora.nl' },
          { id: 'martijn-1', accountEmail: 'martijn@softora.nl' },
        ],
      }));
    }),
    { owner: 'serve', skipBootstrap: true }
  );
  campaignInbox.setOwner('martijn');
  resolveFetch();
  const result = await pending;

  assert.match(requested[0].url, /owner=serve/);
  assert.deepEqual(result.messages.map((message) => message.id), ['serve-1']);
  assert.equal(result.owner, 'serve');
});

test('server response isoleert IMAP en Instantly records exact op geselecteerde eigenaar', async () => {
  const baseReplies = [
    { id: 'imap-serve', accountEmail: 'serve@softora.nl', activityAt: '2026-07-27T10:00:00Z' },
    { id: 'imap-martijn', accountEmail: 'martijn@softora.nl', activityAt: '2026-07-27T11:00:00Z' },
    {
      id: 'martijn-bcc-copy-in-serve',
      accountEmail: 'serve@softora.nl',
      email: 'martijn@softora.nl',
      activityAt: '2026-07-27T11:30:00Z',
      copyContext: { evidenceKnown: true, sourceAccountEmail: 'martijn@softora.nl' },
    },
  ];
  const providerReplies = {
    serve: [{ id: 'instantly-serve', provider: 'instantly', providerOwner: 'serve', activityAt: '2026-07-27T12:00:00Z' }],
    martijn: [{ id: 'instantly-martijn', provider: 'instantly', providerOwner: 'martijn', activityAt: '2026-07-27T13:00:00Z' }],
  };
  const instantlyMailboxService = {
    isConfigured: () => true,
    getConfiguredAccounts: (owner) => [{ email: `${owner}@example.test` }],
    listOwnerConversations: async (owner) => providerReplies[owner],
  };
  const result = await mergeCampaignReplies({
    baseReplies,
    instantlyMailboxService,
    limit: 100,
    owner: 'serve',
    refreshInstantly: false,
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value) => String(value || ''),
  });

  assert.deepEqual(new Set(result.messages.map((message) => message.id)), new Set([
    'imap-serve',
    'instantly-serve',
  ]));
  assert.deepEqual(new Set(result.snapshotMessages.map((message) => message.id)), new Set([
    'imap-serve',
    'imap-martijn',
    'martijn-bcc-copy-in-serve',
    'instantly-serve',
    'instantly-martijn',
  ]));
  assert.equal(getMailboxMessageOwner(baseReplies[0]), 'serve');
  assert.equal(getMailboxMessageOwner(baseReplies[1]), 'martijn');
  assert.equal(getMailboxMessageOwner(baseReplies[2]), 'martijn');
  assert.equal(getMailboxMessageOwner({
    ...baseReplies[2],
    copyContext: null,
  }), '');
});
