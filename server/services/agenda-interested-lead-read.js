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
    hasNegativeInterestSignal = () => false,
    hasPositiveInterestSignal = () => false,
  } = deps;

  function buildLeadFollowUpCandidateKey(item) {
    return buildLeadIdentityKey(item);
  }

  function getLeadLikeRecencyTimestamp(value) {
    const explicit = Date.parse(
      normalizeString(
        value?.confirmationTaskCreatedAt ||
          value?.createdAt ||
          value?.updatedAt ||
          value?.endedAt ||
          value?.analyzedAt ||
          value?.startedAt ||
          ''
      )
    );
    if (Number.isFinite(explicit) && explicit > 0) return explicit;

    const date = normalizeDateYyyyMmDd(value?.date || '');
    const time = normalizeTimeHhMm(value?.time || '') || '00:00';
    if (date) {
      const parsed = Date.parse(`${date}T${time}:00`);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 0;
  }

  function isInterestedLeadRowPreferred(candidate, existing) {
    const candidateTs = getLeadLikeRecencyTimestamp(candidate);
    const existingTs = getLeadLikeRecencyTimestamp(existing);
    if (candidateTs !== existingTs) return candidateTs > existingTs;

    const candidateConfirmed = normalizeString(candidate?.leadChipClass || '').toLowerCase() === 'confirmed';
    const existingConfirmed = normalizeString(existing?.leadChipClass || '').toLowerCase() === 'confirmed';
    if (candidateConfirmed !== existingConfirmed) return candidateConfirmed;

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

    return {
      ...secondary,
      ...preferred,
      id: mergedId,
      appointmentId: mergedAppointmentId,
      type: normalizeString(preferred?.type || secondary?.type || ''),
      confirmationTaskType: normalizeString(
        preferred?.confirmationTaskType || secondary?.confirmationTaskType || preferred?.type || secondary?.type || ''
      ),
      company: normalizeString(preferred?.company || secondary?.company || '') || 'Onbekende lead',
      contact: normalizeString(preferred?.contact || secondary?.contact || ''),
      phone: normalizeString(preferred?.phone || secondary?.phone || ''),
      date: normalizeDateYyyyMmDd(preferred?.date || secondary?.date || '') || '',
      time: normalizeTimeHhMm(preferred?.time || secondary?.time || '') || '09:00',
      source: normalizeString(preferred?.source || secondary?.source || ''),
      summary: truncateText(normalizeString(preferred?.summary || secondary?.summary || ''), 900),
      location: resolveAppointmentLocation(preferred, secondary),
      durationSeconds: resolveCallDurationSeconds(preferred, secondary),
      whatsappInfo: sanitizeAppointmentWhatsappInfo(preferred?.whatsappInfo || secondary?.whatsappInfo || ''),
      recordingUrl: resolvePreferredRecordingUrl(preferred, secondary),
      provider: normalizeString(preferred?.provider || secondary?.provider || '').toLowerCase(),
      providerLabel: normalizeString(preferred?.providerLabel || secondary?.providerLabel || ''),
      coldcallingStack: normalizeColdcallingStack(preferred?.coldcallingStack || secondary?.coldcallingStack || ''),
      coldcallingStackLabel: normalizeString(
        preferred?.coldcallingStackLabel ||
          secondary?.coldcallingStackLabel ||
          preferred?.providerLabel ||
          secondary?.providerLabel ||
          ''
      ),
      leadType: normalizeString(preferred?.leadType || secondary?.leadType || ''),
      leadChipLabel: normalizeString(preferred?.leadChipLabel || secondary?.leadChipLabel || ''),
      leadChipClass: normalizeString(preferred?.leadChipClass || secondary?.leadChipClass || ''),
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

    return Array.from(map.values()).sort(compareConfirmationTasks);
  }

  function buildInterestedLeadCandidateRows(existingTasks = []) {
    const existingCallIds = new Set();
    const existingLatestTsByKey = new Map();
    (Array.isArray(existingTasks) ? existingTasks : []).forEach((task) => {
      const callId = normalizeString(task?.callId || '');
      if (callId) existingCallIds.add(callId);
      const key = buildLeadFollowUpCandidateKey(task);
      if (key) {
        existingLatestTsByKey.set(
          key,
          Math.max(Number(existingLatestTsByKey.get(key) || 0), getLeadLikeRecencyTimestamp(task))
        );
      }
    });

    const insightByCallId = new Map();
    const insightByPhoneKey = new Map();
    const insightByCompanyKey = new Map();
    getRecentAiCallInsights().forEach((insight) => {
      const callId = normalizeString(insight?.callId || '');
      const phoneKey = normalizeLeadLikePhoneKey(insight?.phone || '');
      const companyKey = normalizeLeadIdentityText(insight?.company || insight?.leadCompany || '');
      if (callId && !insightByCallId.has(callId)) insightByCallId.set(callId, insight);
      if (phoneKey && !insightByPhoneKey.has(phoneKey)) insightByPhoneKey.set(phoneKey, insight);
      if (companyKey && !insightByCompanyKey.has(companyKey)) insightByCompanyKey.set(companyKey, insight);
    });

    const seenCallIds = new Set();
    const seenKeys = new Set();
    const rows = getRecentCallUpdates()
      .slice()
      .filter((item) => {
        const callId = normalizeString(item?.callId || '');
        return callId && !callId.startsWith('demo-');
      })
      .sort((a, b) => {
        const aTs = Number(a?.updatedAtMs || 0) || Date.parse(normalizeString(a?.updatedAt || a?.endedAt || '')) || 0;
        const bTs = Number(b?.updatedAtMs || 0) || Date.parse(normalizeString(b?.updatedAt || b?.endedAt || '')) || 0;
        return bTs - aTs;
      })
      .map((callUpdate) => {
        const callId = normalizeString(callUpdate?.callId || '');
        if (!callId || existingCallIds.has(callId) || seenCallIds.has(callId)) return null;
        if (
          isInterestedLeadDismissedForRow(callId, {
            phone: callUpdate?.phone || '',
            company: callUpdate?.company || '',
            contact: callUpdate?.name || '',
          })
        ) {
          return null;
        }

        const phoneKey = normalizeLeadLikePhoneKey(callUpdate?.phone || '');
        const companyKey = normalizeLeadIdentityText(callUpdate?.company || '');
        const insight =
          insightByCallId.get(callId) ||
          (phoneKey ? insightByPhoneKey.get(phoneKey) : null) ||
          (companyKey ? insightByCompanyKey.get(companyKey) : null) ||
          null;

        const leadFollowUp = buildGeneratedLeadFollowUpFromCall(callUpdate, insight);
        if (!leadFollowUp) return null;

        const coldcallingStack = normalizeColdcallingStack(
          leadFollowUp?.coldcallingStack || callUpdate?.stack || insight?.coldcallingStack || insight?.stack || ''
        );
        const coldcallingStackLabel = normalizeString(
          leadFollowUp?.coldcallingStackLabel ||
            callUpdate?.stackLabel ||
            insight?.coldcallingStackLabel ||
            insight?.stackLabel ||
            getColdcallingStackLabel(coldcallingStack)
        );
        const row = {
          id: 0,
          callId,
          company: normalizeString(leadFollowUp?.company || '') || 'Onbekende lead',
          contact: normalizeString(leadFollowUp?.contact || ''),
          phone: normalizeString(leadFollowUp?.phone || ''),
          date: normalizeDateYyyyMmDd(leadFollowUp?.date) || '',
          time: normalizeTimeHhMm(leadFollowUp?.time) || '09:00',
          source: 'Coldcalling interesse',
          summary: truncateText(
            normalizeString(
              leadFollowUp?.summary ||
                insight?.summary ||
                callUpdate?.summary ||
                callUpdate?.transcriptSnippet ||
                insight?.followUpReason ||
                ''
            ),
            900
          ),
          location: resolveAppointmentLocation(leadFollowUp, callUpdate, insight),
          durationSeconds: resolveCallDurationSeconds(leadFollowUp, callUpdate, insight),
          whatsappInfo: truncateText(normalizeString(insight?.followUpReason || ''), 6000),
          recordingUrl: resolvePreferredRecordingUrl(leadFollowUp, callUpdate, insight),
          provider: normalizeString(leadFollowUp?.provider || callUpdate?.provider || '').toLowerCase(),
          providerLabel: coldcallingStackLabel || '',
          coldcallingStack: coldcallingStack || '',
          coldcallingStackLabel: coldcallingStackLabel || '',
          leadType: normalizeString(
            insight?.businessMode ||
              insight?.business_mode ||
              insight?.serviceType ||
              insight?.service_type ||
              callUpdate?.businessMode ||
              callUpdate?.business_mode ||
              callUpdate?.serviceType ||
              callUpdate?.service_type ||
              ''
          ),
          leadChipLabel: 'INTERESSE',
          leadChipClass: 'confirmed',
          createdAt:
            normalizeString(leadFollowUp?.createdAt || callUpdate?.endedAt || callUpdate?.updatedAt || '') ||
            new Date().toISOString(),
          ...buildLeadOwnerFields(callId, leadFollowUp),
        };
        const key = buildLeadFollowUpCandidateKey(row);
        if (isInterestedLeadDismissedForRow(callId, row)) return null;
        const rowTs = getLeadLikeRecencyTimestamp(row);
        if (key && Number(existingLatestTsByKey.get(key) || 0) >= rowTs) return null;
        if (key && seenKeys.has(key)) return null;

        seenCallIds.add(callId);
        if (key) seenKeys.add(key);
        return row;
      })
      .filter(Boolean);

    rows.sort(compareConfirmationTasks);
    return rows;
  }

  function normalizeColdcallingLeadDecision(value) {
    const raw = normalizeString(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (/^(pending|nieuw|new|not_called|nog[-_ ]?niet[-_ ]?gebeld)$/.test(raw)) return 'pending';
    if (/^(called|gebeld)$/.test(raw)) return 'called';
    if (/^(no_answer|niet[-_ ]?opgenomen|geen[-_ ]?gehoor|busy|voicemail|missed)$/.test(raw)) return 'no_answer';
    if (/^(callback|terugbellen|follow[-_ ]?up)$/.test(raw)) return 'callback';
    if (/^(appointment|afspraak|meeting)$/.test(raw)) return 'appointment';
    if (/^(customer|klant|closed|won)$/.test(raw)) return 'customer';
    if (/^(do_not_call|dnc|uit[-_ ]?bellijst|stop|blacklist|remove)$/.test(raw)) return 'do_not_call';
    return '';
  }

  function normalizeColdcallingLeadSearch(value) {
    return normalizeLeadIdentityText(value);
  }

  function isServeCreusenLeadLikeServer(row) {
    const haystack = normalizeColdcallingLeadSearch(
      [row?.company || row?.name || '', row?.contact || row?.contactName || row?.leadName || ''].join(' ')
    );
    return /\bserve creusen\b/.test(haystack);
  }

  function inferColdcallingLeadDecisionFromSignals({ callCount = 0, latestUpdate = null, latestInsight = null }) {
    const updateStatusText = normalizeColdcallingLeadSearch(
      `${latestUpdate?.status || ''} ${latestUpdate?.messageType || ''} ${latestUpdate?.endedReason || ''}`
    );
    const combinedText = normalizeColdcallingLeadSearch(
      [
        latestInsight?.summary,
        latestInsight?.followUpReason,
        latestUpdate?.summary,
        latestUpdate?.transcriptSnippet,
        latestUpdate?.transcriptFull,
      ]
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .join(' ')
    );

    if (toBooleanSafe(latestInsight?.appointmentBooked, false)) return 'appointment';
    if (hasNegativeInterestSignal(combinedText)) return 'do_not_call';
    if (
      /(is klant|klant geworden|geworden klant|deal gesloten|offerte akkoord|getekend|abonnement afgesloten|conversie naar klant)/.test(
        combinedText
      )
    ) {
      return 'customer';
    }
    if (/(afspraak|intake gepland|meeting gepland|demo gepland|belafspraak|call ingepland|kalender afspraak)/.test(combinedText)) {
      return 'appointment';
    }
    if (/(terugbellen|bel later|later terugbellen|follow up|follow-up|volgende week|later deze week|stuur mail|mail sturen)/.test(combinedText)) {
      return 'callback';
    }
    if (hasPositiveInterestSignal(combinedText)) return 'callback';
    if (
      /(no[-_ ]?answer|geen gehoor|voicemail|busy|bezet|failed|dial failed|dial_failed|rejected|cancelled|canceled|unanswered)/.test(
        updateStatusText
      )
    ) {
      return 'no_answer';
    }
    if (Number(callCount) > 0) return 'called';
    return 'pending';
  }

  function getCallLikeUpdatedAtMsServer(item) {
    const explicit = Number(item?.updatedAtMs || 0);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const analyzedAt = Date.parse(normalizeString(item?.analyzedAt || ''));
    if (Number.isFinite(analyzedAt) && analyzedAt > 0) return analyzedAt;
    const updatedAt = Date.parse(
      normalizeString(item?.updatedAt || item?.endedAt || item?.startedAt || item?.createdAt || '')
    );
    return Number.isFinite(updatedAt) ? updatedAt : 0;
  }

  function buildGroupedColdcallingLeadRows(existingTasks = []) {
    const existingCallIds = new Set();
    const existingLatestTsByKey = new Map();
    (Array.isArray(existingTasks) ? existingTasks : []).forEach((task) => {
      const callId = normalizeString(task?.callId || '');
      if (callId) existingCallIds.add(callId);
      const key = buildLeadFollowUpCandidateKey(task);
      if (key) {
        existingLatestTsByKey.set(
          key,
          Math.max(Number(existingLatestTsByKey.get(key) || 0), getLeadLikeRecencyTimestamp(task))
        );
      }
    });
    const seenKeys = new Set();

    const groups = new Map();
    function ensureGroup(key, seed = {}) {
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          phone: normalizeString(seed.phone || ''),
          company: normalizeString(seed.company || ''),
          contact: normalizeString(seed.contact || ''),
          updates: [],
          insights: [],
        });
      }
      const group = groups.get(key);
      if (!group.phone && seed.phone) group.phone = normalizeString(seed.phone || '');
      if (!group.company && seed.company) group.company = normalizeString(seed.company || '');
      if (!group.contact && seed.contact) group.contact = normalizeString(seed.contact || '');
      return group;
    }

    getRecentCallUpdates().forEach((update) => {
      const phoneDigits = normalizeLeadLikePhoneKey(update?.phone || '');
      const companyKey = normalizeColdcallingLeadSearch(update?.company || '');
      const key = phoneDigits ? `phone:${phoneDigits}` : companyKey ? `company:${companyKey}` : '';
      if (!key) return;
      const group = ensureGroup(key, {
        phone: update?.phone,
        company: update?.company,
        contact: update?.name,
      });
      group.updates.push(update);
    });

    getRecentAiCallInsights().forEach((insight) => {
      const phoneDigits = normalizeLeadLikePhoneKey(insight?.phone || '');
      const companyKey = normalizeColdcallingLeadSearch(insight?.company || insight?.leadCompany || '');
      const key = phoneDigits ? `phone:${phoneDigits}` : companyKey ? `company:${companyKey}` : '';
      if (!key) return;
      const group = ensureGroup(key, {
        phone: insight?.phone,
        company: insight?.company || insight?.leadCompany,
        contact: insight?.contactName || insight?.leadName,
      });
      group.insights.push(insight);
    });

    const rows = [];
    groups.forEach((group) => {
      const sortedUpdates = group.updates
        .slice()
        .sort((a, b) => getCallLikeUpdatedAtMsServer(b) - getCallLikeUpdatedAtMsServer(a));
      const sortedInsights = group.insights
        .slice()
        .sort((a, b) => getCallLikeUpdatedAtMsServer(b) - getCallLikeUpdatedAtMsServer(a));
      const latestUpdate = sortedUpdates[0] || null;
      const latestInsight = sortedInsights[0] || null;
      const serveCreusenMatch = isServeCreusenLeadLikeServer({
        company: group.company,
        contact: group.contact || latestInsight?.contactName || latestUpdate?.name || '',
      });
      const autoDecision = inferColdcallingLeadDecisionFromSignals({
        callCount: sortedUpdates.length,
        latestUpdate,
        latestInsight,
      });
      const decision = serveCreusenMatch ? 'callback' : normalizeColdcallingLeadDecision(autoDecision || 'pending');
      if (!['callback', 'appointment', 'customer'].includes(decision)) return;

      const row = normalizeString(group.phone || group.company)
        ? {
            id: 0,
            callId: normalizeString(latestUpdate?.callId || latestInsight?.callId || ''),
            company:
              normalizeString(
                group.company || latestUpdate?.company || latestInsight?.company || latestInsight?.leadCompany || ''
              ) || 'Onbekende lead',
            contact:
              normalizeString(
                group.contact || latestUpdate?.name || latestInsight?.contactName || latestInsight?.leadName || ''
              ),
            phone: normalizeString(group.phone || latestUpdate?.phone || latestInsight?.phone || ''),
            date:
              normalizeDateYyyyMmDd(latestUpdate?.endedAt || latestUpdate?.updatedAt || latestInsight?.analyzedAt || '') ||
              '',
            time:
              normalizeTimeHhMm(
                normalizeString(latestUpdate?.endedAt || latestUpdate?.updatedAt || latestInsight?.analyzedAt || '').slice(11, 16)
              ) || '09:00',
            source: 'Coldcalling lead',
            summary: truncateText(
              normalizeString(
                latestInsight?.summary ||
                  latestInsight?.followUpReason ||
                  latestUpdate?.summary ||
                  latestUpdate?.transcriptSnippet ||
                  latestUpdate?.transcriptFull ||
                  ''
              ),
              900
            ),
            location: resolveAppointmentLocation(latestUpdate, latestInsight),
            whatsappInfo: truncateText(normalizeString(latestInsight?.followUpReason || ''), 6000),
            recordingUrl: resolvePreferredRecordingUrl(latestUpdate, latestInsight),
            provider: normalizeString(latestUpdate?.provider || latestInsight?.provider || '').toLowerCase(),
            providerLabel: normalizeString(
              latestUpdate?.stackLabel || latestInsight?.coldcallingStackLabel || latestInsight?.stackLabel || ''
            ),
            coldcallingStack: normalizeColdcallingStack(
              latestUpdate?.stack || latestInsight?.coldcallingStack || latestInsight?.stack || ''
            ),
            coldcallingStackLabel: normalizeString(
              latestUpdate?.stackLabel ||
                latestInsight?.coldcallingStackLabel ||
                latestInsight?.stackLabel ||
                getColdcallingStackLabel(
                  normalizeColdcallingStack(
                    latestUpdate?.stack || latestInsight?.coldcallingStack || latestInsight?.stack || ''
                  )
                )
            ),
            leadType: normalizeString(
              latestInsight?.businessMode ||
                latestInsight?.business_mode ||
                latestInsight?.serviceType ||
                latestInsight?.service_type ||
                latestUpdate?.businessMode ||
                latestUpdate?.business_mode ||
                latestUpdate?.serviceType ||
                latestUpdate?.service_type ||
                ''
            ),
            leadChipLabel: 'INTERESSE',
            leadChipClass: 'confirmed',
            createdAt:
              normalizeString(latestUpdate?.updatedAt || latestUpdate?.endedAt || latestInsight?.analyzedAt || '') ||
              new Date().toISOString(),
            ...buildLeadOwnerFields(normalizeString(latestUpdate?.callId || latestInsight?.callId || '')),
          }
        : null;
      if (!row) return;

      const callId = normalizeString(row.callId || '');
      const key = buildLeadFollowUpCandidateKey(row);
      if (isInterestedLeadDismissedForRow(callId, row)) return;
      if (callId && existingCallIds.has(callId)) return;
      if (key && Number(existingLatestTsByKey.get(key) || 0) >= getLeadLikeRecencyTimestamp(row)) return;
      if (key && seenKeys.has(key)) return;
      existingCallIds.add(callId);
      if (key) seenKeys.add(key);
      rows.push(row);
    });

    rows.sort(compareConfirmationTasks);
    return rows;
  }

  function getOpenInterestedLeadTasks() {
    return getGeneratedAgendaAppointments()
      .filter((appointment) => {
        const callId = normalizeString(appointment?.callId || '');
        return !callId.startsWith('demo-');
      })
      .map(mapAppointmentToConfirmationTask)
      .filter(Boolean);
  }

  function buildLatestInterestedLeadRowsByKey() {
    const rows = dedupeInterestedLeadRows(
      [].concat(buildInterestedLeadCandidateRows([]), buildGroupedColdcallingLeadRows([]))
    );
    const map = new Map();
    rows.forEach((row) => {
      const key = buildLeadFollowUpCandidateKey(row);
      if (key) map.set(key, row);
    });
    return map;
  }

  function getMaterializedInterestedLeadRows() {
    const rows = [];
    const seenCallIds = new Set();
    const seenKeys = new Set();

    getGeneratedAgendaAppointments()
      .slice()
      .sort((a, b) => getLeadLikeRecencyTimestamp(b) - getLeadLikeRecencyTimestamp(a))
      .forEach((appointment) => {
        const callId = normalizeString(appointment?.callId || '');
        if (callId && callId.startsWith('demo-')) return;
        if (isInterestedLeadDismissedForRow(callId, appointment)) return;

        const pendingTask = mapAppointmentToConfirmationTask(appointment);
        if (!pendingTask) return;

        const row =
          pendingTask ||
          {
            id: Number(appointment?.id || 0) || 0,
            appointmentId: Number(appointment?.id || 0) || 0,
            type: normalizeString(appointment?.type || 'meeting') || 'meeting',
            confirmationTaskType: normalizeString(appointment?.confirmationTaskType || appointment?.type || ''),
            company: normalizeString(appointment?.company || '') || 'Onbekende lead',
            contact: normalizeString(appointment?.contact || '') || 'Onbekend',
            phone: normalizeString(appointment?.phone || ''),
            date: normalizeDateYyyyMmDd(appointment?.date || '') || '',
            time: normalizeTimeHhMm(appointment?.time || '') || '09:00',
            source: normalizeString(appointment?.source || 'Agenda afspraak'),
            summary: truncateText(normalizeString(appointment?.summary || ''), 900),
            location: resolveAgendaLocationValue(
              sanitizeAppointmentLocation(appointment?.location || appointment?.appointmentLocation || ''),
              appointment?.summary || '',
              appointment?.whatsappInfo || ''
            ),
            whatsappInfo: sanitizeAppointmentWhatsappInfo(
              appointment?.whatsappInfo || appointment?.whatsappNotes || appointment?.whatsapp || ''
            ),
            durationSeconds: resolveCallDurationSeconds(appointment),
            recordingUrl: resolvePreferredRecordingUrl(appointment),
            createdAt:
              normalizeString(
                appointment?.updatedAt ||
                  appointment?.confirmationResponseReceivedAt ||
                  appointment?.confirmationEmailSentAt ||
                  appointment?.createdAt ||
                  ''
              ) || new Date().toISOString(),
            callId,
          };

        if (isInterestedLeadDismissedForRow(callId, row)) return;

        const rowKey = buildLeadFollowUpCandidateKey(row);
        if (callId && seenCallIds.has(callId)) return;
        if (rowKey && seenKeys.has(rowKey)) return;

        if (callId) seenCallIds.add(callId);
        if (rowKey) seenKeys.add(rowKey);
        rows.push(row);
      });

    return rows;
  }

  function buildAllInterestedLeadRows() {
    const existingMaterializedRows = getMaterializedInterestedLeadRows();
    const interestedLeadTasks = buildInterestedLeadCandidateRows(existingMaterializedRows);
    const groupedLeadRows = buildGroupedColdcallingLeadRows(existingMaterializedRows.concat(interestedLeadTasks));
    return dedupeInterestedLeadRows(existingMaterializedRows.concat(interestedLeadTasks, groupedLeadRows));
  }

  function findInterestedLeadRowByCallId(callId) {
    const normalizedCallId = normalizeString(callId);
    if (!normalizedCallId) return null;
    return buildAllInterestedLeadRows().find((item) => normalizeString(item?.callId || '') === normalizedCallId) || null;
  }

  return {
    buildAllInterestedLeadRows,
    buildGroupedColdcallingLeadRows,
    buildInterestedLeadCandidateRows,
    buildLatestInterestedLeadRowsByKey,
    buildLeadFollowUpCandidateKey,
    dedupeInterestedLeadRows,
    findInterestedLeadRowByCallId,
    getLeadLikeRecencyTimestamp,
    getMaterializedInterestedLeadRows,
    getOpenInterestedLeadTasks,
    normalizeLeadLikePhoneKey,
  };
}

module.exports = {
  createAgendaInterestedLeadReadService,
};
