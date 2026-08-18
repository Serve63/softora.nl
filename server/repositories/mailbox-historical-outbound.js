const HISTORICAL_OUTBOUND_MAILBOX_FOLDERS = Object.freeze(['sent', 'coldmail', 'instantly']);
const MAILBOX_RECIPIENT_EMAIL_PATTERN = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const HISTORICAL_OUTBOUND_READ_RETRY_DELAYS_MS = Object.freeze([125, 350]);

function createMailboxHistoricalOutboundRepository(deps = {}) {
  const {
    run,
    mailboxMessagesTable = 'softora_mailbox_messages',
    mailboxSyncStateTable = 'softora_mailbox_sync_state',
    normalizeString = (value) => String(value || '').trim(),
    now = () => new Date(),
    readQueryTimeoutMs = 6000,
    sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)),
  } = deps;

  function getReadOptions() {
    return {
      operationType: 'read',
      timeoutMs: Math.max(1000, Number(readQueryTimeoutMs) || 6000),
      bypassReadFailureCooldown: true,
      suppressReadFailureCooldown: true,
      ignoreSupabaseRestFailureCooldown: true,
      suppressSupabaseRestFailureCooldown: true,
    };
  }

  function mailboxRowHasRecipientIdentity(row, recipientEmails, recipientDomains) {
    const matches = normalizeString(row && row.recipients_text)
      .toLowerCase()
      .match(MAILBOX_RECIPIENT_EMAIL_PATTERN) || [];
    return matches.some((email) => {
      const normalizedEmail = normalizeString(email).toLowerCase();
      const domain = normalizedEmail.split('@')[1] || '';
      return recipientEmails.has(normalizedEmail) || recipientDomains.has(domain);
    });
  }

  function isTransientHistoricalReadError(error) {
    const text = normalizeString(
      error && (error.message || error.details || error.hint || error.code || error)
    );
    return (
      error?.code === 'DATA_OPS_TIMEOUT' ||
      error?.code === 'DATA_OPS_READ_COOLDOWN' ||
      /abort|timeout|timed out|504|fetch failed|network|econnreset|etimedout|connection terminated|tijdelijk overgeslagen/i.test(text)
    );
  }

  async function runHistoricalRead(label, operation) {
    let result = null;
    for (let attempt = 0; attempt <= HISTORICAL_OUTBOUND_READ_RETRY_DELAYS_MS.length; attempt += 1) {
      result = await run(`${label}:attempt-${attempt + 1}`, operation, getReadOptions());
      if (result.ok || !isTransientHistoricalReadError(result.error)) return result;
      const delayMs = HISTORICAL_OUTBOUND_READ_RETRY_DELAYS_MS[attempt];
      if (delayMs) await sleep(delayMs);
    }
    return result;
  }

  async function listHistoricalOutboundMailboxMessagesByRecipientEmails(options = {}) {
    const recipientEmails = Array.from(new Set(
      (Array.isArray(options.recipientEmails) ? options.recipientEmails : [])
        .map((email) => normalizeString(email).toLowerCase())
        .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    ));
    const recipientDomains = Array.from(new Set(
      (Array.isArray(options.recipientDomains) ? options.recipientDomains : [])
        .map((domain) => normalizeString(domain).toLowerCase().replace(/^@/, '').replace(/^www\./, ''))
        .filter((domain) => /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain))
    ));
    const lookupTargets = [
      ...recipientEmails.map((value) => ({ type: 'email', value, search: `%${value}%` })),
      ...recipientDomains.map((value) => ({ type: 'domain', value, search: `%@${value}%` })),
    ].slice(0, 100);
    if (!lookupTargets.length) return [];
    const folders = Array.from(new Set(
      (Array.isArray(options.folders) && options.folders.length
        ? options.folders
        : HISTORICAL_OUTBOUND_MAILBOX_FOLDERS)
        .map((folder) => normalizeString(folder).toLowerCase())
        .filter(Boolean)
    ));
    const pageSize = Math.max(50, Math.min(1000, Number(options.pageSize) || 250));
    const maxCandidateRows = Math.max(
      pageSize,
      Math.min(20000, Number(options.maxCandidateRows) || 20000)
    );
    const results = await Promise.all(lookupTargets.map((target, index) =>
      runHistoricalRead(`list-historical-outbound-mailbox-recipient:${target.type}:${index}`, async (client) => {
        const candidates = [];
        for (let from = 0; from < maxCandidateRows; from += pageSize) {
          const to = Math.min(maxCandidateRows - 1, from + pageSize - 1);
          const query = client
            .from(mailboxMessagesTable)
            .select('message_key,account_email,folder,uid,provider_id,message_id,sender_email,recipients_text,subject,date,internal_date,deleted_at')
            .in('folder', folders)
            .ilike('recipients_text', target.search)
            .order('date', { ascending: false });
          const response = typeof query.range === 'function'
            ? await query.range(from, to)
            : await query.limit(maxCandidateRows);
          if (response && response.error) return response;
          const page = Array.isArray(response && response.data) ? response.data : [];
          candidates.push(...page);
          if (typeof query.range !== 'function' || page.length < to - from + 1) {
            return { data: candidates, error: null };
          }
        }
        return {
          data: null,
          error: new Error(
            `Historische mailbox kandidaatlimiet (${maxCandidateRows}) bereikt voor ${target.type}`
          ),
        };
      })
    ));
    if (results.some((result) => !result.ok)) return null;

    const recipientSet = new Set(recipientEmails);
    const domainSet = new Set(recipientDomains);
    const rowsByKey = new Map();
    results
      .flatMap((result) => Array.isArray(result.data) ? result.data : [])
      .filter((row) => mailboxRowHasRecipientIdentity(row, recipientSet, domainSet))
      .forEach((row) => {
        const key = normalizeString(row && row.message_key) || [
          normalizeString(row && row.account_email).toLowerCase(),
          normalizeString(row && row.folder).toLowerCase(),
          normalizeString(row && row.uid),
          normalizeString(row && (row.message_id || row.provider_id)),
        ].join('|');
        if (key && !rowsByKey.has(key)) rowsByKey.set(key, row);
      });
    return Array.from(rowsByKey.values())
      .sort((left, right) => Date.parse(right && (right.date || right.internal_date) || 0) -
        Date.parse(left && (left.date || left.internal_date) || 0));
  }

  async function getHistoricalOutboundMailboxCoverageStatus(options = {}) {
    const accountEmails = Array.from(new Set(
      (Array.isArray(options.accountEmails) ? options.accountEmails : [])
        .map((email) => normalizeString(email).toLowerCase())
        .filter(Boolean)
    ));
    if (!accountEmails.length) {
      return { ok: false, reason: 'no_mailbox_accounts', issues: [] };
    }
    const maxAgeMs = Math.max(
      60 * 1000,
      Math.min(7 * 24 * 60 * 60 * 1000, Number(options.maxAgeMs) || 24 * 60 * 60 * 1000)
    );
    const result = await runHistoricalRead(
      'get-historical-outbound-mailbox-coverage-status',
      (client) => client
        .from(mailboxSyncStateTable)
        .select('account_email,folder,status,last_synced_at,updated_at,last_error')
        .in('account_email', accountEmails)
        .eq('folder', 'sent')
    );
    if (!result.ok || !Array.isArray(result.data)) return null;
    const statesByAccount = new Map(result.data.map((row) => [
      normalizeString(row && row.account_email).toLowerCase(),
      row,
    ]));
    const currentTime = now().getTime();
    const issues = accountEmails.flatMap((accountEmail) => {
      const state = statesByAccount.get(accountEmail);
      if (!state) return [{ accountEmail, reason: 'missing_sent_sync_state' }];
      const status = normalizeString(state.status).toLowerCase();
      if (status !== 'ok') return [{ accountEmail, reason: `sent_sync_${status || 'unknown'}` }];
      const syncedAtMs = Date.parse(normalizeString(state.last_synced_at));
      if (!Number.isFinite(syncedAtMs) || currentTime - syncedAtMs > maxAgeMs) {
        return [{ accountEmail, reason: 'sent_sync_stale' }];
      }
      return [];
    });
    return {
      ok: issues.length === 0,
      checkedAccounts: accountEmails.length,
      issues,
    };
  }

  return {
    getHistoricalOutboundMailboxCoverageStatus,
    listHistoricalOutboundMailboxMessagesByRecipientEmails,
  };
}

module.exports = {
  createMailboxHistoricalOutboundRepository,
};
