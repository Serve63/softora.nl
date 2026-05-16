(function () {
"use strict";

const CUSTOMER_DB_SCOPE = 'premium_customers_database';
const CUSTOMER_DB_KEY = 'softora_customers_premium_v1';
let mailboxUrlIntentApplied = false;

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
  ].some((value) => ['webdesign', 'website_design'].includes(normalizeOutreachKey(value)));
}

function isDefinitiveOutreachCustomer(customer) {
  const outreachStatus = normalizeOutreachStatus(customer && customer.outreachStatus);
  const databaseStatus = normalizeOutreachStatus(customer && (customer.databaseStatus || customer.status));
  return ['interesse', 'geen_interesse', 'afgehaakt', 'geen_gehoor', 'klant_geworden'].includes(outreachStatus) ||
    ['interesse', 'geen_interesse', 'afgehaakt', 'geen_gehoor', 'klant_geworden'].includes(databaseStatus);
}

function hasOutreachReplySignal(customer) {
  return Boolean(
    customer &&
    (customer.actionRequired ||
      customer.outreachActionRequired ||
      customer.lastReplyAt ||
      customer.last_reply_at ||
      customer.lastColdmailReplyAt ||
      customer.replyMailboxId ||
      customer.replyMessageId)
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
  const response = await fetch(`/api/ui-state-get?scope=${encodeURIComponent(CUSTOMER_DB_SCOPE)}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Databasekoppeling laden mislukt');
  const data = await response.json().catch(() => ({}));
  return parseCustomers(readChunkedStateValue(data && data.values, CUSTOMER_DB_KEY));
}

function collectCustomerMessageKeys(customer) {
  return [
    customer && customer.replyMailboxId,
    customer && customer.replyThreadId,
    customer && customer.replyMessageId,
    customer && customer.lastColdmailReplyMessageKey,
    customer && customer.outreachMessageId,
    customer && customer.coldmailSentMessageId,
  ].map(normalizeMessageKey).filter(Boolean);
}

function mailMatchesOutreachCustomer(mail, customer) {
  if (!isWebdesignOutreachCustomer(customer)) return false;
  if (normalizeOutreachKey(mail && mail.folder) !== 'inbox' || !hasOutreachReplySignal(customer)) return false;
  const mailKeys = [mail.id, mail.messageId, mail.inReplyTo, mail.references]
    .flatMap((value) => normalizeText(value).split(/\s+/))
    .map(normalizeMessageKey)
    .filter(Boolean);
  const customerKeys = collectCustomerMessageKeys(customer);
  if (mailKeys.some((key) => customerKeys.includes(key))) return true;
  return normalizeEmail(mail.email) && normalizeEmail(mail.email) === normalizeEmail(customer.email);
}

async function hydrate(mails) {
  let outreachCustomers = [];
  try {
    outreachCustomers = (await fetchCustomerState()).filter(isWebdesignOutreachCustomer);
  } catch (_) {
    outreachCustomers = [];
  }
  return (Array.isArray(mails) ? mails : []).map((mail) => {
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

function renderQuickbar(mail, helpers) {
  if (!mail || !mail.outreach) return '';
  const html = (helpers && helpers.escapeHtml) || escapeHtml;
  return `
      <div class="outreach-quickbar">
        <div class="outreach-quickbar-title">
          <span>Webdesign-reactie</span>
          <strong>${html(mail.outreach.company)}</strong>
        </div>
        <div class="outreach-quickbar-actions">
          <button class="outreach-quickbar-btn primary" type="button" data-mailbox-action="outreach-status" data-outreach-status="interesse" data-mailbox-id="${html(mail.id)}">Interesse</button>
          <button class="outreach-quickbar-btn" type="button" data-mailbox-action="outreach-status" data-outreach-status="geen_interesse" data-mailbox-id="${html(mail.id)}">Geen interesse</button>
        </div>
      </div>`;
}

async function updateStatus(mail, status, helpers) {
  if (!mail || !mail.outreach) return;
  const toast = helpers && helpers.toast;
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
    if (!response.ok || !data.ok) throw new Error(data.message || 'Outreach-status bijwerken mislukt');
    mail.outreach = null;
    if (toast) toast(status === 'interesse' ? '✓ Interesse opgeslagen' : '✓ Geen interesse opgeslagen');
    if (helpers && helpers.openMail) helpers.openMail(mail.id);
    if (helpers && helpers.renderList) helpers.renderList();
  } catch (error) {
    if (toast) toast(String(error && error.message || error || 'Outreach-status bijwerken mislukt'));
  }
}

function handleAction(actionEl, helpers) {
  if (!actionEl || actionEl.getAttribute('data-mailbox-action') !== 'outreach-status') return false;
  const mail = helpers && helpers.findMailById ? helpers.findMailById(actionEl.getAttribute('data-mailbox-id')) : null;
  void updateStatus(mail, actionEl.getAttribute('data-outreach-status'), helpers || {});
  return true;
}

function readIntent() {
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

function applyIntentAfterLoad(helpers) {
  if (mailboxUrlIntentApplied) return;
  const intent = readIntent();
  const searchInput = document.getElementById('search-input');
  const searchValue = intent.email || intent.query;
  if (searchInput && searchValue) searchInput.value = searchValue;
  const messageKey = normalizeMessageKey(intent.message);
  const mails = helpers && helpers.getMails ? helpers.getMails() : [];
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
  if (helpers && helpers.renderList) helpers.renderList();
  if (match && helpers && helpers.openMail) {
    helpers.openMail(match.id);
  } else if (searchValue && helpers && helpers.toast) {
    helpers.toast('Geen exacte thread gevonden, ik zoek op e-mailadres');
  }
}

window.SoftoraMailboxOutreach = {
  applyIntentAfterLoad,
  handleAction,
  hydrate,
  readIntent,
  renderQuickbar,
};
})();
