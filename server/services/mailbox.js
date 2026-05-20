const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { parseImageDataUrl, safeParseJsonObject } = require('./data-ops-serialization');

const DEFAULT_MAILBOX_EMAILS = [
  'info@softora.nl',
  'zakelijk@softora.nl',
  'ruben@softora.nl',
  'serve@softora.nl',
  'martijn@softora.nl',
];
const DEFAULT_CUSTOMER_PHOTO_SCOPE = 'premium_database_photos';
const DEFAULT_CUSTOMER_PHOTO_KEY = 'softora_database_photos_v1';
const DEFAULT_OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MAILBOX_DRAFT_MODEL = 'gpt-5.5-pro';
const MAX_INLINE_IMAGE_BYTES = 5_000_000;
const MAILBOX_SUMMARY_CACHE_TTL_MS = 15_000;

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
    getUiStateValues = async () => null,
    customerPhotoScope = DEFAULT_CUSTOMER_PHOTO_SCOPE,
    customerPhotoKey = DEFAULT_CUSTOMER_PHOTO_KEY,
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
  const summaryCache = new Map();

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

  function decodeHtmlEntities(value) {
    return normalizeString(value)
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
  }

  function stripHtmlTags(value) {
    return decodeHtmlEntities(String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  }

  function readHtmlAttribute(tag, name) {
    const pattern = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
    const match = String(tag || '').match(pattern);
    return decodeHtmlEntities(match ? match[2] || match[3] || match[4] || '' : '');
  }

  function normalizeCid(value) {
    return normalizeString(value)
      .replace(/^cid:/i, '')
      .replace(/[<>]/g, '')
      .trim()
      .toLowerCase();
  }

  function fileBaseName(value) {
    return normalizeString(value).replace(/\.[a-z0-9]{2,5}$/i, '');
  }

  function normalizeImageLabel(value) {
    return normalizeString(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\.[a-z0-9]{2,5}$/gi, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function safeUrl(value) {
    const url = normalizeString(value);
    if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
    return '';
  }

  function extractHtmlLinks(html) {
    const links = [];
    const seen = new Set();
    const source = String(html || '');
    for (const match of source.matchAll(/<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = safeUrl(match[2] || match[3] || match[4] || '');
      if (!href || seen.has(href)) continue;
      seen.add(href);
      links.push({
        label: stripHtmlTags(match[5] || href) || href,
        href,
      });
    }
    return links.slice(0, 12);
  }

  function extractHtmlImageHints(html) {
    const hints = [];
    const source = String(html || '');
    for (const match of source.matchAll(/<img\b[^>]*>/gi)) {
      const tag = match[0] || '';
      const src = readHtmlAttribute(tag, 'src');
      const cid = normalizeCid(src);
      const url = safeUrl(src);
      hints.push({
        cid,
        url,
        alt: readHtmlAttribute(tag, 'alt'),
      });
    }
    return hints;
  }

  function extractBodyImageLabels(text) {
    const labels = [];
    const seen = new Set();
    for (const match of String(text || '').matchAll(/\[image:\s*([^\]]+)\]/gi)) {
      const label = normalizeString(match[1]);
      const key = normalizeImageLabel(label);
      if (!label || !key || seen.has(key)) continue;
      seen.add(key);
      labels.push(label);
    }
    return labels.slice(0, 8);
  }

  function attachmentContentBase64(attachment) {
    const content = attachment && attachment.content;
    if (!content) return '';
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    if (!buffer.length || buffer.length > MAX_INLINE_IMAGE_BYTES) return '';
    return buffer.toString('base64');
  }

  function extractInlineImages(parsed) {
    const htmlHints = extractHtmlImageHints(parsed && parsed.html);
    const images = [];
    const seen = new Set();
    const attachments = Array.isArray(parsed && parsed.attachments) ? parsed.attachments : [];
    for (const attachment of attachments) {
      const contentType = normalizeString(attachment && attachment.contentType).toLowerCase();
      if (!contentType.startsWith('image/')) continue;
      const cid = normalizeCid(attachment.cid || attachment.contentId);
      const hint = htmlHints.find((item) => item.cid && item.cid === cid) || {};
      const contentBase64 = attachmentContentBase64(attachment);
      if (!contentBase64) continue;
      const filename = normalizeString(attachment.filename);
      const id = cid || filename || `image-${images.length + 1}`;
      if (seen.has(id)) continue;
      seen.add(id);
      images.push({
        id,
        cid,
        alt: hint.alt || fileBaseName(filename) || 'Afbeelding',
        filename,
        contentType,
        contentBase64,
        url: '',
      });
    }
    for (const hint of htmlHints) {
      if (!hint.url || seen.has(hint.url)) continue;
      seen.add(hint.url);
      images.push({
        id: hint.url,
        cid: '',
        alt: hint.alt || 'Afbeelding',
        filename: '',
        contentType: '',
        contentBase64: '',
        url: hint.url,
      });
    }
    return images.slice(0, 8);
  }

  function photoLabelMatches(left, right) {
    const normalizedLeft = normalizeImageLabel(left);
    const normalizedRight = normalizeImageLabel(right);
    return Boolean(
      normalizedLeft &&
        normalizedRight &&
        (normalizedLeft === normalizedRight ||
          normalizedLeft.includes(normalizedRight) ||
          normalizedRight.includes(normalizedLeft))
    );
  }

  function photoDataUrlFromState(values, meta) {
    const direct = normalizeString(meta && meta.websitePhoto);
    if (parseImageDataUrl(direct)) return direct;
    const photoKey = normalizeString(meta && meta.photoKey);
    const chunkCount = Math.max(0, Math.min(100, Number(meta && meta.chunkCount) || 0));
    if (!photoKey || !chunkCount) return '';
    return Array.from({ length: chunkCount }, (_, index) => normalizeString(values && values[`${photoKey}_${index}`])).join('');
  }

  async function loadStoredImagesForLabels(labels) {
    const requestedLabels = (Array.isArray(labels) ? labels : []).filter(Boolean);
    if (!requestedLabels.length || typeof getUiStateValues !== 'function') return [];

    try {
      const state = await getUiStateValues(customerPhotoScope);
      const values = state && state.values && typeof state.values === 'object' ? state.values : {};
      const map = safeParseJsonObject(values[customerPhotoKey]);
      const images = [];
      const seen = new Set();
      for (const [id, meta] of Object.entries(map)) {
        const aliases = [
          id,
          meta && meta.id,
          meta && meta.websitePhotoName,
          fileBaseName(meta && meta.websitePhotoName),
        ].filter(Boolean);
        const matchingLabel = requestedLabels.find((label) => aliases.some((alias) => photoLabelMatches(alias, label)));
        if (!matchingLabel) continue;
        const parsed = parseImageDataUrl(photoDataUrlFromState(values, meta));
        if (!parsed || parsed.buffer.length > MAX_INLINE_IMAGE_BYTES) continue;
        const key = normalizeImageLabel(matchingLabel);
        if (seen.has(key)) continue;
        seen.add(key);
        images.push({
          id: `stored-webdesign-${normalizeString(id) || images.length + 1}`,
          cid: '',
          alt: matchingLabel,
          filename: normalizeString(meta && meta.websitePhotoName) || `${matchingLabel}.png`,
          contentType: parsed.mimeType,
          contentBase64: parsed.buffer.toString('base64'),
          url: '',
        });
      }
      return images.slice(0, 8);
    } catch (error) {
      logger.warn('[Mailbox][inline-images]', error && error.message ? error.message : error);
      return [];
    }
  }

  function mergeInlineImages(primaryImages, fallbackImages, text) {
    const images = Array.isArray(primaryImages) ? primaryImages : [];
    const fallbacks = Array.isArray(fallbackImages) ? fallbackImages : [];
    if (!fallbacks.length) return images;
    const labels = extractBodyImageLabels(text);
    const used = new Set(images.map((image) => normalizeImageLabel(image.alt || image.filename || image.id)).filter(Boolean));
    const matchedFallbacks = fallbacks.filter((image) => {
      const key = normalizeImageLabel(image.alt || image.filename || image.id);
      if (!key || used.has(key)) return false;
      if (!labels.some((label) => photoLabelMatches(image.alt || image.filename || image.id, label))) return false;
      used.add(key);
      return true;
    });
    return [...images, ...matchedFallbacks].slice(0, 8);
  }

  function isoDate(value) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  function toClientMessage(parsed, message, folder, account, options = {}) {
    const date = parsed.date || message.internalDate || new Date();
    const html = normalizeString(parsed.html || '');
    const text = normalizeString(parsed.text || stripHtmlTags(html));
    const preview = truncateText(text.replace(/\s+/g, ' '), 140);
    const fromText = folder === 'sent' ? account.name || account.email : displayName(parsed.from?.value);
    const inlineImages = mergeInlineImages(extractInlineImages(parsed), options.storedImages, text || preview);
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
      links: extractHtmlLinks(html),
      inlineImages,
      date: isoDate(date),
      unread: !Array.from(message.flags || []).includes('\\Seen'),
      starred: Array.from(message.flags || []).includes('\\Flagged'),
    };
  }

  function toClientMessageSummary(message, folder, account) {
    const envelope = message.envelope || {};
    const date = envelope.date || message.internalDate || new Date();
    const fromText = folder === 'sent' ? account.name || account.email : displayName(envelope.from);
    return {
      id: `${folder}:${message.uid}`,
      uid: message.uid,
      folder,
      from: fromText,
      email: folder === 'sent' ? account.email : addressText(envelope.from),
      to: addressText(envelope.to),
      subject: normalizeString(envelope.subject || '(Geen onderwerp)'),
      preview: '',
      body: '',
      links: [],
      inlineImages: [],
      date: isoDate(date),
      unread: !Array.from(message.flags || []).includes('\\Seen'),
      starred: Array.from(message.flags || []).includes('\\Flagged'),
    };
  }

  function summaryCacheKey(accountEmail, folder, limit) {
    return [normalizeEmail(accountEmail), normalizeString(folder).toLowerCase(), Math.max(1, Math.min(100, Number(limit) || 50))].join('|');
  }

  function getSummaryCache(key) {
    const cached = summaryCache.get(key);
    if (!cached || Date.now() - cached.createdAt > MAILBOX_SUMMARY_CACHE_TTL_MS) {
      summaryCache.delete(key);
      return null;
    }
    return cached.messages;
  }

  function setSummaryCache(key, messages) {
    summaryCache.set(key, {
      createdAt: Date.now(),
      messages: Array.isArray(messages) ? messages : [],
    });
    if (summaryCache.size > 80) {
      const oldestKey = summaryCache.keys().next().value;
      if (oldestKey) summaryCache.delete(oldestKey);
    }
  }

  function latestSequenceRange(client, limit) {
    const exists = Number(client && client.mailbox && client.mailbox.exists) || 0;
    if (!exists) return '';
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    const start = Math.max(1, exists - safeLimit + 1);
    return `${start}:*`;
  }

  async function listMessages({ accountEmail, folder = 'inbox', limit = 50, summaryOnly = false, uid = 0, fresh = false }) {
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

    const requestedUid = Number(uid) || 0;
    const cacheKey = summaryOnly && requestedUid <= 0 ? summaryCacheKey(account.email, requestedFolder, limit) : '';
    if (cacheKey && !fresh) {
      const cachedMessages = getSummaryCache(cacheKey);
      if (cachedMessages) return cachedMessages;
    }

    const client = createClient(account);
    try {
      await client.connect();
      const mailboxName = await resolveMailboxName(client, mailboxFolder);
      if (!mailboxName) return [];
      const lock = await client.getMailboxLock(mailboxName);
      try {
        let range;
        let fetchOptions;
        if (requestedUid > 0) {
          range = { uid: requestedUid };
        } else if (summaryOnly) {
          range = latestSequenceRange(client, limit);
          fetchOptions = range ? { uid: false } : undefined;
        } else {
          const allUids = await client.search(['ALL']);
          range = (Array.isArray(allUids) ? allUids : [])
            .slice(-Math.max(1, Math.min(100, Number(limit) || 50)))
            .reverse();
        }
        if (!range) return [];
        if (Array.isArray(range) && !range.length) return [];

        const fetchQuery = summaryOnly
          ? { uid: true, flags: true, internalDate: true, envelope: true }
          : { uid: true, flags: true, internalDate: true, source: true };

        const records = [];
        const imageLabels = [];
        for await (const message of client.fetch(range, fetchQuery, fetchOptions)) {
          if (summaryOnly) {
            records.push({ message });
            continue;
          }

          const parsed = await parseMailSource(message.source);
          const html = normalizeString((parsed && parsed.html) || '');
          const text = normalizeString((parsed && parsed.text) || stripHtmlTags(html));
          extractBodyImageLabels(text).forEach((label) => imageLabels.push(label));
          records.push({ message, parsed });
        }

        const storedImages = summaryOnly ? [] : await loadStoredImagesForLabels(imageLabels);
        const messages = records.map((record) =>
          summaryOnly
            ? toClientMessageSummary(record.message, requestedFolder, account)
            : toClientMessage(record.parsed, record.message, requestedFolder, account, { storedImages })
        );
        const visibleMessages = requestedFolder === 'starred' || requestedFolder === 'important'
          ? messages.filter((item) => item.starred)
          : messages;
        const sortedMessages = visibleMessages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        if (cacheKey) setSummaryCache(cacheKey, sortedMessages);
        return sortedMessages;
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
        summaryOnly: ['1', 'true', 'yes'].includes(normalizeString(req.query?.summary).toLowerCase()),
        uid: Number(req.query?.uid || 0) || 0,
        fresh: ['1', 'true', 'yes'].includes(normalizeString(req.query?.fresh).toLowerCase()),
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
