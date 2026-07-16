const { simpleParser } = require('mailparser');

const FOLDER_ALIASES = {
  inbox: ['INBOX'],
  sent: [
    'Sent',
    'Sent Items',
    'Sent Mail',
    'Sent Messages',
    'INBOX/Sent',
    'INBOX/Sent Items',
    'INBOX/Sent Mail',
    'INBOX/Sent Messages',
    'INBOX.Sent',
    'INBOX.Sent Items',
    'INBOX.Sent Mail',
    'INBOX.Sent Messages',
    'Verzonden',
    'Verzonden items',
    'Verzonden berichten',
    'INBOX/Verzonden',
    'INBOX/Verzonden items',
    'INBOX/Verzonden berichten',
    'INBOX.Verzonden',
    'INBOX.Verzonden items',
    'INBOX.Verzonden berichten',
    'Verstuurd',
    'Verstuurde items',
    'Verstuurde berichten',
    'INBOX/Verstuurd',
    'INBOX/Verstuurde items',
    'INBOX/Verstuurde berichten',
    'Gesendet',
    'Gesendete Elemente',
    'Gesendete Objekte',
    'INBOX/Gesendet',
    'INBOX/Gesendete Elemente',
    'INBOX/Gesendete Objekte',
    '[Gmail]/Sent Mail',
  ],
  drafts: ['Drafts', 'Draft', 'Concepts', 'INBOX.Drafts', 'INBOX.Concepts', 'Concepten', 'INBOX/Concepten'],
  spam: ['Spam', 'Junk', 'Junk E-mail', 'INBOX.Spam', 'INBOX.Junk', 'INBOX/Spam', 'INBOX/Junk'],
  trash: ['Trash', 'Deleted', 'Deleted Items', 'Deleted Messages', 'Bin', 'INBOX.Trash', 'INBOX/Trash', 'Prullenbak', 'INBOX/Prullenbak'],
};

const FOLDER_SPECIAL_USES = {
  inbox: ['inbox'],
  sent: ['sent'],
  drafts: ['drafts'],
  spam: ['junk'],
  trash: ['trash'],
};

const FOLDER_LABELS = {
  inbox: 'Inbox',
  sent: 'Verzonden',
  drafts: 'Concepten',
  spam: 'Spam',
  trash: 'Prullenbak',
};

const SENT_LEAF_KEYS = new Set(
  FOLDER_ALIASES.sent
    .map((value) => normalizeMailboxKey(value).split('/').filter(Boolean).pop())
    .filter(Boolean)
);

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeMailboxKey(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/[\\/]+/g, '/')
    .replace(/\.+/g, '/')
    .replace(/\s+/g, ' ')
    .replace(/\/+/g, '/');
}

function getMailboxPath(box) {
  return normalizeString(box?.path || box?.name || '');
}

function normalizeSpecialUse(value) {
  return normalizeString(value).replace(/^\\/, '').toLowerCase();
}

function getMailboxSpecialUses(box) {
  const values = [];
  if (box?.specialUse) values.push(box.specialUse);
  const flags = box?.flags;
  if (Array.isArray(flags)) {
    values.push(...flags);
  } else if (flags && typeof flags[Symbol.iterator] === 'function') {
    values.push(...Array.from(flags));
  }
  return values.map(normalizeSpecialUse).filter(Boolean);
}

function isLikelySentMailboxName(name) {
  const key = normalizeMailboxKey(name);
  const parts = key.split('/').filter(Boolean);
  const leaf = parts.pop() || key;
  if (!leaf || !SENT_LEAF_KEYS.has(leaf)) return false;
  return !/(draft|concept|spam|junk|trash|prullenbak|deleted|bin)/i.test(key);
}

async function resolveMailboxName(client, folder) {
  const candidates = FOLDER_ALIASES[folder] || ['INBOX'];
  const boxes = typeof client.list === 'function' ? await client.list() : [];
  const items = Array.isArray(boxes) ? boxes : [];
  const names = items.map(getMailboxPath).filter(Boolean);
  const specialUses = FOLDER_SPECIAL_USES[folder] || [];

  if (specialUses.length) {
    const specialUseHit = items.find((box) => {
      const values = getMailboxSpecialUses(box);
      return values.some((value) => specialUses.includes(value));
    });
    const specialUsePath = getMailboxPath(specialUseHit);
    if (specialUsePath) return specialUsePath;
  }

  const candidateKeys = new Set(candidates.map(normalizeMailboxKey).filter(Boolean));
  for (const candidate of candidates) {
    const candidateKey = normalizeMailboxKey(candidate);
    const hit = names.find((name) => normalizeMailboxKey(name) === candidateKey);
    if (hit) return hit;
  }

  const candidateLeafKeys = new Set(
    candidates
      .map((candidate) => normalizeMailboxKey(candidate).split('/').filter(Boolean).pop())
      .filter(Boolean)
  );
  const leafHit = names.find((name) => {
    const key = normalizeMailboxKey(name);
    const leaf = key.split('/').filter(Boolean).pop();
    return folder !== 'inbox' && leaf && candidateLeafKeys.has(leaf);
  });
  if (leafHit) return leafHit;

  if (folder === 'sent') {
    const fuzzySentHit = names.find(isLikelySentMailboxName);
    if (fuzzySentHit) return fuzzySentHit;
  }

  return folder === 'inbox' ? candidates[0] : null;
}

function publicListErrorMessage(error, folder) {
  const message = String(error?.message || '');
  if (/command failed/i.test(message)) {
    const label = FOLDER_LABELS[folder] || 'Mailboxmap';
    return `${label} kon niet worden geopend. Controleer of deze map bestaat voor dit account.`;
  }
  return message || 'Onbekende fout';
}

async function buildRawMessage(nodemailer, mail) {
  const streamTransport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: 'windows',
  });
  const info = await streamTransport.sendMail(mail);
  const raw = info && info.message ? info.message : null;
  if (!raw) return null;
  const source = Buffer.isBuffer(raw) ? raw.toString('latin1') : Buffer.from(String(raw)).toString('latin1');
  return Buffer.from(source.replace(/\r\n|\r|\n/g, '\r\n'), 'latin1');
}

function normalizeComparableMailText(value) {
  return String(value || '').replace(/\r\n?|\n/g, '\n').trimEnd();
}

function buildSentCopyIntegrityError(message) {
  const error = new Error(message);
  error.code = 'MAILBOX_SENT_COPY_INTEGRITY_FAILED';
  return error;
}

function assertRawTransportShape(raw) {
  const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw || '');
  const source = buffer.toString('latin1');
  if (/(^|[^\r])\n/.test(source) || /\r(?!\n)/.test(source)) {
    throw buildSentCopyIntegrityError('MIME-bericht bevat ongeldige niet-CRLF-regelafbrekingen.');
  }
  if (!source.includes('\r\n\r\n')) {
    throw buildSentCopyIntegrityError('MIME-bericht mist de scheiding tussen headers en body.');
  }
  if (source.split('\r\n').some((line) => Buffer.byteLength(line, 'latin1') > 998)) {
    throw buildSentCopyIntegrityError('MIME-bericht bevat een te lange fysieke regel.');
  }
  for (const match of source.matchAll(/^Content-Transfer-Encoding:\s*([^\r\n]+)/gim)) {
    const encoding = String(match[1] || '').trim().toLowerCase();
    if (!['7bit', '8bit', 'binary', 'base64', 'quoted-printable'].includes(encoding)) {
      throw buildSentCopyIntegrityError('MIME-bericht bevat een onbekende transfer-encoding.');
    }
  }
}

function normalizeEmailAddress(value) {
  const source = String(value || '').trim().toLowerCase();
  const match = source.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i);
  return match ? match[0] : '';
}

function expectedAddressList(value) {
  const values = Array.isArray(value) ? value : [value];
  const addresses = [];
  const visit = (item) => {
    if (!item) return;
    if (Array.isArray(item)) return item.forEach(visit);
    if (typeof item === 'object') {
      if (Array.isArray(item.value)) return item.value.forEach(visit);
      const address = normalizeEmailAddress(item.address || item.email);
      if (address) addresses.push(address);
      return;
    }
    const matches = String(item).match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi) || [];
    matches.forEach((address) => addresses.push(address.toLowerCase()));
  };
  values.forEach(visit);
  return addresses;
}

function parsedAddressList(value) {
  if (typeof value === 'string') return expectedAddressList(value);
  const items = Array.isArray(value && value.value) ? value.value : Array.isArray(value) ? value : [];
  return items.map((item) => normalizeEmailAddress(item && item.address)).filter(Boolean);
}

function expectedAddressName(value) {
  const first = Array.isArray(value) ? value[0] : value;
  if (first && typeof first === 'object') return String(first.name || '').trim();
  const match = String(first || '').match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return match ? match[1].trim() : '';
}

function assertAddressIntegrity(actual, expected, label, options = {}) {
  if (expected === undefined || expected === null || expected === '') return;
  const expectedAddresses = expectedAddressList(expected);
  const actualAddresses = parsedAddressList(actual);
  if (
    expectedAddresses.length !== actualAddresses.length ||
    expectedAddresses.some((address, index) => address !== actualAddresses[index])
  ) {
    throw buildSentCopyIntegrityError(`${label} veranderde tijdens MIME-opbouw.`);
  }
  if (options.compareName && expectedAddresses.length === 1) {
    const expectedName = expectedAddressName(expected);
    const actualName = String(actual && actual.value && actual.value[0] && actual.value[0].name || '').trim();
    if (expectedName && expectedName !== actualName) {
      throw buildSentCopyIntegrityError(`${label}-naam veranderde tijdens MIME-opbouw.`);
    }
  }
}

function normalizeMessageId(value) {
  return String(value || '').trim().replace(/^<|>$/g, '');
}

function normalizeAttachmentContentType(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

function normalizeAttachmentDisposition(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeAttachmentCid(value) {
  return String(value || '').trim().replace(/^<|>$/g, '');
}

function expectedAttachmentContent(attachment) {
  if (!attachment || attachment.content === undefined || attachment.content === null) return null;
  if (Buffer.isBuffer(attachment.content)) return attachment.content;
  if (attachment.content instanceof Uint8Array) return Buffer.from(attachment.content);
  if (typeof attachment.content === 'string') {
    return Buffer.from(attachment.content, attachment.encoding || 'utf8');
  }
  return null;
}

async function assertRawMessageIntegrity(raw, mail = {}) {
  assertRawTransportShape(raw);
  const parsed = await simpleParser(raw);
  assertAddressIntegrity(parsed.from, mail.from, 'From', { compareName: true });
  assertAddressIntegrity(parsed.to, mail.to, 'To');
  assertAddressIntegrity(parsed.cc, mail.cc, 'Cc');
  assertAddressIntegrity(parsed.replyTo, mail.replyTo, 'Reply-To');
  const parsedSender = parsed.sender || (parsed.headers && parsed.headers.get('sender'));
  assertAddressIntegrity(parsedSender, mail.sender, 'Sender', { compareName: true });
  if (
    mail.messageId &&
    normalizeMessageId(parsed.messageId) !== normalizeMessageId(mail.messageId)
  ) {
    throw buildSentCopyIntegrityError('Message-ID veranderde tijdens MIME-opbouw.');
  }
  if (normalizeComparableMailText(parsed.subject) !== normalizeComparableMailText(mail.subject)) {
    throw buildSentCopyIntegrityError('Onderwerp veranderde tijdens MIME-opbouw.');
  }
  if (
    Object.prototype.hasOwnProperty.call(mail, 'text') &&
    normalizeComparableMailText(parsed.text) !== normalizeComparableMailText(mail.text)
  ) {
    throw buildSentCopyIntegrityError('Platte mailtekst veranderde tijdens MIME-opbouw.');
  }
  if (
    mail.html &&
    normalizeComparableMailText(parsed.html) !== normalizeComparableMailText(mail.html)
  ) {
    throw buildSentCopyIntegrityError('HTML-mailtekst veranderde tijdens MIME-opbouw.');
  }

  const expectedAttachments = Array.isArray(mail.attachments) ? mail.attachments : [];
  const parsedAttachments = Array.isArray(parsed.attachments) ? parsed.attachments : [];
  if (parsedAttachments.length !== expectedAttachments.length) {
    throw buildSentCopyIntegrityError('Aantal bijlagen veranderde tijdens MIME-opbouw.');
  }
  expectedAttachments.forEach((expected, index) => {
    const actual = parsedAttachments[index];
    if (String(actual && actual.filename || '') !== String(expected && expected.filename || '')) {
      throw buildSentCopyIntegrityError('Bijlagenaam veranderde tijdens MIME-opbouw.');
    }
    const expectedContentType = normalizeAttachmentContentType(expected && expected.contentType);
    if (
      expectedContentType &&
      normalizeAttachmentContentType(actual && actual.contentType) !== expectedContentType
    ) {
      throw buildSentCopyIntegrityError('Bijlage-contenttype veranderde tijdens MIME-opbouw.');
    }
    const expectedDisposition = normalizeAttachmentDisposition(
      expected && (expected.contentDisposition || (expected.cid ? 'inline' : 'attachment'))
    );
    if (
      expectedDisposition &&
      normalizeAttachmentDisposition(actual && actual.contentDisposition) !== expectedDisposition
    ) {
      throw buildSentCopyIntegrityError('Bijlage-dispositie veranderde tijdens MIME-opbouw.');
    }
    if (
      normalizeAttachmentCid(actual && actual.cid) !== normalizeAttachmentCid(expected && expected.cid)
    ) {
      throw buildSentCopyIntegrityError('Bijlage-CID veranderde tijdens MIME-opbouw.');
    }
    const expectedContent = expectedAttachmentContent(expected);
    if (
      expectedContent &&
      (!Buffer.isBuffer(actual && actual.content) || !actual.content.equals(expectedContent))
    ) {
      throw buildSentCopyIntegrityError('Bijlage-inhoud veranderde tijdens MIME-opbouw.');
    }
  });
  return parsed;
}

function canAppendSentCopy(account) {
  return Boolean(account && account.imapHost && account.imapUser && account.imapPass);
}

function providerAlreadyStoresSentCopy(account) {
  const domain = normalizeEmailAddress(account && (account.email || account.imapUser)).split('@').pop() || '';
  return domain === 'gmail.com' || domain === 'googlemail.com';
}

async function appendSentMessage(options = {}) {
  const {
    account,
    createImapClient,
    nodemailer,
    mail,
    messageId = '',
    sentAt = new Date(),
    logger = console,
  } = options;
  if (
    !canAppendSentCopy(account) ||
    providerAlreadyStoresSentCopy(account) ||
    typeof createImapClient !== 'function' ||
    !nodemailer ||
    !mail
  ) return false;

  const client = createImapClient({
    host: account.imapHost,
    port: Number(account.imapPort) || 993,
    secure: account.imapSecure !== false,
    auth: {
      user: account.imapUser,
      pass: account.imapPass,
    },
    logger: false,
  });

  try {
    if (typeof client.connect !== 'function' || typeof client.append !== 'function') return false;
    await client.connect();
    const mailboxName = (await resolveMailboxName(client, 'sent')) || 'Sent';
    const sentCopyMail = {
      ...mail,
      messageId: messageId || mail.messageId || undefined,
      date: mail.date || sentAt,
    };
    const raw = await buildRawMessage(nodemailer, sentCopyMail);
    if (!raw) return false;
    await assertRawMessageIntegrity(raw, sentCopyMail);
    await client.append(mailboxName, raw, ['\\Seen'], sentAt instanceof Date ? sentAt : new Date(sentAt));
    return true;
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn('[MailboxSentCopy][append]', {
        code: String(error && error.code || 'MAILBOX_SENT_COPY_FAILED'),
        message: String(error && error.message || 'Verzonden-kopie kon niet veilig worden opgeslagen.'),
      });
    }
    return false;
  } finally {
    try {
      if (client.usable && typeof client.logout === 'function') await client.logout();
    } catch (_) {}
  }
}

module.exports = {
  FOLDER_ALIASES,
  FOLDER_LABELS,
  appendSentMessage,
  assertRawMessageIntegrity,
  normalizeMailboxKey,
  publicListErrorMessage,
  resolveMailboxName,
};
