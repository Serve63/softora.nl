const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createMailboxImapSession } = require('../../server/services/mailbox-imap-session');
const { createMailboxImapFetcher } = require('../../server/services/mailbox-imap-fetch');
const { resolveMailboxName } = require('../../server/services/mailbox-sent-copy');

test('sequential folders reuse one account connection and listing, with fresh folder locks', async () => {
  const calls = [];
  const session = createMailboxImapSession();
  const client = Object.assign(new EventEmitter(), {
    usable: false, folders: new Map(),
    async connect() { calls.push('connect'); this.usable = true; },
    async list(options) {
      assert.deepEqual(options, { listOnly: true });
      calls.push('list');
      const folders = [{ path: 'INBOX' }, { path: 'Softora / Coldmail' }];
      this.folders = new Map(folders.map((folder) => [folder.path, folder]));
      return folders;
    },
    async getMailboxLock(folder) {
      calls.push(`lock:${folder}`);
      return { release() { calls.push(`release:${folder}`); } };
    },
    close() { calls.push('close'); this.usable = false; },
  });
  let created = 0;
  const fetcher = createMailboxImapFetcher({
    createClient() { created++; return client; }, getSafeLimit: () => 4,
    normalizeFolder: String, resolveMailboxName, resolveMailboxSyncUids: async () => [],
  });
  for (const folder of ['inbox', 'coldmail']) {
    assert.deepEqual(await fetcher({ account: { email: 'a@example.test' }, folder,
      imapSession: session, deadlineAtMs: Date.now() + 1000 }), []);
  }
  assert.equal(created, 1);
  assert.deepEqual(calls, ['connect', 'lock:INBOX', 'release:INBOX', 'list',
    'lock:Softora / Coldmail', 'release:Softora / Coldmail']);
  await session.close();
  assert.equal(calls.at(-1), 'close');
});

test('failed transport is replaced before retry and never crosses account identity', async () => {
  const session = createMailboxImapSession();
  const clients = [];
  const fetcher = createMailboxImapFetcher({
    createClient() {
      const client = Object.assign(new EventEmitter(), {
        usable: false, closed: 0,
        async connect() { this.usable = true; if (clients.length === 1) throw new Error('connection failed'); },
        close() { this.closed++; this.usable = false; },
      });
      clients.push(client);
      return client;
    },
    getSafeLimit: () => 4, normalizeFolder: String, resolveMailboxName: async () => null,
  });
  const input = { account: { email: 'a@example.test' }, imapSession: session };
  await assert.rejects(fetcher(input), /connection failed/);
  assert.equal(clients[0].closed, 1);
  assert.deepEqual(await fetcher(input), []);
  assert.equal(clients.length, 2);
  await assert.rejects(fetcher({ ...input, account: { email: 'b@example.test' } }), /account mismatch/);
  assert.equal(clients.length, 2);
  await session.close();
  assert.equal(clients[1].closed, 1);
});
