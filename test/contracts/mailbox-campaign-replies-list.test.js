const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMailboxCampaignRepliesList,
} = require('../../server/services/mailbox-campaign-replies-list');
const {
  MAILBOX_CAMPAIGN_SNAPSHOT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
  parseMailboxCampaignSnapshot,
  serializeMailboxCampaignSnapshot,
} = require('../../server/services/mailbox-campaign-snapshot');
const { filterVisibleMailboxMessages } = require('../../server/services/mailbox-delivery-failure-visibility');

function snapshotFixture(overrides = {}) {
  const message = (id, accountEmail, extra = {}) => ({
    id, messageKey: id, accountEmail, receivedAt: new Date().toISOString(), threadMessages: [], ...extra,
  });
  const messages = [
    message('serve', 'serve@softora.nl'),
    message('martijn', 'martijn@softora.nl', {
      unread: true,
      threadMessages: [message('sent', 'martijn@softora.nl', { folder: 'sent' }), message('hidden-child', 'martijn@softora.nl')],
    }),
    message('hidden', 'martijn@softora.nl'),
    message('superseded', 'martijn@softora.nl'),
    message('wrong-account', 'martijn@softora.nl'),
    message('provider', 'martijn@softoradigital.nl', { provider: 'instantly', providerOwner: 'martijn' }),
    message('automatic', 'martijn@softora.nl', { subject: 'Automatic reply', autoSubmitted: 'auto-replied' }),
  ];
  const rows = [
    { message_key: 'serve', account_email: 'serve@softora.nl' },
    { message_key: 'martijn', account_email: 'martijn@softora.nl', softora_read_at: '2026-09-07T12:00:00Z', reply_dismissed_at: '2026-09-07T12:01:00Z', state_revision: 7 },
    { message_key: 'sent', account_email: 'martijn@softora.nl' },
    { message_key: 'superseded', account_email: 'martijn@softora.nl', generation_superseded_at: '2026-09-07T12:00:00Z' },
    { message_key: 'wrong-account', account_email: 'serve@softora.nl' },
    { message_key: 'provider', account_email: 'martijn@softoradigital.nl' },
    { message_key: 'automatic', account_email: 'martijn@softora.nl' },
  ];
  const calls = { canonical: 0, writes: 0, states: [] };
  const raw = serializeMailboxCampaignSnapshot({ ok: true, messages });
  const list = createMailboxCampaignRepliesList({
    getUiStateValues: async () => ({ values: { [MAILBOX_CAMPAIGN_SNAPSHOT_KEY]: raw } }),
    mailboxIndexStore: { listMessageStatesByKeys: async (options) => { calls.states.push(options); return rows; } },
    mailboxCampaignRepliesService: { listReplies: async () => { calls.canonical += 1; return []; } },
    instantlyMailboxService: { isConfigured: () => false },
    setUiStateValues: async () => { calls.writes += 1; },
    filterVisibleMailboxMessages,
    logger: { warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, length) => String(value || '').slice(0, length),
    ...overrides,
  });
  return { list, calls, raw };
}

test('eerste eigenaarwissel krijgt een actuele zichtbare snapshot zonder geschiedenis of snapshotwrite af te wachten', async () => {
  const { list, calls } = snapshotFixture({ mailboxCampaignRepliesService: {
    listReplies: async () => { assert.fail('de trage geschiedenisopbouw mag de eerste lijst niet blokkeren'); },
  } });
  const result = await list({ owner: 'martijn', hydrateBodies: false, preferSnapshot: true });
  assert.equal(result.fromSnapshot, true);
  assert.equal(result.owner, 'martijn');
  assert.deepEqual(result.messages.map((message) => message.id), ['martijn', 'provider']);
  assert.deepEqual(result.messages[0].threadMessages.map((message) => message.id), ['sent']);
  assert.equal(result.messages[0].unread, false);
  assert.equal(result.messages[0].replyDismissedAt, '2026-09-07T12:01:00Z');
  assert.equal(result.messages[0].stateRevision, 7);
  assert.equal(result.sync.refreshRecommended, true);
  assert.equal(result.sync.warming, false);
  assert.equal(calls.writes, 0);
  assert.ok(!calls.states[0].messageKeys.includes('serve'));
});

test('ontbrekende, verouderde of oncontroleerbare snapshots vallen terug op de canonical lijst', async () => {
  const { raw } = snapshotFixture();
  const stale = JSON.stringify({ ...JSON.parse(raw), savedAt: '2000-01-01T00:00:00Z' });
  for (const overrides of [
    { getUiStateValues: async () => null },
    { getUiStateValues: async () => { throw new Error('read timeout'); } },
    { getUiStateValues: async () => ({ values: { [MAILBOX_CAMPAIGN_SNAPSHOT_KEY]: stale } }) },
    { mailboxIndexStore: { listMessageStatesByKeys: async () => null } },
    { mailboxIndexStore: { listMessageStatesByKeys: async () => { throw new Error('index unavailable'); } } },
  ]) {
    const { list, calls } = snapshotFixture(overrides);
    const result = await list({ owner: 'martijn', hydrateBodies: false, preferSnapshot: true });
    assert.equal(result.fromSnapshot, undefined);
    assert.equal(calls.canonical, 1);
  }
});

test('een hangende snapshotread blokkeert de canonical fallback niet onbeperkt', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  let finishRead;
  const { list, calls, raw } = snapshotFixture({
    getUiStateValues: () => new Promise((resolve) => { finishRead = resolve; }),
  });
  const pending = list({ owner: 'martijn', hydrateBodies: false, preferSnapshot: true });
  t.mock.timers.tick(3500);
  const result = await pending;
  assert.equal(result.fromSnapshot, undefined);
  assert.equal(calls.canonical, 1);
  finishRead({ values: { [MAILBOX_CAMPAIGN_SNAPSHOT_KEY]: raw } });
  await Promise.resolve();
  assert.equal(calls.states.length, 0, 'een te late snapshot mag geen extra indexwerk meer starten');
});

test('backgroundrefresh, volledige bodies, providerrefresh en shared snapshot rebuild gebruiken altijd canonical data', async () => {
  for (const options of [
    { preferSnapshot: false },
    { hydrateBodies: true },
    { refreshInstantly: true },
    { includeSnapshotMessages: true },
  ]) {
    const { list, calls } = snapshotFixture();
    const result = await list({ owner: 'serve', hydrateBodies: false, preferSnapshot: true, ...options });
    assert.equal(result.fromSnapshot, undefined);
    assert.equal(calls.canonical, 1);
    assert.equal(calls.states.length, 0);
  }
});

test('een volledig verborgen snapshot geeft geen oude berichten terug', async () => {
  const { list, calls } = snapshotFixture({ mailboxIndexStore: { listMessageStatesByKeys: async () => [] } });
  const result = await list({ owner: 'martijn', hydrateBodies: false, preferSnapshot: true });
  assert.deepEqual(result.messages, []);
  assert.equal(result.fromSnapshot, true);
  assert.equal(calls.canonical, 0);
});

test('snapshotpad accepteert geen onbekende eigenaar en houdt limiet en beide eigenaren intact', async () => {
  const { list, calls } = snapshotFixture();
  await assert.rejects(list({ owner: 'other', hydrateBodies: false, preferSnapshot: true }), { status: 400 });
  assert.equal(calls.states.length, 0);
  const result = await list({ owner: '', limit: 2, hydrateBodies: false, preferSnapshot: true });
  assert.deepEqual(result.messages.map((message) => message.id), ['serve', 'martijn']);
});

test('campaign replies coordinator behoudt response en durable snapshot contract na extractie', async () => {
  const reply = {
    id: 'imap-reply-1',
    accountEmail: 'serve@softora.nl',
    receivedAt: '2026-08-09T12:00:00.000Z',
    threadMessages: [],
  };
  const reads = [];
  const writes = [];
  const listCampaignReplies = createMailboxCampaignRepliesList({
    mailboxCampaignRepliesService: {
      listReplies: async (options) => {
        reads.push(options);
        return [reply];
      },
    },
    instantlyMailboxService: { isConfigured: () => false },
    filterVisibleMailboxMessages: (messages) => messages,
    setUiStateValues: async (...args) => { writes.push(args); },
    logger: { warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength) => String(value || '').slice(0, maxLength),
  });

  const result = await listCampaignReplies({
    limit: 7,
    owner: '',
    includeSnapshotMessages: true,
  });

  assert.deepEqual(reads, [{ limit: 7, owner: '' }]);
  assert.deepEqual(result.messages.map((message) => message.id), ['imap-reply-1']);
  assert.deepEqual(result.snapshotMessages.map((message) => message.id), ['imap-reply-1']);
  assert.deepEqual(result.sync, {
    indexed: true,
    stale: false,
    source: 'campaign-replies-index',
    refreshRecommended: false,
    warming: false,
    instantly: null,
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE);
  assert.deepEqual(
    parseMailboxCampaignSnapshot(writes[0][1][MAILBOX_CAMPAIGN_SNAPSHOT_KEY]).messages.map((message) => message.id),
    ['imap-reply-1']
  );
  assert.deepEqual(writes[0][2], {
    source: 'mailbox-campaign-replies',
    actor: 'Mailbox index',
  });
});
