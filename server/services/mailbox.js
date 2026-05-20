const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const {
  appendSentMessage,
  publicListErrorMessage,
  resolveMailboxName,
} = require('./mailbox-sent-copy');
const { createMailboxIndexStore } = require('./mailbox-index-store');
const {
  normalizeMailboxAccountEmail,
  replaceLegacyMailboxEmail,
} = require('../config/mail-identity');

const DEFAULT_MAILBOX_EMAILS = [
  'info@softora.nl',
  'zakelijk@softora.nl',
  'ruben@softora.nl',
  'serve@softora.nl',
  'martijn@softora.nl',
];

const INDEX_STALE_MS = 2 * 60 * 1000;
const DEFAULT_SYNC_FOLDERS = ['inbox', 'sent'];
const DEFAULT_SYNC_LIMIT = 50;

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
    afterSync = null,
    isSupabaseConfigured = () => false,
    getSupabaseClient = () => null,
    mailboxIndexStore = createMailboxIndexStore({
      isSupabaseConfigured,
      getSupabaseClient,
      logger,
      normalizeString,
      truncateText,
    }),
    mailboxIndexStaleMs = INDEX_STALE_MS,
  } = deps;

  const baseAccount = {
    email: normalizeMailboxAccountEmail(
      normalizeString(mailConfig.mailFromAddress || mailConfig.smtpUser || mailConfig.imapUser)
    ),
    name: normalizeString(mailConfig.mailFromName || 'Softora'),
    smtpHost: normalizeString(mailConfig.smtpHost),
    smtpPort: Number(mailConfig.smtpPort) || 587,
    smtpSecure: Boolean(mailConfig.smtpSecure),
    smtpUser: replaceLegacyMailboxEmail(normalizeString(mailConfig.smtpUser)),
    smtpPass: normalizeString(mailConfig.smtpPass),
    imapHost: normalizeString(mailConfig.imapHost),
    imapPort: Number(mailConfig.imapPort) || 993,
    imapSecure: Boolean(mailConfig.imapSecure),
    imapUser: replaceLegacyMailboxEmail(normalizeString(mailConfig.imapUser)),
    imapPass: normalizeString(mailConfig.imapPass),
  };

  function normalizeEmail(value) {
    return normalizeMailboxAccountEmail(normalizeString(value));
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

  function envKeyForMailboxEmail(email) {
    return normalizeEmail(email)
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

  function envAccountForKey(email, key) {
    if (!key) return {};
    const env = process.env || {};
    const sharedUser = replaceLegacyMailboxEmail(
      normalizeString(env[`MAILBOX_${key}_USER`] || '')
    );
    const sharedPass = normalizeString(env[`MAILBOX_${key}_PASS`] || '');
    return {
      email,
      name: normalizeString(env[`MAILBOX_${key}_NAME`] || ''),
      smtpHost: normalizeString(env[`MAILBOX_${key}_SMTP_HOST`] || ''),
      smtpPort: readPortEnv(env[`MAILBOX_${key}_SMTP_PORT`]),
      smtpSecure: readBooleanEnv(env[`MAILBOX_${key}_SMTP_SECURE`]),
      smtpUser: replaceLegacyMailboxEmail(
        normalizeString(env[`MAILBOX_${key}_SMTP_USER`] || sharedUser)
      ),
      smtpPass: normalizeString(env[`MAILBOX_${key}_SMTP_PASS`] || sharedPass),
      imapHost: normalizeString(env[`MAILBOX_${key}_IMAP_HOST`] || ''),
      imapPort: readPortEnv(env[`MAILBOX_${key}_IMAP_PORT`]),
      imapSecure: readBooleanEnv(env[`MAILBOX_${key}_IMAP_SECURE`]),
      imapUser: replaceLegacyMailboxEmail(
        normalizeString(env[`MAILBOX_${key}_IMAP_USER`] || sharedUser)
      ),
      imapPass: normalizeString(env[`MAILBOX_${key}_IMAP_PASS`] || sharedPass),
      useBaseCredentials: readBooleanEnv(env[`MAILBOX_${key}_USE_BASE_CREDENTIALS`]) === true,
    };
  }

  function envAccountForEmail(email) {
    return envAccountForKey(email, envKeyForEmail(email));
  }

  function envAccountForMailboxEmail(email) {
    return envAccountForKey(email, envKeyForMailboxEmail(email));
  }

  function envAccountForDomain(email) {
    return envAccountForKey(email, envKeyForDomain(email));
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
      const envAddress = envAccountForMailboxEmail(email);
      const envDomain = envAccountForDomain(email);
      const useBase = email === baseAccount.email || email === normalizeEmail(baseAccount.smtpUser) || email === normalizeEmail(baseAccount.imapUser);
      const useBaseCredentials = useBase || envAddress.useBaseCredentials || envAccount.useBaseCredentials || envDomain.useBaseCredentials;
      const smtpHost = normalizeString(
        json.smtpHost || envAddress.smtpHost || envAccount.smtpHost || envDomain.smtpHost || baseAccount.smtpHost
      );
      const smtpUser = replaceLegacyMailboxEmail(
        normalizeString(
          json.smtpUser ||
            envAddress.smtpUser ||
            envAccount.smtpUser ||
            envDomain.smtpUser ||
            (useBaseCredentials ? baseAccount.smtpUser : '') ||
            email
        )
      );
      const smtpPass = normalizeString(
        json.smtpPass ||
          envAddress.smtpPass ||
          envAccount.smtpPass ||
          envDomain.smtpPass ||
          (useBaseCredentials ? baseAccount.smtpPass : '')
      );
      const imapHost = normalizeString(
        json.imapHost ||
          envAddress.imapHost ||
          envAccount.imapHost ||
          envDomain.imapHost ||
          baseAccount.imapHost ||
          deriveImapHostFromSmtpHost(smtpHost)
      );
      const smtpPort = Number(json.smtpPort || envAddress.smtpPort || envAccount.smtpPort || envDomain.smtpPort || baseAccount.smtpPort || 587) || 587;
      const imapPort = Number(json.imapPort || envAddress.imapPort || envAccount.imapPort || envDomain.imapPort || baseAccount.imapPort || 993) || 993;
      const account = {
        email,
        name: normalizeString(json.name || envAddress.name || envAccount.name || envDomain.name || (useBase ? baseAccount.name : '')) || email,
        smtpHost,
        smtpPort,
        smtpSecure:
          json.smtpSecure !== undefined
            ? Boolean(json.smtpSecure)
            : typeof envAddress.smtpSecure === 'boolean'
              ? Boolean(envAddress.smtpSecure)
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
            : typeof envAddress.imapSecure === 'boolean'
              ? Boolean(envAddress.imapSecure)
              : typeof envAccount.imapSecure === 'boolean'
              ? Boolean(envAccount.imapSecure)
              : typeof envDomain.imapSecure === 'boolean'
                ? Boolean(envDomain.imapSecure)
                : Boolean(baseAccount.imapSecure || imapPort === 993),
        imapUser: replaceLegacyMailboxEmail(
          normalizeString(
            json.imapUser ||
              envAddress.imapUser ||
              envAccount.imapUser ||
              envDomain.imapUser ||
              (useBaseCredentials ? baseAccount.imapUser : '') ||
              smtpUser ||
              email
          )
        ),
        imapPass: normalizeString(
          json.imapPass ||
            envAddress.imapPass ||
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
      messageId: normalizeString(parsed.messageId || ''),
      inReplyTo: normalizeString(parsed.inReplyTo || ''),
      references: Array.isArray(parsed.references)
        ? parsed.references.map((item) => normalizeString(item)).filter(Boolean).join(' ')
        : normalizeString(parsed.references || ''),
      unread: !Array.from(message.flags || []).includes('\\Seen'),
      starred: Array.from(message.flags || []).includes('\\Flagged'),
    };
  }

  function normalizeFolder(value) {
    return normalizeString(value || 'inbox').toLowerCase() || 'inbox';
  }

  function getSafeLimit(limit, max = 100) {
    return Math.max(1, Math.min(max, Number(limit) || DEFAULT_SYNC_LIMIT));
  }

  function assertReadableAccount(accountEmail) {
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
    return account;
  }

  async function fetchMessagesFromImap({ account, folder = 'inbox', limit = DEFAULT_SYNC_LIMIT, uids = null }) {
    const normalizedFolder = normalizeFolder(folder);
    const safeLimit = getSafeLimit(limit);

    const client = createClient(account);
    try {
      await client.connect();
      const mailboxName = await resolveMailboxName(client, normalizedFolder);
      if (!mailboxName) return [];
      const lock = await client.getMailboxLock(mailboxName);
      try {
        let selectedUids = Array.isArray(uids) && uids.length
          ? uids.map(Number).filter((uid) => Number.isFinite(uid) && uid > 0)
          : null;
        if (!selectedUids) {
          const allUids = await client.search(['ALL']);
          selectedUids = (Array.isArray(allUids) ? allUids : []).slice(-safeLimit).reverse();
        }
        if (!selectedUids.length) return [];
        const messages = [];
        for await (const message of client.fetch(selectedUids, { uid: true, flags: true, internalDate: true, source: true })) {
          const parsed = await parseMailSource(message.source);
          messages.push(toClientMessage(parsed, message, normalizedFolder, account));
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

  async function fetchMessageFromImapById({ account, folder = 'inbox', id = '' }) {
    const uid = Number(normalizeString(id).match(/:(\d+)$/)?.[1] || id);
    if (!Number.isFinite(uid) || uid <= 0) return null;
    const messages = await fetchMessagesFromImap({ account, folder, uids: [uid], limit: 1 });
    return messages[0] || null;
  }

  function canUseMailboxIndex() {
    return Boolean(
      mailboxIndexStore &&
        typeof mailboxIndexStore.listMessages === 'function' &&
        (typeof mailboxIndexStore.isAvailable !== 'function' || mailboxIndexStore.isAvailable())
    );
  }

  async function readIndexedMessages({ account, folder, limit }) {
    if (!canUseMailboxIndex()) return null;
    return mailboxIndexStore.listMessages({
      accountEmail: account.email,
      folder,
      limit,
    });
  }

  async function getMailboxSyncMeta({ account, folder }) {
    if (!canUseMailboxIndex() || typeof mailboxIndexStore.getSyncState !== 'function') {
      return { indexed: false, stale: false, source: 'imap-live' };
    }
    const state = await mailboxIndexStore.getSyncState({ accountEmail: account.email, folder });
    return {
      indexed: true,
      stale:
        !state ||
        (typeof mailboxIndexStore.isSyncStateStale === 'function' &&
          mailboxIndexStore.isSyncStateStale(state, mailboxIndexStaleMs)),
      lastSyncedAt: state?.last_synced_at || null,
      status: state?.status || null,
      source: 'index',
    };
  }

  async function syncMailboxFolder({ accountEmail, folder = 'inbox', limit = DEFAULT_SYNC_LIMIT, force = false } = {}) {
    const account = assertReadableAccount(accountEmail);
    const normalizedFolder = normalizeFolder(folder);
    if (!canUseMailboxIndex()) {
      return { ok: false, skipped: true, reason: 'mailbox_index_unavailable' };
    }
    const lock = await mailboxIndexStore.acquireSyncLock({
      accountEmail: account.email,
      folder: normalizedFolder,
      force,
    });
    if (!lock.ok) {
      return { ok: true, skipped: true, reason: lock.locked ? 'locked' : 'lock_failed' };
    }

    try {
      const messages = await fetchMessagesFromImap({
        account,
        folder: normalizedFolder,
        limit: getSafeLimit(limit),
      });
      const saved = await mailboxIndexStore.upsertMessages({
        accountEmail: account.email,
        folder: normalizedFolder,
        messages,
      });
      if (!saved || saved.ok === false) {
        throw saved?.error || new Error('Mailbox-index opslaan mislukt');
      }
      const lastUid = messages.reduce((max, message) => Math.max(max, Number(message.uid) || 0), 0);
      await mailboxIndexStore.finishSync({
        accountEmail: account.email,
        folder: normalizedFolder,
        lockToken: lock.lockToken,
        messageCount: messages.length,
        lastUid,
      });
      return {
        ok: true,
        account: account.email,
        folder: normalizedFolder,
        synced: messages.length,
        upserted: saved.upserted || messages.length,
      };
    } catch (error) {
      await mailboxIndexStore.finishSync({
        accountEmail: account.email,
        folder: normalizedFolder,
        lockToken: lock.lockToken,
        error: error?.message || error,
      }).catch(() => null);
      throw error;
    }
  }

  async function syncMailbox({ accountEmail = '', folders = DEFAULT_SYNC_FOLDERS, limit = DEFAULT_SYNC_LIMIT, force = false } = {}) {
    const accounts = accountEmail
      ? [assertReadableAccount(accountEmail)]
      : getAccounts().filter((account) => account.imapConfigured);
    const folderList = Array.from(
      new Set((Array.isArray(folders) && folders.length ? folders : DEFAULT_SYNC_FOLDERS).map(normalizeFolder))
    );
    const results = [];
    for (const account of accounts) {
      for (const folder of folderList) {
        try {
          results.push(await syncMailboxFolder({ accountEmail: account.email, folder, limit, force }));
        } catch (error) {
          logger.error('[Mailbox][Sync]', account.email, folder, error?.message || error);
          results.push({
            ok: false,
            account: account.email,
            folder,
            error: String(error?.message || error || 'Mailbox sync mislukt'),
          });
        }
      }
    }
    return {
      ok: results.every((result) => result.ok !== false),
      results,
    };
  }

  async function listMessagesWithMeta({ accountEmail, folder = 'inbox', limit = 50 }) {
    const account = assertReadableAccount(accountEmail);
    const normalizedFolder = normalizeFolder(folder);
    const safeLimit = getSafeLimit(limit);
    const indexedMessages = await readIndexedMessages({ account, folder: normalizedFolder, limit: safeLimit });

    if (Array.isArray(indexedMessages) && indexedMessages.length) {
      const sync = await getMailboxSyncMeta({ account, folder: normalizedFolder });
      return {
        messages: indexedMessages,
        sync: {
          ...sync,
          stale: Boolean(sync.stale),
          refreshRecommended: Boolean(sync.stale),
        },
      };
    }

    if (canUseMailboxIndex()) {
      const seed = await syncMailboxFolder({
        accountEmail: account.email,
        folder: normalizedFolder,
        limit: safeLimit,
        force: true,
      }).catch((error) => ({ ok: false, error }));
      if (seed && seed.ok) {
        const seededMessages = await readIndexedMessages({ account, folder: normalizedFolder, limit: safeLimit });
        if (Array.isArray(seededMessages)) {
          return {
            messages: seededMessages,
            sync: {
              indexed: true,
              stale: false,
              source: 'index-seed',
              refreshRecommended: false,
            },
          };
        }
      }
    }

    const messages = await fetchMessagesFromImap({ account, folder: normalizedFolder, limit: safeLimit });
    return {
      messages,
      sync: {
        indexed: false,
        stale: false,
        source: 'imap-live',
        refreshRecommended: false,
      },
    };
  }

  async function listMessages(options) {
    const result = await listMessagesWithMeta(options);
    return result.messages;
  }

  async function getMessage({ accountEmail, folder = 'inbox', id = '' }) {
    const account = assertReadableAccount(accountEmail);
    const normalizedFolder = normalizeFolder(folder);
    if (canUseMailboxIndex() && typeof mailboxIndexStore.getMessage === 'function') {
      const indexed = await mailboxIndexStore.getMessage({
        accountEmail: account.email,
        folder: normalizedFolder,
        id,
      });
      if (indexed && indexed.hasBody && indexed.body) return indexed;
    }
    const live = await fetchMessageFromImapById({ account, folder: normalizedFolder, id });
    if (!live) {
      const error = new Error('Mailboxbericht niet gevonden.');
      error.status = 404;
      throw error;
    }
    if (canUseMailboxIndex() && typeof mailboxIndexStore.upsertMessages === 'function') {
      await mailboxIndexStore.upsertMessages({
        accountEmail: account.email,
        folder: normalizedFolder,
        messages: [live],
      }).catch((error) => logger.error('[Mailbox][MessageIndex]', error?.message || error));
    }
    return live;
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
    const mail = {
      from: account.name ? `${account.name} <${account.email}>` : account.email,
      to: normalizeEmail(to),
      subject: cleanSubject,
      text: normalizeString(text),
    };
    const info = await transporter.sendMail(mail);
    const sentCopySaved = await appendSentMessage({
      account,
      createImapClient,
      nodemailer,
      mail,
      messageId: normalizeString(info?.messageId || ''),
      sentAt: new Date(),
    });
    return {
      messageId: normalizeString(info?.messageId || ''),
      accepted: Array.isArray(info?.accepted) ? info.accepted : [],
      rejected: Array.isArray(info?.rejected) ? info.rejected : [],
      sentCopySaved,
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
      const result = await listMessagesWithMeta({
        accountEmail: req.query?.account,
        folder: normalizeFolder(req.query?.folder || 'inbox'),
        limit: Number(req.query?.limit || 50) || 50,
      });
      return res.status(200).json({ ok: true, messages: result.messages, sync: result.sync });
    } catch (error) {
      logger.error('[Mailbox][List]', error?.message || error);
      const folder = normalizeFolder(req.query?.folder || 'inbox');
      return res.status(error.status || 500).json({
        ok: false,
        error: 'Mailbox laden mislukt',
        detail: publicListErrorMessage(error, folder),
      });
    }
  }

  async function getMessageResponse(req, res) {
    try {
      const message = await getMessage({
        accountEmail: req.query?.account,
        folder: normalizeFolder(req.query?.folder || 'inbox'),
        id: req.query?.id || req.query?.message || '',
      });
      return res.status(200).json({ ok: true, message });
    } catch (error) {
      logger.error('[Mailbox][Message]', error?.message || error);
      return res.status(error.status || 500).json({
        ok: false,
        error: 'Mailboxbericht laden mislukt',
        detail: String(error?.message || 'Onbekende fout'),
      });
    }
  }

  async function syncMailboxResponse(req, res) {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const folderParam = body.folder || req.query?.folder || '';
      const folders = folderParam
        ? String(folderParam)
            .split(',')
            .map(normalizeFolder)
            .filter(Boolean)
        : DEFAULT_SYNC_FOLDERS;
      const result = await syncMailbox({
        accountEmail: body.account || req.query?.account || '',
        folders,
        limit: Number(body.limit || req.query?.limit || DEFAULT_SYNC_LIMIT) || DEFAULT_SYNC_LIMIT,
        force: Boolean(body.force || req.query?.force === '1' || req.query?.force === 'true'),
      });
      if (typeof afterSync === 'function') {
        try {
          result.coldmailReplies = await afterSync({
            result,
            req,
            body,
            folders,
          });
          if (result.coldmailReplies && result.coldmailReplies.ok === false) {
            result.ok = false;
          }
        } catch (error) {
          result.ok = false;
          result.coldmailReplies = {
            ok: false,
            error: String(error?.message || error || 'Coldmail reply-sync mislukt'),
          };
        }
      }
      return res.status(result.ok ? 200 : 207).json(result);
    } catch (error) {
      logger.error('[Mailbox][SyncResponse]', error?.message || error);
      return res.status(error.status || 500).json({
        ok: false,
        error: 'Mailbox sync mislukt',
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

  return {
    accountsResponse,
    getMessageResponse,
    listMessagesResponse,
    sendMessageResponse,
    syncMailboxResponse,
    getAccounts,
    getMessage,
    listMessages,
    listMessagesWithMeta,
    sendMessage,
    syncMailbox,
    syncMailboxFolder,
  };
}

module.exports = {
  createMailboxService,
};
