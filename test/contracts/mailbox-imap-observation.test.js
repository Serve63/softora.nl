const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { observeMailboxImapClient } = require('../../server/services/mailbox-imap-observation');
const { runMailboxImapOperationWithDeadline } = require('../../server/services/mailbox-imap-fetch');

test('IMAP transport errors reject the active operation and late teardown errors stay handled', async () => {
  const client = new EventEmitter();
  const observer = observeMailboxImapClient(client);
  const failure = new Error('connection failed');
  const operation = observer.run(() => new Promise(() => {}));
  client.emit('error', failure);
  await assert.rejects(operation, (error) => error === failure);
  assert.doesNotThrow(() => client.emit('error', new Error('late close error')));
});

test('closing a timed out IMAP handshake cannot cause an unhandled client error', async () => {
  const client = new EventEmitter();
  const observer = observeMailboxImapClient(client);
  let closed = false;
  client.close = () => {
    closed = true;
    setImmediate(() => client.emit('error', new Error('Connection not available')));
  };
  await assert.rejects(runMailboxImapOperationWithDeadline({
    client, timeoutMs: 5, operation: () => observer.run(() => new Promise(() => {})),
  }), (error) => error.code === 'MAILBOX_IMAP_OPERATION_TIMEOUT');
  await new Promise(setImmediate);
  assert.equal(closed, true);
});

test('IMAP diagnostics retain only the operation stage and allowlisted protocol verbs', async () => {
  const client = new EventEmitter();
  const observer = observeMailboxImapClient(client);
  client.emit('log', { src: 'c', msg: 'A1 LOGIN private@example.com super-secret' });
  client.emit('log', { src: 'auth', msg: 'User authenticated', user: 'private@example.com' });
  client.emit('log', { src: 's', msg: 'private server response' });
  client.emit('log', { src: 'c', msg: 'A2 COMPRESS DEFLATE' });
  client.emit('log', { src: 'c', msg: 'base64-secret' });
  assert.deepEqual(observer.snapshot(), { operationStage: 'connect', lastCommand: 'COMPRESS', authenticated: true });
  observer.setStage('read-folder');
  assert.equal(await observer.run(async () => 42), 42);
  assert.equal(observer.snapshot().operationStage, 'read-folder');
});
