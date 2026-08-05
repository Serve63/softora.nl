const test = require('node:test');
const assert = require('node:assert/strict');

const ownerSession = require('../../assets/premium-mailbox-owner-session.js');
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
      'mailbox_campaign_replies_v13:user-1:serve'
    );
    assert.equal(
      campaignInbox.getMailboxTabCacheKey('martijn'),
      'mailbox_campaign_replies_v13:user-1:martijn'
    );
    assert.equal(
      campaignInbox.getMailboxTabCacheKey('both'),
      'mailbox_campaign_replies_v13:user-1:both'
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
    'instantly-serve',
    'instantly-martijn',
  ]));
  assert.equal(getMailboxMessageOwner(baseReplies[0]), 'serve');
  assert.equal(getMailboxMessageOwner(baseReplies[1]), 'martijn');
});
