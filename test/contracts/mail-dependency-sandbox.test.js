const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const nodemailer = require('nodemailer');

function createSandboxedTransport(key) {
  const resolutions = [];
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  transport.use('compile', (mail, done) => {
    // The documented three-argument plugin API must inherit the transport sandbox.
    mail.resolveContent(mail.data, key, (error, content) => {
      resolutions.push({ code: error?.code, hasContent: content !== undefined });
      done(error);
    });
  });
  return { transport, resolutions };
}

test('mail plugins cannot read file content through the legacy resolver signature', async () => {
  const { transport, resolutions } = createSandboxedTransport('html');
  await assert.rejects(transport.sendMail({
    from: 'sender@example.test',
    to: 'recipient@example.test',
    subject: 'Synthetic sandbox regression',
    html: { path: __filename },
  }), { code: 'EFILEACCESS' });
  assert.deepEqual(resolutions, [{ code: 'EFILEACCESS', hasContent: false }]);
});

test('mail plugins cannot fetch URL content through the legacy resolver signature', async (t) => {
  let requests = 0;
  const server = http.createServer((_request, response) => {
    requests += 1;
    response.end('synthetic local fixture');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { transport, resolutions } = createSandboxedTransport('html');
  await assert.rejects(transport.sendMail({
    from: 'sender@example.test',
    to: 'recipient@example.test',
    subject: 'Synthetic sandbox regression',
    html: { href: `http://127.0.0.1:${server.address().port}/fixture` },
  }), { code: 'EURLACCESS' });
  assert.deepEqual(resolutions, [{ code: 'EURLACCESS', hasContent: false }]);
  assert.equal(requests, 0);
});
