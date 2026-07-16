const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');

const { verifyMailbox } = require('../../server/services/smtp-mailbox-validator');

async function withFakeSmtp(handler, run) {
  const commands = [];
  const server = net.createServer((socket) => {
    socket.write('220 mx.test ESMTP ready\r\n');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const command = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        commands.push(command);
        const reply = handler(command, commands);
        if (reply) socket.write(`${reply}\r\n`);
        index = buffer.indexOf('\n');
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run(server.address().port, commands);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function commonReply(command) {
  if (/^(?:EHLO|HELO) /.test(command)) return '250 mx.test';
  if (command === 'MAIL FROM:<>') return '250 2.1.0 sender ok';
  if (command === 'RSET') return '250 reset';
  if (command === 'QUIT') return '221 bye';
  return '';
}

function options(port) {
  return {
    port,
    startTls: false,
    timeoutMs: 2000,
    resolveMx: async () => [{ priority: 10, exchange: '127.0.0.1' }],
  };
}

test('bevestigt een mailbox en verstuurt nooit DATA', async () => {
  await withFakeSmtp((command) => {
    const reply = commonReply(command);
    if (reply) return reply;
    if (command === 'RCPT TO:<info@example.com>') return '250 2.1.5 recipient ok';
    if (/^RCPT TO:<softora-check-/.test(command)) return '550 5.1.1 user unknown';
    return '500 unknown command';
  }, async (port, commands) => {
    const result = await verifyMailbox('info@example.com', options(port));
    assert.equal(result.status, 'valid');
    assert.equal(result.catchAll, false);
    assert.equal(commands.some((command) => /^DATA\b/.test(command)), false);
  });
});

test('markeert een expliciet ontbrekende mailbox als ongeldig', async () => {
  await withFakeSmtp((command) => {
    const reply = commonReply(command);
    if (reply) return reply;
    if (command === 'RCPT TO:<weg@example.com>') return '550 5.1.1 no such user';
    return '500 unknown command';
  }, async (port, commands) => {
    const result = await verifyMailbox('weg@example.com', options(port));
    assert.equal(result.status, 'invalid');
    assert.equal(result.reason, 'mailbox_does_not_exist');
    assert.equal(commands.some((command) => /^DATA\b/.test(command)), false);
  });
});

test('catch-all domeinen blijven onbekend en worden niet vrijgegeven', async () => {
  await withFakeSmtp((command) => {
    const reply = commonReply(command);
    if (reply) return reply;
    if (/^RCPT TO:</.test(command)) return '250 2.1.5 recipient ok';
    return '500 unknown command';
  }, async (port) => {
    const result = await verifyMailbox('info@example.com', options(port));
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'domain_accepts_all_recipients');
    assert.equal(result.catchAll, true);
  });
});

test('valt volgens SMTP-standaard terug op het domein als MX ontbreekt maar A bestaat', async () => {
  const calls = [];
  const result = await verifyMailbox('info@example.com', {
    resolveMx: async () => {
      const error = new Error('no mx');
      error.code = 'ENODATA';
      throw error;
    },
    resolveAddress: async () => true,
    verifyAgainstMx: async (email, host) => {
      calls.push({ email, host });
      return { status: 'valid', reason: 'mailbox_confirmed' };
    },
  });
  assert.equal(result.status, 'valid');
  assert.deepEqual(calls, [{ email: 'info@example.com', host: 'example.com' }]);
});

test('respecteert een expliciet null-MX domein', async () => {
  const result = await verifyMailbox('info@example.com', {
    resolveMx: async () => [{ priority: 0, exchange: '.' }],
  });
  assert.equal(result.status, 'invalid');
  assert.equal(result.reason, 'email_domain_explicitly_rejects_mail');
});
