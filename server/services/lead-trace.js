function normalizeString(value) {
  return String(value || '').trim();
}

function normalizePhoneDigits(value) {
  return normalizeString(value).replace(/\D+/g, '');
}

function normalizeSearchText(value) {
  return normalizeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function hasLeadTraceContext(trace) {
  return Boolean(trace && trace.enabled);
}

function buildLeadTraceContext(req = {}) {
  const headers = req?.headers || {};
  const query = req?.query || {};
  const enabled = /^(1|true|yes)$/i.test(
    normalizeString(query.traceLead || headers['x-softora-lead-trace'] || '')
  );
  if (!enabled) return null;
  return {
    enabled: true,
    traceId: normalizeString(query.traceId || headers['x-softora-lead-trace-id'] || '') || 'lead-trace',
    trigger: normalizeString(query.traceTrigger || headers['x-softora-lead-trace-trigger'] || '') || 'unknown',
    callId: normalizeString(query.traceCallId || headers['x-softora-lead-trace-call-id'] || ''),
    phone: normalizePhoneDigits(query.tracePhone || headers['x-softora-lead-trace-phone'] || ''),
    company: normalizeSearchText(query.traceCompany || headers['x-softora-lead-trace-company'] || ''),
  };
}

function summarizeLeadRow(row = {}) {
  return {
    id: Number(row?.id || row?.appointmentId || 0) || 0,
    callId: normalizeString(row?.callId || ''),
    company: normalizeString(row?.company || ''),
    contact: normalizeString(row?.contact || row?.name || row?.contactName || ''),
    phone: normalizeString(row?.phone || row?.phoneNumber || ''),
    type: normalizeString(row?.type || ''),
    confirmationTaskType: normalizeString(row?.confirmationTaskType || ''),
    source: normalizeString(row?.source || ''),
    date: normalizeString(row?.date || ''),
    time: normalizeString(row?.time || ''),
  };
}

function traceMatchesLead(trace, row = {}) {
  if (!hasLeadTraceContext(trace)) return false;
  const rowCallId = normalizeString(row?.callId || '');
  if (trace.callId && rowCallId && rowCallId === trace.callId) return true;

  const rowPhone = normalizePhoneDigits(row?.phone || row?.phoneNumber || '');
  if (trace.phone && rowPhone && rowPhone.endsWith(trace.phone)) return true;

  const companyText = normalizeSearchText(row?.company || '');
  if (trace.company && companyText && companyText.includes(trace.company)) return true;

  if (!trace.callId && !trace.phone && !trace.company) return true;
  return false;
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({
      fallback: true,
      error: normalizeString(error?.message || error),
    });
  }
}

function logLeadTrace(scope, event, payload = {}) {
  console.log(`[LeadTrace][${scope}][${event}] ${safeStringify(payload)}`);
}

module.exports = {
  buildLeadTraceContext,
  hasLeadTraceContext,
  logLeadTrace,
  summarizeLeadRow,
  traceMatchesLead,
};
