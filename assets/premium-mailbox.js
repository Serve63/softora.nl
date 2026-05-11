(function () {
"use strict";

const MAILBOX_ACCOUNT_DEFAULT = 'info@softora.nl';
const MAILBOX_SENDER_SETTINGS_SCOPE = 'premium_coldmailing_settings';
const MAILBOX_SENDER_SETTINGS_KEY = 'softora_coldmailing_settings_v1';
let activeMailboxAccount = MAILBOX_ACCOUNT_DEFAULT;
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
  const paragraphs = [];
  let currentLines = [];
  const quoteBody = Boolean(options && options.quoteBody);

  function flushParagraph() {
    if (!currentLines.length) return;
    paragraphs.push(`<p>${currentLines.map((line) => escapeHtml(line)).join('<br>')}</p>`);
    currentLines = [];
  }

  lines.forEach((line) => {
    const value = String(line || '');
    const cleaned = quoteBody ? stripMailboxQuotePrefix(value) : value.trimEnd();
    if (!cleaned.trim()) {
      flushParagraph();
      return;
    }
    currentLines.push(cleaned);
  });

  flushParagraph();
  return paragraphs.join('') || '<p>Geen inhoud.</p>';
}

function renderMailboxBodySection(section) {
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
        <div class="detail-mail-quote-body">${renderMailboxParagraphs(quoteLines, { quoteBody: true })}</div>
      </section>`;
  }
  if (section.type === 'signature') {
    return `
      <section class="detail-mail-section detail-mail-section-signature">
        ${renderMailboxParagraphs(section.lines)}
      </section>`;
  }
  return `
    <section class="detail-mail-section">
      ${renderMailboxParagraphs(section.lines)}
    </section>`;
}

function renderMailBody(value) {
  return buildMailboxBodySections(value).map((section) => renderMailboxBodySection(section)).join('');
}

function findMailById(id) {
  const key = String(id);
  return mails.find(mail => String(mail.id) === key);
}

function getMailboxAccounts() {
  return mailboxAccounts.map((account) => account.email);
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
  menu.innerHTML = mailboxAccounts.map((account) => {
    const email = account.email;
    const unavailable = !account.imapConfigured && !account.smtpConfigured;
    return `
    <button class="topbar-mailbox-option${email === activeEmail ? ' active' : ''}" type="button" data-mailbox-email="${escapeHtml(email)}" role="menuitemradio" aria-checked="${email === activeEmail ? 'true' : 'false'}">
      <span>${escapeHtml(email)}${unavailable ? ' · niet gekoppeld' : ''}</span>
    </button>
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
  return {
    id: message.id,
    folder: message.folder || activeFolder,
    from: message.from || 'Onbekend',
    email: message.email || '',
    subject: message.subject || '(Geen onderwerp)',
    preview,
    body,
    time: when.time,
    date: when.date,
    uid: message.uid,
    unread: Boolean(message.unread),
    starred: Boolean(message.starred),
    tags: [],
  };
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
      mailboxAccounts = data.accounts;
      if (!mailboxAccounts.some((account) => account.email === activeMailboxAccount)) {
        activeMailboxAccount = mailboxAccounts[0].email;
      }
      renderMailboxAccountMenu();
      setMailboxAccountUi(activeMailboxAccount);
    }
  } catch (_) {
    toast('Mailboxaccounts laden mislukt');
  }
}

async function loadMailboxMessages() {
  const wrap = document.getElementById('mail-items');
  if (wrap) {
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
  } catch (error) {
    mails = [];
    syncInboxBadgeFromCurrentFolder();
    if (wrap) {
      wrap.innerHTML = `<div style="padding:40px;text-align:center;font-size:13px;color:var(--text-light)">${escapeHtml(error?.message || error || 'Mailbox laden mislukt')}</div>`;
    }
    toast(String(error?.message || error || 'Mailbox laden mislukt'));
  }
}

async function applyMailboxAccount(email) {
  activeMailboxAccount = email;
  activeFolder = 'inbox';
  activeMail = null;
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  document.querySelectorAll('.folder-item').forEach((f, i) => f.classList.toggle('active', i === 0));
  setMailboxAccountUi(email);
  resetDetailEmpty();
  await loadMailboxMessages();
}

function setFolder(folder, el) {
  activeFolder = folder;
  activeMail = null;
  const folderEl = el || Array.from(document.querySelectorAll('[data-mailbox-folder]')).find(item => item.getAttribute('data-mailbox-folder') === folder);
  document.querySelectorAll('.folder-item').forEach(f => f.classList.toggle('active', f === folderEl));
  const labels = { inbox:'Inbox', starred:'Gemarkeerd', sent:'Verzonden', drafts:'Concepten', spam:'Spam', trash:'Prullenbak', offerte:'Offertes', factuur:'Facturen', klant:'Klanten' };
  const folderLabelEl = document.getElementById('folder-label');
  if (folderLabelEl) folderLabelEl.textContent = labels[folder] || folder;
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
  if (q) list = list.filter(m => m.from.toLowerCase().includes(q) || m.subject.toLowerCase().includes(q) || m.preview.toLowerCase().includes(q));
  const wrap = document.getElementById('mail-items');
  if (!wrap) return;
  syncInboxBadgeFromCurrentFolder();
  if (!list.length) { wrap.innerHTML = `<div style="padding:40px;text-align:center;font-size:13px;color:var(--text-light)">Geen e-mails gevonden.</div>`; return; }

  wrap.innerHTML = list.map(m => `
    <div class="mail-item ${m.unread ? 'unread' : ''} ${String(activeMail) === String(m.id) ? 'active' : ''}" data-mailbox-action="open-mail" data-mailbox-id="${escapeHtml(m.id)}" role="button" tabindex="0">
      ${m.unread ? '<div class="unread-dot"></div>' : ''}
      <div class="mail-item-top">
        <div class="mail-from">${escapeHtml(m.from)}</div>
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

function openMail(id) {
  const m = findMailById(id);
  if (!m) return;
  const wasUnread = m.unread;
  activeMail = m.id;
  m.unread = false;
  renderList();
  if (wasUnread) void persistMailReadState(m);

  document.getElementById('mail-detail').innerHTML = `
    <div class="detail-header">
      <div class="detail-subject">${escapeHtml(m.subject)}</div>
      <div class="detail-meta">
        <div class="detail-from-wrap">
          <div class="detail-avatar" style="background:${getColor(m.from)}">${escapeHtml(initials(m.from))}</div>
          <div>
            <div class="detail-from">${escapeHtml(m.from)}</div>
            <div class="detail-email">${escapeHtml(m.email)}</div>
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
      <div class="detail-body-text">${renderMailBody(m.body)}</div>
    </div>`;
}

function toggleStar(id) {
  const m = findMailById(id);
  if (!m) return;
  m.starred = !m.starred;
  openMail(id);
  renderList();
}

function deleteMail(id) {
  const m = findMailById(id);
  if (!m) return;
  m.folder = 'trash';
  activeMail = null;
  resetDetailEmpty();
  renderList();
  toast('Mail verplaatst naar prullenbak');
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
  if (toField) toField.value = mail.email || '';
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
      deleteMail(id);
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
  await loadMailboxAccounts();
  await applyMailboxAccount(activeMailboxAccount || MAILBOX_ACCOUNT_DEFAULT);
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
