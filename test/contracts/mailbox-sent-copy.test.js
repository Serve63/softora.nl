'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const { simpleParser } = require('mailparser');

const {
  appendSentMessage,
  assertRawMessageIntegrity,
} = require('../../server/services/mailbox-sent-copy');

function createClient(appended) {
  return {
    usable: true,
    async connect() {},
    async list() {
      return [{ path: 'Sent', specialUse: '\\Sent' }];
    },
    async append(mailboxName, raw, flags, date) {
      appended.push({ mailboxName, raw, flags, date });
    },
    async logout() {
      this.usable = false;
    },
  };
}

function createAccount() {
  return {
    imapHost: 'imap.example.test',
    imapPort: 993,
    imapSecure: true,
    imapUser: 'martijn@softora.nl',
    imapPass: 'secret',
  };
}

test('sent-copy MIME roundtrip preserves Dutch text, emoji, HTML and both attachments', async () => {
  const appended = [];
  const text = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website schakel-nu.nl tegen.',
    '',
    'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening 😁',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
  ].join('\n');
  const html = '<!doctype html><html lang="nl"><body><p>Goedendag,</p><p>Servé vraagt om je eerlijke mening 😁</p></body></html>';
  const attachments = [
    { filename: 'Webdesign.jpg', content: Buffer.from([1, 2, 3, 4]), contentType: 'image/jpeg' },
    { filename: 'Mockup.jpg', content: Buffer.from([5, 6, 7, 8]), contentType: 'image/jpeg' },
  ];

  const saved = await appendSentMessage({
    account: createAccount(),
    createImapClient: () => createClient(appended),
    nodemailer,
    mail: {
      from: 'Servé Creusen <serve@softora.nl>',
      to: 'serve@example.test',
      subject: 'Kleine vraag over jullie website 😁',
      text,
      html,
      attachments,
    },
    messageId: '<mime-roundtrip@softora.test>',
    sentAt: new Date('2026-07-15T13:45:00.000Z'),
  });

  assert.equal(saved, true);
  assert.equal(appended.length, 1);
  const raw = appended[0].raw;
  const rawText = raw.toString('utf8');
  assert.doesNotMatch(rawText, /(^|[^\r])\n/);
  assert.match(rawText, /charset=utf-8/i);
  const encodings = Array.from(rawText.matchAll(/^Content-Transfer-Encoding:\s*([^\r\n]+)/gim))
    .map((match) => match[1].trim().toLowerCase());
  assert.ok(encodings.length >= 4);
  assert.ok(encodings.every((value) => ['7bit', '8bit', 'quoted-printable', 'base64'].includes(value)));

  const parsed = await simpleParser(raw);
  assert.equal(parsed.subject, 'Kleine vraag over jullie website 😁');
  assert.equal(parsed.text.trimEnd(), text);
  assert.equal(String(parsed.html || '').trimEnd(), html);
  assert.deepEqual(parsed.attachments.map((item) => item.filename), ['Webdesign.jpg', 'Mockup.jpg']);
  assert.ok(parsed.attachments[0].content.equals(attachments[0].content));
  assert.ok(parsed.attachments[1].content.equals(attachments[1].content));
  assert.doesNotMatch(parsed.text, /�|kwrtiam|^printable$/m);
});

test('sent-copy is not appended when MIME roundtrip changes the mail body', async () => {
  const appended = [];
  const warnings = [];
  const invalidNodemailer = {
    createTransport() {
      return {
        async sendMail() {
          return {
            message: Buffer.from([
              'From: serve@softora.nl',
              'To: test@example.test',
              'Subject: Test',
              'Content-Type: text/plain; charset=utf-8',
              '',
              'verminkte tekst',
            ].join('\r\n')),
          };
        },
      };
    },
  };

  const saved = await appendSentMessage({
    account: createAccount(),
    createImapClient: () => createClient(appended),
    nodemailer: invalidNodemailer,
    mail: {
      from: 'serve@softora.nl',
      to: 'test@example.test',
      subject: 'Test',
      text: 'normale tekst',
    },
    logger: {
      warn(...args) {
        warnings.push(args);
      },
    },
  });

  assert.equal(saved, false);
  assert.equal(appended.length, 0);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][1].code, 'MAILBOX_SENT_COPY_INTEGRITY_FAILED');
});

test('sent-copy integrity rejects the historical LF-only quoted-printable shape', async () => {
  const historicalLfOnlyRaw = Buffer.from([
    'From: Martijn van de Ven <martijn@softora.nl>',
    'To: info@schakel-nu.nl',
    'Subject: Kleine vraag over jullie website',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website schakel-nu.nl tegen.=20',
    'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening =F0=9F=98=81',
  ].join('\n'));

  await assert.rejects(
    () => assertRawMessageIntegrity(historicalLfOnlyRaw, {
      from: 'Martijn van de Ven <martijn@softora.nl>',
      to: 'info@schakel-nu.nl',
      subject: 'Kleine vraag over jullie website',
      text: 'irrelevant because transport shape must fail first',
    }),
    (error) => {
      assert.equal(error.code, 'MAILBOX_SENT_COPY_INTEGRITY_FAILED');
      assert.match(error.message, /niet-CRLF/);
      return true;
    }
  );
});

test('sent-copy integrity rejects changed sender headers and attachment metadata', async () => {
  const attachment = Buffer.from('real-jpeg-bytes');
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
  const built = await transport.sendMail({
    from: 'Servé Creusen <serve@softora.nl>',
    to: 'test@example.test',
    replyTo: 'serve@softora.nl',
    messageId: '<integrity@softora.test>',
    subject: 'Test',
    text: 'Normale tekst',
    attachments: [
      {
        filename: 'Webdesign.jpg',
        content: attachment,
        contentType: 'application/octet-stream',
        contentDisposition: 'inline',
        cid: 'changed@softora',
      },
    ],
  });
  const raw = Buffer.from(built.message.toString('latin1').replace(/\r\n|\r|\n/g, '\r\n'), 'latin1');

  await assert.rejects(
    () => assertRawMessageIntegrity(raw, {
      from: 'Martijn van de Ven <martijn@softora.nl>',
      to: 'test@example.test',
      replyTo: 'martijn@softora.nl',
      messageId: '<integrity@softora.test>',
      subject: 'Test',
      text: 'Normale tekst',
      attachments: [
        {
          filename: 'Webdesign.jpg',
          content: attachment,
          contentType: 'image/jpeg',
          contentDisposition: 'attachment',
        },
      ],
    }),
    (error) => {
      assert.equal(error.code, 'MAILBOX_SENT_COPY_INTEGRITY_FAILED');
      assert.match(error.message, /From veranderde/);
      return true;
    }
  );

  await assert.rejects(
    () => assertRawMessageIntegrity(raw, {
      from: 'Servé Creusen <serve@softora.nl>',
      to: 'test@example.test',
      replyTo: 'serve@softora.nl',
      messageId: '<integrity@softora.test>',
      subject: 'Test',
      text: 'Normale tekst',
      attachments: [
        {
          filename: 'Webdesign.jpg',
          content: attachment,
          contentType: 'image/jpeg',
          contentDisposition: 'attachment',
        },
      ],
    }),
    (error) => {
      assert.equal(error.code, 'MAILBOX_SENT_COPY_INTEGRITY_FAILED');
      assert.match(error.message, /contenttype|dispositie|CID/i);
      return true;
    }
  );
});

test('sent-copy accepts HTML-only mail and does not duplicate Gmail provider sent copies', async () => {
  const appended = [];
  const htmlSaved = await appendSentMessage({
    account: createAccount(),
    createImapClient: () => createClient(appended),
    nodemailer,
    mail: {
      from: 'Martijn van de Ven <martijn@softora.nl>',
      to: 'test@example.test',
      subject: 'HTML-only',
      html: '<p>Alleen HTML 😁</p>',
    },
  });
  assert.equal(htmlSaved, true);
  assert.equal(appended.length, 1);

  const gmailSaved = await appendSentMessage({
    account: {
      ...createAccount(),
      email: 'contact.venvisuals@gmail.com',
      imapUser: 'contact.venvisuals@gmail.com',
    },
    createImapClient: () => {
      throw new Error('Gmail append must be skipped');
    },
    nodemailer,
    mail: {
      from: 'Martijn van de Ven <contact.venvisuals@gmail.com>',
      to: 'test@example.test',
      subject: 'Gmail',
      text: 'Hallo',
    },
  });
  assert.equal(gmailSaved, false);
});
