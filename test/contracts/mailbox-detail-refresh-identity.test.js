'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createController } = require('../../assets/premium-mailbox-detail-stability');

function setup() {
  const classes = new Set();
  const attributes = new Map();
  let writes = 0;
  let html = '';
  let activeId = '';
  let scope = { folder: 'outreach', owner: 'serve', account: '' };
  const mail = {
    id: 'serve@softora.nl|coldmail:13', accountEmail: 'serve@softora.nl',
    messageId: '<reply-unique@example.test>', conversationId: 'timeline:thread-original',
    body: 'Het reeds geopende gesprek.',
  };
  const detail = {
    dataset: {},
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) },
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    get innerHTML() { return html; },
    set innerHTML(value) { html = value; writes += 1; },
  };
  const controller = createController({
    getMail: (id) => id === mail.id ? mail : null,
    ensureToken: () => ({ generation: 1 }), isTokenCurrent: () => true,
    getScope: () => scope, getVisibilityKey: (message) => message.conversationId,
    getActiveMail: () => activeId, setActiveMail: (id) => { activeId = id; },
    getDetailElement: () => detail, renderHtml: (message) => `<p>${message.body}</p>`,
    hydrateTimeline: async () => { await mail.wait; if (mail.restoredConversationId) mail.conversationId = mail.restoredConversationId; },
  });
  return { controller, mail, detail, classes, attributes, writes: () => writes, setScope: (value) => { scope = value; } };
}

test('metadata refresh keeps the exact displayed message visible while timeline grouping is restored', async () => {
  const view = setup();
  await view.controller.open(view.mail.id);
  const before = view.detail.innerHTML;
  let release;
  view.mail.wait = new Promise((resolve) => { release = resolve; });
  view.mail.conversationId = 'campaign:thread-index';
  view.mail.restoredConversationId = 'timeline:thread-original';
  const refreshing = view.controller.open(view.mail.id, { preserveVisibleDetail: true });
  await Promise.resolve();
  assert.equal(view.classes.has('is-detail-pending'), false);
  assert.equal(view.attributes.has('inert'), false);
  assert.equal(view.detail.innerHTML, before);
  release();
  await refreshing;
  assert.equal(view.writes(), 1);

  view.mail.body = 'Hetzelfde gesprek met een nieuwe reactie.';
  await view.controller.open(view.mail.id, { preserveVisibleDetail: true });
  assert.match(view.detail.innerHTML, /nieuwe reactie/);
  assert.equal(view.writes(), 2);
});

test('message identity never preserves a different message, account, owner, or unproven reused UI id', async () => {
  for (const change of [
    (view) => { view.mail.messageId = '<different@example.test>'; },
    (view) => { view.mail.accountEmail = 'another@example.test'; },
    (view) => { view.setScope({ folder: 'outreach', owner: 'martijn', account: '' }); },
    (view) => { delete view.mail.messageId; },
  ]) {
    const view = setup();
    await view.controller.open(view.mail.id);
    let release;
    view.mail.wait = new Promise((resolve) => { release = resolve; });
    view.mail.conversationId = 'different-grouping';
    change(view);
    const pending = view.controller.open(view.mail.id, { preserveVisibleDetail: true });
    await Promise.resolve();
    assert.equal(view.classes.has('is-detail-pending'), true);
    assert.equal(view.attributes.has('inert'), true);
    release();
    await pending;
  }
});
