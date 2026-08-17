'use strict';

const { createMailboxDiscoveryRepository } = require('../repositories/mailbox-discovery');
const {
  getCampaignCounterpartyEmail,
  getCampaignMailboxAccounts,
} = require('./mailbox-campaign-replies');

function createMailboxOutreachScope(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    getSupabaseClient = () => null,
    mailboxIndexStore = {},
    getInstantlyAccounts = () => [],
    repository = createMailboxDiscoveryRepository({
      isSupabaseConfigured,
      getSupabaseClient,
      normalizeMessageRow: mailboxIndexStore.normalizeMessageRow,
    }),
  } = deps;

  function normalizeOwner(value) {
    const owner = String(value || '').trim().toLowerCase().replace('servé', 'serve');
    if (!owner || owner === 'all' || owner === 'both') return '';
    if (owner === 'serve' || owner === 'martijn') return owner;
    const error = new Error('Onbekende mailboxscope.');
    error.code = 'MAILBOX_DISCOVERY_OWNER_INVALID';
    error.status = 400;
    throw error;
  }

  function getScopedAccounts(ownerValue) {
    const owner = normalizeOwner(ownerValue);
    const owners = owner ? [owner] : ['serve', 'martijn'];
    const instantlyAccounts = owners.flatMap((selectedOwner) => {
      const accounts = getInstantlyAccounts(selectedOwner);
      return Array.isArray(accounts) ? accounts : [];
    });
    return Array.from(new Set([
      ...getCampaignMailboxAccounts(owner),
      ...instantlyAccounts.map((account) => String(account?.email || account || '').trim().toLowerCase()),
    ].filter(Boolean)));
  }

  async function filterConversations({ owner = '', messages = [] } = {}) {
    const source = Array.isArray(messages) ? messages : [];
    if (!source.length) return [];
    const accountEmails = getScopedAccounts(owner);
    const contacts = source.map((message) => (
      String(message?.externalContactEmail || getCampaignCounterpartyEmail(message) || '')
        .trim()
        .toLowerCase()
    ));
    const uniqueContacts = Array.from(new Set(contacts.filter(Boolean)));
    if (!uniqueContacts.length) return [];
    const eligible = new Set(await repository.filterOutreachContacts({
      accountEmails,
      contactEmails: uniqueContacts,
    }));
    return source.filter((_message, index) => eligible.has(contacts[index]));
  }

  return {
    filterConversations,
    getScopedAccounts,
  };
}

module.exports = { createMailboxOutreachScope };
