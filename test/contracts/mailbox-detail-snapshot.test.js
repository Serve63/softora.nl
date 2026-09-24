'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createController } = require('../../assets/premium-mailbox-detail-stability');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fakeSnapshot(savedView, detail) {
  const calls = [];
  let showing = false;
  return {
    calls,
    restore(view) {
      calls.push(['restore', view]);
      if (view !== savedView) return false;
      detail.innerHTML = 'SNAPSHOT';
      showing = true;
      return true;
    },
    isShowing: () => showing,
    release() { if (showing) calls.push(['release']); showing = false; },
    capture(view, isValid) { calls.push(['capture', view, isValid()]); },
  };
}

function view({ savedView = 'outreach|serve||inbox:1', ...hooks } = {}) {
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
  const snapshot = fakeSnapshot(savedView, detail);
  const controller = createController({
    getMail: (id) => id === mail.id ? mail : null,
    getScope: () => ({ owner: 'serve', folder: 'outreach' }), ensureToken: () => ({ generation: 1 }), isTokenCurrent: () => true,
    getActiveMail: () => active, setActiveMail: (id) => { active = id; },
    getDetailElement: () => detail,
    renderHtml: (message) => `${message.body}|${message.threadMessages.map((entry) => entry.body || 'laden').join('|')}`,
    snapshot,
    shouldCaptureSnapshot: () => true,
    ...hooks,
  });
  return { mail, controller, detail, classes, snapshot };
}

test('the newest conversation opens from its snapshot and only the complete live render replaces it', async () => {
  const timeline = deferred();
  const provider = deferred();
  let publishRoot;
  const v = view({
    needsRootHydration: () => true,
    async hydrateRoot({ mail, requestRender }) {
      publishRoot = async () => { mail.body = 'Complete incoming body'; mail.bodyLoaded = true; await requestRender(mail.id); };
    },
    async hydrateTimeline({ mail }) {
      await timeline.promise;
      mail.threadMessages = [{ body: 'Exact accepted sent body', bodyLoaded: true }];
    },
    shouldHydrateThread: () => true,
    hydrateThread: () => provider.promise,
  });
  const opened = v.controller.open(v.mail.id);
  await tick();
  assert.deepEqual(v.snapshot.calls[0], ['restore', 'outreach|serve||inbox:1']);
  assert.equal(v.detail.innerHTML, 'SNAPSHOT');
  assert.equal(v.classes.has('is-detail-pending'), false, 'no "E-mail laden..." over the snapshot');
  await publishRoot();
  timeline.resolve();
  await tick();
  assert.equal(v.detail.innerHTML, 'SNAPSHOT', 'no intermediate body-only version replaces the snapshot');
  provider.resolve();
  assert.equal((await opened).committed, true);
  assert.equal(v.detail.innerHTML, 'Complete incoming body|Exact accepted sent body');
  assert.deepEqual(v.snapshot.calls.slice(1), [['release'], ['capture', 'outreach|serve||inbox:1', true]]);
});

test('without a matching snapshot the detail keeps its normal pending state and progressive render', async () => {
  const v = view({ savedView: 'outreach|serve||inbox:other' });
  v.mail.body = 'Body'; v.mail.bodyLoaded = true;
  const opened = v.controller.open(v.mail.id);
  assert.equal(v.classes.has('is-detail-pending'), true);
  await opened;
  assert.equal(v.detail.innerHTML, 'Body|');
  assert.equal(v.snapshot.calls.some(([name]) => name === 'release'), false);
});

test('reopening the visible conversation never downgrades it to a version without its timeline', async () => {
  const timeline = deferred();
  let slowTimeline = false;
  const v = view({
    savedView: '',
    needsRootHydration: (mail, openOptions) => openOptions.forceRootHydration === true,
    async hydrateRoot({ mail, requestRender }) { mail.bodyLoaded = true; await requestRender(mail.id); },
    async hydrateTimeline({ mail }) {
      if (slowTimeline) await timeline.promise;
      mail.threadMessages = [{ body: 'Sent', bodyLoaded: true }];
    },
  });
  v.mail.body = 'Body'; v.mail.bodyLoaded = true;
  await v.controller.open(v.mail.id);
  assert.equal(v.detail.innerHTML, 'Body|Sent');
  // A list refresh rebuilt the message without its timeline enrichment.
  v.mail.threadMessages = [];
  slowTimeline = true;
  const reopened = v.controller.open(v.mail.id, { preserveVisibleDetail: true, forceRootHydration: true });
  await tick();
  assert.equal(v.detail.innerHTML, 'Body|Sent');
  timeline.resolve();
  await reopened;
  assert.equal(v.detail.innerHTML, 'Body|Sent');
});

test('the Mailbox wires the detail snapshot before its page script and only captures the newest conversation', () => {
  const repoRoot = path.join(__dirname, '../..');
  const page = fs.readFileSync(path.join(repoRoot, 'premium-mailbox.html'), 'utf8');
  const adapter = page.indexOf('assets/premium-mailbox-detail-snapshot.js?v=20260924a');
  assert.ok(page.indexOf('assets/premium-readmodel-store.js?v=20260924c') < adapter);
  assert.ok(page.indexOf('assets/premium-screen-snapshot.js?v=20260924b') < adapter);
  assert.ok(adapter < page.indexOf('assets/premium-mailbox.js?v=20260924b'));
  const source = fs.readFileSync(path.join(repoRoot, 'assets/premium-mailbox.js'), 'utf8');
  assert.match(source, /snapshot: window\.SoftoraMailboxDetailSnapshot, shouldCaptureSnapshot: \(mail\) => String\(getMailsForFolder\(activeFolder\)\[0\]\?\.id \?\? ''\) === String\(mail\.id\)/);
  const snapshotAdapter = fs.readFileSync(path.join(repoRoot, 'assets/premium-mailbox-detail-snapshot.js'), 'utf8');
  assert.match(snapshotAdapter, /inertIds: \['mail-detail'\]/);
  assert.match(snapshotAdapter, /maxChars: MAX_CHARS/);
});
