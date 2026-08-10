const test = require('node:test');
const assert = require('node:assert/strict');

const ownerSession = require('../../assets/premium-mailbox-owner-session.js');
const campaignInbox = require('../../assets/premium-mailbox-campaign-inbox.js');
const {
  getMailboxMessageOwner,
  mergeCampaignReplies,
} = require('../../server/services/mailbox-instantly-integration');

function response(payload) {
  const contentAt = payload?.contentAt || new Date().toISOString();
  return {
    ok: true,
    json: async () => ({
      ...payload,
      contentAt,
      complete: payload?.complete !== false,
      sync: { ...(payload?.sync || {}), contentAt, origin: payload?.origin || 'live-api' },
    }),
  };
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

test('BFCache-pauze annuleert de actieve lijstload en blokkeert een late same-scope commit', async () => {
  let messages = [{ id: 'zichtbaar' }];
  let resolveLoad;
  let requestOptions;
  const pendingLoad = new Promise((resolve) => { resolveLoad = resolve; });
  const view = ownerSession.createView({
    getScope: () => ({ owner: 'serve', folder: 'outreach' }),
    campaignInbox: {
      load(_folder, _normalize, _fetch, options) {
        requestOptions = options;
        return pendingLoad;
      },
      filterMessages: (value) => value,
    },
    getMessages: () => messages,
    setMessages: (value) => { messages = value; },
    filterDeleted: (value) => value,
    getListElement: () => ({ setAttribute() {} }),
    setSync() {},
    setStatus() {},
  });

  const loading = view.load({ preserveOnError: true });
  assert.equal(requestOptions.signal.aborted, false);
  view.cancelActive();
  assert.equal(requestOptions.signal.aborted, true);
  resolveLoad({
    contentAt: new Date().toISOString(),
    complete: true,
    messages: [{ id: 'late' }],
    sync: {},
  });

  assert.equal(await loading, false);
  assert.deepEqual(messages.map((message) => message.id), ['zichtbaar']);
});

test('gekozen campagne-eigenaar blijft na een refresh dezelfde servervoorkeur houden', async () => {
  const writes = [];
  const client = {
    async get() { return { values: {} }; },
    async set(scope, payload) { writes.push({ scope, payload }); },
  };
  await campaignInbox.initializeOwnerPreference(
    { authenticated: true, email: 'serve@softora.nl' },
    client,
    'serve@softora.nl'
  );
  assert.equal(campaignInbox.setOwner('both'), 'both');
  await new Promise((resolve) => setImmediate(resolve));
  const selectionWrite = writes.find((entry) => entry.payload?.patch?.['softora_mailbox_active_owner_v1_serve@softora.nl'] === 'both');
  assert.ok(selectionWrite);
  assert.equal(campaignInbox.getOwner(), 'both');
  campaignInbox.setOwner('serve');
});

test('bootstrapverversing hervat exact het actieve gesprek en ruimt een verdwenen nepthread op', async () => {
  async function runScenario(liveMessages) {
    let calls = 0;
    let messages = [];
    let activeMail = 'altiflex-thread';
    let opened = 0;
    let reset = 0;
    const view = ownerSession.createView({
      getScope: () => ({ owner: 'serve', folder: 'outreach' }),
      campaignInbox: {
        async load() {
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
    return { activeMail, calls, opened, reset };
  }

  const retained = await runScenario([{ id: 'altiflex-thread', owner: 'serve' }]);
  assert.deepEqual(retained, { activeMail: 'altiflex-thread', calls: 2, opened: 1, reset: 0 });

  const removed = await runScenario([]);
  assert.deepEqual(removed, { activeMail: null, calls: 2, opened: 0, reset: 1 });
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

test('vastgelopen gewone inboxlijst wordt hard begrensd en laat een volgende refresh vrij', async () => {
  const messages = [{ id: 'bestaand-inboxbericht' }];
  const statuses = [];
  const busyStates = [];
  let timeoutHandler;
  let requestSignal;
  let requestAborted = false;
  const view = ownerSession.createView({
    getScope: () => ({ account: 'serve@softora.nl', folder: 'inbox' }),
    campaignInbox: {
      async load() { return null; },
      filterMessages: (value) => value,
    },
    fetch(_url, init) {
      requestSignal = init.signal;
      requestSignal.addEventListener('abort', () => { requestAborted = true; }, { once: true });
      return new Promise(() => {});
    },
    getMessages: () => messages,
    setMessages() { throw new Error('een timeout mag zichtbare mail niet vervangen'); },
    filterDeleted: (value) => value,
    getActiveMail: () => messages[0].id,
    getListElement: () => ({ setAttribute(_name, value) { busyStates.push(value); } }),
    renderList() {},
    openMail() {},
    setSync() {},
    setStatus: (value) => statuses.push(value),
    setTimeout(handler) { timeoutHandler = handler; return 1; },
    clearTimeout() {},
  });

  const pending = view.load({ preserveOnError: true, openLatest: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof timeoutHandler, 'function');
  assert.equal(requestSignal.aborted, false);
  timeoutHandler();

  assert.equal(await pending, false);
  assert.equal(requestSignal.aborted, true);
  assert.equal(requestAborted, true);
  assert.deepEqual(messages.map((message) => message.id), ['bestaand-inboxbericht']);
  assert.equal(statuses.at(-1), ownerSession.MAILBOX_STALE_STATUS);
  assert.equal(busyStates.at(-1), 'false');

  const second = view.load({ preserveOnError: true, openLatest: false });
  await new Promise((resolve) => setImmediate(resolve));
  timeoutHandler();
  assert.equal(await second, false);
});

test('een oudere degraded response kan een nieuwere zichtbare mailbox nooit overschrijven', async () => {
  const newerAt = new Date(Date.now() - 30_000).toISOString();
  const olderAt = new Date(Date.now() - 90_000).toISOString();
  let messages = [{ id: 'nieuwste-reactie', accountEmail: 'serve@softora.nl', uid: 101 }];
  let sync = { contentAt: newerAt, contentVersion: '12', origin: 'live-api' };
  const statuses = [];
  let writes = 0;
  const view = ownerSession.createView({
    getScope: () => ({ owner: 'serve', folder: 'outreach' }),
    campaignInbox: {
      async load() {
        return {
          origin: 'live-api',
          contentAt: olderAt,
          contentVersion: '12',
          complete: false,
          degraded: true,
          messages: [{ id: 'oude-cache', accountEmail: 'serve@softora.nl', uid: 88 }],
          sync: { contentAt: olderAt, contentVersion: '12', origin: 'live-api', stale: true },
        };
      },
      filterMessages: (value) => value,
    },
    getMessages: () => messages,
    setMessages: () => { writes += 1; },
    getSync: () => sync,
    setSync: (value) => { sync = value; },
    filterDeleted: (value) => value,
    getListElement: () => ({ setAttribute() {} }),
    setStatus: (value) => statuses.push(value),
  });

  assert.equal(await view.load({ preserveOnError: true }), false);
  assert.equal(writes, 0);
  assert.deepEqual(messages.map((message) => message.id), ['nieuwste-reactie']);
  assert.equal(statuses.at(-1), ownerSession.MAILBOX_STALE_STATUS);
});

test('een nieuwere degraded response voegt alleen toe en een complete nieuwere response mag vervangen', async () => {
  const initialAt = new Date(Date.now() - 20 * 60_000).toISOString();
  const degradedAt = new Date(Date.now() - 60_000).toISOString();
  const completeAt = new Date(Date.now() - 10_000).toISOString();
  let messages = [{
    id: 'bestaand', accountEmail: 'serve@softora.nl', uid: 101, body: 'volledig', bodyLoaded: true, unread: false,
    threadMessages: [{ id: 't1', body: 'volledig' }, { id: 't2', body: 'blijft staan' }],
  }];
  let sync = { contentAt: initialAt, contentVersion: '12', origin: 'live-api' };
  const statuses = [];
  const results = [
    {
      origin: 'live-api', contentAt: degradedAt, contentVersion: '13', complete: false, degraded: true,
      messages: [
        { id: 'nieuw', accountEmail: 'serve@softora.nl', uid: 102 },
        {
          id: 'bestaand', accountEmail: 'serve@softora.nl', uid: 101, unread: true,
          threadMessages: [{ id: 't1', body: 'afgekapt' }],
        },
      ],
      sync: { contentAt: degradedAt, contentVersion: '13', origin: 'live-api', stale: true },
    },
    {
      origin: 'live-api', contentAt: completeAt, contentVersion: '14', complete: true, messages: [],
      sync: { contentAt: completeAt, contentVersion: '14', origin: 'live-api' },
    },
  ];
  const view = ownerSession.createView({
    getScope: () => ({ owner: 'serve', folder: 'outreach' }),
    campaignInbox: {
      async load() { return results.shift(); },
      filterMessages: (value) => value,
    },
    getMessages: () => messages,
    setMessages: (value) => { messages = value; },
    getSync: () => sync,
    setSync: (value) => { sync = value; },
    filterDeleted: (value) => value,
    getListElement: () => ({ setAttribute() {} }),
    renderList() {},
    resetDetail() {},
    setActiveMail() {},
    setStatus: (value) => statuses.push(value),
  });

  assert.equal(await view.load({ openLatest: false }), false);
  assert.deepEqual(messages.map((message) => message.id), ['nieuw', 'bestaand']);
  assert.equal(messages[1].unread, false);
  assert.deepEqual(messages[1].threadMessages.map((message) => message.id), ['t1', 't2']);
  assert.equal(statuses.at(-1), ownerSession.MAILBOX_STALE_STATUS);
  assert.equal(sync.stale, true);

  assert.equal(await view.load({ openLatest: false }), true);
  assert.deepEqual(messages, []);
  assert.equal(statuses.at(-1), '');
  assert.equal(sync.contentAt, completeAt);
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

  pending.get('serve')({ messages: [{ id: 'stale', owner: 'serve' }], sync: {} });
  assert.equal(await staleServeLoad, false);
  assert.deepEqual(messages, []);

  pending.get('martijn')({ messages: [{ id: 'actueel', owner: 'martijn' }], sync: {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(messages.map((message) => message.id), ['actueel']);
  assert.deepEqual(opened, ['actueel']);
  assert.equal(activeMail, 'actueel');
});

test('een gecombineerde serverbootstrap filtert serve martijn en both zonder cross-owner lek', async () => {
  const bootstrapContentAt = new Date().toISOString();
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
            owner: 'both',
            contentAt: bootstrapContentAt,
            contentVersion: '12',
            complete: true,
            origin: 'server-bootstrap',
            messages: [
              { id: 'serve-imap', accountEmail: 'serve@softora.nl' },
              { id: 'martijn-imap', accountEmail: 'martijn@softora.nl' },
              { id: 'serve-instantly', provider: 'instantly', providerOwner: 'serve' },
              { id: 'martijn-instantly', provider: 'instantly', providerOwner: 'martijn' },
              { id: 'unknown-imap', accountEmail: 'info@softora.nl' },
              { id: 'unknown-instantly', provider: 'instantly', providerOwner: 'both' },
            ],
            sync: {
              source: 'campaign-replies-snapshot',
              contentAt: bootstrapContentAt,
              contentVersion: '12',
              origin: 'server-bootstrap',
            },
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
      'mailbox_campaign_replies_v19:user-1:serve'
    );
    assert.equal(
      campaignInbox.getMailboxTabCacheKey('martijn'),
      'mailbox_campaign_replies_v19:user-1:martijn'
    );
    assert.equal(
      campaignInbox.getMailboxTabCacheKey('both'),
      'mailbox_campaign_replies_v19:user-1:both'
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
  ]));
  assert.equal(result.snapshotComplete, false);
  assert.equal(getMailboxMessageOwner(baseReplies[0]), 'serve');
  assert.equal(getMailboxMessageOwner(baseReplies[1]), 'martijn');
  assert.equal(getMailboxMessageOwner(baseReplies[2]), 'martijn');
  assert.equal(getMailboxMessageOwner({
    ...baseReplies[2],
    copyContext: null,
  }), '');
});
