function createAgendaMetadataService(deps = {}) {
  const {
    normalizeString = (value) => String(value || '').trim(),
    normalizeDateYyyyMmDd = (value) => String(value || '').trim(),
    normalizeTimeHhMm = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    toBooleanSafe = (value, fallback = false) =>
      value === undefined || value === null ? fallback : Boolean(value),
    sanitizeAppointmentLocation = (value) => truncateText(normalizeString(value || ''), 220),
    sanitizeAppointmentWhatsappInfo = (value) => truncateText(normalizeString(value || ''), 6000),
    isWeakAppointmentLocationText = (value) => !normalizeString(value || ''),
    extractAddressLikeLocationFromText = () => '',
    summaryContainsEnglishMarkers = () => false,
    getOpenAiApiKey = () => '',
    generateTextSummaryWithAi = async () => ({ summary: '' }),
    getGeneratedAgendaAppointments = () => [],
    setGeneratedAgendaAppointmentAtIndex = () => null,
    queueRuntimeStatePersist = () => {},
    agendaAppointmentIdByCallId = new Map(),
    getLatestCallUpdateByCallId = () => null,
    aiCallInsightsByCallId = new Map(),
    resolveAppointmentLocation = () => '',
    resolvePreferredRecordingUrl = () => '',
    resolveCallDurationSeconds = () => null,
    refreshCallUpdateFromTwilioStatusApi = async () => null,
    refreshCallUpdateFromRetellStatusApi = async () => null,
  } = deps;

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normalizeSearchKey(value) {
    return normalizeString(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function textContainsNormalized(haystack, needle) {
    const hay = normalizeSearchKey(haystack);
    const ndl = normalizeSearchKey(needle);
    if (!hay || !ndl) return false;
    return hay.includes(ndl);
  }

  function syncSummaryLocationText(summaryText, locationText) {
    const summary = normalizeString(summaryText || '');
    const location = sanitizeAppointmentLocation(locationText || '');
    if (!summary || !location) return summary;

    let rewritten = summary;
    const extractedAddress = extractAddressLikeLocationFromText(summary);
    if (extractedAddress && !textContainsNormalized(location, extractedAddress)) {
      const escapedAddress = escapeRegExp(extractedAddress);
      rewritten = rewritten.replace(new RegExp(escapedAddress, 'gi'), location);
    }

    rewritten = rewritten.replace(/\bnog niet ingevuld\b/gi, location);
    rewritten = rewritten.replace(/\bonbekend\b/gi, location);
    rewritten = rewritten.replace(
      /\blocatie\s+(?:is|staat|op)\s+\d+(?:[.,]\d+)?\s*(?:km|kilometer|kilometers|m|meter|meters)\b/gi,
      `locatie is ${location}`
    );
    return rewritten.trim();
  }

  function summaryMentionsLocation(summaryText, locationText) {
    const summary = normalizeString(summaryText || '');
    const location = sanitizeAppointmentLocation(locationText || '');
    if (!summary || !location) return false;
    if (textContainsNormalized(summary, location)) return true;
    const extracted = extractAddressLikeLocationFromText(summary);
    return Boolean(extracted && textContainsNormalized(extracted, location));
  }

  function summaryMentionsWhatsapp(summaryText, whatsappInfo) {
    const summary = normalizeString(summaryText || '');
    const whatsapp = sanitizeAppointmentWhatsappInfo(whatsappInfo || '');
    if (!summary || !whatsapp) return false;
    if (textContainsNormalized(summary, whatsapp)) return true;
    return /whatsapp/i.test(summary);
  }

  function cleanPendingConfirmationPhrases(summaryText) {
    let text = normalizeString(summaryText || '');
    if (!text) return '';
    const patterns = [
      /\b(er\s+wordt\s+nog\s+een\s+bevestigings(?:bericht|mail)[^.?!]*[.?!])/gi,
      /\b(we\s+sturen\s+(?:nog\s+)?een\s+bevestigings(?:bericht|mail)[^.?!]*[.?!])/gi,
      /\b([A-Za-zÀ-ÿ'’\s-]{1,80}\s+reageert\s+op\s+dat\s+bericht[^.?!]*[.?!])/gi,
      /\b([A-Za-zÀ-ÿ'’\s-]{1,80}\s+zal\s+op\s+dit\s+bericht[^.?!]*[.?!])/gi,
      /\b([A-Za-zÀ-ÿ'’\s-]{1,80}\s+heeft\s+aangegeven\s+op\s+dit\s+bericht\s+te\s+zullen\s+reageren[^.?!]*[.?!])/gi,
      /\b(v(?:er)?volgactie:\s*[A-Za-zÀ-ÿ'’\s-]{1,80}\s+reageert\s+op\s+dat\s+bericht[^.?!]*[.?!])/gi,
    ];
    patterns.forEach((pattern) => {
      text = text.replace(pattern, ' ');
    });
    return text.replace(/\s{2,}/g, ' ').trim();
  }

  function compareAgendaAppointments(a, b) {
    const aKey = `${normalizeDateYyyyMmDd(a?.date)}T${normalizeTimeHhMm(a?.time) || '00:00'}`;
    const bKey = `${normalizeDateYyyyMmDd(b?.date)}T${normalizeTimeHhMm(b?.time) || '00:00'}`;
    if (aKey === bKey) return Number(a?.id || 0) - Number(b?.id || 0);
    return aKey.localeCompare(bKey);
  }

  function isGeneratedAppointmentVisibleForAgenda(appointment) {
    if (!appointment || typeof appointment !== 'object') return false;
    if (
      appointment.confirmationAppointmentCancelled ||
      appointment.confirmationAppointmentCancelledAt
    ) {
      return false;
    }
    return Boolean(normalizeDateYyyyMmDd(appointment?.date || ''));
  }

  function resolveAgendaLocationValue(locationInput, ...contextTexts) {
    const explicit = sanitizeAppointmentLocation(locationInput || '');
    if (explicit && !isWeakAppointmentLocationText(explicit)) {
      return explicit;
    }

    for (const context of contextTexts) {
      const extracted = extractAddressLikeLocationFromText(context);
      if (extracted) return sanitizeAppointmentLocation(extracted);
    }

    return explicit;
  }

  function buildLeadToAgendaSummaryFallback(baseSummary, location, whatsappInfo, options = {}) {
    const parts = [];
    const summaryText = truncateText(normalizeString(baseSummary || ''), 4000);
    const normalizedSummaryText = summaryContainsEnglishMarkers(summaryText) ? '' : summaryText;
    const locationText = sanitizeAppointmentLocation(location || '');
    const whatsappText = sanitizeAppointmentWhatsappInfo(whatsappInfo || '');
    const whatsappConfirmed = toBooleanSafe(options?.whatsappConfirmed, false);

    const summaryWithLocation = syncSummaryLocationText(normalizedSummaryText, locationText);
    const cleanedSummary = whatsappConfirmed
      ? cleanPendingConfirmationPhrases(summaryWithLocation || normalizedSummaryText)
      : summaryWithLocation || normalizedSummaryText;
    if (normalizedSummaryText) {
      parts.push(cleanedSummary || summaryWithLocation || normalizedSummaryText);
    } else {
      parts.push('De lead is telefonisch gesproken en ingepland voor verdere opvolging door Softora.');
    }
    if (
      locationText &&
      !summaryMentionsLocation(
        cleanedSummary || summaryWithLocation || normalizedSummaryText,
        locationText
      )
    ) {
      parts.push(`De afspraak staat ingepland op locatie ${locationText}.`);
    }
    if (whatsappConfirmed) {
      if (!/bevestigd via whatsapp/i.test(cleanedSummary || '')) {
        parts.push('De afspraak is bevestigd via WhatsApp.');
      }
      if (
        whatsappText &&
        !summaryMentionsWhatsapp(cleanedSummary || normalizedSummaryText, whatsappText)
      ) {
        parts.push(`Aanvullend via WhatsApp: ${whatsappText}.`);
      }
    } else if (
      whatsappText &&
      !summaryMentionsWhatsapp(cleanedSummary || normalizedSummaryText, whatsappText)
    ) {
      parts.push(`Aanvullend is via WhatsApp bevestigd: ${whatsappText}.`);
    }

    return truncateText(parts.join('\n\n'), 4000) || 'Lead handmatig ingepland vanuit Leads.';
  }

  function agendaSummaryNeedsRefresh(summary, whatsappInfo, summaryFormatVersion = 0) {
    const summaryText = normalizeString(summary || '');
    const whatsappText = sanitizeAppointmentWhatsappInfo(whatsappInfo || '');
    const version = Number(summaryFormatVersion || 0);

    if (!summaryText && !whatsappText) return false;
    if (summaryContainsEnglishMarkers(summaryText)) return true;
    if (/overige info uit whatsapp/i.test(summaryText)) return true;
    if (whatsappText && version < 4) return true;
    if (version < 4) return true;
    return false;
  }

  async function buildLeadToAgendaSummary(baseSummary, location, whatsappInfo, options = {}) {
    const summaryText = truncateText(normalizeString(baseSummary || ''), 4000);
    const locationText = sanitizeAppointmentLocation(location || '');
    const whatsappText = sanitizeAppointmentWhatsappInfo(whatsappInfo || '');
    const whatsappConfirmed = toBooleanSafe(options?.whatsappConfirmed, false);
    const fallback = buildLeadToAgendaSummaryFallback(summaryText, locationText, whatsappText, options);

    if (summaryText && !summaryContainsEnglishMarkers(summaryText)) return fallback;
    if (whatsappConfirmed) return fallback;

    if (!getOpenAiApiKey()) return fallback;
    if (!summaryText && !locationText && !whatsappText) return fallback;

    const sourceText = [
      summaryText ? `Bestaande leadsamenvatting:\n${summaryText}` : '',
      locationText ? `Afspraaklocatie:\n${locationText}` : '',
      whatsappText ? `Aanvullende bevestiging uit WhatsApp:\n${whatsappText}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    try {
      const result = await generateTextSummaryWithAi({
        text: sourceText,
        style: 'medium',
        language: 'nl',
        maxSentences: 4,
        extraInstructions: [
          'Schrijf uitsluitend in natuurlijk Nederlands.',
          'Maak een korte agendasamenvatting voor Softora in doorlopende tekst.',
          'Verwerk locatie en eventuele extra informatie uit WhatsApp natuurlijk in dezelfde samenvatting.',
          'Noem niet apart "Overige info uit WhatsApp".',
          'Gebruik geen koppen, bullets, labels of Engelstalige formuleringen.',
        ].join(' '),
      });
      return truncateText(normalizeString(result?.summary || ''), 4000) || fallback;
    } catch {
      return fallback;
    }
  }

  async function refreshGeneratedAgendaAppointmentSummaryAtIndex(
    idx,
    reason = 'agenda_summary_refresh'
  ) {
    const appointments = getGeneratedAgendaAppointments();
    if (!Number.isInteger(idx) || idx < 0 || idx >= appointments.length) return null;

    const appointment = appointments[idx];
    if (
      !appointment ||
      !agendaSummaryNeedsRefresh(
        appointment?.summary,
        appointment?.whatsappInfo,
        appointment?.summaryFormatVersion
      )
    ) {
      return appointment || null;
    }

    const nextSummary = await buildLeadToAgendaSummary(
      appointment?.summary,
      appointment?.location || appointment?.appointmentLocation || '',
      appointment?.whatsappInfo || appointment?.whatsappNotes || appointment?.whatsapp || '',
      { whatsappConfirmed: toBooleanSafe(appointment?.whatsappConfirmed, false) }
    );
    const currentSummary = normalizeString(appointment?.summary || '');
    const currentVersion = Number(appointment?.summaryFormatVersion || 0);
    if (nextSummary === currentSummary && currentVersion >= 4) {
      return appointment;
    }

    return setGeneratedAgendaAppointmentAtIndex(
      idx,
      {
        ...appointment,
        summary: nextSummary,
        summaryFormatVersion: 4,
      },
      reason
    );
  }

  async function refreshGeneratedAgendaSummariesIfNeeded(limit = 24) {
    const candidateIndexes = getGeneratedAgendaAppointments()
      .map((appointment, idx) => ({ appointment, idx }))
      .filter(({ appointment }) => isGeneratedAppointmentVisibleForAgenda(appointment))
      .filter(({ appointment }) =>
        agendaSummaryNeedsRefresh(
          appointment?.summary,
          appointment?.whatsappInfo,
          appointment?.summaryFormatVersion
        )
      )
      .sort((a, b) => {
        const aTs =
          Date.parse(
            normalizeString(
              a.appointment?.updatedAt ||
                a.appointment?.confirmationResponseReceivedAt ||
                a.appointment?.confirmationEmailSentAt ||
                a.appointment?.createdAt ||
                ''
            )
          ) || 0;
        const bTs =
          Date.parse(
            normalizeString(
              b.appointment?.updatedAt ||
                b.appointment?.confirmationResponseReceivedAt ||
                b.appointment?.confirmationEmailSentAt ||
                b.appointment?.createdAt ||
                ''
            )
          ) || 0;
        return bTs - aTs;
      })
      .slice(0, Math.max(1, limit));

    let refreshed = 0;
    for (const { idx } of candidateIndexes) {
      const updated = await refreshGeneratedAgendaAppointmentSummaryAtIndex(
        idx,
        'agenda_summary_autorefresh'
      );
      if (updated) refreshed += 1;
    }
    return refreshed;
  }

  function buildBackfilledGeneratedAgendaAppointment(appointment) {
    if (!appointment || typeof appointment !== 'object') return appointment;

    const callId = normalizeString(appointment.callId || '');
    if (!callId || callId.startsWith('demo-')) return appointment;

    const callUpdate = getLatestCallUpdateByCallId(callId);
    const insight = aiCallInsightsByCallId.get(callId) || null;
    const nextLocation = resolveAppointmentLocation(appointment, callUpdate, insight);
    const nextRecordingUrl = resolvePreferredRecordingUrl(appointment, callUpdate, insight);
    const nextDurationSeconds = resolveCallDurationSeconds(appointment, callUpdate, insight);
    const nextSummary = truncateText(
      normalizeString(
        appointment.summary ||
          insight?.summary ||
          callUpdate?.summary ||
          callUpdate?.transcriptSnippet ||
          ''
      ),
      4000
    );

    let changed = false;
    const nextAppointment = { ...appointment };

    if (
      nextLocation &&
      nextLocation !== normalizeString(appointment.location || appointment.appointmentLocation || '')
    ) {
      nextAppointment.location = nextLocation;
      changed = true;
    }

    if (nextRecordingUrl && nextRecordingUrl !== normalizeString(appointment.recordingUrl || '')) {
      nextAppointment.recordingUrl = nextRecordingUrl;
      changed = true;
    }

    if (
      Number.isFinite(nextDurationSeconds) &&
      nextDurationSeconds > 0 &&
      nextDurationSeconds !== Number(appointment.durationSeconds || 0)
    ) {
      nextAppointment.durationSeconds = nextDurationSeconds;
      changed = true;
    }

    if (nextSummary && nextSummary !== normalizeString(appointment.summary || '')) {
      nextAppointment.summary = nextSummary;
      changed = true;
    }

    if (!changed) return appointment;
    return nextAppointment;
  }

  function backfillGeneratedAgendaAppointmentsMetadataIfNeeded() {
    const appointments = getGeneratedAgendaAppointments();
    let touched = false;

    appointments.forEach((appointment, idx) => {
      const nextAppointment = buildBackfilledGeneratedAgendaAppointment(appointment);
      if (nextAppointment === appointment) return;

      appointments[idx] = nextAppointment;
      const id = Number(nextAppointment?.id || 0);
      const callId = normalizeString(nextAppointment?.callId || '');
      if (id > 0 && callId) {
        agendaAppointmentIdByCallId.set(callId, id);
      }
      touched = true;
    });

    if (touched) {
      queueRuntimeStatePersist('agenda_appointment_metadata_backfill');
    }

    return touched;
  }

  async function refreshAgendaAppointmentCallSourcesIfNeeded(limit = 8) {
    const candidates = getGeneratedAgendaAppointments()
      .map((appointment) => {
        const callId = normalizeString(appointment?.callId || '');
        const provider = normalizeString(appointment?.provider || '').toLowerCase();
        return {
          appointment,
          callId,
          provider,
          missingLocation: !resolveAppointmentLocation(appointment),
          missingRecording: !resolvePreferredRecordingUrl(appointment),
        };
      })
      .filter(({ appointment, callId, missingLocation, missingRecording }) => {
        if (!isGeneratedAppointmentVisibleForAgenda(appointment)) return false;
        if (!callId || callId.startsWith('demo-')) return false;
        return missingLocation || missingRecording;
      })
      .slice(0, Math.max(0, Math.min(20, Number(limit || 8) || 8)));

    if (!candidates.length) return 0;

    const unique = new Map();
    candidates.forEach((item) => {
      if (!unique.has(item.callId)) unique.set(item.callId, item);
    });

    await Promise.allSettled(
      Array.from(unique.values()).map(async ({ callId, provider }) => {
        if (provider === 'twilio' || /^CA[a-z0-9]+$/i.test(callId)) {
          return refreshCallUpdateFromTwilioStatusApi(callId, { direction: 'outbound' });
        }
        return refreshCallUpdateFromRetellStatusApi(callId);
      })
    );

    return unique.size;
  }

  return {
    agendaSummaryNeedsRefresh,
    backfillGeneratedAgendaAppointmentsMetadataIfNeeded,
    buildBackfilledGeneratedAgendaAppointment,
    buildLeadToAgendaSummary,
    buildLeadToAgendaSummaryFallback,
    compareAgendaAppointments,
    isGeneratedAppointmentVisibleForAgenda,
    refreshAgendaAppointmentCallSourcesIfNeeded,
    refreshGeneratedAgendaSummariesIfNeeded,
    resolveAgendaLocationValue,
  };
}

module.exports = {
  createAgendaMetadataService,
};
