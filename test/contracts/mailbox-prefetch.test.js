'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { create } = require('../../assets/premium-mailbox-prefetch');
const discovery = require('../../assets/premium-mailbox-discovery');

const repoRoot = path.join(__dirname, '../..');
const tick = () => new Promise((resolve) => setImmediate(resolve));

function loadIndex() {
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  globalThis.window = globalThis;
  const modulePath = require.resolve('../../assets/premium-mailbox-index');
  delete require.cache[modulePath];
  require(modulePath);
  const index = globalThis.SoftoraMailboxIndex;
  delete globalThis.SoftoraMailboxIndex;
  if (!hadWindow) delete globalThis.window;
  return index;
}

function jsonResponse(data) {
  return { ok: true, json: async () => data };
}

test('prefetch warms the next conversations in order and never touches the open one', async () => {
  const calls = [];
  const mails = [
    { id: 'open', bodyLoaded: true },
    { id: 'a', bodyLoaded: true, threadMessages: [{ id: 'sent:a', bodyLoadError: '' }] },
    { id: 'b', bodyLoaded: false },
  ];
  let active = 'open';
  const prefetch = create({
    delayMs: 0,
    getMails: () => mails,
    getActiveMail: () => active,
    getRequest: (mail) => ({ account: 'serve@softora.nl', folder: 'inbox', id: mail.id }),
    shouldHydrateThread: () => true,
    index: {
      async prefetchRootBodies({ mails: targets }) { calls.push(['bodies', targets.map((mail) => mail.id)]); },
      async loadThreadBodies({ mail, isCurrent }) {
        calls.push(['thread', mail.id, isCurrent()]);
        mail.threadMessages[0].bodyLoadError = 'Volledig bericht kon niet worden geladen.';
      },
    },
    discovery: { async prefetchContactTimeline(mail) { calls.push(['timeline', mail.id]); } },
    images: { prewarm(targets) { calls.push(['images', targets.map((mail) => mail.id)]); } },
  });
  await prefetch.warmNow();
  assert.deepEqual(calls, [
    ['bodies', ['a', 'b']],
    ['timeline', 'a'], ['timeline', 'b'],
    ['thread', 'a', true],
    ['images', ['a', 'b']],
  ], 'the open conversation is left to the detail load; a body-less one gets no thread fetch');
  assert.equal(mails[1].threadMessages[0].bodyLoadError, '', 'a failed warm-up leaves no error that blocks the retry on click');

  // Frequent renders of the open conversation neither restart nor abort a running warm-up.
  calls.length = 0;
  const releases = [];
  const scheduled = [];
  const steadyMails = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];
  const steady = create({
    delayMs: 0, schedule: (callback) => { scheduled.push(callback); return scheduled.length; }, cancel: () => {},
    getMails: () => steadyMails, getActiveMail: () => 'y',
    index: { async prefetchRootBodies() {} },
    discovery: { prefetchContactTimeline: (mail) => { calls.push(mail.id); return new Promise((resolve) => releases.push(resolve)); } },
  });
  steady.schedule();
  steady.schedule();
  assert.equal(scheduled.length, 1, 'one pending warm-up');
  scheduled[0]();
  await tick();
  steady.schedule();
  assert.equal(scheduled.length, 1, 'a render while warming only asks for another pass');
  while (releases.length) { releases.shift()(); await tick(); }
  await tick();
  assert.deepEqual(calls, ['z', 'x'], 'the conversation below the open one first, each only once');
});

test('prefetched root bodies end in the same state as a detail load, and only when complete', async () => {
  const index = loadIndex();
  const bootstrapMail = { id: 'serve@softora.nl|inbox:1', body: 'Ruwe tekst', bodyLoaded: true, aiPresentationUnknown: true };
  const liveEnrichment = { id: 'serve@softora.nl|inbox:2', bodyLoaded: false };
  const openMail = { id: 'serve@softora.nl|inbox:3', bodyLoaded: false };
  const loaded = { id: 'serve@softora.nl|inbox:4', body: 'Klaar', bodyLoaded: true, aiPresentation: null };
  const requests = [];
  const applied = await index.prefetchRootBodies({
    mails: [bootstrapMail, liveEnrichment, openMail, loaded],
    getActiveMail: () => openMail.id,
    getRequest: (mail) => ({ account: 'serve@softora.nl', folder: 'inbox', id: mail.id.split('|')[1] }),
    fetchImpl: async (url, init) => {
      requests.push(JSON.parse(init.body).messages.map((message) => message.id));
      return jsonResponse({ ok: true, messages: [
        { id: 'inbox:1', accountEmail: 'serve@softora.nl', body: 'Opgeschoonde tekst', hasBody: true, recipientRoutingEvidenceKnown: true, attachmentEvidenceKnown: true, aiPresentation: { status: 'ready' } },
        { id: 'inbox:2', accountEmail: 'serve@softora.nl', body: 'Campagne', hasBody: true, recipientRoutingEvidenceKnown: true, originalCampaignOutbound: true, bodyImageEvidenceKnown: false },
      ] });
    },
  });
  assert.deepEqual(requests, [['inbox:1', 'inbox:2']], 'the open and the already complete conversation are not requested');
  assert.equal(applied, 1);
  assert.equal(bootstrapMail.body, 'Opgeschoonde tekst');
  assert.deepEqual(bootstrapMail.aiPresentation, { status: 'ready' });
  assert.equal(bootstrapMail.recipientRoutingNeedsHydration, false);
  assert.equal(liveEnrichment.bodyLoaded, false, 'a result that still needs live provider enrichment is left for the detail load');

  const source = fs.readFileSync(path.join(repoRoot, 'assets/premium-mailbox-index.js'), 'utf8');
  assert.match(source, /applyIndexedRootBody\(mail, indexedMessage\);\n\s+exactBodyAvailable = Boolean\(mail\.bodyLoaded && normalizeText\(mail\.body\)\);\n\s+const needsLiveCampaignEnrichment = rootBodyNeedsLiveEnrichment\(mail\);/, 'the detail load uses the same apply');
});

test('the contact timeline is prefetched without touching the open conversation', async () => {
  const requests = [];
  let active = '';
  const controller = discovery.create({
    document: { getElementById: () => null, querySelector: () => null },
    fetch: async (url) => {
      requests.push(String(url));
      return jsonResponse({ ok: true, totalCount: 2, nextCursor: null, messages: [
        { id: 'inbox:1', accountEmail: 'serve@softora.nl', messageId: '<reply@example.test>', from: 'Klant', email: 'klant@example.test', to: 'serve@softora.nl', folder: 'inbox', date: '2026-09-24T10:00:00.000Z' },
        { id: 'sent:1', accountEmail: 'serve@softora.nl', messageId: '<sent@example.test>', from: 'Servé', email: 'serve@softora.nl', to: 'klant@example.test', folder: 'sent', date: '2026-09-23T10:00:00.000Z' },
      ] });
    },
    getAccountEmails: () => ['serve@softora.nl'],
    getActiveMail: () => active,
    getMessageOwner: () => 'serve',
  });
  const mail = { id: 'inbox:1', accountEmail: 'serve@softora.nl', messageId: '<reply@example.test>', from: 'Klant', email: 'klant@example.test', to: 'serve@softora.nl', folder: 'inbox', date: '2026-09-24T10:00:00.000Z' };

  active = mail.id;
  assert.equal(await controller.prefetchContactTimeline(mail), false, 'the open conversation belongs to the regular load');
  assert.equal(requests.length, 0);

  active = '';
  assert.equal(await controller.prefetchContactTimeline(mail), true);
  assert.equal(mail.contactTimelineLoaded, true);
  assert.equal(Number(mail.contactTimelineTotal) > 0, true);
  active = mail.id;
  assert.equal(await controller.loadContactTimeline(mail), true, 'a click finds the dossier complete without a request');
  assert.equal(requests.filter((url) => url.includes('contact-timeline')).length, 1);
});

test('the Mailbox wires the prefetch after its detail controller and warms after each complete render', () => {
  const page = fs.readFileSync(path.join(repoRoot, 'premium-mailbox.html'), 'utf8');
  const prefetchScript = page.indexOf('assets/premium-mailbox-prefetch.js?v=20260927b');
  assert.ok(prefetchScript > 0 && prefetchScript < page.indexOf('assets/premium-mailbox.js?v=20261006d'));
  const source = fs.readFileSync(path.join(repoRoot, 'assets/premium-mailbox.js'), 'utf8');
  assert.match(source, /afterCommit: \(mail, \{ changed \}\) => \{ mailboxPrefetch\?\.schedule\?\.\(\);/);
  // The outreach list holds grouped copies; the detail opens the stored message, so that one is warmed.
  assert.ok(source.includes(`getMails: () => Array.from(document.querySelectorAll('#mail-items [data-mailbox-action="open-mail"]')).map((row) => findMailById(row.getAttribute('data-mailbox-id'))).filter(Boolean)`));
});

test('a dossier that a list refresh marked stale is warmed again, at most once a minute', async () => {
  const calls = [];
  let clock = 0;
  let refreshWorks = true;
  const mails = [{ id: 'open' }, { id: 'a', bodyLoaded: true }];
  const prefetch = create({
    delayMs: 0, now: () => clock, getMails: () => mails, getActiveMail: () => 'open',
    index: { async prefetchRootBodies() {} },
    discovery: { async prefetchContactTimeline(mail) { calls.push(mail.id); if (refreshWorks) mail.contactTimelineNeedsRefresh = false; } },
  });
  await prefetch.warmNow();
  assert.deepEqual(calls, ['a']);
  mails[1].contactTimelineNeedsRefresh = true; // a list refresh
  await prefetch.warmNow();
  assert.deepEqual(calls, ['a', 'a'], 'the stale dossier is refreshed before the next click');
  await prefetch.warmNow();
  assert.deepEqual(calls, ['a', 'a'], 'a fresh dossier is not fetched again');
  mails[1].contactTimelineNeedsRefresh = true;
  refreshWorks = false;
  clock = 61000;
  await prefetch.warmNow();
  await prefetch.warmNow();
  assert.deepEqual(calls, ['a', 'a', 'a'], 'a dossier that stays stale is not retried within a minute');
  clock = 122000;
  await prefetch.warmNow();
  assert.deepEqual(calls, ['a', 'a', 'a', 'a']);
});

test('a click shows a complete but stale dossier at once and refreshes it in the background', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'assets/premium-mailbox.js'), 'utf8');
  assert.match(source, /const stale = mail\.contactTimelineLoaded === true && mail\.contactTimelineNeedsRefresh === true && Number\(mail\.contactTimelineTotal\) > 0; const ready = [^;]+; const load = \(\) => mailboxDiscoveryController\?\.loadContactTimeline\?\.\(mail, \{ deferRender: !\(stale \|\| ready\), signal \}\); if \(stale\) \{ void load\(\); return true; \}/);
});

test('preparation drains past the first six conversations with at most three concurrent timelines', async () => {
  const mails = Array.from({ length: 22 }, (_, index) => ({ id: String(index), bodyLoaded: true }));
  const calls = [], batches = [];
  let inFlight = 0, peak = 0;
  const prefetch = create({
    getMails: () => mails, getActiveMail: () => '0',
    index: { async prefetchRootBodies({ mails: targets }) { batches.push(targets.map((mail) => mail.id)); } },
    discovery: { async prefetchContactTimeline(mail) {
      inFlight++; peak = Math.max(peak, inFlight); calls.push(mail.id);
      await tick(); inFlight--;
    } },
  });
  await prefetch.warmNow();
  assert.equal(calls.length, 21);
  assert.equal(new Set(calls).size, 21, 'each non-active conversation is attempted once');
  assert.equal(peak, 3);
  assert.deepEqual(batches.map((batch) => batch.length), [6, 6, 6, 3]);
  await prefetch.warmNow();
  assert.equal(calls.length, 21, 'completed preparation does not keep making requests');
});

test('scroll and pointer intent reprioritize the remaining queue before the next batch', async () => {
  const mails = Array.from({ length: 14 }, (_, index) => ({ id: String(index) }));
  const listeners = {}, batches = [], releases = [];
  let visible = '10';
  const list = {
    addEventListener(name, fn) { listeners[name] = fn; },
    getBoundingClientRect: () => ({ top: 0, bottom: 400, height: 400 }),
    querySelectorAll: () => [{ getBoundingClientRect: () => ({ top: 10, bottom: 60 }), getAttribute: () => visible }],
  };
  const prefetch = create({
    max: 2, getMails: () => mails, getActiveMail: () => '0', getListElement: () => list,
    index: { async prefetchRootBodies({ mails: targets }) { batches.push(targets.map((mail) => mail.id)); } },
    discovery: { prefetchContactTimeline: () => new Promise((resolve) => releases.push(resolve)) },
  });
  const pending = prefetch.warmNow();
  await tick();
  assert.deepEqual(batches[0], ['10', '1']);
  visible = '11';
  listeners.scroll();
  listeners.pointerover({ target: { closest: () => ({ getAttribute: () => '13' }) } });
  releases.splice(0).forEach((resolve) => resolve());
  await tick();
  assert.deepEqual(batches[1], ['13', '11']);
  while (releases.length) { releases.splice(0).forEach((resolve) => resolve()); await tick(); }
  await pending;
});

test('stopping a scope cancels the batch and never starts the remaining old conversations', async () => {
  const mails = Array.from({ length: 10 }, (_, index) => ({ id: String(index) }));
  const calls = [], releases = [];
  let requestSignal;
  const prefetch = create({
    getMails: () => mails, getActiveMail: () => '0',
    index: { async prefetchRootBodies({ signal }) { requestSignal = signal; } },
    discovery: { prefetchContactTimeline(mail) { calls.push(mail.id); return new Promise((resolve) => releases.push(resolve)); } },
  });
  const pending = prefetch.warmNow();
  await tick();
  prefetch.stop();
  assert.equal(requestSignal.aborted, true);
  releases.forEach((resolve) => resolve());
  await pending;
  assert.deepEqual(calls, ['1', '2', '3']);
});

test('preparation waits for account scope and failures do not block the rest of the list', async () => {
  let ready;
  const accounts = new Promise((resolve) => { ready = resolve; });
  const calls = [];
  const mails = Array.from({ length: 9 }, (_, index) => ({ id: String(index) }));
  const prefetch = create({
    getMails: () => mails, getActiveMail: () => '0', whenReady: () => accounts,
    discovery: { async prefetchContactTimeline(mail) { calls.push(mail.id); throw new Error('temporary read failure'); } },
  });
  const pending = prefetch.warmNow();
  await tick();
  assert.deepEqual(calls, []);
  ready(); await pending;
  assert.equal(calls.length, 8);
  await prefetch.warmNow();
  assert.equal(calls.length, 8, 'failed reads cannot cause an unbounded retry loop');
});

test('opening an existing row updates only selection without rebuilding hydrated list contents', () => {
  const { selectItem } = require('../../assets/premium-mailbox-list');
  const selected = new Map([['a', true], ['b', false]]);
  const rows = [...selected.keys()].map((id) => ({
    getAttribute: () => id,
    closest: () => ({ classList: { toggle: (name, value) => { assert.equal(name, 'active'); selected.set(id, value); } } }),
  }));
  const documentRef = { getElementById: () => ({ querySelectorAll: () => rows }) };
  assert.equal(selectItem(documentRef, 'b'), true);
  assert.deepEqual([...selected], [['a', false], ['b', true]]);
  assert.equal(selectItem(documentRef, 'missing'), false);
  assert.equal(selected.get('b'), true, 'unknown rows leave selection intact for the full render fallback');
});

test('een gesprek met alle teksten uit de pagina is direct leesbaar, zonder te wachten op het contactdossier', () => {
  const index = loadIndex();
  const complete = {
    bodyLoaded: true, body: 'Hoi', hasBody: true, aiPresentation: { status: 'ready' },
    threadMessages: [{ hasBody: true, body: 'Eerdere mail' }, { hasBody: false, body: '' }],
  };
  assert.equal(index.isConversationReadable(complete), true);
  assert.equal(index.isConversationReadable({ ...complete, bodyLoaded: false }), false);
  assert.equal(index.isConversationReadable({ ...complete, aiPresentation: undefined, aiPresentationUnknown: true }), false);
  assert.equal(index.isConversationReadable({ ...complete, threadMessages: [{ hasBody: true, body: '' }] }), false);
  assert.equal(index.isConversationReadable({ ...complete, threadMessages: [{ hasBody: true, body: 'x', bodyTruncated: true }] }), false);
  // A failed earlier message shows its own retry, so it does not hold the conversation back.
  assert.equal(index.isConversationReadable({ ...complete, threadMessages: [{ hasBody: true, body: '', bodyLoadError: 'Mislukt' }] }), true);
});

test('de mailbox laadt het contactdossier van een leesbaar gesprek op de achtergrond', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'assets/premium-mailbox.js'), 'utf8');
  const hydrateTimeline = source.match(/hydrateTimeline: \(\{ mail, signal \}\) => \{[^\n]+/)?.[0] || '';
  assert.match(hydrateTimeline, /const ready = !mail\.contactTimelineLoaded && window\.SoftoraMailboxIndex\?\.isConversationReadable\?\.\(mail\) === true;/);
  assert.match(hydrateTimeline, /deferRender: !\(stale \|\| ready\)/);
  assert.match(hydrateTimeline, /if \(ready\) \{ void loaded; return true; \}/);
  const page = fs.readFileSync(path.join(repoRoot, 'premium-mailbox.html'), 'utf8');
  assert.match(page, /<div class="detail-empty" data-mailbox-boot-placeholder>/);
  assert.match(page, /\.detail-empty\[data-mailbox-boot-placeholder\] \{ visibility: hidden; \}/);
});
