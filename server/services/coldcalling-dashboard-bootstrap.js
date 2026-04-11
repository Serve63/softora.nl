const { normalizeLeadLikePhoneKey } = require('./lead-identity');

function createColdcallingDashboardBootstrapService(deps = {}) {
  const {
    getUiStateValues = async () => null,
    agendaReadCoordinator = null,
    getRecentCallUpdates = () => [],
    getRecentAiCallInsights = () => [],
    normalizeString = (value) => String(value || '').trim(),
    leadRowsStorageKey = 'softora_coldcalling_lead_rows_json',
    statsResetBaselineStorageKey = 'softora_stats_reset_baseline_started',
    preferencesScope = 'coldcalling_preferences',
    businessModeStorageKey = 'softora_business_mode',
    defaultUiStateScope = 'coldcalling',
    interestedLeadLimit = 500,
  } = deps;

  function normalizeSearchText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function normalizeBusinessMode(mode) {
    const raw = normalizeString(mode).toLowerCase();
    if (raw === 'voice_software') return 'voice_software';
    if (raw === 'business_software') return 'business_software';
    return 'websites';
  }

  function resolveUiStateScopeForBusinessMode(mode) {
    const normalizedMode = normalizeBusinessMode(mode);
    if (normalizedMode === 'voice_software') {
      return `${defaultUiStateScope}_voice_software`;
    }
    if (normalizedMode === 'business_software') {
      return `${defaultUiStateScope}_business_software`;
    }
    return defaultUiStateScope;
  }

  function normalizePositiveInt(value) {
    const parsed = Math.round(Number(value) || 0);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function normalizeLeadRow(row) {
    return {
      company: normalizeString(row?.company || row?.name || ''),
      phone: normalizeString(row?.phone || ''),
      region: normalizeString(row?.region || ''),
    };
  }

  function isDeprecatedTestLeadRowLike(row) {
    const companyKey = normalizeSearchText(row?.company || row?.name || '');
    const phoneKey = normalizeLeadLikePhoneKey(row?.phone || '');
    if (companyKey === 'softora test' || companyKey === 'testco') return true;
    if (phoneKey === '31999999999') return true;
    return false;
  }

  function parseLeadRows(rawValue) {
    if (!rawValue) return [];

    let parsed;
    try {
      parsed = JSON.parse(String(rawValue || ''));
    } catch {
      return [];
    }

    if (!Array.isArray(parsed)) return [];

    const rows = [];
    const seenPhones = new Set();
    parsed.map(normalizeLeadRow).forEach((row) => {
      const hasAnyData = Boolean(row.company || row.phone);
      if (!hasAnyData || isDeprecatedTestLeadRowLike(row)) return;

      const looksLikeHeaderRow =
        /bedrijf|company/i.test(row.company) &&
        /telefoon|phone|nummer/i.test(row.phone) &&
        /regio|region/i.test(row.region);
      if (looksLikeHeaderRow) return;

      if (!row.phone) return;

      const dedupeKey = row.phone.replace(/[^\d+]/g, '');
      if (!dedupeKey || seenPhones.has(dedupeKey)) return;
      seenPhones.add(dedupeKey);
      rows.push(row);
    });

    return rows;
  }

  function getAllowedPhoneKeys(rows) {
    const keys = new Set();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const key = normalizeLeadLikePhoneKey(row?.phone || '');
      if (key) keys.add(key);
    });
    return keys;
  }

  function getCallPhoneKey(row) {
    return (
      normalizeLeadLikePhoneKey(row?.phone || '') ||
      normalizeLeadLikePhoneKey(row?.lead?.phone || '') ||
      normalizeLeadLikePhoneKey(row?.lead?.phoneE164 || '')
    );
  }

  function filterCallLikeRowsForMode(rows, allowedPhoneKeys, allowedCallIds = null) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const phoneKeys = allowedPhoneKeys instanceof Set ? allowedPhoneKeys : new Set();
    const callIds = allowedCallIds instanceof Set ? allowedCallIds : null;
    if (phoneKeys.size === 0 && (!callIds || callIds.size === 0)) return [];

    return rows.filter((row) => {
      const phoneKey = getCallPhoneKey(row);
      if (phoneKey && phoneKeys.has(phoneKey)) return true;
      if (callIds) {
        const callId = normalizeString(row?.callId || row?.call_id || '');
        if (callId && callIds.has(callId)) return true;
      }
      return false;
    });
  }

  function getConversationRecordUpdatedMs(record) {
    const updatedAtMs = Number(record?.updatedAtMs);
    if (Number.isFinite(updatedAtMs) && updatedAtMs > 0) return updatedAtMs;
    const updatedAt = Date.parse(normalizeString(record?.updatedAt || ''));
    return Number.isFinite(updatedAt) ? updatedAt : 0;
  }

  function getConversationRecordOccurredAt(record) {
    return normalizeString(
      record?.endedAt || record?.startedAt || record?.createdAt || record?.updatedAt || ''
    );
  }

  function getConversationRecordOccurredMs(record) {
    const occurredAt = Date.parse(getConversationRecordOccurredAt(record));
    if (Number.isFinite(occurredAt) && occurredAt > 0) return occurredAt;
    return getConversationRecordUpdatedMs(record);
  }

  function buildConversationRecordsFromUpdates(updates) {
    const byId = new Map();

    (Array.isArray(updates) ? updates : []).forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const callId = normalizeString(item.callId || `call-${index}`) || `call-${index}`;
      const previous = byId.get(callId) || { callId };
      const durationSeconds = Number(item.durationSeconds);
      const updatedAtMs = getConversationRecordUpdatedMs(item);

      byId.set(callId, {
        ...previous,
        ...item,
        callId,
        company: normalizeString(item.company || previous.company || ''),
        name: normalizeString(item.name || previous.name || ''),
        phone: normalizeString(item.phone || previous.phone || ''),
        status: normalizeString(item.status || previous.status || ''),
        endedReason: normalizeString(item.endedReason || previous.endedReason || ''),
        summary: normalizeString(item.summary || previous.summary || ''),
        transcriptSnippet: normalizeString(item.transcriptSnippet || previous.transcriptSnippet || ''),
        transcriptFull: normalizeString(item.transcriptFull || previous.transcriptFull || ''),
        startedAt: normalizeString(item.startedAt || previous.startedAt || ''),
        endedAt: normalizeString(item.endedAt || previous.endedAt || ''),
        recordingUrl: normalizeString(item.recordingUrl || previous.recordingUrl || ''),
        durationSeconds:
          Number.isFinite(durationSeconds) && durationSeconds > 0
            ? Math.round(durationSeconds)
            : Number.isFinite(Number(previous.durationSeconds)) && Number(previous.durationSeconds) > 0
              ? Math.round(Number(previous.durationSeconds))
              : null,
        updatedAt: normalizeString(item.updatedAt || previous.updatedAt || ''),
        updatedAtMs,
      });
    });

    return Array.from(byId.values()).sort(
      (a, b) => getConversationRecordOccurredMs(b) - getConversationRecordOccurredMs(a)
    );
  }

  function inferConversationAnswered(record) {
    const status = normalizeSearchText(record?.status || '');
    const endedReason = normalizeSearchText(record?.endedReason || '');
    const hasConversationContent = Boolean(
      normalizeString(record?.summary || '') ||
        normalizeString(record?.transcriptFull || '') ||
        normalizeString(record?.transcriptSnippet || '')
    );
    if (hasConversationContent) return true;
    if (Number(record?.durationSeconds) >= 15) return true;
    if (/(busy|voicemail|no[- ]?answer|failed|cancelled|canceled|rejected)/.test(`${status} ${endedReason}`)) {
      return false;
    }
    return null;
  }

  function hasRecordingReference(call) {
    const callId = normalizeString(call?.callId || call?.call_id || '');
    const raw = normalizeString(
      call?.recordingUrl ||
        call?.recording_url ||
        call?.recordingUrlProxy ||
        call?.audioUrl ||
        call?.audio_url ||
        ''
    );
    const recordingSid = normalizeString(call?.recordingSid || call?.recording_sid || '');
    return Boolean(raw || (callId && recordingSid));
  }

  function isQualifiedPhoneConversation(call) {
    const messageType = normalizeSearchText(call?.messageType || '');
    const directionText = normalizeSearchText(call?.direction || '');
    const callId = normalizeString(call?.callId || '');
    const phone = normalizeString(call?.phone || '');
    const status = normalizeSearchText(call?.status || '');
    const endedReason = normalizeSearchText(call?.endedReason || '');
    const hasConversationContent = Boolean(
      normalizeString(call?.summary || '') ||
        normalizeString(call?.transcriptSnippet || '') ||
        normalizeString(call?.transcriptFull || '')
    );
    const hasRecording = hasRecordingReference(call);
    const hasKnownDuration = Number.isFinite(Number(call?.durationSeconds)) && Number(call?.durationSeconds) > 0;
    const looksLikeInboundStreamCall =
      /twilio\.(inbound\.selected|stream\.stream-started|stream\.stream-stopped|stream\.stream-error)/.test(
        messageType
      );

    if (directionText.includes('inbound') || /twilio\.inbound\./.test(messageType)) {
      return false;
    }

    if (hasRecording || hasConversationContent || hasKnownDuration) return true;
    if (callId && (status || endedReason || phone)) return true;
    if (looksLikeInboundStreamCall) return true;
    return false;
  }

  function hasNegativePhoneConversationInterestSignal(value) {
    const text = normalizeSearchText(value);
    if (!text) return false;
    return /(niet meer bellen|bel( me)? niet|geen interesse|geen behoefte|niet geinteresseerd|niet geïnteresseerd|stop( met)? bellen|do not call|dnc|remove from list|uit bellijst|geen prioriteit|geen tijd voor|zijn voorzien|al voorzien|tevreden met huidige partij)/.test(
      text
    );
  }

  function hasPositivePhoneConversationInterestSignal(value) {
    const text = normalizeSearchText(value);
    if (!text) return false;
    return /(interesse|geinteresseerd|geïnteresseerd|afspraak|demo|offerte|voorstel|prijsopgave|kennismaking|stuur (de )?(offerte|informatie|info|voorstel)|mail .* (offerte|informatie|info|voorstel))/i.test(
      text
    );
  }

  function hasUnavailablePhoneConversationSignal(value) {
    const text = normalizeSearchText(value);
    if (!text) return false;
    return /(niet bereikbaar|buiten bereik|geen gehoor|geen antwoord|niet opgenomen|no answer|onbereikbaar|voicemail|antwoordapparaat|busy|bezet|missed)/.test(
      text
    );
  }

  function hasOutOfServicePhoneConversationSignal(value) {
    const text = normalizeSearchText(value);
    if (!text) return false;
    return /(buiten gebruik|buiten[- ]?dienst|niet in gebruik|nummer niet in gebruik|niet aangesloten|not reachable|not connected|not_connected|failed|out of service|not in service|disconnected|number unavailable|ongeldig nummer|invalid number|nummer bestaat niet)/.test(
      text
    );
  }

  function hasAlertPhoneConversationSignal(value) {
    const text = normalizeSearchText(value);
    if (!text) return false;
    return /(boos|kwaad|agressief|woedend|dreig|klacht|escalat|terugbellen|callback|bel (me )?later|later terug|later opnieuw|op de app|via de app|whatsapp|whats app|stuur .* (app|whatsapp)|andere service|andere dienst|ander product|andere vraag|ander onderwerp)/.test(
      text
    );
  }

  function hasOtherPhoneConversationSignal(value) {
    const text = normalizeSearchText(value);
    if (!text) return false;
    return /(gaat (hier )?niet over|ga ik niet over|ben ik niet van|niet de juiste persoon|verkeerde persoon|verkeerd nummer|collega gaat hierover|ander contactpersoon|doorverbinden|doorverbonden|receptie|algemene mailbox|beslisser is er niet|eigenaar is er niet)/.test(
      text
    );
  }

  function buildCallIntentByCallId(insights) {
    const result = new Map();

    (Array.isArray(insights) ? insights : []).forEach((insight) => {
      const callId = normalizeString(insight?.callId || '');
      if (!callId) return;
      const text = `${insight?.summary || ''} ${insight?.followUpReason || ''}`;
      const hasNegativeInsight = hasNegativePhoneConversationInterestSignal(text);
      const hasPositiveInsight =
        Boolean(
          insight?.appointmentBooked ||
            insight?.appointment_booked ||
            insight?.followUpRequired ||
            insight?.follow_up_required
        ) || hasPositivePhoneConversationInterestSignal(text);
      const nextIntent = hasNegativeInsight ? 'geen_interesse' : hasPositiveInsight ? 'interesse' : '';
      const previousIntent = normalizeString(result.get(callId) || '');
      if (!nextIntent || previousIntent === 'geen_interesse') return;
      if (nextIntent === 'geen_interesse' || !previousIntent) {
        result.set(callId, nextIntent);
      }
    });

    return result;
  }

  function inferPhoneConversationIntent(call, callIntentByCallId) {
    const text = `${call?.summary || ''} ${call?.transcriptSnippet || ''} ${call?.transcriptFull || ''} ${call?.status || ''} ${call?.endedReason || ''}`;
    const callId = normalizeString(call?.callId || '');
    const callSpecificIntent = callId ? normalizeString(callIntentByCallId?.get(callId) || '') : '';

    if (hasAlertPhoneConversationSignal(text)) return 'alert';
    if (hasOutOfServicePhoneConversationSignal(text)) return 'out_of_service';
    if (hasUnavailablePhoneConversationSignal(text)) return 'outside_range';
    if (hasNegativePhoneConversationInterestSignal(text)) return 'geen_interesse';
    if (callSpecificIntent === 'geen_interesse') return 'geen_interesse';
    if (hasPositivePhoneConversationInterestSignal(text)) return 'interesse';
    if (callSpecificIntent === 'interesse') return 'interesse';
    if (hasOtherPhoneConversationSignal(text)) return 'overig';
    return 'overig';
  }

  function getDashboardStatIdentity(item) {
    const callId = normalizeString(item?.callId || item?.call_id || '');
    if (callId) return `call:${callId}`;
    const phoneKey = getCallPhoneKey(item);
    if (phoneKey) return `phone:${phoneKey}`;
    return '';
  }

  async function loadInterestedLeads() {
    if (!agendaReadCoordinator || typeof agendaReadCoordinator.listInterestedLeads !== 'function') {
      return [];
    }

    const result = await agendaReadCoordinator.listInterestedLeads({
      limit: interestedLeadLimit,
    });

    return result?.ok && Array.isArray(result?.leads) ? result.leads : [];
  }

  function parseStatsResetBaseline(rawValue) {
    const raw = normalizeString(rawValue || '');
    if (!raw) {
      return { started: 0, answered: 0, interested: 0 };
    }

    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          started: normalizePositiveInt(parsed.started),
          answered: normalizePositiveInt(parsed.answered),
          interested: normalizePositiveInt(parsed.interested),
        };
      }
    } catch {
      const legacyStarted = normalizePositiveInt(raw);
      if (legacyStarted > 0) {
        return { started: legacyStarted, answered: 0, interested: 0 };
      }
    }

    return { started: 0, answered: 0, interested: 0 };
  }

  function buildDisplaySummary(summary, baseline) {
    const started = Math.max(0, normalizePositiveInt(summary?.started) - normalizePositiveInt(baseline?.started));
    const answered = Math.max(
      0,
      normalizePositiveInt(summary?.answered) - normalizePositiveInt(baseline?.answered)
    );
    const interested = Math.max(
      0,
      normalizePositiveInt(summary?.interested) - normalizePositiveInt(baseline?.interested)
    );
    return {
      started,
      answered,
      interested,
      conversionPct: started > 0 ? Math.round((Math.min(interested, started) / started) * 100) : 0,
    };
  }

  async function buildBootstrapPayload() {
    const preferencesState = await getUiStateValues(preferencesScope);
    const businessMode = normalizeBusinessMode(
      preferencesState?.values?.[businessModeStorageKey] || 'websites'
    );
    const uiStateScope = resolveUiStateScopeForBusinessMode(businessMode);
    const uiState = await getUiStateValues(uiStateScope);
    const values = uiState?.values && typeof uiState.values === 'object' ? uiState.values : {};
    const leadRows = parseLeadRows(values[leadRowsStorageKey]);
    const allowedPhoneKeys = getAllowedPhoneKeys(leadRows);
    const statsResetBaseline = parseStatsResetBaseline(values[statsResetBaselineStorageKey]);

    const scopedUpdates = filterCallLikeRowsForMode(getRecentCallUpdates(), allowedPhoneKeys);
    const scopedCallIds = new Set(
      scopedUpdates
        .map((item) => normalizeString(item?.callId || item?.call_id || ''))
        .filter(Boolean)
    );
    const scopedInsights = filterCallLikeRowsForMode(
      getRecentAiCallInsights(),
      allowedPhoneKeys,
      scopedCallIds
    );

    const interestedLeadRows = (await loadInterestedLeads()).filter((item) => {
      const callId = normalizeString(item?.callId || item?.call_id || '');
      const phoneKey = getCallPhoneKey(item);
      if (callId && scopedCallIds.has(callId)) return true;
      if (phoneKey && allowedPhoneKeys.has(phoneKey)) return true;
      return false;
    });

    const calls = buildConversationRecordsFromUpdates(scopedUpdates).filter((call) =>
      isQualifiedPhoneConversation(call)
    );
    const callIntentByCallId = buildCallIntentByCallId(scopedInsights);
    const interestedKeys = new Set();

    calls.forEach((call) => {
      if (inferPhoneConversationIntent(call, callIntentByCallId) !== 'interesse') return;
      const identity = getDashboardStatIdentity(call);
      if (identity) interestedKeys.add(identity);
    });

    interestedLeadRows.forEach((lead) => {
      const identity = getDashboardStatIdentity(lead);
      if (identity) interestedKeys.add(identity);
    });

    const statsSummary = {
      started: Math.max(0, calls.length),
      answered: Math.max(
        0,
        calls.filter((call) => inferConversationAnswered(call) === true).length
      ),
      interested: 0,
      conversionPct: 0,
    };
    statsSummary.interested = Math.min(
      statsSummary.started,
      Math.max(0, interestedKeys.size)
    );
    statsSummary.conversionPct =
      statsSummary.started > 0
        ? Math.round((statsSummary.interested / statsSummary.started) * 100)
        : 0;

    return {
      ok: true,
      businessMode,
      uiStateScope,
      loadedAt: new Date().toISOString(),
      statsSummary,
      statsResetBaseline,
      statsDisplay: buildDisplaySummary(statsSummary, statsResetBaseline),
    };
  }

  function buildDashboardHtmlReplacements(payload) {
    const stats = payload?.statsDisplay && typeof payload.statsDisplay === 'object' ? payload.statsDisplay : {};
    return {
      SOFTORA_COLDCALLING_STAT_CALLED: String(normalizePositiveInt(stats.started)),
      SOFTORA_COLDCALLING_STAT_BOOKED: String(normalizePositiveInt(stats.answered)),
      SOFTORA_COLDCALLING_STAT_INTERESTED: String(normalizePositiveInt(stats.interested)),
      SOFTORA_COLDCALLING_STAT_CONVERSION: `${normalizePositiveInt(stats.conversionPct)}%`,
    };
  }

  return {
    buildBootstrapPayload,
    buildDashboardHtmlReplacements,
  };
}

module.exports = {
  createColdcallingDashboardBootstrapService,
};
