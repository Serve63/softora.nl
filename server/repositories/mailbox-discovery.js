'use strict';

const DISCOVERY_READ_TIMEOUT_MS = 12_000;

function createMailboxDiscoveryRepository(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    getSupabaseClient = () => null,
    normalizeMessageRow = (row) => row,
  } = deps;

  function getClient() {
    if (!isSupabaseConfigured()) return null;
    return getSupabaseClient({
      timeoutMs: DISCOVERY_READ_TIMEOUT_MS,
      ignoreFailureCooldown: true,
      suppressFailureCooldown: true,
    });
  }

  async function withTimeout(request, label) {
    let timeoutId = null;
    try {
      const result = await Promise.race([
        Promise.resolve(request),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            const error = new Error(`${label} duurde te lang.`);
            error.code = 'MAILBOX_DISCOVERY_TIMEOUT';
            error.status = 504;
            reject(error);
          }, DISCOVERY_READ_TIMEOUT_MS);
        }),
      ]);
      if (result?.error) throw result.error;
      return Array.isArray(result?.data) ? result.data : [];
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function normalizeDiscoveryRow(row = {}) {
    const message = normalizeMessageRow(row);
    return {
      ...message,
      messageKey: String(row.message_key || ''),
      technicalThreadKey: String(row.technical_thread_key || ''),
      externalContactEmail: String(row.external_contact_email || '').trim().toLowerCase(),
      canonicalOwner: String(row.canonical_owner || '').trim().toLowerCase(),
      searchMatch: row.match_message_key ? {
        messageKey: String(row.match_message_key),
        field: String(row.match_field || ''),
        snippet: String(row.match_snippet || '').replace(/\s+/g, ' ').trim().slice(0, 240),
      } : null,
    };
  }

  async function search({ ownerAccounts, query, limit, offset }) {
    const client = getClient();
    if (!client) {
      const error = new Error('De duurzame mailboxindex is niet beschikbaar.');
      error.code = 'MAILBOX_DISCOVERY_UNAVAILABLE';
      error.status = 503;
      throw error;
    }
    const rows = await withTimeout(client.rpc('softora_search_mailbox_contact_dossiers', {
      p_owner_accounts: ownerAccounts,
      p_query: query,
      p_limit: limit,
      p_offset: offset,
    }), 'Mailbox zoeken');
    return {
      messages: rows.map(normalizeDiscoveryRow),
      totalCount: Math.max(0, Number(rows[0]?.total_count) || 0),
    };
  }

  async function contactTimeline({ accountEmails, contactEmail, limit, offset }) {
    const client = getClient();
    if (!client) {
      const error = new Error('De duurzame mailboxindex is niet beschikbaar.');
      error.code = 'MAILBOX_DISCOVERY_UNAVAILABLE';
      error.status = 503;
      throw error;
    }
    const rows = await withTimeout(client.rpc('softora_mailbox_contact_timeline', {
      p_account_emails: accountEmails,
      p_contact_email: contactEmail,
      p_limit: limit,
      p_offset: offset,
    }), 'Contacttijdlijn laden');
    return {
      messages: rows.map(normalizeDiscoveryRow),
      totalCount: Math.max(0, Number(rows[0]?.total_count) || 0),
    };
  }

  async function filterOutreachContacts({ accountEmails, contactEmails }) {
    const client = getClient();
    if (!client) {
      const error = new Error('De duurzame mailboxindex is niet beschikbaar.');
      error.code = 'MAILBOX_DISCOVERY_UNAVAILABLE';
      error.status = 503;
      throw error;
    }
    const rows = await withTimeout(client.rpc('softora_filter_mailbox_outreach_contacts', {
      p_account_emails: accountEmails,
      p_contact_emails: contactEmails,
    }), 'Mailbox outreachscope bepalen');
    return rows
      .map((row) => String(row?.contact_email || '').trim().toLowerCase())
      .filter(Boolean);
  }

  return { contactTimeline, filterOutreachContacts, search };
}

module.exports = {
  DISCOVERY_READ_TIMEOUT_MS,
  createMailboxDiscoveryRepository,
};
