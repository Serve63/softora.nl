const crypto = require('crypto');

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
    normalizeString = (value) => String(value || '').trim(),
    normalizeDateYyyyMmDd = (value) => String(value || '').trim(),
    normalizeTimeHhMm = (value) => String(value || '').trim(),
  } = deps;

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

  return {
    ensureRetellAgendaRequestAuthorized: ensureRetellRequestAuthorized,
    sendRetellAgendaAvailabilityResponse,
  };
}

module.exports = {
  createAgendaRetellCoordinator,
};
