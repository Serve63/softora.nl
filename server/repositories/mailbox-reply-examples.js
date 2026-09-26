'use strict';

// The outreach contact scope takes ~1s warm but can be slow on a cold database.
const REPLY_EXAMPLES_READ_TIMEOUT_MS = 20_000;

// Reads real sent replies to outreach contacts, paired with the customer mail
// they answered (see supabase migration 20260925090000_mailbox_reply_examples).
function createMailboxReplyExamplesRepository(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    getSupabaseClient = () => null,
  } = deps;

  async function listReplyExamples({ accountEmails = [], limit = 300 } = {}) {
    const emails = Array.from(new Set((Array.isArray(accountEmails) ? accountEmails : [])
      .map((email) => String(email || '').trim().toLowerCase())
      .filter(Boolean)));
    if (!emails.length || !isSupabaseConfigured()) return [];
    const client = getSupabaseClient({
      timeoutMs: REPLY_EXAMPLES_READ_TIMEOUT_MS,
      ignoreFailureCooldown: true,
      suppressFailureCooldown: true,
    });
    if (!client) return [];
    let timeoutId = null;
    try {
      const result = await Promise.race([
        Promise.resolve(client.rpc('softora_mailbox_reply_examples', {
          p_account_emails: emails,
          p_limit: limit,
        })),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Eerdere antwoorden laden duurde te lang.')), REPLY_EXAMPLES_READ_TIMEOUT_MS);
        }),
      ]);
      if (result?.error) throw result.error;
      return Array.isArray(result?.data) ? result.data : [];
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  return { listReplyExamples };
}

module.exports = {
  REPLY_EXAMPLES_READ_TIMEOUT_MS,
  createMailboxReplyExamplesRepository,
};
