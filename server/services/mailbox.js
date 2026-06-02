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
  buildCustomerIdentityKey,
  parseImageDataUrl,
  readChunkedStateValue,
  safeParseJsonArray,
  safeParseJsonObject,
} = require('./data-ops-serialization');
const { fitWebdesignPreviewForEmail } = require('./coldmail-image-frame');
const { buildOpenAiContextHeaders } = require('./openai-request-context');

const DEFAULT_MAILBOX_EMAILS = [
  'info@softora.nl',
  'zakelijk@softora.nl',
  'ruben@softora.nl',
  'serve@softora.nl',
  'martijn@softora.nl',
  'servec321@gmail.com',
  'martijnven123@gmail.com',
  'serve290@gmail.com',
  'servecreusen7@gmail.com',
];
const MAILBOX_DISPLAY_NAMES = {
  'serve@softora.nl': 'Servé Creusen',
  'martijn@softora.nl': 'Martijn van de Ven',
  'servec321@gmail.com': 'Servé Creusen',
  'martijnven123@gmail.com': 'Martijn van de Ven',
  'serve290@gmail.com': 'Servé Creusen',
  'servecreusen7@gmail.com': 'Servé Creusen',
};
const DEFAULT_CUSTOMER_PHOTO_SCOPE = 'premium_database_photos';
const DEFAULT_CUSTOMER_PHOTO_KEY = 'softora_database_photos_v1';
const DEFAULT_CUSTOMER_DB_SCOPE = 'premium_customers_database';
const DEFAULT_CUSTOMER_DB_KEY = 'softora_customers_premium_v1';
const DEFAULT_PUBLIC_WEBDESIGN_PREVIEW_BASE_URL = 'https://www.softora.nl';
const COLDMAIL_MOCKUP_CAPTION = 'Hieronder zie je een korte indruk van de eerste versie op verschillende schermen.';
const COLDMAIL_OPT_OUT_LABEL = 'Geen webdesign willen ontvangen? Laat het me weten!';
const COLDMAIL_IMAGE_VISIBILITY_PS = 'PS: Wordt het webdesign niet zichtbaar?\nOpen het via hier 👈';
const COLDMAIL_IMAGE_VISIBILITY_PS_PATTERN =
  /PS:\s*(?:als het webdesign niet zichtbaar is,\s*klik op ['"‘’“”]?afbeeldingen tonen['"‘’“”]? ergens in het scherm\.?|zie je het webdesign niet\?\s*klik dan even op ['"‘’“”]?afbeeldingen tonen['"‘’“”]? ergens in je scherm\s*😊?|wordt het webdesign niet zichtbaar\?\s*klik dan even op ['"‘’“”]?afbeeldingen tonen['"‘’“”]? ergens in je scherm,?\s*of open het via deze link:\s*(?:https?:\/\/[^\s]+\/)?webdesign\/[a-z0-9-]+(?:\s*👈)?|wordt het webdesign niet zichtbaar\?\s*open het via hier\s*👈?)/i;
const MAX_STORED_BODY_IMAGE_BYTES = 5 * 1024 * 1024;

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
    'INBOX/Sent',
    'INBOX/Sent Items',
    'INBOX/Sent Mail',
    'Sent objects',
    'Sent-mails',
    'Sent Mails',
    'SentMail',
    'Gesendet',
    'Verzonden',
    'Verzonden items',
    'Verzonden berichten',
    'Verstuurd',
    'Verstuurde items',
    'Verstuurde berichten',
    'INBOX.Verzonden',
    'INBOX.Verzonden items',
    'INBOX.Verstuurd',
    'INBOX.Verstuurde items',
    'INBOX/Verzonden',
    'INBOX/Verzonden items',
    'INBOX/Verstuurd',
    'INBOX/Verstuurde items',
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
const OWNED_MAILBOX_DOMAINS = new Set(['softora.nl']);

const IMAGE_ASSET_EXTENSIONS = /\.(?:apng|avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:[?#].*)?$/i;
const INLINE_DISPLAY_IMAGE_TYPES = /^image\/(?:png|jpe?g|webp|gif)$/i;

function decodeBasicHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeHtmlAttribute(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function getHtmlAttribute(tag, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const match = String(tag || '').match(pattern);
  return decodeBasicHtmlEntities(match?.[1] || match?.[2] || match?.[3] || '').trim();
}

function normalizeContentId(value) {
  return String(value || '')
    .trim()
    .replace(/^cid:/i, '')
    .replace(/^<|>$/g, '')
    .trim()
    .toLowerCase();
}

function htmlToReadableText(value) {
  return decodeBasicHtmlEntities(value)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<img\b[^>]*>/gi, (tag) => {
      if (/(?:width=["']?1["']?|height=["']?1["']?)/i.test(tag)) return ' ';
      const alt = getHtmlAttribute(tag, 'alt');
      return alt ? `\n[image: ${alt}]\n` : ' ';
    })
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

function buildMailboxBodyImages(parsed = {}) {
  const html = String(parsed.html || '');
  const attachments = Array.isArray(parsed.attachments) ? parsed.attachments : [];
  if (!html || !attachments.length) return [];

  const attachmentByCid = new Map();
  attachments.forEach((attachment) => {
    const cid = normalizeContentId(attachment?.cid || attachment?.contentId || attachment?.contentID);
    const contentType = String(attachment?.contentType || '').split(';')[0].toLowerCase();
    const content = attachment?.content;
    if (!cid || !INLINE_DISPLAY_IMAGE_TYPES.test(contentType) || !content) return;
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    if (!buffer.length || buffer.length > 10 * 1024 * 1024) return;
    attachmentByCid.set(cid, { cid, contentType, buffer });
  });
  if (!attachmentByCid.size) return [];

  const images = [];
  const seen = new Set();
  const imgTags = html.match(/<img\b[^>]*>/gi) || [];
  imgTags.forEach((tag) => {
    if (/(?:width=["']?1["']?|height=["']?1["']?)/i.test(tag)) return;
    const cid = normalizeContentId(getHtmlAttribute(tag, 'src'));
    const attachment = attachmentByCid.get(cid);
    if (!attachment || seen.has(cid)) return;
    seen.add(cid);
    images.push({
      cid: attachment.cid,
      alt: getHtmlAttribute(tag, 'alt') || 'Afbeelding',
      contentType: attachment.contentType,
      dataUrl: `data:${attachment.contentType};base64,${attachment.buffer.toString('base64')}`,
    });
  });
  return images;
}

function normalizeImageLabel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[a-z0-9]{2,5}$/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractBodyImageLabels(text) {
  const labels = [];
  const seen = new Set();
  for (const match of String(text || '').matchAll(/\[image:\s*([^\]]+)\]/gi)) {
    const label = String(match[1] || '').trim();
    const key = normalizeImageLabel(label);
    if (!label || !key || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels.slice(0, 8);
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

function cleanImageAlt(value) {
  return String(value || '')
    .trim()
    .replace(/\.(?:apng|avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i, '')
    .trim();
}

function photoDataUrlFromState(values, meta, normalizeString, options = {}) {
  const direct = normalizeString(
    options.mockup
      ? meta && (meta.websiteMockup || meta.mockup || meta.websiteMockupDataUrl || meta.mockupDataUrl)
      : meta && (meta.websitePhoto || meta.photo || meta.websitePhotoDataUrl || meta.photoDataUrl)
  );
  if (parseImageDataUrl(direct)) return direct;
  const photoKey = normalizeString(
    options.mockup
      ? meta && (meta.mockupPhotoKey || meta.websiteMockupKey)
      : meta && meta.photoKey
  );
  const chunkCount = Math.max(
    0,
    Math.min(100, Number(options.mockup ? meta && (meta.mockupChunkCount || meta.websiteMockupChunkCount) : meta && meta.chunkCount) || 0)
  );
  if (!photoKey || !chunkCount) return '';
  return Array.from({ length: chunkCount }, (_item, index) => normalizeString(values && values[`${photoKey}_${index}`])).join('');
}

function mergeMailboxBodyImages(primaryImages, fallbackImages, text, options = {}) {
  const images = Array.isArray(primaryImages) ? primaryImages : [];
  const fallbacks = Array.isArray(fallbackImages) ? fallbackImages : [];
  if (!fallbacks.length) return images;
  const labels = extractBodyImageLabels(text);
  const used = new Set(images.map((image) => normalizeImageLabel(image.alt || image.cid || image.dataUrl)).filter(Boolean));
  const matchedFallbacks = fallbacks.filter((image) => {
    const key = normalizeImageLabel(image.alt || image.cid || image.dataUrl);
    if (!key || used.has(key)) return false;
    if (!options.allowUnmatchedFallbacks && !labels.some((label) => photoLabelMatches(image.alt || image.cid || image.dataUrl, label))) return false;
    used.add(key);
    return true;
  });
  return [...images, ...matchedFallbacks].slice(0, 8);
}

function isMockupBodyImage(image) {
  return /\b(?:device|mockup|laptop|ipad|iphone|tablet|mobiel)\b/i.test(String(image && image.alt || ''));
}

function decorateRecoveredWebdesignImagesText(text, images) {
  const bodyImages = (Array.isArray(images) ? images : []).filter((image) => image && image.alt && image.dataUrl);
  if (!bodyImages.length || extractBodyImageLabels(text).length) return text;
  const lines = String(text || '').split('\n');
  const hasMockupCaption = lines.some((line) => normalizeImageLabel(line) === normalizeImageLabel(COLDMAIL_MOCKUP_CAPTION));
  const imageLines = [];
  let hasMainImage = false;
  bodyImages.forEach((image) => {
    if (isMockupBodyImage(image) && hasMainImage && !hasMockupCaption) {
      imageLines.push(COLDMAIL_MOCKUP_CAPTION);
    }
    imageLines.push(`[image: ${cleanImageAlt(image.alt)}]`);
    if (!isMockupBodyImage(image)) hasMainImage = true;
  });
  if (!imageLines.length) return text;
  const optOutIndex = lines.findIndex((line) => String(line || '').includes(COLDMAIL_OPT_OUT_LABEL));
  const insertIndex = optOutIndex >= 0 ? optOutIndex : lines.length;
  return [
    ...lines.slice(0, insertIndex),
    '',
    ...imageLines,
    '',
    ...lines.slice(insertIndex),
  ]
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function bodyImageToInlineImage(image, index) {
  const dataUrl = String(image && image.dataUrl ? image.dataUrl : '');
  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([a-z0-9+/=\s]+)$/i);
  const contentType = String((image && image.contentType) || (match && match[1]) || '')
    .split(';')[0]
    .toLowerCase();
  const contentBase64 = match ? String(match[2] || '').replace(/\s+/g, '') : '';
  const cid = String((image && image.cid) || '').trim();
  const alt = String((image && image.alt) || '').trim() || 'Afbeelding';
  return {
    id: cid || `${normalizeImageLabel(alt) || 'image'}-${index + 1}`,
    cid,
    alt,
    filename: '',
    contentType,
    contentBase64,
    url: '',
  };
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

function isColdmailOptOutUrl(value) {
  const parsed = safeUrl(value);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  return host === 'softora.nl' && parsed.pathname.replace(/\/+$/, '') === '/afmelden';
}

function extractColdmailOptOutUrlFromText(text) {
  const label = COLDMAIL_OPT_OUT_LABEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const markdownPattern = new RegExp(`\\[${label}\\]\\((https?:\\/\\/[^)\\s]+)\\)`, 'i');
  const markdownMatch = String(text || '').match(markdownPattern);
  if (isColdmailOptOutUrl(markdownMatch && markdownMatch[1])) return markdownMatch[1];
  const pattern = new RegExp(`${label}:?\\s*(?:\\[(https?:\\/\\/[^\\]]+)\\]|(https?:\\/\\/\\S+))`, 'i');
  const match = String(text || '').match(pattern);
  const url = match && (match[1] || match[2] || '');
  return isColdmailOptOutUrl(url) ? url : '';
}

function extractColdmailOptOutUrlFromHtml(html) {
  const source = String(html || '');
  if (!source) return '';
  const anchorTags = source.match(/<a\b[\s\S]*?<\/a>/gi) || [];
  for (const tag of anchorTags) {
    const href = getHtmlAttribute(tag, 'href');
    if (!isColdmailOptOutUrl(href)) continue;
    const label = htmlToReadableText(tag).replace(/\s+/g, ' ').trim();
    if (!label || label.includes(COLDMAIL_OPT_OUT_LABEL) || /afmelden/i.test(label)) return href;
  }
  const hrefMatches = source.match(/href=(?:"([^"]+)"|'([^']+)'|([^\s"'>]+))/gi) || [];
  for (const rawMatch of hrefMatches) {
    const href = getHtmlAttribute(`<a ${rawMatch}>`, 'href');
    if (isColdmailOptOutUrl(href)) return href;
  }
  return '';
}

function resolveColdmailOptOutUrl(parsed, text) {
  return extractColdmailOptOutUrlFromText(text) ||
    extractColdmailOptOutUrlFromText(parsed && parsed.text) ||
    extractColdmailOptOutUrlFromHtml(parsed && parsed.html) ||
    '';
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

const INDEX_STALE_MS = 2 * 60 * 1000;
const DEFAULT_SYNC_FOLDERS = ['inbox', 'sent'];
const DEFAULT_SYNC_LIMIT = 50;

function createMailboxService(deps = {}) {
  const {
    env = process.env,
    logger = console,
    mailConfig = {},
    mailboxAccountsRaw = '',
    getUiStateValues = async () => null,
    customerPhotoScope = DEFAULT_CUSTOMER_PHOTO_SCOPE,
    customerPhotoKey = DEFAULT_CUSTOMER_PHOTO_KEY,
    customerDbScope = DEFAULT_CUSTOMER_DB_SCOPE,
    customerDbKey = DEFAULT_CUSTOMER_DB_KEY,
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

  function envKeyForMailboxEmail(email) {
    return normalizeEmail(email)
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

  function envAccountForKey(email, key) {
    if (!key) return {};
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
      const smtpUser = normalizeString(
        json.smtpUser ||
          envAddress.smtpUser ||
          envAccount.smtpUser ||
          envDomain.smtpUser ||
          (useBaseCredentials ? baseAccount.smtpUser : '') ||
          email
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
        name: getMailboxDisplayName(email, json.name || envAddress.name || envAccount.name || envDomain.name || (useBase ? baseAccount.name : '')),
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
        imapUser: normalizeString(
          json.imapUser ||
            envAddress.imapUser ||
            envAccount.imapUser ||
            envDomain.imapUser ||
            (useBaseCredentials ? baseAccount.imapUser : '') ||
            smtpUser ||
            email
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

  function normalizeDomain(value) {
    const raw = normalizeString(value)
      .replace(/^<|>$/g, '')
      .replace(/^\(|\)$/g, '')
      .replace(/[.,;:!?]+$/g, '');
    if (!raw) return '';
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      return normalizeString(new URL(candidate).hostname).replace(/^www\./i, '').toLowerCase();
    } catch (_) {
      return raw
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .replace(/\/.*$/g, '')
        .replace(/[^\w.-]+/g, '')
        .toLowerCase();
    }
  }

  function isOwnedMailboxDomain(domain) {
    const value = normalizeDomain(domain);
    if (!value) return false;
    return OWNED_MAILBOX_DOMAINS.has(value) || Array.from(OWNED_MAILBOX_DOMAINS).some((owned) => value.endsWith(`.${owned}`));
  }

  function getCustomerDomain(row = {}) {
    return normalizeDomain(row.dom || row.domain || row.website || row.websiteUrl || row.website_url || row.url || row.site || row.domein);
  }

  function getCustomerEmail(row = {}) {
    return normalizeEmail(row.email || row.contactEmail || row.mail || row.emailadres || row.emailAddress);
  }

  function getCustomerId(row = {}, index = 0) {
    return normalizeString(row.id || row.customerId || row.databaseId || row.key || row.uuid || `customer-${index}`);
  }

  function getCustomerCompany(row = {}) {
    return normalizeString(
      row.bedrijf ||
        row.company ||
        row.companyName ||
        row.businessName ||
        row.naam ||
        row.name ||
        row.contactName
    );
  }

  function slugifyWebdesignCompany(value, fallback = 'uw-bedrijf') {
    const normalized = normalizeString(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 90);
    return normalized || fallback;
  }

  function getPublicWebdesignPreviewBaseUrl() {
    const raw = normalizeString(
      env.SOFTORA_PUBLIC_BASE_URL ||
        env.PUBLIC_BASE_URL ||
        env.WEBDESIGN_PUBLIC_BASE_URL ||
        DEFAULT_PUBLIC_WEBDESIGN_PREVIEW_BASE_URL
    ).replace(/\/+$/g, '');
    return /^https?:\/\//i.test(raw) ? raw : DEFAULT_PUBLIC_WEBDESIGN_PREVIEW_BASE_URL;
  }

  function buildPublicWebdesignPreviewUrl(row, id) {
    const fallbackSlug = slugifyWebdesignCompany(id, 'uw-bedrijf');
    const slug = slugifyWebdesignCompany(getCustomerCompany(row), fallbackSlug);
    const customerId = normalizeString(id || getCustomerId(row, 0));
    try {
      const url = new URL(`/webdesign/${slug}`, getPublicWebdesignPreviewBaseUrl());
      if (customerId) url.searchParams.set('cid', customerId);
      return url.toString();
    } catch (_) {
      const query = customerId ? `?cid=${encodeURIComponent(customerId)}` : '';
      return `${DEFAULT_PUBLIC_WEBDESIGN_PREVIEW_BASE_URL}/webdesign/${slug}${query}`;
    }
  }

  function getPhotoMetaCompany(meta = {}) {
    const identityCompany = normalizeString(meta.identityKey).split('|')[0];
    const imageName = cleanImageAlt(meta.websitePhotoName || meta.fileName || '');
    return normalizeString(
      meta.bedrijf ||
        meta.company ||
        meta.companyName ||
        meta.businessName ||
        identityCompany ||
        imageName
    );
  }

  function buildPublicWebdesignPreviewUrlForMatch(row, meta, id) {
    const previewId = normalizeString(meta && (meta.id || meta.customerId)) || normalizeString(id || getCustomerId(row, 0));
    const previewRow = row && typeof row === 'object'
      ? row
      : {
          bedrijf: getPhotoMetaCompany(meta) || previewId,
        };
    return buildPublicWebdesignPreviewUrl(previewRow, previewId);
  }

  function parseCustomerRows(values = {}) {
    return safeParseJsonArray(readChunkedStateValue(values, customerDbKey))
      .map((entry) => (entry && entry.row && typeof entry.row === 'object' ? entry.row : entry))
      .filter((row) => row && typeof row === 'object');
  }

  function extractMailDomains(parsed, text) {
    const source = `${normalizeString(parsed && parsed.subject)}\n${text}\n${sanitizeMailboxDisplayText(parsed && parsed.html || '')}`;
    const preferred = [];
    const add = (value) => {
      const domain = normalizeDomain(value);
      if (!domain || !domain.includes('.') || isOwnedMailboxDomain(domain) || preferred.includes(domain)) return;
      preferred.push(domain);
    };
    for (const match of source.matchAll(/(?:website|site|domein)\s*(?:\(|:)?\s*(https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) {
      add(`${match[1] || ''}${match[2] || ''}`);
    }
    for (const match of source.matchAll(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/gi)) {
      add(match[1]);
    }
    return preferred.slice(0, 8);
  }

  function looksLikeWebdesignOutreach(parsed, text) {
    const haystack = `${normalizeString(parsed && parsed.subject)}\n${text}\n${sanitizeMailboxDisplayText(parsed && parsed.html || '')}`.toLowerCase();
    return /\bnieuw(?:e)?\s+webdesign\b/.test(haystack) || (
      /\bwebdesign\b/.test(haystack) &&
      /(?:gemaakt|geen webdesign willen ontvangen|\/afmelden\?t=)/.test(haystack)
    );
  }

  function getParsedAddressEmails(address) {
    const list = Array.isArray(address && address.value) ? address.value : Array.isArray(address) ? address : [];
    return list.map((item) => normalizeEmail(item && (item.address || item.name))).filter(isValidEmail);
  }

  function findCustomerRowsForMail(parsed, text, rows) {
    const toEmails = new Set(getParsedAddressEmails(parsed && parsed.to));
    const domains = new Set(extractMailDomains(parsed, text));
    const matches = [];
    (Array.isArray(rows) ? rows : []).forEach((row, index) => {
      const email = getCustomerEmail(row);
      const domain = getCustomerDomain(row);
      if ((email && toEmails.has(email)) || (domain && domains.has(domain))) {
        matches.push({ row, index });
      }
    });
    return matches.slice(0, 2);
  }

  function getPhotoMetaForRow(row, index, photoMap, photoByIdentity) {
    const id = getCustomerId(row, index);
    const identity = buildCustomerIdentityKey(row).toLowerCase();
    const stored = (id && photoMap[id]) || (identity && photoByIdentity.get(identity)) || null;
    const rowMeta = row && typeof row === 'object' ? row : {};
    return {
      ...(stored && typeof stored === 'object' ? stored : {}),
      ...rowMeta,
      id: normalizeString((stored && stored.id) || rowMeta.id || id),
      identityKey: normalizeString((stored && stored.identityKey) || buildCustomerIdentityKey(rowMeta)),
    };
  }

  function buildPhotoByIdentity(photoMap) {
    const byIdentity = new Map();
    Object.values(photoMap || {}).forEach((meta) => {
      const identity = normalizeString(meta && meta.identityKey).toLowerCase();
      if (identity && !byIdentity.has(identity)) byIdentity.set(identity, meta);
    });
    return byIdentity;
  }

  function getPhotoSource(meta, options = {}) {
    if (!meta || typeof meta !== 'object') return '';
    return normalizeString(
      options.mockup
        ? meta.websiteMockup ||
            meta.websiteMockupUrl ||
            meta.mockup ||
            meta.mockupUrl ||
            meta.signedMockupUrl ||
            (meta.mockupStorage && meta.mockupStorage.signedUrl)
        : meta.websitePhoto ||
            meta.websitePhotoUrl ||
            meta.photo ||
            meta.photoDataUrl ||
            meta.signedUrl ||
            meta.publicUrl ||
            (meta.storage && meta.storage.signedUrl)
    );
  }

  async function remoteImageDataUrl(source) {
    const url = safeUrl(source);
    if (!url || url.protocol !== 'https:' || typeof fetch !== 'function') return '';
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 9000) : null;
    if (timer && typeof timer.unref === 'function') timer.unref();
    try {
      const response = await fetch(url.href, { signal: controller ? controller.signal : undefined });
      if (!response || !response.ok) return '';
      const contentType = normalizeString(response.headers && response.headers.get('content-type'))
        .split(';')[0]
        .toLowerCase();
      if (!INLINE_DISPLAY_IMAGE_TYPES.test(contentType)) return '';
      const contentLength = Number(response.headers && response.headers.get('content-length')) || 0;
      if (contentLength > MAX_STORED_BODY_IMAGE_BYTES) return '';
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.length > MAX_STORED_BODY_IMAGE_BYTES) return '';
      return `data:${contentType};base64,${buffer.toString('base64')}`;
    } catch (_) {
      return '';
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function imageDataUrlFromPhotoMeta(values, meta, options = {}) {
    const storedDataUrl = photoDataUrlFromState(values, meta, normalizeString, options);
    if (parseImageDataUrl(storedDataUrl)) return storedDataUrl;
    const directSource = getPhotoSource(meta, options);
    if (parseImageDataUrl(directSource)) return directSource;
    return remoteImageDataUrl(directSource);
  }

  async function imageFromPhotoMeta(values, meta, alt, options = {}) {
    const dataUrl = await imageDataUrlFromPhotoMeta(values, meta, options);
    const parsedImage = parseImageDataUrl(dataUrl);
    if (!parsedImage || parsedImage.buffer.length > MAX_STORED_BODY_IMAGE_BYTES) return null;
    return {
      cid: '',
      alt: cleanImageAlt(alt) || (options.mockup ? 'Device mockup' : 'Webdesign'),
      contentType: parsedImage.mimeType,
      dataUrl: parsedImage.dataUrl,
    };
  }

  async function imagesFromPhotoMeta(values, meta, fallbackAlt) {
    if (!meta || typeof meta !== 'object') return [];
    const images = [];
    const mainImage = await imageFromPhotoMeta(
      values,
      meta,
      normalizeString(meta.websitePhotoName || meta.fileName || fallbackAlt || 'Webdesign')
    );
    if (mainImage) images.push(mainImage);
    const mockupImage = await imageFromPhotoMeta(
      values,
      meta,
      normalizeString(meta.websiteMockupName || meta.mockupFileName || 'Device mockup'),
      { mockup: true }
    );
    if (mockupImage) images.push(mockupImage);
    return images;
  }

  function isMailboxImageVisibilityPsLine(line) {
    const cleanLine = normalizeString(line);
    return Boolean(cleanLine && COLDMAIL_IMAGE_VISIBILITY_PS_PATTERN.test(cleanLine));
  }

  function normalizeMailboxWebdesignText(text) {
    const source = String(text || '').replace(/\r\n?/g, '\n');
    const normalizedSource = source.replace(COLDMAIL_IMAGE_VISIBILITY_PS_PATTERN, COLDMAIL_IMAGE_VISIBILITY_PS);
    const replaced = normalizedSource !== source;
    const normalizedLines = normalizedSource.split('\n');
    if (!replaced) {
      const optOutIndex = normalizedLines.findIndex((line) => normalizeString(line).includes(COLDMAIL_OPT_OUT_LABEL));
      const insertIndex = optOutIndex >= 0 ? optOutIndex : normalizedLines.length;
      const insertLines = insertIndex > 0 && normalizeString(normalizedLines[insertIndex - 1])
        ? ['', COLDMAIL_IMAGE_VISIBILITY_PS]
        : [COLDMAIL_IMAGE_VISIBILITY_PS];
      normalizedLines.splice(insertIndex, 0, ...insertLines);
    }
    return normalizedLines
      .join('\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function extractPublicWebdesignPreviewUrlFromText(text) {
    const source = String(text || '');
    const match = source.match(/(https?:\/\/[^\s)\]]*\/webdesign\/[a-z0-9-]+(?:\?[^)\s\]]*)?|(?:^|[\s([])(\/?webdesign\/[a-z0-9-]+(?:\?[^)\s\]]*)?))/i);
    const rawUrl = normalizeString(match && (match[2] || match[1] || ''));
    if (!rawUrl) return '';
    return /^https?:\/\//i.test(rawUrl)
      ? rawUrl.replace(/[),.;!?]+$/g, '')
      : `${getPublicWebdesignPreviewBaseUrl()}/${rawUrl.replace(/^\/+/, '').replace(/[),.;!?]+$/g, '')}`;
  }

  function isColdmailOptOutTextLine(line) {
    const cleanLine = normalizeString(line);
    return Boolean(cleanLine && cleanLine.includes(COLDMAIL_OPT_OUT_LABEL));
  }

  function stripColdmailOptOutLines(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .filter((line) => !isColdmailOptOutTextLine(line))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function renderInlineMarkdownLinks(line) {
    const source = String(line || '');
    const pattern = /\[([^\]\n]{1,180})\]\((https?:\/\/[^)\s]+)\)/g;
    let html = '';
    let lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      html += escapeHtml(source.slice(lastIndex, match.index));
      html += `<a href="${escapeHtmlAttribute(match[2])}" target="_blank" rel="noopener noreferrer" style="color:#0a66c2;text-decoration:underline;">${escapeHtml(match[1])}</a>`;
      lastIndex = (match.index || 0) + match[0].length;
    }
    html += escapeHtml(source.slice(lastIndex));
    return html;
  }

  function renderImageVisibilityPsHtmlLine(webdesignPreviewUrl) {
    const href = normalizeString(webdesignPreviewUrl);
    if (!href) return `<em style="font-style:italic;">${escapeHtml(COLDMAIL_IMAGE_VISIBILITY_PS).replace(/\n/g, '<br>')}</em>`;
    return `<em style="font-style:italic;">PS: Wordt het webdesign niet zichtbaar?<br>Open het via <a href="${escapeHtmlAttribute(
      href
    )}" target="_blank" rel="noopener noreferrer" style="color:#0a66c2;text-decoration:underline;">hier</a> 👈</em>`;
  }

  function renderMailboxWebdesignLineHtml(line, options = {}) {
    const cleanLine = normalizeString(line);
    if (isMailboxImageVisibilityPsLine(cleanLine)) {
      return renderImageVisibilityPsHtmlLine(options.webdesignPreviewUrl);
    }
    return renderInlineMarkdownLinks(line);
  }

  function mailboxImageExtension(contentType) {
    const normalized = normalizeString(contentType).toLowerCase();
    if (normalized === 'image/png') return 'png';
    if (normalized === 'image/webp') return 'webp';
    if (normalized === 'image/gif') return 'gif';
    return 'jpg';
  }

  function mailboxImageFilename(alt, type, contentType) {
    const name = normalizeImageLabel(alt || type || 'webdesign')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70) || type || 'webdesign';
    return `${name}.${mailboxImageExtension(contentType)}`;
  }

  async function prepareMailboxInlineWebdesignImages(images, customerId) {
    const entries = (Array.isArray(images) ? images : [])
      .map((image, index) => ({ image, index }))
      .filter((entry) => entry.image && entry.image.dataUrl);
    if (!entries.length) return [];
    const mainEntry = entries.find((entry) => !isMockupBodyImage(entry.image)) || entries[0];
    const mockupEntry = entries.find((entry) => entry !== mainEntry && isMockupBodyImage(entry.image)) ||
      entries.find((entry) => entry !== mainEntry);
    const selected = [
      mainEntry ? { ...mainEntry, type: 'webdesign' } : null,
      mockupEntry ? { ...mockupEntry, type: 'mockup' } : null,
    ].filter(Boolean);
    const cidSeed = normalizeImageLabel(customerId || 'webdesign').replace(/\s+/g, '-').slice(0, 60) || 'webdesign';
    const prepared = await Promise.all(selected.map(async (entry, orderIndex) => {
      const parsed = parseImageDataUrl(entry.image.dataUrl);
      if (!parsed || !parsed.buffer.length || parsed.buffer.length > MAX_STORED_BODY_IMAGE_BYTES) return null;
      const preparedImage = entry.type === 'webdesign'
        ? await fitWebdesignPreviewForEmail({
            content: parsed.buffer,
            contentType: parsed.mimeType,
          })
        : {
            content: parsed.buffer,
            contentType: parsed.mimeType,
          };
      const content = Buffer.isBuffer(preparedImage && preparedImage.content)
        ? preparedImage.content
        : parsed.buffer;
      const contentType = normalizeString(preparedImage && preparedImage.contentType) || parsed.mimeType;
      const cid = `${entry.type}-${cidSeed}-${orderIndex + 1}@softora`;
      const alt = cleanImageAlt(entry.image.alt) || (entry.type === 'mockup' ? 'Device mockup' : 'Webdesign');
      return {
        type: entry.type,
        cid,
        src: `cid:${cid}`,
        alt,
        attachment: {
          filename: mailboxImageFilename(alt, entry.type, contentType),
          content,
          contentType,
          contentDisposition: 'inline',
          cid,
        },
      };
    }));
    return prepared.filter(Boolean);
  }

  function renderMailboxEmailImage(image, margin) {
    if (!image || !image.src) return '';
    return `\n<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;max-width:100%;margin:${margin};"><tr><td style="padding:0;margin:0;width:100%;font-size:0;line-height:0;"><img src="${escapeHtmlAttribute(
      image.src
    )}" alt="${escapeHtmlAttribute(
      image.alt
    )}" width="640" style="display:block;width:100%;max-width:640px;max-height:960px;height:auto;object-fit:contain;border:1px solid #dbe3f0;border-radius:14px;outline:none;text-decoration:none;" /></td></tr></table>`;
  }

  function renderMailboxWebdesignHtml(text, options = {}) {
    const bodyText = stripColdmailOptOutLines(text);
    const paragraphs = bodyText
      .split(/\n{2,}/)
      .map((paragraph) => normalizeString(paragraph))
      .filter(Boolean)
      .map((paragraph) => {
        if (COLDMAIL_IMAGE_VISIBILITY_PS_PATTERN.test(paragraph)) {
          return `<p style="margin:0 0 18px 0;">${renderImageVisibilityPsHtmlLine(options.webdesignPreviewUrl)}</p>`;
        }
        return `<p style="margin:0 0 18px 0;">${paragraph
            .split('\n')
            .map((line) => renderMailboxWebdesignLineHtml(line, options))
            .join('<br>')}</p>`;
      })
      .join('\n');
    const inlineImages = Array.isArray(options.inlineImages) ? options.inlineImages : [];
    const mainImage = inlineImages.find((image) => image.type === 'webdesign');
    const mockupImage = inlineImages.find((image) => image.type === 'mockup');
    const imagesHtml = [
      renderMailboxEmailImage(mainImage, '22px 0 0 0'),
      mockupImage
        ? `\n<p style="margin:22px 0 8px 0;font-size:16px;line-height:1.45;color:#1a1a2e;font-weight:700;">${escapeHtml(
            COLDMAIL_MOCKUP_CAPTION
          )}</p>${renderMailboxEmailImage(mockupImage, '0')}`
        : '',
    ].join('');
    const optOutUrl = normalizeString(options.optOutUrl);
    const optOutHtml = optOutUrl
      ? `\n<p style="margin:18px 0 0 0;font-size:11px;line-height:1.35;color:#9ca3af;"><a href="${escapeHtmlAttribute(
          optOutUrl
        )}" target="_blank" rel="noopener noreferrer" style="color:#9ca3af;text-decoration:underline;">${escapeHtml(
          COLDMAIL_OPT_OUT_LABEL
        )}</a></p>`
      : '';
    return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.65;color:#1a1a2e;">${paragraphs}${imagesHtml}${optOutHtml}</div>`;
  }

  async function buildMailboxWebdesignSendParts({ to, subject, text }) {
    const rawText = normalizeString(text);
    const parsed = {
      subject: normalizeString(subject),
      to: { value: [{ address: normalizeEmail(to) }] },
      html: '',
    };
    if (!rawText || !looksLikeWebdesignOutreach(parsed, rawText)) return null;

    const normalizedText = normalizeMailboxWebdesignText(rawText);
    try {
      const [photoState, customerState] = await Promise.all([
        getUiStateValues(customerPhotoScope),
        getUiStateValues(customerDbScope),
      ]);
      const photoValues = photoState && photoState.values && typeof photoState.values === 'object' ? photoState.values : {};
      const customerValues = customerState && customerState.values && typeof customerState.values === 'object' ? customerState.values : {};
      const photoMap = safeParseJsonObject(photoValues[customerPhotoKey]);
      const photoByIdentity = buildPhotoByIdentity(photoMap);
      const customerRows = parseCustomerRows(customerValues);
      const matches = findCustomerRowsForMail(parsed, rawText, customerRows);

      let matchedRow = null;
      let matchedId = '';
      let matchedMeta = null;
      let images = [];
      for (const { row, index } of matches) {
        const id = getCustomerId(row, index);
        const photoMeta = getPhotoMetaForRow(row, index, photoMap, photoByIdentity);
        const candidateImages = await imagesFromPhotoMeta(
          photoValues,
          photoMeta,
          `${getCustomerCompany(row) || getCustomerDomain(row) || 'Webdesign'} webdesign`
        );
        if (!candidateImages.length) continue;
        matchedRow = row;
        matchedMeta = photoMeta;
        matchedId = normalizeString(photoMeta && (photoMeta.id || photoMeta.customerId)) || id;
        images = candidateImages;
        break;
      }

      if (!images.length) {
        for (const [id, meta] of Object.entries(photoMap)) {
          if (!directPhotoMetaMatchesMail(id, meta, parsed, rawText)) continue;
          const candidateMeta = {
            ...(meta && typeof meta === 'object' ? meta : {}),
            id: normalizeString(meta && (meta.id || meta.customerId)) || id,
          };
          const candidateImages = await imagesFromPhotoMeta(photoValues, candidateMeta, candidateMeta.websitePhotoName);
          if (!candidateImages.length) continue;
          matchedMeta = candidateMeta;
          matchedId = normalizeString(candidateMeta.id || candidateMeta.customerId || id);
          images = candidateImages;
          break;
        }
      }

      const previewUrl = matchedRow
        ? buildPublicWebdesignPreviewUrlForMatch(matchedRow, matchedMeta, matchedId)
        : matchedMeta
          ? buildPublicWebdesignPreviewUrlForMatch(null, matchedMeta, matchedId)
        : extractPublicWebdesignPreviewUrlFromText(rawText);
      const inlineImages = await prepareMailboxInlineWebdesignImages(images, matchedId);
      if (!previewUrl && !inlineImages.length) return { text: normalizedText };

      return {
        text: normalizedText,
        html: renderMailboxWebdesignHtml(normalizedText, {
          webdesignPreviewUrl: previewUrl,
          inlineImages,
          optOutUrl: extractColdmailOptOutUrlFromText(rawText) || extractColdmailOptOutUrlFromText(normalizedText),
        }),
        attachments: inlineImages.map((image) => image.attachment),
      };
    } catch (error) {
      logger.warn('[Mailbox][webdesign-send]', error && error.message ? error.message : error);
      return { text: normalizedText };
    }
  }

  function directPhotoMetaMatchesMail(id, meta, parsed, text) {
    if (!looksLikeWebdesignOutreach(parsed, text)) return false;
    const haystack = normalizeImageLabel(`${normalizeString(parsed && parsed.subject)} ${text}`);
    if (!haystack) return false;
    const generic = new Set(['webdesign', 'website', 'mockup', 'device', 'foto', 'image', 'nieuw', 'nieuwe']);
    const aliases = [id, meta && meta.id, meta && meta.websitePhotoName, meta && meta.fileName]
      .map(normalizeImageLabel)
      .filter(Boolean);
    return aliases.some((alias) => {
      if (alias.length >= 5 && haystack.includes(alias)) return true;
      return alias.split(/\s+/).some((part) => part.length >= 5 && !generic.has(part) && haystack.includes(part));
    });
  }

  async function loadStoredImagesForRecords(records) {
    const candidates = (Array.isArray(records) ? records : []).filter((record) => {
      if (!record || !record.key) return false;
      if (Array.isArray(record.primaryBodyImages) && record.primaryBodyImages.length) return false;
      const labels = extractBodyImageLabels(record.text);
      return labels.length || looksLikeWebdesignOutreach(record.parsed, record.text);
    });
    if (!candidates.length || typeof getUiStateValues !== 'function') return new Map();

    try {
      const [photoState, customerState] = await Promise.all([
        getUiStateValues(customerPhotoScope),
        candidates.some((record) => !extractBodyImageLabels(record.text).length && looksLikeWebdesignOutreach(record.parsed, record.text))
          ? getUiStateValues(customerDbScope)
          : Promise.resolve(null),
      ]);
      const photoValues = photoState && photoState.values && typeof photoState.values === 'object' ? photoState.values : {};
      const customerValues = customerState && customerState.values && typeof customerState.values === 'object' ? customerState.values : {};
      const photoMap = safeParseJsonObject(photoValues[customerPhotoKey]);
      const photoByIdentity = buildPhotoByIdentity(photoMap);
      const customerRows = parseCustomerRows(customerValues);
      const result = new Map();

      for (const record of candidates) {
        const images = [];
        const seen = new Set();
        const addImages = (items) => {
          (Array.isArray(items) ? items : []).forEach((image) => {
            const key = normalizeImageLabel(image && (image.alt || image.dataUrl));
            if (!key || seen.has(key)) return;
            seen.add(key);
            images.push(image);
          });
        };

        const labels = extractBodyImageLabels(record.text);
        for (const label of labels) {
          for (const [id, meta] of Object.entries(photoMap)) {
            const aliases = [id, meta && meta.id, meta && meta.websitePhotoName, meta && meta.fileName].filter(Boolean);
            if (!aliases.some((alias) => photoLabelMatches(alias, label))) continue;
            addImages(await imagesFromPhotoMeta(photoValues, meta, label));
          }
        }

        if (!images.length && looksLikeWebdesignOutreach(record.parsed, record.text)) {
          const matches = findCustomerRowsForMail(record.parsed, record.text, customerRows);
          for (const { row, index } of matches) {
            addImages(await imagesFromPhotoMeta(
              photoValues,
              getPhotoMetaForRow(row, index, photoMap, photoByIdentity),
              `${getCustomerDomain(row) || 'Webdesign'} webdesign`
            ));
          }
        }

        if (!images.length && looksLikeWebdesignOutreach(record.parsed, record.text)) {
          for (const [id, meta] of Object.entries(photoMap)) {
            if (!directPhotoMetaMatchesMail(id, meta, record.parsed, record.text)) continue;
            addImages(await imagesFromPhotoMeta(photoValues, meta, meta && meta.websitePhotoName));
            if (images.length) break;
          }
        }

        if (images.length) {
          result.set(record.key, images.slice(0, 8));
        }
      }
      return result;
    } catch (error) {
      logger.warn('[Mailbox][body-images]', error && error.message ? error.message : error);
      return new Map();
    }
  }

  function toClientMessage(parsed, message, folder, account, options = {}) {
    const date = parsed.date || message.internalDate || new Date();
    const text = options.text || sanitizeMailboxDisplayText(normalizeString(parsed.text || parsed.html || ''));
    const optOutUrl = resolveColdmailOptOutUrl(parsed, text);
    const primaryBodyImages = Array.isArray(options.primaryBodyImages) ? options.primaryBodyImages : buildMailboxBodyImages(parsed);
    const storedImages = Array.isArray(options.storedImages) ? options.storedImages : [];
    const bodyImages = mergeMailboxBodyImages(primaryBodyImages, options.storedImages, text, {
      allowUnmatchedFallbacks: true,
    });
    const bodyText = storedImages.length && !primaryBodyImages.length
      ? decorateRecoveredWebdesignImagesText(text, bodyImages)
      : text;
    const preview = truncateText(bodyText.replace(/^\s*\[image:[^\]]+\]\s*$/gim, '').replace(/\s+/g, ' '), 140);
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
      body: bodyText || preview,
      optOutUrl,
      bodyImages,
      inlineImages: bodyImages.map(bodyImageToInlineImage),
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
        const records = [];
        for await (const message of client.fetch(selectedUids, { uid: true, flags: true, internalDate: true, source: true })) {
          const parsed = await parseMailSource(message.source);
          const text = sanitizeMailboxDisplayText(normalizeString(parsed.text || parsed.html || ''));
          const primaryBodyImages = buildMailboxBodyImages(parsed);
          records.push({
            key: `${normalizedFolder}:${message.uid}`,
            message,
            parsed,
            text,
            primaryBodyImages,
          });
        }
        const storedImagesByKey = await loadStoredImagesForRecords(records);
        const messages = records.map((record) =>
          toClientMessage(record.parsed, record.message, normalizedFolder, account, {
            text: record.text,
            primaryBodyImages: record.primaryBodyImages,
            storedImages: storedImagesByKey.get(record.key) || [],
          })
        );
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

  function getElapsedMs(startedAt) {
    return Math.max(0, Date.now() - startedAt);
  }

  async function listMessagesWithMeta({
    accountEmail,
    folder = 'inbox',
    limit = 50,
    allowLiveImapFallback = true,
  } = {}) {
    const startedAt = Date.now();
    const account = assertReadableAccount(accountEmail);
    const normalizedFolder = normalizeFolder(folder);
    const safeLimit = getSafeLimit(limit);
    const indexClientAvailable = canUseMailboxIndex();
    const indexedMessages = await readIndexedMessages({ account, folder: normalizedFolder, limit: safeLimit });
    const indexReadable = Array.isArray(indexedMessages);

    if (Array.isArray(indexedMessages) && indexedMessages.length) {
      const sync = await getMailboxSyncMeta({ account, folder: normalizedFolder });
      return {
        messages: indexedMessages,
        sync: {
          ...sync,
          stale: Boolean(sync.stale),
          refreshRecommended: Boolean(sync.stale),
          indexAvailable: true,
          warming: false,
          durationMs: getElapsedMs(startedAt),
        },
      };
    }

    if (indexReadable && !allowLiveImapFallback) {
      const sync = await getMailboxSyncMeta({ account, folder: normalizedFolder });
      return {
        messages: [],
        sync: {
          ...sync,
          indexed: true,
          stale: Boolean(sync.stale),
          source: 'index-empty',
          refreshRecommended: true,
          indexAvailable: true,
          warming: true,
          durationMs: getElapsedMs(startedAt),
        },
      };
    }

    if ((!indexClientAvailable || !indexReadable) && !allowLiveImapFallback) {
      return {
        messages: [],
        sync: {
          indexed: false,
          stale: true,
          source: 'index-unavailable',
          refreshRecommended: false,
          indexAvailable: false,
          warming: false,
          durationMs: getElapsedMs(startedAt),
        },
      };
    }

    const messages = await fetchMessagesFromImap({ account, folder: normalizedFolder, limit: safeLimit });
    return {
      messages,
      sync: {
        indexed: false,
        stale: false,
        source: 'imap-live',
        refreshRecommended: false,
        indexAvailable: indexReadable,
        warming: false,
        durationMs: getElapsedMs(startedAt),
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

  async function deleteMessage({ accountEmail, id, folder, uid }) {
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
      const sourceMailboxName = await resolveMailboxName(client, messageRef.folder);
      if (!sourceMailboxName) {
        const error = new Error('Mailboxmap niet gevonden.');
        error.status = 404;
        throw error;
      }
      const lock = await client.getMailboxLock(sourceMailboxName);
      try {
        if (messageRef.folder === 'trash') {
          await client.messageFlagsAdd([messageRef.uid], ['\\Deleted'], { uid: true });
          if (typeof client.mailboxClose === 'function') await client.mailboxClose();
          return {
            account: account.email,
            folder: messageRef.folder,
            uid: messageRef.uid,
            deleted: true,
            permanent: true,
          };
        }

        const trashMailboxName = await resolveMailboxName(client, 'trash');
        if (!trashMailboxName) {
          const error = new Error('Prullenbakmap niet gevonden voor deze mailbox.');
          error.status = 404;
          throw error;
        }
        if (typeof client.messageMove !== 'function') {
          const error = new Error('Deze mailbox ondersteunt verplaatsen naar prullenbak niet.');
          error.status = 503;
          throw error;
        }
        await client.messageMove([messageRef.uid], trashMailboxName, { uid: true });
        return {
          account: account.email,
          folder: messageRef.folder,
          destinationFolder: 'trash',
          uid: messageRef.uid,
          deleted: true,
          moved: true,
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
    const normalizedText = normalizeString(text);
    const webdesignParts = await buildMailboxWebdesignSendParts({
      to,
      subject: cleanSubject,
      text: normalizedText,
    });
    const mail = {
      from: account.name ? `${account.name} <${account.email}>` : account.email,
      to: normalizeEmail(to),
      subject: cleanSubject,
      text: webdesignParts?.text || normalizedText,
    };
    if (webdesignParts?.html) mail.html = webdesignParts.html;
    if (Array.isArray(webdesignParts?.attachments) && webdesignParts.attachments.length) {
      mail.attachments = webdesignParts.attachments;
    }
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
          ...buildOpenAiContextHeaders({ env, openAiApiBaseUrl: baseUrl }),
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
      const result = await listMessagesWithMeta({
        accountEmail: req.query?.account,
        folder: normalizeFolder(req.query?.folder || 'inbox'),
        limit: Number(req.query?.limit || 50) || 50,
        allowLiveImapFallback: req.query?.fallback === 'imap-live',
      });
      if (Number.isFinite(Number(result.sync?.durationMs))) {
        res.setHeader('Server-Timing', `mailbox;dur=${Number(result.sync.durationMs)}`);
      }
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

  async function deleteMessageResponse(req, res) {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await deleteMessage({
        accountEmail: body.account,
        id: body.id || body.messageId,
        folder: body.folder,
        uid: body.uid,
      });
      return res.status(200).json({ ok: true, result });
    } catch (error) {
      logger.error('[Mailbox][Delete]', error?.message || error);
      return res.status(error.status || 500).json({
        ok: false,
        error: 'Mail verwijderen mislukt',
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
    getMessageResponse,
    listMessagesResponse,
    sendMessageResponse,
    markMessageReadResponse,
    deleteMessageResponse,
    rewriteDraftResponse,
    getAccounts,
    getMessage,
    listMessages,
    listMessagesWithMeta,
    syncMailboxResponse,
    markMessageRead,
    deleteMessage,
    sendMessage,
    rewriteDraft,
    syncMailbox,
    syncMailboxFolder,
  };
}

module.exports = {
  createMailboxService,
  sanitizeMailboxDisplayText,
};
