const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const composeController = require('../../assets/premium-mailbox-compose-controller.js');
const {
  correctDutchDraft,
  createMailboxSpellingService,
} = require('../../server/services/mailbox-spelling');

const repoRoot = path.join(__dirname, '..', '..');

function createButton(label = '') {
  return {
    textContent: label,
    disabled: false,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
  };
}

function createControllerHarness({ body = '', fetch, spellingTimeoutMs } = {}) {
  const fields = new Map([
    ['c-to', { value: 'klant@example.nl' }],
    ['c-cc', { value: 'cc@example.nl' }],
    ['c-bcc', { value: 'bcc@example.nl' }],
    ['c-subject', { value: 'Bestaand onderwerp' }],
    ['c-body', {
      value: body,
      selectionStart: Math.min(7, body.length),
      selectionEnd: Math.min(7, body.length),
      scrollTop: 34,
      listeners: {},
      addEventListener(name, listener) { this.listeners[name] = listener; },
      setSelectionRange(start, end) {
        this.selectionStart = start;
        this.selectionEnd = end;
      },
      focus() { documentRef.activeElement = this; },
    }],
    ['c-attachments', { value: '', files: [], addEventListener() {} }],
    ['compose-overlay', { classList: { add() {}, remove() {} }, addEventListener() {} }],
  ]);
  const spellingButton = createButton('Spellingscontrole');
  const rewriteButton = createButton('Voorgestelde reactie');
  const sendButton = createButton('Versturen');
  const documentRef = {
    activeElement: fields.get('c-body'),
    getElementById(id) { return fields.get(id) || null; },
    querySelector(selector) {
      if (selector === '[data-mailbox-action="spellcheck-compose"]') return spellingButton;
      if (selector === '[data-mailbox-action="rewrite-compose"]') return rewriteButton;
      if (selector === '.btn-send') return sendButton;
      return null;
    },
  };
  const requests = [];
  const toasts = [];
  const controller = composeController.create({
    document: documentRef,
    spellingTimeoutMs,
    fetch: async (url, options) => {
      requests.push({ url, options, payload: JSON.parse(options.body) });
      return fetch
        ? fetch(url, options)
        : { ok: true, json: async () => ({ ok: true, text: body }) };
    },
    compose: {
      addAttachments: async () => ({ ok: true }),
      getAttachments: () => [{ filename: 'bewijs.pdf', size: 4 }],
      isUsed: () => false,
      reset() {},
      resetOptionalFields() {},
    },
    composeWindow: { open() {}, reset() {} },
    toast(message, actionOptions) { toasts.push({ message, actionOptions }); },
  });
  return {
    controller,
    documentRef,
    fields,
    requests,
    rewriteButton,
    sendButton,
    spellingButton,
    toasts,
  };
}

test('Nederlandse spellingscontrole corrigeert alleen veilige taalvormen en het gemelde voorbeeld', async () => {
  assert.deepEqual(
    await correctDutchDraft('Klopt, Excuses, deze was niet voor jullie bedoeld.'),
    { text: 'Klopt, excuses, deze was niet voor jullie bedoeld.', changed: true }
  );
  assert.deepEqual(
    await correctDutchDraft('ik vindt dit gramatica echt goed ,maar mischien kan het beter.'),
    { text: 'Ik vind dit grammatica echt goed, maar misschien kan het beter.', changed: true }
  );
});

test('spellingscontrole bewaart alinea’s, beschermde tokens en handtekening exact', async () => {
  const original = [
    'Beste Martijn,',
    '',
    'bekijk https://softora.nl/test en mail naam@example.nl voor € 1.250,00 op 17 augustus 2026.',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
    'Softora',
  ].join('\n');
  const result = await correctDutchDraft(original);

  assert.equal(result.text, original.replace('\nbekijk ', '\nBekijk '));
  assert.match(result.text, /https:\/\/softora\.nl\/test/);
  assert.match(result.text, /naam@example\.nl/);
  assert.match(result.text, /€ 1\.250,00 op 17 augustus 2026/);
  assert.ok(result.text.endsWith('Met vriendelijke groet,\nServé Creusen\nSoftora'));
});

test('spellingservice weigert lege tekst zonder checker- of providercall', async () => {
  let checkerLoads = 0;
  const service = createMailboxSpellingService({
    loadChecker: async () => { checkerLoads += 1; return null; },
    logger: { error() {} },
  });
  const response = {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };

  await service.correctDraftResponse({ body: { body: '   ' } }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error, 'Typ eerst je mailtekst.');
  assert.equal(checkerLoads, 0);
});

test('composer vervangt uitsluitend body, bewaart focus en biedt exact undo zonder send-effect', async () => {
  const original = 'Klopt, Excuses, deze was niet voor jullie bedoeld.';
  const corrected = 'Klopt, excuses, deze was niet voor jullie bedoeld.';
  const harness = createControllerHarness({
    body: original,
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, text: corrected, changed: true }) }),
  });
  const originalProtectedFields = ['c-to', 'c-cc', 'c-bcc', 'c-subject']
    .map((id) => [id, harness.fields.get(id).value]);

  await harness.controller.spellcheck();

  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].url, '/api/mailbox/spelling');
  assert.deepEqual(harness.requests[0].payload, { body: original });
  assert.equal(harness.requests.some(({ url }) => url.includes('/send')), false);
  assert.equal(harness.fields.get('c-body').value, corrected);
  assert.equal(harness.documentRef.activeElement, harness.fields.get('c-body'));
  assert.equal(harness.fields.get('c-body').scrollTop, 34);
  assert.deepEqual(
    ['c-to', 'c-cc', 'c-bcc', 'c-subject'].map((id) => [id, harness.fields.get(id).value]),
    originalProtectedFields
  );
  assert.equal(harness.toasts.at(-1).message, 'Spelling gecontroleerd');
  assert.equal(harness.toasts.at(-1).actionOptions.label, 'Ongedaan maken');

  await harness.toasts.at(-1).actionOptions.action();

  assert.equal(harness.fields.get('c-body').value, original);
  assert.equal(harness.toasts.at(-1).message, 'Spellingscorrectie ongedaan gemaakt');
});

test('lege composer doet geen request en spellingsknop volgt body-inhoud', async () => {
  const harness = createControllerHarness({ body: '' });
  harness.controller.bind();

  assert.equal(harness.spellingButton.disabled, true);
  await harness.controller.spellcheck();
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.toasts.at(-1).message, 'Typ eerst je mailtekst');

  harness.fields.get('c-body').value = 'Concept';
  harness.fields.get('c-body').listeners.input();
  assert.equal(harness.spellingButton.disabled, false);
});

test('dubbelklik is single-flight en een bodywijziging tijdens controle wordt nooit overschreven', async () => {
  let resolveRequest;
  const responsePromise = new Promise((resolve) => { resolveRequest = resolve; });
  const harness = createControllerHarness({
    body: 'fout concept',
    fetch: async () => responsePromise,
  });

  const first = harness.controller.spellcheck();
  const second = harness.controller.spellcheck();
  harness.fields.get('c-body').value = 'Handmatig gewijzigd';
  resolveRequest({ ok: true, json: async () => ({ ok: true, text: 'Fout concept' }) });
  await Promise.all([first, second]);

  assert.equal(harness.requests.length, 1);
  assert.equal(harness.fields.get('c-body').value, 'Handmatig gewijzigd');
  assert.equal(harness.toasts.at(-1).message, 'De tekst is tijdens de controle gewijzigd; controleer opnieuw.');
});

test('timeout behoudt originele tekst en toont geen technische fout', async () => {
  const original = 'dit blijft exact staan';
  const harness = createControllerHarness({
    body: original,
    spellingTimeoutMs: 5,
    fetch: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('raw provider timeout 504');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
  });

  await harness.controller.spellcheck();

  assert.equal(harness.fields.get('c-body').value, original);
  assert.equal(harness.toasts.at(-1).message, 'Spellingscontrole duurde te lang. Je tekst is niet gewijzigd.');
  assert.doesNotMatch(harness.toasts.at(-1).message, /504|provider|raw/i);
});

test('sluiten tijdens controle blokkeert iedere late bodymutatie', async () => {
  let resolveRequest;
  const responsePromise = new Promise((resolve) => { resolveRequest = resolve; });
  const harness = createControllerHarness({
    body: 'Concept met fout',
    fetch: async () => responsePromise,
  });

  const pending = harness.controller.spellcheck();
  harness.controller.close();
  resolveRequest({ ok: true, json: async () => ({ ok: true, text: 'Concept zonder fout' }) });
  await pending;

  assert.equal(harness.fields.get('c-body').value, '');
  assert.equal(harness.toasts.length, 0);
});

test('composerfooter plaatst Spellingscontrole direct naast Voorgestelde reactie en blijft mobiel bruikbaar', () => {
  const page = fs.readFileSync(path.join(repoRoot, 'premium-mailbox.html'), 'utf8');
  const mobileCss = fs.readFileSync(path.join(repoRoot, 'assets/premium-mailbox-mobile.css'), 'utf8');
  const controllerSource = fs.readFileSync(
    path.join(repoRoot, 'assets/premium-mailbox-compose-controller.js'),
    'utf8'
  );

  assert.match(page, /class="compose-assist-actions">\s*<button[^>]+rewrite-compose[^>]*>Voorgestelde reactie<\/button>\s*<button[^>]+spellcheck-compose[^>]*>Spellingscontrole<\/button>/);
  assert.match(page, /\.btn-rewrite-compose,\s*\.btn-spellcheck-compose \{/);
  assert.match(page, /\.btn-spellcheck-compose:focus-visible/);
  assert.match(mobileCss, /\.compose-assist-actions \{ flex: 1 1 100%; \}/);
  assert.match(mobileCss, /\.btn-rewrite-compose,\s*\.btn-spellcheck-compose \{ flex: 1 1 0;/);
  assert.match(mobileCss, /\.btn-rewrite-compose,\s*\.btn-spellcheck-compose,\s*\.btn-send \{ min-height: 44px;/);
  assert.match(mobileCss, /\.compose-footer \{ align-items: stretch; flex-direction: column; \}/);
  assert.match(controllerSource, /body:\s*JSON\.stringify\(\{ body: original \}\)/);
  assert.match(controllerSource, /action === 'spellcheck-compose'[\s\S]*void spellcheck\(\)/);
  assert.doesNotMatch(controllerSource, /spellcheck[\s\S]{0,500}\/api\/mailbox\/send/);
  assert.match(page, /assets\/premium-mailbox-compose-controller\.js\?v=20260817c/);
  assert.match(page, /assets\/premium-mailbox-mobile\.css\?v=20260817c/);
});
