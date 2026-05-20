(function () {
"use strict";

const MAILBOX_ACCOUNT_DEFAULT = 'info@softora.nl';
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

function renderLinkedMailBody(value) {
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
let outreachCustomers = [];
let mailboxUrlIntentApplied = false;
let mailboxSyncInFlight = false;
const CUSTOMER_DB_SCOPE = 'premium_customers_database';
const CUSTOMER_DB_KEY = 'softora_customers_premium_v1';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  const raw = normalizeText(value).toLowerCase();
  const match = raw.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i);
  return match ? match[0] : raw;
}

function normalizeOutreachKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeOutreachStatus(value) {
  const key = normalizeOutreachKey(value);
  if (['reactie_ontvangen', 'reply_received', 'action_required', 'actie_nodig'].includes(key)) return 'reactie_ontvangen';
  if (['interesse', 'interested', 'geinteresseerd'].includes(key)) return 'interesse';
  if (['geen_interesse', 'geblokkeerd', 'opt_out', 'unsubscribe'].includes(key)) return 'geen_interesse';
  if (['afgehaakt', 'lost', 'no_deal', 'geendeal'].includes(key)) return 'afgehaakt';
  if (['geen_gehoor', 'geengehoor', 'no_answer'].includes(key)) return 'geen_gehoor';
  if (['klant_geworden', 'klant', 'customer'].includes(key)) return 'klant_geworden';
  if (['benaderd', 'gemaild', 'sent', 'mailed'].includes(key)) return 'benaderd';
  return '';
}

function normalizeMessageKey(value) {
  const raw = normalizeText(value).toLowerCase();
  if (!raw) return '';
  if (/^[a-z]+:\d+$/i.test(raw)) return raw;
  return raw.replace(/^message:/i, '').replace(/[<>]/g, '').trim();
}

function isWebdesignOutreachCustomer(customer) {
  if (!customer) return false;
  return [
    customer.campaignType,
    customer.campaign_type,
    customer.outreachCampaignType,
    customer.outreach_campaign_type,
    customer.coldmailSpecialAction,
  ].some((value) => {
    const key = normalizeOutreachKey(value);
    return key === 'webdesign' || key === 'website_design';
  });
}

function isDefinitiveOutreachCustomer(customer) {
  const outreachStatus = normalizeOutreachStatus(customer?.outreachStatus);
  const databaseStatus = normalizeOutreachStatus(customer?.databaseStatus || customer?.status);
  const finalStatuses = ['interesse', 'geen_interesse', 'afgehaakt', 'geen_gehoor', 'klant_geworden'];
  return finalStatuses.includes(outreachStatus) || finalStatuses.includes(databaseStatus);
}

function hasOutreachReplySignal(customer) {
  return Boolean(
    customer?.actionRequired ||
      customer?.outreachActionRequired ||
      customer?.lastReplyAt ||
      customer?.last_reply_at ||
      customer?.lastColdmailReplyAt ||
      customer?.replyMailboxId ||
      customer?.replyMessageId
  );
}

function readChunkedStateValue(values, key) {
  if (!values || typeof values !== 'object') return '';
  if (typeof values[key] === 'string') return values[key];
  const chunks = [];
  for (let index = 0; Object.prototype.hasOwnProperty.call(values, `${key}_${index}`); index += 1) {
    chunks.push(String(values[`${key}_${index}`] || ''));
  }
  return chunks.join('');
}

function parseCustomers(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [];
  } catch (_) {
    return [];
  }
}

async function fetchCustomerState() {
  const encodedScope = encodeURIComponent(CUSTOMER_DB_SCOPE);
  const response = await fetch(`/api/ui-state-get?scope=${encodedScope}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Databasekoppeling laden mislukt');
  const data = await response.json().catch(() => ({}));
  return parseCustomers(readChunkedStateValue(data?.values, CUSTOMER_DB_KEY));
}

function collectCustomerMessageKeys(customer) {
  return [
    customer?.replyMailboxId,
    customer?.replyThreadId,
    customer?.replyMessageId,
    customer?.lastColdmailReplyMessageKey,
    customer?.outreachMessageId,
    customer?.coldmailSentMessageId,
  ].map(normalizeMessageKey).filter(Boolean);
}

function mailMatchesOutreachCustomer(mail, customer) {
  if (!isWebdesignOutreachCustomer(customer)) return false;
  if (normalizeOutreachKey(mail?.folder) !== 'inbox' || !hasOutreachReplySignal(customer)) return false;
  const mailKeys = [
    mail.id,
    mail.messageId,
    mail.inReplyTo,
    mail.references,
  ].flatMap((value) => normalizeText(value).split(/\s+/)).map(normalizeMessageKey).filter(Boolean);
  const customerKeys = collectCustomerMessageKeys(customer);
  if (mailKeys.some((key) => customerKeys.includes(key))) return true;
  return normalizeEmail(mail.email) && normalizeEmail(mail.email) === normalizeEmail(customer.email);
}

async function hydrateMailboxOutreachContexts() {
  try {
    outreachCustomers = (await fetchCustomerState()).filter(isWebdesignOutreachCustomer);
  } catch (_) {
    outreachCustomers = [];
  }
  mails = mails.map((mail) => {
    const outreach = outreachCustomers.find((customer) => mailMatchesOutreachCustomer(mail, customer));
    if (!outreach || isDefinitiveOutreachCustomer(outreach)) return { ...mail, outreach: null };
    return {
      ...mail,
      outreach: {
        customerId: normalizeText(outreach.id),
        company: normalizeText(outreach.bedrijf || outreach.company || outreach.naam) || normalizeEmail(mail.email),
        email: normalizeEmail(outreach.email || mail.email),
        status: normalizeOutreachStatus(outreach.outreachStatus) || 'reactie_ontvangen',
      },
    };
  });
}

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
  return {
    id: message.id,
    folder: message.folder || activeFolder,
    from: message.from || 'Onbekend',
    email: message.email || '',
    subject: message.subject || '(Geen onderwerp)',
    preview: message.preview || '',
    body: message.body || '',
    messageId: message.messageId || '',
    inReplyTo: message.inReplyTo || '',
    references: message.references || '',
    time: when.time,
    date: when.date,
    unread: Boolean(message.unread),
    starred: Boolean(message.starred),
    hasBody: Boolean(message.hasBody || message.body),
    bodyLoaded: Boolean(message.body),
    bodyLoading: false,
    bodyTruncated: Boolean(message.bodyTruncated),
    indexed: Boolean(message.indexed),
    tags: [],
  };
}

function setMailboxSyncStatus(message) {
  const el = document.getElementById('mail-sync-status');
  if (!el) return;
  const text = normalizeText(message);
  el.hidden = !text;
  el.textContent = text;
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

async function hydrateMailboxOutreachContextsInBackground() {
  await hydrateMailboxOutreachContexts();
  renderList();
  if (activeMail) openMail(activeMail, { skipBodyFetch: true });
}

async function syncMailboxInBackground() {
  if (mailboxSyncInFlight) return;
  mailboxSyncInFlight = true;
  setMailboxSyncStatus('Mailbox bijwerken…');
  try {
    await fetch('/api/mailbox/sync', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        account: activeMailboxAccount,
        folder: activeFolder,
        limit: 50,
      }),
    });
    await loadMailboxMessages({ showLoader: false, skipBackgroundSync: true });
    setMailboxSyncStatus('');
  } catch (_) {
    setMailboxSyncStatus('');
  } finally {
    mailboxSyncInFlight = false;
  }
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
    applyMailboxUrlIntentAfterLoad();
    void hydrateMailboxOutreachContextsInBackground().catch(() => {});
    if (!options.skipBackgroundSync && data?.sync?.refreshRecommended) {
      void syncMailboxInBackground();
    } else if (!mailboxSyncInFlight) {
      setMailboxSyncStatus('');
    }
  } catch (error) {
    mails = [];
    setMailboxSyncStatus('');
    if (wrap) {
      wrap.innerHTML = `<div style="padding:40px;text-align:center;font-size:13px;color:var(--text-light)">${escapeHtml(error?.message || error || 'Mailbox laden mislukt')}</div>`;
    }
    toast(String(error?.message || error || 'Mailbox laden mislukt'));
  }
}

async function applyMailboxAccount(email, options = {}) {
  activeMailboxAccount = email;
  activeFolder = normalizeText(options.folder || 'inbox').toLowerCase() || 'inbox';
  activeMail = null;
  const searchInput = document.getElementById('search-input');
  if (searchInput && !options.keepSearch) searchInput.value = '';
  applyMailboxFolderUi(activeFolder);
  setMailboxAccountUi(email);
  resetDetailEmpty();
  await loadMailboxMessages();
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

function renderList() {
  const searchInput = document.getElementById('search-input');
  const q = ((searchInput && searchInput.value) || '').toLowerCase();
  let list = getMailsForFolder(activeFolder);
  if (q) list = list.filter(m => m.from.toLowerCase().includes(q) || m.email.toLowerCase().includes(q) || m.subject.toLowerCase().includes(q) || m.preview.toLowerCase().includes(q));
  const wrap = document.getElementById('mail-items');
  if (!wrap) return;
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

  const unread = mails.filter(m => m.folder === 'inbox' && m.unread).length;
  const badge = document.getElementById('badge-inbox');
  badge.textContent = unread;
  badge.style.display = unread ? 'flex' : 'none';
}

async function loadMailboxMessageBody(id) {
  const m = findMailById(id);
  if (!m || m.bodyLoading) return;
  m.bodyLoading = true;
  try {
    const params = new URLSearchParams({
      account: activeMailboxAccount,
      folder: activeFolder,
      id: String(id),
    });
    const response = await fetch(`/api/mailbox/message?${params.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok || !data.message) {
      throw new Error(data?.detail || data?.error || 'Bericht laden mislukt');
    }
    const body = normalizeText(data.message.body || '');
    m.body = body || m.preview || '';
    m.bodyLoaded = true;
    m.hasBody = Boolean(data.message.hasBody || body);
    m.bodyTruncated = Boolean(data.message.bodyTruncated);
    if (String(activeMail) === String(id)) openMail(id, { skipBodyFetch: true });
  } catch (error) {
    m.body = String(error?.message || error || 'Bericht laden mislukt');
    m.bodyLoaded = true;
    if (String(activeMail) === String(id)) openMail(id, { skipBodyFetch: true });
  } finally {
    m.bodyLoading = false;
  }
}

function openMail(id, options = {}) {
  const m = findMailById(id);
  if (!m) return;
  activeMail = m.id;
  m.unread = false;
  renderList();
  const outreachQuickbar = m.outreach ? `
      <div class="outreach-quickbar">
        <div class="outreach-quickbar-title">
          <span>Webdesign-reactie</span>
          <strong>${escapeHtml(m.outreach.company)}</strong>
        </div>
        <div class="outreach-quickbar-actions">
          <button class="outreach-quickbar-btn primary" type="button" data-mailbox-action="outreach-status" data-outreach-status="interesse" data-mailbox-id="${escapeHtml(m.id)}">Interesse</button>
          <button class="outreach-quickbar-btn" type="button" data-mailbox-action="outreach-status" data-outreach-status="geen_interesse" data-mailbox-id="${escapeHtml(m.id)}">Geen interesse</button>
        </div>
      </div>` : '';

  const detailBody = m.bodyLoaded || m.body
    ? m.body
    : 'Bericht laden…';

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
      <div class="detail-body-text">${renderLinkedMailBody(detailBody)}</div>
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

function deleteMail(id) {
  const m = findMailById(id);
  if (!m) return;
  m.folder = 'trash';
  activeMail = null;
  resetDetailEmpty();
  renderList();
  toast('Mail verplaatst naar prullenbak');
}

function replyMail(email, subject) {
  document.getElementById('c-to').value = email;
  document.getElementById('c-subject').value = 'Re: ' + subject;
  openCompose();
}

function openCompose() {
  const overlay = document.getElementById('compose-overlay');
  if (overlay) overlay.classList.add('open');
}
function closeCompose() {
  const overlay = document.getElementById('compose-overlay');
  if (overlay) overlay.classList.remove('open');
  ['c-to','c-subject','c-body'].forEach(id => {
    const field = document.getElementById(id);
    if (field) field.value = '';
  });
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

async function updateOutreachStatusFromMailbox(id, status) {
  const mail = findMailById(id);
  if (!mail || !mail.outreach) return;
  try {
    const response = await fetch('/api/coldmailing/outreach/status', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        customerId: mail.outreach.customerId,
        email: mail.outreach.email || mail.email,
        mailboxId: mail.id,
        messageId: mail.messageId,
        status,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      throw new Error(data?.message || 'Outreach-status bijwerken mislukt');
    }
    mail.outreach = null;
    toast(status === 'interesse' ? '✓ Interesse opgeslagen' : '✓ Geen interesse opgeslagen');
    openMail(id);
    renderList();
  } catch (error) {
    toast(String(error?.message || error || 'Outreach-status bijwerken mislukt'));
  }
}

function readMailboxUrlIntent() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    return {
      account: normalizeEmail(params.get('account') || ''),
      folder: normalizeText(params.get('folder') || 'inbox').toLowerCase(),
      message: normalizeText(params.get('message') || params.get('mail') || params.get('thread') || ''),
      email: normalizeEmail(params.get('email') || ''),
      query: normalizeText(params.get('q') || params.get('zoek') || params.get('search') || ''),
    };
  } catch (_) {
    return { account: '', folder: 'inbox', message: '', email: '', query: '' };
  }
}

function applyMailboxFolderUi(folder) {
  const folderEl = Array.from(document.querySelectorAll('[data-mailbox-folder]')).find(item => item.getAttribute('data-mailbox-folder') === folder);
  document.querySelectorAll('.folder-item').forEach(f => f.classList.toggle('active', f === folderEl));
  const folderLabelEl = document.getElementById('folder-label');
  const labels = { inbox:'Inbox', starred:'Gemarkeerd', sent:'Verzonden', drafts:'Concepten', spam:'Spam', trash:'Prullenbak', offerte:'Offertes', factuur:'Facturen', klant:'Klanten' };
  if (folderLabelEl) folderLabelEl.textContent = labels[folder] || folder;
}

function applyMailboxUrlIntentAfterLoad() {
  if (mailboxUrlIntentApplied) return;
  const intent = readMailboxUrlIntent();
  const searchInput = document.getElementById('search-input');
  const searchValue = intent.email || intent.query;
  if (searchInput && searchValue) searchInput.value = searchValue;
  const messageKey = normalizeMessageKey(intent.message);
  const match = mails.find((mail) => {
    if (messageKey) {
      const keys = [mail.id, mail.messageId, mail.inReplyTo, mail.references]
        .flatMap((value) => normalizeText(value).split(/\s+/))
        .map(normalizeMessageKey)
        .filter(Boolean);
      if (keys.includes(messageKey)) return true;
    }
    return intent.email && normalizeEmail(mail.email) === intent.email;
  });
  mailboxUrlIntentApplied = true;
  renderList();
  if (match) {
    openMail(match.id);
    return;
  }
  if (searchValue) {
    toast('Geen exacte thread gevonden, ik zoek op e-mailadres');
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
      if (mail) replyMail(mail.email, mail.subject);
      break;
    }
    case 'delete-mail':
      deleteMail(id);
      break;
    case 'outreach-status':
      void updateOutreachStatusFromMailbox(id, actionEl.getAttribute('data-outreach-status'));
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
  const intent = readMailboxUrlIntent();
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
