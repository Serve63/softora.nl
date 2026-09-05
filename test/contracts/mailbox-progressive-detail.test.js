'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createController } = require('../../assets/premium-mailbox-detail-stability');
require('../../assets/premium-mailbox-owner-session');
const discovery = require('../../assets/premium-mailbox-discovery');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

function view(hooks = {}) {
  const classes = new Set();
  const detail = {
    dataset: {}, innerHTML: '',
    classList: { add: (value) => classes.add(value), remove: (value) => classes.delete(value), contains: (value) => classes.has(value) },
    setAttribute() {}, removeAttribute() {},
  };
  const mail = {
    id: 'inbox:1', accountEmail: 'serve@softora.nl', messageId: '<reply@example.test>',
    body: '', bodyLoaded: false, threadMessages: [],
  };
  let active = '';
  let scope = { owner: 'serve', folder: 'outreach' };
  const controller = createController({
    getMail: (id) => id === mail.id ? mail : null,
    getScope: () => scope, ensureToken: () => ({ generation: 1 }), isTokenCurrent: () => true,
    getActiveMail: () => active, setActiveMail: (id) => { active = id; },
    getDetailElement: () => detail,
    renderHtml: (message) => `${message.body}|${message.threadMessages.map((entry) => entry.body || 'laden').join('|')}`,
    ...hooks,
  });
  return { mail, controller, detail, classes, switchOwner: () => { scope = { owner: 'martijn', folder: 'outreach' }; controller.invalidate(); detail.innerHTML = 'Andere mailbox'; } };
}

test('complete incoming body and accepted sent text appear before slow provider enrichment finishes', async () => {
  const timeline = deferred();
  const provider = deferred();
  let publishRoot;
  const v = view({
    needsRootHydration: () => true,
    async hydrateRoot({ mail, requestRender }) {
      publishRoot = async () => {
        mail.body = 'Complete incoming body'; mail.bodyLoaded = true;
        await requestRender(mail.id);
      };
      await provider.promise;
    },
    async hydrateTimeline({ mail }) {
      await timeline.promise;
      mail.threadMessages = [{ body: 'Exact accepted sent body', bodyLoaded: true }];
    },
    shouldHydrateThread: () => true,
    hydrateThread: () => provider.promise,
  });
  let settled = false;
  const opened = v.controller.open(v.mail.id).then((value) => { settled = true; return value; });
  await tick();
  await publishRoot();
  assert.match(v.detail.innerHTML, /Complete incoming body/);
  assert.equal(v.classes.has('is-detail-pending'), false);
  assert.equal(settled, false);
  timeline.resolve();
  await tick();
  assert.match(v.detail.innerHTML, /Exact accepted sent body/);
  assert.equal(settled, false);
  provider.resolve();
  assert.equal((await opened).committed, true);
});

test('late provider completion cannot publish across an owner change', async () => {
  const slow = deferred();
  const v = view({
    needsRootHydration: () => true,
    async hydrateRoot({ mail, requestRender }) {
      await slow.promise;
      mail.body = 'Previous owner body'; mail.bodyLoaded = true;
      await requestRender(mail.id);
    },
  });
  const opened = v.controller.open(v.mail.id);
  await tick();
  v.switchOwner();
  slow.resolve();
  assert.equal((await opened).stale, true);
  assert.equal(v.detail.innerHTML, 'Andere mailbox');
});

test('account-ready timeline can publish into an existing provider hydration without waiting or duplicating it', async () => {
  const provider = deferred();
  let calls = 0;
  const v = view({ shouldHydrateThread: () => true, hydrateThread: () => { calls += 1; return provider.promise; } });
  v.mail.body = 'Complete incoming body'; v.mail.bodyLoaded = true;
  const opening = v.controller.open(v.mail.id);
  await tick();
  assert.equal(calls, 1);
  // Account discovery completes after the cached conversation was opened.
  v.mail.threadMessages = [{ body: 'Exact accepted sent body', bodyLoaded: true }];
  const refresh = v.controller.open(v.mail.id, { skipBodyFetch: true, skipContactTimeline: true, preserveVisibleDetail: true });
  await tick();
  assert.match(v.detail.innerHTML, /Exact accepted sent body/);
  assert.equal(v.classes.has('is-detail-pending'), false);
  assert.equal(calls, 1);
  provider.resolve();
  await Promise.all([opening, refresh]);
});

test('timeline refresh preserves exact-account body, attachments and retry state while adopting newly available text', () => {
  const sent = {
    id: 'accepted-sent:old', uid: 0, folder: 'sent', accountEmail: 'serve@softora.nl',
    messageId: '<sent@example.test>', to: 'customer@example.test', canonicalOwner: 'serve',
    body: 'Full provider body', bodyLoaded: true, attachmentEvidenceKnown: true,
    attachments: [{ filename: 'design.pdf' }], providerMessageIdHydrationRetryAt: Date.now() + 300_000,
  };
  const root = {
    id: 'inbox:1', accountEmail: sent.accountEmail, messageId: '<reply@example.test>',
    email: 'customer@example.test', canonicalOwner: 'serve', threadMessages: [sent],
  };
  const scope = {
    accountEmails: ['serve@softora.nl', 'martijn@softora.nl'], canonicalOwner: 'serve',
    getMessageOwner: (message) => message.accountEmail.startsWith('serve') ? 'serve' : 'martijn',
  };
  const metadata = { ...sent, body: '', bodyLoaded: false, attachments: [], attachmentEvidenceKnown: false, providerMessageIdHydrationRetryAt: 0 };
  discovery.mergeContactTimeline(root, [metadata, { ...metadata, accountEmail: 'martijn@softora.nl', canonicalOwner: 'martijn', body: 'Other owner' }], 'customer@example.test', 2, scope);
  assert.equal(root.threadMessages.length, 1);
  assert.equal(root.threadMessages[0], sent);
  assert.equal(sent.body, 'Full provider body');
  assert.equal(sent.attachments[0].filename, 'design.pdf');
  assert.ok(sent.providerMessageIdHydrationRetryAt > Date.now());

  sent.uid = 42; sent.mailboxId = 'allmail:42'; sent.storageFolder = 'allmail';
  discovery.mergeContactTimeline(root, [{ ...metadata, body: 'Accepted authored text', bodyLoaded: true }], 'customer@example.test', 1, scope);
  assert.equal(sent.body, 'Full provider body');
  assert.equal(sent.uid, 42);
  assert.equal(sent.mailboxId, 'allmail:42');
  assert.equal(sent.storageFolder, 'allmail');

  sent.uid = 0;
  sent.body = ''; sent.bodyLoaded = false; sent.bodyLoading = true;
  discovery.mergeContactTimeline(root, [{ ...metadata, body: 'Durable accepted body', bodyLoaded: true, bodyLoading: false }], 'customer@example.test', 1, scope);
  assert.equal(sent.body, 'Durable accepted body');
  assert.equal(sent.bodyLoading, false);
});
