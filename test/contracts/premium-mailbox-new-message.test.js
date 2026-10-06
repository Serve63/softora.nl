const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const controllerModule = require('../../assets/premium-mailbox-compose-controller.js');
const composeModule = require('../../assets/premium-mailbox-compose.js');
const campaignInbox = require('../../assets/premium-mailbox-campaign-inbox.js');
const { createControllerSendHarness } = require('../helpers/mailbox-compose-send-resilience');

function fixture(overrides = {}) {
  const elements = new Map();
  for (const id of ['c-from', 'compose-from-field', 'c-to', 'c-subject', 'c-body', 'c-cc', 'c-bcc', 'c-copy-fields', 'c-attachments', 'c-attachment-list', 'compose-overlay', 'send-button']) {
    const classes = new Set();
    elements.set(id, {
      value: '', textContent: id === 'send-button' ? 'Versturen' : '', innerHTML: '', disabled: false,
      hidden: false, addEventListener() {}, setAttribute() {}, removeAttribute() {},
      classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) },
    });
  }
  const document = { getElementById: (id) => elements.get(id) || null, querySelector: (selector) => selector === '.btn-send' ? elements.get('send-button') : null };
  const mail = { id: 'inbox:1', accountEmail: 'servecreusen7@gmail.com', email: 'contact@example.nl', subject: 'Oud onderwerp', conversationId: 'old-conversation', messageId: '<old-message>', provider: 'smtp' };
  let accounts = [
    { email: 'servecreusen7@gmail.com', smtpConfigured: true },
    { email: 'martijn@softora.nl', smtpConfigured: true },
    { email: 'serve@softora.nl', smtpConfigured: false },
    { email: 'stranger@example.nl', smtpConfigured: true },
  ];
  const requests = [], toasts = [], accepted = [];
  const options = {
    document,
    compose: {
      ...composeModule,
      reset: (isReply) => composeModule.reset(isReply, document),
      resetOptionalFields: () => composeModule.resetOptionalFields(document),
    },
    campaignInbox,
    getAccount: () => 'servecreusen7@gmail.com', getOwner: () => 'serve',
    getAccounts: () => accounts, getActiveFolder: () => 'outreach', findMail: (id) => id === mail.id ? mail : null,
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    display: { getReplyToAddress: () => mail.email, formatDetailSubject: (subject) => subject },
    fetch: async (url, input) => {
      requests.push({ url, body: JSON.parse(input.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { messageId: '<accepted@softora.nl>' } }) };
    },
    sendResilience: createControllerSendHarness(), onAcceptedSend: (record) => accepted.push(record),
    toast: (text) => toasts.push(text), ...overrides,
  };
  const controller = controllerModule.create(options);
  const field = (id) => elements.get(id);
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  function fill() { field('c-to').value = 'new-contact@example.nl'; field('c-subject').value = 'Nieuw onderwerp'; field('c-body').value = 'Mijn nieuwe mail 😁'; }
  return { controller, field, document, mail, requests, accepted, toasts, settle, fill, setAccounts: (value) => { accounts = value; } };
}

test('de bovenbalk opent een losse composer met expliciete afzenderkeuze', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../premium-mailbox.html'), 'utf8');
  assert.match(page, /class="topbar-compose"[^>]*data-mailbox-action="compose-new-mail"[^>]*>[\s\S]*?Mail verzenden[\s\S]*?<\/button>/);
  assert.match(page, /id="compose-from-field" hidden><label[^>]*for="c-from">Van<\/label><select id="c-from" required disabled>/);
  assert.ok(page.indexOf('premium-mailbox-compose-sender.js?v=20261006a') < page.indexOf('premium-mailbox-compose-controller.js?v=20261006b'));
  const wiring = fs.readFileSync(path.join(__dirname, '../../assets/premium-mailbox.js'), 'utf8');
  assert.match(wiring, /getAccounts: \(\) => mailboxAccounts, whenAccountsReady: \(\) => mailboxAccountsLoad/);
});

test('nieuw vanaf nul wist het vorige gesprek, kopievelden en bijlagen zonder te verzenden', async () => {
  const f = fixture();
  f.controller.reply(f.mail);
  f.field('c-body').value = 'Oude tekst'; f.field('c-cc').value = 'old-cc@example.nl'; f.field('c-bcc').value = 'old-bcc@example.nl';
  await composeModule.addAttachments([{ name: 'oud.txt', type: 'text/plain', size: 3, arrayBuffer: async () => Uint8Array.from([111, 117, 100]).buffer }], f.document);
  assert.equal(composeModule.getAttachments().length, 1);
  assert.equal(f.controller.handleAction('compose-new-mail'), true);
  await f.settle();
  for (const id of ['c-from', 'c-to', 'c-subject', 'c-body', 'c-cc', 'c-bcc']) assert.equal(f.field(id).value, '');
  assert.deepEqual(composeModule.getAttachments(), []);
  assert.equal(f.field('c-copy-fields').hidden, true);
  assert.equal(f.field('compose-from-field').hidden, false);
  assert.equal(f.field('compose-overlay').classList.contains('open'), true);
  assert.deepEqual(f.controller.getContext(), { mode: 'new-message', isFreshMessage: true });
  assert.match(f.field('c-from').innerHTML, /Kies afzender/);
  assert.doesNotMatch(f.field('c-from').innerHTML, /stranger@example|serve@softora/);
  assert.equal(f.requests.length, 0);
});

test('nieuwe mail gebruikt de gekozen afzender en eigenaar, zonder geërfde thread en met single-flight', async () => {
  let finish;
  const requests = [];
  const f = fixture({ fetch: async (url, input) => {
    requests.push({ url, body: JSON.parse(input.body) });
    return new Promise((resolve) => { finish = () => resolve({ ok: true, status: 200, json: async () => ({ ok: true, result: { messageId: '<new-message>' } }) }); });
  } });
  f.controller.startNewMessage(); await f.settle(); f.fill(); f.field('c-from').value = 'martijn@softora.nl';
  const pending = f.controller.send();
  await f.settle(); await f.controller.send();
  assert.equal(f.field('c-from').disabled, true);
  assert.equal(requests.length, 1);
  const { body, url } = requests[0];
  assert.equal(url, '/api/mailbox/send');
  assert.equal(body.account, 'martijn@softora.nl'); assert.equal(body.owner, 'martijn'); assert.equal(body.mode, 'new-message');
  assert.equal(body.to, 'new-contact@example.nl'); assert.equal(body.body, 'Mijn nieuwe mail 😁');
  assert.deepEqual(body.context, { conversationId: '', id: '', folder: '', uid: 0, messageId: '', references: '' });
  assert.equal(body.replyIdentity, undefined); assert.equal(body.providerMessageId, undefined); assert.ok(body.idempotencyKey);
  finish(); await pending;
  assert.equal(f.field('compose-overlay').classList.contains('open'), false);
  assert.equal(f.accepted[0].owner, 'martijn');
});

test('ontbrekende, vreemde of niet meer verzendbare afzender blokkeert vóór de API', async () => {
  const f = fixture(); f.controller.startNewMessage(); await f.settle(); f.fill();
  for (const email of ['', 'stranger@example.nl', 'serve@softora.nl']) { f.field('c-from').value = email; await f.controller.send(); }
  f.field('c-from').value = 'martijn@softora.nl'; f.setAccounts([{ email: 'martijn@softora.nl', smtpConfigured: false }]);
  await f.controller.send();
  assert.equal(f.requests.length, 0);
  assert.equal(f.field('compose-overlay').classList.contains('open'), true);
});

test('een vertraagde accountlijst heropent of vervuilt geen gesloten composer of reply', async () => {
  let finish;
  const ready = new Promise((resolve) => { finish = resolve; });
  const f = fixture({ whenAccountsReady: () => ready });
  f.controller.startNewMessage(); assert.equal(f.field('c-from').disabled, true);
  f.fill(); f.field('c-from').value = 'martijn@softora.nl'; await f.controller.send(); assert.equal(f.requests.length, 0);
  f.controller.close(); f.controller.reply(f.mail); finish(); await f.settle();
  assert.equal(f.field('compose-from-field').hidden, true);
  assert.equal(f.controller.getContext().mode, 'reply');
  assert.equal(f.controller.getContext().accountEmail, 'servecreusen7@gmail.com');
  f.field('c-body').value = 'Een antwoord'; await f.controller.send();
  assert.equal(f.requests[0].body.account, 'servecreusen7@gmail.com');
  assert.equal(f.requests[0].body.mode, 'reply');
});

test('nieuwe mail bewaart de verzend-ID na een mislukking en ontgrendelt de afzender', async () => {
  const requests = [];
  const f = fixture({ fetch: async (_url, input) => { requests.push(JSON.parse(input.body)); return { ok: false, status: 503, json: async () => ({ ok: false, detail: 'Tijdelijk niet beschikbaar' }) }; } });
  f.controller.startNewMessage(); await f.settle(); f.fill(); f.field('c-from').value = 'servecreusen7@gmail.com';
  await f.controller.send(); await f.controller.send();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].idempotencyKey, requests[1].idempotencyKey);
  assert.equal(f.field('c-from').disabled, false);
  assert.equal(f.field('c-body').value, 'Mijn nieuwe mail 😁');
});

test('tekstverbetering van een nieuwe mail gebruikt het gekozen afzenderprofiel', async () => {
  const profiles = [], requests = [];
  const f = fixture({ loadSenderProfile: async (email) => { profiles.push(email); return { name: 'Martijn' }; }, fetch: async (url, input) => {
    requests.push({ url, body: JSON.parse(input.body) }); return { ok: true, json: async () => ({ ok: true, text: 'Verbeterde tekst' }) };
  } });
  f.controller.startNewMessage(); await f.settle(); f.fill(); f.field('c-from').value = 'martijn@softora.nl';
  await f.controller.rewrite();
  assert.deepEqual(profiles, ['martijn@softora.nl']);
  assert.equal(requests[0].url, '/api/mailbox/rewrite'); assert.equal(requests[0].body.account, 'martijn@softora.nl');
  assert.equal(requests[0].body.context.conversationId, undefined); assert.equal(f.field('c-from').disabled, false);
});
