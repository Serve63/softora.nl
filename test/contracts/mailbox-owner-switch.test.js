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

test('eigenaarwissel leegt de oude view direct en een late response kan nooit terugschrijven', async () => {
  let owner = 'serve';
  let messages = [{ id: 'oude-serve-mail' }];
  let activeMail = 'oude-serve-mail';
  let composeClosed = 0;
  const pending = new Map();
  const campaignInboxStub = {
    setOwner(value) { owner = value; return owner; },
    filterMessages(value, selectedOwner) {
      return value.filter((message) => message.owner === selectedOwner);
    },
    load(_folder, _normalize, _fetch, options) {
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

  pending.get('serve')({ messages: [{ id: 'stale', owner: 'serve' }], sync: {} });
  assert.equal(await staleServeLoad, false);
  assert.deepEqual(messages, []);

  pending.get('martijn')({ messages: [{ id: 'actueel', owner: 'martijn' }], sync: {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(messages.map((message) => message.id), ['actueel']);
});

test('campaign tabcache is per ingelogde identiteit en per gekozen eigenaar gescheiden', () => {
  const previousSession = global.SoftoraPageBootstrapSession;
  global.SoftoraPageBootstrapSession = {
    get: () => ({ authenticated: true, userId: 'user-1', email: 'serve@softora.nl' }),
  };
  try {
    assert.equal(
      campaignInbox.getMailboxTabCacheKey('serve'),
      'mailbox_campaign_replies_v5:user-1:serve'
    );
    assert.equal(
      campaignInbox.getMailboxTabCacheKey('martijn'),
      'mailbox_campaign_replies_v5:user-1:martijn'
    );
  } finally {
    global.SoftoraPageBootstrapSession = previousSession;
  }
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
