const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { ImapFlow } = require('imapflow');
const { createMailboxService } = require('../../server/services/mailbox');
const { runMailboxImapOperationWithDeadline } = require('../../server/services/mailbox-imap-fetch');

test('mailbox can read after authentication when the provider stalls optional COMPRESS', async (t) => {
  const commands = [];
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.write('* OK synthetic IMAP server ready\r\n');
    let pending = '';
    socket.on('data', (chunk) => {
      pending += chunk.toString();
      while (pending.includes('\r\n')) {
        const end = pending.indexOf('\r\n');
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const [tag, command] = line.split(' ');
        commands.push(command);
        if (command === 'COMPRESS') continue; // Observed provider failure: never answers.
        if (command === 'CAPABILITY') socket.write('* CAPABILITY IMAP4rev1 NAMESPACE COMPRESS=DEFLATE\r\n');
        if (command === 'NAMESPACE') socket.write('* NAMESPACE (("" "/")) NIL NIL\r\n');
        if (command === 'SELECT' || command === 'EXAMINE') {
          socket.write('* 0 EXISTS\r\n* OK [UIDVALIDITY 1] valid\r\n* OK [UIDNEXT 1] next\r\n');
        }
        if (command === 'LIST' || command === 'LSUB') socket.write(`* ${command} (\\Inbox) "/" "INBOX"\r\n`);
        if (command === 'UID' || command === 'SEARCH') socket.write('* SEARCH\r\n');
        if (command === 'LOGOUT') socket.write('* BYE closing\r\n');
        socket.write(`${tag} OK completed\r\n`);
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  let configuredSecure;
  const service = createMailboxService({
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([{
      email: 'serve@softora.nl', imapHost: 'imap.example.test', imapPort: 993,
      imapSecure: true, imapUser: 'synthetic', imapPass: 'synthetic-password',
    }]),
    createImapClient(config) {
      configuredSecure = config.secure;
      // Only this loopback fixture is plaintext; the production TLS config is asserted below.
      return new ImapFlow({ ...config, host: '127.0.0.1', port: server.address().port,
        secure: false, doSTARTTLS: false });
    },
    runMailboxImapOperationWithDeadline: (options) => runMailboxImapOperationWithDeadline({ ...options, timeoutMs: 1000 }),
  });
  const result = await service.listMessagesWithMeta({
    accountEmail: 'serve@softora.nl', folder: 'inbox', allowLiveImapFallback: true,
  });
  assert.equal(configuredSecure, true);
  assert.equal(result.sync.source, 'imap-live');
  assert.deepEqual(result.messages, []);
  assert.ok(commands.includes('LOGIN'));
  assert.ok(commands.includes('SELECT'));
  assert.equal(commands.includes('COMPRESS'), false);
});
