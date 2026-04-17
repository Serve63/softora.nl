const crypto = require('crypto');

const {
  createAgendaConfirmationPersistenceHelpers,
} = require('./agenda-confirmation-persistence');

function createAgendaRetellCoordinator(deps = {}) {
  const {
    env = process.env,
    isSupabaseConfigured = () => false,
    getSupabaseStateHydrated = () => true,
    forceHydrateRuntimeStateWithRetries = async () => {},
    syncRuntimeStateFromSupabaseIfNewer = async () => false,
    backfillInsightsAndAppointmentsFromRecentCallUpdates = () => {},
    getGeneratedAgendaAppointments = () => [],
    isGeneratedAppointmentVisibleForAgenda = () => true,
    compareAgendaAppointments = () => 0,
    getGeneratedAppointmentIndexById = () => -1,
    setGeneratedAgendaAppointmentAtIndex = () => null,
    upsertGeneratedAgendaAppointment = () => null,
    buildLeadToAgendaSummary = async (summary = '') => normalizeString(summary),
    getLatestCallUpdateByCallId = () => null,
    aiCallInsightsByCallId = new Map(),
    normalizeString = (value) => String(value || '').trim(),
    normalizeDateYyyyMmDd = (value) => String(value || '').trim(),
    normalizeTimeHhMm = (value) => String(value || '').trim(),
    sanitizeAppointmentLocation = (value) => String(value || '').trim(),
    sanitizeAppointmentWhatsappInfo = (value) => String(value || '').trim(),
    normalizeEmailAddress = (value) => String(value || '').trim().toLowerCase(),
    toBooleanSafe = (value, fallback = false) =>
      value === undefined || value === null ? fallback : Boolean(value),
    normalizeColdcallingStack = (value) => normalizeString(value).toLowerCase(),
    getColdcallingStackLabel = () => '',
    buildLeadOwnerFields = () => ({}),
    resolveAppointmentLocation = () => '',
    resolveCallDurationSeconds = () => 0,
    resolvePreferredRecordingUrl = () => '',
    formatEuroLabel = () => '',
    appendDashboardActivity = () => {},
    buildRuntimeStateSnapshotPayload = () => null,
    applyRuntimeStateSnapshotPayload = () => false,
    waitForQueuedRuntimeSnapshotPersist = async () => true,
    invalidateSupabaseSyncTimestamp = () => {},
  } = deps;

  const {
    takeRuntimeMutationSnapshot,
    resolveGeneratedAgendaAppointmentById,
    doesAgendaMutationMatchAppointment,
    ensureLeadMutationPersistedOrRespond,
  } = createAgendaConfirmationPersistenceHelpers({
    isSupabaseConfigured,
    buildRuntimeStateSnapshotPayload,
    getGeneratedAgendaAppointments,
    getGeneratedAppointmentIndexById,
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    waitForQueuedRuntimeSnapshotPersist,
    syncRuntimeStateFromSupabaseIfNewer,
    applyRuntimeStateSnapshotPayload,
    invalidateSupabaseSyncTimestamp,
  });

  function getHeader(req, name) {
    if (!req || typeof req.get !== 'function') return '';
    return normalizeString(req.get(name));
  }

  function parseRetellSignatureHeader(signatureHeader) {
    const raw = normalizeString(signatureHeader);
    if (!raw) return null;
    const match = raw.match(/v=(\d+),d=([a-fA-F0-9]+)/);
    if (!match) return null;
    const timestamp = Number(match[1]);
    const digest = normalizeString(match[2]).toLowerCase();
    if (!Number.isFinite(timestamp) || !digest) return null;
    return { timestamp, digest };
  }

  function verifyRetellSignature(req, maxSkewMs = 5 * 60 * 1000) {
    const apiKey = normalizeString(env.RETELL_API_KEY);
    const signatureHeader = getHeader(req, 'x-retell-signature');
    if (!apiKey || !signatureHeader) return false;

    const parsed = parseRetellSignatureHeader(signatureHeader);
    if (!parsed) return false;
    if (Math.abs(Date.now() - parsed.timestamp) > maxSkewMs) return false;

    const rawBody = Buffer.isBuffer(req?.rawBody)
      ? req.rawBody.toString('utf8')
      : normalizeString(req?.rawBody) || JSON.stringify(req?.body || {});
    const expectedDigest = crypto
      .createHmac('sha256', apiKey)
      .update(`${rawBody}${parsed.timestamp}`)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedDigest, 'hex');
    const incomingBuffer = Buffer.from(parsed.digest, 'hex');
    if (expectedBuffer.length !== incomingBuffer.length) return false;

    return crypto.timingSafeEqual(expectedBuffer, incomingBuffer);
  }

  function isAuthorizedViaWebhookSecret(req) {
    const secret = normalizeString(env.WEBHOOK_SECRET);
    if (!secret) return false;

    const headerCandidates = [
      getHeader(req, 'authorization'),
      getHeader(req, 'x-webhook-secret'),
      getHeader(req, 'x-retell-secret'),
    ].filter(Boolean);

    return headerCandidates.some((candidate) => {
      if (candidate === secret) return true;
      if (/^bearer\s+/i.test(candidate)) {
        return normalizeString(candidate.replace(/^bearer\s+/i, '')) === secret;
      }
      return false;
    });
  }

  function ensureRetellRequestAuthorized(req, res) {
    const hasRetellKey = Boolean(normalizeString(env.RETELL_API_KEY));
    const hasWebhookSecret = Boolean(normalizeString(env.WEBHOOK_SECRET));

    if (!hasRetellKey && !hasWebhookSecret) {
      res.status(503).json({
        ok: false,
        error: 'Retell functie-auth is niet geconfigureerd op de server.',
      });
      return false;
    }

    if (verifyRetellSignature(req) || isAuthorizedViaWebhookSecret(req)) {
      return true;
    }

    res.status(401).json({
      ok: false,
      error: 'Retell-verzoek kon niet worden geverifieerd.',
    });
    return false;
  }

  function isTimeWithinBusinessHours(timeHm, slotMinutes, businessHoursStart, businessHoursEnd) {
    const normalizedTime = normalizeTimeHhMm(timeHm);
    if (!normalizedTime) return false;

    const startMinutes = hhMmToMinutes(businessHoursStart, 9 * 60);
    const endMinutes = hhMmToMinutes(businessHoursEnd, 17 * 60);
    const slotDurationMinutes = clamp(slotMinutes, 15, 240, 60);
    const candidateStartMinutes = hhMmToMinutes(normalizedTime, -1);
    if (candidateStartMinutes < 0) return false;
    if (endMinutes <= startMinutes) return false;

    return (
      candidateStartMinutes >= startMinutes &&
      candidateStartMinutes + slotDurationMinutes <= endMinutes
    );
  }

  async function prepareAgendaState(forceFresh = true) {
    if (isSupabaseConfigured() && !getSupabaseStateHydrated()) {
      await forceHydrateRuntimeStateWithRetries(3);
    }
    if (isSupabaseConfigured()) {
      await syncRuntimeStateFromSupabaseIfNewer({
        force: Boolean(forceFresh),
        maxAgeMs: forceFresh ? 0 : 1000,
      }).catch(() => false);
    }
    backfillInsightsAndAppointmentsFromRecentCallUpdates();
  }

  function getVisibleAppointmentsSorted() {
    return getGeneratedAgendaAppointments()
      .filter((appointment) => isGeneratedAppointmentVisibleForAgenda(appointment))
      .slice()
      .sort(compareAgendaAppointments);
  }

  function toInt(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.round(numeric) : fallback;
  }

  function clamp(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, Math.round(numeric)));
  }

  function hhMmToMinutes(value, fallback) {
    const normalized = normalizeTimeHhMm(value);
    if (!normalized) return fallback;
    const [hoursRaw, minsRaw] = normalized.split(':');
    const hours = toInt(hoursRaw, 0);
    const mins = toInt(minsRaw, 0);
    return hours * 60 + mins;
  }

  function minutesToHhMm(totalMinutes) {
    const safe = Math.max(0, Math.min(23 * 60 + 59, toInt(totalMinutes, 0)));
    const hours = Math.floor(safe / 60);
    const mins = safe % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  function addDaysToDate(dateYmd, daysToAdd) {
    const normalizedDate = normalizeDateYyyyMmDd(dateYmd);
    if (!normalizedDate) return '';
    const [yearRaw, monthRaw, dayRaw] = normalizedDate.split('-');
    const utcDate = new Date(Date.UTC(toInt(yearRaw, 0), toInt(monthRaw, 1) - 1, toInt(dayRaw, 1)));
    utcDate.setUTCDate(utcDate.getUTCDate() + toInt(daysToAdd, 0));
    return utcDate.toISOString().slice(0, 10);
  }

  function getCurrentLocalDateTime(timeZone = 'Europe/Amsterdam') {
    const formatter = new Intl.DateTimeFormat('sv-SE', {
      timeZone: normalizeString(timeZone) || 'Europe/Amsterdam',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date());
    const partByType = Object.create(null);
    parts.forEach((part) => {
      if (part?.type) partByType[part.type] = part.value;
    });

    const hour = normalizeString(partByType.hour || '') === '24' ? '00' : normalizeString(partByType.hour || '');
    return {
      date: `${partByType.year}-${partByType.month}-${partByType.day}`,
      time: `${hour}:${partByType.minute}`,
    };
  }

  function isSlotInPast(dateYmd, timeHm, timeZone = 'Europe/Amsterdam') {
    const normalizedDate = normalizeDateYyyyMmDd(dateYmd);
    const normalizedTime = normalizeTimeHhMm(timeHm);
    if (!normalizedDate || !normalizedTime) return true;

    const now = getCurrentLocalDateTime(timeZone);
    if (normalizedDate < now.date) return true;
    if (normalizedDate > now.date) return false;
    return normalizedTime <= now.time;
  }

  function buildDateLabel(dateYmd, timeZone = 'Europe/Amsterdam') {
    const normalizedDate = normalizeDateYyyyMmDd(dateYmd);
    if (!normalizedDate) return '';
    const date = new Date(`${normalizedDate}T12:00:00.000Z`);
    return new Intl.DateTimeFormat('nl-NL', {
      timeZone: normalizeString(timeZone) || 'Europe/Amsterdam',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(date);
  }

  function buildSlotLabel(dateYmd, timeHm, timeZone = 'Europe/Amsterdam') {
    const dateLabel = buildDateLabel(dateYmd, timeZone);
    const normalizedTime = normalizeTimeHhMm(timeHm);
    if (!dateLabel || !normalizedTime) return '';
    return `${dateLabel} om ${normalizedTime}`;
  }

  function buildSlotObject(dateYmd, timeHm, timeZone = 'Europe/Amsterdam') {
    const normalizedDate = normalizeDateYyyyMmDd(dateYmd);
    const normalizedTime = normalizeTimeHhMm(timeHm);
    return {
      date: normalizedDate,
      time: normalizedTime,
      label: buildSlotLabel(normalizedDate, normalizedTime, timeZone),
    };
  }

  function buildCandidateTimes(slotMinutes, businessHoursStart, businessHoursEnd) {
    const safeSlotMinutes = clamp(slotMinutes, 15, 240, 60);
    const startMinutes = hhMmToMinutes(businessHoursStart, 9 * 60);
    const endMinutes = hhMmToMinutes(businessHoursEnd, 17 * 60);
    const safeEndMinutes = endMinutes > startMinutes ? endMinutes : 17 * 60;
    const lastStartMinutes = Math.max(startMinutes, safeEndMinutes - safeSlotMinutes);
    const candidates = [];

    for (let minutes = startMinutes; minutes <= lastStartMinutes; minutes += safeSlotMinutes) {
      candidates.push(minutesToHhMm(minutes));
    }

    return candidates;
  }

  function getExistingAppointmentByCallId(callId) {
    const normalizedCallId = normalizeString(callId);
    if (!normalizedCallId) return null;
    return (
      getGeneratedAgendaAppointments().find(
        (appointment) => normalizeString(appointment?.callId || appointment?.call_id || '') === normalizedCallId
      ) || null
    );
  }

  function collectOccupiedTimesForDate(dateYmd, options = {}) {
    const normalizedDate = normalizeDateYyyyMmDd(dateYmd);
    const ignoreCallId = normalizeString(options.ignoreCallId || '');
    const ignoreAppointmentId = Number(options.ignoreAppointmentId || 0) || 0;
    const occupied = new Set();

    getVisibleAppointmentsSorted().forEach((appointment) => {
      if (normalizeDateYyyyMmDd(appointment?.date || '') !== normalizedDate) return;
      if (ignoreCallId && normalizeString(appointment?.callId || '') === ignoreCallId) return;
      if (ignoreAppointmentId > 0 && Number(appointment?.id || 0) === ignoreAppointmentId) return;

      const time = normalizeTimeHhMm(appointment?.time || '');
      if (!time) return;
      occupied.add(time);
    });

    return occupied;
  }

  function isSlotAvailable(dateYmd, timeHm, options = {}) {
    const normalizedDate = normalizeDateYyyyMmDd(dateYmd);
    const normalizedTime = normalizeTimeHhMm(timeHm);
    if (!normalizedDate || !normalizedTime) return false;
    if (
      !isTimeWithinBusinessHours(
        normalizedTime,
        options.slotMinutes,
        options.businessHoursStart,
        options.businessHoursEnd
      )
    ) {
      return false;
    }
    if (isSlotInPast(normalizedDate, normalizedTime, options.timeZone)) return false;

    const occupiedTimes = collectOccupiedTimesForDate(normalizedDate, options);
    return !occupiedTimes.has(normalizedTime);
  }

  function collectNextAvailableSlots(options = {}) {
    const timeZone = normalizeString(options.timeZone || 'Europe/Amsterdam') || 'Europe/Amsterdam';
    const slotMinutes = clamp(options.slotMinutes, 15, 240, 60);
    const windowDays = clamp(options.windowDays, 1, 31, 14);
    const maxSuggestions = clamp(options.maxSuggestions, 1, 10, 5);
    const businessHoursStart = normalizeTimeHhMm(options.businessHoursStart || '') || '09:00';
    const businessHoursEnd = normalizeTimeHhMm(options.businessHoursEnd || '') || '17:00';
    const startDate =
      normalizeDateYyyyMmDd(options.startDate || '') || getCurrentLocalDateTime(timeZone).date;
    const minTimeForFirstDay = normalizeTimeHhMm(options.minTimeForFirstDay || '');
    const candidateTimes = buildCandidateTimes(slotMinutes, businessHoursStart, businessHoursEnd);
    const slots = [];

    for (let dayOffset = 0; dayOffset < windowDays; dayOffset += 1) {
      const currentDate = addDaysToDate(startDate, dayOffset);
      const occupiedTimes = collectOccupiedTimesForDate(currentDate, options);

      for (const time of candidateTimes) {
        if (dayOffset === 0 && minTimeForFirstDay && time < minTimeForFirstDay) continue;
        if (isSlotInPast(currentDate, time, timeZone)) continue;
        if (occupiedTimes.has(time)) continue;

        slots.push(buildSlotObject(currentDate, time, timeZone));
        if (slots.length >= maxSuggestions) return slots;
      }
    }

    return slots;
  }

  function buildAvailabilityMessage(payload = {}) {
    const requestedDate = normalizeDateYyyyMmDd(payload.requestedDate || '');
    const requestedTime = normalizeTimeHhMm(payload.requestedTime || '');
    const available = Boolean(payload.available);
    const slots = Array.isArray(payload.availableSlots) ? payload.availableSlots : [];
    const timeZone = normalizeString(payload.timeZone || 'Europe/Amsterdam') || 'Europe/Amsterdam';

    if (requestedDate && requestedTime && available) {
      return `${buildSlotLabel(requestedDate, requestedTime, timeZone)} is nog vrij in de agenda.`;
    }

    if (requestedDate && requestedTime && !available) {
      if (slots.length > 0) {
        return `${buildSlotLabel(
          requestedDate,
          requestedTime,
          timeZone
        )} is niet beschikbaar. Eerstvolgende opties: ${slots
          .map((slot) => slot.label)
          .join(', ')}.`;
      }
      return `${buildSlotLabel(requestedDate, requestedTime, timeZone)} is niet beschikbaar en ik zie nu geen alternatief binnen het ingestelde zoekvenster.`;
    }

    if (requestedDate && slots.length > 0) {
      return `Beschikbare momenten op ${buildDateLabel(requestedDate, timeZone)}: ${slots
        .map((slot) => slot.time)
        .join(', ')}.`;
    }

    if (slots.length > 0) {
      return `Eerstvolgende vrije momenten: ${slots.map((slot) => slot.label).join(', ')}.`;
    }

    return 'Ik zie momenteel geen vrije momenten binnen het ingestelde zoekvenster.';
  }

  function pickFirstNonEmpty(...values) {
    for (const value of values) {
      const normalized = normalizeString(value);
      if (normalized) return normalized;
    }
    return '';
  }

  function pickFirstEmail(...values) {
    for (const value of values) {
      const normalized = normalizeEmailAddress(value || '');
      if (normalized) return normalized;
    }
    return '';
  }

  function getRetellDynamicVariables(call = {}) {
    return call?.retell_llm_dynamic_variables &&
      typeof call.retell_llm_dynamic_variables === 'object' &&
      !Array.isArray(call.retell_llm_dynamic_variables)
      ? call.retell_llm_dynamic_variables
      : {};
  }

  function getRetellMetadata(call = {}) {
    return call?.metadata && typeof call.metadata === 'object' && !Array.isArray(call.metadata)
      ? call.metadata
      : {};
  }

  function resolveRetellPhone(call = {}, requestBody = {}, callUpdate = {}, insight = {}) {
    return pickFirstNonEmpty(
      requestBody.phone,
      getRetellDynamicVariables(call).leadPhoneE164,
      getRetellDynamicVariables(call).phone,
      getRetellMetadata(call).leadPhoneE164,
      getRetellMetadata(call).leadPhone,
      getRetellMetadata(call).phone,
      normalizeString(call?.direction).toLowerCase() === 'outbound' ? call?.to_number : '',
      call?.from_number,
      call?.to_number,
      callUpdate?.phone,
      insight?.phone,
      insight?.leadPhone
    );
  }

  async function sendRetellAgendaAvailabilityResponse(req, res) {
    if (!ensureRetellRequestAuthorized(req, res)) return res;

    await prepareAgendaState(true);

    const requestedDate = normalizeDateYyyyMmDd(req.body?.preferredDate || req.body?.date || '');
    const requestedTime = normalizeTimeHhMm(req.body?.preferredTime || req.body?.time || '');
    const timeZone = normalizeString(req.body?.timezone || 'Europe/Amsterdam') || 'Europe/Amsterdam';
    const slotMinutes = clamp(req.body?.slotMinutes, 15, 240, 60);
    const windowDays = clamp(req.body?.windowDays, 1, 31, 14);
    const maxSuggestions = clamp(req.body?.maxSuggestions, 1, 10, 5);
    const businessHoursStart = normalizeTimeHhMm(req.body?.businessHoursStart || '') || '09:00';
    const businessHoursEnd = normalizeTimeHhMm(req.body?.businessHoursEnd || '') || '17:00';

    let available = false;
    let availableSlots = [];
    let occupiedSlotsOnRequestedDate = [];

    if (requestedDate && requestedTime) {
      available = isSlotAvailable(requestedDate, requestedTime, {
        timeZone,
        slotMinutes,
        businessHoursStart,
        businessHoursEnd,
      });
      availableSlots = available
        ? [buildSlotObject(requestedDate, requestedTime, timeZone)]
        : collectNextAvailableSlots({
            startDate: requestedDate,
            minTimeForFirstDay: requestedTime,
            timeZone,
            slotMinutes,
            windowDays,
            maxSuggestions,
            businessHoursStart,
            businessHoursEnd,
          });
      occupiedSlotsOnRequestedDate = Array.from(collectOccupiedTimesForDate(requestedDate)).sort();
    } else if (requestedDate) {
      availableSlots = collectNextAvailableSlots({
        startDate: requestedDate,
        timeZone,
        slotMinutes,
        windowDays: 1,
        maxSuggestions,
        businessHoursStart,
        businessHoursEnd,
      });
      available = availableSlots.length > 0;
      occupiedSlotsOnRequestedDate = Array.from(collectOccupiedTimesForDate(requestedDate)).sort();
    } else {
      availableSlots = collectNextAvailableSlots({
        timeZone,
        slotMinutes,
        windowDays,
        maxSuggestions,
        businessHoursStart,
        businessHoursEnd,
      });
      available = availableSlots.length > 0;
    }

    return res.status(200).json({
      ok: true,
      functionName: normalizeString(req.body?.retellFunctionName || '') || 'agenda_availability',
      available,
      requestedSlot:
        requestedDate || requestedTime
          ? {
              date: requestedDate || null,
              time: requestedTime || null,
              label:
                requestedDate && requestedTime ? buildSlotLabel(requestedDate, requestedTime, timeZone) : null,
            }
          : null,
      occupiedSlotsOnRequestedDate,
      availableSlots,
      message: buildAvailabilityMessage({
        requestedDate,
        requestedTime,
        available,
        availableSlots,
        timeZone,
      }),
    });
  }

  function buildBookingConflictPayload(requestBody = {}, options = {}) {
    const date = normalizeDateYyyyMmDd(requestBody?.date || requestBody?.appointmentDate || '');
    const time = normalizeTimeHhMm(requestBody?.time || requestBody?.appointmentTime || '');
    const timeZone = normalizeString(requestBody?.timezone || 'Europe/Amsterdam') || 'Europe/Amsterdam';
    const suggestions = collectNextAvailableSlots({
      startDate: date,
      minTimeForFirstDay: time,
      timeZone,
      slotMinutes: requestBody?.slotMinutes,
      windowDays: 14,
      maxSuggestions: 5,
      businessHoursStart: requestBody?.businessHoursStart,
      businessHoursEnd: requestBody?.businessHoursEnd,
      ignoreCallId: options.ignoreCallId,
      ignoreAppointmentId: options.ignoreAppointmentId,
    });

    return {
      ok: false,
      available: false,
      error: 'Tijdslot is niet beschikbaar.',
      requestedSlot: {
        date,
        time,
        label: buildSlotLabel(date, time, timeZone),
      },
      availableSlots: suggestions,
      message: buildAvailabilityMessage({
        requestedDate: date,
        requestedTime: time,
        available: false,
        availableSlots: suggestions,
        timeZone,
      }),
    };
  }

  async function bookRetellAgendaAppointmentResponse(req, res) {
    if (!ensureRetellRequestAuthorized(req, res)) return res;

    await prepareAgendaState(true);

    const call = req.body?.retellCall && typeof req.body.retellCall === 'object' ? req.body.retellCall : {};
    const callId = normalizeString(req.body?.callId || call?.call_id || '');
    const appointmentDate = normalizeDateYyyyMmDd(req.body?.appointmentDate || req.body?.date || '');
    const appointmentTime = normalizeTimeHhMm(req.body?.appointmentTime || req.body?.time || '');
    const actor = normalizeString(req.body?.actor || req.body?.doneBy || '') || 'Retell AI';
    const location = sanitizeAppointmentLocation(req.body?.location || req.body?.appointmentLocation || '');
    const whatsappInfo = sanitizeAppointmentWhatsappInfo(req.body?.whatsappInfo || req.body?.notes || '');
    const timeZone = normalizeString(req.body?.timezone || 'Europe/Amsterdam') || 'Europe/Amsterdam';
    const existingAppointment = getExistingAppointmentByCallId(callId);

    if (!callId) {
      return res.status(400).json({ ok: false, error: 'Retell callId ontbreekt.' });
    }
    if (!appointmentDate) {
      return res.status(400).json({ ok: false, error: 'Vul een geldige datum in (YYYY-MM-DD).' });
    }
    if (!appointmentTime) {
      return res.status(400).json({ ok: false, error: 'Vul een geldige tijd in (HH:MM).' });
    }
    if (!location) {
      return res.status(400).json({ ok: false, error: 'Vul een locatie in.' });
    }
    if (isSlotInPast(appointmentDate, appointmentTime, timeZone)) {
      return res.status(400).json({
        ok: false,
        error: 'Je kunt geen afspraak in het verleden boeken.',
      });
    }

    const ignoreAppointmentId = Number(existingAppointment?.id || 0) || 0;
    if (
      !isSlotAvailable(appointmentDate, appointmentTime, {
        timeZone,
        slotMinutes: req.body?.slotMinutes,
        businessHoursStart: req.body?.businessHoursStart,
        businessHoursEnd: req.body?.businessHoursEnd,
        ignoreCallId: callId,
        ignoreAppointmentId,
      })
    ) {
      return res.status(409).json(
        buildBookingConflictPayload(req.body || {}, {
          ignoreCallId: callId,
          ignoreAppointmentId,
        })
      );
    }

    const callUpdate = getLatestCallUpdateByCallId(callId) || {};
    const insight = aiCallInsightsByCallId.get(callId) || {};
    const dynamicVariables = getRetellDynamicVariables(call);
    const metadata = getRetellMetadata(call);
    const preferredOwner =
      existingAppointment &&
      (existingAppointment?.leadOwnerKey ||
        existingAppointment?.leadOwnerName ||
        existingAppointment?.leadOwnerFullName ||
        existingAppointment?.leadOwnerUserId ||
        existingAppointment?.leadOwnerEmail)
        ? {
            key: existingAppointment?.leadOwnerKey,
            displayName: existingAppointment?.leadOwnerName,
            fullName: existingAppointment?.leadOwnerFullName,
            userId: existingAppointment?.leadOwnerUserId,
            email: existingAppointment?.leadOwnerEmail,
          }
        : null;
    const normalizedStack = normalizeColdcallingStack(
      pickFirstNonEmpty(
        req.body?.coldcallingStack,
        metadata?.coldcallingStack,
        dynamicVariables?.coldcallingStack,
        'retell_ai'
      )
    );
    const leadOwnerFields = buildLeadOwnerFields(callId, preferredOwner);
    const baseSummary = pickFirstNonEmpty(
      req.body?.summary,
      metadata?.summary,
      dynamicVariables?.summary,
      callUpdate?.summary,
      insight?.summary,
      'Afspraak ingepland via Retell AI.'
    );
    const runtimeSnapshot = takeRuntimeMutationSnapshot();
    const persistedAppointment = upsertGeneratedAgendaAppointment(
      {
        company: pickFirstNonEmpty(
          req.body?.company,
          metadata?.leadCompany,
          metadata?.company,
          dynamicVariables?.leadCompany,
          dynamicVariables?.company,
          callUpdate?.company,
          insight?.company,
          insight?.leadCompany,
          existingAppointment?.company,
          'Onbekende lead'
        ),
        contact: pickFirstNonEmpty(
          req.body?.contact,
          metadata?.leadName,
          metadata?.lead_name,
          metadata?.contactName,
          metadata?.contact_name,
          dynamicVariables?.leadName,
          dynamicVariables?.contactName,
          callUpdate?.name,
          insight?.contactName,
          insight?.leadName,
          existingAppointment?.contact,
          'Onbekend'
        ),
        phone: resolveRetellPhone(call, req.body || {}, callUpdate, insight),
        contactEmail: pickFirstEmail(
          req.body?.contactEmail,
          metadata?.contactEmail,
          metadata?.leadEmail,
          metadata?.email,
          dynamicVariables?.contactEmail,
          dynamicVariables?.leadEmail,
          dynamicVariables?.email,
          callUpdate?.contactEmail,
          insight?.contactEmail,
          insight?.leadEmail,
          existingAppointment?.contactEmail
        ),
        type: normalizeString(existingAppointment?.type || 'meeting') || 'meeting',
        date: appointmentDate,
        time: appointmentTime,
        value:
          pickFirstNonEmpty(
            existingAppointment?.value,
            callUpdate?.value,
            formatEuroLabel(insight?.estimatedValueEur || insight?.estimated_value_eur)
          ) || '',
        branche:
          pickFirstNonEmpty(
            req.body?.branche,
            metadata?.leadBranche,
            metadata?.branche,
            metadata?.sector,
            dynamicVariables?.leadBranche,
            dynamicVariables?.branche,
            dynamicVariables?.sector,
            callUpdate?.branche,
            insight?.branche,
            insight?.sector,
            existingAppointment?.branche
          ) || 'Onbekend',
        source: normalizeString(existingAppointment?.source || 'Retell AI afspraak') || 'Retell AI afspraak',
        summary: baseSummary,
        aiGenerated: true,
        callId,
        createdAt:
          pickFirstNonEmpty(
            existingAppointment?.createdAt,
            callUpdate?.endedAt,
            callUpdate?.updatedAt,
            callUpdate?.startedAt,
            Number(call?.start_timestamp || 0) > 0 ? new Date(Number(call.start_timestamp)).toISOString() : '',
            new Date().toISOString()
          ) || new Date().toISOString(),
        needsConfirmationEmail: false,
        provider: 'retell',
        coldcallingStack: normalizedStack || 'retell_ai',
        coldcallingStackLabel:
          pickFirstNonEmpty(existingAppointment?.coldcallingStackLabel, getColdcallingStackLabel(normalizedStack)) ||
          'Retell AI',
        location:
          sanitizeAppointmentLocation(
            resolveAppointmentLocation(
              req.body || {},
              existingAppointment,
              callUpdate,
              insight,
              { location }
            ) || location
          ) || location,
        appointmentLocation:
          sanitizeAppointmentLocation(
            resolveAppointmentLocation(
              req.body || {},
              existingAppointment,
              callUpdate,
              insight,
              { location }
            ) || location
          ) || location,
        durationSeconds: resolveCallDurationSeconds(existingAppointment, callUpdate, insight),
        whatsappConfirmed: toBooleanSafe(req.body?.whatsappConfirmed, false),
        whatsappInfo,
        recordingUrl: resolvePreferredRecordingUrl(existingAppointment, callUpdate, insight),
        ...leadOwnerFields,
      },
      callId
    );

    if (!persistedAppointment) {
      return res.status(500).json({ ok: false, error: 'Afspraak kon niet worden opgeslagen.' });
    }

    const idx = getGeneratedAppointmentIndexById(persistedAppointment?.id);
    if (idx < 0) {
      return res.status(500).json({ ok: false, error: 'Afspraak niet gevonden na opslaan.' });
    }

    const whatsappConfirmed = toBooleanSafe(
      req.body?.whatsappConfirmed,
      toBooleanSafe(existingAppointment?.whatsappConfirmed, false)
    );
    const nowIso = new Date().toISOString();
    const mergedSummary = await buildLeadToAgendaSummary(baseSummary, location, whatsappInfo, {
      whatsappConfirmed,
    });
    const updatedAppointment = setGeneratedAgendaAppointmentAtIndex(
      idx,
      {
        ...persistedAppointment,
        date: appointmentDate,
        time: appointmentTime,
        location: location || null,
        appointmentLocation: location || null,
        whatsappInfo: whatsappInfo || null,
        whatsappConfirmed,
        summary: mergedSummary,
        summaryFormatVersion: 4,
        needsConfirmationEmail: false,
        confirmationEmailSent: true,
        confirmationEmailSentAt: normalizeString(persistedAppointment?.confirmationEmailSentAt || '') || nowIso,
        confirmationEmailSentBy:
          normalizeString(persistedAppointment?.confirmationEmailSentBy || '') || actor || null,
        confirmationResponseReceived: true,
        confirmationResponseReceivedAt: nowIso,
        confirmationResponseReceivedBy: actor || null,
        confirmationAppointmentCancelled: false,
        confirmationAppointmentCancelledAt: null,
        confirmationAppointmentCancelledBy: null,
      },
      'retell_agenda_booked'
    );

    appendDashboardActivity(
      {
        type: 'retell_appointment_booked',
        title: 'Afspraak ingepland via Retell',
        detail: `Retell plande ${appointmentDate} om ${appointmentTime}${location ? ` (${location})` : ''}.`,
        company: updatedAppointment?.company || persistedAppointment?.company || '',
        actor,
        taskId: Number(updatedAppointment?.id || 0) || null,
        callId,
        source: 'retell-ai',
      },
      'dashboard_activity_retell_appointment_booked'
    );

    const persistOk = await ensureLeadMutationPersistedOrRespond(
      res,
      runtimeSnapshot,
      'Afspraak kon niet veilig in gedeelde opslag worden opgeslagen.',
      {
        allowPendingResponse: true,
        pendingResponseAfterMs: 3000,
        verifyPersisted: () =>
          doesAgendaMutationMatchAppointment(
            updatedAppointment,
            resolveGeneratedAgendaAppointmentById(updatedAppointment?.id)
          ),
      }
    );
    if (!persistOk) return res;

    return res.status(persistOk === 'pending' ? 202 : 200).json({
      ok: true,
      appointment: updatedAppointment,
      persistencePending: persistOk === 'pending',
      message: `${buildSlotLabel(appointmentDate, appointmentTime, timeZone)} is ingepland in de agenda.`,
    });
  }

  return {
    bookRetellAgendaAppointmentResponse,
    ensureRetellAgendaRequestAuthorized: ensureRetellRequestAuthorized,
    sendRetellAgendaAvailabilityResponse,
  };
}

module.exports = {
  createAgendaRetellCoordinator,
};
