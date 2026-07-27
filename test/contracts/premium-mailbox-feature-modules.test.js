const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const campaignInbox = require('../../assets/premium-mailbox-campaign-inbox.js');
const compose = require('../../assets/premium-mailbox-compose.js');
const composeController = require('../../assets/premium-mailbox-compose-controller.js');
const mailboxDelete = require('../../assets/premium-mailbox-delete.js');
const mailboxToast = require('../../assets/premium-mailbox-toast.js');
const mailboxList = require('../../assets/premium-mailbox-list.js');

function assetSource(filename) {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'assets', filename), 'utf8');
}

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
  assert.equal(campaignInbox.renderCopyRouting({
    copyContext: { evidenceKnown: false, kind: 'bcc' },
  }, escapeHtml), '');
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
      getAttachments: () => [{ filename: 'voorstel.pdf', contentBase64: 'AQIDBA==', size: 4 }],
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
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    account: 'serve@softora.nl',
    to: 'klant@example.nl',
    cc: 'cc@example.nl',
    bcc: 'bcc@example.nl',
    subject: 'Onderwerp',
    body: 'Bericht',
    attachments: [{ filename: 'voorstel.pdf', contentBase64: 'AQIDBA==', size: 4 }],
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

test('verbergen gebruikt uitsluitend Softora hide en restore en nooit een bronmail-delete', async () => {
  const requests = [];
  const controller = mailboxDelete.create({
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
  assert.equal(JSON.parse(requests[0].options.body).messages.length, 2);
  assert.equal((await controller.restore(mail)).ok, true);
  assert.equal(requests[1].url, '/api/mailbox/messages/restore');
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
  assert.equal(typeof mailboxToast.create, 'function');
});
