(function () {
"use strict";
const MAILBOX_ACCOUNT_DEFAULT = 'info@softora.nl';
const MAILBOX_SENDER_SETTINGS_SCOPE = 'premium_coldmailing_settings';
const MAILBOX_SENDER_SETTINGS_KEY = 'softora_coldmailing_settings_v1';
const MAILBOX_PIN_SCOPE = 'premium_mailbox_preferences';
const MAILBOX_PIN_KEY = 'softora_mailbox_pinned_account_v1';
let activeMailboxAccount = MAILBOX_ACCOUNT_DEFAULT, pinnedMailboxAccount = '', mailboxAccountPreferenceIdentity = 'anonymous', mailboxPinPreferences = Object.create(null);
let mailboxAccounts = [
  { email: 'info@softora.nl', name: 'info@softora.nl', imapConfigured: false, smtpConfigured: false },
];
const avatarColors = ['#9b2355','#1a5f8a','#16733c','#7b3f00','#4a1a6b','#b45a00','#2c6e49'];
const getColor = str => {
  const value = String(str || '?');
  return avatarColors[value.charCodeAt(0) % avatarColors.length];
};
const initials = name => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const value = parts.map(word => word[0]).join('').toUpperCase();
  return value || '?';
};
let toastTimer = 0;
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
const MAIL_BODY_URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
function countCharacter(value, character) {
  return String(value || '').split(character).length - 1;
}
function splitUrlTrailingPunctuation(value) {
  let url = String(value || '');
  let suffix = '';
  while (url) {
    const last = url.slice(-1);
    if (!/[.,!?;:)\]]/.test(last)) break;
    if (last === ')' && countCharacter(url, ')') <= countCharacter(url, '(')) break;
    if (last === ']' && countCharacter(url, ']') <= countCharacter(url, '[')) break;
    suffix = last + suffix;
    url = url.slice(0, -1);
  }
  return { url, suffix };
}
function isSafeMailBodyUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}
function renderLinkedMailboxText(value) {
  const text = String(value == null ? '' : value);
  let html = '';
  let lastIndex = 0;
  text.replace(MAIL_BODY_URL_PATTERN, (match, offset) => {
    const { url, suffix } = splitUrlTrailingPunctuation(match);
    html += escapeHtml(text.slice(lastIndex, offset));
    if (url && isSafeMailBodyUrl(url)) {
      html += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>${escapeHtml(suffix)}`;
    } else {
      html += escapeHtml(match);
    }
    lastIndex = offset + match.length;
    return match;
  });
  html += escapeHtml(text.slice(lastIndex));
  return html;
}
function normalizeMailboxEmail(value) {
  return String(value || '').trim().toLowerCase();
}
function getMailboxAccountEmails() {
  return mailboxAccounts.map((account) => normalizeMailboxEmail(account.email)).filter(Boolean);
}
function hasMailboxAccount(email) {
  const normalized = normalizeMailboxEmail(email);
  return Boolean(normalized && getMailboxAccountEmails().includes(normalized));
}
function resolveMailboxPreferenceIdentity(session) {
  const source = session && typeof session === 'object' ? session : {};
  const value = String(source.userId || source.email || source.displayName || '').trim().toLowerCase();
  return value.replace(/[^a-z0-9@._-]+/g, '_') || 'anonymous';
}
function parseMailboxJsonObject(value) {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '').trim());
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}
async function readMailboxPinPreferences() {
  try {
    const client = window.SoftoraUiStateClient;
    if (!client || typeof client.get !== 'function') return Object.create(null);
    const payload = await client.get(MAILBOX_PIN_SCOPE);
    const values = payload && typeof payload === 'object' && payload.values && typeof payload.values === 'object' ? payload.values : {};
    const parsed = parseMailboxJsonObject(values[MAILBOX_PIN_KEY]) || {};
    return Object.entries(parsed).reduce((next, [identity, email]) => {
      const cleanIdentity = String(identity || '').replace(/[^a-z0-9@._-]+/g, '_') || 'anonymous';
      const cleanEmail = normalizeMailboxEmail(email);
      if (cleanEmail) next[cleanIdentity] = cleanEmail;
      return next;
    }, Object.create(null));
  } catch (_) {
    return mailboxPinPreferences && typeof mailboxPinPreferences === 'object' ? mailboxPinPreferences : Object.create(null);
  }
}
async function writePinnedMailboxAccount(email) {
  const normalized = normalizeMailboxEmail(email);
  if (normalized) mailboxPinPreferences[mailboxAccountPreferenceIdentity] = normalized;
  else delete mailboxPinPreferences[mailboxAccountPreferenceIdentity];
  try {
    const client = window.SoftoraUiStateClient;
    if (!client || typeof client.set !== 'function') return false;
    await client.set(MAILBOX_PIN_SCOPE, {
      patch: { [MAILBOX_PIN_KEY]: JSON.stringify(mailboxPinPreferences) },
      source: 'premium-mailbox',
      actor: 'browser'
    });
    return true;
  } catch (_) {
    return false;
  }
}
async function initializeMailboxAccountPreference() {
  try {
    const response = await fetch('/api/auth/session', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const payload = await response.json().catch(() => ({}));
    const session = payload && payload.session ? payload.session : payload;
    mailboxAccountPreferenceIdentity = resolveMailboxPreferenceIdentity(session);
  } catch (_) {
    mailboxAccountPreferenceIdentity = 'anonymous';
  }
  mailboxPinPreferences = await readMailboxPinPreferences();
  pinnedMailboxAccount = normalizeMailboxEmail(mailboxPinPreferences[mailboxAccountPreferenceIdentity] || '');
}
const MAILBOX_TRACKING_HOST_PATTERNS = [
  /(^|\.)sendgrid\.net$/i,
  /(^|\.)ct\.sendgrid\.net$/i,
  /(^|\.)mandrillapp\.com$/i,
  /(^|\.)list-manage\.com$/i,
  /(^|\.)mailchimp\.com$/i,
  /(^|\.)mailgun\.org$/i,
  /(^|\.)postmarkapp\.com$/i,
];
const MAILBOX_IMAGE_ASSET_EXTENSIONS = /\.(?:apng|avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:[?#].*)?$/i;
const MAILBOX_COLDMAIL_OPT_OUT_LABEL = 'Geen webdesign willen ontvangen? Laat het me weten!';
const MAILBOX_WEBDESIGN_MOCKUP_CAPTION = 'Zo zal het design er ongeveer uit gaan zien op mobiel, tablet en laptop👇';
const MAILBOX_REPLY_HEADER_PATTERNS = [
  /^op .+\bschreef\b[:\s]*$/i,
  /^on .+\bwrote\b[:\s]*$/i,
  /^van:\s.+$/i,
  /^from:\s.+$/i,
];
const MAILBOX_SIGNATURE_START_PATTERNS = [
  /^met vriendelijke groet[,!]*$/i,
  /^vriendelijke groet(?:en)?[,!]*$/i,
  /^hartelijke groet(?:en)?[,!]*$/i,
  /^groet(?:en)?[,!]*$/i,
  /^kind regards[,!]*$/i,
  /^best regards[,!]*$/i,
  /^cheers[,!]*$/i,
  /^--$/,
];
function parseMailboxUrl(value) {
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
function isMailboxTrackingUrl(value) {
  const parsed = parseMailboxUrl(value);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  return MAILBOX_TRACKING_HOST_PATTERNS.some((pattern) => pattern.test(host)) ||
    /\/(?:wf\/open|open|click|ls\/click|track|tracking)\b/i.test(path);
}
function isMailboxStandaloneAssetUrl(value) {
  const parsed = parseMailboxUrl(value);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  const path = decodeURIComponent(parsed.pathname || '').toLowerCase();
  return MAILBOX_IMAGE_ASSET_EXTENSIONS.test(path) ||
    (host === 'cdn.openai.com' && /(?:logo|asset|image|header)/i.test(path));
}
function isMailboxTechnicalUrl(value, options) {
  if (isMailboxTrackingUrl(value)) return true;
  return Boolean(options && options.standalone && isMailboxStandaloneAssetUrl(value));
}
function cleanMailboxText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u200B/g, '')
    .split('\n')
    .map((line) => String(line || '')
      .replace(/\[(https?:\/\/[^\]\s]+)\]/gi, (match, url) => isMailboxTechnicalUrl(url) ? '' : match)
      .replace(/<((?:https?:\/\/)[^>\s]+)>/gi, (match, url) => isMailboxTechnicalUrl(url) ? '' : match)
      .replace(/\s{2,}/g, ' ')
      .trimEnd())
    .filter((line) => {
      const value = String(line || '').trim();
      const url = value.match(/^\[(https?:\/\/[^\]]+)\]$/i)?.[1] ||
        value.match(/^<(https?:\/\/[^>]+)>$/i)?.[1] ||
        value.match(/^(https?:\/\/\S+)$/i)?.[1] ||
        '';
      return !(url && isMailboxTechnicalUrl(url, { standalone: true }));
    })
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function isMailboxReplyHeaderLine(line) {
  const value = String(line || '').trim();
  return MAILBOX_REPLY_HEADER_PATTERNS.some((pattern) => pattern.test(value));
}
function isMailboxSignatureStartLine(line) {
  const value = String(line || '').trim();
  return MAILBOX_SIGNATURE_START_PATTERNS.some((pattern) => pattern.test(value));
}
function stripMailboxQuotePrefix(line) {
  return String(line || '').replace(/^\s*(?:>\s*)+/, '').trimEnd();
}
function isMailboxSafeOptOutUrl(value) {
  const parsed = parseMailboxUrl(value);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  return host === 'softora.nl' && parsed.pathname.replace(/\/+$/, '') === '/afmelden';
}
function normalizeMailboxOptOutUrl(value) {
  const parsed = parseMailboxUrl(value);
  return parsed && isMailboxSafeOptOutUrl(parsed.href) ? parsed.href : '';
}
function renderMailboxOptOutLink(url) {
  return `<a class="detail-mail-optout-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(MAILBOX_COLDMAIL_OPT_OUT_LABEL)}</a>`;
}
function renderMailboxTextLine(line, options) {
  const value = String(line || '');
  const trimmed = value.trim();
  if (trimmed === MAILBOX_WEBDESIGN_MOCKUP_CAPTION) {
    return `<span class="detail-mail-image-caption">${escapeHtml(trimmed)}</span>`;
  }
  const optOutMatch = trimmed.match(/^(Geen webdesign willen ontvangen\? Laat het me weten!):?\s*(?:\[(https?:\/\/[^\]]+)\]|(https?:\/\/\S+))$/i);
  const inlineOptOutUrl = optOutMatch ? normalizeMailboxOptOutUrl(optOutMatch[2] || optOutMatch[3] || '') : '';
  if (inlineOptOutUrl) {
    return renderMailboxOptOutLink(inlineOptOutUrl);
  }
  const fallbackOptOutUrl = normalizeMailboxOptOutUrl(options && options.optOutUrl);
  if (fallbackOptOutUrl && /^Geen webdesign willen ontvangen\? Laat het me weten![:\s]*$/i.test(trimmed)) {
    return renderMailboxOptOutLink(fallbackOptOutUrl);
  }
  return renderLinkedMailboxText(value);
}
function normalizeMailboxImageLabel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[a-z0-9]{2,5}$/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function isMailboxMockupImageLabel(value) {
  return /\b(?:device|mockup|laptop|ipad|iphone|tablet|mobiel)\b/i.test(String(value || ''));
}
function isMailboxWebdesignImageLabel(value) {
  return /\b(?:webdesign|website|site|foto|screenshot)\b/i.test(String(value || ''));
}
function sectionHasMailboxImagePlaceholder(section) {
  return Boolean(section && Array.isArray(section.lines) && section.lines.some((line) => /^\s*\[image:\s*[^\]]+\]\s*$/i.test(String(line || ''))));
}
function buildMailboxBodySections(value) {
  const text = cleanMailboxText(value);
  if (!text) {
    return [{ type: 'body', lines: ['Geen inhoud.'] }];
  }
  const sections = [];
  const lines = text.split('\n');
  let currentType = 'body';
  let currentLines = [];
  let signatureStarted = false;
  let quotedThreadStarted = false;
  function pushSection() {
    if (!currentLines.length) return;
    if (!currentLines.some((line) => String(line || '').trim())) {
      currentLines = [];
      return;
    }
    sections.push({ type: currentType, lines: currentLines.slice() });
    currentLines = [];
  }
  lines.forEach((line) => {
    const rawLine = String(line || '');
    const trimmed = rawLine.trim();
    const isReplyHeader = isMailboxReplyHeaderLine(trimmed);
    const isQuoteLine = /^\s*>/.test(rawLine);
    if (isReplyHeader) {
      quotedThreadStarted = true;
      signatureStarted = false;
      if (currentType !== 'quote') {
        pushSection();
        currentType = 'quote';
      }
      currentLines.push(trimmed);
      return;
    }
    if (isQuoteLine) {
      quotedThreadStarted = true;
      signatureStarted = false;
      if (currentType !== 'quote') {
        pushSection();
        currentType = 'quote';
      }
      currentLines.push(stripMailboxQuotePrefix(rawLine));
      return;
    }
    if (quotedThreadStarted) {
      if (currentType !== 'quote') {
        pushSection();
        currentType = 'quote';
      }
      currentLines.push(rawLine);
      return;
    }
    if (!signatureStarted && isMailboxSignatureStartLine(trimmed)) {
      signatureStarted = true;
      if (currentType !== 'signature') {
        pushSection();
        currentType = 'signature';
      }
      currentLines.push(rawLine);
      return;
    }
    if (signatureStarted) {
      if (currentType !== 'signature') {
        pushSection();
        currentType = 'signature';
      }
      currentLines.push(rawLine);
      return;
    }
    if (currentType !== 'body') {
      pushSection();
      currentType = 'body';
    }
    currentLines.push(rawLine);
  });
  pushSection();
  return sections.length ? sections : [{ type: 'body', lines: ['Geen inhoud.'] }];
}
function renderMailboxParagraphs(lines, options) {
  const renderedLines = [];
  const quoteBody = Boolean(options && options.quoteBody);
  const images = Array.isArray(options && options.images) ? options.images : [];
  const usedImages = options && options.usedImages instanceof Set ? options.usedImages : new Set();
  function pushTextLine(line) {
    const value = String(line || '');
    if (!value.trim()) {
      renderedLines.push('<div class="detail-mail-line detail-mail-line-empty" aria-hidden="true">&nbsp;</div>');
      return;
    }
    renderedLines.push(`<div class="detail-mail-line">${renderMailboxTextLine(value, options)}</div>`);
  }
  function findImageByAlt(alt) {
    const rawAlt = String(alt || '').trim();
    const normalizedAlt = normalizeMailboxImageLabel(rawAlt);
    if (!normalizedAlt) return null;
    const candidates = images
      .map((image, index) => ({ image, index, label: normalizeMailboxImageLabel(image && image.alt) }))
      .filter((entry) => entry.label && !usedImages.has(entry.index));
    return candidates.find((entry) => entry.label === normalizedAlt) ||
      candidates.find((entry) => entry.label.includes(normalizedAlt) || normalizedAlt.includes(entry.label)) ||
      (isMailboxMockupImageLabel(rawAlt) ? candidates.find((entry) => isMailboxMockupImageLabel(entry.image && entry.image.alt)) : null) ||
      (isMailboxWebdesignImageLabel(rawAlt) ? candidates.find((entry) => !isMailboxMockupImageLabel(entry.image && entry.image.alt)) : null) ||
      candidates[0] ||
      null;
  }
  lines.forEach((line) => {
    const value = String(line || '');
    const cleaned = quoteBody ? stripMailboxQuotePrefix(value) : value.trimEnd();
    const imageAlt = cleaned.trim().match(/^\[image:\s*([^\]]+)\]$/i)?.[1] || '';
    const imageEntry = findImageByAlt(imageAlt);
    if (imageEntry) {
      usedImages.add(imageEntry.index);
      renderedLines.push(renderMailboxInlineImage(imageEntry.image));
      return;
    }
    if (imageAlt) {
      return;
    }
    pushTextLine(cleaned);
  });
  return renderedLines.length
    ? `<div class="detail-mail-lines">${renderedLines.join('')}</div>`
    : '<div class="detail-mail-lines"><div class="detail-mail-line">Geen inhoud.</div></div>';
}
function renderMailboxInlineImage(image) {
  const dataUrl = String(image && image.dataUrl || '').trim();
  if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(dataUrl)) return '';
  const alt = String(image && image.alt || 'Afbeelding').trim() || 'Afbeelding';
  return `<figure class="detail-mail-image"><img src="${escapeHtml(dataUrl)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async"></figure>`;
}
function renderMailboxBodySection(section, imageState) {
  if (!section || !Array.isArray(section.lines)) {
    return '<section class="detail-mail-section"><p>Geen inhoud.</p></section>';
  }
  if (section.type === 'quote') {
    const firstLine = String(section.lines[0] || '').trim();
    const hasMeta = isMailboxReplyHeaderLine(firstLine);
    const quoteMeta = hasMeta ? `<div class="detail-mail-quote-meta">${escapeHtml(firstLine)}</div>` : '';
    const quoteLines = hasMeta ? section.lines.slice(1) : section.lines;
    return `
      <section class="detail-mail-section detail-mail-section-quote">
        <div class="detail-mail-section-label">Eerdere mail</div>
        ${quoteMeta}
        <div class="detail-mail-quote-body">${renderMailboxParagraphs(quoteLines, { quoteBody: true, images: imageState.images, optOutUrl: imageState.optOutUrl, usedImages: imageState.usedImages })}</div>
      </section>`;
  }
  if (section.type === 'signature') {
    return `
      <section class="detail-mail-section detail-mail-section-signature">
        ${renderMailboxParagraphs(section.lines, imageState)}
      </section>`;
  }
  return `
    <section class="detail-mail-section">
      ${renderMailboxParagraphs(section.lines, imageState)}
    </section>`;
}
function renderUnusedMailboxInlineImages(imageState) {
  if (!imageState || !Array.isArray(imageState.images) || !(imageState.usedImages instanceof Set)) return '';
  const unusedImages = imageState.images
    .map((image, index) => ({ image, index }))
    .filter((entry) => !imageState.usedImages.has(entry.index));
  if (!unusedImages.length) return '';
  unusedImages.forEach((entry) => imageState.usedImages.add(entry.index));
  const renderedImages = unusedImages
    .map((entry) => renderMailboxInlineImage(entry.image))
    .filter(Boolean)
    .join('');
  if (!renderedImages) return '';
  return `<section class="detail-mail-section detail-mail-section-images">${renderedImages}</section>`;
}
function normalizeMailboxBodyImages(images) {
  return (Array.isArray(images) ? images : [])
    .map((image) => ({
      alt: String(image && image.alt || '').trim(),
      dataUrl: String(image && image.dataUrl || '').trim(),
    }))
    .filter((image) => image.alt && /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(image.dataUrl));
}
function renderMailBody(value, images, options) {
  const imageState = {
    images: normalizeMailboxBodyImages(images),
    optOutUrl: normalizeMailboxOptOutUrl(options && options.optOutUrl),
    usedImages: new Set()
  };
  const sections = buildMailboxBodySections(value);
  const hasImagePlaceholders = sections.some(sectionHasMailboxImagePlaceholder);
  const renderedSections = [];
  let injectedImages = false;
  sections.forEach((section) => {
    if (!hasImagePlaceholders && !injectedImages && section && section.type === 'signature') {
      const imagesHtml = renderUnusedMailboxInlineImages(imageState);
      if (imagesHtml) renderedSections.push(imagesHtml);
      injectedImages = true;
    }
    renderedSections.push(renderMailboxBodySection(section, imageState));
  });
  if (!injectedImages) {
    const imagesHtml = renderUnusedMailboxInlineImages(imageState);
    if (imagesHtml) renderedSections.push(imagesHtml);
  }
  return renderedSections.join('');
}
function findMailById(id) {
  const key = String(id);
  return mails.find(mail => String(mail.id) === key);
}
function getMailboxAccounts() {
  return getMailboxAccountEmails();
}
function getMailboxAccount() {
  return activeMailboxAccount;
}
async function loadMailboxSenderProfile() {
  if (!window.SoftoraCampaignSenderSettings || typeof window.SoftoraCampaignSenderSettings.loadProfileForSender !== 'function') return null;
  try {
    return await window.SoftoraCampaignSenderSettings.loadProfileForSender(getMailboxAccount(), {
      scope: MAILBOX_SENDER_SETTINGS_SCOPE,
      key: MAILBOX_SENDER_SETTINGS_KEY,
    });
  } catch (_) {
    return null;
  }
}
function closeMailboxAccountMenu() {
  const switcher = document.getElementById('mailbox-account-switcher');
  const menu = document.getElementById('mailbox-account-menu');
  if (switcher) switcher.setAttribute('aria-expanded', 'false');
  if (menu) menu.classList.remove('open');
}
function renderMailboxAccountMenu() {
  const menu = document.getElementById('mailbox-account-menu');
  if (!menu) return;
  const activeEmail = getMailboxAccount();
  const accountsForMenu = mailboxAccounts.slice().sort((a, b) => {
    const aPinned = normalizeMailboxEmail(a.email) === pinnedMailboxAccount;
    const bPinned = normalizeMailboxEmail(b.email) === pinnedMailboxAccount;
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    return String(a.email || '').localeCompare(String(b.email || ''), 'nl');
  });
  menu.innerHTML = accountsForMenu.map((account) => {
    const email = normalizeMailboxEmail(account.email);
    const unavailable = !account.imapConfigured && !account.smtpConfigured;
    const isPinned = email === pinnedMailboxAccount;
    return `
    <div class="topbar-mailbox-option-row${isPinned ? ' pinned' : ''}">
      <button class="topbar-mailbox-option${email === activeEmail ? ' active' : ''}" type="button" data-mailbox-email="${escapeHtml(email)}" role="menuitemradio" aria-checked="${email === activeEmail ? 'true' : 'false'}">
        <span>${escapeHtml(email)}${unavailable ? ' · niet gekoppeld' : ''}</span>
      </button>
      <button class="topbar-mailbox-pin${isPinned ? ' active' : ''}" type="button" data-mailbox-pin-email="${escapeHtml(email)}" aria-label="${isPinned ? 'Vastgepind mailadres' : 'Mailadres vastpinnen'}" title="${isPinned ? 'Vastgepind mailadres' : 'Mailadres vastpinnen'}">
        <svg viewBox="0 0 24 24" fill="${isPinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14 4l6 6-4 1-4.5 4.5L11 20l-7-7 4.5-.5L13 8l1-4z"/><path d="M8.5 15.5 4 20"/></svg>
      </button>
    </div>
  `;
  }).join('');
}
function setMailboxAccountUi(email) {
  const top = document.getElementById('topbar-mailbox-account');
  if (top) top.textContent = email;
  renderMailboxAccountMenu();
}
let mails = [];
let activeFolder = 'inbox';
let activeMail = null;
let inboxUnreadCount = 0;
let composeReplyContext = null;
function resetDetailEmpty() {
  document.getElementById('mail-detail').innerHTML = `<div class="detail-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M22 12h-6l-2 3H10l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg><p>Selecteer een e-mail om te lezen</p></div>`;
}
function formatMailDate(value) {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) return { date: '', time: '' };
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return {
    date: sameDay ? 'Vandaag' : date.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' }),
    time: date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }),
  };
}
function normalizeMailboxApiMessage(message) {
  const when = formatMailDate(message.date);
  const body = cleanMailboxText(message.body || message.preview || '');
  const preview = cleanMailboxText(message.preview || body).replace(/\s+/g, ' ').slice(0, 160);
  const bodyImages = normalizeMailboxBodyImages(message.bodyImages);
  const optOutUrl = normalizeMailboxOptOutUrl(message.optOutUrl);
  const mail = {
    id: message.id,
    folder: message.folder || activeFolder,
    from: message.from || 'Onbekend',
    email: message.email || '',
    to: message.to || '',
    subject: message.subject || '(Geen onderwerp)',
    preview,
    body,
    optOutUrl,
    bodyImages,
    messageId: message.messageId || '',
    inReplyTo: message.inReplyTo || '',
    references: message.references || '',
    time: when.time,
    date: when.date,
    uid: message.uid,
    unread: Boolean(message.unread),
    starred: Boolean(message.starred),
    tags: [],
  };
  return window.SoftoraMailboxIndex && typeof window.SoftoraMailboxIndex.decorateMessage === 'function'
    ? window.SoftoraMailboxIndex.decorateMessage(mail, message)
    : mail;
}
async function loadMailboxAccounts() {
  try {
    const response = await fetch('/api/mailbox/accounts', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.ok && Array.isArray(data.accounts) && data.accounts.length) {
      mailboxAccounts = data.accounts
        .map((account) => Object.assign({}, account, { email: normalizeMailboxEmail(account.email) }))
        .filter((account) => account.email);
      if (pinnedMailboxAccount && hasMailboxAccount(pinnedMailboxAccount)) {
        activeMailboxAccount = pinnedMailboxAccount;
      } else if (!hasMailboxAccount(activeMailboxAccount)) {
        activeMailboxAccount = hasMailboxAccount(MAILBOX_ACCOUNT_DEFAULT) ? MAILBOX_ACCOUNT_DEFAULT : mailboxAccounts[0].email;
      }
      renderMailboxAccountMenu();
      setMailboxAccountUi(activeMailboxAccount);
    }
  } catch (_) {
    toast('Mailboxaccounts laden mislukt');
  }
}
async function hydrateMailboxOutreachContextsInBackground() {
  if (!window.SoftoraMailboxIndex || typeof window.SoftoraMailboxIndex.hydrateOutreachContexts !== 'function') return;
  await window.SoftoraMailboxIndex.hydrateOutreachContexts({
    getMails: () => mails,
    setMails: (nextMails) => { mails = Array.isArray(nextMails) ? nextMails : []; },
    renderList,
    getActiveMail: () => activeMail,
    openMail,
    toast,
  });
}
async function syncMailboxInBackground() {
  if (!window.SoftoraMailboxIndex || typeof window.SoftoraMailboxIndex.syncInBackground !== 'function') return;
  await window.SoftoraMailboxIndex.syncInBackground({
    account: activeMailboxAccount,
    folder: activeFolder,
    loadMessages: loadMailboxMessages,
  });
}
async function loadMailboxMessages(options = {}) {
  const wrap = document.getElementById('mail-items');
  const showLoader = options.showLoader !== false;
  if (wrap && showLoader) {
    wrap.innerHTML = `<div style="padding:40px;text-align:center;font-size:13px;color:var(--text-light)">Mailbox laden…</div>`;
  }
  try {
    const response = await fetch(`/api/mailbox/messages?account=${encodeURIComponent(activeMailboxAccount)}&folder=${encodeURIComponent(activeFolder)}&limit=50`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      throw new Error(data?.detail || data?.error || 'Mailbox laden mislukt');
    }
    mails = Array.isArray(data.messages) ? data.messages.map(normalizeMailboxApiMessage) : [];
    renderList();
    void hydrateMailboxOutreachContextsInBackground().catch(() => {});
    if (!options.skipBackgroundSync && data?.sync?.refreshRecommended) {
      void syncMailboxInBackground();
    } else if (!window.SoftoraMailboxIndex || !window.SoftoraMailboxIndex.isSyncInFlight()) {
      window.SoftoraMailboxIndex?.setStatus('');
    }
  } catch (error) {
    mails = [];
    window.SoftoraMailboxIndex?.setStatus('');
    syncInboxBadgeFromCurrentFolder();
    if (wrap) {
      wrap.innerHTML = `<div style="padding:40px;text-align:center;font-size:13px;color:var(--text-light)">${escapeHtml(error?.message || error || 'Mailbox laden mislukt')}</div>`;
    }
    toast(String(error?.message || error || 'Mailbox laden mislukt'));
  }
}
async function applyMailboxAccount(email, options = {}) {
  const normalizedEmail = normalizeMailboxEmail(email);
  activeMailboxAccount = hasMailboxAccount(normalizedEmail) ? normalizedEmail : (mailboxAccounts[0]?.email || MAILBOX_ACCOUNT_DEFAULT);
  activeFolder = String(options.folder || 'inbox').trim().toLowerCase() || 'inbox';
  activeMail = null;
  const searchInput = document.getElementById('search-input');
  if (searchInput && !options.keepSearch) searchInput.value = '';
  applyMailboxFolderUi(activeFolder);
  setMailboxAccountUi(activeMailboxAccount);
  resetDetailEmpty();
  await loadMailboxMessages();
}
async function pinMailboxAccount(email) {
  const normalizedEmail = normalizeMailboxEmail(email);
  if (!hasMailboxAccount(normalizedEmail)) return;
  pinnedMailboxAccount = normalizedEmail;
  const saved = await writePinnedMailboxAccount(normalizedEmail);
  renderMailboxAccountMenu();
  await applyMailboxAccount(normalizedEmail);
  toast(saved ? `Mailbox vastgepind: ${normalizedEmail}` : `Mailbox gekozen: ${normalizedEmail}. Vastpinnen opslaan mislukt.`);
}
function setFolder(folder, el) {
  activeFolder = folder;
  activeMail = null;
  void el;
  applyMailboxFolderUi(folder);
  resetDetailEmpty();
  void loadMailboxMessages();
}
function getMailsForFolder(folder) {
  if (['offerte','factuur','klant'].includes(folder)) return mails.filter(m => m.tags.includes(folder));
  if (folder === 'starred') return mails.filter(m => m.starred);
  return mails;
}
function filterMails() { renderList(); }
function renderInboxBadge() {
  const badge = document.getElementById('badge-inbox');
  if (!badge) return;
  const count = Number.isFinite(inboxUnreadCount) && inboxUnreadCount > 0 ? inboxUnreadCount : 0;
  badge.textContent = String(count);
  badge.hidden = count === 0;
}
function syncInboxBadgeFromCurrentFolder() {
  if (activeFolder === 'inbox') {
    inboxUnreadCount = mails.filter(m => m.folder === 'inbox' && m.unread).length;
  }
  renderInboxBadge();
}
function renderList() {
  const searchInput = document.getElementById('search-input');
  const q = ((searchInput && searchInput.value) || '').toLowerCase();
  let list = getMailsForFolder(activeFolder);
  const displayOptions = { activeFolder, account: getMailboxAccount() };
  if (q) list = list.filter(m => window.SoftoraMailboxDisplay.buildSearchText(m, displayOptions).includes(q));
  const wrap = document.getElementById('mail-items');
  if (!wrap) return;
  syncInboxBadgeFromCurrentFolder();
  if (!list.length) { wrap.innerHTML = `<div style="padding:40px;text-align:center;font-size:13px;color:var(--text-light)">Geen e-mails gevonden.</div>`; return; }
  wrap.innerHTML = list.map(m => `
    <div class="mail-item ${m.unread ? 'unread' : ''} ${String(activeMail) === String(m.id) ? 'active' : ''}" data-mailbox-action="open-mail" data-mailbox-id="${escapeHtml(m.id)}" role="button" tabindex="0">
      ${m.unread ? '<div class="unread-dot"></div>' : ''}
      <div class="mail-item-top">
        <div class="mail-from">${escapeHtml(window.SoftoraMailboxDisplay.getListPrimaryText(m, displayOptions))}</div>
        <div class="mail-time">${escapeHtml(m.time)}</div>
      </div>
      <div class="mail-subject">${escapeHtml(m.subject)}</div>
      <div class="mail-preview">${escapeHtml(m.preview)}</div>
    </div>`).join('');
}
async function persistMailReadState(mail) {
  if (!mail) return;
  try {
    const response = await fetch('/api/mailbox/messages/read', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        account: activeMailboxAccount,
        id: mail.id,
        uid: mail.uid,
        folder: mail.folder || activeFolder,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      throw new Error(data?.detail || data?.error || 'Gelezen status opslaan mislukt');
    }
  } catch (error) {
    mail.unread = true;
    renderList();
    toast(String(error?.message || error || 'Gelezen status opslaan mislukt'));
  }
}
async function loadMailboxMessageBody(id) {
  if (!window.SoftoraMailboxIndex || typeof window.SoftoraMailboxIndex.loadBody !== 'function') return;
  await window.SoftoraMailboxIndex.loadBody({
    id,
    getMail: findMailById,
    account: activeMailboxAccount,
    folder: activeFolder,
    normalizeBodyImages: normalizeMailboxBodyImages,
    normalizeOptOutUrl: normalizeMailboxOptOutUrl,
    openMail,
  });
}
function openMail(id, options = {}) {
  const m = findMailById(id);
  if (!m) return;
  const wasUnread = m.unread;
  activeMail = m.id;
  m.unread = false;
  renderList();
  if (wasUnread) void persistMailReadState(m);
  const outreachQuickbar = window.SoftoraMailboxOutreach && typeof window.SoftoraMailboxOutreach.renderQuickbar === 'function'
    ? window.SoftoraMailboxOutreach.renderQuickbar(m, { escapeHtml })
    : '';
  const displayOptions = { activeFolder, account: getMailboxAccount() };
  const avatarText = window.SoftoraMailboxDisplay.getAvatarText(m, displayOptions);
  const detailPrimary = window.SoftoraMailboxDisplay.getDetailPrimaryText(m, displayOptions);
  const detailSecondary = window.SoftoraMailboxDisplay.getDetailSecondaryText(m, displayOptions);
  const detailBody = m.bodyLoaded || m.body
    ? m.body
    : 'Bericht laden…';
  document.getElementById('mail-detail').innerHTML = `
    <div class="detail-header">
      <div class="detail-subject">${escapeHtml(m.subject)}</div>
      <div class="detail-meta">
        <div class="detail-from-wrap">
          <div class="detail-avatar" style="background:${getColor(avatarText)}">${escapeHtml(initials(avatarText))}</div>
          <div>
            <div class="detail-from">${escapeHtml(detailPrimary)}</div>
            <div class="detail-email">${escapeHtml(detailSecondary)}</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
          <div class="detail-date">${escapeHtml(m.date)} · ${escapeHtml(m.time)}</div>
          <div class="detail-actions">
            <button class="btn-action" type="button" data-mailbox-action="toggle-star" data-mailbox-id="${escapeHtml(m.id)}">
              <svg viewBox="0 0 24 24" fill="${m.starred ? '#9b2355' : 'none'}" stroke="${m.starred ? '#9b2355' : 'currentColor'}" stroke-width="1.8" width="12" height="12"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              ${m.starred ? 'Gemarkeerd' : 'Markeren'}
            </button>
            <button class="btn-action" type="button" data-mailbox-action="reply-mail" data-mailbox-id="${escapeHtml(m.id)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg>
              Beantwoorden
            </button>
            <button class="btn-action" type="button" data-mailbox-action="delete-mail" data-mailbox-id="${escapeHtml(m.id)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>
              Verwijderen
            </button>
          </div>
        </div>
      </div>
    </div>
    <div class="detail-body">
      <div class="detail-body-text">${renderMailBody(detailBody, m.bodyImages, { optOutUrl: m.optOutUrl })}</div>
      ${outreachQuickbar}
    </div>`;
  if (!options.skipBodyFetch && !m.bodyLoaded) {
    void loadMailboxMessageBody(m.id);
  }
}
function toggleStar(id) {
  const m = findMailById(id);
  if (!m) return;
  m.starred = !m.starred;
  openMail(id);
  renderList();
}
async function deleteMail(id) {
  const m = findMailById(id);
  if (!m) return;
  if (!(await requestMailboxDeleteConfirmation(m))) return;
  try {
    const response = await fetch('/api/mailbox/messages/delete', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        account: activeMailboxAccount,
        id: m.id,
        uid: m.uid,
        folder: m.folder || activeFolder,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      throw new Error(data?.detail || data?.error || 'Mail verwijderen mislukt');
    }
    mails = mails.filter(mail => String(mail.id) !== String(id));
    if (String(activeMail) === String(id)) activeMail = null;
    resetDetailEmpty();
    renderList();
    toast((m.folder || activeFolder) === 'trash' ? 'Mail definitief verwijderd' : 'Mail verplaatst naar prullenbak');
  } catch (error) {
    toast(String(error?.message || error || 'Mail verwijderen mislukt'));
  }
}
async function requestMailboxDeleteConfirmation(mail) {
  const folder = String(mail?.folder || activeFolder || '').toLowerCase();
  const subject = String(mail?.subject || '').trim() || 'deze mail';
  const permanent = folder === 'trash';
  const message = `Weet je zeker dat je "${subject}" wilt ${permanent ? 'definitief verwijderen' : 'naar de prullenbak verplaatsen'}?`;
  const options = {
    title: permanent ? 'Mail definitief verwijderen' : 'Mail verwijderen',
    confirmText: permanent ? 'Definitief verwijderen' : 'Verwijderen',
    cancelText: 'Annuleren',
  };
  if (window.SoftoraDialogs && typeof window.SoftoraDialogs.confirm === 'function') {
    return window.SoftoraDialogs.confirm(message, options);
  }
  return typeof window.confirm === 'function' ? window.confirm(message) : false;
}
function getComposeFieldValue(id) {
  const field = document.getElementById(id);
  return field ? field.value : '';
}
function setComposeReplyContext(mail) {
  composeReplyContext = mail
    ? {
        id: mail.id,
        from: mail.from,
        email: mail.email,
        subject: mail.subject,
        preview: mail.preview,
        body: mail.body,
        date: mail.date,
        time: mail.time,
        folder: mail.folder || activeFolder,
      }
    : null;
}
function buildComposeRewriteContext() {
  return composeReplyContext ? { ...composeReplyContext } : null;
}
function replyMail(mail) {
  if (!mail) return;
  setComposeReplyContext(mail);
  const toField = document.getElementById('c-to');
  const subjectField = document.getElementById('c-subject');
  if (toField) toField.value = window.SoftoraMailboxDisplay.getReplyToAddress(mail, { activeFolder, account: getMailboxAccount() });
  if (subjectField) {
    const subject = mail.subject || '';
    subjectField.value = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
  }
  openCompose({ keepContext: true });
}
function openCompose(options = {}) {
  if (!options.keepContext) setComposeReplyContext(null);
  const overlay = document.getElementById('compose-overlay');
  if (overlay) overlay.classList.add('open');
}
function closeCompose() {
  const overlay = document.getElementById('compose-overlay');
  if (overlay) overlay.classList.remove('open');
  setComposeReplyContext(null);
  ['c-to','c-subject','c-body'].forEach(id => {
    const field = document.getElementById(id);
    if (field) field.value = '';
  });
}
async function rewriteComposeBody() {
  const bodyField = document.getElementById('c-body');
  const draft = String(bodyField?.value || '').trim();
  if (!draft) {
    toast('Typ eerst je mailtekst');
    return;
  }
  const rewriteBtn = document.querySelector('[data-mailbox-action="rewrite-compose"]');
  const sendBtn = document.querySelector('.btn-send');
  const originalLabel = rewriteBtn ? rewriteBtn.textContent : '';
  if (rewriteBtn) {
    rewriteBtn.disabled = true;
    rewriteBtn.textContent = 'Bezig...';
  }
  if (sendBtn) sendBtn.disabled = true;
  try {
    const senderProfile = await loadMailboxSenderProfile();
    const response = await fetch('/api/mailbox/rewrite', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        account: getMailboxAccount(),
        to: getComposeFieldValue('c-to'),
        subject: getComposeFieldValue('c-subject'),
        body: draft,
        senderProfile,
        context: buildComposeRewriteContext(),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      throw new Error(data?.detail || data?.error || 'Mailtekst verbeteren mislukt');
    }
    const rewritten = String(data?.text || data?.result?.text || '').trim();
    if (!rewritten) throw new Error('Geen verbeterde tekst ontvangen');
    bodyField.value = rewritten;
    toast('Tekst verbeterd');
  } catch (error) {
    toast(String(error?.message || error || 'Mailtekst verbeteren mislukt'));
  } finally {
    if (rewriteBtn) {
      rewriteBtn.disabled = false;
      rewriteBtn.textContent = originalLabel || 'Verwoord dit beter';
    }
    if (sendBtn) sendBtn.disabled = false;
  }
}
async function sendMail() {
  const to = document.getElementById('c-to').value.trim();
  const subject = document.getElementById('c-subject').value.trim();
  if (!to || !subject) { toast('Vul ontvanger en onderwerp in'); return; }
  const acc = getMailboxAccount();
  const sendBtn = document.querySelector('.btn-send');
  if (sendBtn) sendBtn.disabled = true;
  try {
    const response = await fetch('/api/mailbox/send', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        account: acc,
        to,
        subject,
        body: document.getElementById('c-body').value,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      throw new Error(data?.detail || data?.error || 'Mail verzenden mislukt');
    }
    closeCompose();
    toast('✓ Mail verzonden');
    if (activeFolder === 'sent') {
      await loadMailboxMessages();
    }
  } catch (error) {
    toast(String(error?.message || error || 'Mail verzenden mislukt'));
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}
function applyMailboxFolderUi(folder) {
  const folderEl = Array.from(document.querySelectorAll('[data-mailbox-folder]')).find(item => item.getAttribute('data-mailbox-folder') === folder);
  document.querySelectorAll('.folder-item').forEach(f => f.classList.toggle('active', f === folderEl));
  const folderLabelEl = document.getElementById('folder-label');
  const labels = { inbox:'Inbox', starred:'Gemarkeerd', sent:'Verzonden', drafts:'Concepten', spam:'Spam', trash:'Prullenbak', offerte:'Offertes', factuur:'Facturen', klant:'Klanten' };
  if (folderLabelEl) folderLabelEl.textContent = labels[folder] || folder;
}
function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  clearTimeout(toastTimer);
  t.textContent = msg;
  t.classList.add('show');
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}
function handleMailboxAction(actionEl) {
  const action = actionEl.getAttribute('data-mailbox-action');
  const id = actionEl.getAttribute('data-mailbox-id');
  if (
    window.SoftoraMailboxOutreach &&
    typeof window.SoftoraMailboxOutreach.handleAction === 'function' &&
    window.SoftoraMailboxOutreach.handleAction(actionEl, { findMailById, openMail, renderList, toast })
  ) {
    return;
  }
  switch (action) {
    case 'open-compose':
      openCompose();
      break;
    case 'close-compose':
      closeCompose();
      break;
    case 'send-mail':
      void sendMail();
      break;
    case 'rewrite-compose':
      void rewriteComposeBody();
      break;
    case 'set-folder':
      setFolder(actionEl.getAttribute('data-mailbox-folder') || 'inbox', actionEl);
      break;
    case 'open-mail':
      openMail(id);
      break;
    case 'toggle-star':
      toggleStar(id);
      break;
    case 'reply-mail': {
      const mail = findMailById(id);
      if (mail) replyMail(mail);
      break;
    }
    case 'delete-mail':
      void deleteMail(id);
      break;
  }
}
function bindMailboxActions() {
  document.addEventListener('click', (event) => {
    const actionEl = event.target && event.target.closest
      ? event.target.closest('[data-mailbox-action]')
      : null;
    if (!actionEl) return;
    handleMailboxAction(actionEl);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const actionEl = event.target && event.target.closest
      ? event.target.closest('[data-mailbox-action][role="button"]')
      : null;
    if (!actionEl) return;
    event.preventDefault();
    handleMailboxAction(actionEl);
  });
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.addEventListener('input', filterMails);
  const overlay = document.getElementById('compose-overlay');
  if (overlay) {
    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeCompose();
    });
  }
}
bindMailboxActions();
const mailboxAccountSwitcher = document.getElementById('mailbox-account-switcher');
const mailboxAccountMenu = document.getElementById('mailbox-account-menu');
if (mailboxAccountSwitcher) {
  mailboxAccountSwitcher.addEventListener('click', function(event) {
    event.stopPropagation();
    const isOpen = mailboxAccountMenu && mailboxAccountMenu.classList.contains('open');
    if (isOpen) {
      closeMailboxAccountMenu();
      return;
    }
    if (mailboxAccountMenu) mailboxAccountMenu.classList.add('open');
    mailboxAccountSwitcher.setAttribute('aria-expanded', 'true');
  });
}
if (mailboxAccountMenu) {
  mailboxAccountMenu.addEventListener('click', function(event) {
    const pinButton = event.target.closest('[data-mailbox-pin-email]');
    if (pinButton) {
      event.preventDefault();
      event.stopPropagation();
      const email = String(pinButton.dataset.mailboxPinEmail || '').trim();
      void pinMailboxAccount(email);
      return;
    }
    const option = event.target.closest('[data-mailbox-email]');
    if (!option) return;
    const email = String(option.dataset.mailboxEmail || '').trim();
    closeMailboxAccountMenu();
    applyMailboxAccount(email);
  });
}
document.addEventListener('click', (event) => {
  if (!mailboxAccountMenu || !mailboxAccountSwitcher) return;
  if (mailboxAccountMenu.contains(event.target) || mailboxAccountSwitcher.contains(event.target)) return;
  closeMailboxAccountMenu();
});
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  closeMailboxAccountMenu();
});
(async function initMailboxAccount() {
  await initializeMailboxAccountPreference();
  const intent = window.SoftoraMailboxOutreach && typeof window.SoftoraMailboxOutreach.readIntent === 'function'
    ? window.SoftoraMailboxOutreach.readIntent()
    : {};
  if (intent.account) activeMailboxAccount = intent.account;
  await loadMailboxAccounts();
  if (intent.account && mailboxAccounts.some((account) => account.email === intent.account)) {
    activeMailboxAccount = intent.account;
  }
  await applyMailboxAccount(activeMailboxAccount || MAILBOX_ACCOUNT_DEFAULT, {
    folder: intent.folder || 'inbox',
    keepSearch: true,
  });
})();
function finishPremiumShellBoot() {
  if (window.SoftoraPremiumBoot && typeof window.SoftoraPremiumBoot.setShellBooting === 'function') {
    window.SoftoraPremiumBoot.setShellBooting(false);
    return;
  }
  const main = document.querySelector('main.is-premium-boot-host');
  if (!main) return;
  const shell = main.querySelector('.premium-boot-shell');
  const loader = main.querySelector('.premium-boot-loader');
  if (shell) {
    shell.classList.remove('is-booting');
    shell.setAttribute('aria-busy', 'false');
  }
  if (loader) loader.classList.add('is-hidden');
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', finishPremiumShellBoot, { once: true });
} else {
  finishPremiumShellBoot();
}
})();
