function defaultNormalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function defaultTruncateText(value, maxLength = 500, normalizeString = defaultNormalizeString) {
  const text = normalizeString(value);
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function createAiCallInsightRuntime(deps = {}) {
  const {
    normalizeString = defaultNormalizeString,
    truncateText = (value, maxLength) => defaultTruncateText(value, maxLength, normalizeString),
    normalizeDateYyyyMmDd = (value) => normalizeString(value),
    normalizeTimeHhMm = (value) => normalizeString(value),
    normalizeColdcallingStack = (value) => normalizeString(value).toLowerCase(),
    normalizeEmailAddress = (value) => normalizeString(value).toLowerCase(),
    parseNumberSafe = (value, fallback = null) => {
      if (value === '' || value === null || value === undefined) return fallback;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    toBooleanSafe = (value, fallback = false) =>
      value === undefined || value === null ? fallback : Boolean(value),
    formatEuroLabel = () => '',
    getColdcallingStackLabel = (value) => normalizeString(value),
    resolvePreferredRecordingUrl = () => '',
    getOpenAiApiKey = () => '',
    fetchJsonWithTimeout = async () => {
      throw new Error('fetchJsonWithTimeout ontbreekt');
    },
    extractOpenAiTextContent = () => '',
    parseJsonLoose = () => null,
    openAiApiBaseUrl = 'https://api.openai.com/v1',
    openAiModel = 'gpt-4o-mini',
    buildLeadOwnerFields = () => ({}),
    queueRuntimeStatePersist = () => {},
    upsertRecentCallUpdate = () => null,
    upsertGeneratedAgendaAppointment = () => null,
    backfillOpenLeadFollowUpAppointmentsFromLatestCalls = () => 0,
    repairAgendaAppointmentsFromDashboardActivities = () => 0,
    recentCallUpdates = [],
    callUpdatesById = new Map(),
    recentAiCallInsights = [],
    aiCallInsightsByCallId = new Map(),
    aiAnalysisFingerprintByCallId = new Map(),
    aiAnalysisInFlightCallIds = new Set(),
    agendaAppointmentIdByCallId = new Map(),
    logger = console,
  } = deps;

  function logInfo(...args) {
    if (logger && typeof logger.log === 'function') {
      logger.log(...args);
    }
  }

  function logError(...args) {
    if (logger && typeof logger.error === 'function') {
      logger.error(...args);
    }
  }

  const shouldAnalyzeCallUpdateWithAi = (callUpdate) => {
    if (!callUpdate || !getOpenAiApiKey()) return false;

    const summary = normalizeString(callUpdate.summary);
    const transcriptSnippet = normalizeString(callUpdate.transcriptSnippet);
    if (!summary && transcriptSnippet.length < 20) return false;

    const statusText = `${normalizeString(callUpdate.status).toLowerCase()} ${normalizeString(
      callUpdate.messageType
    ).toLowerCase()} ${normalizeString(callUpdate.endedReason).toLowerCase()}`;
    return /(end|ended|complete|completed|hang|finish|final|analysis|summary)/i.test(statusText);
  };

  const getCallUpdateAiFingerprint = (callUpdate) => {
    return [
      normalizeString(callUpdate?.status),
      normalizeString(callUpdate?.endedReason),
      normalizeString(callUpdate?.summary),
      normalizeString(callUpdate?.transcriptSnippet),
      truncateText(normalizeString(callUpdate?.transcriptFull), 1200),
    ].join('|');
  };

  const addDaysToIsoDate = (dateValue, days) => {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return '';
    const next = new Date(date.getTime() + Number(days || 0) * 24 * 60 * 60 * 1000);
    const y = next.getFullYear();
    const m = String(next.getMonth() + 1).padStart(2, '0');
    const d = String(next.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const extractLikelyAppointmentDateFromText = (text, baseIso) => {
    const raw = normalizeString(text);
    if (!raw) return '';

    const isoMatch = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    if (isoMatch) {
      return normalizeDateYyyyMmDd(isoMatch[1]);
    }

    const dmyMatch = raw.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
    if (dmyMatch) {
      const now = new Date(baseIso || Date.now());
      const yearRaw = normalizeString(dmyMatch[3]);
      const year =
        yearRaw.length === 4
          ? Number(yearRaw)
          : yearRaw.length === 2
            ? 2000 + Number(yearRaw)
            : now.getFullYear();
      const month = Math.max(1, Math.min(12, Number(dmyMatch[2])));
      const day = Math.max(1, Math.min(31, Number(dmyMatch[1])));
      return normalizeDateYyyyMmDd(
        `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      );
    }

    const lower = raw.toLowerCase();
    const baseDate = normalizeDateYyyyMmDd(baseIso) || normalizeDateYyyyMmDd(new Date().toISOString());
    if (!baseDate) return '';
    if (/\bovermorgen\b/.test(lower)) return addDaysToIsoDate(baseDate, 2);
    if (/\bmorgen\b/.test(lower)) return addDaysToIsoDate(baseDate, 1);
    if (/\bvandaag\b/.test(lower)) return addDaysToIsoDate(baseDate, 0);
    return '';
  };

  function extractLikelyAppointmentTimeFromText(text) {
    const raw = normalizeString(text);
    if (!raw) return '';

    const hhmm = raw.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (hhmm) {
      return normalizeTimeHhMm(`${hhmm[1]}:${hhmm[2]}`);
    }

    const lower = raw.toLowerCase();
    const uurMatch = lower.match(/\b(?:om\s+)?(\d{1,2})\s*uur(?:\s+([a-z]+(?:\s+[a-z]+)?))?\b/);
    if (!uurMatch) return '';

    let hour = Math.max(0, Math.min(23, Number(uurMatch[1])));
    const suffix = normalizeString(uurMatch[2] || '').toLowerCase();

    if (/(middag|des middags|vanmiddag|avond)/.test(suffix) && hour >= 1 && hour <= 11) {
      hour += 12;
    }
    if (/(ochtend|smorgens|morgens)/.test(suffix) && hour === 12) {
      hour = 0;
    }

    return normalizeTimeHhMm(`${String(hour).padStart(2, '0')}:00`);
  }

  function isOutboundOrUnknownCall(callUpdate) {
    const direction = normalizeString(callUpdate?.direction || '').toLowerCase();
    if (direction.includes('inbound')) return false;

    const messageType = normalizeString(callUpdate?.messageType || '').toLowerCase();
    if (/twilio\.inbound\./.test(messageType)) return false;

    return true;
  }

  function buildCallInterestSignalText(callUpdate, insight = null) {
    return normalizeString(
      [
        callUpdate?.summary,
        callUpdate?.transcriptSnippet,
        callUpdate?.transcriptFull,
        callUpdate?.status,
        callUpdate?.endedReason,
        insight?.summary,
        insight?.followUpReason,
      ]
        .filter(Boolean)
        .join(' ')
    ).toLowerCase();
  }

  function hasNegativeInterestSignal(text) {
    const source = normalizeString(text).toLowerCase();
    if (!source) return false;
    return /(geen interesse|niet geinteresseerd|niet geïnteresseerd|niet meer bellen|bel( me)? niet|stop( met)? bellen|do not call|dnc|remove from list|uit bellijst)/.test(
      source
    );
  }

  function hasPositiveInterestSignal(text) {
    const source = normalizeString(text).toLowerCase();
    if (!source) return false;
    return /(wel interesse|geinteresseerd|geïnteresseerd|interesse|afspraak|demo|offerte|stuur (de )?(mail|info)|mail .* (offerte|informatie)|terugbellen|callback|terugbel)/.test(
      source
    );
  }

  function resolveLeadFollowUpDateAndTime(callUpdate) {
    const candidates = [callUpdate?.endedAt, callUpdate?.updatedAt, callUpdate?.startedAt];
    let reference = null;
    for (const value of candidates) {
      const iso = normalizeString(value || '');
      const ts = Date.parse(iso);
      if (Number.isFinite(ts)) {
        reference = new Date(ts);
        break;
      }
    }
    if (!reference) reference = new Date();

    let date = '';
    let time = '';
    try {
      date = normalizeDateYyyyMmDd(
        new Intl.DateTimeFormat('sv-SE', {
          timeZone: 'Europe/Amsterdam',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(reference)
      );
      time = normalizeTimeHhMm(
        new Intl.DateTimeFormat('nl-NL', {
          timeZone: 'Europe/Amsterdam',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(reference)
      );
    } catch {
      date = normalizeDateYyyyMmDd(reference.toISOString());
      time = normalizeTimeHhMm(reference.toISOString().slice(11, 16));
    }

    return {
      date: date || normalizeDateYyyyMmDd(new Date().toISOString()) || '',
      time: time || '09:00',
    };
  }

  function isWeakAppointmentLocationText(value) {
    const text = normalizeString(value || '').trim();
    if (!text) return true;
    const lower = text.toLowerCase();
    if (/^(onbekend|nog niet ingevuld|nvt|n\/a|null|undefined|-)$/.test(lower)) return true;
    if (/^\d+(?:[.,]\d+)?\s*(km|kilometer|kilometers|m|meter|meters)\b/.test(lower)) return true;
    return false;
  }

  function sanitizeResolvedLocationText(value) {
    const sanitized = truncateText(normalizeString(value || ''), 220);
    if (!sanitized) return '';
    if (isWeakAppointmentLocationText(sanitized)) return '';
    return sanitized;
  }

  function composeResolvedAppointmentLocation(addressValue, regionValue) {
    const address = sanitizeResolvedLocationText(addressValue || '');
    const region = sanitizeResolvedLocationText(regionValue || '');
    if (address && region) {
      const addressKey = normalizeString(address).toLowerCase();
      const regionKey = normalizeString(region).toLowerCase();
      if (addressKey.includes(regionKey)) return address;
      return truncateText(`${address}, ${region}`, 220);
    }
    return address || region;
  }

  function resolveAppointmentLocation(...sources) {
    for (const source of sources) {
      if (!source || typeof source !== 'object') continue;

      const explicit = sanitizeResolvedLocationText(
        source.location || source.appointmentLocation || source.locatie || ''
      );
      if (explicit) return explicit;

      const combined = composeResolvedAppointmentLocation(
        source.address || source.adres || source.street || source.straat || '',
        source.region ||
          source.regio ||
          source.city ||
          source.plaats ||
          source.stad ||
          source.province ||
          source.provincie ||
          source.state ||
          ''
      );
      if (combined) return combined;
    }

    return '';
  }

  function extractAddressLikeLocationFromText(value) {
    const text = normalizeString(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const streetMatch =
      text.match(
        /\b([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\-]*(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\-]*)*(?:straat|laan|weg|dreef|plein|markt|kade|gracht|singel|steeg|boulevard|pad|hof|baan|wal|plantsoen|poort)\s+\d{1,4}[a-zA-Z]?(?:\s*,\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\-\s]{1,60})?)/i
      ) ||
      text.match(
        /\b([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\-]*(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\-]*)*\s(?:straat|laan|weg|dreef|plein|markt|kade|gracht|singel|steeg|boulevard|pad|hof|baan|wal|plantsoen|poort)\s+\d{1,4}[a-zA-Z]?(?:\s*,\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\-\s]{1,60})?)/i
      );
    if (!streetMatch) return '';
    return truncateText(normalizeString(streetMatch[1] || ''), 220);
  }

  function shouldCreateLeadFollowUpFromCall(callUpdate, insight = null) {
    if (!callUpdate || !normalizeString(callUpdate.callId || '')) return false;
    if (!isOutboundOrUnknownCall(callUpdate)) return false;

    const status = normalizeString(callUpdate.status || '').toLowerCase();
    const endedReason = normalizeString(callUpdate.endedReason || '');
    const statusText = `${status} ${endedReason}`.trim();
    const hasConversationContent = Boolean(
      normalizeString(callUpdate.summary || '') ||
        normalizeString(callUpdate.transcriptSnippet || '') ||
        normalizeString(callUpdate.transcriptFull || '')
    );
    const hasKnownDuration =
      Number.isFinite(Number(callUpdate.durationSeconds)) && Number(callUpdate.durationSeconds) >= 15;

    if (
      /(not[_ -]?connected|no[_ -]?answer|unanswered|failed|dial[_ -]?failed|busy|voicemail|initiated|queued|ringing|cancelled|canceled|rejected|error)/.test(
        statusText
      )
    ) {
      return false;
    }
    if (!hasConversationContent && !hasKnownDuration) return false;

    const signalText = buildCallInterestSignalText(callUpdate, insight);
    if (!signalText) return false;
    if (hasNegativeInterestSignal(signalText)) return false;

    if (toBooleanSafe(insight?.appointmentBooked, false)) return true;
    if (toBooleanSafe(insight?.followUpRequired, false)) return true;
    return hasPositiveInterestSignal(signalText);
  }

  function buildGeneratedLeadFollowUpFromCall(callUpdate, insight = null) {
    if (!shouldCreateLeadFollowUpFromCall(callUpdate, insight)) return null;
    const callId = normalizeString(callUpdate?.callId || '');
    if (!callId) return null;
    const leadOwner = buildLeadOwnerFields(callId);

    const company =
      normalizeString(callUpdate?.company || insight?.company || insight?.leadCompany || '') ||
      'Onbekende lead';
    const contact =
      normalizeString(callUpdate?.name || insight?.contactName || insight?.leadName || '') ||
      'Onbekend';
    const phone = normalizeString(callUpdate?.phone || insight?.phone || '');
    const { date, time } = resolveLeadFollowUpDateAndTime(callUpdate);
    const summary = truncateText(
      normalizeString(
        insight?.summary ||
          callUpdate?.summary ||
          callUpdate?.transcriptSnippet ||
          'Lead toonde interesse tijdens het gesprek.'
      ),
      900
    );
    const normalizedStack = normalizeColdcallingStack(callUpdate?.stack || insight?.coldcallingStack || '');
    const stackLabel = getColdcallingStackLabel(normalizedStack);
    const createdAt =
      normalizeString(callUpdate?.endedAt || callUpdate?.updatedAt || callUpdate?.startedAt || '') ||
      new Date().toISOString();

    return {
      company,
      contact,
      phone,
      contactEmail: normalizeEmailAddress(
        insight?.contactEmail || insight?.email || insight?.leadEmail || ''
      ),
      type: 'lead_follow_up',
      date,
      time,
      value: formatEuroLabel(insight?.estimatedValueEur || insight?.estimated_value_eur),
      branche: normalizeString(insight?.branche || insight?.sector || callUpdate?.branche || '') || 'Onbekend',
      source: 'AI Cold Calling (Lead opvolging)',
      summary: summary || 'Lead toonde interesse tijdens het gesprek.',
      aiGenerated: true,
      callId,
      createdAt,
      needsConfirmationEmail: true,
      confirmationTaskType: 'lead_follow_up',
      provider: normalizeString(callUpdate?.provider || ''),
      coldcallingStack: normalizedStack || '',
      coldcallingStackLabel: stackLabel || '',
      location: resolveAppointmentLocation(callUpdate, insight),
      durationSeconds: resolveCallDurationSeconds(callUpdate, insight),
      recordingUrl: resolvePreferredRecordingUrl(callUpdate, insight),
      ...leadOwner,
    };
  }

  function createRuleBasedInsightFromCallUpdate(callUpdate) {
    if (!callUpdate?.callId) return null;

    const summary = normalizeString(callUpdate.summary || '');
    const transcriptFull = normalizeString(callUpdate.transcriptFull || '');
    const transcriptSnippet = normalizeString(callUpdate.transcriptSnippet || '');
    const sourceText = [summary, transcriptFull, transcriptSnippet].filter(Boolean).join('\n');
    if (!sourceText) return null;

    const lower = sourceText.toLowerCase();
    const hasAppointmentLanguage =
      /(afspraak|intake|kennismaking|langs\s+kom)/.test(lower) &&
      /(ingepland|gepland|bevestigd|morgen|overmorgen|\bom\b\s*\d{1,2}(:\d{2})?\s*uur|\b\d{1,2}:\d{2}\b)/.test(
        lower
      );

    const callSummaryStrong =
      /er is een afspraak ingepland|afspraak ingepland|afspraak gepland|intake ingepland/.test(
        lower
      );

    const appointmentBooked = hasAppointmentLanguage || callSummaryStrong;
    const appointmentDate = extractLikelyAppointmentDateFromText(sourceText, callUpdate.updatedAt);
    const appointmentTime = extractLikelyAppointmentTimeFromText(sourceText);

    const ruleSummary =
      summary ||
      truncateText(
        transcriptSnippet || transcriptFull || 'Call verwerkt op basis van transcriptie.',
        900
      );

    return {
      callId: normalizeString(callUpdate.callId),
      company: normalizeString(callUpdate.company || ''),
      contactName: normalizeString(callUpdate.name || ''),
      phone: normalizeString(callUpdate.phone || ''),
      branche: normalizeString(callUpdate.branche || ''),
      region: normalizeString(callUpdate.region || ''),
      province: normalizeString(callUpdate.province || ''),
      address: normalizeString(callUpdate.address || ''),
      location: resolveAppointmentLocation(callUpdate),
      summary: ruleSummary,
      appointmentBooked: Boolean(appointmentBooked && appointmentDate),
      appointmentDate: appointmentBooked ? appointmentDate : '',
      appointmentTime: appointmentBooked ? appointmentTime : '',
      estimatedValueEur: null,
      followUpRequired: Boolean(appointmentBooked),
      followUpReason: appointmentBooked
        ? 'Bevestigingsmail sturen op basis van gedetecteerde afspraak in gesprekstranscriptie.'
        : '',
      source: 'rule',
      model: 'rule',
      analyzedAt: new Date().toISOString(),
    };
  }

  function ensureRuleBasedInsightAndAppointment(callUpdate) {
    if (!callUpdate || !callUpdate.callId) return null;

    const existingInsight = aiCallInsightsByCallId.get(callUpdate.callId) || null;
    const ruleInsight = createRuleBasedInsightFromCallUpdate(callUpdate);

    let nextInsight = existingInsight;

    if (!existingInsight && ruleInsight) {
      nextInsight = upsertAiCallInsight(ruleInsight);
    } else if (existingInsight && ruleInsight) {
      let changed = false;
      const merged = { ...existingInsight };

      if (!normalizeString(merged.summary) && normalizeString(ruleInsight.summary)) {
        merged.summary = ruleInsight.summary;
        changed = true;
      }

      if (
        !toBooleanSafe(merged.appointmentBooked, false) &&
        toBooleanSafe(ruleInsight.appointmentBooked, false)
      ) {
        merged.appointmentBooked = true;
        if (!normalizeDateYyyyMmDd(merged.appointmentDate)) merged.appointmentDate = ruleInsight.appointmentDate;
        if (!normalizeTimeHhMm(merged.appointmentTime)) merged.appointmentTime = ruleInsight.appointmentTime;
        if (!normalizeString(merged.followUpReason)) merged.followUpReason = ruleInsight.followUpReason;
        if (!toBooleanSafe(merged.followUpRequired, false)) merged.followUpRequired = true;
        if (!normalizeString(merged.model)) merged.model = 'rule';
        if (!normalizeString(merged.source)) merged.source = 'rule';
        changed = true;
      }

      if (changed) {
        merged.analyzedAt = new Date().toISOString();
        nextInsight = upsertAiCallInsight(merged);
      }
    }

    if (nextInsight && toBooleanSafe(nextInsight.appointmentBooked, false)) {
      const agendaAppointment = buildGeneratedAgendaAppointmentFromAiInsight({
        ...nextInsight,
        callId: callUpdate.callId,
        leadCompany: callUpdate.company,
        leadName: callUpdate.name,
        leadBranche: callUpdate.branche,
        provider: callUpdate.provider,
        coldcallingStack: callUpdate.stack,
        coldcallingStackLabel: callUpdate.stackLabel,
      });

      if (agendaAppointment) {
        const savedAppointment = upsertGeneratedAgendaAppointment(agendaAppointment, callUpdate.callId);
        if (savedAppointment && nextInsight) {
          nextInsight = upsertAiCallInsight({
            ...nextInsight,
            agendaAppointmentId: savedAppointment.id,
          });
        }
      }
    }

    const existingAppointmentId = agendaAppointmentIdByCallId.get(callUpdate.callId);
    if (!existingAppointmentId) {
      const followUpLeadAppointment = buildGeneratedLeadFollowUpFromCall(callUpdate, nextInsight);
      if (followUpLeadAppointment) {
        const savedLeadAppointment = upsertGeneratedAgendaAppointment(
          followUpLeadAppointment,
          callUpdate.callId
        );
        if (savedLeadAppointment && nextInsight) {
          nextInsight = upsertAiCallInsight({
            ...nextInsight,
            agendaAppointmentId: savedLeadAppointment.id,
          });
        }
      }
    }

    return nextInsight;
  }

  function backfillInsightsAndAppointmentsFromRecentCallUpdates() {
    let touched = 0;
    for (const callUpdate of recentCallUpdates) {
      const callId = normalizeString(callUpdate?.callId || '');
      if (!callId || callId.startsWith('demo-')) continue;

      const beforeInsight = aiCallInsightsByCallId.get(callId) || null;
      const beforeApptId = agendaAppointmentIdByCallId.get(callId) || null;
      const afterInsight = ensureRuleBasedInsightAndAppointment(callUpdate);
      const afterApptId = agendaAppointmentIdByCallId.get(callId) || null;

      if (
        (afterInsight && !beforeInsight) ||
        (afterInsight &&
          beforeInsight &&
          JSON.stringify(afterInsight) !== JSON.stringify(beforeInsight)) ||
        (!beforeApptId && afterApptId)
      ) {
        touched += 1;
      }
    }
    touched += Number(backfillOpenLeadFollowUpAppointmentsFromLatestCalls() || 0);
    touched += Number(repairAgendaAppointmentsFromDashboardActivities() || 0);
    return touched;
  }

  function isGeneratedAppointmentConfirmedForAgenda(appointment) {
    if (!appointment || typeof appointment !== 'object') return false;
    if (appointment.confirmationAppointmentCancelled || appointment.confirmationAppointmentCancelledAt) {
      return false;
    }
    if (!toBooleanSafe(appointment.aiGenerated, false)) return true;
    return Boolean(appointment.confirmationResponseReceived || appointment.confirmationResponseReceivedAt);
  }

  function resolveCallDurationSeconds(...sources) {
    for (const source of sources) {
      const parsed = parseNumberSafe(
        source?.durationSeconds ??
          source?.duration_seconds ??
          source?.callDurationSeconds ??
          source?.duration ??
          null,
        null
      );
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.max(1, Math.round(parsed));
      }
    }
    return null;
  }

  function getLatestCallUpdateByCallId(callId) {
    const normalizedCallId = normalizeString(callId);
    if (!normalizedCallId) return null;
    return callUpdatesById.get(normalizedCallId) || null;
  }

  function buildGeneratedAgendaAppointmentFromAiInsight(insight) {
    if (!insight || !toBooleanSafe(insight.appointmentBooked, false)) return null;

    const date = normalizeDateYyyyMmDd(insight.appointmentDate);
    if (!date) return null;

    const time = normalizeTimeHhMm(insight.appointmentTime) || '09:00';
    const timeWasGuessed = !normalizeTimeHhMm(insight.appointmentTime);
    const company = normalizeString(insight.company || insight.leadCompany || '') || 'Onbekende lead';
    const contact = normalizeString(insight.contactName || insight.leadName || '') || 'Onbekend';
    const phone = normalizeString(insight.phone || '');
    const branche =
      normalizeString(insight.branche || insight.sector || insight.leadBranche || '') || 'Onbekend';
    const provider = normalizeString(insight.provider || '');
    const coldcallingStack = normalizeColdcallingStack(insight.coldcallingStack || insight.stack || '');
    const coldcallingStackLabel = normalizeString(
      insight.coldcallingStackLabel || insight.stackLabel || getColdcallingStackLabel(coldcallingStack)
    );
    const summaryCore = truncateText(
      normalizeString(insight.summary || insight.shortSummary || insight.short_summary || ''),
      900
    );
    const summary = timeWasGuessed
      ? `${summaryCore}${summaryCore ? ' ' : ''}(Tijd niet expliciet genoemd; standaard op 09:00 gezet.)`
      : summaryCore;
    const callId = normalizeString(insight.callId);

    return {
      company,
      contact,
      phone,
      contactEmail: normalizeEmailAddress(insight.contactEmail || insight.email || insight.leadEmail || ''),
      type: 'meeting',
      date,
      time,
      value: formatEuroLabel(insight.estimatedValueEur || insight.estimated_value_eur),
      branche,
      source: 'AI Cold Calling (Retell + AI)',
      summary: summary || 'AI-samenvatting aangemaakt op basis van call update.',
      aiGenerated: true,
      callId,
      createdAt: new Date().toISOString(),
      confirmationTaskType: 'send_confirmation_email',
      provider: provider || '',
      coldcallingStack: coldcallingStack || '',
      coldcallingStackLabel: coldcallingStackLabel || '',
      location: resolveAppointmentLocation(insight),
      recordingUrl: resolvePreferredRecordingUrl(getLatestCallUpdateByCallId(callId), insight),
      ...buildLeadOwnerFields(callId),
    };
  }

  async function createAiInsightFromCallUpdate(callUpdate) {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) return null;

    const nowIso = new Date().toISOString();
    const systemPrompt = [
      'Je bent een sales-operations assistent voor een Nederlands coldcalling team.',
      'Analyseer een call-update en geef EEN geldig JSON-object terug (geen markdown).',
      'Doelen:',
      '1) Maak een korte Nederlandse samenvatting van max 3 zinnen.',
      '2) Bepaal of er een afspraak is ingepland.',
      '3) Extraheer afspraakdatum en tijd alleen als deze expliciet of zeer duidelijk genoemd zijn.',
      '4) Gebruik null als datum/tijd onbekend zijn.',
      '5) Raad geen bedragen of branche als dit niet uit de tekst blijkt; gebruik null of lege string.',
      'JSON keys exact:',
      'summary, appointmentBooked, appointmentDate, appointmentTime, contactName, company, phone, branche, estimatedValueEur, followUpRequired, followUpReason',
      'Datumformaat: YYYY-MM-DD. Tijdsformaat: HH:MM (24u).',
      'Taal output: Nederlands.',
    ].join('\n');

    const userPayload = {
      nowIso,
      timezone: 'Europe/Amsterdam',
      callUpdate: {
        callId: callUpdate.callId,
        status: callUpdate.status,
        messageType: callUpdate.messageType,
        endedReason: callUpdate.endedReason,
        company: callUpdate.company,
        branche: callUpdate.branche,
        name: callUpdate.name,
        phone: callUpdate.phone,
        callSummary: callUpdate.summary,
        transcriptSnippet: callUpdate.transcriptSnippet,
        transcriptFull: truncateText(normalizeString(callUpdate.transcriptFull || ''), 5000),
        updatedAt: callUpdate.updatedAt,
      },
    };

    const { response, data } = await fetchJsonWithTimeout(
      `${openAiApiBaseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: openAiModel,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(userPayload) },
          ],
        }),
      },
      25000
    );

    if (!response.ok) {
      const err = new Error(`OpenAI analyse mislukt (${response.status})`);
      err.status = response.status;
      err.data = data;
      throw err;
    }

    const content = data?.choices?.[0]?.message?.content;
    const text = extractOpenAiTextContent(content);
    const parsed = parseJsonLoose(text);

    if (!parsed || typeof parsed !== 'object') {
      const err = new Error('OpenAI gaf geen geldig JSON-object terug.');
      err.data = { rawContent: text };
      throw err;
    }

    return {
      callId: normalizeString(callUpdate.callId),
      company: normalizeString(parsed.company || callUpdate.company),
      contactName: normalizeString(parsed.contactName || parsed.contact_name || callUpdate.name),
      phone: normalizeString(parsed.phone || callUpdate.phone),
      branche: normalizeString(parsed.branche || parsed.branch || callUpdate.branche || ''),
      summary: truncateText(
        normalizeString(
          parsed.summary || parsed.shortSummary || parsed.short_summary || callUpdate.summary
        ),
        900
      ),
      appointmentBooked: toBooleanSafe(parsed.appointmentBooked ?? parsed.appointment_booked, false),
      appointmentDate: normalizeDateYyyyMmDd(parsed.appointmentDate || parsed.appointment_date),
      appointmentTime: normalizeTimeHhMm(parsed.appointmentTime || parsed.appointment_time),
      estimatedValueEur: parseNumberSafe(parsed.estimatedValueEur ?? parsed.estimated_value_eur, null),
      followUpRequired: toBooleanSafe(parsed.followUpRequired ?? parsed.follow_up_required, false),
      followUpReason: truncateText(
        normalizeString(parsed.followUpReason || parsed.follow_up_reason),
        300
      ),
      source: 'openai',
      model: openAiModel,
      analyzedAt: new Date().toISOString(),
    };
  }

  function upsertAiCallInsight(insight) {
    if (!insight || !insight.callId) return null;

    const existing = aiCallInsightsByCallId.get(insight.callId);
    const merged = existing ? { ...existing, ...insight, callId: existing.callId } : insight;
    aiCallInsightsByCallId.set(merged.callId, merged);

    const idx = recentAiCallInsights.findIndex((item) => item.callId === merged.callId);
    if (idx >= 0) {
      recentAiCallInsights.splice(idx, 1);
    }
    recentAiCallInsights.unshift(merged);
    if (recentAiCallInsights.length > 500) {
      recentAiCallInsights.pop();
    }

    queueRuntimeStatePersist('ai_call_insight');
    return merged;
  }

  async function maybeAnalyzeCallUpdateWithAi(callUpdate) {
    if (!shouldAnalyzeCallUpdateWithAi(callUpdate)) return null;
    if (!callUpdate?.callId) return null;

    const fingerprint = getCallUpdateAiFingerprint(callUpdate);
    if (aiAnalysisFingerprintByCallId.get(callUpdate.callId) === fingerprint) {
      return aiCallInsightsByCallId.get(callUpdate.callId) || null;
    }
    if (aiAnalysisInFlightCallIds.has(callUpdate.callId)) {
      return null;
    }

    aiAnalysisInFlightCallIds.add(callUpdate.callId);
    try {
      let insight = null;
      let aiError = null;
      try {
        insight = await createAiInsightFromCallUpdate(callUpdate);
      } catch (error) {
        aiError = error;
        logError(
          '[AI Call Insight Create Error]',
          JSON.stringify(
            {
              callId: callUpdate.callId,
              message: error?.message || 'Onbekende fout',
              status: error?.status || null,
              data: error?.data || null,
            },
            null,
            2
          )
        );
      }

      const ruleInsight = createRuleBasedInsightFromCallUpdate(callUpdate);
      if (!insight && ruleInsight) {
        insight = ruleInsight;
        logInfo(
          '[AI Call Insight Fallback]',
          JSON.stringify(
            {
              callId: callUpdate.callId,
              source: 'rule',
              appointmentBooked: ruleInsight.appointmentBooked,
              appointmentDate: ruleInsight.appointmentDate || null,
              appointmentTime: ruleInsight.appointmentTime || null,
            },
            null,
            2
          )
        );
      } else if (insight && ruleInsight) {
        if (!insight.summary && ruleInsight.summary) {
          insight.summary = ruleInsight.summary;
        }
        if (
          !toBooleanSafe(insight.appointmentBooked, false) &&
          toBooleanSafe(ruleInsight.appointmentBooked, false)
        ) {
          insight.appointmentBooked = true;
          if (!normalizeDateYyyyMmDd(insight.appointmentDate)) insight.appointmentDate = ruleInsight.appointmentDate;
          if (!normalizeTimeHhMm(insight.appointmentTime)) insight.appointmentTime = ruleInsight.appointmentTime;
          if (!normalizeString(insight.followUpReason)) insight.followUpReason = ruleInsight.followUpReason;
          if (!toBooleanSafe(insight.followUpRequired, false)) insight.followUpRequired = true;
        }
      }

      if (!insight) {
        if (aiError) throw aiError;
        return null;
      }

      const savedInsight = upsertAiCallInsight(insight);
      aiAnalysisFingerprintByCallId.set(callUpdate.callId, fingerprint);

      if (!normalizeString(callUpdate.summary) && normalizeString(savedInsight?.summary)) {
        upsertRecentCallUpdate({
          callId: callUpdate.callId,
          summary: savedInsight.summary,
          updatedAt: new Date().toISOString(),
          updatedAtMs: Date.now(),
        });
      }

      const agendaAppointment = buildGeneratedAgendaAppointmentFromAiInsight({
        ...savedInsight,
        callId: callUpdate.callId,
        leadCompany: callUpdate.company,
        leadName: callUpdate.name,
        leadBranche: callUpdate.branche,
        provider: callUpdate.provider,
        coldcallingStack: callUpdate.stack,
        coldcallingStackLabel: callUpdate.stackLabel,
      });
      if (agendaAppointment) {
        const savedAppointment = upsertGeneratedAgendaAppointment(agendaAppointment, callUpdate.callId);
        if (savedAppointment) {
          savedInsight.agendaAppointmentId = savedAppointment.id;
        }
      }

      logInfo(
        '[AI Call Insight]',
        JSON.stringify(
          {
            callId: callUpdate.callId,
            appointmentBooked: savedInsight.appointmentBooked,
            appointmentDate: savedInsight.appointmentDate || null,
            appointmentTime: savedInsight.appointmentTime || null,
            hasSummary: Boolean(savedInsight.summary),
            agendaAppointmentId: savedInsight.agendaAppointmentId || null,
          },
          null,
          2
        )
      );

      return savedInsight;
    } finally {
      aiAnalysisInFlightCallIds.delete(callUpdate.callId);
    }
  }

  return {
    backfillInsightsAndAppointmentsFromRecentCallUpdates,
    buildCallInterestSignalText,
    buildGeneratedAgendaAppointmentFromAiInsight,
    buildGeneratedLeadFollowUpFromCall,
    composeResolvedAppointmentLocation,
    createAiInsightFromCallUpdate,
    createRuleBasedInsightFromCallUpdate,
    ensureRuleBasedInsightAndAppointment,
    extractAddressLikeLocationFromText,
    extractLikelyAppointmentTimeFromText,
    getLatestCallUpdateByCallId,
    hasNegativeInterestSignal,
    hasPositiveInterestSignal,
    isGeneratedAppointmentConfirmedForAgenda,
    isOutboundOrUnknownCall,
    isWeakAppointmentLocationText,
    maybeAnalyzeCallUpdateWithAi,
    resolveAppointmentLocation,
    resolveCallDurationSeconds,
    resolveLeadFollowUpDateAndTime,
    sanitizeResolvedLocationText,
    shouldCreateLeadFollowUpFromCall,
    upsertAiCallInsight,
  };
}

module.exports = {
  createAiCallInsightRuntime,
};
