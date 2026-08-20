const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const discoveryModule = require('../../assets/premium-mailbox-discovery.js');
const deleteModule = require('../../assets/premium-mailbox-delete.js');

const CONTACT = 'serve@growsocialmedia.nl';
const ACCOUNT = 'serve@softora.nl';

function response(data, ok = true) {
  return { ok, json: async () => data };
}

function message(id, folder = 'inbox') {
  const outbound = folder === 'sent';
  return {
    id: `${folder}:${id}`,
    uid: id,
    folder,
    accountEmail: ACCOUNT,
    email: outbound ? ACCOUNT : CONTACT,
    to: outbound ? CONTACT : ACCOUNT,
    messageId: `<message-${id}@example.test>`,
    canonicalOwner: 'serve',
    externalContactEmail: CONTACT,
    technicalThreadKey: `thread-${id}`,
  };
}

function createDiscovery(root, fetchImpl) {
  let activeId = root.id;
  const controller = discoveryModule.create({
    document: { getElementById: () => null, querySelector: () => null },
    fetch: fetchImpl,
    getOwner: () => 'serve',
    getMessageOwner: (mail) => mail.canonicalOwner || mail.owner || '',
    getAccountEmails: () => [ACCOUNT],
    getActiveMail: () => activeId,
    normalizeMessage: (mail) => ({ ...mail }),
    openMail() {},
  });
  return { controller, setActiveId(value) { activeId = value; } };
}

function createDelete(discovery, fetchImpl, toasts = []) {
  return deleteModule.create({
    dialogs: { confirm: async () => true },
    fetch: fetchImpl,
    getOwner: () => 'serve',
    getAccount: (mail) => mail.accountEmail,
    getFolder: (mail) => mail.folder,
    getRequestId: (mail) => mail.id,
    getConversationScope: () => 'outreach',
    getContactEmail: (mail) => mail.externalContactEmail,
    prepareConversation: (mail) => discovery.prepareCompleteContactTimelineForHide(mail),
    toast: (value) => toasts.push(value),
  });
}

test('contact verbergen laadt alle tijdlijnpagina\'s vóór één volledige hide-POST', async () => {
  const root = message(1);
  const events = [];
  let hidePayload = null;
  const fetchImpl = async (requestUrl, options = {}) => {
    if (String(requestUrl).startsWith('/api/mailbox/contact-timeline?')) {
      const cursor = new URL(requestUrl, 'https://www.softora.nl').searchParams.get('cursor');
      events.push(cursor ? 'timeline-2' : 'timeline-1');
      return cursor
        ? response({ ok: true, messages: [message(3)], totalCount: 3, nextCursor: null })
        : response({ ok: true, messages: [message(1), message(2, 'sent')], totalCount: 3, nextCursor: 'cursor-2' });
    }
    assert.equal(requestUrl, '/api/mailbox/messages/hide');
    events.push('hide');
    hidePayload = JSON.parse(options.body);
    return response({ ok: true, result: { resolvedMessages: [] } });
  };
  const { controller: discovery } = createDiscovery(root, fetchImpl);
  const deletion = createDelete(discovery, fetchImpl);

  const result = await deletion.remove(root, {
    optimistic() { events.push('optimistic'); },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(events, ['timeline-1', 'timeline-2', 'optimistic', 'hide']);
  assert.equal(hidePayload.visibilityScope, 'outreach-contact');
  assert.equal(hidePayload.visibilityProtocol, 'atomic-contact-v1');
  assert.equal(hidePayload.contactEmail, CONTACT);
  assert.equal(hidePayload.expectedMessageCount, 3);
  assert.deepEqual(hidePayload.messages.map((target) => target.id), ['inbox:1', 'sent:2', 'inbox:3']);
  assert.equal(root.contactTimelineLoaded, true);
  assert.equal(root.contactTimelineNextCursor, '');
  assert.equal(root.threadMessages.length, 2);
});

test('contact verbergen stopt vóór optimistic state en POST als een vervolgpagina faalt', async () => {
  const root = message(11);
  const events = [];
  const toasts = [];
  const fetchImpl = async (requestUrl) => {
    if (String(requestUrl).startsWith('/api/mailbox/contact-timeline?')) {
      const cursor = new URL(requestUrl, 'https://www.softora.nl').searchParams.get('cursor');
      events.push(cursor ? 'timeline-2' : 'timeline-1');
      return cursor
        ? response({ ok: false, error: 'tijdelijk niet beschikbaar' }, false)
        : response({ ok: true, messages: [message(11)], totalCount: 2, nextCursor: 'cursor-2' });
    }
    events.push('hide');
    return response({ ok: true });
  };
  const { controller: discovery } = createDiscovery(root, fetchImpl);
  const deletion = createDelete(discovery, fetchImpl, toasts);

  const result = await deletion.remove(root, {
    optimistic() { events.push('optimistic'); },
  });

  assert.equal(result.ok, false);
  assert.equal(result.incomplete, true);
  assert.deepEqual(events, ['timeline-1', 'timeline-2']);
  assert.match(toasts[0], /niets verborgen/i);
  assert.equal(root.contactTimelineLoading, false);
  assert.equal(root.threadMessages, undefined);
});

test('contact verbergen weigert herhaalde cursors en dossiers boven de servergrens', async (t) => {
  await t.test('herhaalde cursor', async () => {
    const root = message(21);
    let page = 0;
    let hideRequests = 0;
    const fetchImpl = async (requestUrl) => {
      if (!String(requestUrl).startsWith('/api/mailbox/contact-timeline?')) {
        hideRequests += 1;
        return response({ ok: true });
      }
      page += 1;
      return page === 1
        ? response({ ok: true, messages: [message(21)], totalCount: 3, nextCursor: 'same-cursor' })
        : response({ ok: true, messages: [message(22, 'sent')], totalCount: 3, nextCursor: 'same-cursor' });
    };
    const { controller: discovery } = createDiscovery(root, fetchImpl);
    const result = await createDelete(discovery, fetchImpl).remove(root);
    assert.equal(result.incomplete, true);
    assert.equal(hideRequests, 0);
    assert.equal(root.threadMessages, undefined);
  });

  await t.test('meer dan honderd berichten', async () => {
    const root = message(31);
    let requests = 0;
    const fetchImpl = async () => {
      requests += 1;
      return response({ ok: true, messages: [message(31)], totalCount: 101, nextCursor: 'cursor-2' });
    };
    const { controller: discovery } = createDiscovery(root, fetchImpl);
    const result = await createDelete(discovery, fetchImpl).remove(root);
    assert.equal(result.incomplete, true);
    assert.equal(requests, 1);
    assert.match(root.contactTimelineError, /meer dan 100/);
  });
});

test('scopewissel breekt tijdlijnvoorbereiding af en ruimt de loadingstatus op', async () => {
  const root = message(41);
  let setActiveId;
  const fetchImpl = async () => response({
    ok: true,
    messages: [message(41)],
    totalCount: 1,
    nextCursor: null,
  });
  const state = createDiscovery(root, async (...args) => {
    const result = await fetchImpl(...args);
    setActiveId('inbox:other');
    return result;
  });
  setActiveId = state.setActiveId;

  assert.equal(await state.controller.prepareCompleteContactTimelineForHide(root), false);
  assert.equal(root.contactTimelineLoading, false);
  assert.equal(root.threadMessages, undefined);
});

test('losse hide buiten de outreachflow blijft één bericht zonder tijdlijnrequest', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../assets/premium-mailbox.js'), 'utf8');
  assert.match(source, /prepareConversation: \(mail\) => activeFolder !== 'outreach' \|\| mailboxDiscoveryController\?\.prepareCompleteContactTimelineForHide\?\.\(mail\)/);
  const root = message(51);
  let prepareCalls = 0;
  let payload = null;
  const deletion = deleteModule.create({
    dialogs: { confirm: async () => true },
    prepareConversation: async () => { prepareCalls += 1; return true; },
    fetch: async (_url, options) => {
      payload = JSON.parse(options.body);
      return response({ ok: true, result: { resolvedMessages: [] } });
    },
    getAccount: (mail) => mail.accountEmail,
    getFolder: (mail) => mail.folder,
    getRequestId: (mail) => mail.id,
  });

  assert.equal((await deletion.remove(root)).ok, true);
  assert.equal(prepareCalls, 1);
  assert.deepEqual(payload.messages, [{ account: ACCOUNT, folder: 'inbox', uid: 51, id: 'inbox:51' }]);
  assert.equal(payload.visibilityScope, undefined);
  assert.equal(payload.visibilityProtocol, 'atomic-contact-v1');
  assert.equal(payload.contactEmail, undefined);
});

test('dubbele klik kan nooit twee parallelle hide-requests starten', async () => {
  const root = message(61);
  let releasePreparation;
  let hideRequests = 0;
  const deletion = deleteModule.create({
    dialogs: { confirm: async () => true },
    prepareConversation: () => new Promise((resolve) => { releasePreparation = resolve; }),
    fetch: async () => { hideRequests += 1; return response({ ok: true }); },
    getAccount: (mail) => mail.accountEmail,
    getFolder: (mail) => mail.folder,
    getRequestId: (mail) => mail.id,
  });

  const first = deletion.remove(root);
  const second = await deletion.remove(root);
  assert.equal(second.pending, true);
  await new Promise((resolve) => setImmediate(resolve));
  releasePreparation(true);
  assert.equal((await first).ok, true);
  assert.equal(hideRequests, 1);
});
