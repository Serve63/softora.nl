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
    ['timeline', 'a'], ['thread', 'a', true],
    ['timeline', 'b'],
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
  const prefetchScript = page.indexOf('assets/premium-mailbox-prefetch.js?v=20260924b');
  assert.ok(prefetchScript > 0 && prefetchScript < page.indexOf('assets/premium-mailbox.js?v=20260924e'));
  const source = fs.readFileSync(path.join(repoRoot, 'assets/premium-mailbox.js'), 'utf8');
  assert.match(source, /afterCommit: \(mail, \{ changed \}\) => \{ mailboxPrefetch\?\.schedule\?\.\(\);/);
  assert.match(source, /^mailboxPrefetch = window\.SoftoraMailboxPrefetch\?\.create\(\{ getMails: \(\) => getMailsForFolder\(activeFolder\), getActiveMail: \(\) => activeMail,/m);
});
