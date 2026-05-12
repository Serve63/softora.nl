const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const DEFAULT_MAILBOX_EMAILS = [
  'info@softora.nl',
  'zakelijk@softora.nl',
  'ruben@softora.nl',
  'serve@softora.nl',
  'martijn@softora.nl',
];

const FOLDER_ALIASES = {
  inbox: ['INBOX'],
  sent: [
    'Sent',
    'Sent Items',
    'Sent Mail',
    'Sent Messages',
    'INBOX.Sent',
    'INBOX.Sent Items',
    'INBOX.Sent Mail',
    'INBOX.Sent Messages',
    'Verzonden',
    'Verzonden items',
    'Verzonden berichten',
  ],
  drafts: ['Drafts', 'Draft', 'Concepts', 'INBOX.Drafts', 'INBOX.Concepts', 'Concepten'],
  spam: ['Spam', 'Junk', 'Junk E-mail', 'INBOX.Spam', 'INBOX.Junk'],
  trash: ['Trash', 'Deleted', 'Deleted Items', 'Deleted Messages', 'Bin', 'INBOX.Trash', 'Prullenbak'],
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

function createMailboxService(deps = {}) {
  const {
    logger = console,
    mailConfig = {},
    mailboxAccountsRaw = '',
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    createTransport = (config) => nodemailer.createTransport(config),
    createImapClient = (config) => new ImapFlow(config),
    parseMailSource = (source) => simpleParser(source),
  } = deps;

  const baseAccount = {
    email: normalizeString(mailConfig.mailFromAddress || mailConfig.smtpUser || mailConfig.imapUser).toLowerCase(),
    name: normalizeString(mailConfig.mailFromName || 'Softora'),
    smtpHost: normalizeString(mailConfig.smtpHost),
    smtpPort: Number(mailConfig.smtpPort) || 587,
    smtpSecure: Boolean(mailConfig.smtpSecure),
    smtpUser: normalizeString(mailConfig.smtpUser),
    smtpPass: normalizeString(mailConfig.smtpPass),
    imapHost: normalizeString(mailConfig.imapHost),
    imapPort: Number(mailConfig.imapPort) || 993,
    imapSecure: Boolean(mailConfig.imapSecure),
    imapUser: normalizeString(mailConfig.imapUser),
    imapPass: normalizeString(mailConfig.imapPass),
  };

  function normalizeEmail(value) {
    return normalizeString(value).toLowerCase();
  }

  function isValidEmail(value) {
    const email = normalizeEmail(value);
    return Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  }

  function envKeyForEmail(email) {
    return normalizeEmail(email)
      .split('@')[0]
      .replace(/[^a-z0-9]+/g, '_')
      .toUpperCase();
  }

  function envKeyForDomain(email) {
    return normalizeEmail(email)
      .split('@')
      .slice(1)
      .join('@')
      .replace(/[^a-z0-9]+/g, '_')
      .toUpperCase();
  }

  function readBooleanEnv(value) {
    const normalized = normalizeString(value);
    if (!normalized) return null;
    if (/^(1|true|yes)$/i.test(normalized)) return true;
    if (/^(0|false|no)$/i.test(normalized)) return false;
    return null;
  }

  function readPortEnv(value) {
    const port = Number(value || 0);
    return Number.isFinite(port) && port > 0 ? port : 0;
  }

  function readJsonAccounts(raw) {
    const value = normalizeString(raw);
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [];
    } catch (_) {
      return value
        .split(/[\s,;]+/)
        .map((email) => ({ email: normalizeEmail(email) }))
        .filter((item) => item.email);
    }
  }

  function envAccountForEmail(email) {
    const key = envKeyForEmail(email);
    const env = process.env || {};
    const sharedUser = normalizeString(env[`MAILBOX_${key}_USER`] || '');
    const sharedPass = normalizeString(env[`MAILBOX_${key}_PASS`] || '');
    return {
      email,
      name: normalizeString(env[`MAILBOX_${key}_NAME`] || ''),
      smtpHost: normalizeString(env[`MAILBOX_${key}_SMTP_HOST`] || ''),
      smtpPort: readPortEnv(env[`MAILBOX_${key}_SMTP_PORT`]),
      smtpSecure: readBooleanEnv(env[`MAILBOX_${key}_SMTP_SECURE`]),
      smtpUser: normalizeString(env[`MAILBOX_${key}_SMTP_USER`] || sharedUser),
      smtpPass: normalizeString(env[`MAILBOX_${key}_SMTP_PASS`] || sharedPass),
      imapHost: normalizeString(env[`MAILBOX_${key}_IMAP_HOST`] || ''),
      imapPort: readPortEnv(env[`MAILBOX_${key}_IMAP_PORT`]),
      imapSecure: readBooleanEnv(env[`MAILBOX_${key}_IMAP_SECURE`]),
      imapUser: normalizeString(env[`MAILBOX_${key}_IMAP_USER`] || sharedUser),
      imapPass: normalizeString(env[`MAILBOX_${key}_IMAP_PASS`] || sharedPass),
      useBaseCredentials: readBooleanEnv(env[`MAILBOX_${key}_USE_BASE_CREDENTIALS`]) === true,
    };
  }

  function envAccountForDomain(email) {
    const key = envKeyForDomain(email);
    if (!key) return {};
    const env = process.env || {};
    const sharedUser = normalizeString(env[`MAILBOX_${key}_USER`] || '');
    const sharedPass = normalizeString(env[`MAILBOX_${key}_PASS`] || '');
    return {
      name: normalizeString(env[`MAILBOX_${key}_NAME`] || ''),
      smtpHost: normalizeString(env[`MAILBOX_${key}_SMTP_HOST`] || ''),
      smtpPort: readPortEnv(env[`MAILBOX_${key}_SMTP_PORT`]),
      smtpSecure: readBooleanEnv(env[`MAILBOX_${key}_SMTP_SECURE`]),
      smtpUser: normalizeString(env[`MAILBOX_${key}_SMTP_USER`] || sharedUser),
      smtpPass: normalizeString(env[`MAILBOX_${key}_SMTP_PASS`] || sharedPass),
      imapHost: normalizeString(env[`MAILBOX_${key}_IMAP_HOST`] || ''),
      imapPort: readPortEnv(env[`MAILBOX_${key}_IMAP_PORT`]),
      imapSecure: readBooleanEnv(env[`MAILBOX_${key}_IMAP_SECURE`]),
      imapUser: normalizeString(env[`MAILBOX_${key}_IMAP_USER`] || sharedUser),
      imapPass: normalizeString(env[`MAILBOX_${key}_IMAP_PASS`] || sharedPass),
      useBaseCredentials: readBooleanEnv(env[`MAILBOX_${key}_USE_BASE_CREDENTIALS`]) === true,
    };
  }

  function deriveImapHostFromSmtpHost(value) {
    const host = normalizeString(value);
    if (!host) return '';
    if (/strato/i.test(host)) return 'imap.strato.com';
    if (/^smtp\./i.test(host)) return host.replace(/^smtp\./i, 'imap.');
    return '';
  }

  function buildAccounts() {
    const fromJson = readJsonAccounts(mailboxAccountsRaw);
    const emails = Array.from(
      new Set([
        ...DEFAULT_MAILBOX_EMAILS,
        baseAccount.email,
        ...fromJson.map((item) => normalizeEmail(item.email || item.address)),
      ].filter(Boolean))
    );

    return emails.map((email) => {
      const json = fromJson.find((item) => normalizeEmail(item.email || item.address) === email) || {};
      const envAccount = envAccountForEmail(email);
      const envDomain = envAccountForDomain(email);
      const useBase = email === baseAccount.email || email === normalizeEmail(baseAccount.smtpUser) || email === normalizeEmail(baseAccount.imapUser);
      const useBaseCredentials = useBase || envAccount.useBaseCredentials || envDomain.useBaseCredentials;
      const smtpHost = normalizeString(
        json.smtpHost || envAccount.smtpHost || envDomain.smtpHost || baseAccount.smtpHost
      );
      const smtpUser = normalizeString(
        json.smtpUser ||
          envAccount.smtpUser ||
          envDomain.smtpUser ||
          (useBaseCredentials ? baseAccount.smtpUser : '') ||
          email
      );
      const smtpPass = normalizeString(
        json.smtpPass ||
          envAccount.smtpPass ||
          envDomain.smtpPass ||
          (useBaseCredentials ? baseAccount.smtpPass : '')
      );
      const imapHost = normalizeString(
        json.imapHost ||
          envAccount.imapHost ||
          envDomain.imapHost ||
          baseAccount.imapHost ||
          deriveImapHostFromSmtpHost(smtpHost)
      );
      const smtpPort = Number(json.smtpPort || envAccount.smtpPort || envDomain.smtpPort || baseAccount.smtpPort || 587) || 587;
      const imapPort = Number(json.imapPort || envAccount.imapPort || envDomain.imapPort || baseAccount.imapPort || 993) || 993;
      const account = {
        email,
        name: normalizeString(json.name || envAccount.name || envDomain.name || (useBase ? baseAccount.name : '')) || email,
        smtpHost,
        smtpPort,
        smtpSecure:
          json.smtpSecure !== undefined
            ? Boolean(json.smtpSecure)
            : typeof envAccount.smtpSecure === 'boolean'
              ? Boolean(envAccount.smtpSecure)
              : typeof envDomain.smtpSecure === 'boolean'
                ? Boolean(envDomain.smtpSecure)
                : Boolean(baseAccount.smtpSecure),
        smtpUser,
        smtpPass,
        imapHost,
        imapPort,
        imapSecure:
          json.imapSecure !== undefined
            ? Boolean(json.imapSecure)
            : typeof envAccount.imapSecure === 'boolean'
              ? Boolean(envAccount.imapSecure)
              : typeof envDomain.imapSecure === 'boolean'
                ? Boolean(envDomain.imapSecure)
                : Boolean(baseAccount.imapSecure || imapPort === 993),
        imapUser: normalizeString(
          json.imapUser ||
            envAccount.imapUser ||
            envDomain.imapUser ||
            (useBaseCredentials ? baseAccount.imapUser : '') ||
            smtpUser ||
            email
        ),
        imapPass: normalizeString(
          json.imapPass ||
            envAccount.imapPass ||
            envDomain.imapPass ||
            (useBaseCredentials ? baseAccount.imapPass : '') ||
            smtpPass
        ),
      };
      account.imapConfigured = Boolean(account.imapHost && account.imapUser && account.imapPass);
      account.smtpConfigured = Boolean(account.smtpHost && account.smtpUser && account.smtpPass);
      return account;
    });
  }

  function getAccounts() {
    return buildAccounts();
  }

  function getAccount(email) {
    return getAccounts().find((account) => account.email === normalizeEmail(email)) || null;
  }

  function createClient(account) {
    return createImapClient({
      host: account.imapHost,
      port: account.imapPort,
      secure: account.imapSecure,
      auth: {
        user: account.imapUser,
        pass: account.imapPass,
      },
      logger: false,
    });
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

  async function resolveMailboxName(client, folder) {
    const candidates = FOLDER_ALIASES[folder] || ['INBOX'];
    const boxes = await client.list();
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
    const leafHit = names.find((name) => {
      const key = normalizeMailboxKey(name);
      const leaf = key.split('/').filter(Boolean).pop();
      return folder !== 'inbox' && leaf && candidateKeys.has(leaf);
    });
    if (leafHit) return leafHit;
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

  function addressText(address) {
    if (!address) return '';
    const list = Array.isArray(address) ? address : [address];
    return list
      .map((item) => item?.address || item?.name || '')
      .filter(Boolean)
      .join(', ');
  }

  function displayName(address) {
    const first = Array.isArray(address) ? address[0] : address;
    return normalizeString(first?.name || first?.address || '') || 'Onbekend';
  }

  function toClientMessage(parsed, message, folder, account) {
    const date = parsed.date || message.internalDate || new Date();
    const text = normalizeString(parsed.text || parsed.html || '');
    const preview = truncateText(text.replace(/\s+/g, ' '), 140);
    const fromText = folder === 'sent' ? account.name || account.email : displayName(parsed.from?.value);
    return {
      id: `${folder}:${message.uid}`,
      uid: message.uid,
      folder,
      from: fromText,
      email: folder === 'sent' ? account.email : addressText(parsed.from?.value),
      to: addressText(parsed.to?.value),
      subject: normalizeString(parsed.subject || '(Geen onderwerp)'),
      preview,
      body: text || preview,
      date: date.toISOString(),
      unread: !Array.from(message.flags || []).includes('\\Seen'),
      starred: Array.from(message.flags || []).includes('\\Flagged'),
    };
  }

  async function listMessages({ accountEmail, folder = 'inbox', limit = 50 }) {
    const account = getAccount(accountEmail);
    if (!account) {
      const error = new Error('Mailbox-account niet gevonden.');
      error.status = 404;
      throw error;
    }
    if (!account.imapConfigured) {
      const error = new Error('IMAP is niet geconfigureerd voor deze mailbox.');
      error.status = 503;
      throw error;
    }

    const client = createClient(account);
    try {
      await client.connect();
      const mailboxName = await resolveMailboxName(client, folder);
      if (!mailboxName) return [];
      const lock = await client.getMailboxLock(mailboxName);
      try {
        const allUids = await client.search(['ALL']);
        const uids = (Array.isArray(allUids) ? allUids : []).slice(-Math.max(1, Math.min(100, Number(limit) || 50))).reverse();
        if (!uids.length) return [];
        const messages = [];
        for await (const message of client.fetch(uids, { uid: true, flags: true, internalDate: true, source: true })) {
          const parsed = await parseMailSource(message.source);
          messages.push(toClientMessage(parsed, message, folder, account));
        }
        return messages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      } finally {
        lock.release();
      }
    } finally {
      try {
        if (client.usable) await client.logout();
      } catch (_) {}
    }
  }

  async function sendMessage({ accountEmail, to, subject, text }) {
    const account = getAccount(accountEmail);
    if (!account) {
      const error = new Error('Mailbox-account niet gevonden.');
      error.status = 404;
      throw error;
    }
    if (!account.smtpConfigured) {
      const error = new Error('SMTP is niet geconfigureerd voor deze mailbox.');
      error.status = 503;
      throw error;
    }
    if (!isValidEmail(to)) {
      const error = new Error('Vul een geldig e-mailadres in.');
      error.status = 400;
      throw error;
    }
    const cleanSubject = truncateText(normalizeString(subject), 240);
    if (!cleanSubject) {
      const error = new Error('Onderwerp is verplicht.');
      error.status = 400;
      throw error;
    }
    const transporter = createTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure,
      auth: { user: account.smtpUser, pass: account.smtpPass },
    });
    const info = await transporter.sendMail({
      from: account.name ? `${account.name} <${account.email}>` : account.email,
      to: normalizeEmail(to),
      subject: cleanSubject,
      text: normalizeString(text),
    });
    return {
      messageId: normalizeString(info?.messageId || ''),
      accepted: Array.isArray(info?.accepted) ? info.accepted : [],
      rejected: Array.isArray(info?.rejected) ? info.rejected : [],
    };
  }

  async function accountsResponse(_req, res) {
    return res.status(200).json({
      ok: true,
      accounts: getAccounts().map((account) => ({
        email: account.email,
        name: account.name,
        imapConfigured: account.imapConfigured,
        smtpConfigured: account.smtpConfigured,
      })),
    });
  }

  async function listMessagesResponse(req, res) {
    try {
      const messages = await listMessages({
        accountEmail: req.query?.account,
        folder: normalizeString(req.query?.folder || 'inbox').toLowerCase(),
        limit: Number(req.query?.limit || 50) || 50,
      });
      return res.status(200).json({ ok: true, messages });
    } catch (error) {
      logger.error('[Mailbox][List]', error?.message || error);
      const folder = normalizeString(req.query?.folder || 'inbox').toLowerCase();
      return res.status(error.status || 500).json({
        ok: false,
        error: 'Mailbox laden mislukt',
        detail: publicListErrorMessage(error, folder),
      });
    }
  }

  async function sendMessageResponse(req, res) {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await sendMessage({
        accountEmail: body.account,
        to: body.to,
        subject: body.subject,
        text: body.body || body.text || '',
      });
      return res.status(200).json({ ok: true, result });
    } catch (error) {
      logger.error('[Mailbox][Send]', error?.message || error);
      return res.status(error.status || 500).json({
        ok: false,
        error: 'Mail verzenden mislukt',
        detail: String(error?.message || 'Onbekende fout'),
      });
    }
  }

  return {
    accountsResponse,
    listMessagesResponse,
    sendMessageResponse,
    getAccounts,
    listMessages,
    sendMessage,
  };
}

module.exports = {
  createMailboxService,
};
