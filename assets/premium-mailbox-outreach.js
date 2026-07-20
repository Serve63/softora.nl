(function (global) {
"use strict";

const CUSTOMER_DB_SCOPE = 'premium_customers_database';
const CUSTOMER_DB_KEY = 'softora_customers_premium_v1';
const CAMPAIGN_REPLY_LIMIT = 100;
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

function shouldSelectFirstMailboxMatch(value) {
  return ['1', 'true', 'yes', 'first', 'eerste'].includes(normalizeText(value).toLowerCase());
}

function mailHasEmail(mail, email) {
  const target = normalizeEmail(email);
  if (!target) return false;
  return [mail && mail.email, mail && mail.to, mail && mail.from]
    .map(normalizeEmail)
    .some((value) => value === target);
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

function getCampaignReplyAccount(customer) {
  return normalizeEmail(
    customer &&
      (customer.replyMailboxAccount ||
        customer.sentFromEmail ||
        customer.sent_from_email ||
        customer.outreachSentFromEmail ||
        customer.lastColdmailSenderEmail)
  );
}

function getCampaignReplyMailboxId(customer) {
  return normalizeText(
    customer &&
      (customer.replyMailboxId ||
        customer.replyThreadId ||
        customer.reply_thread_id ||
        customer.replyMessageId ||
        customer.lastColdmailReplyMessageKey)
  );
}

function getCampaignReplyDate(customer) {
  return normalizeText(
    customer &&
      (customer.lastReplyAt ||
        customer.last_reply_at ||
        customer.lastColdmailReplyAt ||
        customer.statusUpdatedAt ||
        customer.updatedAt)
  );
}

function isOwnMailboxCampaignReply(customer) {
  if (!isWebdesignOutreachCustomer(customer) || !hasOutreachReplySignal(customer)) return false;
  return normalizeOutreachKey(customer && customer.lastColdmailProvider) !== 'instantly';
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

async function fetchCustomerState(fetchImpl) {
  const request = typeof fetchImpl === 'function'
    ? fetchImpl
    : global.fetch.bind(global);
  const response = await request(`/api/ui-state-get?scope=${encodeURIComponent(CUSTOMER_DB_SCOPE)}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Databasekoppeling laden mislukt');
  const data = await response.json().catch(() => ({}));
  return parseCustomers(readChunkedStateValue(data && data.values, CUSTOMER_DB_KEY));
}

function buildCampaignReplyOutreach(customer) {
  if (isDefinitiveOutreachCustomer(customer)) return null;
  return {
    customerId: normalizeText(customer && customer.id),
    company:
      normalizeText(customer && (customer.bedrijf || customer.company || customer.naam)) ||
      normalizeEmail(customer && customer.email),
    email: normalizeEmail(customer && customer.email),
    status: normalizeOutreachStatus(customer && customer.outreachStatus) || 'reactie_ontvangen',
  };
}

function buildCampaignReplyFallback(customer, account, mailboxId, folder) {
  const company =
    normalizeText(customer && (customer.bedrijf || customer.company || customer.naam)) ||
    normalizeEmail(customer && customer.email) ||
    'Onbekend bedrijf';
  const preview = normalizeText(
    customer &&
      (customer.lastColdmailReplyPreview ||
        customer.replyPreview ||
        customer.lastReplyPreview)
  );
  const customerId = normalizeText(customer && customer.id);
  const localKey = [account, mailboxId, customerId, normalizeEmail(customer && customer.email)]
    .filter(Boolean)
    .join('|');
  return {
    id: `outreach:${localKey || 'unknown'}`,
    mailboxId,
    accountEmail: account,
    folder,
    from: company,
    email: normalizeEmail(customer && customer.email),
    to: account,
    subject:
      normalizeText(
        customer &&
          (customer.lastColdmailReplySubject ||
            customer.replySubject ||
            customer.lastReplySubject)
      ) || '(Geen onderwerp)',
    preview,
    body: mailboxId ? '' : preview,
    date: getCampaignReplyDate(customer),
    unread: Boolean(
      customer &&
        (customer.actionRequired ||
          customer.outreachActionRequired ||
          normalizeOutreachStatus(customer.outreachStatus) === 'reactie_ontvangen')
    ),
    starred: false,
    bodyLoaded: Boolean(!mailboxId && preview),
    campaign: {
      company,
      account,
      customerId,
      status: normalizeOutreachStatus(customer && customer.outreachStatus) || 'reactie_ontvangen',
      actionRequired: !isDefinitiveOutreachCustomer(customer),
    },
    outreach: buildCampaignReplyOutreach(customer),
  };
}

async function loadCampaignReplies(fetchImpl) {
  const customers = (await fetchCustomerState(fetchImpl))
    .filter(isOwnMailboxCampaignReply)
    .sort((left, right) => Date.parse(getCampaignReplyDate(right)) - Date.parse(getCampaignReplyDate(left)))
    .slice(0, CAMPAIGN_REPLY_LIMIT);
  const replies = customers.map((customer) => {
    const account = getCampaignReplyAccount(customer);
    const mailboxId = getCampaignReplyMailboxId(customer);
    const folder = normalizeText(customer && customer.replyMailboxFolder).toLowerCase() || 'inbox';
    return buildCampaignReplyFallback(customer, account, mailboxId, folder);
  });
  const unique = new Map();
  replies.forEach((reply) => {
    const key = `${normalizeEmail(reply.accountEmail)}|${normalizeMessageKey(reply.mailboxId || reply.id)}`;
    if (!unique.has(key)) unique.set(key, reply);
  });
  return Array.from(unique.values()).sort(
    (left, right) => Date.parse(right.date || 0) - Date.parse(left.date || 0)
  );
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
    if (mail.campaign) {
      mail.campaign.status = status;
      mail.campaign.actionRequired = false;
    }
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

function readIntent(search) {
  try {
    const currentSearch = search == null
      ? String(global.location && global.location.search || '')
      : String(search || '');
    const params = new URLSearchParams(currentSearch);
    return {
      account: normalizeEmail(params.get('account') || ''),
      folder: normalizeText(params.get('folder') || 'outreach').toLowerCase(),
      message: normalizeText(params.get('message') || params.get('mail') || params.get('thread') || ''),
      email: normalizeEmail(params.get('email') || ''),
      query: normalizeText(params.get('q') || params.get('zoek') || params.get('search') || ''),
      selectFirst: shouldSelectFirstMailboxMatch(params.get('select') || params.get('openFirst') || ''),
    };
  } catch (_) {
    return { account: '', folder: 'outreach', message: '', email: '', query: '', selectFirst: false };
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
    return intent.email && mailHasEmail(mail, intent.email);
  });
  mailboxUrlIntentApplied = true;
  if (helpers && helpers.renderList) helpers.renderList();
  if (match && helpers && helpers.openMail) {
    helpers.openMail(match.id);
  } else if (searchValue && helpers && helpers.toast && !intent.selectFirst) {
    helpers.toast('Geen exacte thread gevonden, ik zoek op e-mailadres');
  }
}

const mailboxOutreachApi = {
  applyIntentAfterLoad,
  handleAction,
  hydrate,
  loadCampaignReplies,
  readIntent,
  renderQuickbar,
};
global.SoftoraMailboxOutreach = mailboxOutreachApi;
if (typeof module !== 'undefined' && module.exports) module.exports = mailboxOutreachApi;
})(typeof window !== 'undefined' ? window : globalThis);
