function normalizeString(value) {
  return String(value ?? '').trim();
}

function truncateText(value, maxLength = 0) {
  const text = normalizeString(value);
  if (!maxLength || text.length <= maxLength) return text;
  return text.slice(0, maxLength);
}

function normalizeOptionalInteger(value, fallback = undefined) {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(numeric);
}

function normalizeBooleanOrUndefined(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const raw = normalizeString(value).toLowerCase();
  if (!raw) return undefined;
  if (['1', 'true', 'yes', 'ja', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'nee', 'off'].includes(raw)) return false;
  return Boolean(value);
}

function getRetellArgs(body = {}) {
  if (body?.args && typeof body.args === 'object' && !Array.isArray(body.args)) {
    return body.args;
  }
  return body && typeof body === 'object' ? body : {};
}

function getRetellCall(body = {}) {
  if (body?.call && typeof body.call === 'object' && !Array.isArray(body.call)) {
    return body.call;
  }
  return null;
}

function buildRetellRequestEnvelope(body = {}) {
  return {
    retellFunctionName: truncateText(body?.name || '', 160),
    retellCall: getRetellCall(body),
    retellPayloadMode:
      body?.args && typeof body.args === 'object' && !Array.isArray(body.args) ? 'wrapped' : 'args_only',
    retellArgs: getRetellArgs(body),
  };
}

function ensureRequiredField(value, label) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return {
      ok: false,
      error: `${label} ontbreekt.`,
    };
  }
  return {
    ok: true,
    value: normalized,
  };
}

function validateRetellAgendaAvailabilityRequest(req) {
  const envelope = buildRetellRequestEnvelope(req.body || {});
  const args = envelope.retellArgs || {};

  return {
    ok: true,
    body: {
      ...envelope,
      preferredDate: truncateText(args.preferredDate || args.date || '', 40),
      preferredTime: truncateText(args.preferredTime || args.time || '', 20),
      timezone: truncateText(args.timezone || '', 80),
      slotMinutes: normalizeOptionalInteger(args.slotMinutes || args.durationMinutes, undefined),
      windowDays: normalizeOptionalInteger(args.windowDays, undefined),
      maxSuggestions: normalizeOptionalInteger(args.maxSuggestions || args.limit, undefined),
      businessHoursStart: truncateText(args.businessHoursStart || args.dayStart || '', 20),
      businessHoursEnd: truncateText(args.businessHoursEnd || args.dayEnd || '', 20),
    },
  };
}

function validateRetellAgendaBookingRequest(req) {
  const envelope = buildRetellRequestEnvelope(req.body || {});
  const args = envelope.retellArgs || {};

  const dateResult = ensureRequiredField(args.date || args.appointmentDate, 'Datum');
  if (!dateResult.ok) return dateResult;

  const timeResult = ensureRequiredField(args.time || args.appointmentTime, 'Tijd');
  if (!timeResult.ok) return timeResult;

  const locationResult = ensureRequiredField(args.location || args.appointmentLocation, 'Locatie');
  if (!locationResult.ok) return locationResult;

  const callIdResult = ensureRequiredField(args.callId || envelope.retellCall?.call_id, 'Retell callId');
  if (!callIdResult.ok) return callIdResult;

  const whatsappConfirmed = normalizeBooleanOrUndefined(args.whatsappConfirmed);

  return {
    ok: true,
    body: {
      ...envelope,
      callId: truncateText(callIdResult.value, 160),
      appointmentDate: truncateText(dateResult.value, 40),
      date: truncateText(dateResult.value, 40),
      appointmentTime: truncateText(timeResult.value, 20),
      time: truncateText(timeResult.value, 20),
      location: truncateText(locationResult.value, 255),
      appointmentLocation: truncateText(locationResult.value, 255),
      company: truncateText(args.company || args.companyName || '', 160),
      contact: truncateText(args.contact || args.contactName || '', 160),
      phone: truncateText(args.phone || '', 80),
      contactEmail: truncateText(args.contactEmail || args.email || '', 320),
      branche: truncateText(args.branche || args.branch || args.sector || '', 160),
      summary: truncateText(args.summary || '', 4000),
      whatsappInfo: truncateText(args.whatsappInfo || args.notes || args.whatsappNotes || '', 4000),
      notes: truncateText(args.whatsappInfo || args.notes || args.whatsappNotes || '', 4000),
      actor: truncateText(args.actor || '', 120),
      doneBy: truncateText(args.actor || '', 120),
      timezone: truncateText(args.timezone || '', 80),
      slotMinutes: normalizeOptionalInteger(args.slotMinutes || args.durationMinutes, undefined),
      businessHoursStart: truncateText(args.businessHoursStart || args.dayStart || '', 20),
      businessHoursEnd: truncateText(args.businessHoursEnd || args.dayEnd || '', 20),
      ...(whatsappConfirmed !== undefined ? { whatsappConfirmed } : {}),
    },
  };
}

module.exports = {
  getRetellArgs,
  getRetellCall,
  validateRetellAgendaAvailabilityRequest,
  validateRetellAgendaBookingRequest,
};
