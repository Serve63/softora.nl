function createColdmailProviderSentStats(deps = {}) {
  const {
    store,
    now,
    logger,
    normalizeString,
    normalizeEmailAddress,
    buildRecipientKey,
    setRecipientCount,
    getDateKey,
    parseTimestampMs,
    resolveSentAt,
    timezone,
    sentTimestampModel,
  } = deps;
  const inFlightGroups = new Map();

  function listGroups(options) {
    const key = JSON.stringify([options.provider || '', options.channel || '']);
    const existing = inFlightGroups.get(key);
    if (existing) return existing;
    const pending = Promise.resolve().then(() => store.listSentRecipientGroups({
      provider: options.provider,
      ...(options.channel ? { channel: options.channel } : {}),
      keyType: 'email',
      maxRows: 20_000,
      requireComplete: true,
    }));
    inFlightGroups.set(key, pending);
    void pending.finally(() => {
      if (inFlightGroups.get(key) === pending) inFlightGroups.delete(key);
    }).catch(() => {});
    return pending;
  }

  function matchesProvider(group, options = {}) {
    const provider = normalizeString(group && group.provider).toLowerCase();
    const channel = normalizeString(group && group.channel).toLowerCase();
    const expectedProvider = normalizeString(options.provider || 'softora').toLowerCase();
    const expectedChannel = Object.prototype.hasOwnProperty.call(options, 'channel')
      ? normalizeString(options.channel).toLowerCase()
      : expectedProvider === 'softora' ? 'coldmail' : '';
    if (expectedProvider === 'instantly' && provider !== 'instantly') return false;
    if ((provider && provider !== expectedProvider) || group?.payload?.sentStatsExcluded === true) return false;
    return !(expectedChannel && channel && channel !== expectedChannel);
  }

  function summarize(groups, options = {}) {
    const recipientCounts = {};
    const recipients = new Map();
    const todayRecipientCounts = {};
    const selectedTimezone = normalizeString(options.timezone || options.timeZone) || timezone;
    const todayKey = getDateKey(now(), selectedTimezone);
    let lastSentAt = '';
    let lastSenderEmail = '';
    (Array.isArray(groups) ? groups : []).forEach((group) => {
      if (!matchesProvider(group, options)) return;
      const source = normalizeString(group && group.source).toLowerCase();
      const actor = normalizeString(group && group.actor).toLowerCase();
      if (
        (options.excludeDataOpsMarkers !== false && source === 'data-ops-customers-sent-guard') ||
        source === 'coldmail-invalid-email-domain' || actor === 'coldmail-invalid-email-domain'
      ) return;
      const senderEmail = normalizeEmailAddress(group.sender_email || group.senderEmail);
      if (!senderEmail) return;
      const recipientKey = buildRecipientKey({
        recipientEmail: group.recipient_email || group.recipientEmail,
        recipientDomain: group.recipient_domain || group.recipientDomain,
        recipientId: group.recipient_id || group.recipientId,
        recipientCompanyKey: group.recipient_company_key || group.recipientCompanyKey || group.recipient_company || group.recipientCompany,
      });
      setRecipientCount(recipientCounts, recipientKey, 1);
      const sentAt = resolveSentAt(group);
      const sentAtMs = parseTimestampMs(sentAt);
      if (recipientKey && (!recipients.has(recipientKey) || sentAtMs > parseTimestampMs(recipients.get(recipientKey).sentAt))) {
        recipients.set(recipientKey, {
          key: recipientKey,
          email: normalizeEmailAddress(group.recipient_email || group.recipientEmail),
          company: normalizeString(group.recipient_company || group.recipientCompany),
          customerId: normalizeString(group.recipient_id || group.recipientId),
          senderEmail,
          sentAt,
        });
      }
      if (sentAtMs && (!lastSentAt || sentAtMs > parseTimestampMs(lastSentAt))) {
        lastSentAt = sentAt;
        lastSenderEmail = senderEmail;
      }
      if (sentAtMs && getDateKey(new Date(sentAtMs), selectedTimezone) === todayKey) {
        setRecipientCount(todayRecipientCounts, recipientKey, 1);
      }
    });
    return {
      available: true,
      sentTimestampModel,
      recipientCounts,
      recipients: Array.from(recipients.values()),
      todayRecipientCounts,
      unkeyedTotalSent: 0,
      lastSentAt,
      lastSenderEmail,
    };
  }

  async function load(options = {}) {
    const summaryOptions = {
      provider: options.provider,
      ...(Object.prototype.hasOwnProperty.call(options, 'channel') ? { channel: options.channel } : {}),
      excludeDataOpsMarkers: options.excludeDataOpsMarkers,
    };
    if (!store || typeof store.listSentRecipientGroups !== 'function') {
      return { ...summarize([], summaryOptions), available: false, unavailableReason: 'central_guard_store_unavailable' };
    }
    try {
      const groups = await listGroups(options);
      if (!Array.isArray(groups) || groups.length >= 20_000) throw new Error(options.incompleteMessage || 'Sent register incomplete');
      return summarize(groups, summaryOptions);
    } catch (error) {
      logger.warn(options.logLabel || '[ColdmailLiveStats][central-guard]', error && error.message ? error.message : error);
      return { ...summarize([], summaryOptions), available: false, unavailableReason: options.unavailableReason || 'central_guard_read_failed' };
    }
  }

  return { load, summarize };
}

module.exports = { createColdmailProviderSentStats };
