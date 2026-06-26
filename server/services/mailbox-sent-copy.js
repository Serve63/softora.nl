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
  return Buffer.from(String(raw).replace(/\r\n|\r|\n/g, '\r\n'));
}

function canAppendSentCopy(account) {
  return Boolean(account && account.imapHost && account.imapUser && account.imapPass);
}

async function appendSentMessage(options = {}) {
  const {
    account,
    createImapClient,
    nodemailer,
    mail,
    messageId = '',
    sentAt = new Date(),
  } = options;
  if (!canAppendSentCopy(account) || typeof createImapClient !== 'function' || !nodemailer || !mail) return false;

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
    const raw = await buildRawMessage(nodemailer, {
      ...mail,
      messageId: messageId || mail.messageId || undefined,
      date: mail.date || sentAt,
    });
    if (!raw) return false;
    await client.append(mailboxName, raw, ['\\Seen'], sentAt instanceof Date ? sentAt : new Date(sentAt));
    return true;
  } catch (_) {
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
  normalizeMailboxKey,
  publicListErrorMessage,
  resolveMailboxName,
};
