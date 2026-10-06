const test = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../../assets/premium-browser-storage');
const outboxModule = require('../../assets/premium-mailbox-state-outbox');
const readModule = require('../../assets/premium-mailbox-read');
const uiState = require('../../assets/premium-mailbox-ui-state');
const campaign = require('../../assets/premium-mailbox-campaign-inbox');

function message(id = 1, minute = '00') {
  return { id: `inbox:${id}`, uid: id, folder: 'inbox', owner: 'fixture',
    accountEmail: 'owner@example.test', email: 'customer@example.test',
    messageKey: `owner@example.test|inbox|generation:test|${id}`,
    messageId: `<received-${id}@example.test>`, date: `2026-10-06T12:${minute}:00Z`,
    body: 'Kun je mijn voorstel bekijken?', unread: true, replyDismissedAt: '' };
}

async function harness(root = message(), store = storage.createMemoryLatestRecordStore()) {
  const writes = [];
  let failing = true, sequence = 0, controller;
  const outbox = outboxModule.create({
    global: {}, store, now: () => Date.parse('2026-10-06T14:00:00Z'),
    crypto: { randomUUID: () => `fixture-mutation-${++sequence}` },
    setTimeout: () => 1, clearTimeout() {},
    async fetch(url, init) {
      const payload = JSON.parse(init.body);
      assert.equal(url, '/api/mailbox/messages/read');
      writes.push(payload);
      return failing
        ? { ok: false, status: 400, json: async () => ({ ok: false, code: 'FIXTURE_READ_FAILURE' }) }
        : { ok: true, status: 200, json: async () => ({ ok: true, result: {
          unread: false, replyDismissedAt: payload.dismissReply ? '2026-10-06T14:00:01Z' : '',
        } }) };
    },
  });
  controller = readModule.create({
    outbox, getOwner: mail => mail.owner, getAccount: mail => mail.accountEmail,
    getFolder: mail => mail.folder, getRequestId: mail => mail.id,
    getConversationAction: campaign.getConversationAction,
    onExternalState() { controller?.reconcile(root); },
  });
  await outbox.hydrate();
  return { root, controller, outbox, writes, store,
    succeed() { failing = false; },
    fail() { failing = true; },
    retry() { return uiState.handleReadAction('retry-read', {
      mail: root, campaignInbox: campaign, readController: controller,
      dismissReply: (mail, hooks) => controller.dismissReply(mail, hooks),
      getActiveMail: () => root.id,
    }); },
  };
}

async function failAction(h, dismiss = false, target = h.root) {
  const outcome = dismiss
    ? await h.controller.dismissReplyTarget(h.root, target)
    : await h.controller.markRead(h.root);
  assert.equal(outcome.pending, true);
  await h.outbox.flush();
  assert.ok(target.readError);
  assert.equal(target.replyDismissedAt, '');
  return (await h.store.list())[0];
}

test('retry of an automatically saved read preserves the original read-only mutation and reply reminder', async t => {
  const h = await harness(); t.after(() => h.outbox.destroy());
  const original = await failAction(h);
  assert.equal(campaign.needsConversationReply(h.root), true);
  h.succeed();
  const retry = await h.retry();
  assert.equal(retry.pending, true);
  await h.outbox.flush();
  assert.equal(h.writes.length, 2);
  assert.deepEqual(h.writes[1], original.payload, 'identity, revision, mutation ID and read-only intent are reused');
  assert.equal(h.writes[1].dismissReply, false);
  assert.equal(h.root.unread, false);
  assert.equal(h.root.replyDismissedAt, '');
  assert.equal(campaign.needsConversationReply(h.root), true);
});

test('retry of an explicit dismissal preserves dismissal without issuing a new mutation', async t => {
  const h = await harness(); t.after(() => h.outbox.destroy());
  const original = await failAction(h, true);
  h.succeed(); await h.retry(); await h.outbox.flush();
  assert.deepEqual(h.writes[1], original.payload);
  assert.equal(h.writes[1].dismissReply, true);
  assert.equal(h.root.replyDismissedAt, '2026-10-06T14:00:01Z');
  assert.equal(campaign.needsConversationReply(h.root), false);
});

test('hydrated failed dismissal retries its original thread target and leaves newer incoming mail open', async t => {
  const target = message(2, '10');
  const first = await harness({ ...message(), threadMessages: [target] });
  const original = await failAction(first, true, target);
  first.outbox.destroy();
  const freshTarget = message(2, '10'), newer = message(3, '20');
  const h = await harness({ ...message(), threadMessages: [freshTarget, newer] }, first.store);
  t.after(() => h.outbox.destroy());
  h.succeed(); await h.retry(); await h.outbox.flush();
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.writes[0], original.payload);
  assert.equal(freshTarget.replyDismissedAt, '2026-10-06T14:00:01Z');
  assert.equal(newer.replyDismissedAt, '');
  assert.equal(newer.unread, true);
  assert.equal(campaign.needsConversationReply(h.root), true);
});

test('retry never replaces a superseding record with the stale failed action', async t => {
  const h = await harness(); t.after(() => h.outbox.destroy());
  const original = await failAction(h, true);
  const newer = { ...original, mutationId: 'newer-read-mutation', revision: original.revision + 1,
    dismissReply: false, payload: { ...original.payload, mutationId: 'newer-read-mutation',
      revision: original.revision + 1, dismissReply: false } };
  await h.store.putLatest(newer);
  const retry = await h.retry();
  assert.equal(retry.ok, false);
  assert.equal(retry.superseded, true);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(await h.store.get(original.resourceKey), newer);
});

test('an error without a retained mutation can only retry marking the message read', async t => {
  const h = await harness({ ...message(), readError: 'Onbekende opslagfout' });
  t.after(() => h.outbox.destroy());
  h.succeed(); await h.retry(); await h.outbox.flush();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].dismissReply, false);
  assert.equal(h.root.replyDismissedAt, '');
  assert.equal(campaign.needsConversationReply(h.root), true);
});


test('a confirmed root-read retry does not capture a later retry for another thread target', async t => {
  const h = await harness(); t.after(() => h.outbox.destroy());
  await failAction(h);
  h.succeed(); await h.retry(); await h.outbox.flush();
  assert.equal(h.root.replyDismissedAt, '');
  const target = message(2, '10');
  h.root.threadMessages = [target];
  h.fail();
  const original = await failAction(h, true, target);
  assert.equal(campaign.needsConversationReply(h.root), true);
  h.succeed(); await h.retry(); await h.outbox.flush();
  assert.equal(h.writes.length, 4);
  assert.deepEqual(h.writes[3], original.payload);
  assert.equal(h.writes[3].id, target.id);
  assert.equal(h.writes[3].dismissReply, true);
  assert.equal(target.replyDismissedAt, '2026-10-06T14:00:01Z');
  assert.equal(h.root.replyDismissedAt, '');
  assert.equal(campaign.needsConversationReply(h.root), false);
});
