const MAILBOX_MESSAGE_REFERENCE_LOOKUP_BATCH_SIZE = 25;
const MAILBOX_MESSAGE_REFERENCE_LOOKUP_PAGE_SIZE = 1000;
const MAILBOX_MESSAGE_REFERENCE_LOOKUP_MAX_IDS = 2000;

function createMailboxMessageReferenceLookup(deps = {}) {
  const {
    run,
    runPriorityRead,
    tableName,
    metadataColumns,
    normalizeString,
    normalizeEmail,
    normalizeFolder,
    normalizeMessageRow,
  } = deps;

  function normalizeMessageReferenceId(value) {
    return normalizeString(value)
      .toLowerCase()
      .replace(/^<+|>+$/g, '');
  }

  function getExactMessageReferenceIds(value) {
    const source = normalizeString(value);
    if (!source) return [];
    const tokens = source.match(/<[^<>]+>/g) || source.split(/[,\s]+/);
    return Array.from(new Set(tokens.map(normalizeMessageReferenceId).filter(Boolean)));
  }

  function quotePostgrestFilterValue(value) {
    return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  function buildCandidateFilter(messageIds) {
    const normalizedIds = Array.from(
      new Set((Array.isArray(messageIds) ? messageIds : []).map(normalizeMessageReferenceId).filter(Boolean))
    );
    const inReplyToValues = normalizedIds.flatMap((messageId) => [messageId, `<${messageId}>`]);
    const clauses = [];
    if (inReplyToValues.length) {
      clauses.push(`in_reply_to.in.(${inReplyToValues.map(quotePostgrestFilterValue).join(',')})`);
    }
    normalizedIds.forEach((messageId) => {
      clauses.push(`references_text.ilike.${quotePostgrestFilterValue(`*${messageId}*`)}`);
    });
    return clauses.join(',');
  }

  return async function listMessagesReferencingMessageIdsForAccounts({
    accountEmails = [],
    folder = 'sent',
    messageIds = [],
    priorityRead = false,
  } = {}) {
    const normalizedAccounts = Array.from(
      new Set((Array.isArray(accountEmails) ? accountEmails : []).map(normalizeEmail).filter(Boolean))
    );
    const normalizedMessageIds = Array.from(
      new Set((Array.isArray(messageIds) ? messageIds : []).map(normalizeMessageReferenceId).filter(Boolean))
    ).slice(0, MAILBOX_MESSAGE_REFERENCE_LOOKUP_MAX_IDS);
    if (!normalizedAccounts.length || !normalizedMessageIds.length) return [];
    const normalizedFolder = normalizeFolder(folder);
    const read = priorityRead && typeof runPriorityRead === 'function' ? runPriorityRead : run;
    const wantedIds = new Set(normalizedMessageIds);
    const rowsByKey = new Map();

    // Account ownership is an exact database predicate. The reference-text
    // query is candidate discovery only; exact token matching below prevents
    // substring matches from creating a false thread.
    for (const accountEmail of normalizedAccounts) {
      for (
        let batchOffset = 0;
        batchOffset < normalizedMessageIds.length;
        batchOffset += MAILBOX_MESSAGE_REFERENCE_LOOKUP_BATCH_SIZE
      ) {
        const batch = normalizedMessageIds.slice(
          batchOffset,
          batchOffset + MAILBOX_MESSAGE_REFERENCE_LOOKUP_BATCH_SIZE
        );
        const candidateFilter = buildCandidateFilter(batch);
        if (!candidateFilter) continue;
        for (let pageOffset = 0; ; pageOffset += MAILBOX_MESSAGE_REFERENCE_LOOKUP_PAGE_SIZE) {
          const result = await read(
            `list-messages-referencing-message-id:${normalizedFolder}:${accountEmail}:${batchOffset}:${pageOffset}`,
            (client) => client
              .from(tableName)
              .select(metadataColumns)
              .eq('account_email', accountEmail)
              .eq('folder', normalizedFolder)
              .or(candidateFilter)
              .is('deleted_at', null)
              .is('generation_superseded_at', null)
              .order('date', { ascending: false })
              .order('message_key', { ascending: false })
              .range(pageOffset, pageOffset + MAILBOX_MESSAGE_REFERENCE_LOOKUP_PAGE_SIZE - 1)
          );
          if (!result.ok) return null;
          const page = Array.isArray(result.data) ? result.data : [];
          page.forEach((row) => {
            if (normalizeEmail(row && row.account_email) !== accountEmail) return;
            const exactReferences = new Set([
              ...getExactMessageReferenceIds(row && row.in_reply_to),
              ...getExactMessageReferenceIds(row && row.references_text),
            ]);
            if (![...exactReferences].some((messageId) => wantedIds.has(messageId))) return;
            const key = normalizeString(row && row.message_key);
            if (key && !rowsByKey.has(key)) rowsByKey.set(key, row);
          });
          if (page.length < MAILBOX_MESSAGE_REFERENCE_LOOKUP_PAGE_SIZE) break;
        }
      }
    }

    return Array.from(rowsByKey.values())
      .sort((left, right) => Date.parse(right.date || 0) - Date.parse(left.date || 0))
      .map((row) => normalizeMessageRow(row));
  };
}

module.exports = {
  createMailboxMessageReferenceLookup,
};
