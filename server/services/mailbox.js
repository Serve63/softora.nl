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
const MAILBOX_DISPLAY_NAMES = {
  'serve@softora.nl': 'Servé Creusen',
  'martijn@softora.nl': 'Martijn van de Ven',
};

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

const TRACKING_HOST_PATTERNS = [
  /(^|\.)sendgrid\.net$/i,
  /(^|\.)ct\.sendgrid\.net$/i,
  /(^|\.)mandrillapp\.com$/i,
  /(^|\.)list-manage\.com$/i,
  /(^|\.)mailchimp\.com$/i,
  /(^|\.)mailgun\.org$/i,
  /(^|\.)postmarkapp\.com$/i,
];

const IMAGE_ASSET_EXTENSIONS = /\.(?:apng|avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:[?#].*)?$/i;

function decodeBasicHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function htmlToReadableText(value) {
  return decodeBasicHtmlEntities(value)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<img\b[^>]*(?:width=["']?1["']?|height=["']?1["']?)[^>]*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|tr|li|h[1-6])>/gi, '\n')
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href, label) => {
      const text = htmlToReadableText(label).trim();
      const url = String(href || '').trim();
      if (!text) return url;
      if (!url || text === url) return text;
      return `${text} [${url}]`;
    })
    .replace(/<[^>]+>/g, ' ');
}

function safeUrl(value) {
  const raw = String(value || '')
    .trim()
    .replace(/^<|>$/g, '')
    .replace(/^\[|\]$/g, '')
    .replace(/^"|"$/g, '');
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    return new URL(raw);
  } catch (_) {
    return null;
  }
}

function isTrackingUrl(rawUrl) {
  const parsed = safeUrl(rawUrl);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (TRACKING_HOST_PATTERNS.some((pattern) => pattern.test(host))) return true;
  return /\/(?:wf\/open|open|click|ls\/click|track|tracking)\b/i.test(path);
}

function isStandaloneAssetUrl(rawUrl) {
  const parsed = safeUrl(rawUrl);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  const path = decodeURIComponent(parsed.pathname || '').toLowerCase();
  if (IMAGE_ASSET_EXTENSIONS.test(path)) return true;
  if (host === 'cdn.openai.com' && /(?:logo|asset|image|header)/i.test(path)) return true;
  return false;
}

function isTechnicalMailUrl(rawUrl, options = {}) {
  if (isTrackingUrl(rawUrl)) return true;
  return Boolean(options.standalone && isStandaloneAssetUrl(rawUrl));
}

function stripInlineTechnicalUrls(line) {
  return String(line || '')
    .replace(/\[(https?:\/\/[^\]\s]+)\]/gi, (match, url) => (isTechnicalMailUrl(url) ? '' : match))
    .replace(/<((?:https?:\/\/)[^>\s]+)>/gi, (match, url) => (isTechnicalMailUrl(url) ? '' : match))
    .replace(/\s{2,}/g, ' ')
    .trimEnd();
}

function isStandaloneTechnicalUrlLine(line) {
  const value = String(line || '').trim();
  if (!value) return false;
  const bracketed = value.match(/^\[(https?:\/\/[^\]]+)\]$/i);
  const angled = value.match(/^<(https?:\/\/[^>]+)>$/i);
  const bare = value.match(/^(https?:\/\/\S+)$/i);
  const url = bracketed?.[1] || angled?.[1] || bare?.[1] || '';
  return Boolean(url && isTechnicalMailUrl(url, { standalone: true }));
}

function sanitizeMailboxDisplayText(value) {
  const raw = String(value || '');
  const source = /<\/?[a-z][\s\S]*>/i.test(raw) ? htmlToReadableText(raw) : decodeBasicHtmlEntities(raw);
  const normalized = source
    .replace(/\r\n?/g, '\n')
    .replace(/\u200B/g, '')
    .split('\n')
    .map((line) => stripInlineTechnicalUrls(line))
    .filter((line) => !isStandaloneTechnicalUrlLine(line))
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return normalized;
}

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
    getOpenAiApiKey = () => '',
    openAiApiBaseUrl = 'https://api.openai.com/v1',
    openAiModel = 'gpt-5.5-pro',
    fetchJsonWithTimeout = async () => ({ response: { ok: false, status: 500 }, data: null }),
    extractOpenAiTextContent = (content) => {
      if (typeof content === 'string') return content;
      if (!Array.isArray(content)) return '';
      return content
        .map((part) => (typeof part === 'string' ? part : part?.text || part?.content || ''))
        .join('');
    },
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

  function getMailboxDisplayName(email, preferredName) {
    const address = normalizeEmail(email);
    const name = normalizeString(preferredName);
    const canonicalName = MAILBOX_DISPLAY_NAMES[address] || '';
    const shortName = address.split('@')[0] || '';
    if (canonicalName && (!name || name.toLowerCase() === shortName)) return canonicalName;
    return name || canonicalName || address;
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
        name: getMailboxDisplayName(email, json.name || envAccount.name || envDomain.name || (useBase ? baseAccount.name : '')),
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

  function normalizeFolder(value) {
    const folder = normalizeString(value).toLowerCase();
    return FOLDER_ALIASES[folder] ? folder : 'inbox';
  }

  function parseMessageReference(input = {}) {
    const rawId = normalizeString(input.id || input.messageId);
    let folder = normalizeFolder(input.folder);
    let uid = Number(input.uid || 0);
    if ((!Number.isFinite(uid) || uid <= 0) && rawId) {
      const match = rawId.match(/^([a-z]+):(\d+)$/i);
      if (match) {
        folder = normalizeFolder(match[1]);
        uid = Number(match[2]);
      }
    }
    if (!Number.isSafeInteger(uid) || uid <= 0) {
      const error = new Error('Mailboxbericht niet gevonden.');
      error.status = 400;
      throw error;
    }
    return { folder, uid };
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
    const text = sanitizeMailboxDisplayText(normalizeString(parsed.text || parsed.html || ''));
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

  async function markMessageRead({ accountEmail, id, folder, uid }) {
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
    const messageRef = parseMessageReference({ id, folder, uid });
    const client = createClient(account);
    try {
      await client.connect();
      const mailboxName = await resolveMailboxName(client, messageRef.folder);
      const lock = await client.getMailboxLock(mailboxName);
      try {
        await client.messageFlagsAdd([messageRef.uid], ['\\Seen'], { uid: true });
        return {
          account: account.email,
          folder: messageRef.folder,
          uid: messageRef.uid,
          unread: false,
        };
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

  function cleanPromptText(value, maxLength = 6000) {
    return truncateText(sanitizeMailboxDisplayText(normalizeString(value)), maxLength);
  }

  function normalizeSenderProfile(value) {
    const raw = value && typeof value === 'object' ? value : {};
    return {
      toneStyle: cleanPromptText(raw.toneStyle, 160),
      aiInstructions: cleanPromptText(raw.aiInstructions, 1800),
      signature: cleanPromptText(raw.signature, 1200),
      bodyTemplate: cleanPromptText(raw.body || raw.bodyTemplate, 4000),
    };
  }

  function buildRewritePromptPayload({ accountEmail, to, subject, body, context, senderProfile }) {
    const original = context && typeof context === 'object'
      ? {
          from: cleanPromptText(context.from, 240),
          email: cleanPromptText(context.email, 240),
          subject: cleanPromptText(context.subject, 240),
          preview: cleanPromptText(context.preview, 600),
          body: cleanPromptText(context.body, 6000),
          date: cleanPromptText(context.date, 120),
          time: cleanPromptText(context.time, 80),
          folder: cleanPromptText(context.folder, 80),
        }
      : null;

    return {
      mailbox: {
        accountEmail: normalizeEmail(accountEmail),
        to: cleanPromptText(to, 240),
        subject: cleanPromptText(subject, 240),
      },
      afzenderProfiel: normalizeSenderProfile(senderProfile),
      origineleMail: original,
      conceptAntwoord: cleanPromptText(body, 8000),
    };
  }

  async function rewriteDraft({ accountEmail, to, subject, body, context, senderProfile }) {
    const draft = cleanPromptText(body, 8000);
    if (!draft) {
      const error = new Error('Typ eerst je mailtekst.');
      error.status = 400;
      throw error;
    }

    const apiKey = normalizeString(typeof getOpenAiApiKey === 'function' ? getOpenAiApiKey() : '');
    if (!apiKey) {
      const error = new Error('OpenAI API-key ontbreekt.');
      error.status = 503;
      throw error;
    }

    const model = normalizeString(openAiModel) || 'gpt-5.5-pro';
    const systemPrompt = [
      'Je bent de mailherschrijver van Softora.',
      'Herschrijf alleen het conceptantwoord van de medewerker.',
      'Maak de tekst duidelijker, netter en professioneler, maar behoud exact de bedoeling.',
      'Gebruik de context van de originele mail om toon en inhoud passend te houden.',
      'Gebruik afzenderProfiel.aiInstructions en afzenderProfiel.toneStyle als persoonlijke schrijfinstructies van het geselecteerde afzenderadres.',
      'Als afzenderProfiel.signature of afzenderProfiel.bodyTemplate een afsluiting bevat, behoud die afzender/afsluiting en gebruik geen naam van een ander mailadres.',
      'Verzin geen feiten, beloftes, bedragen, datums, namen, afspraken, URLs of voorwaarden.',
      'Wijzig belangrijke gegevens niet.',
      'Maak het niet overdreven formeel als dat niet nodig is.',
      'Geef alleen de verbeterde mailtekst terug, zonder uitleg, markdown of extra analyse.',
    ].join('\n');

    const payload = buildRewritePromptPayload({ accountEmail, to, subject, body: draft, context, senderProfile });
    const baseUrl = normalizeString(openAiApiBaseUrl) || 'https://api.openai.com/v1';
    const { response, data } = await fetchJsonWithTimeout(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.25,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(payload) },
          ],
        }),
      },
      65000
    );

    if (!response.ok) {
      const error = new Error(`OpenAI mailtekst verbeteren mislukt (${response.status})`);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    const content = data?.choices?.[0]?.message?.content;
    const text = truncateText(normalizeString(extractOpenAiTextContent(content)), 8000);
    if (!text) {
      const error = new Error('OpenAI gaf geen verbeterde tekst terug.');
      error.status = 502;
      throw error;
    }

    return {
      text,
      model: normalizeString(data?.model || model) || model,
      usage: data?.usage || null,
      provider: 'openai',
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

  async function markMessageReadResponse(req, res) {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await markMessageRead({
        accountEmail: body.account,
        id: body.id || body.messageId,
        folder: body.folder,
        uid: body.uid,
      });
      return res.status(200).json({ ok: true, result });
    } catch (error) {
      logger.error('[Mailbox][Read]', error?.message || error);
      return res.status(error.status || 500).json({
        ok: false,
        error: 'Gelezen status opslaan mislukt',
        detail: String(error?.message || 'Onbekende fout'),
      });
    }
  }

  async function rewriteDraftResponse(req, res) {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await rewriteDraft({
        accountEmail: body.account,
        to: body.to,
        subject: body.subject,
        body: body.body || body.text || '',
        senderProfile: body.senderProfile,
        context: body.context,
      });
      return res.status(200).json({ ok: true, text: result.text, result });
    } catch (error) {
      logger.error('[Mailbox][Rewrite]', error?.message || error);
      return res.status(error.status || 500).json({
        ok: false,
        error: 'Mailtekst verbeteren mislukt',
        detail: String(error?.message || 'Onbekende fout'),
      });
    }
  }

  return {
    accountsResponse,
    listMessagesResponse,
    sendMessageResponse,
    markMessageReadResponse,
    rewriteDraftResponse,
    getAccounts,
    listMessages,
    markMessageRead,
    sendMessage,
    rewriteDraft,
  };
}

module.exports = {
  createMailboxService,
  sanitizeMailboxDisplayText,
};
