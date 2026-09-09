const BOUNCE_CANDIDATE_FILTER = [
  'sender_email.ilike.mailer-daemon@%', 'sender_email.ilike.postmaster@%',
  ...['delivery', 'undeliver', 'returned mail', 'failure notice', 'could not send message',
    'unzustell', 'niet bezorgd', 'onbestelbaar', 'bezorging mislukt', 'final-recipient',
    'diagnostic-code'].flatMap((term) => ['subject', 'preview'].map((field) => `${field}.ilike.%${term}%`)),
].join(',');

function createMailboxStatsMessagesRepository({ cachedRead, run, TABLES, normalizeString, dataOpsReadQueryTimeoutMs }) {
  async function listMailboxMessages(options = {}) {
    const accountEmails = Array.from(new Set(
      (Array.isArray(options.accountEmails) ? options.accountEmails : [])
        .map((email) => normalizeString(email).toLowerCase())
        .filter(Boolean)
    ));
    const folders = Array.from(new Set(
      (Array.isArray(options.folders) && options.folders.length ? options.folders : ['inbox'])
        .map((folder) => normalizeString(folder).toLowerCase())
        .filter(Boolean)
    ));
    const maxRows = Math.max(1, Math.min(20000, Number(options.maxRows) || 5000));
    const bounceCandidatesOnly = options.bounceCandidatesOnly === true;
    const cacheKey = [
      'mailbox-messages',
      accountEmails.join(','),
      folders.join(','),
      maxRows,
      bounceCandidatesOnly ? 'bounce-candidates' : 'all',
    ].join('|');

    return cachedRead(cacheKey, async () => {
      const selectedColumns = bounceCandidatesOnly
        ? 'message_key,account_email,folder,uid,provider_id,message_id,sender_name,sender_email,recipients_text,subject,preview,body_text,date,internal_date,deleted_at'
        : 'message_key,account_email,folder,uid,provider_id,message_id,sender_name,sender_email,recipients_text,subject,preview,body_text,date,internal_date,payload,deleted_at';
      const loadRows = (accountEmail = '') => run('list-mailbox-messages', (client) => {
        let query = client
          .from(TABLES.mailboxMessages)
          .select(selectedColumns)
          .is('deleted_at', null);
        if (accountEmail && typeof query.eq === 'function') query = query.eq('account_email', accountEmail);
        else if (accountEmails.length && typeof query.in === 'function') query = query.in('account_email', accountEmails);
        if (folders.length && typeof query.in === 'function') query = query.in('folder', folders);
        if (typeof query.order === 'function') query = query.order('date', { ascending: false });
        if (typeof query.limit === 'function') query = query.limit(maxRows);
        return query;
      }, {
        timeoutMs: dataOpsReadQueryTimeoutMs,
        bypassReadFailureCooldown: options.bypassReadFailureCooldown,
        suppressReadFailureCooldown: options.suppressReadFailureCooldown,
        suppressTransientReadFailureLog: options.suppressTransientReadFailureLog,
      });

      if (bounceCandidatesOnly) {
        if (!accountEmails.length) return null;
        const results = await Promise.all(accountEmails.map(async (accountEmail) => {
          const rows = [];
          let afterKey = '';
          // Filter before paging: ordinary inbox growth cannot push old bounces out.
          // Keyset order stays stable when the mailbox synchronizes during a read.
          for (let page = 0; page < 200; page += 1) {
            const result = await run('list-mailbox-bounce-evidence', (client) => {
              let query = client.from(TABLES.mailboxMessages).select(selectedColumns)
                .eq('account_email', accountEmail).in('folder', folders)
                .is('deleted_at', null).or(BOUNCE_CANDIDATE_FILTER)
                .order('message_key', { ascending: true });
              if (afterKey) query = query.gt('message_key', afterKey);
              return query.limit(500);
            }, {
              timeoutMs: dataOpsReadQueryTimeoutMs,
              bypassReadFailureCooldown: options.bypassReadFailureCooldown,
              suppressReadFailureCooldown: options.suppressReadFailureCooldown,
              suppressTransientReadFailureLog: options.suppressTransientReadFailureLog,
            });
            if (!result.ok || !Array.isArray(result.data)) return null;
            rows.push(...result.data);
            if (result.data.length < 500) return rows;
            const nextKey = normalizeString(result.data[result.data.length - 1].message_key);
            if (!nextKey || nextKey <= afterKey) return null;
            afterKey = nextKey;
          }
          return null; // A partial scan must never become an authoritative total.
        }));
        if (results.some((rows) => rows === null)) return null;
        // Keep duplicate message copies: a later copy can lack the original DSN body.
        // The bounce classifier merges the strongest evidence per recipient email.
        return results.flat();
      }

      const result = await loadRows();
      return result.ok ? result.data || [] : null;
    }, {
      bypassReadCache: bounceCandidatesOnly || options.bypassReadCache,
      suppressStaleReadCacheLog: options.suppressStaleReadCacheLog,
    });
  }

  return { listMailboxMessages };
}

module.exports = { createMailboxStatsMessagesRepository };
