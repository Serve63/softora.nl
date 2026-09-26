const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAILBOX_CAMPAIGN_VERSION_CACHE_MAX_AGE_MS,
  createMailboxCampaignContentVersionReader,
  createMailboxCampaignVersionCache,
} = require('../../server/services/mailbox-campaign-version-cache');
const { createMailboxCampaignRepliesList } = require('../../server/services/mailbox-campaign-replies-list');

function createCache({ versions, now = () => 1_000 }) {
  let reads = 0;
  const cache = createMailboxCampaignVersionCache({
    readContentVersion: async () => {
      const next = versions[Math.min(reads, versions.length - 1)];
      reads += 1;
      if (next instanceof Error) throw next;
      return next;
    },
    now,
    logger: { warn() {} },
  });
  return cache;
}

test('campagnelijst wordt hergebruikt zolang de databaseversie gelijk blijft', async () => {
  let builds = 0;
  const cache = createCache({ versions: [7, 7, 8] });
  const build = async () => { builds += 1; return { replies: [{ id: `r${builds}` }] }; };

  assert.deepEqual(await cache('serve', build), { value: { replies: [{ id: 'r1' }] }, cache: 'miss' });
  assert.deepEqual(await cache('serve', build), { value: { replies: [{ id: 'r1' }] }, cache: 'hit' });
  assert.deepEqual(await cache('serve', build), { value: { replies: [{ id: 'r2' }] }, cache: 'miss' });
  assert.equal(builds, 2);
});

test('campagnecache bouwt opnieuw na de maximale leeftijd en per aparte sleutel', async () => {
  let now = 1_000;
  let builds = 0;
  const cache = createCache({ versions: [5], now: () => now });
  const build = async () => { builds += 1; return { n: builds }; };

  await cache('serve', build);
  await cache('martijn', build);
  now += MAILBOX_CAMPAIGN_VERSION_CACHE_MAX_AGE_MS - 1;
  assert.equal((await cache('serve', build)).cache, 'hit');
  now += 1;
  assert.equal((await cache('serve', build)).cache, 'miss');
  assert.equal(builds, 3);
});

test('zonder leesbare databaseversie wordt nooit een bewaarde lijst gebruikt', async () => {
  for (const unreadable of [new Error('timeout'), null, 0, Number.NaN, 1.5]) {
    let builds = 0;
    const cache = createCache({ versions: [unreadable] });
    const build = async () => { builds += 1; return { n: builds }; };
    assert.equal((await cache('serve', build)).cache, 'bypass');
    assert.deepEqual(await cache('serve', build), { value: { n: 2 }, cache: 'bypass' });
  }
});

test('een wijziging tijdens het opbouwen laat de volgende lezing opnieuw opbouwen', async () => {
  let builds = 0;
  // Version 3 is read before the first build; the change to 4 lands during it.
  const cache = createCache({ versions: [3, 4, 4] });
  const build = async () => { builds += 1; return { n: builds }; };
  await cache('serve', build);
  assert.equal((await cache('serve', build)).cache, 'miss');
  assert.equal((await cache('serve', build)).cache, 'hit');
  assert.equal(builds, 2);
});

test('aanroepers krijgen een eigen kopie zodat samenvoegen de bewaarde lijst niet wijzigt', async () => {
  const cache = createCache({ versions: [9] });
  const first = await cache('serve', async () => ({ replies: [{ id: 'a', threadMessages: [] }] }));
  first.value.replies[0].threadMessages.push({ id: 'mutated' });
  first.value.replies.push({ id: 'extra' });
  const second = await cache('serve', async () => assert.fail('mag niet opnieuw bouwen'));
  assert.deepEqual(second.value, { replies: [{ id: 'a', threadMessages: [] }] });
});

test('gelijktijdige verzoeken voor dezelfde versie delen één opbouw', async () => {
  let builds = 0;
  let release;
  const cache = createCache({ versions: [11] });
  const build = () => { builds += 1; return new Promise((resolve) => { release = () => resolve({ n: 1 }); }); };
  const first = cache('serve', build);
  const second = cache('serve', build);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  assert.deepEqual((await first).value, { n: 1 });
  assert.deepEqual((await second).value, { n: 1 });
  assert.equal(builds, 1);
});

test('versielezer leest alleen de campagneversie en valt terug zonder client', async () => {
  assert.equal(await createMailboxCampaignContentVersionReader({ getSupabaseClient: () => null })(), null);
  const calls = [];
  const client = {
    from(table) { calls.push(['from', table]); return this; },
    select(columns) { calls.push(['select', columns]); return this; },
    eq(column, value) { calls.push(['eq', column, value]); return this; },
    maybeSingle: async () => ({ data: { content_version: 90582 }, error: null }),
  };
  assert.equal(await createMailboxCampaignContentVersionReader({ getSupabaseClient: () => client })(), 90582);
  assert.deepEqual(calls, [
    ['from', 'softora_mailbox_campaign_consistency'],
    ['select', 'content_version'],
    ['eq', 'scope', 'campaign'],
  ]);
  const failing = { ...client, maybeSingle: async () => ({ data: null, error: new Error('rls') }) };
  await assert.rejects(createMailboxCampaignContentVersionReader({ getSupabaseClient: () => failing })(), /rls/);
});

test('campagne-endpoint gebruikt de versiecache maar voegt Instantly en zichtbaarheid altijd live toe', async () => {
  let indexBuilds = 0;
  let version = 21;
  const list = createMailboxCampaignRepliesList({
    mailboxCampaignRepliesService: {
      listRepliesWithSnapshot: async () => {
        indexBuilds += 1;
        return { messages: [{ id: `inbox:${indexBuilds}`, accountEmail: 'serve@softora.nl', date: '2026-09-26T10:00:00Z' }], snapshotMessages: [] };
      },
    },
    instantlyMailboxService: null,
    filterVisibleMailboxMessages: (messages) => messages,
    setUiStateValues: async () => {},
    getUiStateValues: async () => null,
    mailboxIndexStore: {},
    campaignVersionCache: createMailboxCampaignVersionCache({ readContentVersion: async () => version, logger: { warn() {} } }),
    logger: { info() {}, warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value) => String(value || ''),
  });
  const first = await list({ owner: 'serve', hydrateBodies: false });
  const second = await list({ owner: 'serve', hydrateBodies: false });
  assert.equal(indexBuilds, 1);
  assert.deepEqual(second.messages.map((message) => message.id), first.messages.map((message) => message.id));
  version += 1;
  await list({ owner: 'serve', hydrateBodies: false });
  assert.equal(indexBuilds, 2);
  await list({ owner: 'martijn', hydrateBodies: false });
  assert.equal(indexBuilds, 3);
});
