const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const campaignInbox = require('../../assets/premium-mailbox-campaign-inbox.js');
const compose = require('../../assets/premium-mailbox-compose.js');
const composeAcceptedSend = require('../../assets/premium-mailbox-compose-accepted-send.js');
const composeWindow = require('../../assets/premium-mailbox-compose-window.js');
const composeController = require('../../assets/premium-mailbox-compose-controller.js');
const mailboxDelete = require('../../assets/premium-mailbox-delete.js');
const mailboxRead = require('../../assets/premium-mailbox-read.js');
const mailboxToast = require('../../assets/premium-mailbox-toast.js');
const mailboxList = require('../../assets/premium-mailbox-list.js');

function assetSource(filename) {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'assets', filename), 'utf8');
}

test('mailbox gelezen-module handelt een antwoordherinnering optimistisch en duurzaam af', async () => {
  const renders = [];
  const requests = [];
  const toasts = [];
  const latestReply = { id: 'inbox:43', uid: 43, folder: 'inbox', accountEmail: 'serve@softora.nl', messageKey: 'serve@softora.nl|inbox|gen:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|43', messageId: '<message-43@example.test>', date: '2026-08-04T15:00:00.000Z', unread: true, replyDismissedAt: '' };
  const mail = { id: 'inbox:42', uid: 42, folder: 'inbox', accountEmail: 'serve@softora.nl', messageKey: 'serve@softora.nl|inbox|gen:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|42', messageId: '<message-42@example.test>', date: '2026-08-04T14:00:00.000Z', unread: false, replyDismissedAt: '', threadMessages: [latestReply] };
  const controller = mailboxRead.create({
    getAccount: () => 'serve@softora.nl',
    getFolder: () => 'inbox',
    getOwner: () => 'serve',
    getRequestId: (message) => message.id,
    getConversationAction: campaignInbox.getConversationAction,
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return {
        ok: true,
        json: async () => ({ ok: true, result: { replyDismissedAt: '2026-08-04T15:10:00.000Z' } }),
      };
    },
    toast: (message) => toasts.push(message),
  });

  const result = await controller.dismissReply(mail, {
    render: (message, target) => renders.push({
      messageId: message.id,
      unread: target.unread,
      replyDismissedAt: target.replyDismissedAt,
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(mail.replyDismissedAt, '');
  assert.equal(latestReply.unread, false);
  assert.equal(latestReply.replyDismissedAt, '2026-08-04T15:10:00.000Z');
  assert.deepEqual(requests, [{
    url: '/api/mailbox/messages/read',
    body: {
      account: 'serve@softora.nl', owner: 'serve', id: 'inbox:43', uid: 43,
      messageKey: 'serve@softora.nl|inbox|gen:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|43',
      messageId: '<message-43@example.test>', provider: '', providerMessageId: '',
      folder: 'inbox', unread: false, dismissReply: true,
    },
  }]);
  assert.equal(renders.length, 2);
  assert.deepEqual(toasts, ['Gesprek wordt als gelezen verwerkt…', 'Gesprek als gelezen afgehandeld']);
});

test('mailbox featuremodules bepalen reply of nieuw bericht uit de nieuwste echte message', () => {
  const conversation = {
    id: 'inbox:10',
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    date: '2026-07-24T10:00:00.000Z',
    threadMessages: [{
      id: 'sent:11',
      accountEmail: 'serve@softora.nl',
      folder: 'sent',
      date: '2026-07-24T11:00:00.000Z',
    }],
  };
  assert.equal(campaignInbox.getConversationAction(conversation).kind, 'new-message');
  conversation.date = '2026-07-24T12:00:00.000Z';
  assert.equal(campaignInbox.getConversationAction(conversation).kind, 'reply');
});

test('mailbox featuremodules tonen BCC alleen met exacte provenance', () => {
  const escapeHtml = (value) => String(value);
  const proven = campaignInbox.renderCopyRouting({
    copyContext: {
      evidenceKnown: true,
      kind: 'bcc',
      sourceName: 'Martijn van de Ven',
      sourceEmail: 'martijn@softora.nl',
      recipientName: 'Sandra van Berkel',
      recipientEmail: 'sandra@example.nl',
      copyAccountEmail: 'serve@softora.nl',
    },
  }, escapeHtml);
  assert.match(proven, /Van:<\/span><strong>Martijn van de Ven &lt;martijn@softora\.nl&gt;/);
  assert.match(proven, /Aan:<\/span><strong>Sandra van Berkel &lt;sandra@example\.nl&gt;/);
  assert.match(proven, /BCC:<\/span><strong>Servé Creusen &lt;serve@softora\.nl&gt;/);
  const unproven = campaignInbox.renderCopyRouting({
    copyContext: { evidenceKnown: false, kind: 'bcc' },
  }, escapeHtml);
  assert.match(unproven, /Van:<\/span><strong>Onbekend/);
  assert.doesNotMatch(unproven, /Aan:<\/span>|Niet beschikbaar in bronbericht/);
  assert.doesNotMatch(unproven, /BCC:<\/span>/);
});

test('compose featuremodule neemt alleen expliciet gekozen veilige bijlagen mee', async () => {
  const elements = new Map([
    ['c-attachment-list', { innerHTML: '' }],
    ['c-copy-fields', { hidden: true }],
    ['c-cc', { value: '' }],
    ['c-bcc', { value: '' }],
    ['c-attachments', { value: '' }],
  ]);
  const documentRef = { getElementById: (id) => elements.get(id) || null };
  compose.resetOptionalFields(documentRef);
  const result = await compose.addAttachments([{
    name: 'voorstel.pdf',
    type: 'application/pdf',
    size: 4,
    arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
  }], documentRef);
  assert.equal(result.ok, true);
  assert.deepEqual(compose.getAttachments().map(({ filename, size }) => ({ filename, size })), [{
    filename: 'voorstel.pdf',
    size: 4,
  }]);
  const blocked = await compose.addAttachments([{
    name: 'gevaar.exe',
    type: 'application/octet-stream',
    size: 4,
    arrayBuffer: async () => new ArrayBuffer(4),
  }], documentRef);
  assert.equal(blocked.ok, false);
  assert.equal(compose.getAttachments().length, 1);
  compose.resetOptionalFields(documentRef);
});

test('compose bewaakt alle clientgrenzen vóór een bijlage wordt toegevoegd', async () => {
  const elements = new Map([
    ['c-attachment-list', { innerHTML: '' }],
    ['c-copy-fields', { hidden: true }],
    ['c-cc', { value: '' }],
    ['c-bcc', { value: '' }],
    ['c-attachments', { value: '' }],
  ]);
  const documentRef = { getElementById: (id) => elements.get(id) || null };
  const file = (name, size, type = 'application/pdf') => ({ name, size, type });

  compose.resetOptionalFields(documentRef);
  try {
    const fiveFiles = Array.from({ length: 5 }, (_value, index) => file(`bijlage-${index + 1}.pdf`, 8));
    assert.equal((await compose.addAttachments(fiveFiles, documentRef)).ok, true);
    assert.equal(compose.getAttachments().length, 5);
    const sixth = await compose.addAttachments([file('bijlage-6.pdf', 8)], documentRef);
    assert.equal(sixth.ok, false);
    assert.match(sixth.error, /maximaal 5 bijlagen/);
    assert.equal(compose.getAttachments().length, 5);

    compose.resetOptionalFields(documentRef);
    const forbidden = await compose.addAttachments([
      file('gevaar.exe', 8, 'application/octet-stream'),
    ], documentRef);
    assert.equal(forbidden.ok, false);
    assert.match(forbidden.error, /wordt niet ondersteund/);
    assert.equal(compose.getAttachments().length, 0);

    const oversized = await compose.addAttachments([
      file('te-groot.pdf', 4 * 1024 * 1024 + 1),
    ], documentRef);
    assert.equal(oversized.ok, false);
    assert.match(oversized.error, /maximaal 4 MB/);
    assert.equal(compose.getAttachments().length, 0);

    const excessiveTotal = await compose.addAttachments([
      file('deel-1.pdf', 3 * 1024 * 1024),
      file('deel-2.pdf', 3 * 1024 * 1024),
    ], documentRef);
    assert.equal(excessiveTotal.ok, false);
    assert.match(excessiveTotal.error, /samen maximaal 5 MB/);
    assert.equal(compose.getAttachments().length, 0);
  } finally {
    compose.resetOptionalFields(documentRef);
  }
});

test('compose dropzone gebruikt dezelfde bijlagevalidatie en laat niet-bestandsdrags ongemoeid', async () => {
  function eventTarget(initial = {}) {
    const listeners = new Map();
    const classes = new Set();
    return {
      ...initial,
      listeners,
      classList: {
        add: (value) => classes.add(value),
        remove: (value) => classes.delete(value),
        contains: (value) => classes.has(value),
      },
      addEventListener: (type, listener) => listeners.set(type, listener),
    };
  }
  const overlay = eventTarget();
  const input = eventTarget({ value: 'gekozen', files: [] });
  const dropzone = eventTarget();
  const body = eventTarget();
  const elements = new Map([
    ['compose-overlay', overlay],
    ['c-attachments', input],
    ['compose-attachment-dropzone', dropzone],
    ['c-body', body],
  ]);
  const added = [];
  const attachmentDocuments = [];
  const toasts = [];
  const documentRef = {
    getElementById: (id) => elements.get(id) || null,
    querySelector: () => null,
  };
  const controller = composeController.create({
    document: documentRef,
    compose: {
      async addAttachments(files, receivedDocument) {
        const list = Array.from(files || []);
        added.push(list);
        attachmentDocuments.push(receivedDocument);
        if (list.some((file) => String(file?.name || '').endsWith('.exe'))) {
          return { ok: false, error: 'Dit bestand wordt niet ondersteund.' };
        }
        return { ok: true };
      },
    },
    toast: (message) => toasts.push(message),
  });
  controller.bind();

  const files = [{ name: 'foto-1.png' }, { name: 'voorstel.pdf' }];
  const transfer = { types: ['Files'], items: [{ kind: 'file' }], files, dropEffect: 'none' };
  let prevented = 0;
  let stopped = 0;
  const dragEvent = {
    dataTransfer: transfer,
    preventDefault: () => { prevented += 1; },
    stopPropagation: () => { stopped += 1; },
  };
  dropzone.listeners.get('dragenter')(dragEvent);
  assert.equal(dropzone.classList.contains('is-dragover'), true);
  dropzone.listeners.get('dragenter')(dragEvent);
  dropzone.listeners.get('dragleave')(dragEvent);
  assert.equal(dropzone.classList.contains('is-dragover'), true);
  dropzone.listeners.get('dragleave')(dragEvent);
  assert.equal(dropzone.classList.contains('is-dragover'), false);
  dropzone.listeners.get('dragenter')(dragEvent);
  assert.equal(dropzone.classList.contains('is-dragover'), true);
  dropzone.listeners.get('dragover')(dragEvent);
  assert.equal(transfer.dropEffect, 'copy');
  await dropzone.listeners.get('drop')(dragEvent);
  assert.deepEqual(added, [files]);
  assert.deepEqual(attachmentDocuments, [documentRef]);
  assert.equal(dropzone.classList.contains('is-dragover'), false);
  assert.equal(prevented, 7);
  assert.equal(stopped, 7);

  let textDragPrevented = false;
  await dropzone.listeners.get('drop')({
    dataTransfer: { types: ['text/plain'], items: [], files: [] },
    preventDefault: () => { textDragPrevented = true; },
    stopPropagation() {},
  });
  assert.equal(textDragPrevented, false);
  assert.equal(added.length, 1);

  await dropzone.listeners.get('drop')({
    dataTransfer: { types: ['Files'], items: [{ kind: 'file' }], files: [{ name: 'gevaar.exe' }] },
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(added.length, 2);
  assert.deepEqual(toasts, ['Dit bestand wordt niet ondersteund.']);

  input.files = [{ name: 'klik.pdf' }];
  await input.listeners.get('change')();
  assert.deepEqual(added.at(-1), input.files);
  assert.equal(attachmentDocuments.at(-1), documentRef);
  assert.equal(input.value, '');
});

test('compose controller verstuurt CC BCC en bijlagen uitsluitend na expliciete send', async () => {
  const requests = [];
  const values = {
    'c-to': { value: 'klant@example.nl' },
    'c-cc': { value: 'cc@example.nl' },
    'c-bcc': { value: 'bcc@example.nl' },
    'c-subject': { value: 'Onderwerp' },
    'c-body': { value: 'Bericht' },
    'compose-overlay': { classList: { add() {}, remove() {} } },
  };
  const documentRef = {
    getElementById: (id) => values[id] || null,
    querySelector: () => null,
  };
  const controller = composeController.create({
    document: documentRef,
    compose: {
      getAttachments: () => [{ filename: 'voorstel.pdf', contentType: 'application/pdf', size: 4, file: { name: 'voorstel.pdf' } }],
      uploadAttachments: async () => [{ reference: 'signed-reference', filename: 'voorstel.pdf', contentType: 'application/pdf', size: 4 }],
      serializeSendPayload: JSON.stringify,
      reset() {},
      resetOptionalFields() {},
    },
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    getAccount: () => 'serve@softora.nl',
    getActiveFolder: () => 'inbox',
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ ok: true }) };
    },
    toast() {},
  });
  assert.equal(requests.length, 0);
  await controller.send();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/mailbox/send');
  const payload = JSON.parse(requests[0].options.body);
  assert.equal(payload.mode, 'new-message');
  assert.equal(typeof payload.idempotencyKey, 'string');
  assert.ok(payload.idempotencyKey.length > 8);
  assert.deepEqual(payload.context, {
    conversationId: '',
    id: '',
    folder: '',
    uid: 0,
    messageId: '',
    references: '',
  });
  assert.deepEqual({
    account: payload.account,
    to: payload.to,
    cc: payload.cc,
    bcc: payload.bcc,
    subject: payload.subject,
    body: payload.body,
    attachments: payload.attachments,
  }, {
    account: 'serve@softora.nl',
    to: 'klant@example.nl',
    cc: 'cc@example.nl',
    bcc: 'bcc@example.nl',
    subject: 'Onderwerp',
    body: 'Bericht',
    attachments: [{ reference: 'signed-reference', filename: 'voorstel.pdf', contentType: 'application/pdf', size: 4 }],
  });
});

test('compose controller weigert een oude replycontext na eigenaarwissel', async () => {
  const requests = [];
  let owner = 'serve';
  const values = {
    'c-to': { value: '' },
    'c-cc': { value: '' },
    'c-bcc': { value: '' },
    'c-subject': { value: '' },
    'c-body': { value: 'Antwoord' },
    'compose-overlay': { classList: { add() {}, remove() {} } },
  };
  const mail = {
    id: 'serve-message',
    accountEmail: 'serve@softora.nl',
    email: 'prospect@example.nl',
    subject: 'Vraag',
  };
  const controller = composeController.create({
    document: {
      getElementById: (id) => values[id] || null,
      querySelector: () => null,
    },
    compose: {
      buildReplyContext: () => ({ id: mail.id, accountEmail: mail.accountEmail }),
      getAttachments: () => [],
      reset() {},
      resetOptionalFields() {},
    },
    campaignInbox: {
      getAccount: (message) => message.accountEmail,
      getMessageOwner: () => 'serve',
    },
    display: {
      getReplyToAddress: () => mail.email,
      formatDetailSubject: (value) => value,
    },
    findMail: () => mail,
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    getAccount: () => 'martijn@softora.nl',
    getOwner: () => owner,
    getActiveFolder: () => 'outreach',
    fetch: async (...args) => {
      requests.push(args);
      return { ok: true, json: async () => ({ ok: true }) };
    },
    toast() {},
  });
  controller.reply(mail);
  owner = 'martijn';
  await controller.send();
  assert.equal(requests.length, 0);
});

test('gecombineerde mailbox verstuurt een Instantly-antwoord uitsluitend via de bewezen eigenaar', async () => {
  const requests = [];
  const values = {
    'c-to': { value: '' },
    'c-cc': { value: '' },
    'c-bcc': { value: '' },
    'c-subject': { value: '' },
    'c-body': { value: 'Dankjewel voor je bericht.' },
    'compose-overlay': { classList: { add() {}, remove() {} } },
  };
  const mail = {
    id: 'instantly:reply-1',
    provider: 'instantly',
    providerOwner: 'serve',
    providerAccountEmail: 'servecreusen@websoftora.com',
    providerMessageId: 'message-1',
    providerThreadId: 'thread-1',
    accountEmail: 'servecreusen@websoftora.com',
    email: 'prospect@example.nl',
    subject: 'Re: Website',
  };
  const controller = composeController.create({
    document: {
      getElementById: (id) => values[id] || null,
      querySelector: () => null,
    },
    compose: {
      buildReplyContext: () => ({
        id: mail.id,
        accountEmail: mail.accountEmail,
        provider: mail.provider,
        providerOwner: mail.providerOwner,
        providerAccountEmail: mail.providerAccountEmail,
        providerMessageId: mail.providerMessageId,
        providerThreadId: mail.providerThreadId,
      }),
      getAttachments: () => [],
      reset() {},
      resetOptionalFields() {},
    },
    campaignInbox: {
      getAccount: (message) => message.accountEmail,
      getMessageOwner: () => 'serve',
      isPersonalOwner: (owner) => owner === 'serve' || owner === 'martijn',
    },
    display: {
      getReplyToAddress: () => mail.email,
      formatDetailSubject: (value) => value,
    },
    findMail: () => mail,
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    getAccount: () => 'serve@softora.nl',
    getOwner: () => 'both',
    getActiveFolder: () => 'outreach',
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ ok: true }) };
    },
    toast() {},
  });

  controller.reply(mail);
  await controller.send();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/mailbox/send');
  const payload = JSON.parse(requests[0].options.body);
  assert.equal(payload.owner, 'serve');
  assert.equal(payload.account, 'servecreusen@websoftora.com');
  assert.deepEqual(payload.replyIdentity, {
    version: 1,
    provider: 'instantly',
    owner: 'serve',
    accountEmail: 'servecreusen@websoftora.com',
    providerAccountEmail: 'servecreusen@websoftora.com',
    providerMessageId: 'message-1',
    providerThreadId: 'thread-1',
    sourceMessageId: '',
    conversationId: '',
  });
});

test('composevenster resize, drag, viewport-clamp en sluit-hitarea blijven gescheiden', () => {
  const listeners = {};
  function interactiveNode(prefix) {
    return {
      addEventListener(type, handler) { listeners[`${prefix}:${type}`] = handler; },
      setPointerCapture() {},
      releasePointerCapture() {},
    };
  }
  const handle = interactiveNode('handle');
  const resizeEdges = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  const resizeZones = Object.fromEntries(resizeEdges.map((edge) => {
    const zone = interactiveNode(`zone-${edge}`);
    zone.dataset = { mailboxComposeResizeZone: edge };
    return [edge, zone];
  }));
  const closeButton = interactiveNode('close');
  const style = {
    removeProperty(property) { delete this[property]; },
  };
  const box = {
    style,
    getBoundingClientRect() {
      const left = Number.parseFloat(style.left) || 100;
      const top = Number.parseFloat(style.top) || 80;
      const width = Number.parseFloat(style.width) || 800;
      const height = Number.parseFloat(style.height) || 600;
      return { left, top, right: left + width, bottom: top + height, width, height };
    },
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
    contains: () => false,
  };
  const overlay = {
    style: { pointerEvents: '' },
    classList: { contains: (name) => name === 'open' },
    querySelector(selector) {
      if (selector === '.compose-box') return box;
      if (selector === '[data-mailbox-compose-drag-handle]') return handle;
      if (selector === '[data-mailbox-action="close-compose"]') return closeButton;
      return null;
    },
    querySelectorAll(selector) {
      return selector === '[data-mailbox-compose-resize-zone]' ? Object.values(resizeZones) : [];
    },
    addEventListener(type, handler) { listeners[`overlay:${type}`] = handler; },
  };
  const scrollTarget = {
    scrollHeight: 1200,
    clientHeight: 600,
    scrollWidth: 600,
    clientWidth: 600,
    scrollBy(options) { this.lastScroll = options; },
    parentElement: null,
  };
  const documentRef = {
    getElementById: () => overlay,
    elementFromPoint: () => scrollTarget,
    documentElement: { clientWidth: 1200, clientHeight: 800 },
    scrollingElement: scrollTarget,
  };
  const windowRef = {
    innerWidth: 1200,
    innerHeight: 800,
    getComputedStyle: () => ({ overflowY: 'auto' }),
    addEventListener(type, handler) { listeners[`window:${type}`] = handler; },
  };
  const controller = composeWindow.create({ document: documentRef, window: windowRef });
  controller.bind();
  controller.open();
  assert.equal(box.style.width, '800px');
  assert.equal(box.style.height, '600px');

  function setRect() {
    Object.assign(style, { left: '100px', top: '80px', width: '800px', height: '600px' });
  }
  function resizeFrom(edge, deltaX, deltaY, pointerId) {
    setRect();
    const zone = resizeZones[edge];
    const base = { pointerId, currentTarget: zone, preventDefault() {}, stopPropagation() {} };
    listeners[`zone-${edge}:pointerdown`]({ ...base, button: 0, clientX: 500, clientY: 400 });
    listeners[`zone-${edge}:pointermove`]({ ...base, clientX: 500 + deltaX, clientY: 400 + deltaY });
    listeners[`zone-${edge}:pointerup`](base);
    return { left: style.left, top: style.top, width: style.width, height: style.height };
  }

  assert.deepEqual(resizeFrom('n', 0, 50, 11), { left: '100px', top: '130px', width: '800px', height: '550px' });
  assert.deepEqual(resizeFrom('ne', 80, 50, 12), { left: '100px', top: '130px', width: '880px', height: '550px' });
  assert.deepEqual(resizeFrom('e', 80, 0, 13), { left: '100px', top: '80px', width: '880px', height: '600px' });
  assert.deepEqual(resizeFrom('se', 80, 70, 14), { left: '100px', top: '80px', width: '880px', height: '670px' });
  assert.deepEqual(resizeFrom('s', 0, 70, 15), { left: '100px', top: '80px', width: '800px', height: '670px' });
  assert.deepEqual(resizeFrom('sw', 50, 70, 16), { left: '150px', top: '80px', width: '750px', height: '670px' });
  assert.deepEqual(resizeFrom('w', 50, 0, 17), { left: '150px', top: '80px', width: '750px', height: '600px' });
  assert.deepEqual(resizeFrom('nw', 50, 50, 18), { left: '150px', top: '130px', width: '750px', height: '550px' });

  const maxRect = resizeFrom('se', 1000, 1000, 19);
  assert.equal(maxRect.width, '1092px');
  assert.equal(maxRect.height, '712px');
  const minRect = resizeFrom('se', -1000, -1000, 20);
  assert.equal(minRect.width, '560px');
  assert.equal(minRect.height, '480px');

  let closePointerStopped = false;
  listeners['close:pointerdown']({ stopPropagation() { closePointerStopped = true; } });
  assert.equal(closePointerStopped, true);
  resizeFrom('ne', 40, -40, 21);
  const leftBeforeClosePointer = box.style.left;
  listeners['handle:pointerdown']({
    button: 0, pointerId: 3, clientX: 120, clientY: 100,
    target: { closest: () => closeButton }, preventDefault() {},
  });
  assert.equal(box.style.left, leftBeforeClosePointer);

  setRect();
  listeners['handle:pointerdown']({
    button: 0,
    pointerId: 1,
    clientX: 120,
    clientY: 100,
    target: { closest: () => null },
    preventDefault() {},
  });
  listeners['handle:pointermove']({
    pointerId: 1,
    clientX: 250,
    clientY: 220,
    preventDefault() {},
  });
  assert.equal(box.style.left, '230px');
  assert.equal(box.style.top, '192px');

  windowRef.innerWidth = 920;
  windowRef.innerHeight = 650;
  listeners['window:resize']();
  assert.equal(box.style.left, '112px');
  assert.equal(box.style.top, '42px');
  assert.equal(box.style.width, '800px');
  assert.equal(box.style.height, '600px');

  windowRef.innerWidth = 700;
  listeners['window:resize']();
  assert.equal(box.style.width, undefined);
  assert.equal(box.style.height, undefined);

  let prevented = false;
  listeners['overlay:wheel']({
    target: overlay,
    clientX: 20,
    clientY: 200,
    deltaX: 0,
    deltaY: 160,
    preventDefault() { prevented = true; },
  });
  assert.deepEqual(scrollTarget.lastScroll, { left: 0, top: 160, behavior: 'auto' });
  assert.equal(prevented, true);
});

test('verbergen gebruikt uitsluitend Softora hide en restore en nooit een bronmail-delete', async () => {
  const requests = [];
  const controller = mailboxDelete.create({
    getOwner: () => 'serve',
    getAccount: (mail) => mail.accountEmail,
    getFolder: (mail) => mail.folder,
    getRequestId: (mail) => mail.id,
    dialogs: { confirm: async () => true },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  const mail = {
    id: 'inbox:12',
    uid: 12,
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    subject: 'Vraag',
    threadMessages: [{
      id: 'sent:11',
      uid: 11,
      folder: 'sent',
      accountEmail: 'serve@softora.nl',
    }],
  };
  assert.equal((await controller.remove(mail)).ok, true);
  assert.equal(requests[0].url, '/api/mailbox/messages/hide');
  assert.equal(JSON.parse(requests[0].options.body).owner, 'serve');
  assert.equal(JSON.parse(requests[0].options.body).visibilityProtocol, 'atomic-contact-v1');
  assert.equal(JSON.parse(requests[0].options.body).messages.length, 2);
  assert.equal((await controller.restore(mail)).ok, true);
  assert.equal(requests[1].url, '/api/mailbox/messages/restore');
  assert.equal(JSON.parse(requests[1].options.body).visibilityProtocol, 'atomic-contact-v1');
  assert.doesNotMatch(
    assetSource('premium-mailbox-delete.js'),
    /messages\/delete|messageDelete|messageMove|createImapClient/
  );
});

test('lijst-, index-, image- en toastmodules bewaren de nieuwe mailboxinvarianten', () => {
  const listHtml = mailboxList.renderItem({
    id: 'copy:1',
    from: 'martijn@softora.nl',
    date: '2026-07-24T18:15:00.000Z',
    copyContext: { evidenceKnown: true, kind: 'bcc' },
  }, {
    escapeHtml: (value) => String(value || ''),
    display: { getListPrimaryText: (mail) => mail.from },
  });
  assert.match(listHtml, /mail-copy-badge">BCC</);
  assert.doesNotMatch(listHtml, /delete-mail|mail-item-delete/);
  assert.match(assetSource('premium-mailbox-index.js'), /recipientRoutingEvidenceKnown/);
  assert.match(assetSource('premium-mailbox-index.js'), /attachments:/);
  assert.match(assetSource('premium-mailbox-images.js'), /detail-mail-section-history-sent/);
  assert.doesNotMatch(assetSource('premium-mailbox-images.js'), /Jouw eerdere mail/);
  assert.equal(typeof composeAcceptedSend.create, 'function');
  assert.equal(typeof mailboxToast.create, 'function');
});
