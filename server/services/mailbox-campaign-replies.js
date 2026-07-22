const CAMPAIGN_MAILBOX_ACCOUNTS = Object.freeze([
  'serve@softora.nl',
  'servecreusen@softora.nl',
  'servec321@gmail.com',
  'serve290@gmail.com',
  'servecreusen7@gmail.com',
  'martijn@softora.nl',
  'martijnvandeven@softora.nl',
  'martijnven123@gmail.com',
  'contact.venvisuals@gmail.com',
]);

const CAMPAIGN_REPLY_LIMIT = 200;
const CAMPAIGN_MESSAGE_SCAN_LIMIT = 2000;

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeOutreachStatus(value) {
  const key = normalizeKey(value);
  if (['reactie_ontvangen', 'reply_received', 'action_required', 'actie_nodig'].includes(key)) {
    return 'reactie_ontvangen';
  }
  if (['interesse', 'interested', 'geinteresseerd'].includes(key)) return 'interesse';
  if (['geen_interesse', 'geblokkeerd', 'opt_out', 'unsubscribe'].includes(key)) {
    return 'geen_interesse';
  }
  if (['afgehaakt', 'lost', 'no_deal', 'geendeal'].includes(key)) return 'afgehaakt';
  if (['geen_gehoor', 'geengehoor', 'no_answer'].includes(key)) return 'geen_gehoor';
  if (['klant_geworden', 'klant', 'customer'].includes(key)) return 'klant_geworden';
  if (['benaderd', 'gemaild', 'sent', 'mailed'].includes(key)) return 'benaderd';
  return '';
}

function isWebdesignCampaignCustomer(customer) {
  if (!customer || typeof customer !== 'object') return false;
  return [
    customer.campaignType,
    customer.campaign_type,
    customer.outreachCampaignType,
    customer.outreach_campaign_type,
    customer.coldmailSpecialAction,
  ].some((value) => ['webdesign', 'website_design'].includes(normalizeKey(value)));
}

function isOwnMailboxCampaignCustomer(customer) {
  return (
    isWebdesignCampaignCustomer(customer) &&
    normalizeKey(customer && customer.lastColdmailProvider) !== 'instantly'
  );
}

function isDefinitiveOutreachCustomer(customer) {
  const definitive = ['interesse', 'geen_interesse', 'afgehaakt', 'geen_gehoor', 'klant_geworden'];
  const outreachStatus = normalizeOutreachStatus(customer && customer.outreachStatus);
  const databaseStatus = normalizeOutreachStatus(
    customer && (customer.databaseStatus || customer.status)
  );
  return definitive.includes(outreachStatus) || definitive.includes(databaseStatus);
}

function getCustomerCompany(customer, fallbackEmail) {
  return (
    normalizeText(customer && (customer.bedrijf || customer.company || customer.companyName || customer.naam)) ||
    normalizeEmail(fallbackEmail) ||
    'Onbekend bedrijf'
  );
}

function buildCampaignReply(message, customer) {
  const account = normalizeEmail(message && message.accountEmail);
  const email = normalizeEmail(message && message.email);
  const company = getCustomerCompany(customer, email);
  const customerId = normalizeText(customer && (customer.id || customer.customerId));
  const status = normalizeOutreachStatus(customer && customer.outreachStatus) || 'reactie_ontvangen';
  const actionRequired = !isDefinitiveOutreachCustomer(customer);
  return {
    ...message,
    mailboxId: normalizeText(message && message.id),
    accountEmail: account,
    campaign: {
      company,
      account,
      customerId,
      status,
      actionRequired,
    },
    outreach: actionRequired
      ? {
          customerId,
          company,
          email,
          status,
        }
      : null,
  };
}

function createMailboxCampaignRepliesService(deps = {}) {
  const {
    mailboxIndexStore = null,
    dataOpsStore = null,
  } = deps;

  async function listReplies({ limit = 100 } = {}) {
    const safeLimit = Math.max(1, Math.min(CAMPAIGN_REPLY_LIMIT, Number(limit) || 100));
    if (!mailboxIndexStore || typeof mailboxIndexStore.listMessagesForAccounts !== 'function') {
      const error = new Error('Mailbox-index voor campagnereacties is niet beschikbaar.');
      error.status = 503;
      throw error;
    }
    if (!dataOpsStore || typeof dataOpsStore.listCustomersByEmails !== 'function') {
      const error = new Error('Klantkoppeling voor campagnereacties is niet beschikbaar.');
      error.status = 503;
      throw error;
    }

    const messages = await mailboxIndexStore.listMessagesForAccounts({
      accountEmails: CAMPAIGN_MAILBOX_ACCOUNTS,
      folder: 'inbox',
      limit: CAMPAIGN_MESSAGE_SCAN_LIMIT,
    });
    if (!Array.isArray(messages)) {
      const error = new Error('Mailbox-index voor campagnereacties kon niet worden gelezen.');
      error.status = 503;
      throw error;
    }
    if (!messages.length) return [];

    const senderEmails = Array.from(
      new Set(messages.map((message) => normalizeEmail(message && message.email)).filter(Boolean))
    );
    const customers = await dataOpsStore.listCustomersByEmails({
      emails: senderEmails,
      bypassReadFailureCooldown: true,
      suppressReadFailureCooldown: true,
      suppressTransientReadFailureLog: true,
    });
    if (!Array.isArray(customers)) {
      const error = new Error('Klantkoppeling voor campagnereacties kon niet worden gelezen.');
      error.status = 503;
      throw error;
    }

    const campaignCustomerByEmail = new Map();
    customers.forEach((customer) => {
      const email = normalizeEmail(customer && (customer.email || customer.contactEmail));
      if (email && !campaignCustomerByEmail.has(email) && isOwnMailboxCampaignCustomer(customer)) {
        campaignCustomerByEmail.set(email, customer);
      }
    });

    const replies = messages
      .map((message) => {
        const customer = campaignCustomerByEmail.get(normalizeEmail(message && message.email));
        return customer ? buildCampaignReply(message, customer) : null;
      })
      .filter(Boolean)
      .sort((left, right) => Date.parse(right.date || 0) - Date.parse(left.date || 0))
      .slice(0, safeLimit);

    if (typeof mailboxIndexStore.hydrateMessageBodies !== 'function') return replies;
    const hydratedReplies = await mailboxIndexStore.hydrateMessageBodies({ messages: replies });
    return Array.isArray(hydratedReplies) ? hydratedReplies : replies;
  }

  return {
    listReplies,
  };
}

module.exports = {
  CAMPAIGN_MAILBOX_ACCOUNTS,
  CAMPAIGN_MESSAGE_SCAN_LIMIT,
  CAMPAIGN_REPLY_LIMIT,
  buildCampaignReply,
  createMailboxCampaignRepliesService,
  isOwnMailboxCampaignCustomer,
  isWebdesignCampaignCustomer,
  normalizeOutreachStatus,
};
