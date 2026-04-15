const {
  buildLeadIdentityKey,
  normalizeLeadIdentityText,
  normalizeLeadLikePhoneKey,
} = require('./lead-identity');

function createAgendaInterestedLeadReadService(deps = {}) {
  const {
    getRecentCallUpdates = () => [],
    getRecentAiCallInsights = () => [],
    getGeneratedAgendaAppointments = () => [],
    mapAppointmentToConfirmationTask = () => null,
    compareConfirmationTasks = () => 0,
    normalizeString = (value) => String(value || '').trim(),
    normalizeDateYyyyMmDd = (value) => String(value || '').trim(),
    normalizeTimeHhMm = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    toBooleanSafe = (value, fallback = false) =>
      value === undefined || value === null ? fallback : Boolean(value),
    normalizeColdcallingStack = (value) => String(value || '').trim(),
    getColdcallingStackLabel = () => '',
    buildGeneratedLeadFollowUpFromCall = () => null,
    buildLeadOwnerFields = () => ({}),
    resolveAppointmentLocation = (...values) =>
      values.map((value) => String(value || '').trim()).find(Boolean) || '',
    resolveCallDurationSeconds = () => 0,
    resolvePreferredRecordingUrl = () => '',
    sanitizeAppointmentLocation = (value) => String(value || '').trim(),
    sanitizeAppointmentWhatsappInfo = (value) => String(value || '').trim(),
    resolveAgendaLocationValue = (...values) =>
      values.map((value) => String(value || '').trim()).find(Boolean) || '',
    isInterestedLeadDismissedForRow = () => false,
    hasNegativeInterestSignal = (value) => {
      const text = normalizeLeadIdentityText(value);
      if (!text) return false;
      return /(niet meer bellen|bel( me)? niet|geen interesse|geen behoefte|niet geinteresseerd|niet geïnteresseerd|stop( met)? bellen|do not call|dnc|remove from list|uit bellijst|geen prioriteit|geen tijd voor|zijn voorzien|al voorzien|tevreden met huidige partij)/.test(
        text
      );
    },
    hasPositiveInterestSignal = (value) => {
      const text = normalizeLeadIdentityText(value);
      if (!text) return false;
      return /(interesse|geinteresseerd|geïnteresseerd|afspraak|demo|offerte|voorstel|prijsopgave|kennismaking|stuur (de )?(offerte|informatie|info|voorstel)|mail .* (offerte|informatie|info|voorstel)|callback|terugbellen|terugbel)/.test(
        text
      );
    },
  } = deps;

  function normalizeSearchText(value) {
    return normalizeLeadIdentityText(value);
  }

  function looksLikeAgendaConfirmationSummary(value) {
    const text = normalizeSearchText(value);
    if (!text) return false;
    return /(^op \d{4}-\d{2}-\d{2}\b|^namens\b|afspraak ingepland|bevestigingsbericht|definitieve bevestiging|twee collega|langskomen|volgactie|bevestigingsmail sturen|stuur(?:\s+\w+){0,3}\s+bevestigingsmail|gedetecteerde afspraak|afspraakbevestiging|agenda-item)/.test(
      text
    );
  }

  function isGenericConversationSummaryPlaceholder(value) {
    const text = normalizeSearchText(value);
    if (!text) return false;
    return (
      text === 'nog geen gesprekssamenvatting beschikbaar.' ||
      text === 'samenvatting volgt na verwerking van het gesprek.' ||
      text === 'samenvatting wordt opgesteld op basis van de transcriptie.'
    );
  }

  function pickReadableLeadSummary(...candidates) {
    for (const candidate of candidates) {
      const text = normalizeString(candidate || '');
      if (!text) continue;
      if (isGenericConversationSummaryPlaceholder(text)) continue;
      if (looksLikeAgendaConfirmationSummary(text)) continue;
      return truncateText(text, 900);
    }
    return '';
  }

  function buildLeadFollowUpCandidateKey(item) {
    return buildLeadIdentityKey(item);
  }

  function getLeadLikeRecencyTimestamp(value) {
    const explicitMs = Number(value?.updatedAtMs || value?.analyzedAtMs || 0);
    if (Number.isFinite(explicitMs) && explicitMs > 0) return explicitMs;

    const candidateFields = [
      value?.confirmationTaskCreatedAt,
      value?.createdAt,
      value?.updatedAt,
      value?.endedAt,
      value?.analyzedAt,
      value?.startedAt,
      value?.confirmationResponseReceivedAt,
      value?.confirmationEmailSentAt,
    ];

    for (const candidate of candidateFields) {
      const parsed = Date.parse(normalizeString(candidate || ''));
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }

    const date = normalizeDateYyyyMmDd(value?.date || '');
    const time = normalizeTimeHhMm(value?.time || '') || '00:00';
    if (date) {
      const parsed = Date.parse(`${date}T${time}:00`);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }

    return 0;
  }

  function toIsoStringFromTimestamp(timestampMs) {
    const safeMs = Number(timestampMs || 0);
    if (Number.isFinite(safeMs) && safeMs > 0) {
      return new Date(safeMs).toISOString();
    }
    return '';
  }

  function resolveCandidateDate(timestampMs, fallbackValues = []) {
    for (const value of fallbackValues) {
      const normalized = normalizeDateYyyyMmDd(value || '');
      if (normalized) return normalized;
    }
    const iso = toIsoStringFromTimestamp(timestampMs);
    return iso ? iso.slice(0, 10) : '';
  }

  function resolveCandidateTime(timestampMs, fallbackValues = []) {
    for (const value of fallbackValues) {
      const normalized = normalizeTimeHhMm(value || '');
      if (normalized) return normalized;
    }
    const iso = toIsoStringFromTimestamp(timestampMs);
    return iso ? iso.slice(11, 16) : '09:00';
  }

  function buildOwnerFieldsForOccurrence(callId, preferredValues = null) {
    if (preferredValues && typeof preferredValues === 'object') {
      const explicit = buildLeadOwnerFields(callId, preferredValues);
      if (explicit && typeof explicit === 'object') return explicit;
    }
    return buildLeadOwnerFields(callId) || {};
  }

  function buildInterestSearchText(update, insight) {
    return normalizeSearchText(
      [
        update?.status,
        update?.messageType,
        update?.endedReason,
        update?.summary,
        update?.transcriptSnippet,
        update?.transcriptFull,
        insight?.summary,
        insight?.followUpReason,
      ]
        .map((item) => normalizeString(item || ''))
        .filter(Boolean)
        .join(' ')
    );
  }

  function isInterestedOccurrence(update, insight) {
    const searchText = buildInterestSearchText(update, insight);
    if (hasNegativeInterestSignal(searchText)) return false;

    if (
      toBooleanSafe(insight?.appointmentBooked, false) ||
      toBooleanSafe(insight?.appointment_booked, false) ||
      toBooleanSafe(insight?.followUpRequired, false) ||
      toBooleanSafe(insight?.follow_up_required, false)
    ) {
      return true;
    }

    if (hasPositiveInterestSignal(searchText)) return true;
    return false;
  }

  function buildOpenLeadFollowUpRows() {
    return getGeneratedAgendaAppointments()
      .slice()
      .map((appointment) => {
        if (!appointment || typeof appointment !== 'object') return null;
        const task = mapAppointmentToConfirmationTask(appointment);
        if (!task) return null;

        const callId = normalizeString(task?.callId || appointment?.callId || '');
        if (callId.startsWith('demo-')) return null;

        const occurredAtMs = getLeadLikeRecencyTimestamp(task || appointment);
        const occurredAtIso =
          normalizeString(
            task?.confirmationTaskCreatedAt ||
              task?.createdAt ||
              appointment?.confirmationTaskCreatedAt ||
              appointment?.createdAt ||
              task?.updatedAt ||
              appointment?.updatedAt ||
              ''
          ) || toIsoStringFromTimestamp(occurredAtMs);

        const ownerFields = buildOwnerFieldsForOccurrence(callId, {
          key: task?.leadOwnerKey || appointment?.leadOwnerKey || '',
          displayName: task?.leadOwnerName || appointment?.leadOwnerName || '',
          fullName: task?.leadOwnerFullName || appointment?.leadOwnerFullName || '',
          userId: task?.leadOwnerUserId || appointment?.leadOwnerUserId || '',
          email: task?.leadOwnerEmail || appointment?.leadOwnerEmail || '',
        });

        const row = {
          id: Number(task?.id || appointment?.id || 0) || 0,
          appointmentId: Number(task?.appointmentId || appointment?.id || 0) || 0,
          callId,
          company: normalizeString(task?.company || appointment?.company || '') || 'Onbekende lead',
          contact: normalizeString(task?.contact || appointment?.contact || ''),
          phone: normalizeString(task?.phone || appointment?.phone || ''),
          contactEmail: normalizeString(task?.contactEmail || appointment?.contactEmail || ''),
          branche: normalizeString(task?.branche || appointment?.branche || ''),
          province: normalizeString(task?.province || appointment?.province || ''),
          address: normalizeString(task?.address || appointment?.address || ''),
          date: resolveCandidateDate(occurredAtMs, [task?.date, appointment?.date]),
          time: resolveCandidateTime(occurredAtMs, [task?.time, appointment?.time]),
          source:
            normalizeString(task?.source || appointment?.source || 'Lead opvolging') || 'Lead opvolging',
          summary: pickReadableLeadSummary(task?.summary, appointment?.summary),
          location: resolveAgendaLocationValue(
            sanitizeAppointmentLocation(task?.location || appointment?.location || appointment?.appointmentLocation || ''),
            task?.summary || '',
            task?.whatsappInfo || appointment?.whatsappInfo || ''
          ),
          whatsappInfo: sanitizeAppointmentWhatsappInfo(
            task?.whatsappInfo || appointment?.whatsappInfo || appointment?.whatsappNotes || ''
          ),
          recordingUrl: resolvePreferredRecordingUrl(task, appointment),
          durationSeconds: resolveCallDurationSeconds(task, appointment),
          provider: normalizeString(task?.provider || appointment?.provider || '').toLowerCase(),
          providerLabel: normalizeString(task?.providerLabel || appointment?.providerLabel || ''),
          coldcallingStack: normalizeColdcallingStack(
            task?.coldcallingStack || appointment?.coldcallingStack || ''
          ),
          coldcallingStackLabel: normalizeString(
            task?.coldcallingStackLabel || appointment?.coldcallingStackLabel || task?.providerLabel || ''
          ),
          leadType: normalizeString(task?.leadType || appointment?.leadType || ''),
          leadChipLabel: 'INTERESSE',
          leadChipClass: 'confirmed',
          createdAt: occurredAtIso || new Date().toISOString(),
          confirmationTaskCreatedAt: occurredAtIso || null,
          updatedAtMs: occurredAtMs,
          ...ownerFields,
        };

        if (!buildLeadFollowUpCandidateKey(row)) return null;
        if (isInterestedLeadDismissedForRow(callId, row)) return null;
        return row;
      })
      .filter(Boolean);
  }

  function buildCancelledLeadFollowUpKeys() {
    const keys = new Set();
    getGeneratedAgendaAppointments().forEach((appointment) => {
      if (!appointment || typeof appointment !== 'object') return;
      const taskType = normalizeString(
        appointment?.confirmationTaskType || appointment?.taskType || appointment?.type || ''
      ).toLowerCase();
      if (taskType !== 'lead_follow_up') return;
      const cancelled = Boolean(
        appointment?.confirmationAppointmentCancelled || appointment?.confirmationAppointmentCancelledAt
      );
      if (!cancelled) return;
      const key = buildLeadFollowUpCandidateKey(appointment);
      if (key) keys.add(key);
    });
    return keys;
  }

  function buildInterestedOccurrenceRows() {
    const latestUpdateByCallId = new Map();
    getRecentCallUpdates().forEach((update) => {
      const callId = normalizeString(update?.callId || '');
      if (!callId || callId.startsWith('demo-')) return;
      const existing = latestUpdateByCallId.get(callId) || null;
      if (!existing || getLeadLikeRecencyTimestamp(update) >= getLeadLikeRecencyTimestamp(existing)) {
        latestUpdateByCallId.set(callId, update);
      }
    });

    const latestInsightByCallId = new Map();
    getRecentAiCallInsights().forEach((insight) => {
      const callId = normalizeString(insight?.callId || '');
      if (!callId || callId.startsWith('demo-')) return;
      const existing = latestInsightByCallId.get(callId) || null;
      if (!existing || getLeadLikeRecencyTimestamp(insight) >= getLeadLikeRecencyTimestamp(existing)) {
        latestInsightByCallId.set(callId, insight);
      }
    });

    const allCallIds = new Set([...latestUpdateByCallId.keys(), ...latestInsightByCallId.keys()]);
    const cancelledLeadKeys = buildCancelledLeadFollowUpKeys();

    return Array.from(allCallIds)
      .map((callId) => {
        const update = latestUpdateByCallId.get(callId) || null;
        const insight = latestInsightByCallId.get(callId) || null;
        if (!update && !insight) return null;

        const occurredAtMs = Math.max(
          getLeadLikeRecencyTimestamp(update),
          getLeadLikeRecencyTimestamp(insight),
          0
        );
        const occurredAtIso =
          normalizeString(update?.updatedAt || update?.endedAt || insight?.analyzedAt || '') ||
          toIsoStringFromTimestamp(occurredAtMs);
        const derivedFollowUp = buildGeneratedLeadFollowUpFromCall(update, insight) || null;
        const hasDerivedFollowUp = Boolean(derivedFollowUp && typeof derivedFollowUp === 'object');
        if (!hasDerivedFollowUp && !isInterestedOccurrence(update, insight)) return null;
        const coldcallingStack = normalizeColdcallingStack(
          update?.stack || insight?.coldcallingStack || insight?.stack || derivedFollowUp?.coldcallingStack || ''
        );
        const coldcallingStackLabel = normalizeString(
          update?.stackLabel ||
            insight?.coldcallingStackLabel ||
            insight?.stackLabel ||
            derivedFollowUp?.coldcallingStackLabel ||
            getColdcallingStackLabel(coldcallingStack)
        );
        const row = {
          id: 0,
          appointmentId: 0,
          callId,
          company:
            normalizeString(
              derivedFollowUp?.company || update?.company || insight?.company || insight?.leadCompany || ''
            ) || 'Onbekende lead',
          contact:
            normalizeString(
              derivedFollowUp?.contact || update?.name || insight?.contactName || insight?.leadName || ''
            ),
          phone: normalizeString(derivedFollowUp?.phone || update?.phone || insight?.phone || ''),
          contactEmail: normalizeString(
            derivedFollowUp?.contactEmail || insight?.contactEmail || insight?.email || insight?.leadEmail || ''
          ),
          branche: normalizeString(update?.branche || insight?.branche || derivedFollowUp?.branche || ''),
          province: normalizeString(update?.province || insight?.province || derivedFollowUp?.province || ''),
          address: normalizeString(update?.address || insight?.address || derivedFollowUp?.address || ''),
          date: resolveCandidateDate(occurredAtMs, [derivedFollowUp?.date]),
          time: resolveCandidateTime(occurredAtMs, [derivedFollowUp?.time]),
          source:
            normalizeString(derivedFollowUp?.source || update?.source || insight?.source || 'Coldcalling interesse') ||
            'Coldcalling interesse',
          summary: pickReadableLeadSummary(
            insight?.summary,
            derivedFollowUp?.summary,
            update?.summary,
            update?.transcriptSnippet,
            update?.transcriptFull
          ),
          location: resolveAgendaLocationValue(
            sanitizeAppointmentLocation(
              derivedFollowUp?.location ||
                derivedFollowUp?.appointmentLocation ||
                update?.location ||
                insight?.location ||
                ''
            ),
            derivedFollowUp?.summary || update?.summary || insight?.summary || '',
            insight?.followUpReason || ''
          ),
          whatsappInfo: sanitizeAppointmentWhatsappInfo(
            insight?.followUpReason || derivedFollowUp?.whatsappInfo || ''
          ),
          recordingUrl: resolvePreferredRecordingUrl(derivedFollowUp, update, insight),
          durationSeconds: resolveCallDurationSeconds(derivedFollowUp, update, insight),
          provider: normalizeString(derivedFollowUp?.provider || update?.provider || insight?.provider || '').toLowerCase(),
          providerLabel: coldcallingStackLabel || '',
          coldcallingStack: coldcallingStack || '',
          coldcallingStackLabel: coldcallingStackLabel || '',
          leadType: normalizeString(
            derivedFollowUp?.leadType ||
              insight?.businessMode ||
              insight?.business_mode ||
              insight?.serviceType ||
              insight?.service_type ||
              update?.businessMode ||
              update?.business_mode ||
              update?.serviceType ||
              update?.service_type ||
              ''
          ),
          leadChipLabel: 'INTERESSE',
          leadChipClass: 'confirmed',
          createdAt: occurredAtIso || new Date().toISOString(),
          confirmationTaskCreatedAt: occurredAtIso || null,
          updatedAtMs: occurredAtMs,
          ...buildOwnerFieldsForOccurrence(callId),
        };

        if (!buildLeadFollowUpCandidateKey(row)) return null;
        if (cancelledLeadKeys.has(buildLeadFollowUpCandidateKey(row))) return null;
        if (isInterestedLeadDismissedForRow(callId, row)) return null;
        return row;
      })
      .filter(Boolean);
  }

  function isInterestedLeadRowPreferred(candidate, existing) {
    const candidateTs = getLeadLikeRecencyTimestamp(candidate);
    const existingTs = getLeadLikeRecencyTimestamp(existing);
    if (candidateTs !== existingTs) return candidateTs > existingTs;

    const candidateHasSummary = Boolean(normalizeString(candidate?.summary || ''));
    const existingHasSummary = Boolean(normalizeString(existing?.summary || ''));
    if (candidateHasSummary !== existingHasSummary) return candidateHasSummary;

    const candidateHasTaskId =
      Number(candidate?.id || 0) > 0 || Number(candidate?.appointmentId || 0) > 0;
    const existingHasTaskId =
      Number(existing?.id || 0) > 0 || Number(existing?.appointmentId || 0) > 0;
    if (candidateHasTaskId !== existingHasTaskId) return candidateHasTaskId;

    const candidateHasCall = Boolean(normalizeString(candidate?.callId || ''));
    const existingHasCall = Boolean(normalizeString(existing?.callId || ''));
    if (candidateHasCall !== existingHasCall) return candidateHasCall;

    const candidateHasRecording = Boolean(resolvePreferredRecordingUrl(candidate));
    const existingHasRecording = Boolean(resolvePreferredRecordingUrl(existing));
    if (candidateHasRecording !== existingHasRecording) return candidateHasRecording;

    return false;
  }

  function mergeInterestedLeadRows(preferred, secondary) {
    const preferredId = Number(preferred?.id || 0) || 0;
    const secondaryId = Number(secondary?.id || 0) || 0;
    const preferredAppointmentId = Number(preferred?.appointmentId || 0) || 0;
    const secondaryAppointmentId = Number(secondary?.appointmentId || 0) || 0;
    const mergedId = preferredId || secondaryId || preferredAppointmentId || secondaryAppointmentId || 0;
    const mergedAppointmentId = preferredAppointmentId || secondaryAppointmentId || mergedId || 0;
    const mergedSummary = pickReadableLeadSummary(
      preferred?.summary,
      secondary?.summary,
      preferred?.conversationSummary,
      secondary?.conversationSummary
    );

    return {
      ...secondary,
      ...preferred,
      id: mergedId,
      appointmentId: mergedAppointmentId,
      callId: normalizeString(preferred?.callId || secondary?.callId || ''),
      company: normalizeString(preferred?.company || secondary?.company || '') || 'Onbekende lead',
      contact: normalizeString(preferred?.contact || secondary?.contact || ''),
      phone: normalizeString(preferred?.phone || secondary?.phone || ''),
      contactEmail: normalizeString(preferred?.contactEmail || secondary?.contactEmail || ''),
      branche: normalizeString(preferred?.branche || secondary?.branche || ''),
      province: normalizeString(preferred?.province || secondary?.province || ''),
      address: normalizeString(preferred?.address || secondary?.address || ''),
      date: normalizeDateYyyyMmDd(preferred?.date || secondary?.date || '') || '',
      time: normalizeTimeHhMm(preferred?.time || secondary?.time || '') || '09:00',
      source: normalizeString(preferred?.source || secondary?.source || ''),
      summary: mergedSummary || '',
      conversationSummary: mergedSummary || '',
      location: normalizeString(preferred?.location || secondary?.location || ''),
      whatsappInfo: sanitizeAppointmentWhatsappInfo(preferred?.whatsappInfo || secondary?.whatsappInfo || ''),
      createdAt:
        normalizeString(
          preferred?.createdAt ||
            secondary?.createdAt ||
            preferred?.confirmationTaskCreatedAt ||
            secondary?.confirmationTaskCreatedAt ||
            ''
        ) || new Date().toISOString(),
      confirmationTaskCreatedAt:
        normalizeString(
          preferred?.confirmationTaskCreatedAt ||
            secondary?.confirmationTaskCreatedAt ||
            preferred?.createdAt ||
            secondary?.createdAt ||
            ''
        ) || null,
      recordingUrl: normalizeString(preferred?.recordingUrl || secondary?.recordingUrl || ''),
      durationSeconds: resolveCallDurationSeconds(preferred, secondary),
      provider: normalizeString(preferred?.provider || secondary?.provider || '').toLowerCase(),
      providerLabel: normalizeString(preferred?.providerLabel || secondary?.providerLabel || ''),
      coldcallingStack: normalizeColdcallingStack(preferred?.coldcallingStack || secondary?.coldcallingStack || ''),
      coldcallingStackLabel: normalizeString(
        preferred?.coldcallingStackLabel || secondary?.coldcallingStackLabel || ''
      ),
      leadType: normalizeString(preferred?.leadType || secondary?.leadType || ''),
      leadChipLabel: normalizeString(preferred?.leadChipLabel || secondary?.leadChipLabel || ''),
      leadChipClass: normalizeString(preferred?.leadChipClass || secondary?.leadChipClass || ''),
      updatedAtMs: Math.max(getLeadLikeRecencyTimestamp(preferred), getLeadLikeRecencyTimestamp(secondary)),
      leadOwnerKey: normalizeString(preferred?.leadOwnerKey || secondary?.leadOwnerKey || ''),
      leadOwnerName: normalizeString(preferred?.leadOwnerName || secondary?.leadOwnerName || ''),
      leadOwnerFullName: normalizeString(preferred?.leadOwnerFullName || secondary?.leadOwnerFullName || ''),
      leadOwnerUserId: normalizeString(preferred?.leadOwnerUserId || secondary?.leadOwnerUserId || ''),
      leadOwnerEmail: normalizeString(preferred?.leadOwnerEmail || secondary?.leadOwnerEmail || ''),
    };
  }

  function dedupeInterestedLeadRows(rows = []) {
    const map = new Map();

    (Array.isArray(rows) ? rows : []).forEach((row) => {
      if (!row || typeof row !== 'object') return;
      const rowId = Number(row?.id || row?.appointmentId || 0) || 0;
      const callId = normalizeString(row?.callId || '');
      const key =
        buildLeadFollowUpCandidateKey(row) ||
        (callId ? `call:${callId}` : rowId > 0 ? `id:${rowId}` : '');
      if (!key) return;

      if (!map.has(key)) {
        map.set(key, row);
        return;
      }

      const existing = map.get(key) || {};
      const preferred = isInterestedLeadRowPreferred(row, existing) ? row : existing;
      const secondary = preferred === row ? existing : row;
      map.set(key, mergeInterestedLeadRows(preferred, secondary));
    });

    return Array.from(map.values()).sort((a, b) => {
      const diff = getLeadLikeRecencyTimestamp(b) - getLeadLikeRecencyTimestamp(a);
      if (diff !== 0) return diff;
      return compareConfirmationTasks(a, b);
    });
  }

  function getMaterializedInterestedLeadRows() {
    return dedupeInterestedLeadRows(buildOpenLeadFollowUpRows());
  }

  function buildInterestedLeadCandidateRows(existingTasks = []) {
    const existingCallIds = new Set();
    const existingKeys = new Set();
    (Array.isArray(existingTasks) ? existingTasks : []).forEach((task) => {
      const callId = normalizeString(task?.callId || '');
      const key = buildLeadFollowUpCandidateKey(task);
      if (callId) existingCallIds.add(callId);
      if (key) existingKeys.add(key);
    });

    return buildInterestedOccurrenceRows().filter((row) => {
      const callId = normalizeString(row?.callId || '');
      const key = buildLeadFollowUpCandidateKey(row);
      if (callId && existingCallIds.has(callId)) return false;
      if (key && existingKeys.has(key)) return false;
      return true;
    });
  }

  function buildGroupedColdcallingLeadRows(existingTasks = []) {
    return buildInterestedLeadCandidateRows(existingTasks);
  }

  function buildAllInterestedLeadRows() {
    return dedupeInterestedLeadRows([].concat(getMaterializedInterestedLeadRows(), buildInterestedOccurrenceRows()));
  }

  function buildLatestInterestedLeadRowsByKey() {
    const rows = buildAllInterestedLeadRows();
    const map = new Map();
    rows.forEach((row) => {
      const key = buildLeadFollowUpCandidateKey(row);
      if (key) map.set(key, row);
    });
    return map;
  }

  function findInterestedLeadRowByCallId(callId) {
    const normalizedCallId = normalizeString(callId || '');
    if (!normalizedCallId) return null;
    return buildAllInterestedLeadRows().find((row) => normalizeString(row?.callId || '') === normalizedCallId) || null;
  }

  function collectInterestedLeadCallIdsByIdentity(callId, rowLike = {}) {
    const normalizedCallId = normalizeString(callId || '');
    const identityKey =
      buildLeadFollowUpCandidateKey(rowLike || {}) ||
      buildLeadFollowUpCandidateKey(findInterestedLeadRowByCallId(normalizedCallId) || {});
    const collected = new Set();

    function maybeCollect(candidateCallId, candidateLike = {}) {
      const safeCallId = normalizeString(candidateCallId || '');
      if (!safeCallId || safeCallId.startsWith('demo-')) return;
      if (normalizedCallId && safeCallId === normalizedCallId) {
        collected.add(safeCallId);
        return;
      }
      if (!identityKey) return;
      const candidateKey = buildLeadFollowUpCandidateKey(candidateLike || {});
      if (candidateKey && candidateKey === identityKey) {
        collected.add(safeCallId);
      }
    }

    if (normalizedCallId) collected.add(normalizedCallId);

    getGeneratedAgendaAppointments().forEach((appointment) => {
      maybeCollect(appointment?.callId, appointment);
    });
    getRecentCallUpdates().forEach((update) => {
      maybeCollect(update?.callId, {
        company: update?.company || '',
        contact: update?.name || '',
        phone: update?.phone || '',
      });
    });
    getRecentAiCallInsights().forEach((insight) => {
      maybeCollect(insight?.callId, {
        company: insight?.company || insight?.leadCompany || '',
        contact: insight?.contactName || insight?.leadName || '',
        phone: insight?.phone || '',
      });
    });

    return Array.from(collected);
  }

  return {
    buildAllInterestedLeadRows,
    collectInterestedLeadCallIdsByIdentity,
    buildGroupedColdcallingLeadRows,
    buildInterestedLeadCandidateRows,
    buildLatestInterestedLeadRowsByKey,
    buildLeadFollowUpCandidateKey,
    dedupeInterestedLeadRows,
    findInterestedLeadRowByCallId,
    getLeadLikeRecencyTimestamp,
    getMaterializedInterestedLeadRows,
    getOpenInterestedLeadTasks: () => getMaterializedInterestedLeadRows(),
    normalizeLeadLikePhoneKey,
  };
}

module.exports = {
  createAgendaInterestedLeadReadService,
};
