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

module.exports = {
  getRetellArgs,
  getRetellCall,
  validateRetellAgendaAvailabilityRequest,
};
