const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAILBOX_UIDVALIDITY_MAX,
  buildMailboxGenerationMessageKey,
  normalizeMailboxUidValidity,
} = require('../../server/services/mailbox-uid-validity');
const {
  createMailboxImapMessageParser,
} = require('../../server/services/mailbox-imap-message-parser');
const {
  fetchSelectedMailboxMessages,
} = require('../../server/services/mailbox-imap-fetch');

test('UIDVALIDITY normalisatie begrenst IMAP-generaties en maakt UID-identiteit generatievast', () => {
  assert.equal(normalizeMailboxUidValidity(1), 1);
  assert.equal(normalizeMailboxUidValidity(String(MAILBOX_UIDVALIDITY_MAX)), MAILBOX_UIDVALIDITY_MAX);
  for (const invalid of [0, -1, MAILBOX_UIDVALIDITY_MAX + 1, 1.5, 'geen-getal', null]) {
    assert.equal(normalizeMailboxUidValidity(invalid), 0);
  }
  assert.equal(
    buildMailboxGenerationMessageKey('SERVE@SOFTORA.NL', 'INBOX', 42, 111),
    'serve@softora.nl|inbox|uv:111|42'
  );
  assert.notEqual(
    buildMailboxGenerationMessageKey('serve@softora.nl', 'inbox', 42, 111),
    buildMailboxGenerationMessageKey('serve@softora.nl', 'inbox', 42, 222)
  );
});

test('MIME-quarantaine van een UID lekt nooit naar dezelfde UID in een nieuwe generatie', async () => {
  let parseCalls = 0;
  const parser = createMailboxImapMessageParser({
    parseMailSource: async (source) => {
      parseCalls += 1;
      if (String(source) === 'defect') {
        throw Object.assign(new Error('corrupte MIME'), { code: 'MIME_CORRUPT' });
      }
      return { text: 'hersteld' };
    },
    normalizeString: (value) => String(value || ''),
    sanitizeDisplayText: (value) => value,
    buildBodyImages: () => [],
    toClientMessage: (_parsed, message) => ({ uid: message.uid, body: 'hersteld' }),
    logger: { warn() {} },
  });
  const input = { account: { email: 'serve@softora.nl' }, folder: 'inbox' };

  const poisoned = await parser.parseMessage({
    ...input, uidValidity: 111, message: { uid: 42, source: 'defect' },
  });
  const cached = await parser.parseMessage({
    ...input, uidValidity: 111, message: { uid: 42, source: 'gezond' },
  });
  const nextGeneration = await parser.parseMessage({
    ...input, uidValidity: 222, message: { uid: 42, source: 'gezond' },
  });

  assert.equal(poisoned.ok, false);
  assert.equal(cached.cached, true);
  assert.ok(Date.parse(poisoned.retryAt) > Date.now());
  assert.equal(cached.retryAt, poisoned.retryAt);
  assert.equal(nextGeneration.ok, true);
  assert.equal(parseCalls, 2);
});

test('IMAP-fetch draagt de geopende UIDVALIDITY naar ieder bericht en de read-health', async () => {
  const client = {
    fetch() {
      return (async function* messages() {
        yield { uid: 42, source: Buffer.from('mail') };
      })();
    },
  };
  const messages = await fetchSelectedMailboxMessages({
    account: { email: 'serve@softora.nl' },
    client,
    folder: 'inbox',
    selectedUids: [42, 43],
    uidValidity: 987,
    parseMessage: async ({ message }) => ({ ok: true, message: { uid: message.uid } }),
  });

  assert.equal(messages[0].uidValidity, 987);
  assert.equal(messages.syncReadHealth.uidValidity, 987);
  assert.deepEqual(messages.syncReadHealth.selectedUids, [42, 43]);
  assert.deepEqual(messages.syncReadHealth.yieldedUids, [42]);
  assert.deepEqual(messages.syncReadHealth.missingUids, [43]);
});
