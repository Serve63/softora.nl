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
let inboxUnreadCount = 0;

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
    body: message.body || message.preview || '',
    time: when.time,
    date: when.date,
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

function openMail(id) {
  const m = findMailById(id);
  if (!m) return;
  activeMail = m.id;
  m.unread = false;
  renderList();

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
      <div class="detail-body-text">${escapeHtml(m.body)}</div>
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
