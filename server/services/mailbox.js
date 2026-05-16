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
const DEFAULT_OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MAILBOX_DRAFT_MODEL = 'gpt-5.5-pro';

const FOLDER_ALIASES = {
  inbox: ['INBOX'],
  starred: ['INBOX'],
  important: ['INBOX'],
  promotions: ['Promotions', 'INBOX.Promotions', 'Reclame', 'Reclamefolder', 'Bulk Mail'],
  reclame: ['Promotions', 'INBOX.Promotions', 'Reclame', 'Reclamefolder', 'Bulk Mail'],
  sent: ['Sent', 'Sent Items', 'INBOX.Sent', 'Verzonden', 'Verzonden items'],
  drafts: ['Drafts', 'Concepts', 'INBOX.Drafts', 'Concepten'],
  spam: ['Spam', 'Junk', 'INBOX.Spam', 'INBOX.Junk'],
  trash: ['Trash', 'Deleted Items', 'INBOX.Trash', 'Prullenbak'],
};

async function defaultFetchJsonWithTimeout(url, options = {}, timeoutMs = 65000) {
  if (typeof fetch !== 'function') {
    const error = new Error('Fetch API is niet beschikbaar.');
    error.status = 500;
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  } finally {
    clearTimeout(timer);
  }
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
    getOpenAiApiKey = () => normalizeString(process.env.OPENAI_API_KEY || ''),
    fetchJsonWithTimeout = defaultFetchJsonWithTimeout,
    extractOpenAiTextContent = null,
    openAiApiBaseUrl = process.env.OPENAI_API_BASE_URL || DEFAULT_OPENAI_API_BASE_URL,
    mailboxDraftModel = process.env.MAILBOX_DRAFT_OPENAI_MODEL || process.env.OPENAI_MODEL || DEFAULT_MAILBOX_DRAFT_MODEL,
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

  async function resolveMailboxName(client, folder) {
    const candidates = FOLDER_ALIASES[folder] || ['INBOX'];
    const boxes = await client.list();
    const names = Array.isArray(boxes) ? boxes.map((box) => box.path || box.name).filter(Boolean) : [];
    for (const candidate of candidates) {
      const hit = names.find((name) => normalizeString(name).toLowerCase() === candidate.toLowerCase());
      if (hit) return hit;
    }
    if (folder !== 'inbox') return '';
    return candidates[0];
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

  function extractOpenAiReplyText(content) {
    if (typeof extractOpenAiTextContent === 'function') {
      return normalizeString(extractOpenAiTextContent(content));
    }
    if (typeof content === 'string') return normalizeString(content);
    if (!Array.isArray(content)) return '';
    return normalizeString(
      content
        .map((item) => {
          if (!item) return '';
          if (typeof item === 'string') return item;
          return typeof item.text === 'string' ? item.text : '';
        })
        .join('\n')
    );
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
    const requestedFolder = normalizeString(folder || 'inbox').toLowerCase();
    const mailboxFolder = requestedFolder === 'starred' || requestedFolder === 'important' ? 'inbox' : requestedFolder;
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
      const mailboxName = await resolveMailboxName(client, mailboxFolder);
      if (!mailboxName) return [];
      const lock = await client.getMailboxLock(mailboxName);
      try {
        const allUids = await client.search(['ALL']);
        const uids = (Array.isArray(allUids) ? allUids : []).slice(-Math.max(1, Math.min(100, Number(limit) || 50))).reverse();
        if (!uids.length) return [];
        const messages = [];
        for await (const message of client.fetch(uids, { uid: true, flags: true, internalDate: true, source: true })) {
          const parsed = await parseMailSource(message.source);
          messages.push(toClientMessage(parsed, message, requestedFolder, account));
        }
        const visibleMessages = requestedFolder === 'starred' || requestedFolder === 'important'
          ? messages.filter((item) => item.starred)
          : messages;
        return visibleMessages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
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

  async function improveDraft({ accountEmail, to, subject, text, context = {} }) {
    const account = getAccount(accountEmail);
    if (!account) {
      const error = new Error('Mailbox-account niet gevonden.');
      error.status = 404;
      throw error;
    }
    const cleanText = truncateText(normalizeString(text), 6000);
    if (!cleanText) {
      const error = new Error('Schrijf eerst een antwoord voordat AI het kan verbeteren.');
      error.status = 400;
      throw error;
    }
    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      const error = new Error('OPENAI_API_KEY ontbreekt');
      error.status = 503;
      error.code = 'OPENAI_NOT_CONFIGURED';
      throw error;
    }

    const model = normalizeString(mailboxDraftModel) || DEFAULT_MAILBOX_DRAFT_MODEL;
    const system = [
      'Je bent een Nederlandstalige mail-assistent voor Softora.',
      'Verbeter de conceptmail van de gebruiker op spelling, toon, structuur en professionaliteit.',
      'Gebruik de context van de originele mail om de reactie logisch en relevant te maken.',
      'Behoud de bedoeling van de gebruiker. Voeg geen harde beloftes, prijzen, afspraken of feiten toe die niet in de context staan.',
      'Schrijf menselijk, duidelijk en zakelijk. Geen markdown, geen onderwerpregel, alleen de verbeterde mailtekst.',
    ].join('\n');
    const payload = {
      sender: {
        name: account.name || 'Softora',
        email: account.email,
      },
      reply: {
        to: normalizeString(to),
        subject: truncateText(normalizeString(subject), 240),
        draft: cleanText,
      },
      originalMail: {
        from: truncateText(normalizeString(context.from), 240),
        fromEmail: truncateText(normalizeString(context.fromEmail), 240),
        to: truncateText(normalizeString(context.to), 240),
        date: truncateText(normalizeString(context.date), 80),
        subject: truncateText(normalizeString(context.subject), 240),
        preview: truncateText(normalizeString(context.preview), 800),
        body: truncateText(normalizeString(context.body), 5000),
      },
    };

    const { response, data } = await fetchJsonWithTimeout(
      `${String(openAiApiBaseUrl || DEFAULT_OPENAI_API_BASE_URL).replace(/\/+$/, '')}/chat/completions`,
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
            { role: 'system', content: system },
            { role: 'user', content: JSON.stringify(payload) },
          ],
        }),
      },
      65000
    );
    if (!response.ok) {
      const error = new Error(`OpenAI mailboxtekst verbeteren mislukt (${response.status})`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    const improved = truncateText(
      extractOpenAiReplyText(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content),
      6000
    );
    if (!improved) {
      const error = new Error('OpenAI gaf geen verbeterde mailtekst terug.');
      error.status = 502;
      throw error;
    }
    return {
      text: improved,
      model: normalizeString(data && data.model) || model,
      usage: data && data.usage ? data.usage : null,
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
      return res.status(error.status || 500).json({
        ok: false,
        error: 'Mailbox laden mislukt',
        detail: String(error?.message || 'Onbekende fout'),
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

  async function improveDraftResponse(req, res) {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await improveDraft({
        accountEmail: body.account,
        to: body.to,
        subject: body.subject,
        text: body.body || body.text || '',
        context: body.context && typeof body.context === 'object' ? body.context : {},
      });
      return res.status(200).json({ ok: true, draft: result.text, result });
    } catch (error) {
      logger.error('[Mailbox][ImproveDraft]', error?.message || error);
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
    improveDraftResponse,
    getAccounts,
    listMessages,
    sendMessage,
    improveDraft,
  };
}

module.exports = {
  createMailboxService,
};
