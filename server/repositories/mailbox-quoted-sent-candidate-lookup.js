function createMailboxQuotedSentCandidateLookup(options = {}) {
  const {
    run,
    tableName,
    normalizeString,
    normalizeEmail,
    normalizeMessageRow,
  } = options;

  return async function listSentCandidatesForQuotedReplies({ targets = [], limitPerTarget = 10 } = {}) {
    const normalizedTargets = Array.from(new Map((Array.isArray(targets) ? targets : [])
      .map((target) => ({
        accountEmail: normalizeEmail(target && target.accountEmail),
        canonicalSubject: normalizeString(target && target.canonicalSubject),
        recipientEmail: normalizeEmail(target && target.recipientEmail),
        beforeAt: Number.isFinite(Date.parse(target && target.beforeAt || ''))
          ? new Date(Date.parse(target.beforeAt)).toISOString()
          : '',
      }))
      .filter((target) => target.accountEmail && target.canonicalSubject && target.recipientEmail)
      .map((target) => [
        `${target.accountEmail}|${target.canonicalSubject.toLowerCase()}|${target.recipientEmail}|${target.beforeAt}`,
        target,
      ])).values()).slice(0, 100);
    if (!normalizedTargets.length) return [];

    const safeLimitPerTarget = Math.max(1, Math.min(25, Number(limitPerTarget) || 10));
    const rowsByKey = new Map();
    for (const target of normalizedTargets) {
      const result = await run(
        `list-sent-candidates-for-quoted-reply:${target.accountEmail}:${target.recipientEmail}`,
        (client) => {
          let query = client
            .from(tableName)
            .select('*')
            .eq('account_email', target.accountEmail)
            .eq('folder', 'sent')
            .ilike('subject', `%${target.canonicalSubject}%`)
            .ilike('recipients_text', `%${target.recipientEmail}%`)
            .is('deleted_at', null)
            .is('generation_superseded_at', null);
          if (target.beforeAt) query = query.lte('date', target.beforeAt);
          return query
            .order('date', { ascending: false })
            .limit(safeLimitPerTarget);
        }
      );
      if (!result.ok) return [];
      (Array.isArray(result.data) ? result.data : []).forEach((row) => {
        const key = normalizeString(row && row.message_key);
        if (key && !rowsByKey.has(key)) rowsByKey.set(key, row);
      });
    }
    return Array.from(rowsByKey.values())
      .map((row) => normalizeMessageRow(row, { includeBody: true }));
  };
}

module.exports = { createMailboxQuotedSentCandidateLookup };
