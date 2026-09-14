function createInstantlyWebhookState(deps = {}) {
  const {
    now = () => new Date(),
    defaultCampaignId = '',
    normalizeString = (value) => String(value || '').trim(),
    chooseStatus,
    buildSenderFields,
    mergeHistory,
    buildHistoryEntry,
    truncateText,
    normalizeContactStatus,
    canAdvanceContactStatus,
  } = deps;

  function buildMessageKey(event) {
    return [
      'instantly',
      event.eventType || 'event',
      event.eventId || '',
      event.leadId || event.email || event.customerId || '',
      event.timestamp || '',
    ].filter(Boolean).join(':');
  }

  function hasEvent(row, messageKey) {
    const history = Array.isArray(row && row.hist) ? row.hist : [];
    return Boolean(messageKey && history.some((item) => normalizeString(item && item.messageKey) === normalizeString(messageKey)));
  }

  function updateRow(row, event, actor) {
    const date = event.timestamp && !Number.isNaN(Date.parse(event.timestamp)) ? new Date(event.timestamp).toISOString() : now().toISOString();
    const messageKey = buildMessageKey(event);
    const baseFields = {
      instantlyLeadId: event.leadId || normalizeString(row.instantlyLeadId),
      instantlyCampaignId: event.campaignId || normalizeString(row.instantlyCampaignId) || defaultCampaignId,
      instantlyStatus: chooseStatus(row.instantlyStatus, event.eventStatus),
      instantlyLastEventAt: date,
      lastColdmailProvider: 'instantly',
      lastColdmailProviderStatus: event.eventStatus || event.eventType,
      ...buildSenderFields(event.senderEmail, normalizeString),
      updatedAt: date,
    };
    const history = (type, label, preview) => mergeHistory(row, buildHistoryEntry({
      type,
      label,
      actor,
      source: 'instantly-webhook',
      messageKey,
      subject: event.eventType,
      preview,
    }, { normalizeString, truncateText, now: () => new Date(date) }), normalizeString);
    const currentStatus = normalizeContactStatus(row.databaseStatus || row.status, row) || 'prospect';
    const applyConfirmedDelivery = (target, sentAt = date) => {
      const nextStatus = canAdvanceContactStatus(currentStatus, 'gemaild') ? 'gemaild' : currentStatus;
      return {
        ...target,
        status: nextStatus || row.status,
        databaseStatus: nextStatus || row.databaseStatus,
        mail: true,
        lastMailSentAt: normalizeString(row.lastMailSentAt) || sentAt,
        lastColdmailSentAt: normalizeString(row.lastColdmailSentAt) || sentAt,
        instantlyEmailSentAt: normalizeString(row.instantlyEmailSentAt) || sentAt,
        coldmailCampaignStartedAt: normalizeString(row.coldmailCampaignStartedAt) || sentAt,
        campaignType: 'webdesign',
        campaign_type: 'webdesign',
        outreachCampaignType: 'webdesign',
        outreach_campaign_type: 'webdesign',
        coldmailSpecialAction: 'webdesign',
        outreachStatus: normalizeString(target.outreachStatus) || normalizeString(row.outreachStatus) || 'benaderd',
        actionRequired: Object.prototype.hasOwnProperty.call(target, 'actionRequired') ? Boolean(target.actionRequired) : false,
        outreachActionRequired: Object.prototype.hasOwnProperty.call(target, 'outreachActionRequired') ? Boolean(target.outreachActionRequired) : false,
      };
    };

    if (event.eventStatus === 'sent') {
      return applyConfirmedDelivery({ ...row, ...baseFields, hist: history('gemaild', 'Mail verstuurd via Instantly', 'Instantly bevestigde dat de mail is verzonden.') });
    }
    if (event.eventStatus === 'opened') {
      const openCount = Math.max(0, Number(row.coldmailOpenCount || row.outreachOpenCount || 0) || 0) + 1;
      const firstOpenedAt = normalizeString(row.coldmailFirstOpenedAt || row.coldmailOpenedAt || row.outreachOpenedAt) || date;
      return applyConfirmedDelivery({
        ...row,
        ...baseFields,
        coldmailOpened: true,
        coldmailOpenedAt: firstOpenedAt,
        coldmailFirstOpenedAt: firstOpenedAt,
        coldmailLastOpenedAt: date,
        coldmailOpenCount: openCount,
        outreachOpenedAt: firstOpenedAt,
        outreachOpenCount: openCount,
        hist: history('mail_geopend', 'Instantly open geregistreerd', 'Instantly registreerde een open.'),
      });
    }
    if (event.eventStatus === 'reply_received') {
      return applyConfirmedDelivery({
        ...row,
        ...baseFields,
        lastColdmailReplyAt: date,
        lastColdmailReplySubject: normalizeString(event.eventType),
        lastColdmailReplyPreview: truncateText('Reactie ontvangen via Instantly.', 1000),
        lastColdmailReplyMessageKey: messageKey,
        outreachStatus: 'reactie_ontvangen',
        actionRequired: true,
        outreachActionRequired: true,
        hist: history('reactie_ontvangen', 'Reactie ontvangen via Instantly', 'Instantly meldde een reply.'),
      });
    }
    if (event.eventStatus === 'interested') {
      const nextStatus = canAdvanceContactStatus(currentStatus, 'interesse') ? 'interesse' : currentStatus;
      return {
        ...row,
        ...baseFields,
        status: nextStatus || row.status,
        databaseStatus: nextStatus || row.databaseStatus,
        lastColdmailReplyAt: date,
        outreachStatus: 'interesse',
        actionRequired: false,
        outreachActionRequired: false,
        activeColdmailCampaignUntil: '',
        coldmailCampaignEndsAt: '',
        hist: history('interesse', 'Interesse gemeld via Instantly', 'Instantly markeerde deze lead als interested.'),
      };
    }
    if (event.eventStatus === 'bounced' || event.eventStatus === 'unsubscribed') {
      const nextStatus = canAdvanceContactStatus(currentStatus, 'geblokkeerd') ? 'geblokkeerd' : currentStatus;
      const isUnsubscribed = event.eventStatus === 'unsubscribed';
      return {
        ...row,
        ...baseFields,
        mail: false,
        canMail: false,
        doNotMail: true,
        status: nextStatus || row.status,
        databaseStatus: nextStatus || row.databaseStatus,
        coldmailBounceAt: isUnsubscribed ? row.coldmailBounceAt : date,
        coldmailBounceType: isUnsubscribed ? row.coldmailBounceType : 'instantly',
        coldmailUnsubscribedAt: isUnsubscribed ? date : row.coldmailUnsubscribedAt,
        outreachStatus: 'geen_interesse',
        actionRequired: false,
        outreachActionRequired: false,
        activeColdmailCampaignUntil: '',
        coldmailCampaignEndsAt: '',
        hist: history('geblokkeerd', isUnsubscribed ? 'Afmelding via Instantly' : 'Bounce via Instantly', isUnsubscribed ? 'Instantly meldde een unsubscribe.' : 'Instantly meldde een bounce.'),
      };
    }
    return { ...row, ...baseFields, hist: history('instantly_event', 'Instantly event ontvangen', `Event verwerkt: ${event.eventType}.`) };
  }

  return { buildMessageKey, hasEvent, updateRow };
}

module.exports = { createInstantlyWebhookState };
